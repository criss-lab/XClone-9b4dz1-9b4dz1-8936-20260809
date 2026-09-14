# Testagram Gateway

Locked-down Cloudflare Worker gateway for Testagram's browser-to-Supabase federation relay.

## Request flow

```text
Testagram browser
  -> POST /api/gateway
  -> Cloudflare Worker
  -> Supabase gateway-relay
  -> Testagram Federation
```

## Security boundaries

- Only `POST /api/gateway` is proxied.
- Upstream is fixed by `SUPABASE_GATEWAY_URL`.
- Upstream must use HTTPS.
- Browser origins are restricted by `ALLOWED_ORIGINS`.
- `Authorization`, `Content-Type`, `Accept`, and `X-Request-ID` are forwarded.
- `Origin`, `Host`, and `Content-Length` are not forwarded upstream.
- `Set-Cookie` is removed from upstream responses.
- No arbitrary target URL is accepted.
- ActivityPub signing, authentication, delivery, retries, and federation state remain in the existing Testagram backend.

## Verification

```bash
npm install
npm run typecheck
npm run dev
```

Health: `GET /health`

Gateway: `POST /api/gateway`

The gateway body is the existing Testagram gateway envelope and is forwarded without rewriting.

## Deployment

```bash
npm run deploy
```

The DNS/custom-domain route for `api.testagram.site` must be configured separately to point to this Worker.
