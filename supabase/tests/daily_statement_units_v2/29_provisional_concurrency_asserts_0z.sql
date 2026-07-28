-- ============================================================================
-- 0Z_J1 — CONCURRENCE PROVISIONAL : ASSERTS (après la fin des deux sessions)
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- 1. Issues des deux sessions : A remplace, B déduplique.
SELECT poc_test.assert(
  poc_test.ctx_get('zc_a_status') = 'provisional',
  'ZC1: session A (contenu modifie) => nouvelle provisional');
SELECT poc_test.assert(
  poc_test.ctx_get('zc_b_status') = 'duplicate',
  'ZC1: session B (contenu identique, serialisee) => duplicate R1-provisional');

-- 2. Preuve CHRONOMÉTRÉE du blocage : B est entrée dans la RPC pendant que A
--    tenait le verrou, et n'en est sortie qu'après le commit de A (>= 3 s).
SELECT poc_test.assert(
  (poc_test.ctx_get('zc_b_done_at')::timestamptz
     - poc_test.ctx_get('zc_b_call_at')::timestamptz) >= interval '3 seconds',
  'ZC2: la session B a attendu le verrou journee (blocage mesure >= 3 s)');
SELECT poc_test.assert(
  poc_test.ctx_get('zc_b_call_at')::timestamptz
    < poc_test.ctx_get('zc_a_commit_at')::timestamptz
  AND poc_test.ctx_get('zc_b_done_at')::timestamptz
    > poc_test.ctx_get('zc_a_commit_at')::timestamptz,
  'ZC2: B entree AVANT le commit de A et debloquee APRES (serialisation verrou)');

-- Évidence chronométrée exportée dans le log du runner (rapport CTO).
SELECT 'ZC evidence: B blocked '
  || round(extract(epoch FROM
       poc_test.ctx_get('zc_b_done_at')::timestamptz
         - poc_test.ctx_get('zc_b_call_at')::timestamptz)::numeric, 3)
  || ' s (call ' || poc_test.ctx_get('zc_b_call_at')
  || ' -> done ' || poc_test.ctx_get('zc_b_done_at')
  || ' ; commit A ' || poc_test.ctx_get('zc_a_commit_at') || ')' AS evidence;

-- 3. Après les deux commits : EXACTEMENT une provisional vivante (celle de A),
--    zc0 superseded, l'unité de B en duplicate.
SELECT poc_test.assert(
  poc_test.z_live_provisional(poc_test.ctx_get('zc_a_duid')) = 1
  AND (SELECT status FROM public.daily_statement_units_staging
       WHERE id = poc_test.ctx_get('zc_a_staging')::uuid) = 'provisional',
  'ZC3: exactement une provisional vivante — celle de la session A');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('zc0_staging')::uuid) = 'superseded',
  'ZC3: la provisional initiale zc0 est superseded par le redepot modifie de A');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('zc_b_staging')::uuid) = 'duplicate',
  'ZC3: l unite de B est enregistree duplicate (trace idempotente)');

-- 4. Aucune duplication des lignes sensibles : B n'a stagé AUCUNE ligne ;
--    la journée porte exactement 2 lignes (zc0 conservée + A), pas 3.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('zc_b_staging')::uuid) = 0,
  'ZC4: la session B n a stage aucune ligne sensible');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('zc_a_staging')::uuid) = 1
  AND (SELECT count(*) FROM public.daily_statement_lines_staging
       WHERE staging_unit_id = poc_test.ctx_get('zc0_staging')::uuid) = 1
  AND (SELECT count(*) FROM public.daily_statement_lines_staging
       WHERE day_unit_id = poc_test.ctx_get('zc_a_duid')) = 2,
  'ZC4: 2 lignes au total pour la journee (zc0 conservee + A), aucun DELETE, aucune duplication');

-- 5. Audit append-only complet de la course.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('zc_a_staging')::uuid
     AND event_type = 'unit_provisional_held') = 1,
  'ZC5: unit_provisional_held emis pour la provisional de A');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('zc_b_staging')::uuid
     AND event_type = 'unit_duplicate'
     AND safe_details ->> 'reason_code' = 'provisional_redeposit_duplicate') = 1,
  'ZC5: unit_duplicate R1-provisional audite pour B avec reason_code');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('zc0_staging')::uuid
     AND event_type = 'status_changed'
     AND previous_status = 'provisional' AND new_status = 'superseded'
     AND safe_details ->> 'reason_code' = 'provisional_superseded_by_redeposit') = 1,
  'ZC5: bascule zc0 provisional->superseded auditee (une seule fois)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('zc_a_staging')::uuid
     AND event_type = 'status_changed'
     AND new_status = 'superseded') = 0,
  'ZC5: la provisional vivante de A n a subi aucune bascule');

-- 6. Invariant global re-vérifié après la course.
SELECT poc_test.assert(
  (SELECT count(*) FROM (
     SELECT day_unit_id FROM public.daily_statement_units_staging
     WHERE status = 'provisional' GROUP BY day_unit_id HAVING count(*) > 1) x) = 0,
  'ZC6: jamais deux provisional vivantes pour une meme journee (invariant global)');

SELECT 'provisional concurrency 0Z: PASS' AS status;
