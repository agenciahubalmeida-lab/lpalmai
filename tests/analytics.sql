begin;
-- Todas as alterações desta verificação são revertidas, sem afetar métricas reais.
update public.alm_ai_analytics_config set started_at=now()-interval '1 day' where id=true;
do $verify$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); pc uuid:=gen_random_uuid(); pd uuid:=gen_random_uuid(); pe uuid:=gen_random_uuid();
 event_id uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); report jsonb; baseline jsonb; payload jsonb; test_table text;
begin
 baseline:=public.alm_ai_analytics_report(0)->'summary';
 foreach test_table in array array['alm_ai_sessions','alm_ai_page_visits','alm_ai_analytics_events','alm_ai_analytics_config'] loop
   if not exists(select 1 from pg_class where oid=('public.'||test_table)::regclass and relrowsecurity) then raise exception 'RLS missing'; end if;
   if has_table_privilege('anon','public.'||test_table,'SELECT') or has_table_privilege('authenticated','public.'||test_table,'SELECT') then raise exception 'Public analytics access'; end if;
 end loop;
 if has_function_privilege('anon','public.alm_ai_analytics_report(integer)','EXECUTE') then raise exception 'Public report'; end if;
 payload:=jsonb_build_object('session_id',a,'page_id',pa,'visitor_hash','test-visitor-a','device','Celular','os','iOS','browser','Safari','active_seconds',30,'scroll_percent',75,'events',jsonb_build_array(jsonb_build_object('id',event_id,'name','form_error','step',1)));
 perform public.alm_ai_ingest_analytics(payload); perform public.alm_ai_ingest_analytics(payload);
 if (select form_errors from public.alm_ai_sessions where id=a)<>1 then raise exception 'Event dedup failed'; end if;
 payload:=jsonb_set(jsonb_set(payload,'{active_seconds}','5'),'{scroll_percent}','10'); perform public.alm_ai_ingest_analytics(payload);
 if (select active_seconds from public.alm_ai_page_visits where id=pa)<>30 or (select scroll_percent from public.alm_ai_page_visits where id=pa)<>75 then raise exception 'Cumulative snapshot failed'; end if;
 perform public.alm_ai_ingest_analytics(jsonb_build_object('session_id',b,'page_id',pb,'visitor_hash','test-visitor-b','device','Celular','os','Android','browser','Chrome','active_seconds',0,'scroll_percent',0,'events',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','question_answer','step',3))));
 perform public.alm_ai_ingest_analytics(jsonb_build_object('session_id',c,'page_id',pc,'visitor_hash','test-visitor-c','device','Computador','os','Windows','browser','Edge','active_seconds',60,'scroll_percent',100,'events',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','whatsapp_click'))));
 perform public.alm_ai_ingest_analytics(jsonb_build_object('session_id',d,'page_id',pd,'visitor_hash','test-visitor-d','device','Computador','os','Windows','browser','Edge','active_seconds',0,'scroll_percent',0,'is_test',true,'events',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','page_view'))));
 perform public.alm_ai_ingest_analytics(jsonb_build_object('session_id',e,'page_id',pe,'visitor_hash','test-visitor-a','device','Celular','os','iOS','browser','Safari','active_seconds',0,'scroll_percent',0,'events',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','page_view'))));
 insert into public.alm_ai_leads(id,submission_id,protocolo,nome,empresa,whatsapp,respostas,tier,team,source_url) values(lead,gen_random_uuid(),'TEST-'||lead,'Analytics Test','Test','5511900000000','{}','alto','["sdr"]','https://example.test');
 perform public.alm_ai_link_analytics(c,'wrong-visitor',lead);
 if (select lead_id from public.alm_ai_sessions where id=c) is not null then raise exception 'Visitor binding failed'; end if;
 perform public.alm_ai_link_analytics(c,'test-visitor-c',lead);
 update public.alm_ai_sessions set started_at=now()-interval '40 minutes',last_seen=now()-interval '31 minutes' where id in(a,b,c);
 report:=public.alm_ai_analytics_report(0);
 if (report->'summary'->>'sessions')::int<>(baseline->>'sessions')::int+4 then raise exception 'Session/test exclusion count failed: %',report->'summary'; end if;
 if (report->'summary'->>'visitors')::int<>(baseline->>'visitors')::int+3 then raise exception 'Unique visitor count failed'; end if;
 if (report->'summary'->>'untouched')::int<>(baseline->>'untouched')::int+1 then raise exception 'Untouched failed'; end if;
 if (report->'summary'->>'abandoned')::int<>(baseline->>'abandoned')::int+1 then raise exception 'Abandon failed'; end if;
 if (report->'summary'->>'notConverted')::int<>(baseline->>'notConverted')::int+2 then raise exception 'Unconverted failed'; end if;
 if (report->'summary'->>'conversions')::int<>(baseline->>'conversions')::int+1 then raise exception 'Conversion failed'; end if;
 if (report->'summary'->>'pageviews')::int<>(baseline->>'pageviews')::int+4 then raise exception 'Page dedup failed'; end if;
end; $verify$;
rollback;
