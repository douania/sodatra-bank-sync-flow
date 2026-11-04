-- Lot 1 opérationnel : version financière et comparaison à trois issues (R6,
-- C4 bis), sur les faits stockés par le dépôt des charges du pipeline réel.
\set ON_ERROR_STOP on

SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_breakdown', opx.deposit('breakdown'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert_eq(opx.get('d_breakdown') -> 'units' -> 0 ->> 'unit_status', 'conflict', 'comparaison : ventilation classée R2');

CREATE FUNCTION opx.compare(p_w uuid, p_r uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT public.daily_stmt_version_compare(w.day_content_hash, w.aggregates_status, w.opening_balance_derived,
    w.closing_balance_derived, w.day_total_debits, w.day_total_credits, r.day_content_hash, r.aggregates_status,
    r.opening_balance_derived, r.closing_balance_derived, r.day_total_debits, r.day_total_credits)
  FROM public.daily_statement_units_staging w, public.daily_statement_units_staging r WHERE w.id = p_w AND r.id = p_r $$;

SELECT tr_test.assert_eq(opx.compare(opx.uid('d_right'), opx.uid('d_wrong')), 'CONTRADICTION',
  'comparaison : mêmes mouvements, soldes différents = contradiction démontrée');
SELECT tr_test.assert_eq(opx.compare(opx.uid('d_breakdown'), opx.uid('d_right')), 'AGREEMENT_BREAKDOWN',
  'comparaison : même net et mêmes soldes, totaux différents = accord, ventilation');
SELECT tr_test.assert_eq(opx.compare(opx.uid('d_unavailable'), opx.uid('d_right')), 'INSUFFICIENT_UNAVAILABLE',
  'comparaison : soldes indisponibles, même net = données insuffisantes');
SELECT tr_test.assert_eq(opx.compare(opx.uid('d_breakdown'), opx.uid('d_wrong')), 'CONTRADICTION',
  'comparaison : ouvertures différentes = contradiction démontrée');
SELECT tr_test.assert_eq(opx.compare(opx.uid('d_wrong_again'), opx.uid('d_wrong')), 'SAME_VERSION',
  'comparaison : même version');
SELECT tr_test.assert(opx.vkey(opx.uid('d_wrong')) = opx.vkey(opx.uid('d_wrong_again'))
  AND opx.vkey(opx.uid('d_wrong')) <> opx.vkey(opx.uid('d_right')), 'comparaison : clé de version');

-- Valeurs absentes conservées absentes, jamais zéro ; cohérence rendue.
SELECT tr_test.assert((public.daily_stmt_version_facts(opx.uid('d_unavailable')) -> 'opening') = 'null'::jsonb
  AND (public.daily_stmt_version_facts(opx.uid('d_unavailable')) -> 'closing') = 'null'::jsonb
  AND (public.daily_stmt_version_facts(opx.uid('d_unavailable')) ->> 'coherent')::boolean,
  'comparaison : ouverture et clôture absentes, version cohérente');
SELECT tr_test.assert((public.daily_stmt_version_facts(opx.uid('d_right')) ->> 'coherent')::boolean
  AND (public.daily_stmt_version_facts(opx.uid('d_right')) ->> 'net') = '10.00', 'comparaison : net et cohérence');

-- Relations contrôlées par le serveur (charges directes : le pipeline ne les produit pas).
SELECT tr_test.assert(NOT public.daily_stmt_version_coherent('derived', 100, 120, 0, 10), 'relation 4 : 100 + 10 <> 120');
SELECT tr_test.assert(NOT public.daily_stmt_version_coherent('derived', NULL, 110, 0, 10), 'relation 2 : dérivé sans ouverture');
SELECT tr_test.assert(NOT public.daily_stmt_version_coherent('unavailable', 100, NULL, 0, 10), 'relation 2 : indisponible avec ouverture');
SELECT tr_test.assert(NOT public.daily_stmt_version_coherent('derived', 100, 90, 20, 10) = false
  AND NOT public.daily_stmt_version_coherent('derived', 100, 90, -10, -20), 'relation 3 : totaux négatifs refusés');
SELECT tr_test.assert_eq(public.daily_stmt_version_compare('h', 'derived', 0, 10, 0, 10, 'h', 'derived', 0, 10, 5, 15),
  'INSUFFICIENT_INCOHERENT', 'relation 5 : mêmes mouvements, totaux différents');

SELECT 'PASS 41_version_comparison' AS marker;
