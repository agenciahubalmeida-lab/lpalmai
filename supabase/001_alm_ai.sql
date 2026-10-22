begin;

create table if not exists public.alm_ai_leads (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  protocolo text not null unique,
  nome text not null check (length(nome) between 2 and 100),
  empresa text not null check (length(empresa) between 1 and 160),
  whatsapp text not null check (whatsapp ~ '^55[1-9][0-9]{9,10}$'),
  instagram text not null default '',
  respostas jsonb not null,
  tier text not null check (tier in ('alto','medio','baixo')),
  team jsonb not null,
  utm jsonb not null default '{}',
  source_url text not null,
  referrer text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  notification_sent_at timestamptz,
  notification_attempts integer not null default 0,
  notification_next_at timestamptz not null default now(),
  notification_lock_until timestamptz,
  notification_error text
);
create index if not exists alm_ai_leads_recent on public.alm_ai_leads (created_at desc, id desc);
create index if not exists alm_ai_leads_notification_queue on public.alm_ai_leads (notification_next_at) where notification_sent_at is null;
alter table public.alm_ai_leads enable row level security;
revoke all on public.alm_ai_leads from public, anon, authenticated;
grant select,insert,update,delete on public.alm_ai_leads to service_role;

create table if not exists public.alm_ai_push_subscriptions (
  endpoint text primary key,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.alm_ai_push_subscriptions enable row level security;
revoke all on public.alm_ai_push_subscriptions from public, anon, authenticated;
grant select,insert,update,delete on public.alm_ai_push_subscriptions to service_role;

create table if not exists public.alm_ai_push_receipts (
  lead_id uuid not null references public.alm_ai_leads(id) on delete cascade,
  endpoint text not null references public.alm_ai_push_subscriptions(endpoint) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (lead_id, endpoint)
);
create index if not exists alm_ai_receipts_endpoint on public.alm_ai_push_receipts(endpoint);
alter table public.alm_ai_push_receipts enable row level security;
revoke all on public.alm_ai_push_receipts from public, anon, authenticated;
grant select,insert,delete on public.alm_ai_push_receipts to service_role;

create table if not exists public.alm_ai_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.alm_ai_rate_limits enable row level security;
revoke all on public.alm_ai_rate_limits from public, anon, authenticated;
grant select,insert,update,delete on public.alm_ai_rate_limits to service_role;

create or replace function public.alm_ai_allow_request(p_key text, p_limit integer default 8)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if length(p_key) > 100 or p_limit < 1 or p_limit > 100 then return false; end if;
  insert into public.alm_ai_rate_limits as r (key,window_start,attempts) values (p_key, now(), 1)
  on conflict (key) do update set
    attempts = case when r.window_start < now() - interval '10 minutes' then 1 else r.attempts + 1 end,
    window_start = case when r.window_start < now() - interval '10 minutes' then now() else r.window_start end
  returning attempts into count_now;
  delete from public.alm_ai_rate_limits where window_start < now() - interval '1 day';
  return count_now <= p_limit;
end;
$$;

create or replace function public.alm_ai_save_lead(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.alm_ai_leads;
begin
  insert into public.alm_ai_leads(id,submission_id,protocolo,nome,empresa,whatsapp,instagram,respostas,tier,team,utm,source_url,referrer)
  values ((p_lead->>'id')::uuid,(p_lead->>'submission_id')::uuid,p_lead->>'protocolo',p_lead->>'nome',p_lead->>'empresa',p_lead->>'whatsapp',p_lead->>'instagram',p_lead->'respostas',p_lead->>'tier',p_lead->'team',p_lead->'utm',p_lead->>'source_url',p_lead->>'referrer')
  on conflict (submission_id) do nothing;
  select * into saved from public.alm_ai_leads where submission_id = (p_lead->>'submission_id')::uuid;
  return jsonb_build_object('id',saved.id,'protocolo',saved.protocolo,'tier',saved.tier,'team',saved.team);
end;
$$;

create or replace function public.alm_ai_claim_notifications(p_limit integer default 5, p_lead_id uuid default null)
returns setof public.alm_ai_leads language sql security definer set search_path = '' as $$
  with pending as (
    select id from public.alm_ai_leads
    where notification_sent_at is null and notification_next_at <= now()
      and (notification_lock_until is null or notification_lock_until < now())
      and (p_lead_id is null or id = p_lead_id)
    order by created_at asc
    for update skip locked limit least(greatest(p_limit,1),5)
  )
  update public.alm_ai_leads l set notification_lock_until = now() + interval '2 minutes', notification_attempts = notification_attempts + 1
  from pending where l.id = pending.id returning l.*;
$$;

create or replace function public.alm_ai_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total',count(*),
    'unread',count(*) filter (where read_at is null),
    'qualified',count(*) filter (where tier in ('alto','medio')),
    'today',count(*) filter (where (created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date),
    'pendingNotifications',count(*) filter (where notification_sent_at is null)
  ) from public.alm_ai_leads;
$$;

revoke all on function public.alm_ai_allow_request(text,integer) from public, anon, authenticated;
revoke all on function public.alm_ai_save_lead(jsonb) from public, anon, authenticated;
revoke all on function public.alm_ai_claim_notifications(integer,uuid) from public, anon, authenticated;
revoke all on function public.alm_ai_stats() from public, anon, authenticated;
grant execute on function public.alm_ai_allow_request(text,integer) to service_role;
grant execute on function public.alm_ai_save_lead(jsonb) to service_role;
grant execute on function public.alm_ai_claim_notifications(integer,uuid) to service_role;
grant execute on function public.alm_ai_stats() to service_role;
notify pgrst, 'reload schema';
commit;
