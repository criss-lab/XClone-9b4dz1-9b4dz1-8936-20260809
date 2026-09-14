# Testagram parity matrix

The canonical visual reference is `https://www.testagram.site/`. The Android app must preserve the existing React/Tailwind UI rather than introduce a second visual system.

## Primary product surface

| Surface | Canonical route | Existing implementation | Android strategy |
|---|---|---|---|
| Home | `/` | `src/pages/HomePage.tsx` | Capacitor web UI |
| Explore | `/explore` | `src/pages/ExplorePage.tsx` | Capacitor web UI |
| Threads | `/threads` | `src/pages/ThreadsPage.tsx` | Capacitor web UI |
| Notifications | `/notifications` | `src/pages/NotificationsPage.tsx` | Capacitor web UI |
| Messages | `/messages` | `src/pages/MessagesPage.tsx` | Capacitor web UI |
| Spaces | `/spaces` | `src/pages/SpacesPage.tsx` | Capacitor web UI |
| AI | `/ai` | `src/pages/AIPage.tsx` | Capacitor web UI |
| Communities | `/communities` | `src/pages/CommunitiesPage.tsx` | Capacitor web UI |
| Profile | `/profile/:username` | `src/pages/ProfilePage.tsx` | Capacitor web UI |
| Login/Register | `/auth` | `src/pages/AuthPage.tsx` | Capacitor web UI |
| Premium | `/premium` | `src/pages/PremiumPage.tsx` | Capacitor web UI |
| Settings | `/settings` | `src/pages/SettingsPage.tsx` | Capacitor web UI |

## Supporting feature surface

The existing router also contains search, post/thread detail, hashtags, bookmarks, lists, creator studio, monetization, products, scheduled posts, livestreaming, wallets, ads, rewards, leaderboards, referrals, discovery, marketplace, notification preferences, policy/help pages, and administrative surfaces. These remain part of the web application and are not duplicated in Kotlin.

## Parity rules

1. **Visual source of truth:** existing React + Tailwind components.
2. **No Android-only redesign:** Kotlin supplies native lifecycle/OS integration only.
3. **Backend continuity:** preserve the existing Supabase integration and session model.
4. **Navigation continuity:** React Router remains authoritative for in-app routes.
5. **Media continuity:** preserve the existing media upload/playback components and permissions.
6. **Realtime continuity:** preserve existing Supabase realtime subscriptions and fallbacks.
7. **Android behavior:** back navigation, safe-area/system bars, lifecycle restoration, deep links, external intents and native permission prompts must not alter page appearance.
8. **Build gate:** web build, lint, Android debug build and parity smoke checks must pass before the branch is marked ready.

## Screen-by-screen acceptance checklist

- [ ] Home: feed, tabs, composer, post actions, media, realtime updates
- [ ] Explore: search/discovery/trending and navigation
- [ ] Threads: thread feed, creation and detail navigation
- [ ] Notifications: categories, read state and realtime updates
- [ ] Messages: conversations, realtime updates, media and voice controls
- [ ] Spaces: live/upcoming/recorded experiences and controls
- [ ] AI: chat, trends and suggestions
- [ ] Communities: discovery, search, join/leave and creation
- [ ] Profile: posts, profile actions, media and settings entry points
- [ ] Auth: sign-in, registration, recovery and session restoration
- [ ] Create Post: text, media, visibility and submission
- [ ] Media: picker/camera/upload/playback behavior
- [ ] Premium: plans, entitlement UI and payment handoff
- [ ] Settings: account, appearance, notifications, privacy and security

## Verification principle

A private/authenticated screen cannot be declared pixel-perfect from an unauthenticated HTTP crawl alone. Those screens are verified from repository implementation plus authenticated device testing when credentials/test accounts are available.
