begin;
create table if not exists public.alm_ai_analytics_config (id boolean primary key default true check(id), started_at timestamptz not null default now());
insert into public.alm_ai_analytics_config(id) values(true) on conflict do nothing;
create table if not exists public.alm_ai_sessions (
 id uuid primary key, visitor_hash text not null, started_at timestamptz not null default now(), last_seen timestamptz not null default now(),
 device text not null, os text not null, browser text not null, referrer_host text not null default '', utm jsonb not null default '{}',
 is_test boolean not null default false, quiz_view boolean not null default false, quiz_started boolean not null default false,
 contact_started boolean not null default false, max_step integer not null default 0, answered_steps integer[] not null default '{}',
 cta_clicked boolean not null default false, whatsapp_clicked boolean not null default false,
 form_errors integer not null default 0, submit_errors integer not null default 0,
 lead_id uuid references public.alm_ai_leads(id) on delete set null
);
create index if not exists alm_ai_sessions_started on public.alm_ai_sessions(started_at desc);
create index if not exists alm_ai_sessions_visitor on public.alm_ai_sessions(visitor_hash,started_at);
create table if not exists public.alm_ai_page_visits (
 id uuid primary key, session_id uuid not null references public.alm_ai_sessions(id) on delete cascade,
 active_seconds integer not null default 0, scroll_percent integer not null default 0
);
create index if not exists alm_ai_page_visits_session on public.alm_ai_page_visits(session_id);
create table if not exists public.alm_ai_analytics_events (
 id uuid primary key, session_id uuid not null references public.alm_ai_sessions(id) on delete cascade,
 page_id uuid not null references public.alm_ai_page_visits(id) on delete cascade, name text not null,
 step integer not null default 0, label text not null default '', created_at timestamptz not null default now()
);
create index if not exists alm_ai_analytics_events_session on public.alm_ai_analytics_events(session_id,name);
alter table public.alm_ai_analytics_config enable row level security;
alter table public.alm_ai_sessions enable row level security;
alter table public.alm_ai_page_visits enable row level security;
alter table public.alm_ai_analytics_events enable row level security;
revoke all on public.alm_ai_analytics_config,public.alm_ai_sessions,public.alm_ai_page_visits,public.alm_ai_analytics_events from public,anon,authenticated;
grant select,insert,update,delete on public.alm_ai_analytics_config,public.alm_ai_sessions,public.alm_ai_page_visits,public.alm_ai_analytics_events to service_role;

create or replace function public.alm_ai_ingest_analytics(p jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid := (p->>'session_id')::uuid; pid uuid := (p->>'page_id')::uuid; e jsonb; accepted integer;
begin
 insert into public.alm_ai_sessions(id,visitor_hash,device,os,browser,referrer_host,utm,is_test)
 values(sid,p->>'visitor_hash',p->>'device',p->>'os',p->>'browser',coalesce(p->>'referrer_host',''),coalesce(p->'utm','{}'),coalesce((p->>'is_test')::boolean,false)) on conflict do nothing;
 if not exists(select 1 from public.alm_ai_sessions where id=sid and visitor_hash=p->>'visitor_hash') then return; end if;
 insert into public.alm_ai_page_visits(id,session_id,active_seconds,scroll_percent)
 values(pid,sid,least(14400,greatest(0,(p->>'active_seconds')::integer)),least(100,greatest(0,(p->>'scroll_percent')::integer)))
 on conflict(id) do update set active_seconds=greatest(alm_ai_page_visits.active_seconds,excluded.active_seconds),scroll_percent=greatest(alm_ai_page_visits.scroll_percent,excluded.scroll_percent)
 where alm_ai_page_visits.session_id=sid;
 if not exists(select 1 from public.alm_ai_page_visits where id=pid and session_id=sid) then return; end if;
 update public.alm_ai_sessions set last_seen=now() where id=sid;
 for e in select value from jsonb_array_elements(p->'events') loop
   insert into public.alm_ai_analytics_events(id,session_id,page_id,name,step,label)
   values((e->>'id')::uuid,sid,pid,e->>'name',coalesce((e->>'step')::integer,0),coalesce(e->>'label','')) on conflict do nothing;
   get diagnostics accepted = row_count;
   if accepted=0 then continue; end if;
   update public.alm_ai_sessions set
     quiz_view=quiz_view or e->>'name' in ('quiz_view','quiz_start','question_answer','step_view'),
     quiz_started=quiz_started or e->>'name' in ('quiz_start','question_answer','contact_input'),
     contact_started=contact_started or e->>'name'='contact_input',
     max_step=greatest(max_step,coalesce((e->>'step')::integer,0)),
     answered_steps=case when e->>'name'='question_answer' and not(coalesce((e->>'step')::integer,0)=any(answered_steps)) then array_append(answered_steps,(e->>'step')::integer) else answered_steps end,
     cta_clicked=cta_clicked or e->>'name'='cta_click',whatsapp_clicked=whatsapp_clicked or e->>'name'='whatsapp_click',
     form_errors=form_errors+case when e->>'name'='form_error' then 1 else 0 end,
     submit_errors=submit_errors+case when e->>'name'='submit_error' then 1 else 0 end
   where id=sid;
 end loop;
end; $$;

create or replace function public.alm_ai_link_analytics(p_session uuid,p_visitor text,p_lead uuid)
returns void language sql security definer set search_path='' as $$
 update public.alm_ai_sessions set lead_id=p_lead,quiz_view=true,quiz_started=true,contact_started=true,max_step=7,last_seen=now()
 where id=p_session and visitor_hash=p_visitor and exists(select 1 from public.alm_ai_leads where id=p_lead);
$$;

create or replace function public.alm_ai_analytics_report(p_days integer default 7)
returns jsonb language sql stable security definer set search_path='' as $$
with settings as (
 select started_at,case when p_days=0 then started_at else greatest(started_at,((now() at time zone 'America/Sao_Paulo')::date-(greatest(p_days,1)-1))::timestamp at time zone 'America/Sao_Paulo') end as since
 from public.alm_ai_analytics_config where id=true
), sessions as (
 select s.*,coalesce(p.active_seconds,0) active_seconds,coalesce(p.scroll_percent,0) scroll_percent,coalesce(p.pageviews,0) pageviews,
 s.last_seen < now()-interval '30 minutes' as ended,
 exists(select 1 from public.alm_ai_sessions old where old.visitor_hash=s.visitor_hash and old.started_at<s.started_at and not old.is_test) as is_returning
 from public.alm_ai_sessions s cross join settings cfg
 left join lateral(select sum(v.active_seconds) active_seconds,max(v.scroll_percent) scroll_percent,count(*) pageviews from public.alm_ai_page_visits v where v.session_id=s.id) p on true
 where not s.is_test and s.started_at>=cfg.since
), sources as (
 select coalesce(nullif(utm->>'utm_source',''),nullif(referrer_host,''),'Direto / não identificado') label,count(*) sessions,count(distinct visitor_hash) visitors,count(*) filter(where lead_id is not null) leads,count(*) filter(where whatsapp_clicked) whatsapp
 from sessions group by 1 order by 2 desc limit 15
), campaigns as (
 select coalesce(nullif(utm->>'utm_campaign',''),'Sem campanha identificada') label,coalesce(nullif(utm->>'utm_source',''),nullif(referrer_host,''),'Direto') source,coalesce(utm->>'utm_content','') content,
 count(*) sessions,count(*) filter(where quiz_started) started,count(*) filter(where lead_id is not null) leads,count(*) filter(where whatsapp_clicked) whatsapp
 from sessions group by 1,2,3 order by 4 desc limit 20
), device_groups as (
 select device label,count(*) sessions,count(*) filter(where lead_id is not null) leads from sessions group by 1 order by 2 desc
), daily as (
 select (started_at at time zone 'America/Sao_Paulo')::date as day,count(*) sessions,count(distinct visitor_hash) visitors,count(*) filter(where lead_id is not null) leads,count(*) filter(where whatsapp_clicked) whatsapp
 from sessions group by 1 order by 1
), steps as (
 select n step,(select count(*) from sessions where max_step>=n or lead_id is not null) reached,
 (select count(*) from sessions where n=any(answered_steps) or n=7 and contact_started or lead_id is not null) answered,
 (select count(*) from sessions where ended and lead_id is null and max_step=n and quiz_started) abandoned
 from generate_series(1,7) n
), scrolls as (
 select n percent,(select count(*) from sessions where scroll_percent>=n) sessions from unnest(array[25,50,75,90,100]) n
), ctas as (
 select e.label,count(distinct e.session_id) sessions from public.alm_ai_analytics_events e join sessions s on s.id=e.session_id where e.name='cta_click' group by 1 order by 2 desc
), recent as (
 select id,started_at,last_seen,device,os,browser,coalesce(nullif(utm->>'utm_source',''),nullif(referrer_host,''),'Direto') source,max_step,active_seconds,scroll_percent,ended,
 case when lead_id is not null and whatsapp_clicked then 'whatsapp' when lead_id is not null then 'converted' when not ended then 'active' when not quiz_started then 'untouched' else 'abandoned' end status
 from sessions order by started_at desc limit 20
)
select jsonb_build_object(
 'startedAt',(select started_at from settings),'since',(select since from settings),'days',p_days,'generatedAt',now(),
 'summary',(select jsonb_build_object(
 'visitors',count(distinct visitor_hash),'sessions',count(*),'pageviews',coalesce(sum(pageviews),0),
 'returningSessions',count(*) filter(where is_returning),'activeSessions',count(*) filter(where not ended),
 'online',count(*) filter(where last_seen>=now()-interval '2 minutes'),
 'untouched',count(*) filter(where ended and not quiz_started and lead_id is null),
 'notConverted',count(*) filter(where ended and lead_id is null),
 'abandoned',count(*) filter(where ended and quiz_started and lead_id is null),
 'quizViewed',count(*) filter(where quiz_view),'quizStarted',count(*) filter(where quiz_started),
 'contactStarted',count(*) filter(where contact_started),'conversions',count(*) filter(where lead_id is not null),
 'whatsapp',count(*) filter(where whatsapp_clicked),'cta',count(*) filter(where cta_clicked),
 'formErrors',coalesce(sum(form_errors),0),'submitErrors',coalesce(sum(submit_errors),0),
 'avgActiveSeconds',coalesce(round(avg(active_seconds)),0),'engaged',count(*) filter(where active_seconds>=10 or quiz_started or lead_id is not null)
 ) from sessions),
 'sources',coalesce((select jsonb_agg(to_jsonb(x)) from sources x),'[]'),
 'campaigns',coalesce((select jsonb_agg(to_jsonb(x)) from campaigns x),'[]'),
 'devices',coalesce((select jsonb_agg(to_jsonb(x)) from device_groups x),'[]'),
 'daily',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'),
 'steps',coalesce((select jsonb_agg(to_jsonb(x)) from steps x),'[]'),
 'scroll',coalesce((select jsonb_agg(to_jsonb(x)) from scrolls x),'[]'),
 'ctas',coalesce((select jsonb_agg(to_jsonb(x)) from ctas x),'[]'),
 'recent',coalesce((select jsonb_agg(to_jsonb(x)) from recent x),'[]')
);
$$;
revoke all on function public.alm_ai_ingest_analytics(jsonb),public.alm_ai_link_analytics(uuid,text,uuid),public.alm_ai_analytics_report(integer) from public,anon,authenticated;
grant execute on function public.alm_ai_ingest_analytics(jsonb),public.alm_ai_link_analytics(uuid,text,uuid),public.alm_ai_analytics_report(integer) to service_role;
notify pgrst,'reload schema';
commit;
