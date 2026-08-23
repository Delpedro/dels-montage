create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create table if not exists public.rest_alerts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token text not null,
  due_at timestamptz not null,
  exercise text,
  updated_at timestamptz not null default now()
);

alter table public.rest_alerts enable row level security;

drop policy if exists rest_alerts_select_own on public.rest_alerts;
create policy rest_alerts_select_own on public.rest_alerts
  for select using (auth.uid() = user_id);

drop policy if exists rest_alerts_insert_own on public.rest_alerts;
create policy rest_alerts_insert_own on public.rest_alerts
  for insert with check (auth.uid() = user_id);

drop policy if exists rest_alerts_update_own on public.rest_alerts;
create policy rest_alerts_update_own on public.rest_alerts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists rest_alerts_delete_own on public.rest_alerts;
create policy rest_alerts_delete_own on public.rest_alerts
  for delete using (auth.uid() = user_id);
