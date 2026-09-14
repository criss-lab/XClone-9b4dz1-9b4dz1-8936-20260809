# Testagram native federation architecture

Testagram is a native ActivityPub application. Elk is not part of the federation runtime.

## Runtime

- **Supabase**: PostgreSQL protocol state, Auth identity, RLS, inbox/outbox records, follower graph, delivery queue, Edge Functions.
- **Vercel**: Node protocol gateway and application hosting. `api/federation.ts` terminates WebFinger, actor, outbox, followers and signed inbox requests.
- **Cloudflare**: public federation edge. The Worker owns `/.well-known/*` and `/users/*` so the public Testagram domain can expose ActivityPub without colliding with the Vite SPA. Vercel's current routing rules reserve `/.well-known` from rewrites, so this edge layer is deliberate.
- **Cloudinary**: media delivery for product/federation attachments.
- **Cloudflare media/storage services**: remain available for the existing application media pipeline.

## Mastodon interoperability implemented in the first foundation layer

1. WebFinger account discovery.
2. ActivityPub Person actors with RSA public keys.
3. Actor inbox/outbox/followers/following collections.
4. HTTP Signature verification for inbound server-to-server POSTs.
5. Digest verification for signed POST bodies.
6. `Follow` -> accepted follower + queued `Accept`.
7. `Undo(Follow)` -> follower removal.
8. `Create(Note)` -> durable remote federation object.
9. Native local `Create(Note)` publisher and delivery queue.
10. Signed outbound delivery worker with exponential retry/dead-letter behavior.
11. NodeInfo discovery.
12. Authenticated actor provisioning from the native application.

## Required deployment configuration

### Vercel

Set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose to Vite/client code)
- `FEDERATION_DOMAIN=https://www.testagram.site` (use the exact production federation hostname)

### Cloudflare Worker

Set `VERCEL_ORIGIN` to the Vercel deployment origin. Bind the Worker to the production federation hostname for:

- `/.well-known/webfinger`
- `/.well-known/nodeinfo`
- `/nodeinfo/2.0`
- `/users/*`

The Worker forwards the original URI and Host as internal headers so HTTP Signature verification signs exactly what Mastodon sent.

### Supabase

Apply `supabase/migrations/202609140001_federation_core.sql`, then deploy:

- `supabase/functions/federation-publish`
- `supabase/functions/federation-worker`

Run the worker periodically (or invoke it from the existing scheduler/queue infrastructure) so queued deliveries are processed.

## Important security invariant

`federation_actor_keys.private_key_pem` is worker-only. It is not exposed through the Data API to `anon` or `authenticated`. Public actor data contains only the public key. The Vercel gateway uses the Supabase service role exclusively on the server.

## Next integration layer

The remaining work is product wiring, not replacing the protocol layer:

- call `enableFederation()` when a user enables federation;
- call `publishFederatedPost()` from the canonical native post-creation transaction;
- translate inbound `Create`, `Like`, `Announce`, `Delete`, replies, mentions and polls into native Testagram records;
- send `Follow`, `Undo`, `Like`, `Announce`, `Delete` and moderation activities from native actions;
- materialize remote media through the Cloudinary/Cloudflare media pipeline;
- add delivery deduplication, domain allow/deny controls, SSRF protection, rate limits and moderation policy before broad production federation.
