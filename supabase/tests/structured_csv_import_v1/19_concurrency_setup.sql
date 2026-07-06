-- ============================================================================
-- 0U — SETUP CONCURRENCE (T16) — préparé AVANT le lancement des deux sessions
-- ============================================================================
\set ON_ERROR_STOP on

-- C1 : deux dépôts identiques (même import_id, même hash) avant promotion.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('c1_a', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_c1',
  p_raw_text_hash => 'rth_c1', p_import_id => 'poc:v1:C1',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','40.00','40.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_c1_1','credit','40.00','40.00','10/05/2026')))
  ) ->> 'attempt_id');
SELECT poc_test.ctx_set('c1_b', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_c1',
  p_raw_text_hash => 'rth_c1', p_import_id => 'poc:v1:C1',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','40.00','40.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_c1_1','credit','40.00','40.00','10/05/2026')))
  ) ->> 'attempt_id');
COMMIT;

-- C2 : un canonical actif + deux conflits candidats au supersede.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('c2_seed', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_c2',
  p_raw_text_hash => 'rth_c2_a', p_import_id => 'poc:v1:C2',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','50.00','50.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_c2_a','credit','50.00','50.00','11/05/2026')))
  ) ->> 'attempt_id');
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('c2_canonical', (public.promote_structured_bank_statement_import(
  poc_test.ctx_get('c2_seed')::uuid)) ->> 'canonical_statement_id');
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('c2_x', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_c2',
  p_raw_text_hash => 'rth_c2_x', p_import_id => 'poc:v1:C2',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','55.00','55.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_c2_x','credit','55.00','55.00','11/05/2026')))
  ) ->> 'attempt_id');
SELECT poc_test.ctx_set('c2_y', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_c2',
  p_raw_text_hash => 'rth_c2_y', p_import_id => 'poc:v1:C2',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(1,'0.00','0.00','60.00','60.00'),
  p_lines => jsonb_build_array(poc_test.mk_line(0,'h_c2_y','credit','60.00','60.00','11/05/2026')))
  ) ->> 'attempt_id');
COMMIT;

SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('c2_x')::uuid) = 'conflict'
  AND (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('c2_y')::uuid) = 'conflict',
  'setup C2: deux conflits candidats au supersede');

SELECT 'setup concurrence: PASS' AS status;
