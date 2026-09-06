// Compatibility facade retained for legacy feature-module imports during the
// Supabase -> Cloudflare cutover. The implementation is entirely Cloudflare
// based; this module intentionally contains no Supabase SDK or network calls.
export {
  supabase,
  mapSupabaseUser,
  currentAccessToken,
  SHARED_BACKEND,
} from './cloudflare';

export type { User, CloudflareUser, Session } from './cloudflare';
