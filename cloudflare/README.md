# Cloudflare-native backend

This branch replaces the application's Supabase runtime with Cloudflare primitives. The browser talks to a Cloudflare Worker; the Worker owns access to D1 and R2.

## Services

- **Workers**: API, authentication, authorization and integrations.
- **D1**: application SQL database.
- **R2**: private user media and attachments.
- **KV**: low-latency cache/configuration.
- **Durable Objects**: reserved for realtime chat, presence and other coordinated state.

## First-time setup

1. Install Node.js and authenticate Wrangler: `npx wrangler login`.
2. Create the database: `npx wrangler d1 create tsocial-db`.
3. Put the returned database ID into `cloudflare/wrangler.jsonc`.
4. Create media storage: `npx wrangler r2 bucket create tsocial-media`.
5. Create a KV namespace: `npx wrangler kv namespace create CACHE` and put its ID into `cloudflare/wrangler.jsonc`.
6. Apply D1 migrations: `npm run cloudflare:d1:migrate`.
7. Configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM` as Worker secrets if email OTP delivery is required.
8. Set frontend `VITE_CLOUDFLARE_API_URL` to the deployed Worker URL.
9. Deploy with `npm run cloudflare:deploy`.

Cloudflare bindings keep D1/R2 credentials out of the browser. R2 is accessed from the Worker binding rather than exposing bucket credentials to users.

## Important migration rule

Do not delete old production Supabase data until the complete application schema has been inventoried and migrated. The repository did not contain a complete historical Supabase schema; therefore the D1 migrations in this branch establish a safe application baseline rather than pretending to reproduce tables that are not present in source control.

The remaining legacy `supabase/` function source is retained temporarily as migration reference only. It is **not used by the new frontend client**. Each function must be ported to a Worker before that legacy source is deleted.

## Security

- Browser requests carry an opaque Cloudflare-issued session token.
- Session tokens are stored hashed in D1.
- Passwords use PBKDF2-SHA-256 with per-user salts.
- R2 object keys are user-scoped (`users/<user-id>/...`).
- Secrets for payment/email providers belong in Wrangler secrets, never Vite client variables.
- D1 access is parameterized through prepared statements.
