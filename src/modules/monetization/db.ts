import { supabase } from '@/lib/supabase';
export { supabase };
export const Tables={WALLETS:'wallets',TRANSACTIONS:'transactions',LEDGER:'ledger',SUBSCRIPTIONS:'subscriptions'} as const;
export type DbTables=typeof Tables[keyof typeof Tables];
