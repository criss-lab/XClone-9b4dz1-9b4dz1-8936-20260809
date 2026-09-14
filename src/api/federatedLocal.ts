import { supabase } from '@/lib/supabase';

function requireUserId(userId?: string | null): string {
  if (!userId) throw new Error('You must be signed in to interact with Fediverse content.');
  return userId;
}

export async function hasLocalInteraction(userId: string | null | undefined, objectUri: string, type: string): Promise<boolean> {
  const uid = requireUserId(userId);
  const { data, error } = await supabase.from('federated_local_interactions').select('id').eq('user_id', uid).eq('object_uri', objectUri).eq('interaction_type', type).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setLocalInteraction(userId: string | null | undefined, objectUri: string, type: 'like' | 'repost' | 'bookmark', enabled: boolean): Promise<void> {
  const uid = requireUserId(userId);
  if (enabled) {
    const { error } = await supabase.from('federated_local_interactions').upsert({ user_id: uid, object_uri: objectUri, interaction_type: type }, { onConflict: 'user_id,object_uri,interaction_type' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('federated_local_interactions').delete().eq('user_id', uid).eq('object_uri', objectUri).eq('interaction_type', type);
    if (error) throw error;
  }
}

export async function createLocalInteraction(userId: string | null | undefined, objectUri: string, type: 'reply' | 'quote', content: string): Promise<void> {
  const uid = requireUserId(userId);
  const { error } = await supabase.from('federated_local_interactions').insert({ user_id: uid, object_uri: objectUri, interaction_type: type, content });
  if (error) throw error;
}

export async function isLocallyFollowing(userId: string | null | undefined, actorUri: string): Promise<boolean> {
  const uid = requireUserId(userId);
  const { data, error } = await supabase.from('federated_local_follows').select('id').eq('user_id', uid).eq('actor_uri', actorUri).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setLocalFollow(userId: string | null | undefined, actorUri: string, actorHandle: string, enabled: boolean): Promise<void> {
  const uid = requireUserId(userId);
  if (enabled) {
    const { error } = await supabase.from('federated_local_follows').upsert({ user_id: uid, actor_uri: actorUri, actor_handle: actorHandle }, { onConflict: 'user_id,actor_uri' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('federated_local_follows').delete().eq('user_id', uid).eq('actor_uri', actorUri);
    if (error) throw error;
  }
}
