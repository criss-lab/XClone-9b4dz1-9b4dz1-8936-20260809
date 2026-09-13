import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
const text = (v: unknown): string => typeof v === "string" ? v : "";
const uri = (v: unknown): string => typeof v === "string" ? v : v && typeof v === "object" ? text((v as JsonRecord).id) : "";
const obj = (v: unknown): JsonRecord => v && typeof v === "object" ? v as JsonRecord : {};

function host(value: string): string | null { try { return new URL(value).hostname.toLowerCase(); } catch { return null; } }

async function persistActor(admin: SupabaseClient, actorUri: string, hint?: unknown) {
  if (!actorUri.startsWith("https://")) return;
  const actor = obj(hint), domain = host(actorUri), preferred = text(actor.preferredUsername) || null;
  const endpoints = obj(actor.endpoints);
  const inbox = uri(actor.inbox) || null, sharedInbox = uri(endpoints.sharedInbox) || null;
  const rich = await admin.from("federation_remote_actors").upsert({
    actor_url: actorUri, acct: preferred && domain ? `${preferred}@${domain}` : null,
    username: preferred, domain, inbox_url: inbox, shared_inbox_url: sharedInbox,
    actor: Object.keys(actor).length ? actor : null, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "actor_url" });
  if (rich.error && !/column|relation|does not exist/i.test(rich.error.message)) throw rich.error;

  const existing = await admin.from("federated_actors").select("id").eq("uri", actorUri).maybeSingle();
  if (existing.error) throw existing.error;
  const values = {
    uri: actorUri, preferred_username: preferred, display_name: text(actor.name) || preferred,
    summary: text(actor.summary) || null, avatar_url: uri(actor.icon) || null, header_url: uri(actor.image) || null,
    actor_type: text(actor.type) || "Person", inbox_url: inbox, shared_inbox_url: sharedInbox,
    outbox_url: uri(actor.outbox) || null, followers_url: uri(actor.followers) || null, following_url: uri(actor.following) || null,
    public_key_id: text(obj(actor.publicKey).id) || null, public_key_pem: text(obj(actor.publicKey).publicKeyPem) || null,
    raw_actor: Object.keys(actor).length ? actor : {}, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const result = existing.data
    ? await admin.from("federated_actors").update(values).eq("id", existing.data.id)
    : await admin.from("federated_actors").insert(values);
  if (result.error) throw result.error;
}

async function persistObject(admin: SupabaseClient, value: unknown, actorUri: string) {
  const object = obj(value), objectUri = uri(value);
  if (!objectUri.startsWith("https://")) return;
  const result = await admin.from("federated_objects").upsert({
    uri: objectUri, object_type: text(object.type) || "Object", actor_uri: actorUri,
    url: uri(object.url) || objectUri, content: text(object.content) || null, summary: text(object.summary) || null,
    published_at: text(object.published) || null, updated_at: text(object.updated) || null,
    sensitive: Boolean(object.sensitive), in_reply_to_uri: uri(object.inReplyTo) || null, quote_uri: uri(object.quote) || null,
    language_code: text(object.language) || null, attachments: Array.isArray(object.attachment) ? object.attachment : [],
    tags: Array.isArray(object.tag) ? object.tag : [], raw_object: object,
  }, { onConflict: "uri" });
  if (result.error) throw result.error;
}

async function localUserForActor(admin: SupabaseClient, actorUri: string): Promise<string | null> {
  const result = await admin.from("federation_actors").select("user_id").eq("actor_url", actorUri).maybeSingle();
  if (result.error) throw result.error;
  return text(result.data?.user_id) || null;
}

async function relationship(admin: SupabaseClient, userId: string, remote: string, kind: "following" | "follower" | "blocked" | "muted", state: "pending" | "accepted" | "rejected" | "active" | "removed") {
  const result = await admin.from("federated_relationships").upsert({
    local_user_id: userId, remote_actor_uri: remote, relationship: kind, state, updated_at: new Date().toISOString(),
  }, { onConflict: "local_user_id,remote_actor_uri,relationship" });
  if (result.error) throw result.error;
}

async function handleFollow(admin: SupabaseClient, activity: JsonRecord, remoteActor: string) {
  const target = uri(activity.object);
  const userId = target ? await localUserForActor(admin, target) : null;
  if (userId) await relationship(admin, userId, remoteActor, "follower", "pending");
}

async function handleUndo(admin: SupabaseClient, activity: JsonRecord, remoteActor: string) {
  const follow = obj(activity.object);
  if (text(follow.type) !== "Follow") return;
  const target = uri(follow.object), userId = target ? await localUserForActor(admin, target) : null;
  if (userId) await relationship(admin, userId, remoteActor, "follower", "removed");
}

async function handleResponse(admin: SupabaseClient, activity: JsonRecord, state: "accepted" | "rejected") {
  const follow = obj(activity.object), localActor = uri(follow.actor), remoteActor = uri(follow.object);
  if (!localActor || !remoteActor) return;
  const userId = await localUserForActor(admin, localActor);
  if (userId) await relationship(admin, userId, remoteActor, "following", state);
}

async function handleDelete(admin: SupabaseClient, activity: JsonRecord) {
  const target = uri(activity.object) || text(activity.object);
  if (!target) return;
  const existing = await admin.from("federated_objects").select("raw_object").eq("uri", target).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return;
  const raw = obj(existing.data.raw_object); raw.deleted = true; raw.deletedAt = new Date().toISOString();
  const result = await admin.from("federated_objects").update({ raw_object: raw, updated_at: new Date().toISOString() }).eq("uri", target);
  if (result.error) throw result.error;
}

/** Normalize a verified ActivityPub activity into Testagram's federation projections. */
export async function processActivityCompat(admin: SupabaseClient, activity: JsonRecord, actorUri: string): Promise<void> {
  const type = text(activity.type);
  if (!type) throw new Error("ActivityPub activity type is required");

  const actorObject = obj(activity.actor), embeddedActor = uri(actorObject);
  await persistActor(admin, embeddedActor || actorUri, embeddedActor ? actorObject : undefined);

  if (["Create", "Update", "Announce"].includes(type) && uri(activity.object)) {
    await persistObject(admin, activity.object, actorUri);
  }

  switch (type) {
    case "Follow": await handleFollow(admin, activity, actorUri); break;
    case "Undo": await handleUndo(admin, activity, actorUri); break;
    case "Accept": await handleResponse(admin, activity, "accepted"); break;
    case "Reject": await handleResponse(admin, activity, "rejected"); break;
    case "Delete": await handleDelete(admin, activity); break;
    case "Create": case "Update": case "Announce": case "Like": case "Dislike": case "Block": case "Flag":
      break;
    default:
      // Unknown signed ActivityPub types remain persisted by federation-inbox.
      break;
  }
}
