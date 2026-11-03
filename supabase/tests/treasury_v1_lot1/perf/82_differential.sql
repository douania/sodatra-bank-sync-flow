-- C7 (R6), garde contre la suppression silencieuse d'un contrôle : la lecture
-- optimisée (treasury_private.balances_snapshot) doit rendre exactement la même
-- réponse JSON que la référence figée non optimisée (tr_ref, chargée par
-- reference_balances_snapshot.sql), instant de lecture excepté, à chaque date
-- couverte par les données de la transaction courante (scénarios ou
-- historiques aléatoires), plus trois jours de part et d'autre.
\set ON_ERROR_STOP on
CREATE TEMP TABLE diff_dates AS
SELECT g::date AS d
FROM generate_series(
  (SELECT min(accounting_date) - 3 FROM public.daily_statement_units_staging),
  least((SELECT max(accounting_date) + 3 FROM public.daily_statement_units_staging), treasury_private.today()),
  interval '1 day') g;
CREATE TEMP TABLE diff_results AS
SELECT d.d,
       (treasury_private.balances_snapshot(d.d, treasury_private.today()) - 'read_at') AS optimized,
       (tr_ref.balances_snapshot(d.d, treasury_private.today()) - 'read_at') AS reference
FROM diff_dates d;
SELECT tr_test.assert((SELECT count(*) FROM diff_dates) >= 20, 'différentiel : dates comparées');
SELECT tr_test.assert_eq((SELECT coalesce(string_agg(r.d::text, ',' ORDER BY r.d), '')
                            FROM diff_results r WHERE r.optimized IS DISTINCT FROM r.reference), '',
  'différentiel : réponse identique à la référence à chaque date');
SELECT 'PASS 82_differential (' || count(*) || ' dates, '
       || (SELECT count(*) FROM diff_results r, jsonb_array_elements(r.optimized -> 'accounts') a) || ' lectures de compte, '
       || (SELECT count(DISTINCT a ->> 'status') FROM diff_results r, jsonb_array_elements(r.optimized -> 'accounts') a)
       || ' statuts distincts)' AS marker
FROM diff_dates;
