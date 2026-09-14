import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';
const AS = 'https://www.w3.org/ns/activitystreams';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
function originFromActor(actorUri: string) { return new URL(actorUri).origin; }
Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return Response.json({ error: 'authentication required' }, { status: 401 });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: 'invalid session' }, { status: 401 });
  const input = await request.json();
  const content = String(input.content || '').trim();
  if (!content) return Response.json({ error: 'content is required' }, { status: 400 });
  const { data: actor, error: actorError } = await db.from('federation_actors').select('*').eq('user_id', userData.user.id).eq('enabled', true).maybeSingle();
  if (actorError || !actor) return Response.json({ error: 'federation is not enabled for this account' }, { status: 409 });
  const objectId = `${originFromActor(actor.actor_uri)}/objects/${crypto.randomUUID()}`;
  const activityId = `${originFromActor(actor.actor_uri)}/activities/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const visibility = input.visibility || 'public';
  const audience = visibility === 'followers' ? actor.followers_uri : 'https://www.w3.org/ns/activitystreams#Public';
  const object = { '@context': AS, id: objectId, type: 'Note', attributedTo: actor.actor_uri, content, published: now, url: input.url || objectId, to: [audience], cc: visibility === 'public' ? [] : [audience], sensitive: !!input.sensitive, summary: input.spoilerText || undefined, inReplyTo: input.inReplyTo || undefined, attachment: Array.isArray(input.attachments) ? input.attachments : [] };
  const activity = { '@context': AS, id: activityId, type: 'Create', actor: actor.actor_uri, published: now, to: object.to, cc: object.cc, object };
  const { error: objectError } = await db.from('federation_objects').insert({ object_uri: objectId, activity_uri: activityId, actor_uri: actor.actor_uri, object_type: 'Note', local: true, local_post_id: input.postId || null, payload: activity, published_at: now });
  if (objectError) return Response.json({ error: objectError.message }, { status: 500 });
  const { data: followers } = await db.from('federation_followers').select('remote_inbox_uri,remote_shared_inbox_uri').eq('local_actor_id', actor.id).eq('state', 'accepted');
  const targets = new Map<string, boolean>();
  for (const follower of followers || []) { const inbox = follower.remote_shared_inbox_uri || follower.remote_inbox_uri; if (inbox) targets.set(inbox, true); }
  if (targets.size) await db.from('federation_deliveries').insert([...targets.keys()].map(target_inbox => ({ actor_id: actor.id, activity_uri: activityId, target_inbox, payload: activity, state: 'queued' })));
  return Response.json({ ok: true, object, activity, queuedDeliveries: targets.size });
});
