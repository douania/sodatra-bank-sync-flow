-- ============================================================================
-- 0U — TESTS PIPELINE (R1/R2/R4/R5/R6, gates, rôles) — données 100 % synthétiques
-- ============================================================================
-- Tout le fichier tourne sous DateStyle 'ISO, MDY' : si une conversion de date
-- implicite se glissait dans le write path, 01/05/2026 deviendrait le 5 janvier
-- et les asserts de période échoueraient (T12 bout-en-bout).
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- Générateurs de payloads synthétiques.
CREATE OR REPLACE FUNCTION poc_test.mk_stmt(
  p_line_count integer, p_opening text, p_debits text, p_credits text, p_closing text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'currency', 'XOF',
    'period_start_date', '01/05/2026',
    'period_end_date', '31/05/2026',
    'statement_date', '31/05/2026',
    'opening_balance', p_opening,
    'total_debits', p_debits,
    'total_credits', p_credits,
    'closing_balance', p_closing,
    'calculated_closing', p_closing,
    'discrepancy', '0.00',
    'line_count', p_line_count)
$$;

CREATE OR REPLACE FUNCTION poc_test.mk_line(
  p_idx integer, p_hash text, p_direction text, p_amount text, p_signed text, p_date text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'source_line_index', p_idx,
    'transaction_date', p_date,
    'description_sanitized', 'SYNTHETIC LINE ' || p_hash,
    'direction', p_direction,
    'signed_amount', p_signed,
    'currency', 'XOF',
    'line_hash', p_hash)
    || CASE WHEN p_direction = 'debit'
            THEN jsonb_build_object('debit_amount', p_amount)
            ELSE jsonb_build_object('credit_amount', p_amount) END
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

-- ============================================================================
-- A. Négatifs de dépôt (fail-closed) — aucun état ne doit persister.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());

-- R4 : fingerprint absent.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_R4_FINGERPRINT%', 'R4 depot sans fingerprint rejete');

-- import_id absent.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_IDENTITY_REQUIRED%', 'depot sans import_id rejete');

-- Gate parser : ingestion_ready exige valid (R5/R6).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'needs_review',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_GATE_VALID%', 'ingestion_ready + parser needs_review rejete');

-- Anti-smuggling : clé raw_csv dans le statement.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00') || jsonb_build_object('raw_csv','x'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_PAYLOAD_KEY%', 'cle raw_csv dans statement rejetee');

-- Anti-smuggling : clé raw_text dans une ligne.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(
      poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026') || jsonb_build_object('raw_text','x')))
$neg$, '%STRUCTURED_CSV_PAYLOAD_KEY%', 'cle raw_text dans une ligne rejetee');

-- line_count incohérent.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(2,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_LINE_COUNT%', 'line_count incoherent rejete');

-- Date invalide dans une ligne (chemin complet).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','2026-05-02')))
$neg$, '%STRUCTURED_CSV_DATE_FORMAT%', 'date ISO dans ligne rejetee (chemin complet)');

-- Montant à 3 décimales (pas d'arrondi silencieux).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid',
    p_statement => poc_test.mk_stmt(1,'0.001','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_AMOUNT_SCALE%', 'montant 3 decimales rejete (chemin complet)');

-- Branche rejet : payload interdit / raison obligatoire (R6).
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'rejected', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_rejected_reason => 'SYNTH_REASON',
    p_statement => poc_test.mk_stmt(0,'0.00','0.00','0.00','0.00'))
$neg$, '%STRUCTURED_CSV_REJECT_NO_PAYLOAD%', 'rejet avec payload statement rejete');

SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'rejected', p_source_format => 'structured_csv_v1', p_bank => 'BKTEST')
$neg$, '%STRUCTURED_CSV_REASON_REQUIRED%', 'rejet sans raison rejete');

-- Dépôt stagé avec rejected_reason.
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_neg',
    p_raw_text_hash => 'rth_neg', p_import_id => 'poc:v1:NEG',
    p_parser_validation_status => 'valid', p_rejected_reason => 'SYNTH',
    p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
    p_lines => jsonb_build_array(poc_test.mk_line(0,'h_neg_1','credit','10.00','10.00','02/05/2026')))
$neg$, '%STRUCTURED_CSV_REASON_FORBIDDEN%', 'depot stage avec rejected_reason rejete');
ROLLBACK;

-- Aucun état résiduel après les négatifs.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) = 0
  AND (SELECT count(*) FROM public.bank_statement_import_events) = 0,
  'negatifs: aucun etat persiste (rollback total)'
);

-- ============================================================================
-- B. Branche 1 : dépôts rejetés / échoués (R6 : attempt + events seulement).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('b1_rejected', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'rejected', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_rejected_reason => 'SYNTH_NOT_CSV',
  p_parser_validation_status => 'unsupported'))::text);
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('b1_failed', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'failed', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_rejected_reason => 'SYNTH_RUNTIME_ERROR'))::text);
COMMIT;

SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = (poc_test.ctx_get('b1_rejected')::jsonb ->> 'attempt_id')::uuid) = 'rejected',
  'R6 depot rejete -> attempt rejected');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_staging) = 0,
  'R6 aucun staging pour rejete/echoue');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = (poc_test.ctx_get('b1_rejected')::jsonb ->> 'attempt_id')::uuid
     AND event_type IN ('attempt_received', 'attempt_rejected')) = 2,
  'R6 events attempt_received + attempt_rejected presents');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = (poc_test.ctx_get('b1_failed')::jsonb ->> 'attempt_id')::uuid) = 'failed',
  'depot echoue -> attempt failed');

-- ============================================================================
-- C. S1 : dépôt manager -> refus des non-habilités -> promotion admin.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'rejected', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_rejected_reason => 'SYNTH')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'CTO-4 role user ne peut pas deposer');
ROLLBACK;

BEGIN;
SELECT poc_test.as_anon();
SELECT poc_test.expect_error($neg$
  SELECT public.pre_ingest_structured_bank_statement(
    p_requested_status => 'rejected', p_source_format => 'structured_csv_v1',
    p_bank => 'BKTEST', p_rejected_reason => 'SYNTH')
$neg$, '%permission denied%', 'anon ne peut pas executer pre_ingest');
ROLLBACK;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s1_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_source_file_name_redacted => 'synthetic_statement_s1.csv',
  p_account_fingerprint => 'fp_synth_1', p_account_number_masked => '****1234',
  p_raw_text_hash => 'rth_s1_a', p_import_id => 'poc:v1:S1',
  p_parser_validation_status => 'valid',
  p_errors_count => 0, p_warnings_count => 0,
  p_runtime_version => 'synthetic-runtime-1', p_parser_version => 'synthetic-parser-1',
  p_statement => poc_test.mk_stmt(2,'1000.00','200.00','300.00','1100.00'),
  p_lines => jsonb_build_array(
    poc_test.mk_line(0,'h_s1_1','debit','200.00','-200.00','02/05/2026'),
    poc_test.mk_line(1,'h_s1_2','credit','300.00','300.00','03/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s1_attempt',  poc_test.ctx_get('s1_result')::jsonb ->> 'attempt_id');
SELECT poc_test.ctx_set('s1_staging',  poc_test.ctx_get('s1_result')::jsonb ->> 'staging_statement_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s1_result')::jsonb ->> 'final_status' = 'ingestion_ready',
  'S1 depot manager -> ingestion_ready');

-- Période stockée correctement malgré DateStyle MDY (T12 bout-en-bout).
SELECT poc_test.assert(
  (SELECT period_start_date FROM public.bank_statement_staging
   WHERE id = poc_test.ctx_get('s1_staging')::uuid) = DATE '2026-05-01'
  AND (SELECT period_end_date FROM public.bank_statement_staging
   WHERE id = poc_test.ctx_get('s1_staging')::uuid) = DATE '2026-05-31',
  'T12 chemin complet: periode 01/05->2026-05-01 sous MDY');

-- Refus de promotion : manager, auditor, user.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.promote_structured_bank_statement_import(poc_test.ctx_get('s1_attempt')::uuid)
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'CTO-3 manager ne peut pas promouvoir');
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.expect_error($neg$
  SELECT public.promote_structured_bank_statement_import(poc_test.ctx_get('s1_attempt')::uuid)
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'auditor ne peut pas promouvoir');
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.expect_error($neg$
  SELECT public.promote_structured_bank_statement_import(poc_test.ctx_get('s1_attempt')::uuid)
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'CTO-4 user ne peut pas promouvoir');
ROLLBACK;

-- Promotion admin.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s1_promote', (public.promote_structured_bank_statement_import(
  poc_test.ctx_get('s1_attempt')::uuid))::text);
COMMIT;
SELECT poc_test.ctx_set('s1_canonical', poc_test.ctx_get('s1_promote')::jsonb ->> 'canonical_statement_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s1_promote')::jsonb ->> 'outcome' = 'promoted',
  'S1 promotion admin -> promoted');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:S1' AND status = 'ingested') = 1,
  'S1 un canonical actif');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_lines_canonical
   WHERE canonical_statement_id = poc_test.ctx_get('s1_canonical')::uuid AND is_active) = 2,
  'S1 deux lignes actives');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s1_attempt')::uuid) = 'ingested'
  AND (SELECT status FROM public.bank_statement_staging
   WHERE id = poc_test.ctx_get('s1_staging')::uuid) = 'promoted',
  'S1 attempt ingested + staging promoted');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('s1_attempt')::uuid
     AND event_type IN ('attempt_received','pre_ingested','marked_ingestion_ready','promoted')) = 4,
  'S1 chaine d''events complete');

-- ============================================================================
-- D. R1/R2 au dépôt : duplicate exact puis conflict.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s2_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_1',
  p_raw_text_hash => 'rth_s1_a', p_import_id => 'poc:v1:S1',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(2,'1000.00','200.00','300.00','1100.00'),
  p_lines => jsonb_build_array(
    poc_test.mk_line(0,'h_s1_1','debit','200.00','-200.00','02/05/2026'),
    poc_test.mk_line(1,'h_s1_2','credit','300.00','300.00','03/05/2026'))))::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('s2_result')::jsonb ->> 'final_status' = 'duplicate',
  'R1 meme import_id + meme raw_text_hash -> duplicate');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_staging
   WHERE attempt_id = (poc_test.ctx_get('s2_result')::jsonb ->> 'attempt_id')::uuid) = 0,
  'R1 duplicate: aucun staging cree');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = (poc_test.ctx_get('s2_result')::jsonb ->> 'attempt_id')::uuid
     AND event_type = 'duplicate_detected'
     AND canonical_statement_id = poc_test.ctx_get('s1_canonical')::uuid) = 1,
  'R1 event duplicate_detected reference le canonical actif');

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s3_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_1',
  p_raw_text_hash => 'rth_s1_b', p_import_id => 'poc:v1:S1',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(2,'1000.00','200.00','350.00','1150.00'),
  p_lines => jsonb_build_array(
    poc_test.mk_line(0,'h_s1_1','debit','200.00','-200.00','02/05/2026'),
    poc_test.mk_line(1,'h_s1_2b','credit','350.00','350.00','04/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s3_attempt', poc_test.ctx_get('s3_result')::jsonb ->> 'attempt_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s3_result')::jsonb ->> 'final_status' = 'conflict',
  'R2 meme import_id + hash different -> conflict');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_staging
   WHERE attempt_id = poc_test.ctx_get('s3_attempt')::uuid AND status = 'not_promoted') = 1,
  'R2 conflict: staging quarantaine conserve (pour supersede)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical WHERE import_id = 'poc:v1:S1') = 1,
  'R2 canonical intact (aucun upsert)');

-- ============================================================================
-- E. R1/R2 au moment du promote (course dépôt/promotion).
-- ============================================================================
-- Deux dépôts identiques AVANT toute promotion, puis promotions successives.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s11_a', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_11',
  p_raw_text_hash => 'rth_s11', p_import_id => 'poc:v1:S11',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s11_1','credit','10.00','10.00','05/05/2026'))))::text);
SELECT poc_test.ctx_set('s11_b', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_11',
  p_raw_text_hash => 'rth_s11', p_import_id => 'poc:v1:S11',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','10.00','10.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s11_1','credit','10.00','10.00','05/05/2026'))))::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('s11_b')::jsonb ->> 'final_status' = 'ingestion_ready',
  'S11 second depot pre-promotion reste ingestion_ready (pas encore de canonical)');

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s11_p1', (public.promote_structured_bank_statement_import(
  (poc_test.ctx_get('s11_a')::jsonb ->> 'attempt_id')::uuid))::text);
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s11_p2', (public.promote_structured_bank_statement_import(
  (poc_test.ctx_get('s11_b')::jsonb ->> 'attempt_id')::uuid))::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('s11_p1')::jsonb ->> 'outcome' = 'promoted'
  AND poc_test.ctx_get('s11_p2')::jsonb ->> 'outcome' = 'duplicate',
  'T3 double promotion sequentielle: une seule gagne, l''autre duplicate');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:S11' AND status = 'ingested') = 1,
  'T3 un seul canonical actif S11');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_staging
   WHERE attempt_id = (poc_test.ctx_get('s11_b')::jsonb ->> 'attempt_id')::uuid) = 'promotion_failed',
  'T3 staging du duplicate clos (promotion_failed)');

-- Conflict au promote : deux contenus différents déposés avant promotion.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s12_d', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_12',
  p_raw_text_hash => 'rth_s12_a', p_import_id => 'poc:v1:S12',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','20.00','20.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s12_1','credit','20.00','20.00','06/05/2026'))))::text);
SELECT poc_test.ctx_set('s12_e', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_12',
  p_raw_text_hash => 'rth_s12_b', p_import_id => 'poc:v1:S12',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','25.00','25.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s12_2','credit','25.00','25.00','06/05/2026'))))::text);
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s12_p1', (public.promote_structured_bank_statement_import(
  (poc_test.ctx_get('s12_d')::jsonb ->> 'attempt_id')::uuid))::text);
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s12_p2', (public.promote_structured_bank_statement_import(
  (poc_test.ctx_get('s12_e')::jsonb ->> 'attempt_id')::uuid))::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('s12_p1')::jsonb ->> 'outcome' = 'promoted'
  AND poc_test.ctx_get('s12_p2')::jsonb ->> 'outcome' = 'conflict',
  'T4 promote sur contenu divergent -> conflict, pas d''upsert');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = (poc_test.ctx_get('s12_e')::jsonb ->> 'attempt_id')::uuid) = 'conflict',
  'T4 attempt marquee conflict');

-- ============================================================================
-- F. R5 : needs_review — escalation manager, approbation ADMIN SEUL (CTO-2).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s6_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'needs_review', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_6',
  p_raw_text_hash => 'rth_s6', p_import_id => 'poc:v1:S6',
  p_parser_validation_status => 'needs_review',
  p_warnings_count => 2,
  p_statement => poc_test.mk_stmt(1,'50.00','0.00','5.00','55.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s6_1','credit','5.00','5.00','07/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s6_attempt', poc_test.ctx_get('s6_result')::jsonb ->> 'attempt_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s6_result')::jsonb ->> 'final_status' = 'needs_review',
  'R5 parser needs_review -> attempt needs_review (jamais auto-promu)');

-- Escalation manager (seule action manager post-dépôt, CTO-3).
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s6_esc', (public.request_structured_bank_statement_manager_escalation(
  poc_test.ctx_get('s6_attempt')::uuid, 'SYNTH escalade pour revue'))::text);
COMMIT;
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('s6_attempt')::uuid
     AND event_type = 'review_requested'
     AND actor_id = poc_test.uid_manager()) = 1,
  'T14 escalation manager tracee (actor_id = manager)');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s6_attempt')::uuid) = 'needs_review',
  'T14 escalation ne change pas l''etat');

-- user ne peut pas escalader.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.expect_error($neg$
  SELECT public.request_structured_bank_statement_manager_escalation(
    poc_test.ctx_get('s6_attempt')::uuid, 'SYNTH')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'user ne peut pas escalader');
ROLLBACK;

-- promote (7.1) refuse le chemin needs_review.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error($neg$
  SELECT public.promote_structured_bank_statement_import(poc_test.ctx_get('s6_attempt')::uuid)
$neg$, '%STRUCTURED_CSV_PROMOTE_GATE%', 'R5 promote standard refuse needs_review');
ROLLBACK;

-- Approbation : manager refusé (CTO-2), admin accepté.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.approve_structured_bank_statement_needs_review_promotion(
    poc_test.ctx_get('s6_attempt')::uuid, 'SYNTH tentative manager')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'CTO-2 manager ne peut pas approuver needs_review');
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s6_approve', (public.approve_structured_bank_statement_needs_review_promotion(
  poc_test.ctx_get('s6_attempt')::uuid, 'SYNTH approbation humaine'))::text);
COMMIT;
SELECT poc_test.assert(
  poc_test.ctx_get('s6_approve')::jsonb ->> 'outcome' = 'promoted',
  'T6 approbation admin -> promoted');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('s6_attempt')::uuid
     AND event_type = 'promotion_requested'
     AND actor_id = poc_test.uid_admin()) = 1,
  'T6 event promotion_requested avec acteur humain');
SELECT poc_test.assert(
  (SELECT validation_status FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:S6' AND status = 'ingested') = 'needs_review',
  'T6 canonical porte validation_status needs_review');

-- ============================================================================
-- G. Reject humain (7.2) : admin seul, staging clos, re-promotion impossible.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s8_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_8',
  p_raw_text_hash => 'rth_s8', p_import_id => 'poc:v1:S8',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','30.00','30.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_s8_1','credit','30.00','30.00','08/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s8_attempt', poc_test.ctx_get('s8_result')::jsonb ->> 'attempt_id');

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.reject_structured_bank_statement_import(
    poc_test.ctx_get('s8_attempt')::uuid, 'SYNTH tentative manager')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'manager ne peut pas rejeter');
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s8_reject', (public.reject_structured_bank_statement_import(
  poc_test.ctx_get('s8_attempt')::uuid, 'SYNTH_REJECT_HUMAIN'))::text);
COMMIT;
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s8_attempt')::uuid) = 'rejected'
  AND (SELECT rejected_reason FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s8_attempt')::uuid) = 'SYNTH_REJECT_HUMAIN',
  'reject admin -> rejected + raison stockee');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_staging
   WHERE attempt_id = poc_test.ctx_get('s8_attempt')::uuid) = 'promotion_failed',
  'reject: staging clos (promotion_failed)');
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error($neg$
  SELECT public.promote_structured_bank_statement_import(poc_test.ctx_get('s8_attempt')::uuid)
$neg$, '%STRUCTURED_CSV_PROMOTE%', 'attempt rejetee non promouvable');
ROLLBACK;

RESET datestyle;
SELECT 'pipeline R1/R2/R4/R5/R6 + roles: PASS' AS status;
