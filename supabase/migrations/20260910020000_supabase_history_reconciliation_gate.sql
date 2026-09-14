-- CI history-gate reconciliation marker.
-- Production migration history is preserved when the original migration source exists.
-- This migration intentionally makes no schema change; it provides a deterministic
-- post-repair migration boundary for the production/preview gates.
select 1;
