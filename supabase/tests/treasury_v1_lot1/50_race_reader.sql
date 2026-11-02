-- Course réelle, session A (lecteur BANK_READ). L'instruction prend son
-- instantané à son début, dort 3 s, PUIS appelle la lecture de trésorerie :
-- l'import et la suspension validés pendant le sommeil par la session B ne
-- doivent pas être vus, ni en totalité ni en partie.
\set ON_ERROR_STOP on
SELECT tr_test.as_user('t_reader');
SELECT 'RESULT|' || (
  SELECT a ->> 'status' || '|' || coalesce(a ->> 'balance_at_date', 'null') || '|' || (a ->> 'qualification')
         || '|' || coalesce(a -> 'observed_balance' ->> 'balance', 'null')
  FROM jsonb_array_elements(q.r -> 'accounts') a
  WHERE a ->> 'registry_account_id' = tr_test.id('ora_main')::text)
FROM (SELECT 0 AS x FROM pg_sleep(3)) s
CROSS JOIN LATERAL (SELECT public.treasury_balances_at_v1(date '2026-10-07' + s.x) AS r) q;
