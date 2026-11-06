-- PART 4B: version history and undo.
--
--  * budget_changes: one row per change to a household's budget. It records who made the change,
--    when, and exactly what changed (each box's old and new value). Every save already goes through
--    apply_budget_ops, so the history is written there, in the same step as the save. It can't be
--    skipped, and edits made offline appear once they sync.
--  * Typing "4… 45… 450" saves three times. If the same person changes the same thing again within
--    2 minutes, and nobody else has saved in between, the saves are merged into one entry
--    ("Groceries from $400 to $450").
--  * undo_budget_change: puts one change back, but leaves alone anything someone has changed since.
--  * restore_budget_version: puts the whole budget back to how it was right after an earlier change.
--    Both are recorded as new changes, so they can be undone too.
--  * Clean-up: a nightly job deletes history older than 90 days, keeps at most 5,000 changes per
--    household, and keeps only the newest 20 "before a replace" backups per household.
--
-- How a change is stored: "changes" is a list of {"p": path, "o": old value, "n": new value}.
-- "o" is missing when something was added, and "n" is missing when it was removed.
-- The same maths lives in js/model/history.js (changesBetween, invert), and tests check they agree.

create table if not exists public.budget_changes (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),   -- first save in this entry
  changed_at timestamptz not null default now(),   -- last save in this entry
  seq bigint not null default 0,                   -- the budget's save number after this change
  kind text not null check (kind in ('edit', 'replace', 'restore', 'undo')),
  reason text not null default '',                 -- for 'replace': why (an upgrade, an import)
  ref_id bigint,                                   -- 'undo': the change undone; 'restore': the change restored to
  ref_at timestamptz,                              -- when that change was made (kept after it's cleaned up)
  undone_at timestamptz,                           -- set once this change has been undone
  changes jsonb not null
);
create index if not exists budget_changes_household_idx on public.budget_changes (household_id, id desc);
create index if not exists budget_changes_age_idx on public.budget_changes (changed_at);

alter table public.budget_changes enable row level security;
drop policy if exists "members read their history" on public.budget_changes;
create policy "members read their history" on public.budget_changes
  for select to authenticated using (public.is_member(household_id));
-- Nobody writes, edits or deletes history directly: only the functions below do.
revoke all on public.budget_changes from anon;
revoke insert, update, delete, truncate on public.budget_changes from authenticated;

/* ---------- small JSON helpers ---------- */

/** Set a value deep inside a JSON object, creating any missing parent objects (like a "set" op). */
create or replace function public._json_put(s jsonb, p text[], v jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare i int;
begin
  if jsonb_typeof(s) is distinct from 'object' then s := '{}'::jsonb; end if;
  for i in 1 .. coalesce(array_length(p, 1), 0) - 1 loop
    if jsonb_typeof(s #> p[1:i]) is distinct from 'object' then s := jsonb_set(s, p[1:i], '{}'::jsonb, true); end if;
  end loop;
  return jsonb_set(s, p, coalesce(v, 'null'::jsonb), true);
end $$;

/** A JSON path list (["spend","s3","amount"]) as a Postgres text array. */
create or replace function public._path(j jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x.v order by x.n), '{}') from jsonb_array_elements_text(j) with ordinality as x(v, n) $$;

/** Is one path the start of (or the same as) the other? e.g. ["spend","s3"] and ["spend","s3","amount"]. */
create or replace function public._paths_overlap(a text[], b text[]) returns boolean
language sql immutable set search_path = '' as $$
  select case when coalesce(array_length(a, 1), 0) <= coalesce(array_length(b, 1), 0)
              then b[1:coalesce(array_length(a, 1), 0)] = a
              else a[1:coalesce(array_length(b, 1), 0)] = b end $$;

/** Every difference between two budgets, as a list of {p, o, n}. Unchanged parts are skipped quickly. */
create or replace function public._jsonb_diff(a jsonb, b jsonb, path text[] default '{}') returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := '[]'::jsonb; k text;
begin
  if a is not distinct from b then return out; end if;
  if jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    for k in select x from (select jsonb_object_keys(a) as x union select jsonb_object_keys(b)) keys order by x loop
      if not (a ? k) then out := out || jsonb_build_array(jsonb_build_object('p', to_jsonb(path || k), 'n', b -> k));
      elsif not (b ? k) then out := out || jsonb_build_array(jsonb_build_object('p', to_jsonb(path || k), 'o', a -> k));
      else out := out || public._jsonb_diff(a -> k, b -> k, path || k);
      end if;
    end loop;
    return out;
  end if;
  return jsonb_build_array(jsonb_build_object('p', to_jsonb(path), 'o', a, 'n', b));
end $$;

/** Turn a budget back to how it was before a list of changes (newest change first). */
create or replace function public._invert(s jsonb, changes jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare c jsonb;
begin
  for c in select x.v from jsonb_array_elements(changes) with ordinality as x(v, n) order by x.n desc loop
    if c ? 'o' then s := public._json_put(s, public._path(c -> 'p'), c -> 'o');
    else s := s #- public._path(c -> 'p');
    end if;
  end loop;
  return s;
end $$;

/** Does the budget still hold a change's new value? (Used by undo: never overwrite someone's newer edit.) */
create or replace function public._still_there(s jsonb, c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when c ? 'n' then (s #> public._path(c -> 'p')) is not distinct from (c -> 'n')
              else (s #> public._path(c -> 'p')) is null end $$;

/* ---------- saving with history ---------- */

/** Save a new budget and record what changed. Used by apply_budget_ops, undo and restore.
    Returns {state, seq, updated_at, updated_by, change_id}. The budget row must already be locked. */
create or replace function public._save_budget(p_household uuid, old_s jsonb, new_s jsonb, p_kind text,
  p_reason text default '', p_ref_id bigint default null, p_ref_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  at timestamptz := now();
  me uuid := auth.uid();
  ch jsonb;
  new_seq bigint;
  last public.budget_changes;
  merged jsonb; c jsonb; e jsonb; cp text[]; ep text[]; idx int; i int; ok boolean;
  change_id bigint;
begin
  if octet_length(new_s::text) > 2000000 then raise exception 'This budget is too big to save'; end if;
  ch := public._jsonb_diff(old_s, new_s);

  -- Undo and restore only save if they actually change something.
  if p_kind in ('undo', 'restore') and jsonb_array_length(ch) = 0 then
    select seq into new_seq from public.budgets where household_id = p_household;
    return jsonb_build_object('state', old_s, 'seq', new_seq, 'updated_at', at, 'updated_by', me, 'change_id', null);
  end if;

  update public.budgets
     set state = new_s, rev = 'ops', updated_by = me, updated_at = at
   where household_id = p_household
  returning seq into new_seq;

  if jsonb_array_length(ch) = 0 then
    return jsonb_build_object('state', new_s, 'seq', new_seq, 'updated_at', at, 'updated_by', me, 'change_id', null);
  end if;

  -- Merge with this person's last entry if it's a quick follow-up to the same thing.
  if p_kind = 'edit' then
    select * into last from public.budget_changes where household_id = p_household order by id desc limit 1;
    if found and last.kind = 'edit' and last.changed_by = me and last.undone_at is null
       and at - last.changed_at < interval '2 minutes' then
      merged := last.changes; ok := true;
      for c in select value from jsonb_array_elements(ch) loop
        cp := public._path(c -> 'p'); idx := null;
        -- the entry this change belongs to: one whose path is the same, or a parent of it
        for e, i in select x.v, x.n::int from jsonb_array_elements(merged) with ordinality as x(v, n) loop
          ep := public._path(e -> 'p');
          if coalesce(array_length(ep, 1), 0) <= coalesce(array_length(cp, 1), 0) and cp[1:coalesce(array_length(ep, 1), 0)] = ep then
            idx := i; exit;
          end if;
        end loop;
        if idx is null then ok := false; exit; end if;
        e := merged -> (idx - 1);
        if array_length(ep, 1) = array_length(cp, 1) then
          e := case when c ? 'n' then jsonb_set(e, '{n}', c -> 'n', true) else e - 'n' end;
        elsif e ? 'n' and jsonb_typeof(e -> 'n') = 'object' then
          e := jsonb_set(e, '{n}', case when c ? 'n' then public._json_put(e -> 'n', cp[array_length(ep, 1) + 1:], c -> 'n')
                                        else (e -> 'n') #- cp[array_length(ep, 1) + 1:] end, true);
        else ok := false; exit;   -- something odd (e.g. inside a removed item): keep it separate
        end if;
        merged := jsonb_set(merged, array[(idx - 1)::text], e);
      end loop;
      if ok then
        -- drop anything that's back where it started
        select coalesce(jsonb_agg(x.v order by x.n), '[]'::jsonb) into merged
          from jsonb_array_elements(merged) with ordinality as x(v, n)
         where not ((x.v ? 'o') = (x.v ? 'n') and (not (x.v ? 'o') or x.v -> 'o' = x.v -> 'n'));
        if jsonb_array_length(merged) = 0 then
          delete from public.budget_changes where id = last.id;
          return jsonb_build_object('state', new_s, 'seq', new_seq, 'updated_at', at, 'updated_by', me, 'change_id', null);
        end if;
        update public.budget_changes set changes = merged, changed_at = at, seq = new_seq where id = last.id;
        return jsonb_build_object('state', new_s, 'seq', new_seq, 'updated_at', at, 'updated_by', me, 'change_id', last.id);
      end if;
    end if;
  end if;

  insert into public.budget_changes (household_id, changed_by, started_at, changed_at, seq, kind, reason, ref_id, ref_at, changes)
  values (p_household, me, at, at, new_seq, p_kind, coalesce(p_reason, ''), p_ref_id, p_ref_at, ch)
  returning id into change_id;
  return jsonb_build_object('state', new_s, 'seq', new_seq, 'updated_at', at, 'updated_by', me, 'change_id', change_id);
end $$;

/* Same as Part 2's apply_budget_ops, but the saving and history-writing is done by _save_budget.
   It now also returns change_id: the history entry this save went into (for the Undo button). */
create or replace function public.apply_budget_ops(p_household uuid, p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  old_s jsonb;
  o jsonb;
  p text[];
  my_role text;
  kind text := 'edit';
  why text := '';
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  my_role := public.member_role(p_household);
  if my_role is null then raise exception 'Not a member of this household'; end if;
  if my_role = 'viewer' then raise exception 'You have view-only access to this budget'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' then raise exception 'Changes must be a list'; end if;
  if jsonb_array_length(p_ops) > 5000 then raise exception 'Too many changes at once'; end if;

  select b.state into s from public.budgets b where b.household_id = p_household for update;
  if not found then raise exception 'This household has no budget yet'; end if;
  if jsonb_typeof(s) is distinct from 'object' then s := '{}'::jsonb; end if;
  old_s := s;

  for o in select value from jsonb_array_elements(p_ops) loop
    if o->>'op' = 'replace' then
      insert into public.budget_backups (household_id, state, reason, taken_by)
      values (p_household, s, coalesce(nullif(o->>'reason', ''), 'Replaced'), auth.uid());
      s := coalesce(o->'value', '{}'::jsonb);
      if jsonb_typeof(s) is distinct from 'object' then raise exception 'A budget must be an object'; end if;
      kind := 'replace'; why := coalesce(nullif(o->>'reason', ''), 'Replaced');
      continue;
    end if;

    if jsonb_typeof(o->'path') is distinct from 'array' or jsonb_array_length(o->'path') = 0 then
      raise exception 'Each change needs a path';
    end if;
    p := public._path(o->'path');

    if o->>'op' = 'set' then
      s := public._json_put(s, p, o->'value');
    elsif o->>'op' = 'del' then
      s := s #- p;
    else
      raise exception 'Unknown change type: %', o->>'op';
    end if;
  end loop;

  return public._save_budget(p_household, old_s, s, kind, why);
end $$;
revoke execute on function public.apply_budget_ops(uuid, jsonb) from public, anon;
grant execute on function public.apply_budget_ops(uuid, jsonb) to authenticated;

/** Undo one change (owners and editors). Anything someone has changed since is left alone and listed
    in "skipped", with who changed it. Returns the same as apply_budget_ops, plus skipped. */
create or replace function public.undo_budget_change(p_household uuid, p_change_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.budget_changes;
  s jsonb; old_s jsonb; c jsonb;
  skipped jsonb := '[]'::jsonb;
  res jsonb;
begin
  if coalesce(public.member_role(p_household), 'viewer') not in ('owner', 'editor') then
    raise exception 'Only owners and editors can undo changes';
  end if;
  select * into r from public.budget_changes where id = p_change_id and household_id = p_household;
  if not found then raise exception 'That change is no longer in the history'; end if;
  if r.undone_at is not null then raise exception 'That change has already been undone'; end if;

  select b.state into s from public.budgets b where b.household_id = p_household for update;
  old_s := s;
  for c in select x.v from jsonb_array_elements(r.changes) with ordinality as x(v, n) order by x.n desc loop
    if public._still_there(s, c) then
      s := public._invert(s, jsonb_build_array(c));
    else
      skipped := skipped || jsonb_build_array(jsonb_build_object('p', c -> 'p', 'by', (
        select l.changed_by from public.budget_changes l
         where l.household_id = p_household and l.id > r.id
           and exists (select 1 from jsonb_array_elements(l.changes) lc where public._paths_overlap(public._path(lc -> 'p'), public._path(c -> 'p')))
         order by l.id desc limit 1)));
    end if;
  end loop;

  res := public._save_budget(p_household, old_s, s, 'undo', '', r.id, r.changed_at);
  if res ->> 'change_id' is not null then
    update public.budget_changes set undone_at = now() where id = r.id;
  end if;
  return res || jsonb_build_object('skipped', skipped);
end $$;

/** Put the whole budget back to how it was right after an earlier change (owners and editors). */
create or replace function public.restore_budget_version(p_household uuid, p_change_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.budget_changes;
  s jsonb; target jsonb; x jsonb;
begin
  if coalesce(public.member_role(p_household), 'viewer') not in ('owner', 'editor') then
    raise exception 'Only owners and editors can restore an earlier version';
  end if;
  select * into r from public.budget_changes where id = p_change_id and household_id = p_household;
  if not found then raise exception 'That version is no longer in the history'; end if;

  select b.state into s from public.budgets b where b.household_id = p_household for update;
  target := s;
  -- step backwards through every later change
  for x in select l.changes from public.budget_changes l where l.household_id = p_household and l.id > r.id order by l.id desc loop
    target := public._invert(target, x);
  end loop;
  return public._save_budget(p_household, s, target, 'restore', '', r.id, r.changed_at);
end $$;

/** Run nightly: history older than 90 days goes, at most 5,000 changes and 20 backups per household. */
create or replace function public.prune_budget_history() returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_n int; cap_n int; bak_n int;
begin
  delete from public.budget_changes where changed_at < now() - interval '90 days';
  get diagnostics old_n = row_count;
  delete from public.budget_changes where id in (
    select id from (select id, row_number() over (partition by household_id order by id desc) as rn from public.budget_changes) x where x.rn > 5000);
  get diagnostics cap_n = row_count;
  delete from public.budget_backups where id in (
    select id from (select id, row_number() over (partition by household_id order by taken_at desc, id desc) as rn from public.budget_backups) x where x.rn > 20);
  get diagnostics bak_n = row_count;
  return jsonb_build_object('older_than_90_days', old_n, 'over_5000', cap_n, 'backups', bak_n);
end $$;

revoke execute on function public._json_put(jsonb, text[], jsonb), public._path(jsonb), public._paths_overlap(text[], text[]),
  public._jsonb_diff(jsonb, jsonb, text[]), public._invert(jsonb, jsonb), public._still_there(jsonb, jsonb),
  public._save_budget(uuid, jsonb, jsonb, text, text, bigint, timestamptz), public.prune_budget_history() from public, anon, authenticated;
revoke execute on function public.undo_budget_change(uuid, bigint), public.restore_budget_version(uuid, bigint) from public, anon;
grant execute on function public.undo_budget_change(uuid, bigint), public.restore_budget_version(uuid, bigint) to authenticated;

-- The nightly clean-up: 12:25 UTC is just after midnight in NZ (skipped where pg_cron isn't available).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'budget-history-cleanup') then
      perform cron.unschedule('budget-history-cleanup');
    end if;
    perform cron.schedule('budget-history-cleanup', '25 12 * * *', 'select public.prune_budget_history()');
  end if;
end $$;

-- Tidy up straight away (keeps the newest 20 backups per household).
select public.prune_budget_history();
