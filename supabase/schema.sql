-- Change My Name UK: customer progress database (Supabase, London region)
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- It is safe to run again: it only creates what is missing and replaces policies,
-- functions and views.
--
-- What it holds
--   profiles       one row per customer (created automatically at first sign-in)
--   checklists     the customer's checklist answers (the /check/ questionnaire)
--   progress       one row per customer per organisation or step: status, date, how confirmed
--   events         a history of every change, for onboarding and the future guide assistant
--   organisations  the organisation catalogue (ids match scan/catalogue.json), with
--                  room for how each change is made, for the future guide assistant
--   admins         who can see every customer (Avi). Added by hand, never from the website.
--
-- Security: row level security is on for every table. A customer can only read and
-- write their own rows. Admins can read everything. Nobody can make themselves an admin
-- from the website. The website only ever uses the public (publishable / anon) key.

-- ---------------------------------------------------------------------------
-- Admins and the is_admin() helper
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admins see admins" on public.admins;
create policy "admins see admins" on public.admins
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policy: admins are added in the SQL editor only.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  first_name    text,
  reason        text check (reason in ('marriage', 'divorce', 'other')),
  nation        text check (nation in ('england', 'wales', 'scotland', 'ni')),
  event_date    date,          -- wedding, civil partnership or divorce date, if given
  old_surname   text,
  new_surname   text,
  -- Where the customer is up to. Set by the website, editable by admins.
  stage         text not null default 'signed_up'
                check (stage in ('signed_up', 'checklist', 'scanned', 'in_progress', 'finished', 'paused')),
  notes         text,          -- admin notes (customers can't read this column's changes back as theirs)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
alter table public.profiles enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Create the profile row as soon as someone signs in for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.events (user_id, kind) values (new.id, 'signed_up');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisation catalogue (ids match scan/catalogue.json)
-- ---------------------------------------------------------------------------
create table if not exists public.organisations (
  id              text primary key,
  name            text not null,
  category        text,
  phase           smallint,           -- 1 identity ... 5 online, shopping and travel
  domains         text[] not null default '{}',
  -- For the guide assistant (filled from the private name change database later):
  who_does_it     text not null default 'customer'
                  check (who_does_it in ('customer', 'us', 'either')),  -- can we do it for them?
  methods         text[] not null default '{}',   -- online, app, email, post, branch, phone, form
  proof_needed    text,                           -- e.g. 'certificate (original or certified copy)'
  needs_first     text[] not null default '{}',   -- org ids to do first (e.g. hm-passport-office)
  how_to_url      text,                           -- the organisation's own instructions page
  guide           jsonb,                          -- step-by-step guidance for the assistant
  verified_on     date,
  updated_at      timestamptz not null default now()
);
alter table public.organisations enable row level security;

drop policy if exists "catalogue is public" on public.organisations;
create policy "catalogue is public" on public.organisations
  for select to anon, authenticated using (true);
drop policy if exists "admins edit catalogue" on public.organisations;
create policy "admins edit catalogue" on public.organisations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Checklist answers (one row per customer)
-- ---------------------------------------------------------------------------
create table if not exists public.checklists (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  answers     jsonb not null,
  item_count  integer,
  updated_at  timestamptz not null default now()
);
alter table public.checklists enable row level security;

drop policy if exists "own checklist" on public.checklists;
create policy "own checklist" on public.checklists
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admins read checklists" on public.checklists;
create policy "admins read checklists" on public.checklists
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Progress: one row per customer per organisation (or checklist step)
-- ---------------------------------------------------------------------------
-- item_key is how the website names the item:
--   checklist steps use their checklist id (e.g. 'passport', 'bank-hsbc', 'energy')
--   scanner organisations use the catalogue id (e.g. 'hm-passport-office', 'monzo')
--   organisations the scanner found outside the catalogue use 'x-<domain>' (org_id is null)
-- org_id links to the catalogue when we know the organisation, so the same
-- organisation found by the checklist and the scanner can be shown together.
create table if not exists public.progress (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  item_key       text not null,
  org_id         text,                         -- catalogue id when known (not enforced, so a new
                                                -- scanner organisation never blocks saving)
  title          text not null,               -- what the customer saw, e.g. 'HSBC'
  source         text not null check (source in ('checklist', 'scanner', 'admin')),
  phase          smallint,
  status         text not null default 'to_do'
                 check (status in ('to_do', 'asked', 'done', 'confirmed', 'not_needed')),
  status_on      timestamptz not null default now(),  -- when the status last changed
  asked_on       timestamptz,
  -- How it was confirmed:
  --   ticked              the customer ticked it or pressed "Mark as done"
  --   confirmation_email  the scanner found the organisation's confirmation email
  --   new_name_in_email   the scanner saw the organisation's latest email use the new name
  --   reply_from_org      the organisation told us directly
  --   staff               we confirmed it (admin)
  confirmed_how  text check (confirmed_how in ('ticked', 'confirmation_email', 'new_name_in_email', 'reply_from_org', 'staff')),
  name_in_use    text check (name_in_use in ('old', 'new', 'unknown')),  -- scanner: name in their latest email
  -- For the guide assistant (not used by the website yet):
  next_step      text,
  blocked_reason text,
  remind_on      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, item_key)
);
create index if not exists progress_user_idx on public.progress (user_id);
create index if not exists progress_org_idx on public.progress (org_id);
alter table public.progress enable row level security;

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admins manage progress" on public.progress;
create policy "admins manage progress" on public.progress
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Events: history of changes (written by triggers, never edited)
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_key    text,
  kind        text not null,      -- signed_up, status_changed, checklist_saved, ...
  from_status text,
  to_status   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_user_idx on public.events (user_id, created_at desc);
alter table public.events enable row level security;

drop policy if exists "own events read" on public.events;
create policy "own events read" on public.events
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- No insert policy: only the security-definer triggers below write events.

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.progress_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Keep a date the website sent (e.g. the date of a confirmation email), else now.
    if new.status_on is not distinct from old.status_on then new.status_on := now(); end if;
  end if;
  if new.status in ('to_do', 'asked', 'not_needed') then new.confirmed_how := null; end if;
  -- A customer can't claim a confirmation method only staff can set.
  if not public.is_admin() and new.confirmed_how in ('reply_from_org', 'staff')
     and (tg_op = 'INSERT' or new.confirmed_how is distinct from old.confirmed_how) then
    new.confirmed_how := 'ticked';
  end if;
  return new;
end;
$$;

create or replace function public.progress_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'to_do' then
      insert into events (user_id, item_key, kind, to_status, detail)
      values (new.user_id, new.item_key, 'status_changed', new.status,
              jsonb_build_object('how', new.confirmed_how, 'source', new.source));
    end if;
  elsif new.status is distinct from old.status then
    insert into events (user_id, item_key, kind, from_status, to_status, detail)
    values (new.user_id, new.item_key, 'status_changed', old.status, new.status,
            jsonb_build_object('how', new.confirmed_how, 'source', new.source, 'by_admin', public.is_admin()));
  end if;
  update profiles set last_seen_at = now(),
    stage = case when stage in ('signed_up', 'checklist', 'scanned') and new.status <> 'to_do' then 'in_progress' else stage end
  where id = new.user_id and not public.is_admin();
  return null;
end;
$$;

create or replace function public.checklist_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into events (user_id, kind, detail)
  values (new.user_id, 'checklist_saved', jsonb_build_object('items', new.item_count));
  update profiles set
    reason = coalesce(nullif(new.answers ->> 'reason', ''), reason),
    nation = coalesce(nullif(new.answers ->> 'nation', ''), nation),
    event_date = coalesce(case when (new.answers ->> 'wedding') ~ '^\d{4}-\d{2}-\d{2}$'
                               then (new.answers ->> 'wedding')::date end, event_date),
    stage = case when stage = 'signed_up' then 'checklist' else stage end,
    last_seen_at = now()
  where id = new.user_id;
  return null;
end;
$$;

-- Customers may not change their own admin notes or stage directly.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if not public.is_admin() and current_user = 'authenticated' then
    new.notes := old.notes;
    if new.stage is distinct from old.stage and new.stage not in ('checklist', 'scanned', 'in_progress') then
      new.stage := old.stage;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists progress_before on public.progress;
create trigger progress_before before insert or update on public.progress
  for each row execute function public.progress_before();
drop trigger if exists progress_after on public.progress;
create trigger progress_after after insert or update on public.progress
  for each row execute function public.progress_after();

drop trigger if exists checklist_touch on public.checklists;
create trigger checklist_touch before update on public.checklists
  for each row execute function public.touch_updated_at();
drop trigger if exists checklist_after on public.checklists;
create trigger checklist_after after insert or update of answers on public.checklists
  for each row execute function public.checklist_after();

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

drop trigger if exists organisations_touch on public.organisations;
create trigger organisations_touch before update on public.organisations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Admin view: one line per customer
-- ---------------------------------------------------------------------------
create or replace view public.customer_overview
with (security_invoker = true) as
select
  p.id, p.email, p.first_name, p.reason, p.nation, p.event_date, p.stage,
  p.created_at, p.last_seen_at, p.notes,
  count(g.id)                                              as items,
  count(g.id) filter (where g.status = 'to_do')            as to_do,
  count(g.id) filter (where g.status = 'asked')            as asked,
  count(g.id) filter (where g.status = 'done')             as done,
  count(g.id) filter (where g.status = 'confirmed')        as confirmed,
  count(g.id) filter (where g.source = 'scanner')          as from_scanner,
  max(g.updated_at)                                        as last_change
from public.profiles p
left join public.progress g on g.user_id = p.id and g.status <> 'not_needed'
group by p.id;

grant select on public.customer_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Table permissions for the website's signed-in visitors
-- ---------------------------------------------------------------------------
-- Newer Supabase projects don't give these automatically. Row level security
-- above still decides which rows each person can see or change.
grant usage on schema public to anon, authenticated;
grant select on public.admins to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.checklists to authenticated;
grant select, insert, update on public.progress to authenticated;
grant select on public.events to authenticated;
grant select on public.organisations to anon, authenticated;
grant insert, update, delete on public.organisations to authenticated;
grant select on public.customer_overview to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to authenticated;
