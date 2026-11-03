-- target: 46_operational.sql
-- Mutant (R6, P1) la fraîcheur est comparée à la première apparition globale de la version.
SELECT tr_test.mutate('public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)',
  'FILTER (WHERE NOT (v_bound > (s.first_seen_at AT TIME ZONE ''Africa/Dakar'')::date))',
  'FILTER (WHERE NOT (v_bound > ((SELECT min(x.first_seen_at) FROM public.daily_stmt_version_sources(p_day_unit_id, p_refuted_version_key) x) AT TIME ZONE ''Africa/Dakar'')::date))');
