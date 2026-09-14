import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY')!;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const FED=Deno.env.get('FEDERATION_ORIGIN')||'https://testagram.site';
const PUBLIC='https://www.w3.org/ns/activitystreams#Public';
const AP='application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX=['https://www.w3.org/ns/activitystreams','https://w3id.org/security/v1'];
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const b64=(x:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(x)));
async function federatePublicPost(userId:string,post:any){
  try{
    const {data:local}=await admin.from('federation_actors').select('*').eq('user_id',userId).maybeSingle();
    if(!local?.private_key_jwk||!local?.actor_url)return {attempted:0,delivered:0};
    const {data:rels}=await admin.from('federation_relationships').select('remote_actor_url').eq('user_id',userId).eq('relationship','follower').in('state',['accepted','active']);
    const targets=[...new Set((rels??[]).map((r:any)=>r.remote_actor_url).filter(Boolean))];
    if(!targets.length)return {attempted:0,delivered:0};
    const actorRows=await admin.from('federation_remote_actors').select('actor_url,inbox_url,shared_inbox_url,actor').in('actor_url',targets);
    const remoteByUrl=new Map((actorRows.data??[]).map((r:any)=>[r.actor_url,r]));
    const noteId=`${FED}/objects/${encodeURIComponent(post.id)}`;
    const note:any={'@context':CTX,id:noteId,type:'Note',attributedTo:local.actor_url,url:noteId,content:String(post.content||''),published:post.created_at||new Date().toISOString(),to:[PUBLIC],cc:[`${local.actor_url}/followers`],sensitive:false,attachment:Array.isArray(post.media_urls)?post.media_urls.map((url:string)=>({type:'Document',mediaType:'application/octet-stream',url})):[]};
    const results=await Promise.allSettled(targets.map(async remoteUrl=>{
      const row=remoteByUrl.get(remoteUrl);let inbox=row?.shared_inbox_url||row?.inbox_url||row?.actor?.endpoints?.sharedInbox||row?.actor?.inbox;
      if(!inbox){const ar=await fetch(remoteUrl,{headers:{Accept:AP,'User-Agent':'Testagram-Federation/3.2'}});if(!ar.ok)throw new Error(`remote actor ${ar.status}`);const a=await ar.json();inbox=a.endpoints?.sharedInbox||a.inbox;if(!inbox)throw new Error('remote actor has no inbox');await admin.from('federation_remote_actors').upsert({actor_url:remoteUrl,acct:a.preferredUsername?`${a.preferredUsername}@${new URL(remoteUrl).hostname}`:null,username:a.preferredUsername||null,domain:new URL(remoteUrl).hostname,inbox_url:a.inbox||null,shared_inbox_url:a.endpoints?.sharedInbox||null,actor:a,fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'actor_url'});}
      const activity:any={'@context':CTX,id:`${FED}/activities/${crypto.randomUUID()}`,type:'Create',actor:local.actor_url,object:note,to:[PUBLIC],cc:[`${local.actor_url}/followers`]};
      const body=JSON.stringify(activity),u=new URL(inbox),date=new Date().toUTCString(),digest=`sha-256=${b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))}`;
      const key=await crypto.subtle.importKey('jwk',local.private_key_jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      const canonical=`(request-target): post ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${date}\ndigest: ${digest}\ncontent-type: ${AP}`;
      const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(canonical));
      const response=await fetch(inbox,{method:'POST',body,headers:{Date:date,Digest:digest,Accept:AP,'Content-Type':AP,Signature:`keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="${b64(sig)}"`,'User-Agent':'Testagram-Federation/3.2'}});
      const text=(await response.text()).slice(0,700);await admin.from('federation_outbox').insert({user_id:userId,activity_id:activity.id,activity_type:'Create',actor_url:local.actor_url,inbox_url:inbox,payload:activity,status:response.ok?'delivered':response.status>=500?'pending':'failed',attempts:1,last_attempt_at:new Date().toISOString(),next_attempt_at:response.ok?null:new Date(Date.now()+60000).toISOString(),http_status:response.status,last_error:response.ok?null:text});
      if(!response.ok)throw new Error(`Create delivery ${response.status}: ${text}`);return response.status;
    }));
    return {attempted:results.length,delivered:results.filter(r=>r.status==='fulfilled').length};
  }catch(error){console.error('[post-create] federation fanout failed',error);return {attempted:0,delivered:0,error:error instanceof Error?error.message:'Federation fanout failed'};}
}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});if(req.method!=='POST')return json({error:'Method not allowed'},405);try{const auth=req.headers.get('Authorization');if(!auth)return json({error:'Authentication required'},401);const c=createClient(URL,ANON,{global:{headers:{Authorization:auth}}});const {data:{user},error}=await c.auth.getUser(auth.replace(/^Bearer\s+/i,''));if(error||!user)return json({error:'Invalid authentication'},401);const b=await req.json() as any;const content=String(b.content||'').trim();const media=Array.isArray(b.media_urls)?b.media_urls.slice(0,20):[];const visibility=['public','unlisted','followers','private'].includes(b.visibility)?b.visibility:'public';const quotedPostId=typeof b.quoted_post_id==='string'&&b.quoted_post_id.trim()?b.quoted_post_id.trim():null;if(quotedPostId===user.id)return json({error:'Invalid quoted post'},400);if(!content&&!media.length&&!quotedPostId)return json({error:'Post must contain text, media, or a quote'},400);if(content.length>10000)return json({error:'Post is too long'},413);if(quotedPostId){const {data:quoted}=await admin.from('posts').select('id').eq('id',quotedPostId).maybeSingle();if(!quoted)return json({error:'Quoted post is unavailable'},400);}const row={author_id:user.id,user_id:user.id,content,media_urls:media,image_url:typeof b.image_url==='string'?b.image_url:null,video_url:typeof b.video_url==='string'?b.video_url:null,is_video:Boolean(b.is_video),visibility,community_id:b.community_id||null,quoted_post_id:quotedPostId};const {data:post,error:insertError}=await admin.from('posts').insert(row).select('*').single();if(insertError)return json({error:'Post creation failed',detail:insertError.message},400);const federation=visibility==='public'?await federatePublicPost(user.id,post):{attempted:0,delivered:0};return json({ok:true,post,federation},201)}catch(e){console.error(e);return json({error:e instanceof Error?e.message:'Post creation failed'},500)}})