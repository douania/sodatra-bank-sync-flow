-- Lot 1 opérationnel, P1 de la contre-revue CTO de la PR #156 : concordance des
-- lignes stockées avec les faits déclarés. Contre-exemple reproduit par le CTO
-- (charge produite par le pipeline réel, seuls les agrégats décalés de
-- 1 000 000 XOF, équation ouverture + crédits - débits = clôture respectée) et
-- variantes : totaux décalés à net égal, soldes courants des lignes modifiés.
-- Transaction annulée : ouverture du module trésorerie et qualification ATB
-- posées par le canal opérateur pour la seule durée du fichier (fixtures).
\set ON_ERROR_STOP on
BEGIN;

SELECT treasury_private.set_module_open(true, 'tr-test:ouverture-44', 'Ouverture synthétique de la suite 44', 'operateur-test');
SELECT treasury_private.set_bank_format_qualification('ATB', 'structured_bank_statement_xls', 'QUALIFIED',
  'tr-test:preuve-synthetique-atb', 'Qualification synthétique de test, sans valeur réelle', 'operateur-test');

-- Dépôt de la charge `p_key` du pipeline réel, agrégats et soldes courants des
-- lignes décalés (zéro partout : charge intacte).
CREATE FUNCTION opx.deposit_variant(p_key text, p_open numeric, p_close numeric, p_debits numeric, p_credits numeric,
  p_running numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pre_ingest_daily_statement_units(p.attempt,
    (SELECT jsonb_agg(u || jsonb_build_object(
              'opening_balance_derived', (u ->> 'opening_balance_derived')::numeric + p_open,
              'closing_balance_derived', (u ->> 'closing_balance_derived')::numeric + p_close,
              'day_total_debits', (u ->> 'day_total_debits')::numeric + p_debits,
              'day_total_credits', (u ->> 'day_total_credits')::numeric + p_credits) ORDER BY ord)
     FROM jsonb_array_elements(p.units) WITH ORDINALITY AS x(u, ord)),
    (SELECT jsonb_agg(CASE WHEN p_running = 0 THEN l
                           ELSE l || jsonb_build_object('running_balance', (l ->> 'running_balance')::numeric + p_running) END
                      ORDER BY ord)
     FROM jsonb_array_elements(p.lines) WITH ORDINALITY AS z(l, ord)),
    p.guard)
  FROM opx.payloads p WHERE p.key = p_key $$;
CREATE FUNCTION opx.attempt_of(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (opx.get(p_key) ->> 'attempt_id')::uuid $$;
-- Ligne de lecture « Soldes à date » du compte synthétique du lot (OPX ATB LOT).
CREATE FUNCTION opx.read_lot(p_as_of date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT a FROM jsonb_array_elements(tr_test.read_as('t_reader', p_as_of) -> 'accounts') a
  WHERE a ->> 'registry_account_id' = '00000000-0000-4000-8000-0000000000f3' $$;
CREATE FUNCTION opx.attest_lot(p_key text, p_command text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.attest_daily_statement_attempt(p_command, opx.attempt_of(p_key), 'ACCOUNT_IDENTITY',
    (SELECT a.raw_text_hash FROM public.daily_statement_export_attempts a WHERE a.id = opx.attempt_of(p_key)),
    '00000000-0000-4000-8000-0000000000f3', NULL, 'Piece synthetique identite', 'Attestation locale sur fichier synthetique') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA opx TO authenticated;

-- --------------------------------------------------------------------------
-- Témoin : la charge intacte est conforme et admissible.
-- --------------------------------------------------------------------------
SAVEPOINT witness;
SELECT tr_test.as_user('t_admin');
SELECT opx.put('w', opx.deposit_variant('batch', 0, 0, 0, 0, 0));
SELECT opx.attest_lot('w', 'opx-44-w-attest');
SELECT opx.put('w_plan', public.daily_v2_attempt_batch_plan_v1(opx.attempt_of('w')));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert((SELECT bool_and(public.daily_stmt_staging_lines_conform(s.id)) AND count(*) = 3
  FROM public.daily_statement_units_staging s WHERE s.attempt_id = opx.attempt_of('w')), '44 témoin : trois journées conformes');
SELECT tr_test.assert_eq(jsonb_array_length(opx.get('w_plan') -> 'admissible')::text, '3', '44 témoin : trois journées admissibles');
SELECT tr_test.assert_eq((opx.get('w_plan') -> 'expected')::text,
  public.daily_stmt_batch_candidates(opx.attempt_of('w'))::text, '44 témoin : le plan lu est la liste exacte du serveur');
ROLLBACK TO SAVEPOINT witness;

-- --------------------------------------------------------------------------
-- Variantes : agrégats décalés, totaux décalés à net égal, soldes courants des
-- lignes modifiés. Équation respectée, lignes non conformes : rien d'admissible.
-- --------------------------------------------------------------------------
CREATE FUNCTION opx.run_variant(p_k text, p_o numeric, p_c numeric, p_d numeric, p_cr numeric, p_r numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_plan jsonb;
BEGIN
  PERFORM tr_test.as_user('t_admin');
  PERFORM opx.put('v_' || p_k, opx.deposit_variant('batch', p_o, p_c, p_d, p_cr, p_r));
  PERFORM opx.attest_lot('v_' || p_k, 'opx-44-attest-' || p_k);
  v_plan := public.daily_v2_attempt_batch_plan_v1(opx.attempt_of('v_' || p_k));
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM tr_test.assert((SELECT bool_and(public.daily_stmt_version_coherent(s.aggregates_status, s.opening_balance_derived,
             s.closing_balance_derived, s.day_total_debits, s.day_total_credits)
           AND NOT public.daily_stmt_staging_lines_conform(s.id)) AND count(*) = 3
    FROM public.daily_statement_units_staging s WHERE s.attempt_id = opx.attempt_of('v_' || p_k)),
    '44 ' || p_k || ' : équation respectée, lignes non conformes');
  PERFORM tr_test.assert_eq(jsonb_array_length(public.daily_stmt_batch_candidates(opx.attempt_of('v_' || p_k)) -> 'days')::text,
    '0', '44 ' || p_k || ' : aucune journée admissible');
  PERFORM tr_test.assert((SELECT count(*) = 3 AND bool_and(e ->> 'reason' = 'LINES_NOT_CONFORMING')
    FROM jsonb_array_elements(v_plan -> 'inadmissible') e) AND jsonb_array_length(v_plan -> 'admissible') = 0,
    '44 ' || p_k || ' : motif rendu à l''interface');
  PERFORM tr_test.as_user('t_admin');
  PERFORM tr_test.expect_error(format('SELECT public.promote_daily_statement_attempt_units(%L, %L::uuid, %L::jsonb, %L)',
    'opx-44-batch-' || p_k, opx.attempt_of('v_' || p_k), v_plan -> 'expected', 'Approbation groupee'), 'DAILY_STMT_BATCH_EMPTY');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;
GRANT EXECUTE ON FUNCTION opx.run_variant(text, numeric, numeric, numeric, numeric, numeric) TO authenticated;
-- Chaque variante sur le même état de départ.
SAVEPOINT variant;
SELECT opx.run_variant('shift', 1000000, 1000000, 0, 0, 0);
ROLLBACK TO SAVEPOINT variant;
SELECT opx.run_variant('totals', 0, 0, 500, 500, 0);
ROLLBACK TO SAVEPOINT variant;
SELECT opx.run_variant('running', 0, 0, 0, 0, 1);
ROLLBACK TO SAVEPOINT variant;
-- Mordant : sans la condition de conformité, la charge décalée du CTO redevient
-- admissible à l'approbation groupée (la protection est nécessaire).
SELECT tr_test.mutate('public.daily_stmt_batch_candidates(uuid)',
  '      AND public.daily_stmt_staging_lines_conform(s.id)
', '');
SELECT tr_test.as_user('t_admin');
SELECT opx.put('m', opx.deposit_variant('batch', 1000000, 1000000, 0, 0, 0));
SELECT opx.attest_lot('m', 'opx-44-m-attest');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert_eq(jsonb_array_length(public.daily_stmt_batch_candidates(opx.attempt_of('m')) -> 'days')::text, '3',
  '44 mordant : sans la condition, les trois journées décalées seraient admissibles');
ROLLBACK TO SAVEPOINT variant;

-- --------------------------------------------------------------------------
-- Contre-exemple CTO conduit jusqu'à la lecture : la promotion unitaire
-- historique (enveloppe inchangée) reste possible ; la lecture « Soldes à
-- date » n'établit alors aucun solde et le signale.
-- --------------------------------------------------------------------------
SELECT tr_test.as_user('t_admin');
SELECT opx.put('x', opx.deposit_variant('batch', 1000000, 1000000, 0, 0, 0));
SELECT opx.attest_lot('x', 'opx-44-x-attest');
SELECT public.promote_daily_statement_unit(s.id, 'Promotion unitaire historique')
FROM public.daily_statement_units_staging s WHERE s.attempt_id = opx.attempt_of('x') ORDER BY s.accounting_date;
SELECT public.treasury_admin_add_expected_account_v1('opx-44-account', '00000000-0000-4000-8000-0000000000f3',
  NULL, NULL, NULL, 'Compte de controle fictif');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert(NOT bool_or(public.daily_stmt_canonical_lines_conform(c.id)) AND count(*) = 3,
  '44 CTO : trois journées retenues aux lignes non conformes')
FROM public.daily_statement_units_canonical c
JOIN public.daily_statement_units_staging s ON s.id = c.promoted_from_staging_unit_id
WHERE s.attempt_id = opx.attempt_of('x') AND c.status = 'ingested';
SELECT opx.put('read_x', opx.read_lot('2026-10-05'));
SELECT tr_test.assert(opx.get('read_x') ->> 'status' <> 'AVAILABLE' AND opx.get('read_x') ->> 'balance_at_date' IS NULL,
  '44 CTO : aucun solde disponible (était AVAILABLE à 1 000 110 XOF)');
SELECT tr_test.assert(opx.get('read_x') -> 'reasons' ? 'UNIT_FINANCIAL_FACTS_INCOHERENT', '44 CTO : cause rendue');
SELECT tr_test.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(opx.get('read_x') -> 'findings') f
  WHERE f ->> 'kind' = 'LINES_NOT_CONFORMING' AND f ->> 'day' = '2026-10-05' AND (f ->> 'retained_unit')::boolean),
  '44 CTO : constat de lignes non conformes sur l''unité retenue');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(opx.get('read_x') -> 'sources') s
  WHERE s ->> 'kind' IN ('CLOSURE_LATER_LINE', 'CANONICAL_UNIT')), '44 CTO : ni unité ni fichier non conforme comme preuve');
SELECT tr_test.assert(opx.read_lot(d) ->> 'balance_at_date' IS NULL, '44 CTO : aucun solde le ' || d)
FROM unnest(ARRAY['2026-10-06', '2026-10-07', '2026-10-20']::date[]) d;
-- Mordant : sans le contrôle des lignes à la lecture, on retrouve le résultat
-- reproduit par le CTO (AVAILABLE à 1 000 110 XOF).
SAVEPOINT read_bite;
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'cardinality(a.residual) = 0 AND lo.lines_ok', 'cardinality(a.residual) = 0 AND true');
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '          AND coalesce(cc.conform, false)) AS coherent,
         coalesce(cc.conform, false) AS lines_conform,', '          AND true) AS coherent,
         true AS lines_conform,');
SELECT tr_test.assert(opx.read_lot('2026-10-05') ->> 'status' = 'AVAILABLE'
  AND opx.read_lot('2026-10-05') ->> 'balance_at_date' = '1000110.00',
  '44 mordant : sans le contrôle, le solde décalé serait disponible');
ROLLBACK TO SAVEPOINT read_bite;

-- La charge intacte, redéposée : doublons R1 de même mouvement, lignes conservées
-- (H1) et conformes. Réfuter la bonne version contre une retenue non conforme
-- est refusé ; la correction des seuls soldes est la voie.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('y', opx.deposit_variant('batch', 0, 0, 0, 0, 0));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert(bool_and(s.status = 'duplicate' AND public.daily_stmt_staging_lines_conform(s.id)) AND count(*) = 3,
  '44 CTO : copies intactes conservées avec des lignes conformes')
FROM public.daily_statement_units_staging s WHERE s.attempt_id = opx.attempt_of('y');
-- Valeurs calculées hors rôle applicatif (fonctions internes non exposées).
CREATE TABLE opx.fix AS
SELECT d AS day, opx.day_unit(opx.uid_on('y', d)) AS day_unit, opx.canonical(opx.day_unit(opx.uid_on('y', d))) AS retained,
       opx.uid_on('y', d) AS corrective, opx.vkey(opx.uid_on('y', d)) AS corrective_vkey,
       (SELECT opx.vkey(c.promoted_from_staging_unit_id) FROM public.daily_statement_units_canonical c
         WHERE c.id = opx.canonical(opx.day_unit(opx.uid_on('y', d)))) AS retained_vkey,
       opx.sources(opx.uid_on('y', d)) AS sources
FROM unnest(ARRAY['2026-10-05', '2026-10-06', '2026-10-07']::date[]) d;
GRANT SELECT ON opx.fix TO authenticated;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  'opx-44-refute', f.day_unit, f.corrective_vkey, f.retained_vkey, f.sources,
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', f.corrective), 'Refutation de la bonne version'),
  'DAILY_STMT_REFUTATION_RETAINED_LINES_NONCONFORMING')
FROM opx.fix f WHERE f.day = '2026-10-05';
SELECT public.supersede_daily_statement_unit_balances('opx-44-balances-' || f.day, f.retained, f.corrective,
  f.corrective_vkey, 'Correction des soldes decales')
FROM opx.fix f ORDER BY f.day;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert(bool_and(public.daily_stmt_canonical_lines_conform(c.id)) AND count(*) = 3,
  '44 CTO : unités retenues corrigées, lignes conformes')
FROM public.daily_statement_units_canonical c
WHERE c.account_registry_id = '00000000-0000-4000-8000-0000000000f3' AND c.status = 'ingested';
SELECT opx.put('read_y', opx.read_lot('2026-10-05'));
SELECT tr_test.assert(NOT (opx.get('read_y') -> 'reasons' ? 'UNIT_FINANCIAL_FACTS_INCOHERENT'),
  '44 CTO : la cause disparaît avec la correction');
SELECT tr_test.assert(coalesce(opx.get('read_y') ->> 'balance_at_date', '') <> '1000110.00', '44 CTO : jamais 1 000 110 XOF');
SELECT tr_test.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(opx.get('read_y') -> 'findings') f
  WHERE f ->> 'kind' = 'LINES_NOT_CONFORMING' AND f ->> 'day' = '2026-10-05' AND NOT (f ->> 'retained_unit')::boolean),
  '44 CTO : l''ancienne livraison non conforme reste signalée, hors unité retenue');

SELECT 'PASS 44_lines_conformity' AS marker;
ROLLBACK;
