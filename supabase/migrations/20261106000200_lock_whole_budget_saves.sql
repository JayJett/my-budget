-- PHASE 1, LAST STEP: run only AFTER the new app (version 4) is live.
-- The old app saved by overwriting the whole budget. Once every device runs the new app,
-- that permission is removed, so an old browser tab left open somewhere can't wipe
-- newer changes. All saves then go through apply_budget_ops().
drop policy if exists "members save the budget" on public.budgets;
