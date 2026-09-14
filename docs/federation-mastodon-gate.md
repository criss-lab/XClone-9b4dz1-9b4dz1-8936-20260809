# Mastodon interoperability gate

Testagram's application origin is `https://testagram.site` and its ActivityPub origin is `https://federation.testagram.site`.

The federation origin is intentionally separate because Vercel reserves `/.well-known`; Mastodon discovery therefore belongs on the dedicated federation edge.

## Required public surface

- `/.well-known/webfinger`
- `/.well-known/nodeinfo`
- `/nodeinfo/2.1`
- `/users/:username`
- `/users/:username/inbox`
- `/users/:username/outbox`
- `/users/:username/followers`
- `/users/:username/following`
- `/users/:username/notes/:id`
- `/inbox`

## Mastodon account-to-account matrix

1. WebFinger `acct:user@federation.testagram.site` resolves to the actor.
2. Actor exposes a valid RSA public key, inbox, outbox, followers/following and shared inbox metadata.
3. Mastodon sends `Follow`; Testagram verifies the HTTP signature, persists the relationship and returns `Accept`.
4. Testagram publishes `Create` to the remote follower's inbox/sharedInbox with a valid digest and HTTP signature.
5. Mastodon sends `Create`; Testagram verifies the sender and materializes the Note.
6. Mastodon sends `Like`; Testagram records the remote engagement.
7. Mastodon sends `Announce`; Testagram records the remote boost.
8. Mastodon sends `Undo` for Like/Announce; Testagram reconciles interaction state.
9. Mastodon sends `Update`; Testagram refreshes the remote object.
10. Mastodon sends `Delete`; Testagram removes or tombstones the remote object.
11. Replies resolve through `inReplyTo` and remote object dereferencing.
12. Quote requests/approvals follow the existing Testagram quote federation state machine.
13. Repeated activities are idempotent.
14. Invalid, stale or mismatched signatures are rejected.
15. Public Note dereferencing returns Mastodon-compatible ActivityPub JSON.

CI validates the public protocol surface and negative signature path. A positive account-to-account Mastodon result must be produced by a real Mastodon instance/account and is never manufactured by CI.
