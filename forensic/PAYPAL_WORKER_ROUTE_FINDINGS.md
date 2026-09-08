# PayPal Worker Route Forensic Findings

Run 34201866274 passed source/build validation but failed canonical deployment verification: `/api/paypal/config` returned `{"error":"Not found"}` on all 24 attempts.

This branch is reserved for forensic repair. Before modifying application routing, verify the Wrangler `name`/`main` configuration and the deployment workflow target. The deployed URL must correspond to the Worker produced from `cloudflare/wrangler.jsonc` and `cloudflare/worker/production-entrypoint.ts`.

Cloudflare Workers uses the Wrangler `name` to determine the workers.dev hostname; production deployments should use a configured route/custom domain or an explicitly verified workers.dev target. Do not treat a successful dry-run build as proof of deployment.
