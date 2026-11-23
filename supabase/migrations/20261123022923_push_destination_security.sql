-- H1: private destination parsing, ownership and rolling limits for Web Push.
-- Existing rows are preserved, including unsupported legacy destinations.

create schema if not exists push_private;
revoke all on schema push_private from public, anon, authenticated;

-- These expressions are checked against send-reminders/push-policy.js by tests.
create or replace function push_private.endpoint(p_endpoint text)
returns text language plpgsql immutable strict set search_path = pg_catalog as $parse$
declare
  parts text[];
  host text;
  route text;
begin
  if length(p_endpoint) >= 1000 then return null; end if;
  parts := regexp_match(p_endpoint collate "C", $endpoint$^https://([A-Za-z0-9.-]+)(?::443)?(/[A-Za-z0-9._~!$&()*+,;=:@%/?-]+)$$endpoint$);
  if parts is null then return null; end if;
  host := lower(parts[1] collate "C");
  route := replace(replace(replace(parts[2], '%2f', '%2F'), '%2b', '%2B'), '%3d', '%3D');
  if (host || route) collate "C" !~ $provider$^(fcm[.]googleapis[.]com/(wp|fcm/send)/[A-Za-z0-9._~:+-]+|updates[.]push[.]services[.]mozilla[.]com/wpush/v[12]/[A-Za-z0-9._~-]+|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.]push[.]apple[.]com/[A-Za-z0-9._~/-]+|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.]notify[.]windows[.]com/([A-Za-z0-9._~/-]*[?]token=([A-Za-z0-9._~-]|%2[Ff]|%2[Bb]|%3[Dd])+))$$provider$
     or split_part(route, '?', 1) ~ '(^|/)[.]{1,2}(/|$)' then
    return null;
  end if;
  return 'https://' || host || route;
end $parse$;

create or replace function push_private.endpoint_key(p_endpoint text)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select replace(push_private.endpoint(p_endpoint), 'https://fcm.googleapis.com/fcm/send/', 'https://fcm.googleapis.com/wp/')
$$;

-- Non-unique so historical aliases can be reviewed without deleting any rows.
create index if not exists push_subscriptions_canonical_idx
  on public.push_subscriptions (push_private.endpoint_key(endpoint));

create or replace function push_private.valid_keys(p_point text, p_auth text)
returns boolean language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  point bytea;
  secret bytea;
  x numeric := 0;
  y numeric := 0;
  prime constant numeric := 115792089210356248762697446949407573530086143415290314195533631308867097853951;
  curve_b constant numeric := 41058363725152142129326129780047268409114441015993725554835256314039467401291;
begin
  if length(p_point) <> 87 or p_point collate "C" !~ '^[A-Za-z0-9_-]+$'
     or length(p_auth) <> 22 or p_auth collate "C" !~ '^[A-Za-z0-9_-]+$' then
    return false;
  end if;
  point := decode(translate(p_point, '-_', '+/') || '=', 'base64');
  secret := decode(translate(p_auth, '-_', '+/') || '==', 'base64');
  if length(point) <> 65 or get_byte(point, 0) <> 4 or length(secret) <> 16
     or rtrim(translate(encode(point, 'base64'), E'+/\n', '-_'), '=') <> p_point
     or rtrim(translate(encode(secret, 'base64'), '+/', '-_'), '=') <> p_auth then
    return false;
  end if;
  for i in 1..32 loop
    x := x * 256 + get_byte(point, i);
    y := y * 256 + get_byte(point, i + 32);
  end loop;
  -- RFC 8291 uses an uncompressed P-256 point. Check the affine curve equation.
  return x < prime and y < prime and mod(y*y - x*x*x + 3*x - curve_b, prime) = 0;
end $$;

create table if not exists push_private.rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  registrations timestamptz[] not null default '{}',
  tests timestamptz[] not null default '{}'
);
alter table push_private.rate_limits enable row level security;
revoke all on push_private.rate_limits from public, anon, authenticated;

-- Called only behind the account lock held by each public RPC.
create or replace function push_private.consume(p_user uuid, p_test boolean)
returns void language plpgsql set search_path = pg_catalog as $$
declare
  at_time timestamptz := clock_timestamp();
  recent timestamptz[];
begin
  insert into push_private.rate_limits (user_id) values (p_user) on conflict do nothing;
  select array(select t from unnest(case when p_test then r.tests else r.registrations end) t
               where t > at_time - interval '1 hour')
    into recent from push_private.rate_limits r where r.user_id = p_user;
  if p_test then
    if cardinality(recent) >= 5 or exists (select 1 from unnest(recent) t where t > at_time - interval '1 minute') then
      raise sqlstate 'PT429' using message = 'Test limit reached. Wait a minute, or try again later.';
    end if;
    update push_private.rate_limits set tests = array_append(recent, at_time) where user_id = p_user;
  else
    if cardinality(recent) >= 20 then
      raise sqlstate 'PT429' using message = 'Device registration limit reached. Try again later.';
    end if;
    update push_private.rate_limits set registrations = array_append(recent, at_time) where user_id = p_user;
  end if;
end $$;

revoke all on all functions in schema push_private from public, anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns bigint language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  destination text;
  canonical_key text;
  existing public.push_subscriptions;
  saved_id bigint;
begin
  if actor is null then raise sqlstate 'PT401' using message = 'Not signed in'; end if;
  perform pg_advisory_xact_lock(72401, hashtext(actor::text));
  destination := push_private.endpoint(p_endpoint);
  if destination is null then
    raise sqlstate 'PT422' using message = 'This push provider isn’t supported on this device.';
  end if;
  if length(coalesce(p_label, '')) > 60 or not coalesce(push_private.valid_keys(p_p256dh, p_auth), false) then
    raise sqlstate 'PT400' using message = 'This device’s notification details are invalid. Turn notifications off and on again.';
  end if;

  canonical_key := push_private.endpoint_key(destination);
  perform pg_advisory_xact_lock(72402, hashtext(canonical_key));
  if exists (
    select 1 from public.push_subscriptions
      where push_private.endpoint_key(endpoint) = canonical_key and user_id <> actor
  ) then
    raise sqlstate 'PT409' using message = 'Turn notifications off on this device, then enable them again.';
  end if;
  select * into existing from public.push_subscriptions
    where push_private.endpoint_key(endpoint) = canonical_key and user_id = actor
    order by (endpoint = destination) desc, id limit 1 for update;
  if existing.id is not null then
    if (existing.p256dh, existing.auth, existing.label) is not distinct from (p_p256dh, p_auth, coalesce(p_label, '')) then
      return existing.id;
    end if;
    perform push_private.consume(actor, false);
    update public.push_subscriptions set p256dh = p_p256dh, auth = p_auth, label = coalesce(p_label, '')
      where id = existing.id and user_id = actor returning id into saved_id;
    return saved_id;
  end if;
  if (select count(*) from public.push_subscriptions where user_id = actor) >= 10 then
    raise sqlstate 'PT422' using message = 'You have 10 registered devices. Remove one before adding another.';
  end if;
  perform push_private.consume(actor, false);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (actor, destination, p_p256dh, p_auth, coalesce(p_label, ''))
  on conflict (endpoint) do nothing returning id into saved_id;
  if saved_id is null then
    raise sqlstate 'PT409' using message = 'Turn notifications off on this device, then enable them again.';
  end if;
  return saved_id;
end $$;

create or replace function public.forget_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  canonical_key text := push_private.endpoint_key(p_endpoint);
begin
  if actor is null then raise sqlstate 'PT401' using message = 'Not signed in'; end if;
  perform pg_advisory_xact_lock(72401, hashtext(actor::text));
  if canonical_key is not null then
    perform pg_advisory_xact_lock(72402, hashtext(canonical_key));
  end if;
  delete from public.push_subscriptions where user_id = actor
    and (endpoint = p_endpoint or push_private.endpoint_key(endpoint) = canonical_key);
end $$;

create or replace function public.push_test_targets() returns setof public.push_subscriptions
language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise sqlstate 'PT401' using message = 'Not signed in'; end if;
  perform pg_advisory_xact_lock(72401, hashtext(actor::text));
  if exists (select 1 from public.push_subscriptions where user_id = actor and last_test_at > clock_timestamp() - interval '1 minute') then
    raise sqlstate 'PT429' using message = 'Test limit reached. Wait a minute, or try again later.';
  end if;
  perform push_private.consume(actor, true);
  return query update public.push_subscriptions set last_test_at = clock_timestamp() where user_id = actor returning *;
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.forget_push_subscription(text),
  public.push_test_targets() from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.forget_push_subscription(text),
  public.push_test_targets() to authenticated;
