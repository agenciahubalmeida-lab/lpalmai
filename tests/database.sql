begin;
do $verify$
declare
  test_id uuid := gen_random_uuid();
  submission uuid := gen_random_uuid();
  bucket text := 'verify:' || gen_random_uuid()::text;
  value jsonb;
  again jsonb;
  claims integer;
  table_name text;
begin
  foreach table_name in array array['alm_ai_leads','alm_ai_push_subscriptions','alm_ai_push_receipts','alm_ai_rate_limits'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relname=table_name and c.relrowsecurity) then raise exception 'RLS missing: %',table_name; end if;
    if has_table_privilege('anon','public.'||table_name,'SELECT') or has_table_privilege('authenticated','public.'||table_name,'SELECT') then raise exception 'Public access: %',table_name; end if;
  end loop;
  if has_function_privilege('anon','public.alm_ai_stats()','EXECUTE') then raise exception 'Public RPC'; end if;
  value := public.alm_ai_save_lead(jsonb_build_object('id',test_id,'submission_id',submission,'protocolo','TEST-'||test_id,'nome','Teste técnico','empresa','Teste SQL ALM','whatsapp','5511900000000','instagram','','respostas',jsonb_build_object('segmento','Outro'),'tier','alto','team','["sdr"]'::jsonb,'utm','{}'::jsonb,'source_url','https://example.test/','referrer',''));
  if value->>'id' <> test_id::text then raise exception 'Save failed'; end if;
  again := public.alm_ai_save_lead(jsonb_build_object('id',gen_random_uuid(),'submission_id',submission,'protocolo','TEST-RETRY','nome','Retry changed','empresa','Retry changed','whatsapp','5511900000000','instagram','','respostas','{}'::jsonb,'tier','baixo','team','[]'::jsonb,'utm','{}'::jsonb,'source_url','https://example.test/','referrer',''));
  if again->>'id' <> test_id::text or (select nome from public.alm_ai_leads where id=test_id) <> 'Teste técnico' then raise exception 'Idempotency failed'; end if;
  select count(*) into claims from public.alm_ai_claim_notifications(1,test_id);
  if claims <> 1 then raise exception 'Queue claim failed'; end if;
  select count(*) into claims from public.alm_ai_claim_notifications(1,test_id);
  if claims <> 0 then raise exception 'Queue lock failed'; end if;
  if (select notification_attempts from public.alm_ai_leads where id=test_id) <> 1 then raise exception 'Attempts mismatch'; end if;
  for claims in 1..8 loop if not public.alm_ai_allow_request(bucket,8) then raise exception 'Rate allowed request failed'; end if; end loop;
  if public.alm_ai_allow_request(bucket,8) then raise exception 'Rate limit failed'; end if;
end;
$verify$;
rollback;
