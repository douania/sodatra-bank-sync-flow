-- target: 46_operational.sql
-- Mutant (R6) une preuve du jour même de la première apparition justifie la source.
SELECT tr_test.mutate('public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)',
  'count(*) FILTER (WHERE NOT (v_bound > (s.first_seen_at',
  'count(*) FILTER (WHERE NOT (v_bound >= (s.first_seen_at');
