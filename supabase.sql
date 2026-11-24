-- Выполнить один раз в Supabase: SQL Editor → New query → вставить → Run.
-- Доступ только у вошедших пользователей (вы двое). Регистрацию в Supabase
-- после создания двух аккаунтов отключить: Authentication → Sign In / Providers → Allow new users to sign up = off.

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

alter table public.days enable row level security;
alter table public.settings enable row level security;

drop policy if exists "team only" on public.days;
drop policy if exists "team only" on public.settings;
create policy "team only" on public.days     for all to authenticated using (true) with check (true);
create policy "team only" on public.settings for all to authenticated using (true) with check (true);
