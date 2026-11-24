-- Выполнить один раз в Supabase: SQL Editor → New query → вставить всё → Run.
-- Доступ только у вошедших по почте и паролю. Пользователей создать в
-- Authentication → Users → Add user (Auto Confirm User), затем отключить регистрацию:
-- Authentication → Sign In / Providers → Allow new users to sign up = off.

create table if not exists public.days (
  date        date primary key,
  data        jsonb not null,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.settings (
  id          int primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.log (
  id    text primary key,
  at    timestamptz not null default now(),
  by    text,
  text  text not null
);

alter table public.days     enable row level security;
alter table public.settings enable row level security;
alter table public.log      enable row level security;

drop policy if exists "team only" on public.days;
drop policy if exists "team only" on public.settings;
drop policy if exists "open" on public.days;
drop policy if exists "open" on public.settings;
drop policy if exists "open" on public.log;
create policy "open" on public.days     for all to authenticated using (true) with check (true);
create policy "open" on public.settings for all to authenticated using (true) with check (true);
create policy "open" on public.log      for all to authenticated using (true) with check (true);
