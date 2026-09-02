// M-Pesa STK Push (Lipa Na M-Pesa Online)
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforceRateLimit } from '../_shared/rate-limit.ts';

const MPESA_BASE='https://api.safaricom.co.ke';
async function getMpesaToken(consumerKey:string,consumerSecret:string):Promise<string>{
  const credentials=btoa(`${consumerKey}:${consumerSecret}`);
  const res=await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${credentials}`}});
  if(!res.ok)throw new Error(`Token fetch failed (${res.status})`);
  const data=await res.json(); if(!data.access_token)throw new Error('No access_token in M-Pesa response'); return data.access_token;
}
function normalisePhone(raw:string):string{
  const digits=raw.replace(/\D/g,'');
  if(digits.startsWith('254')&&digits.length===12)return digits;
  if(digits.startsWith('0')&&digits.length===10)return '254'+digits.slice(1);
  if(digits.startsWith('7')&&digits.length===9)return '254'+digits;
  if(digits.startsWith('1')&&digits.length===9)return '254'+digits;
  throw new Error(`Invalid phone number: "${raw}"`);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const supabaseAdmin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'');
  try{
    const consumerKey=Deno.env.get('MPESA_CONSUMER_KEY'); const consumerSecret=Deno.env.get('MPESA_CONSUMER_SECRET');
    const shortCode=Deno.env.get('MPESA_SHORTCODE'); const passkey=Deno.env.get('MPESA_PASSKEY');
    const callbackUrl=Deno.env.get('MPESA_CALLBACK_URL')??`${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;
    if(!consumerKey||!consumerSecret||!shortCode||!passkey)throw new Error('M-Pesa credentials must be configured in Edge Function secrets');
    const authHeader=req.headers.get('Authorization'); if(!authHeader)throw new Error('Unauthorized');
    const jwtToken=authHeader.replace(/^Bearer\s+/i,'');
    const {data:{user},error:userErr}=await supabaseAdmin.auth.getUser(jwtToken);
    if(userErr||!user)throw new Error('Unauthorized — invalid session');
    await enforceRateLimit(supabaseAdmin,`mpesa:stk:user:${user.id}`,5,300);

    const body=await req.json(); const {phone,amount,purpose,metadata,idempotency_key}=body;
    if(!phone)throw new Error('phone is required'); if(!amount)throw new Error('amount is required');
    const normalisedPhone=normalisePhone(String(phone)); const intAmount=Math.ceil(Number(amount));
    if(!Number.isFinite(intAmount)||intAmount<1)throw new Error('Amount must be at least KES 1');
    const idempotencyKey=String(idempotency_key??req.headers.get('Idempotency-Key')??crypto.randomUUID());
    const {data:existing}=await supabaseAdmin.from('mpesa_transactions').select('id,checkout_request_id,merchant_request_id,status').eq('user_id',user.id).eq('idempotency_key',idempotencyKey).maybeSingle();
    if(existing)return new Response(JSON.stringify({success:true,idempotent_replay:true,checkout_request_id:existing.checkout_request_id,merchant_request_id:existing.merchant_request_id,status:existing.status}),{headers:{...corsHeaders,'Content-Type':'application/json'}});

    const token=await getMpesaToken(consumerKey,consumerSecret); const now=new Date(); const pad=(n:number)=>String(n).padStart(2,'0');
    const timestamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const password=btoa(`${shortCode}${passkey}${timestamp}`);
    const stkPayload={BusinessShortCode:shortCode,Password:password,Timestamp:timestamp,TransactionType:'CustomerPayBillOnline',Amount:intAmount,PartyA:normalisedPhone,PartyB:shortCode,PhoneNumber:normalisedPhone,CallBackURL:callbackUrl,AccountReference:purpose??'WalletTopUp',TransactionDesc:purpose??'XClone Wallet Top-Up'};
    const stkRes=await fetch(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(stkPayload)});
    const stkData=await stkRes.json(); console.log('[mpesa-stk] STK response:',JSON.stringify(stkData));
    if(!stkRes.ok||stkData.ResponseCode!=='0'){const errMsg=stkData.errorMessage??stkData.ResponseDescription??`STK Push failed (${stkRes.status})`;throw new Error(`M-Pesa: ${errMsg}`);}

    const {error:insertErr}=await supabaseAdmin.from('mpesa_transactions').insert({user_id:user.id,checkout_request_id:stkData.CheckoutRequestID,merchant_request_id:stkData.MerchantRequestID,phone_number:normalisedPhone,amount:intAmount,currency:'KES',type:'stk_push',purpose:purpose??'wallet_topup',status:'pending',idempotency_key:idempotencyKey,metadata:{...(metadata??{}),authenticated_user_id:user.id}});
    if(insertErr){console.error('[mpesa-stk] Ledger insert failed after provider acceptance:',insertErr.message);throw new Error('Payment prompt accepted but local ledger could not be updated; contact support');}
    await supabaseAdmin.from('user_wallets').update({mpesa_phone:normalisedPhone}).eq('user_id',user.id);
    await supabaseAdmin.from('audit_logs').insert({actor_user_id:user.id,action:'mpesa_stk_initiated',resource_type:'mpesa_transaction',resource_id:stkData.CheckoutRequestID,status:'success',metadata:{amount_kes:intAmount,phone:normalisedPhone,idempotency_key:idempotencyKey}});
    return new Response(JSON.stringify({success:true,checkout_request_id:stkData.CheckoutRequestID,merchant_request_id:stkData.MerchantRequestID,customer_message:`M-Pesa PIN prompt sent to ${normalisedPhone}. Enter your PIN to complete payment.`,response_description:stkData.ResponseDescription}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
  }catch(err:unknown){const message=err instanceof Error?err.message:'Internal error';console.error('[mpesa-stk] Error:',message);return new Response(JSON.stringify({success:false,error:message}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});}
});
