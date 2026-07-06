-- ============================================================================
-- 0U — TESTS SUPERSEDE (T11/T13/T13bis), R3, IMMUTABILITÉ (T9/T10), SAFE_DETAILS (T15)
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- A. S4 : supersede avec lignes communes (T13 — le scénario que l'unicité
--    globale abandonnée en 0R rendait impossible).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.supersede_structured_bank_statement_import(
    poc_test.ctx_get('s1_canonical')::uuid, poc_test.ctx_get('s3_attempt')::uuid, 'SYNTH')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'CTO-3 manager ne peut pas supersede');
ROLLBACK;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s4_result', (public.supersede_structured_bank_statement_import(
  poc_test.ctx_get('s1_canonical')::uuid,
  poc_test.ctx_get('s3_attempt')::uuid,
  'SYNTH remplacement par contenu corrige'))::text);
COMMIT;
SELECT poc_test.ctx_set('s1_canonical_v2', poc_test.ctx_get('s4_result')::jsonb ->> 'new_canonical_statement_id');

SELECT poc_test.assert(
  poc_test.ctx_get('s4_result')::jsonb ->> 'outcome' = 'superseded',
  'T11 supersede -> outcome superseded');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_canonical
   WHERE id = poc_test.ctx_get('s1_canonical')::uuid) = 'superseded'
  AND (SELECT superseded_by FROM public.bank_statement_canonical
   WHERE id = poc_test.ctx_get('s1_canonical')::uuid) = poc_test.ctx_get('s1_canonical_v2')::uuid
  AND (SELECT superseded_at FROM public.bank_statement_canonical
   WHERE id = poc_test.ctx_get('s1_canonical')::uuid) IS NOT NULL,
  'T11 chaine superseded_by/superseded_at coherente (FK differee)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:S1' AND status = 'ingested') = 1,
  'T11 exactement un canonical actif apres supersede');

-- T13 : la ligne commune h_s1_1 existe 2 fois (historique), active 1 seule fois.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_lines_canonical WHERE line_hash = 'h_s1_1') = 2
  AND (SELECT count(*) FROM public.bank_statement_lines_canonical
       WHERE line_hash = 'h_s1_1' AND is_active) = 1
  AND (SELECT canonical_statement_id FROM public.bank_statement_lines_canonical
       WHERE line_hash = 'h_s1_1' AND is_active) = poc_test.ctx_get('s1_canonical_v2')::uuid,
  'T13 ligne commune promue: 2 versions, 1 seule active (nouveau canonical)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_lines_canonical
   WHERE canonical_statement_id = poc_test.ctx_get('s1_canonical')::uuid AND is_active) = 0,
  'T13 anciennes lignes toutes desactivees mais conservees (append-only)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_lines_canonical
   WHERE canonical_statement_id = poc_test.ctx_get('s1_canonical')::uuid) = 2,
  'T13 anciennes lignes lisibles (historique)');

-- T13bis : invariant Option A — aucune divergence is_active / statut parent.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_canonical l
    JOIN public.bank_statement_canonical c ON c.id = l.canonical_statement_id
    WHERE (l.is_active AND c.status <> 'ingested')
       OR (NOT l.is_active AND c.status = 'ingested')),
  'T13bis zero divergence is_active vs statut parent (tout le pipeline)');

-- Traçabilité : ancien pipeline superseded, events écrits.
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s1_attempt')::uuid) = 'superseded'
  AND (SELECT status FROM public.bank_statement_staging
   WHERE id = poc_test.ctx_get('s1_staging')::uuid) = 'superseded'
  AND (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s3_attempt')::uuid) = 'ingested',
  'T11 ancien attempt/staging superseded, nouveau ingested');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE canonical_statement_id = poc_test.ctx_get('s1_canonical')::uuid
     AND event_type = 'superseded') = 1,
  'T11 event superseded sur l''ancien canonical');

-- ============================================================================
-- B. Supersede périmé (stale) puis résolution keep_existing (7.4).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s9_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_1',
  p_raw_text_hash => 'rth_s1_c', p_import_id => 'poc:v1:S1',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(2,'1000.00','200.00','360.00','1160.00'),
  p_lines => jsonb_build_array(
    poc_test.mk_line(0,'h_s1_1','debit','200.00','-200.00','02/05/2026'),
    poc_test.mk_line(1,'h_s1_2c','credit','360.00','360.00','05/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s9_attempt', poc_test.ctx_get('s9_result')::jsonb ->> 'attempt_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s9_result')::jsonb ->> 'final_status' = 'conflict',
  'S9 nouveau contenu vs canonical v2 -> conflict');

-- Cible périmée : l'ancien canonical n'est plus actif.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error($neg$
  SELECT public.supersede_structured_bank_statement_import(
    poc_test.ctx_get('s1_canonical')::uuid, poc_test.ctx_get('s9_attempt')::uuid, 'SYNTH')
$neg$, '%STRUCTURED_CSV_STALE_CANONICAL%', 'T16 supersede sur cible perimee refuse');
ROLLBACK;

-- keep_existing : manager refusé, admin accepté.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error($neg$
  SELECT public.resolve_structured_bank_statement_conflict_keep_existing(
    poc_test.ctx_get('s9_attempt')::uuid, 'SYNTH')
$neg$, '%STRUCTURED_CSV_ROLE_DENIED%', 'manager ne peut pas resoudre keep_existing');
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s9_keep', (public.resolve_structured_bank_statement_conflict_keep_existing(
  poc_test.ctx_get('s9_attempt')::uuid, 'SYNTH conserver le canonical existant'))::text);
COMMIT;
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('s9_attempt')::uuid) = 'rejected',
  '7.4 keep_existing -> attempt rejected');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('s9_attempt')::uuid
     AND event_type = 'status_changed'
     AND safe_details ->> 'resolution' = 'keep_existing') = 1,
  '7.4 event status_changed resolution=keep_existing');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:S1' AND status = 'ingested') = 1,
  '7.4 canonical actif inchange');

-- ============================================================================
-- C. R3 : line_hash actif sous un AUTRE import_id.
-- ============================================================================
-- h_s1_2b est actif sous poc:v1:S1 (canonical v2) ; un dépôt S7 le contenant
-- doit être routé needs_review, et l'approbation doit refuser tant que le
-- chevauchement est actif.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s7_result', (public.pre_ingest_structured_bank_statement(
  p_requested_status => 'ingestion_ready', p_source_format => 'structured_csv_v1',
  p_bank => 'BKTEST', p_account_fingerprint => 'fp_synth_7',
  p_raw_text_hash => 'rth_s7', p_import_id => 'poc:v1:S7',
  p_parser_validation_status => 'valid',
  p_statement => poc_test.mk_stmt(2,'0.00','0.00','360.00','360.00'),
  p_lines => jsonb_build_array(
    poc_test.mk_line(0,'h_s1_2b','credit','350.00','350.00','04/05/2026'),
    poc_test.mk_line(1,'h_s7_1','credit','10.00','10.00','09/05/2026'))))::text);
COMMIT;
SELECT poc_test.ctx_set('s7_attempt', poc_test.ctx_get('s7_result')::jsonb ->> 'attempt_id');
SELECT poc_test.assert(
  poc_test.ctx_get('s7_result')::jsonb ->> 'final_status' = 'needs_review',
  'R3 chevauchement actif inter-import -> route needs_review');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('s7_attempt')::uuid
     AND event_type = 'marked_needs_review'
     AND safe_details ->> 'reason_code' = 'line_hash_scope_conflict') = 1,
  'R3 event motive (reason_code=line_hash_scope_conflict)');
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error($neg$
  SELECT public.approve_structured_bank_statement_needs_review_promotion(
    poc_test.ctx_get('s7_attempt')::uuid, 'SYNTH tentative approbation')
$neg$, '%STRUCTURED_CSV_R3_ACTIVE_OVERLAP%', 'R3 approbation refusee tant que chevauchement actif');
ROLLBACK;

-- ============================================================================
-- D. Immutabilité / append-only : écritures directes refusées (T9/T10).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_import_attempts (source_format, bank) VALUES ('x','x') $neg$,
  '%permission denied%', 'CTO-7 INSERT direct attempts refuse (meme admin)');
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_staging (attempt_id, import_id, raw_text_hash, bank,
        account_fingerprint, currency, period_start_date, period_end_date, opening_balance,
        total_debits, total_credits, closing_balance, validation_status, line_count)
        VALUES (poc_test.ctx_get('s1_attempt')::uuid, 'x', 'x', 'x', 'x', 'XOF',
        DATE '2026-05-01', DATE '2026-05-31', 0, 0, 0, 0, 'valid', 0) $neg$,
  '%permission denied%', 'CTO-7 INSERT direct staging refuse');
SELECT poc_test.expect_error(
  $neg$ UPDATE public.bank_statement_canonical SET closing_balance = 0 $neg$,
  '%permission denied%', 'T10 UPDATE direct canonical refuse');
SELECT poc_test.expect_error(
  $neg$ UPDATE public.bank_statement_lines_canonical SET is_active = false $neg$,
  '%permission denied%', 'T10 UPDATE direct is_active refuse (Option A: RPC uniquement)');
SELECT poc_test.expect_error(
  $neg$ DELETE FROM public.bank_statement_canonical $neg$,
  '%permission denied%', 'T10 DELETE direct canonical refuse');
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_import_events (attempt_id, event_type)
        VALUES (poc_test.ctx_get('s1_attempt')::uuid, 'status_changed') $neg$,
  '%permission denied%', 'T9 INSERT direct events refuse (RPC 7.8 seul point d''ecriture)');
SELECT poc_test.expect_error(
  $neg$ UPDATE public.bank_statement_import_events SET safe_message = 'x' $neg$,
  '%permission denied%', 'T9 UPDATE events refuse (append-only)');
SELECT poc_test.expect_error(
  $neg$ DELETE FROM public.bank_statement_import_events $neg$,
  '%permission denied%', 'T9 DELETE events refuse (append-only)');
ROLLBACK;

-- service_role : lecture possible (BYPASSRLS plateforme) mais écriture révoquée.
BEGIN;
SELECT set_config('role', 'service_role', true);
SELECT poc_test.expect_error(
  $neg$ UPDATE public.bank_statement_canonical SET closing_balance = 0 $neg$,
  '%permission denied%', 'service_role ne peut pas ecrire canonical');
ROLLBACK;

-- ============================================================================
-- E. safe_details (T15) : CHECK table + whitelist + scalaires (imbrication).
-- ============================================================================
-- E.1 Ceinture table (contournement RPC en owner) : clé bannie top-level.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_import_events (attempt_id, event_type, safe_details)
        VALUES (poc_test.ctx_get('s1_attempt')::uuid, 'status_changed', '{"raw_csv": "x"}'::jsonb) $neg$,
  '%events_safe_details_no_banned_keys%', 'T15 CHECK table: cle bannie top-level refusee');

-- E.2 RPC 7.8 : clé bannie => refus whitelist (avant même le CHECK).
SELECT poc_test.expect_error(
  $neg$ SELECT public.structured_csv_append_audit_event(NULL,
        poc_test.ctx_get('s1_attempt')::uuid, NULL, NULL, NULL, NULL,
        'status_changed', NULL, NULL, 'x', '{"raw_csv": "x"}'::jsonb) $neg$,
  '%STRUCTURED_CSV_SAFE_DETAILS_KEY%', 'T15 RPC: cle bannie refusee (whitelist)');

-- E.3 RPC 7.8 : clé hors whitelist mais non bannie => refus.
SELECT poc_test.expect_error(
  $neg$ SELECT public.structured_csv_append_audit_event(NULL,
        poc_test.ctx_get('s1_attempt')::uuid, NULL, NULL, NULL, NULL,
        'status_changed', NULL, NULL, 'x', '{"foo": "bar"}'::jsonb) $neg$,
  '%STRUCTURED_CSV_SAFE_DETAILS_KEY%', 'T15 RPC: cle hors whitelist refusee');

-- E.4 RPC 7.8 : clé bannie IMBRIQUÉE sous une clé autorisée => refus scalaire.
SELECT poc_test.expect_error(
  $neg$ SELECT public.structured_csv_append_audit_event(NULL,
        poc_test.ctx_get('s1_attempt')::uuid, NULL, NULL, NULL, NULL,
        'status_changed', NULL, NULL, 'x', '{"resolution": {"raw_csv": "x"}}'::jsonb) $neg$,
  '%STRUCTURED_CSV_SAFE_DETAILS_SCALAR%', 'T15 RPC: imbrication refusee (scalaires uniquement)');

-- E.5 RPC 7.8 : payload conforme accepté (clés whitelistees, valeurs scalaires).
SELECT poc_test.assert(
  public.structured_csv_append_audit_event(NULL,
    poc_test.ctx_get('s1_attempt')::uuid, NULL, NULL, NULL, NULL,
    'status_changed', NULL, NULL, 'synthetic harness event',
    '{"reason_code": "SYNTH_OK", "line_count": 2}'::jsonb) IS NOT NULL,
  'T15 RPC: payload conforme accepte');

-- ============================================================================
-- F. Garde-fous structurels contournement RPC (owner) : index + trigger.
-- ============================================================================
-- F.1 Unicité active globale (Option A) : h_s1_1 est actif sous S1-v2 ;
--     l'activer sous le canonical S11 doit violer l'index partiel.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_lines_canonical
        (canonical_statement_id, import_id, line_hash, is_active, transaction_date,
         description_sanitized, credit_amount, signed_amount, direction, currency)
        SELECT id, 'poc:v1:S11', 'h_s1_1', true, DATE '2026-05-05',
               'SYNTHETIC BYPASS', 1.00, 1.00, 'credit', 'XOF'
        FROM public.bank_statement_canonical
        WHERE import_id = 'poc:v1:S11' AND status = 'ingested' $neg$,
  '%uq_lines_canonical_line_hash_active%', 'Option A: index partiel actif bloque le doublon actif inter-relevés');

-- F.2 Unicité par relevé : h_s11_1 déjà présent sous le canonical S11,
--     même inactif le doublon est bloqué.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_lines_canonical
        (canonical_statement_id, import_id, line_hash, is_active, transaction_date,
         description_sanitized, credit_amount, signed_amount, direction, currency)
        SELECT id, 'poc:v1:S11', 'h_s11_1', false, DATE '2026-05-05',
               'SYNTHETIC BYPASS', 1.00, 1.00, 'credit', 'XOF'
        FROM public.bank_statement_canonical
        WHERE import_id = 'poc:v1:S11' AND status = 'ingested' $neg$,
  '%uq_lines_canonical_line_hash_per_statement%', 'T5 un line_hash unique par releve canonical');

-- F.3 T5 staging : doublon (staging_statement_id, line_hash) refusé.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_lines_staging
        (staging_statement_id, attempt_id, import_id, line_hash, source_line_index,
         transaction_date, description_sanitized, credit_amount, signed_amount, direction, currency)
        SELECT s.id, s.attempt_id, s.import_id, 'h_s1_1', 99, DATE '2026-05-02',
               'SYNTHETIC BYPASS', 1.00, 1.00, 'credit', 'XOF'
        FROM public.bank_statement_staging s
        WHERE s.attempt_id = poc_test.ctx_get('s3_attempt')::uuid $neg$,
  '%lines_staging_unique_per_statement%', 'T5 doublon line_hash dans un meme staging refuse');

-- F.4 Trigger anti-promote : insertion canonical depuis un staging dont
--     l'attempt est rejetée => refus structurel.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_canonical
        (promoted_from_staging_id, import_id, active_raw_text_hash, bank,
         account_fingerprint, currency, period_start_date, period_end_date,
         opening_balance, total_debits, total_credits, closing_balance, validation_status)
        SELECT s.id, s.import_id, s.raw_text_hash, s.bank, s.account_fingerprint,
               s.currency, s.period_start_date, s.period_end_date, s.opening_balance,
               s.total_debits, s.total_credits, s.closing_balance, s.validation_status
        FROM public.bank_statement_staging s
        WHERE s.attempt_id = poc_test.ctx_get('s8_attempt')::uuid $neg$,
  '%STRUCTURED_CSV_TRIGGER_GATE%', 'trigger anti-promote: attempt rejetee non promouvable (ceinture)');

-- F.5 Trigger : un canonical ne peut pas naître superseded.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_canonical
        (promoted_from_staging_id, import_id, active_raw_text_hash, bank,
         account_fingerprint, currency, period_start_date, period_end_date,
         opening_balance, total_debits, total_credits, closing_balance,
         validation_status, status, superseded_by, superseded_at)
        SELECT s.id, s.import_id, s.raw_text_hash, s.bank, s.account_fingerprint,
               s.currency, s.period_start_date, s.period_end_date, s.opening_balance,
               s.total_debits, s.total_credits, s.closing_balance, s.validation_status,
               'superseded', poc_test.ctx_get('s1_canonical_v2')::uuid, now()
        FROM public.bank_statement_staging s
        WHERE s.attempt_id = poc_test.ctx_get('s8_attempt')::uuid $neg$,
  '%STRUCTURED_CSV_TRIGGER_STATUS%', 'trigger: canonical ne peut pas naitre superseded');

-- F.6 (PR #77) Masque strict au niveau table : même le owner ne peut pas
--     insérer un compte quasi-complet contenant un astérisque.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_staging (attempt_id, import_id, raw_text_hash, bank,
        account_fingerprint, account_number_masked, currency, period_start_date, period_end_date,
        opening_balance, total_debits, total_credits, closing_balance, validation_status, line_count)
        VALUES ((poc_test.ctx_get('b1_rejected')::jsonb ->> 'attempt_id')::uuid,
                'poc:v1:MASK', 'rth_mask', 'BKTEST', 'fp_synth_mask',
                '78901234567890*1', 'XOF', DATE '2026-05-01', DATE '2026-05-31',
                0, 0, 0, 0, 'valid', 0) $neg$,
  '%staging_masked_never_full_account%', 'PR77 masque quasi-complet refuse au niveau table (owner)');

-- F.7 (PR #77) Cohérence signe au niveau table : debit avec signed positif.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_lines_staging
        (staging_statement_id, attempt_id, import_id, line_hash, source_line_index,
         transaction_date, description_sanitized, debit_amount, signed_amount, direction, currency)
        SELECT s.id, s.attempt_id, s.import_id, 'h_sign_dbg', 98, DATE '2026-05-02',
               'SYNTHETIC SIGN BYPASS', 5.00, 5.00, 'debit', 'XOF'
        FROM public.bank_statement_staging s
        WHERE s.attempt_id = poc_test.ctx_get('s3_attempt')::uuid $neg$,
  '%lines_staging_one_amount%', 'PR77 debit avec signed positif refuse au niveau table (owner)');

-- F.8 (PR #77) Cohérence signe canonical : credit avec signed negatif.
SELECT poc_test.expect_error(
  $neg$ INSERT INTO public.bank_statement_lines_canonical
        (canonical_statement_id, import_id, line_hash, is_active, transaction_date,
         description_sanitized, credit_amount, signed_amount, direction, currency)
        SELECT id, 'poc:v1:S11', 'h_sign_dbg2', false, DATE '2026-05-05',
               'SYNTHETIC SIGN BYPASS', 5.00, -5.00, 'credit', 'XOF'
        FROM public.bank_statement_canonical
        WHERE import_id = 'poc:v1:S11' AND status = 'ingested' $neg$,
  '%lines_canonical_one_amount%', 'PR77 credit avec signed negatif refuse au niveau table (owner)');

-- Invariant final T13bis re-vérifié après toutes les tentatives de contournement.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_canonical l
    JOIN public.bank_statement_canonical c ON c.id = l.canonical_statement_id
    WHERE (l.is_active AND c.status <> 'ingested')
       OR (NOT l.is_active AND c.status = 'ingested')),
  'T13bis invariant Option A preserve en fin de scenario');

SELECT 'supersede/R3/immutabilite/safe_details: PASS' AS status;
