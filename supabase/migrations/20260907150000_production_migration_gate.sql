begin;

-- Explicit no-op gate migration. Its purpose is to give CI a timestamped
-- migration after the repaired social foundation so the production migration
-- chain is evaluated by the same Supabase CLI that deploys future changes.

commit;
