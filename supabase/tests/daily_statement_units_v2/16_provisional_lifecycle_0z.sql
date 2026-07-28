-- ============================================================================
-- 0Z — TESTS DU CYCLE DE VIE PROVISIONAL (redépôt idempotent, clôture)
-- ============================================================================
-- PRÉREQUIS (contrairement à 10-15 qui tournent sur le socle 0H seul) :
--   00_supabase_local_shim.sql + 01_seed_synthetic_identities.sql
--   + 02_payload_helpers.sql (hex64 / day_content_hash / mk_guard)
--   + migrations 20260708130000 (0H), 0U, 0U3, 0U4
--   + 20260728000000_daily_v2_provisional_lifecycle_0z.sql (0Z).
-- Données 100 % synthétiques (banque ORA, devise XOF, septembre 2026, compte
-- provisionné par la RPC registre — fingerprint généré côté serveur).
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- ----------------------------------------------------------------------------
-- Helpers 0Z : builders paramétrés par le fingerprint du compte provisionné
-- (implémentation de préimage INDÉPENDANTE, anti-circularité comme 02).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION poc_test.z_day_unit_id(p_bank text, p_fp text, p_date text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    '["sodatra:structured_bank_statement_csv:day_unit_id:v2","' || p_bank
    || '","' || p_fp || '","XOF","' || p_date || '"]', 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION poc_test.z_mk_attempt(
  p_bank text, p_fp text, p_account_id text, p_seed text,
  p_start text, p_end text, p_ref text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'requested_mode', 'daily',
    'source_format', 'structured_bank_statement_csv',
    'bank', p_bank,
    'currency', 'XOF',
    'account_fingerprint', p_fp,
    'account_registry_id', p_account_id,
    'account_number_masked', '****1234',
    'source_file_name_redacted', 'releve synthetique 0z.csv',
    'raw_text_hash', poc_test.hex64('z_rth_' || p_seed),
    'export_period_start', p_start,
    'export_period_end', p_end,
    'statement_date', p_end,
    'export_reference_date', p_ref,
    'parser_validation_status', 'valid',
    'errors_count', 0,
    'warnings_count', 0,
    'runtime_version', 'synthetic-runtime-0z',
    'parser_version', 'synthetic-parser-0z')
$$;

CREATE OR REPLACE FUNCTION poc_test.z_mk_unit(
  p_bank text, p_fp text, p_date text, p_hashes text[], p_status text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'day_unit_id', poc_test.z_day_unit_id(p_bank, p_fp, p_date),
    'accounting_date', p_date,
    'day_content_hash', poc_test.day_content_hash(
      poc_test.z_day_unit_id(p_bank, p_fp, p_date), p_hashes),
    'line_count', array_length(p_hashes, 1),
    'day_total_debits', 0.00,
    'day_total_credits', (10.00 * array_length(p_hashes, 1))::numeric(18, 2),
    'opening_balance_derived', 0.00,
    'closing_balance_derived', (10.00 * array_length(p_hashes, 1))::numeric(18, 2),
    'aggregates_status', 'derived',
    'validation_status', 'valid',
    'requested_unit_status', p_status)
$$;

CREATE OR REPLACE FUNCTION poc_test.z_mk_line(
  p_bank text, p_fp text, p_date text, p_hash text, p_ordinal integer, p_idx integer
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'day_unit_id', poc_test.z_day_unit_id(p_bank, p_fp, p_date),
    'daily_line_hash', p_hash,
    'daily_occurrence_ordinal', p_ordinal,
    'source_line_index', p_idx,
    'accounting_date', p_date,
    'value_date', p_date,
    'description_sanitized', 'SYNTHETIC 0Z LINE ' || left(p_hash, 12),
    'debit_amount', NULL,
    'credit_amount', 10.00,
    'signed_amount', 10.00,
    'running_balance', (10.00 * p_ordinal)::numeric(18, 2),
    'direction', 'credit',
    'currency', 'XOF')
$$;

-- Dépôt mono-journée via le wrapper 0U réel ; mémorise l'issue sous préfixe.
CREATE OR REPLACE FUNCTION poc_test.z_deposit(
  p_prefix text, p_date text, p_hashes text[], p_status text, p_ref text
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_fp    text := poc_test.ctx_get('z_fp');
  v_acc   text := poc_test.ctx_get('z_account');
  v_lines jsonb := '[]'::jsonb;
  v_res   jsonb;
  v_i     integer;
BEGIN
  FOR v_i IN 1 .. array_length(p_hashes, 1) LOOP
    v_lines := v_lines || poc_test.z_mk_line('ORA', v_fp, p_date, p_hashes[v_i], 1, v_i - 1);
  END LOOP;
  v_res := public.pre_ingest_daily_statement_units(
    poc_test.z_mk_attempt('ORA', v_fp, v_acc, p_prefix, p_date, p_date, p_ref),
    jsonb_build_array(poc_test.z_mk_unit('ORA', v_fp, p_date, p_hashes, p_status)),
    v_lines,
    poc_test.mk_guard(true, 1));
  PERFORM poc_test.ctx_set(p_prefix || '_attempt', v_res ->> 'attempt_id');
  PERFORM poc_test.ctx_set(p_prefix || '_staging', v_res -> 'units' -> 0 ->> 'staging_unit_id');
  PERFORM poc_test.ctx_set(p_prefix || '_status',  v_res -> 'units' -> 0 ->> 'unit_status');
  PERFORM poc_test.ctx_set(p_prefix || '_duid',    v_res -> 'units' -> 0 ->> 'day_unit_id');
  RETURN v_res;
END
$fn$;

-- Provisional vivantes d'une journée (lecture superuser, invariant technique).
CREATE OR REPLACE FUNCTION poc_test.z_live_provisional(p_duid text)
RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_units_staging
  WHERE day_unit_id = p_duid AND status = 'provisional'
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

-- ----------------------------------------------------------------------------
-- Setup : compte ORA provisionné par la RPC registre (masque corroboré).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('z_provision',
  public.provision_daily_statement_account('ORA','XOF','LIFECYCLE 0Z ORA','****1234')::text);
COMMIT;
SELECT poc_test.ctx_set('z_account', poc_test.ctx_get('z_provision')::jsonb ->> 'id');
SELECT poc_test.ctx_set('z_fp', poc_test.ctx_get('z_provision')::jsonb ->> 'account_fingerprint');

-- ----------------------------------------------------------------------------
-- Z1 : premier dépôt d'une journée non close => provisional held (0H conservé).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z1', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1')], 'provisional', '15/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z1_status') = 'provisional',
  'Z1: journee non close deposee => provisional');
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE staging_unit_id = poc_test.ctx_get('z1_staging')::uuid
            AND event_type = 'unit_provisional_held'),
  'Z1: evenement unit_provisional_held emis');
SELECT poc_test.assert(
  poc_test.z_live_provisional(poc_test.ctx_get('z1_duid')) = 1,
  'Z1: exactement une provisional vivante');

-- ----------------------------------------------------------------------------
-- Z2 : redépôt STRICTEMENT IDENTIQUE => duplicate idempotent (D-0Z-1).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z2', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1')], 'provisional', '15/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z2_status') = 'duplicate',
  'Z2: redepot identique d une journee non close => duplicate (R1-provisional)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('z2_staging')::uuid) = 0,
  'Z2: aucune ligne sensible re-stagee par le redepot identique');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z1_staging')::uuid) = 'provisional'
  AND poc_test.z_live_provisional(poc_test.ctx_get('z1_duid')) = 1,
  'Z2: la provisional d origine reste l unique version vivante');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('z2_staging')::uuid
     AND event_type = 'unit_duplicate'
     AND safe_details ->> 'reason_code' = 'provisional_redeposit_duplicate') = 1,
  'Z2: evenement unit_duplicate R1-provisional audite avec reason_code');

-- ----------------------------------------------------------------------------
-- Z3 : redépôt MODIFIÉ => nouvelle provisional, l'ancienne superseded (D-0Z-2).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z3', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1'), poc_test.hex64('z_l2')], 'provisional', '15/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z3_status') = 'provisional',
  'Z3: contenu modifie => nouvelle provisional vivante');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z1_staging')::uuid) = 'superseded',
  'Z3: l ancienne provisional est superseded');
SELECT poc_test.assert(
  poc_test.z_live_provisional(poc_test.ctx_get('z3_duid')) = 1,
  'Z3: exactement une provisional vivante (la version modifiee)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('z1_staging')::uuid
     AND event_type = 'status_changed'
     AND previous_status = 'provisional' AND new_status = 'superseded'
     AND safe_details ->> 'reason_code' = 'provisional_superseded_by_redeposit') = 1,
  'Z3: bascule provisional->superseded auditee (redeposit)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('z1_staging')::uuid) = 1,
  'Z3: les lignes de la provisional superseded sont conservees (aucun DELETE)');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z2_staging')::uuid) = 'duplicate',
  'Z3: l unite duplicate Z2 n est pas touchee par le balayage');

-- ----------------------------------------------------------------------------
-- Z4 : clôture de la journée => staged + balayage (D-0Z-3), puis promotion.
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z4', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1'), poc_test.hex64('z_l2')], 'staged', '16/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z4_status') = 'staged',
  'Z4: journee close redeposee => staged (arbitrage canonical normal)');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z3_staging')::uuid) = 'superseded',
  'Z4: la provisional restante est superseded a la cloture');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('z3_staging')::uuid
     AND event_type = 'status_changed'
     AND safe_details ->> 'reason_code' = 'provisional_superseded_by_day_closure') = 1,
  'Z4: bascule provisional->superseded auditee (cloture)');
SELECT poc_test.assert(
  poc_test.z_live_provisional(poc_test.ctx_get('z4_duid')) = 0,
  'Z4: plus aucune provisional vivante apres un depot de journee close');

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('z4_promote',
  public.promote_daily_statement_unit(poc_test.ctx_get('z4_staging')::uuid)::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('z4_promote')::jsonb ->> 'outcome' = 'promoted',
  'Z4: la journee close se promeut normalement apres le balayage');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.ctx_get('z4_duid') AND status = 'ingested') = 1,
  'Z4: une seule canonical active pour la journee');

-- ----------------------------------------------------------------------------
-- Z5 : les gates 0H restent intactes sur les unites fermees par 0Z.
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$,
         poc_test.ctx_get('z3_staging')),
  '%DAILY_STMT_PROMOTE_GATE%',
  'Z5: une provisional superseded n est pas promouvable');
ROLLBACK;

-- ----------------------------------------------------------------------------
-- Z6 : ref périmée sur journée déjà canonical => provisional de bruit,
--      toujours jamais promouvable (gate 0H inchangée).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z6', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1'), poc_test.hex64('z_l2')], 'provisional', '15/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z6_status') = 'provisional',
  'Z6: ref perimee => provisional held (bruit documente, hors arbitrage canonical)');
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$,
         poc_test.ctx_get('z6_staging')),
  '%DAILY_STMT_PROVISIONAL_NOT_PROMOTABLE%',
  'Z6: une provisional vivante reste jamais promouvable');
ROLLBACK;

-- ----------------------------------------------------------------------------
-- Z7 : redépôt clos identique au canonical => duplicate R1 ET balayage de la
--      provisional de bruit (la clôture balaie quel que soit le verdict).
-- ----------------------------------------------------------------------------
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z7', '15/09/2026',
  ARRAY[poc_test.hex64('z_l1'), poc_test.hex64('z_l2')], 'staged', '17/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z7_status') = 'duplicate',
  'Z7: journee close identique au canonical => duplicate R1');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('z7_staging')::uuid) = 0,
  'Z7: aucune ligne re-stagee par le duplicate R1');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z6_staging')::uuid) = 'superseded'
  AND poc_test.z_live_provisional(poc_test.ctx_get('z7_duid')) = 0,
  'Z7: la provisional de bruit est balayee meme sur verdict duplicate');

-- ----------------------------------------------------------------------------
-- Z8 : convergence d'un backlog LEGACY (plusieurs provisional vivantes
--      accumulées avant 0Z, simulées en superuser) : le redépôt identique à la
--      plus récente la conserve et balaie les plus anciennes.
-- ----------------------------------------------------------------------------
SELECT poc_test.as_super();
INSERT INTO public.daily_statement_export_attempts (
  created_by, requested_mode, source_format, bank, currency,
  account_fingerprint, raw_text_hash, export_period_start, export_period_end,
  parser_validation_status, ingestion_ready, bridge_guard_passed,
  period_days, units_total
) VALUES
  (NULL, 'daily', 'structured_bank_statement_csv', 'ORA', 'XOF',
   poc_test.ctx_get('z_fp'), poc_test.hex64('z_legacy_rth_a'),
   DATE '2026-09-20', DATE '2026-09-20', 'valid', true, true, 1, 1),
  (NULL, 'daily', 'structured_bank_statement_csv', 'ORA', 'XOF',
   poc_test.ctx_get('z_fp'), poc_test.hex64('z_legacy_rth_b'),
   DATE '2026-09-20', DATE '2026-09-20', 'valid', true, true, 1, 1);

WITH legacy_attempts AS (
  SELECT id, raw_text_hash FROM public.daily_statement_export_attempts
  WHERE raw_text_hash IN (poc_test.hex64('z_legacy_rth_a'), poc_test.hex64('z_legacy_rth_b'))
)
INSERT INTO public.daily_statement_units_staging (
  attempt_id, day_unit_id, bank, account_fingerprint, currency,
  accounting_date, day_content_hash, line_count, day_total_debits,
  day_total_credits, opening_balance_derived, closing_balance_derived,
  aggregates_status, validation_status, status, created_at
)
SELECT
  a.id,
  poc_test.z_day_unit_id('ORA', poc_test.ctx_get('z_fp'), '20/09/2026'),
  'ORA', poc_test.ctx_get('z_fp'), 'XOF',
  DATE '2026-09-20',
  poc_test.day_content_hash(
    poc_test.z_day_unit_id('ORA', poc_test.ctx_get('z_fp'), '20/09/2026'),
    CASE WHEN a.raw_text_hash = poc_test.hex64('z_legacy_rth_a')
         THEN ARRAY[poc_test.hex64('z_lg_a')]
         ELSE ARRAY[poc_test.hex64('z_lg_b')] END),
  1, 0.00, 10.00, 0.00, 10.00, 'derived', 'valid', 'provisional',
  CASE WHEN a.raw_text_hash = poc_test.hex64('z_legacy_rth_a')
       THEN now() - interval '2 hours' ELSE now() - interval '1 hour' END
FROM legacy_attempts a;

SELECT poc_test.ctx_set('z8_legacy_old',
  (SELECT s.id::text FROM public.daily_statement_units_staging s
   JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
   WHERE a.raw_text_hash = poc_test.hex64('z_legacy_rth_a')));
SELECT poc_test.ctx_set('z8_legacy_new',
  (SELECT s.id::text FROM public.daily_statement_units_staging s
   JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
   WHERE a.raw_text_hash = poc_test.hex64('z_legacy_rth_b')));
SELECT poc_test.assert(
  poc_test.z_live_provisional(
    poc_test.z_day_unit_id('ORA', poc_test.ctx_get('z_fp'), '20/09/2026')) = 2,
  'Z8: backlog legacy simule — deux provisional vivantes');

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.z_deposit('z8', '20/09/2026',
  ARRAY[poc_test.hex64('z_lg_b')], 'provisional', '20/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('z8_status') = 'duplicate',
  'Z8: redepot identique a la provisional la plus recente => duplicate');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('z8_legacy_old')::uuid) = 'superseded'
  AND (SELECT status FROM public.daily_statement_units_staging
       WHERE id = poc_test.ctx_get('z8_legacy_new')::uuid) = 'provisional'
  AND poc_test.z_live_provisional(poc_test.ctx_get('z8_duid')) = 1,
  'Z8: le backlog converge — la plus recente survit, les anciennes superseded');

-- ----------------------------------------------------------------------------
-- Z9 : invariants globaux, ACL et append-only.
-- ----------------------------------------------------------------------------
SELECT poc_test.assert(
  (SELECT count(*) FROM (
     SELECT day_unit_id FROM public.daily_statement_units_staging
     WHERE status = 'provisional' GROUP BY day_unit_id HAVING count(*) > 1) x) = 0,
  'Z9: jamais deux provisional vivantes pour une meme journee (invariant global)');
SELECT poc_test.assert(
  NOT has_function_privilege(
    'authenticated',
    'public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'),
  'Z9: le coeur interne redefini par 0Z reste inexecutable par authenticated');
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename LIKE 'daily_statement_%'
     AND cmd <> 'SELECT') = 0,
  'Z9: 0Z n introduit aucune policy d ecriture');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE event_type = 'status_changed'
     AND previous_status = 'provisional' AND new_status = 'superseded') >= 4,
  'Z9: chaque bascule provisional->superseded est auditee en append-only');

SELECT 'provisional lifecycle 0Z: PASS' AS status;
