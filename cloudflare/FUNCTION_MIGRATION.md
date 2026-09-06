# Legacy function migration map

The old edge-function source is still present only as migration reference. These functions must be ported to Cloudflare Workers before the legacy source is removed.

| Legacy function | Cloudflare target | State |
|---|---|---|
| `mpesa-stk-push` | Worker route `/api/payments/mpesa/stk-push` | Pending port |
| `mpesa-stk-status` | Worker route `/api/payments/mpesa/stk-status` | Pending port |
| `mpesa-b2c-payout` | Worker route `/api/payments/mpesa/b2c-payout` | Pending port |
| `mpesa-callback` | Worker route `/api/webhooks/mpesa` | Pending port |
| `pesapal-create-order` | Worker route `/api/payments/pesapal/order` | Pending port |
| `ai-moderation` | Worker / Workers AI route | Pending port |
| `transcribe-audio` | Worker / Workers AI route | Pending port |
| `help-chatbot` | Worker / Workers AI route | Pending port |
| `og-image` | Worker route | Pending port |
| `og-meta` | Worker route | Pending port |
| `community-sitemap` | Worker/Workflow | Pending port |
| `sitemap-refresh` | Worker/Workflow | Pending port |
| `sitemap-users` | Worker/Workflow | Pending port |
| `podcast-rss` | Worker route | Pending port |
| `budget-alerts` | Cron/Workflow | Pending port |
| `distribute-earnings` | Workflow | Pending port |
| `trending-hashtag-alert` | Cron/Workflow | Pending port |

This explicit map prevents accidentally deleting a production capability during the migration.
