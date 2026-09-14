import { createClient } from '@supabase/supabase-js';

const ACTIVITY_JSON = 'application/activity+json';
const ACTIVITY_ACCEPT = `${ACTIVITY_JSON}, application/ld+json; profile="https://www.w3.org/ns/activitystreams"`;
const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';
export const config = { api: { bodyParser: false } };
type Req = any; type Res = any;

const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`Missing environment variable: ${name}`); return v; };
const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
const origin = (req: Req) => {
  const configured = process.env.FEDERATION_DOMAIN?.replace(/\/$/, '');
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${host}`;
};
const sendJson = (res: Res, status: number, body: unknown, activity = false) => {
  res.status(status).setHeader('Content-Type', activity ? ACTIVITY_JSON : 'application/json');
  res.setHeader('Cache-Control', activity ? 'public, max-age=60, s-maxage=60' : 'no-store');
  return res.send(body);
};

function actorDocument(a: any) {
  return { '@context': [AS_CONTEXT, 'https://w3id.org/security/v1', { toot: 'http://joinmastodon.org/ns#' }], id: a.actor_uri, type: 'Person', preferredUsername: a.username, name: a.display_name || a.username, summary: a.bio || '', url: a.actor_uri, inbox: a.inbox_uri, outbox: a.outbox_uri, followers: a.followers_uri, following: a.following_uri, manuallyApprovesFollowers: !!a.locked, discoverable: !!a.discoverable, published: a.created_at, icon: a.avatar_url ? { type: 'Image', mediaType: 'image/jpeg', url: a.avatar_url } : undefined, image: a.header_url ? { type: 'Image', mediaType: 'image/jpeg', url: a.header_url } : undefined, publicKey: { id: `${a.actor_uri}#main-key`, owner: a.actor_uri, publicKeyPem: a.public_key_pem } };
}
async function lookupActor(db: any, username: string) { const { data, error } = await db.from('federation_actors').select('*').eq('username', username).eq('enabled', true).maybeSingle(); if (error) throw error; return data; }
function parseSignature(value: string | undefined) { const out: Record<string,string> = {}; for (const p of String(value || '').matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g)) out[p[1]] = p[2] ?? p[3] ?? ''; return out; }
function signedPath(req: Req) { return String(req.headers['x-original-uri'] || req.headers['x-forwarded-uri'] || req.url || '/').split('?')[0]; }
function signingString(req: Req, names: string[]) { return names.map(name => { const n = name.toLowerCase(); if (n === '(request-target)') return `(request-target): ${String(req.method).toLowerCase()} ${signedPath(req)}`; const v = req.headers[n]; return `${n}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`; }).join('\n'); }
async function rawBody(req: Req) { if (typeof req.rawBody === 'string') return req.rawBody; if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8'); const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return Buffer.concat(chunks).toString('utf8'); }
async function verifySignature(req: Req, body: string) {
  const s = parseSignature(req.headers.signature); if (!s.keyId || !s.signature || !s.headers) return { valid:false, reason:'missing HTTP Signature fields' };
  if (s.algorithm && s.algorithm.toLowerCase() !== 'rsa-sha256') return { valid:false, reason:'unsupported signature algorithm' };
  const digest = String(req.headers.digest || '').match(/^SHA-256=(.+)$/i);
  if (digest) { const { createHash } = await import('node:crypto'); if (digest[1] !== createHash('sha256').update(Buffer.from(body)).digest('base64')) return { valid:false, reason:'digest mismatch' }; }
  const actorUri = s.keyId.replace(/^<|>$/g, '').replace(/#.*$/, '');
  const remote = await fetch(actorUri, { headers:{ Accept: ACTIVITY_ACCEPT } }); if (!remote.ok) return { valid:false, reason:`actor fetch failed: ${remote.status}` };
  const remoteActor = await remote.json(); const pem = remoteActor?.publicKey?.publicKeyPem; if (!pem) return { valid:false, reason:'remote actor has no public key' };
  const { createVerify } = await import('node:crypto'); const verify = createVerify('RSA-SHA256'); verify.update(signingString(req, s.headers.split(/\s+/))); verify.end();
  return verify.verify(pem, Buffer.from(s.signature, 'base64')) ? { valid:true, actorUri } : { valid:false, reason:'signature verification failed' };
}

async function provision(req: Req, res: Res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/, ''); if (!token) return sendJson(res,401,{error:'authentication required'});
  const db = admin(); const { data:u, error:ue } = await db.auth.getUser(token); if (ue || !u.user) return sendJson(res,401,{error:'invalid session'});
  const input = typeof req.body === 'object' && req.body ? req.body : {}; const username = String(input.username || u.user.user_metadata?.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,30}$/.test(username)) return sendJson(res,400,{error:'a valid federation username is required'});
  const { generateKeyPairSync } = await import('node:crypto'); const { publicKey, privateKey } = generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const base = origin(req); const actorUri = `${base}/users/${encodeURIComponent(username)}`;
  const row = { user_id:u.user.id, username, display_name:String(input.displayName || u.user.user_metadata?.display_name || username), bio:String(input.bio || ''), avatar_url:input.avatarUrl || u.user.user_metadata?.avatar_url || null, header_url:input.headerUrl || null, public_key_pem:publicKey, actor_uri:actorUri, inbox_uri:`${actorUri}/inbox`, outbox_uri:`${actorUri}/outbox`, followers_uri:`${actorUri}/followers`, following_uri:`${actorUri}/following`, enabled:true };
  const { data:actor,error } = await db.from('federation_actors').upsert(row,{onConflict:'user_id'}).select('*').single(); if(error) return sendJson(res,409,{error:error.message});
  const { error:keyError } = await db.from('federation_actor_keys').upsert({actor_id:actor.id,private_key_pem:privateKey},{onConflict:'actor_id'}); if(keyError) return sendJson(res,500,{error:keyError.message});
  return sendJson(res,200,{actor:actorDocument(actor),username});
}

export default async function handler(req: Req, res: Res) {
  try {
    const route=String(req.query.route||'').toLowerCase(), username=String(req.query.username||'').toLowerCase(), db=admin();
    if(route==='provision' && req.method==='POST') return provision(req,res);
    if(route==='webfinger' && req.method==='GET') { const m=String(req.query.resource||'').match(/^acct:([^@]+)@(.+)$/i); if(!m)return sendJson(res,400,{error:'invalid resource'}); const a=await lookupActor(db,m[1].toLowerCase()); if(!a||new URL(a.actor_uri).host!==m[2].toLowerCase())return sendJson(res,404,{error:'account not found'}); const d=new URL(a.actor_uri).host; return sendJson(res,200,{subject:`acct:${a.username}@${d}`,aliases:[a.actor_uri],links:[{rel:'self',type:ACTIVITY_JSON,href:a.actor_uri},{rel:'http://webfinger.net/rel/profile-page',type:'text/html',href:a.actor_uri}]}); }
    if(route==='nodeinfo' && req.method==='GET') return sendJson(res,200,{links:[{rel:'http://nodeinfo.diaspora.software/ns/schema/2.0',href:`${origin(req)}/nodeinfo/2.0`}]});
    if(route==='nodeinfo20' && req.method==='GET') return sendJson(res,200,{version:'2.0',software:{name:'testagram',version:'1.0.0'},protocols:['activitypub'],usage:{users:{total:0},localPosts:0},openRegistrations:false,metadata:{federation:true}});
    const actor=username?await lookupActor(db,username):null; if(!actor)return sendJson(res,404,{error:'federation actor not found'});
    if(route==='actor' && req.method==='GET') return sendJson(res,200,actorDocument(actor),true);
    if(route==='outbox' && req.method==='GET') { const {data,error}=await db.from('federation_objects').select('payload,object_uri').eq('actor_uri',actor.actor_uri).eq('local',true).order('published_at',{ascending:false}).limit(40); if(error)return sendJson(res,500,{error:error.message}); return sendJson(res,200,{'@context':AS_CONTEXT,id:actor.outbox_uri,type:'OrderedCollection',totalItems:data?.length||0,orderedItems:(data||[]).map((x:any)=>x.payload||x.object_uri)},true); }
    if(route==='followers' && req.method==='GET') { const {data,error}=await db.from('federation_followers').select('remote_actor_uri').eq('local_actor_id',actor.id).eq('state','accepted').limit(500); if(error)return sendJson(res,500,{error:error.message}); return sendJson(res,200,{'@context':AS_CONTEXT,id:actor.followers_uri,type:'OrderedCollection',totalItems:data?.length||0,orderedItems:(data||[]).map((x:any)=>x.remote_actor_uri)},true); }
    if(route==='following' && req.method==='GET') return sendJson(res,200,{'@context':AS_CONTEXT,id:actor.following_uri,type:'OrderedCollection',totalItems:0,orderedItems:[]},true);
    if(route==='inbox' && req.method==='POST') {
      const raw=await rawBody(req), signature=await verifySignature(req,raw), activity=JSON.parse(raw), activityUri=typeof activity.id==='string'?activity.id:null, remoteActor=signature.actorUri || (typeof activity.actor==='string'?activity.actor:activity.actor?.id);
      const {error:inboxError}=await db.from('federation_inbox').upsert({local_actor_id:actor.id,activity_uri:activityUri,actor_uri:remoteActor,activity_type:activity.type,payload:activity,signature_valid:signature.valid,processed:false,error:signature.valid?null:signature.reason},{onConflict:'activity_uri'}); if(inboxError)return sendJson(res,500,{error:inboxError.message}); if(!signature.valid)return sendJson(res,401,{error:signature.reason||'invalid signature'});
      if(activity.type==='Follow'&&remoteActor){const rr=await fetch(remoteActor,{headers:{Accept:ACTIVITY_ACCEPT}}), rj=rr.ok?await rr.json():{}; if(rj.inbox){await db.from('federation_followers').upsert({local_actor_id:actor.id,remote_actor_uri:remoteActor,remote_inbox_uri:rj.inbox,remote_shared_inbox_uri:rj.endpoints?.sharedInbox||null,state:'accepted'},{onConflict:'local_actor_id,remote_actor_uri'});const id=`${actor.actor_uri}/activities/${crypto.randomUUID()}`;await db.from('federation_deliveries').insert({actor_id:actor.id,activity_uri:id,target_inbox:rj.endpoints?.sharedInbox||rj.inbox,payload:{'@context':AS_CONTEXT,id,type:'Accept',actor:actor.actor_uri,object:activity}});}}
      if(activity.type==='Create'&&activity.object?.id) await db.from('federation_objects').upsert({object_uri:activity.object.id,activity_uri:activity.id||null,actor_uri:remoteActor,object_type:activity.object.type||'Note',local:false,payload:activity.object,published_at:activity.object.published||new Date().toISOString()},{onConflict:'object_uri'});
      if(activity.type==='Undo'&&activity.object?.type==='Follow') await db.from('federation_followers').update({state:'removed'}).eq('local_actor_id',actor.id).eq('remote_actor_uri',remoteActor);
      await db.from('federation_inbox').update({processed:true,processed_at:new Date().toISOString()}).eq('activity_uri',activityUri); return res.status(202).send('');
    }
    return sendJson(res,404,{error:'unknown federation route'});
  } catch(error){ console.error('federation handler failure',error); return sendJson(res,500,{error:'federation internal error'}); }
}
