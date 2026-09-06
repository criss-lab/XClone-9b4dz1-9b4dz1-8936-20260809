/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDFLARE_API_URL?: string;
  readonly VITE_CLOUDFLARE_RELAY_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_GIPHY_API_KEY?: string;
  readonly VITE_TENOR_API_KEY?: string;
  readonly VITE_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
