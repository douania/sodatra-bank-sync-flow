-- C7 (R6) : mesure de la lecture « Soldes à date » sur le volume de 80_perf_seed.
-- Échauffement documenté : 10 lectures, D = 2026-10-29 - 37 × i (i = 0..9).
-- Mesure : 120 lectures, D réparties uniformément sur tout l'historique,
-- D_i = 2016-11-01 + floor(i × 3651 / 119) (i = 0..119), premier et dernier
-- jour compris. Chronométrage serveur (clock_timestamp) de
-- treasury_private.balances_snapshot(D, 2026-11-03), cœur de la lecture
-- publique. Cache chaud après l'échauffement. Budget R6 : p95 <= 1 s.
\set ON_ERROR_STOP on

CREATE TABLE tr_test.perf_reads (n integer PRIMARY KEY, d date NOT NULL, ms numeric NOT NULL, accounts integer NOT NULL);

DO $$
DECLARE
  v_i  integer;
  v_d  date;
  v_t0 timestamptz;
  v_r  jsonb;
BEGIN
  FOR v_i IN 0..9 LOOP
    v_r := treasury_private.balances_snapshot(date '2026-10-29' - 37 * v_i, date '2026-11-03');
  END LOOP;
  FOR v_i IN 0..119 LOOP
    v_d := date '2016-11-01' + (v_i * 3651) / 119;
    v_t0 := clock_timestamp();
    v_r := treasury_private.balances_snapshot(v_d, date '2026-11-03');
    INSERT INTO tr_test.perf_reads VALUES (v_i, v_d, extract(epoch FROM clock_timestamp() - v_t0) * 1000,
      jsonb_array_length(v_r -> 'accounts'));
  END LOOP;
END $$;

SELECT tr_test.assert((SELECT count(*) FROM tr_test.perf_reads) = 120, 'perf : 120 lectures mesurées');
SELECT tr_test.assert((SELECT min(accounts) FROM tr_test.perf_reads) >= 10, 'perf : les 10 comptes lus à chaque date');

SELECT 'PERF reads=' || count(*)
    || ' p50_ms=' || round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::numeric, 1)
    || ' p95_ms=' || round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric, 1)
    || ' max_ms=' || round(max(ms), 1)
    || ' min_ms=' || round(min(ms), 1)
    || ' mean_ms=' || round(avg(ms), 1) AS marker
FROM tr_test.perf_reads;
SELECT 'PERF slowest d=' || d || ' ms=' || round(ms, 1) AS marker
FROM tr_test.perf_reads ORDER BY ms DESC LIMIT 3;
SELECT CASE WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) <= 1000 THEN 'PERF_BUDGET_PASS p95 <= 1000 ms'
            ELSE 'PERF_BUDGET_EXCEEDED p95 > 1000 ms : rapport de mesure, aucune matérialisation automatique' END AS marker
FROM tr_test.perf_reads;

-- Statuts rendus à la dernière date (contrôle de vraisemblance du volume).
SELECT 'PERF statuses_at_2026-10-31 ' || string_agg(s || '=' || n, ' ' ORDER BY s) AS marker
FROM (SELECT a ->> 'status' AS s, count(*) AS n
      FROM jsonb_array_elements(treasury_private.balances_snapshot(date '2026-10-31', date '2026-11-03') -> 'accounts') a
      WHERE a ->> 'alias' LIKE 'TR PERF %' GROUP BY 1) x;

-- Lecture publique de bout en bout (authentification, habilitation), une fois.
SELECT tr_test.as_user('t_reader');
SELECT tr_test.assert(jsonb_array_length(public.treasury_balances_at_v1(date '2026-10-31') -> 'accounts') >= 10,
  'perf : lecture publique du lecteur');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Ressources et paramètres.
SELECT 'PERF server ' || version() AS marker;
SELECT 'PERF settings shared_buffers=' || current_setting('shared_buffers') || ' work_mem=' || current_setting('work_mem')
    || ' jit=' || current_setting('jit') || ' max_parallel_workers_per_gather='
    || current_setting('max_parallel_workers_per_gather') || ' effective_cache_size=' || current_setting('effective_cache_size')
    AS marker;
SELECT 'PERF volume canonical_units=' || (SELECT count(*) FROM public.daily_statement_units_canonical)
    || ' staging_units=' || (SELECT count(*) FROM public.daily_statement_units_staging)
    || ' canonical_lines=' || (SELECT count(*) FROM public.daily_statement_lines_canonical)
    || ' database_size=' || pg_size_pretty(pg_database_size(current_database())) AS marker;

-- Plan détaillé de la lecture la plus lente (requête interne de la fonction).
LOAD 'auto_explain';
SET auto_explain.log_min_duration = 0;
SET auto_explain.log_analyze = on;
SET auto_explain.log_buffers = on;
SET auto_explain.log_timing = on;
SET auto_explain.log_nested_statements = on;
SET auto_explain.log_level = 'warning';
SELECT length(treasury_private.balances_snapshot((SELECT d FROM tr_test.perf_reads ORDER BY ms DESC LIMIT 1),
  date '2026-11-03')::text) AS explained_bytes;
RESET auto_explain.log_level;
SET auto_explain.log_min_duration = -1;

SELECT 'PASS 81_perf_measure' AS marker;
