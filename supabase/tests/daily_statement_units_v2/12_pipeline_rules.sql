-- ============================================================================
-- 0H — TESTS PIPELINE v2 : négatifs fail-closed, dépôt nominal, R1/R2/R3
-- ============================================================================
-- Tout le fichier tourne sous DateStyle 'ISO, MDY' : si une conversion de date
-- implicite se glissait dans le write path, 01/05/2026 deviendrait le 5
-- janvier et les asserts échoueraient (indépendance DateStyle bout-en-bout).
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- ============================================================================
-- A. Négatifs de dépôt (fail-closed) — aucun état ne doit persister.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());

-- Clé inconnue (non interdite) dans p_attempt => whitelist.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL) || jsonb_build_object('foo','bar'),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_PAYLOAD_KEY%', 'cle hors whitelist dans p_attempt rejetee');

-- Clé interdite raw_csv dans p_attempt => blocklist profonde (avant whitelist).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL) || jsonb_build_object('raw_csv','x'),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_FORBIDDEN_KEY%', 'raw_csv dans p_attempt rejete');

-- account_number dans une ligne => blocklist.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)
      || jsonb_build_object('account_number','synthetic')),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_FORBIDDEN_KEY%', 'account_number dans une ligne rejete');

-- decoded_text dans le guard context => blocklist.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1) || jsonb_build_object('decoded_text','x'))
$neg$, '%DAILY_STMT_FORBIDDEN_KEY%', 'decoded_text dans p_guard_context rejete');

-- iban profondement imbrique dans le guard => scan profond avant whitelist.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1) || jsonb_build_object('meta', jsonb_build_object('inner', jsonb_build_object('iban','x'))))
$neg$, '%DAILY_STMT_FORBIDDEN_KEY%', 'iban imbrique dans p_guard_context rejete');

-- Ligne orpheline (journee absente de p_units).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(
      poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0),
      poc_test.mk_line('BKTEST','09/05/2026', poc_test.hex64('neg_orphan'), 1, 1)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_ORPHAN%', 'ligne orpheline rejetee');

-- line_count incoherent avec les lignes recues.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026',
      ARRAY[poc_test.hex64('neg1'), poc_test.hex64('neg2')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_COUNT%', 'line_count incoherent rejete');

-- Doublon de day_unit_id dans p_units.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(
      poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged'),
      poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg2')], 'staged')),
    jsonb_build_array(
      poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0),
      poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg2'), 1, 1)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_UNIT_DUPLICATE%', 'doublon day_unit_id dans p_units rejete');

-- Doublon de daily_line_hash dans une meme unite.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026',
      ARRAY[poc_test.hex64('neg1'), poc_test.hex64('neg2')], 'staged')),
    jsonb_build_array(
      poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0),
      poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 2, 1)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_HASH_DUPLICATE%', 'doublon daily_line_hash dans une unite rejete');

-- daily_occurrence_ordinal < 1.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 0, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_ORDINAL%', 'ordinal 0 rejete');

-- accounting_date ligne <> accounting_date unite.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','03/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)
      || jsonb_build_object('accounting_date','03/05/2026')),
    poc_test.mk_guard(true, 2))
$neg$, '%DAILY_STMT_LINE_DATE_MISMATCH%', 'accounting_date ligne <> unite rejete');

-- currency ligne <> currency attempt.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)
      || jsonb_build_object('currency','EUR')),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_CURRENCY_MISMATCH%', 'currency ligne <> attempt rejete');

-- day_content_hash declare <> recalcul SQL.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')
      || jsonb_build_object('day_content_hash', poc_test.hex64('wrong'))),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_CONTENT_HASH_MISMATCH%', 'day_content_hash divergent du recalcul SQL rejete');

-- day_unit_id divergent du contexte attempt (unite construite pour une autre
-- banque) => gate de divergence bank/fingerprint/currency (D-0H-1).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('OTHERBANK','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('OTHERBANK','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_DAY_UNIT_ID_MISMATCH%', 'day_unit_id divergent du contexte attempt rejete');

-- Coherence direction/montant/signe (credit avec signed negatif).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)
      || jsonb_build_object('signed_amount', -10.00)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_LINE_ONE_AMOUNT%', 'credit avec signed_amount negatif rejete');

-- Masque de compte invalide.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL)
      || jsonb_build_object('account_number_masked','****12345'),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_MASKED_ACCOUNT%', 'masque 5 chiffres finaux rejete');

-- Nom de fichier non expurge.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL)
      || jsonb_build_object('source_file_name_redacted','exports/releve.csv'),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_FILE_NAME_SENSITIVE%', 'nom de fichier avec chemin rejete');

-- period_days incoherent avec la fenetre export.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','04/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 5))
$neg$, '%DAILY_STMT_PERIOD_DAYS_MISMATCH%', 'period_days incoherent rejete');

-- Date ISO dans une unite (chemin complet).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','2026-05-02', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','2026-05-02', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_DATE_FORMAT%', 'accounting_date ISO rejete (chemin complet)');

-- Montant a 3 decimales dans une unite (pas d'arrondi silencieux). Depuis
-- 0H-FIX-AMOUNT-STRICT-PARITY, le refus survient au FORMAT (parite TS).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')
      || jsonb_build_object('day_total_debits', 0.001)),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_AMOUNT_FORMAT%', 'montant 3 decimales rejete (chemin complet)');

ROLLBACK;

-- Rôles refusés : user et auditor ne déposent jamais ; anon n'a pas EXECUTE.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_ROLE_DENIED%', 'role user rejete au depot');
ROLLBACK;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','02/05/2026','02/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('neg1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('neg1'), 1, 0)),
    poc_test.mk_guard(true, 1))
$neg$, '%DAILY_STMT_ROLE_DENIED%', 'role auditor rejete au depot');
ROLLBACK;

BEGIN;
SELECT poc_test.as_anon();
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units('{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)
$neg$, '%permission denied%', 'anon sans EXECUTE sur la RPC de depot');
ROLLBACK;

-- Aucun état résiduel après les négatifs.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_import_events) = 0,
  'negatifs: aucun etat persiste (fail-closed all-or-nothing)'
);

-- ============================================================================
-- B. Dépôt nominal : 3 journées, lignes à plat, hash recalculés, audit.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('b_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','03/05/2026',NULL),
  jsonb_build_array(
    poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_a1')], 'staged'),
    poc_test.mk_unit('BKTEST','02/05/2026', ARRAY[poc_test.hex64('l_b1')], 'staged'),
    poc_test.mk_unit('BKTEST','03/05/2026', ARRAY[poc_test.hex64('l_c1'), poc_test.hex64('l_c2')], 'staged')),
  jsonb_build_array(
    poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_a1'), 1, 0),
    poc_test.mk_line('BKTEST','02/05/2026', poc_test.hex64('l_b1'), 1, 1),
    poc_test.mk_line('BKTEST','03/05/2026', poc_test.hex64('l_c1'), 1, 2),
    poc_test.mk_line('BKTEST','03/05/2026', poc_test.hex64('l_c2'), 1, 3)),
  poc_test.mk_guard(true, 3))::text);
COMMIT;

SELECT poc_test.ctx_set('b_attempt', (poc_test.ctx_get('b_result')::jsonb ->> 'attempt_id'));
SELECT poc_test.ctx_set('b_staging_01',
  (poc_test.ctx_get('b_result')::jsonb -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.ctx_set('b_staging_02',
  (poc_test.ctx_get('b_result')::jsonb -> 'units' -> 1 ->> 'staging_unit_id'));
SELECT poc_test.ctx_set('b_staging_03',
  (poc_test.ctx_get('b_result')::jsonb -> 'units' -> 2 ->> 'staging_unit_id'));

SELECT poc_test.assert(
  (SELECT count(*) FROM jsonb_array_elements(poc_test.ctx_get('b_result')::jsonb -> 'units') u
   WHERE u ->> 'unit_status' = 'staged') = 3,
  'nominal: 3 unites journalieres staged'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE attempt_id = poc_test.ctx_get('b_attempt')::uuid) = 3
  AND (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE attempt_id = poc_test.ctx_get('b_attempt')::uuid) = 4,
  'nominal: 3 unites et 4 lignes stagees'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('b_attempt')::uuid AND event_type = 'attempt_received') = 1
  AND (SELECT count(*) FROM public.daily_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('b_attempt')::uuid AND event_type = 'unit_staged') = 3,
  'nominal: audit attempt_received + 3 unit_staged'
);
-- day_content_hash stocke = recalcul SQL sur les lignes stagees.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM public.daily_statement_units_staging u
    WHERE u.attempt_id = poc_test.ctx_get('b_attempt')::uuid
      AND u.day_content_hash <> public.daily_stmt_day_content_hash(
        u.day_unit_id,
        (SELECT array_agg(l.daily_line_hash) FROM public.daily_statement_lines_staging l
         WHERE l.staging_unit_id = u.id))),
  'nominal: day_content_hash stocke = recalcul sur lignes stagees'
);
SELECT poc_test.assert(
  (SELECT requested_mode FROM public.daily_statement_export_attempts
   WHERE id = poc_test.ctx_get('b_attempt')::uuid) = 'daily'
  AND (SELECT units_total FROM public.daily_statement_export_attempts
   WHERE id = poc_test.ctx_get('b_attempt')::uuid) = 3
  AND (SELECT backfill_grant_reference FROM public.daily_statement_export_attempts
   WHERE id = poc_test.ctx_get('b_attempt')::uuid) IS NULL,
  'nominal: attempt daily, 3 unites, sans grant'
);

-- ============================================================================
-- C. Promotion admin + R1 duplicate au re-dépôt.
-- ============================================================================
-- Manager ne promeut jamais.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$, poc_test.ctx_get('b_staging_01')),
  '%DAILY_STMT_ROLE_DENIED%', 'manager ne peut pas promouvoir');
ROLLBACK;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('c_promote_outcome',
  (public.promote_daily_statement_unit(poc_test.ctx_get('b_staging_01')::uuid)) ->> 'outcome');
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('c_promote_outcome') = 'promoted',
  'promotion: unite 01/05 promue'
);
SELECT poc_test.ctx_set('c_active_canonical',
  (SELECT id::text FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.day_unit_id('BKTEST','01/05/2026') AND status = 'ingested'));

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = poc_test.ctx_get('c_active_canonical')::uuid AND is_active) = 1,
  'promotion: 1 ligne canonical active'
);

-- Une unite deja promue n'est pas re-promouvable.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$, poc_test.ctx_get('b_staging_01')),
  '%DAILY_STMT_PROMOTE_GATE%', 'unite deja promue non re-promouvable');
ROLLBACK;

-- R1 : re-depot de la MEME journee avec le MEME contenu => duplicate controle,
-- AUCUNE ligne stagee (le contenu identique vit deja en canonical).
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('c_r1_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','01/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_a1')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_a1'), 1, 0)),
  poc_test.mk_guard(true, 1))::text);
COMMIT;
SELECT poc_test.assert(
  (poc_test.ctx_get('c_r1_result')::jsonb -> 'units' -> 0 ->> 'unit_status') = 'duplicate'
  AND (poc_test.ctx_get('c_r1_result')::jsonb -> 'units' -> 0 ->> 'active_canonical_unit_id')
      = poc_test.ctx_get('c_active_canonical'),
  'R1: re-depot journee identique => duplicate controle referencant le canonical actif'
);
SELECT poc_test.ctx_set('c_r1_staging',
  (poc_test.ctx_get('c_r1_result')::jsonb -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('c_r1_staging')::uuid) = 'duplicate'
  AND (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('c_r1_staging')::uuid) = 0,
  'R1: unite duplicate enregistree SANS lignes stagees'
);
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE staging_unit_id = poc_test.ctx_get('c_r1_staging')::uuid
            AND event_type = 'unit_duplicate'),
  'R1: event unit_duplicate present'
);
-- Une unite duplicate n'est jamais promouvable.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$, poc_test.ctx_get('c_r1_staging')),
  '%DAILY_STMT_PROMOTE_GATE%', 'R1: unite duplicate non promouvable');
ROLLBACK;

-- ============================================================================
-- D. R2 : meme journee, contenu divergent => conflict controle (quarantaine).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('d_r2_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','01/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_b1x')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_b1x'), 1, 0)),
  poc_test.mk_guard(true, 1))::text);
COMMIT;
SELECT poc_test.ctx_set('d_conflict_staging',
  (poc_test.ctx_get('d_r2_result')::jsonb -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.assert(
  (poc_test.ctx_get('d_r2_result')::jsonb -> 'units' -> 0 ->> 'unit_status') = 'conflict',
  'R2: contenu divergent => conflict controle'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('d_conflict_staging')::uuid) = 1,
  'R2: la quarantaine conflict CONSERVE ses lignes (matiere du supersede)'
);
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE staging_unit_id = poc_test.ctx_get('d_conflict_staging')::uuid
            AND event_type = 'unit_conflict'),
  'R2: event unit_conflict present'
);
-- Pas de promotion silencieuse d'un conflict par la RPC promote.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$, poc_test.ctx_get('d_conflict_staging')),
  '%DAILY_STMT_PROMOTE_GATE%', 'R2: unite conflict jamais promue par promote (supersede requis)');
ROLLBACK;

-- ============================================================================
-- E. R3 : daily_line_hash ACTIF sous une AUTRE journee => needs_review.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('e_r3_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','04/05/2026','04/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','04/05/2026', ARRAY[poc_test.hex64('l_a1')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','04/05/2026', poc_test.hex64('l_a1'), 1, 0)),
  poc_test.mk_guard(true, 1))::text);
COMMIT;
SELECT poc_test.ctx_set('e_r3_staging',
  (poc_test.ctx_get('e_r3_result')::jsonb -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.assert(
  (poc_test.ctx_get('e_r3_result')::jsonb -> 'units' -> 0 ->> 'unit_status') = 'needs_review',
  'R3: hash actif sous une autre journee => needs_review'
);
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE staging_unit_id = poc_test.ctx_get('e_r3_staging')::uuid
            AND event_type = 'unit_needs_review'),
  'R3: event unit_needs_review present'
);
-- Jamais de promotion silencieuse d'un needs_review.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$, poc_test.ctx_get('e_r3_staging')),
  '%DAILY_STMT_PROMOTE_GATE%', 'R3: unite needs_review jamais promue silencieusement');
ROLLBACK;

SELECT 'pipeline rules v2: PASS' AS status;
