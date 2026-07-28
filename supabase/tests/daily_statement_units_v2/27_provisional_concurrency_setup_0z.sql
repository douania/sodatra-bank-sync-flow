-- ============================================================================
-- 0Z_J1 — CONCURRENCE PROVISIONAL : SETUP (compte dédié + dépôt initial)
-- ============================================================================
-- PRÉREQUIS : chaîne complète 0H + 0U + 0U3 + 0U4 + 0Z appliquée, et
-- 02_payload_helpers.sql + 16_provisional_lifecycle_0z.sql exécutés (les
-- builders poc_test.z_mk_attempt / z_mk_unit / z_mk_line / z_live_provisional
-- sont réutilisés). Contexte : runner run_e2e_0r.sh, étape [4c].
-- Données 100 % synthétiques ; compte ORA provisionné par la RPC registre.
--
-- Scénario préparé ici : une journée non close porte déjà une provisional
-- vivante (zc0). Les sessions 28a/28b redéposeront ensuite la MÊME journée
-- SIMULTANÉMENT : A (contenu modifié, verrou tenu ~6 s) doit remplacer zc0 ;
-- B (contenu identique à A) doit ATTENDRE le verrou journée puis finir en
-- duplicate sans lignes. Preuve chronométrée via clock_timestamp().
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- Variante de z_deposit sur le compte concurrence (ctx zc_*) qui horodate
-- l'entrée et la sortie de la RPC : la durée de blocage de la session B est
-- mesurée entre <prefix>_call_at et <prefix>_done_at (wall-clock).
CREATE OR REPLACE FUNCTION poc_test.zc_deposit(
  p_prefix text, p_date text, p_hashes text[], p_status text, p_ref text
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_fp    text := poc_test.ctx_get('zc_fp');
  v_acc   text := poc_test.ctx_get('zc_account');
  v_lines jsonb := '[]'::jsonb;
  v_res   jsonb;
  v_i     integer;
BEGIN
  FOR v_i IN 1 .. array_length(p_hashes, 1) LOOP
    v_lines := v_lines || poc_test.z_mk_line('ORA', v_fp, p_date, p_hashes[v_i], 1, v_i - 1);
  END LOOP;
  PERFORM poc_test.ctx_set(p_prefix || '_call_at', clock_timestamp()::text);
  v_res := public.pre_ingest_daily_statement_units(
    poc_test.z_mk_attempt('ORA', v_fp, v_acc, p_prefix, p_date, p_date, p_ref),
    jsonb_build_array(poc_test.z_mk_unit('ORA', v_fp, p_date, p_hashes, p_status)),
    v_lines,
    poc_test.mk_guard(true, 1));
  PERFORM poc_test.ctx_set(p_prefix || '_done_at', clock_timestamp()::text);
  PERFORM poc_test.ctx_set(p_prefix || '_attempt', v_res ->> 'attempt_id');
  PERFORM poc_test.ctx_set(p_prefix || '_staging', v_res -> 'units' -> 0 ->> 'staging_unit_id');
  PERFORM poc_test.ctx_set(p_prefix || '_status',  v_res -> 'units' -> 0 ->> 'unit_status');
  PERFORM poc_test.ctx_set(p_prefix || '_duid',    v_res -> 'units' -> 0 ->> 'day_unit_id');
  RETURN v_res;
END
$fn$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

-- Compte ORA dédié à la campagne concurrence (fingerprint généré serveur,
-- masque corroboré — aucun motif de review requis).
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('zc_provision',
  public.provision_daily_statement_account('ORA','XOF','CONCURRENCE 0Z ORA','****1234')::text);
COMMIT;
SELECT poc_test.ctx_set('zc_account', poc_test.ctx_get('zc_provision')::jsonb ->> 'id');
SELECT poc_test.ctx_set('zc_fp', poc_test.ctx_get('zc_provision')::jsonb ->> 'account_fingerprint');

-- Dépôt initial séquentiel : la journée non close porte une provisional
-- vivante AVANT la course — 28a et 28b sont donc tous deux des REDÉPÔTS.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.zc_deposit('zc0', '22/09/2026',
  ARRAY[poc_test.hex64('zc_l0')], 'provisional', '22/09/2026');
COMMIT;
SELECT poc_test.assert(poc_test.ctx_get('zc0_status') = 'provisional',
  'ZC-setup: depot initial => provisional vivante');
SELECT poc_test.assert(
  poc_test.z_live_provisional(poc_test.ctx_get('zc0_duid')) = 1,
  'ZC-setup: exactement une provisional vivante avant la course');

SELECT 'provisional concurrency 0Z setup: READY' AS status;
