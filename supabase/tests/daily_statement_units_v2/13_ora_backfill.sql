-- ============================================================================
-- 0H — TESTS ORA (journée non close) & BACKFILL (grant obligatoire)
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- ============================================================================
-- O. ORA — provisional fail-closed, re-dérivé côté serveur.
-- ============================================================================

-- O1 : ORA avec export_reference_date : accounting_date >= ref => provisional.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('o1_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','ORA','01/06/2026','03/06/2026','03/06/2026'),
  jsonb_build_array(
    poc_test.mk_unit('ORA','01/06/2026', ARRAY[poc_test.hex64('o_a1')], 'staged'),
    poc_test.mk_unit('ORA','02/06/2026', ARRAY[poc_test.hex64('o_b1')], 'staged'),
    poc_test.mk_unit('ORA','03/06/2026', ARRAY[poc_test.hex64('o_c1')], 'provisional')),
  jsonb_build_array(
    poc_test.mk_line('ORA','01/06/2026', poc_test.hex64('o_a1'), 1, 0),
    poc_test.mk_line('ORA','02/06/2026', poc_test.hex64('o_b1'), 1, 1),
    poc_test.mk_line('ORA','03/06/2026', poc_test.hex64('o_c1'), 1, 2)),
  poc_test.mk_guard(true, 3))::text);
COMMIT;
SELECT poc_test.assert(
  (poc_test.ctx_get('o1_result')::jsonb -> 'units' -> 0 ->> 'unit_status') = 'staged'
  AND (poc_test.ctx_get('o1_result')::jsonb -> 'units' -> 1 ->> 'unit_status') = 'staged'
  AND (poc_test.ctx_get('o1_result')::jsonb -> 'units' -> 2 ->> 'unit_status') = 'provisional',
  'O1: ORA avec ref => jours < ref staged, jour >= ref provisional'
);
SELECT poc_test.ctx_set('o1_provisional_staging',
  (poc_test.ctx_get('o1_result')::jsonb -> 'units' -> 2 ->> 'staging_unit_id'));
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE staging_unit_id = poc_test.ctx_get('o1_provisional_staging')::uuid
            AND event_type = 'unit_provisional_held'),
  'O1: event unit_provisional_held present'
);

-- O2 : declaration divergente de la regle serveur => rejet.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','ORA','11/06/2026','12/06/2026','12/06/2026'),
    jsonb_build_array(
      poc_test.mk_unit('ORA','11/06/2026', ARRAY[poc_test.hex64('o_x1')], 'staged'),
      poc_test.mk_unit('ORA','12/06/2026', ARRAY[poc_test.hex64('o_y1')], 'staged')),
    jsonb_build_array(
      poc_test.mk_line('ORA','11/06/2026', poc_test.hex64('o_x1'), 1, 0),
      poc_test.mk_line('ORA','12/06/2026', poc_test.hex64('o_y1'), 1, 1)),
    poc_test.mk_guard(true, 2))
$neg$, '%DAILY_STMT_UNIT_STATUS_MISMATCH%', 'O2: jour >= ref declare staged rejete');
ROLLBACK;

-- O3 : ORA SANS export_reference_date : dernier jour provisional (fail-closed).
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('o3_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','ORA','04/06/2026','05/06/2026',NULL),
  jsonb_build_array(
    poc_test.mk_unit('ORA','04/06/2026', ARRAY[poc_test.hex64('o_d1')], 'staged'),
    poc_test.mk_unit('ORA','05/06/2026', ARRAY[poc_test.hex64('o_e1')], 'provisional')),
  jsonb_build_array(
    poc_test.mk_line('ORA','04/06/2026', poc_test.hex64('o_d1'), 1, 0),
    poc_test.mk_line('ORA','05/06/2026', poc_test.hex64('o_e1'), 1, 1)),
  poc_test.mk_guard(true, 2))::text);
COMMIT;
SELECT poc_test.assert(
  (poc_test.ctx_get('o3_result')::jsonb -> 'units' -> 0 ->> 'unit_status') = 'staged'
  AND (poc_test.ctx_get('o3_result')::jsonb -> 'units' -> 1 ->> 'unit_status') = 'provisional',
  'O3: ORA sans ref => dernier jour provisional (fail-closed)'
);
SELECT poc_test.ctx_set('o3_provisional_staging',
  (poc_test.ctx_get('o3_result')::jsonb -> 'units' -> 1 ->> 'staging_unit_id'));

-- O4 : ORA sans ref, dernier jour declare staged => rejet.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','ORA','13/06/2026','14/06/2026',NULL),
    jsonb_build_array(
      poc_test.mk_unit('ORA','13/06/2026', ARRAY[poc_test.hex64('o_z1')], 'staged'),
      poc_test.mk_unit('ORA','14/06/2026', ARRAY[poc_test.hex64('o_w1')], 'staged')),
    jsonb_build_array(
      poc_test.mk_line('ORA','13/06/2026', poc_test.hex64('o_z1'), 1, 0),
      poc_test.mk_line('ORA','14/06/2026', poc_test.hex64('o_w1'), 1, 1)),
    poc_test.mk_guard(true, 2))
$neg$, '%DAILY_STMT_UNIT_STATUS_MISMATCH%', 'O4: ORA sans ref, dernier jour declare staged rejete');
ROLLBACK;

-- O5 : une unite provisional n'est JAMAIS promouvable.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$,
         poc_test.ctx_get('o1_provisional_staging')),
  '%DAILY_STMT_PROVISIONAL_NOT_PROMOTABLE%', 'O5: provisional (avec ref) non promouvable');
SELECT poc_test.expect_error(
  format($q$ SELECT public.promote_daily_statement_unit(%L::uuid) $q$,
         poc_test.ctx_get('o3_provisional_staging')),
  '%DAILY_STMT_PROVISIONAL_NOT_PROMOTABLE%', 'O5: provisional (sans ref) non promouvable');
ROLLBACK;

-- O6 : BDK sans export_reference_date n'herite PAS de la regle ORA.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('o6_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BDK','01/06/2026','02/06/2026',NULL),
  jsonb_build_array(
    poc_test.mk_unit('BDK','01/06/2026', ARRAY[poc_test.hex64('k_a1')], 'staged'),
    poc_test.mk_unit('BDK','02/06/2026', ARRAY[poc_test.hex64('k_b1')], 'staged')),
  jsonb_build_array(
    poc_test.mk_line('BDK','01/06/2026', poc_test.hex64('k_a1'), 1, 0),
    poc_test.mk_line('BDK','02/06/2026', poc_test.hex64('k_b1'), 1, 1)),
  poc_test.mk_guard(true, 2))::text);
COMMIT;
SELECT poc_test.assert(
  (SELECT count(*) FROM jsonb_array_elements(poc_test.ctx_get('o6_result')::jsonb -> 'units') u
   WHERE u ->> 'unit_status' = 'staged') = 2,
  'O6: BDK sans ref => toutes les unites staged (pas d''heritage ORA)'
);

-- ============================================================================
-- B. Backfill — cap daily maintenu, grant obligatoire, admin seul, audit.
-- ============================================================================

-- B1 : daily 90 jours => cap 0C maintenu.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','01/01/2026','31/03/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','15/01/2026', ARRAY[poc_test.hex64('bf_1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','15/01/2026', poc_test.hex64('bf_1'), 1, 0)),
    poc_test.mk_guard(true, 90))
$neg$, '%DAILY_STMT_PERIOD_CAP%', 'B1: daily 90 jours rejete (cap 45 maintenu)');

-- B2 : grant sur un depot daily => interdit.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','05/05/2026','05/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','05/05/2026', ARRAY[poc_test.hex64('bf_2')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','05/05/2026', poc_test.hex64('bf_2'), 1, 0)),
    poc_test.mk_guard(true, 1, 'CTO-BACKFILL-GRANT-0001'))
$neg$, '%DAILY_STMT_GRANT_FORBIDDEN%', 'B2: grant sur depot daily rejete');

-- B6 : daily non ingestion-ready => rejet (gate 0C).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','05/05/2026','05/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','05/05/2026', ARRAY[poc_test.hex64('bf_2')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','05/05/2026', poc_test.hex64('bf_2'), 1, 0)),
    poc_test.mk_guard(false, 1))
$neg$, '%DAILY_STMT_INGESTION_READY_REQUIRED%', 'B6: daily non ingestion-ready rejete');

-- B7 : bridge_guard_passed=false => aucun depot.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('daily','BKTEST','05/05/2026','05/05/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','05/05/2026', ARRAY[poc_test.hex64('bf_2')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','05/05/2026', poc_test.hex64('bf_2'), 1, 0)),
    jsonb_build_object('ingestion_ready', true, 'period_days', 1,
                       'bridge_guard_passed', false, 'backfill_grant_reference', NULL))
$neg$, '%DAILY_STMT_BRIDGE_GUARD_FAILED%', 'B7: bridge guard false rejete');
ROLLBACK;

-- B3 : backfill sans grant (admin) => rejet.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('backfill','BKTEST','01/01/2026','31/03/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','15/01/2026', ARRAY[poc_test.hex64('bf_1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','15/01/2026', poc_test.hex64('bf_1'), 1, 0)),
    poc_test.mk_guard(false, 90))
$neg$, '%DAILY_STMT_GRANT_REQUIRED%', 'B3: backfill sans grant rejete');
ROLLBACK;

-- B4 : backfill par un manager => admin seul.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_daily_statement_units(
    poc_test.mk_attempt('backfill','BKTEST','01/01/2026','31/03/2026',NULL),
    jsonb_build_array(poc_test.mk_unit('BKTEST','15/01/2026', ARRAY[poc_test.hex64('bf_1')], 'staged')),
    jsonb_build_array(poc_test.mk_line('BKTEST','15/01/2026', poc_test.hex64('bf_1'), 1, 0)),
    poc_test.mk_guard(false, 90, 'CTO-BACKFILL-GRANT-0001'))
$neg$, '%DAILY_STMT_BACKFILL_ADMIN_ONLY%', 'B4: backfill manager rejete (admin seul)');
ROLLBACK;

-- B5 : backfill admin + grant => accepte en staging dedie, audite.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('b5_result', public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('backfill','BKTEST','01/01/2026','31/03/2026',NULL),
  jsonb_build_array(
    poc_test.mk_unit('BKTEST','15/01/2026', ARRAY[poc_test.hex64('bf_1')], 'staged'),
    poc_test.mk_unit('BKTEST','20/02/2026', ARRAY[poc_test.hex64('bf_3')], 'staged')),
  jsonb_build_array(
    poc_test.mk_line('BKTEST','15/01/2026', poc_test.hex64('bf_1'), 1, 0),
    poc_test.mk_line('BKTEST','20/02/2026', poc_test.hex64('bf_3'), 1, 1)),
  poc_test.mk_guard(false, 90, 'CTO-BACKFILL-GRANT-0001'))::text);
COMMIT;
SELECT poc_test.ctx_set('b5_attempt', (poc_test.ctx_get('b5_result')::jsonb ->> 'attempt_id'));
SELECT poc_test.assert(
  (SELECT requested_mode FROM public.daily_statement_export_attempts
   WHERE id = poc_test.ctx_get('b5_attempt')::uuid) = 'backfill'
  AND (SELECT backfill_grant_reference FROM public.daily_statement_export_attempts
   WHERE id = poc_test.ctx_get('b5_attempt')::uuid) = 'CTO-BACKFILL-GRANT-0001',
  'B5: attempt backfill enregistre avec son grant'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM jsonb_array_elements(poc_test.ctx_get('b5_result')::jsonb -> 'units') u
   WHERE u ->> 'unit_status' = 'staged') = 2,
  'B5: 2 unites backfill stagees'
);
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE attempt_id = poc_test.ctx_get('b5_attempt')::uuid
            AND event_type = 'backfill_deposit'
            AND safe_details ->> 'backfill_grant_reference' = 'CTO-BACKFILL-GRANT-0001'),
  'B5: event backfill_deposit avec grant dans safe_details'
);

SELECT 'ORA & backfill v2: PASS' AS status;
