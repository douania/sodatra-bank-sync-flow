-- ============================================================================
-- LOCAL-E2E-0R — CHAÎNE COMPLÈTE MULTI-BANQUES (Excel réel -> RPC -> canonical)
-- ============================================================================
-- Ce fichier ne contient AUCUN payload écrit à la main. Il consomme exclusivement
-- poc_test.e2e0r_payload, table alimentée par l'artefact généré depuis le VRAI
-- pipeline TypeScript (prepareDailyV2BrowserDeposit) à partir de quatre classeurs
-- Excel synthétiques ATB/BICIS/BIS/BRIDGE.
--
-- DateStyle 'ISO, MDY' : si une conversion de date implicite se glissait dans le
-- write path, 09/07/2026 deviendrait le 7 septembre et les asserts échoueraient.
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- Fenêtre de reporting de la campagne (mirroir de la requête page réelle).
-- Les journées backfill (janvier/février) restent hors fenêtre volontairement.
CREATE TABLE poc_test.e2e0r_report_snapshot (
  checkpoint text PRIMARY KEY,
  units      jsonb NOT NULL
);

-- Projection EXACTE des colonnes lues par le reporting 0O
-- (REPORTING_COLUMNS de dailyV2SupabaseService), avec le filtre de la requête
-- page : status='ingested' sur la fenêtre. Exécutée en superuser : le contrôle
-- RLS équivalent est prouvé séparément en section L (matrice des rôles).
CREATE OR REPLACE FUNCTION poc_test.e2e0r_snapshot(p_checkpoint text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO poc_test.e2e0r_report_snapshot (checkpoint, units)
  SELECT p_checkpoint,
         coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.accounting_date, u.id), '[]'::jsonb)
  FROM (
    SELECT c.id,
           c.accounting_date,
           c.bank,
           c.currency,
           c.account_fingerprint,
           c.line_count,
           c.day_total_debits,
           c.day_total_credits,
           c.opening_balance_derived,
           c.closing_balance_derived,
           c.aggregates_status,
           c.validation_status,
           c.ingested_at
    FROM public.daily_statement_units_canonical c
    WHERE c.status = 'ingested'
      AND c.accounting_date BETWEEN DATE '2026-07-01' AND DATE '2026-07-31'
  ) u;
END
$fn$;

-- Dépose un payload réel et mémorise l'issue de sa PREMIÈRE unité.
CREATE OR REPLACE FUNCTION poc_test.e2e0r_deposit(p_key text, p_prefix text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_res jsonb;
BEGIN
  SELECT public.pre_ingest_daily_statement_units(p_attempt, p_units, p_lines, p_guard)
  INTO v_res
  FROM poc_test.e2e0r_payload WHERE key = p_key;

  PERFORM poc_test.ctx_set(p_prefix || '_attempt', v_res ->> 'attempt_id');
  PERFORM poc_test.ctx_set(p_prefix || '_staging', v_res -> 'units' -> 0 ->> 'staging_unit_id');
  PERFORM poc_test.ctx_set(p_prefix || '_status',  v_res -> 'units' -> 0 ->> 'unit_status');
  PERFORM poc_test.ctx_set(p_prefix || '_duid',    v_res -> 'units' -> 0 ->> 'day_unit_id');
  RETURN v_res;
END
$fn$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

-- ============================================================================
-- A. État initial : rien en staging, rien en canonical, rien en audit.
-- ============================================================================
BEGIN;
SELECT poc_test.assert((SELECT count(*) FROM public.daily_statement_units_canonical) = 0,
  '0R-A1: canonical vide avant tout depot');
SELECT poc_test.assert((SELECT count(*) FROM public.daily_statement_units_staging) = 0,
  '0R-A2: staging vide avant tout depot');
SELECT poc_test.assert((SELECT count(*) FROM public.daily_statement_import_events) = 0,
  '0R-A3: audit vide avant tout depot');
COMMIT;

-- ============================================================================
-- B. Dépôts réels des quatre banques (payloads issus du pipeline Excel).
--    BICIS est déposé par le MANAGER : le dépôt daily lui est ouvert.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('atb_v1', 'atb1');
SELECT poc_test.assert(poc_test.ctx_get('atb1_status') = 'staged', '0R-B1: ATB depose -> staged');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.e2e0r_deposit('bicis_v1', 'bicis1');
SELECT poc_test.assert(poc_test.ctx_get('bicis1_status') = 'staged',
  '0R-B2: BICIS depose par le MANAGER -> staged');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('bis_v1', 'bis1');
SELECT poc_test.assert(poc_test.ctx_get('bis1_status') = 'staged', '0R-B3: BIS depose -> staged');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('bridge_v1', 'bridge1');
SELECT poc_test.assert(poc_test.ctx_get('bridge1_status') = 'staged',
  '0R-B4: BRIDGE depose -> staged');
COMMIT;

-- Le parseur BRIDGE ne porte aucune devise => validation_status needs_review,
-- porté jusque dans l'unité de staging par le pipeline réel.
BEGIN;
SELECT poc_test.assert(
  (SELECT validation_status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('bridge1_staging')::uuid) = 'needs_review',
  '0R-B5: BRIDGE porte validation_status=needs_review (devise absente du fichier)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE validation_status = 'valid') = 3,
  '0R-B6: ATB/BICIS/BIS restent valid');
-- Chaque dépôt a stagé ses lignes.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging) = 8,
  '0R-B7: 4 unites x 2 lignes stagees');
COMMIT;

-- ============================================================================
-- C. Reporting — checkpoint A : AVANT toute promotion, canonical est vide.
-- ============================================================================
BEGIN;
SELECT poc_test.assert((SELECT count(*) FROM public.daily_statement_units_canonical) = 0,
  '0R-C1: aucune donnee canonical avant promotion');
SELECT poc_test.e2e0r_snapshot('A_before_promotion');
COMMIT;

-- ============================================================================
-- D. Promotions ATB / BICIS / BIS (unités valid : aucune raison requise).
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('atb1_canonical',
  public.promote_daily_statement_unit(poc_test.ctx_get('atb1_staging')::uuid) ->> 'canonical_unit_id');
SELECT poc_test.ctx_set('bicis1_canonical',
  public.promote_daily_statement_unit(poc_test.ctx_get('bicis1_staging')::uuid) ->> 'canonical_unit_id');
SELECT poc_test.ctx_set('bis1_canonical',
  public.promote_daily_statement_unit(poc_test.ctx_get('bis1_staging')::uuid) ->> 'canonical_unit_id');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'ingested') = 3,
  '0R-D1: 3 unites canonical ingested (ATB, BICIS, BIS)');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('atb1_staging')::uuid) = 'promoted',
  '0R-D2: staging ATB -> promoted');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical WHERE is_active) = 6,
  '0R-D3: 6 lignes canonical actives');
-- Le contenu promu est bien celui calculé par le pipeline TypeScript.
SELECT poc_test.assert(
  (SELECT c.active_day_content_hash FROM public.daily_statement_units_canonical c
   WHERE c.id = poc_test.ctx_get('atb1_canonical')::uuid)
  = (SELECT p.p_units -> 0 ->> 'day_content_hash' FROM poc_test.e2e0r_payload p WHERE p.key = 'atb_v1'),
  '0R-D4: day_content_hash canonical == celui produit par le pipeline Excel');
SELECT poc_test.assert(
  (SELECT c.day_total_debits FROM public.daily_statement_units_canonical c
   WHERE c.id = poc_test.ctx_get('atb1_canonical')::uuid) = 100.00,
  '0R-D5: totaux ATB promus conformes au classeur synthetique');
COMMIT;

-- ============================================================================
-- E. BRIDGE — gate 0K : needs_review non promouvable SANS raison humaine.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format('SELECT public.promote_daily_statement_unit(%L::uuid)', poc_test.ctx_get('bridge1_staging')),
  '%DAILY_STMT_REASON_REQUIRED%',
  '0R-E1: promotion BRIDGE needs_review SANS raison refusee');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('bridge1_staging')::uuid) = 'staged',
  '0R-E2: le refus n a rien mute (BRIDGE toujours staged)');
SELECT poc_test.assert((SELECT count(*) FROM public.daily_statement_units_canonical) = 3,
  '0R-E3: aucune canonical creee par le refus');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('bridge1_canonical',
  public.promote_daily_statement_unit(
    poc_test.ctx_get('bridge1_staging')::uuid,
    'E2E0R: revue humaine synthetique - devise operateur confirmee'
  ) ->> 'canonical_unit_id');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('bridge1_canonical')::uuid) = 'ingested',
  '0R-E4: promotion BRIDGE AVEC raison acceptee -> canonical ingested');
SELECT poc_test.assert(
  (SELECT validation_status FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('bridge1_canonical')::uuid) = 'needs_review',
  '0R-E5: la canonical BRIDGE conserve validation_status=needs_review');
-- Les deux événements 0K sont présents, rattachés à la même unité de staging.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('bridge1_staging')::uuid
     AND event_type = 'unit_promotion_approved') = 1,
  '0R-E6: evenement unit_promotion_approved emis');
SELECT poc_test.assert(
  (SELECT safe_details ->> 'approval_reason' FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('bridge1_staging')::uuid
     AND event_type = 'unit_promotion_approved')
  = 'E2E0R: revue humaine synthetique - devise operateur confirmee',
  '0R-E7: la raison humaine synthetique est auditee');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('bridge1_staging')::uuid
     AND event_type = 'unit_promoted') = 1,
  '0R-E8: evenement unit_promoted emis');
-- Ordre d'insertion physique : import_events est strictement append-only (aucun
-- UPDATE possible), donc l'ordre des ctid reflete l'ordre d'insertion. Les deux
-- evenements partagent le meme created_at (meme transaction) : c'est le seul
-- temoin observable de la sequence approbation -> promotion.
SELECT poc_test.assert(
  (SELECT event_type FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('bridge1_staging')::uuid
     AND event_type IN ('unit_promotion_approved', 'unit_promoted')
   ORDER BY ctid LIMIT 1) = 'unit_promotion_approved',
  '0R-E9: unit_promotion_approved insere AVANT unit_promoted');
COMMIT;

-- ============================================================================
-- F. Reporting — checkpoint B : les quatre banques sont canonical.
-- ============================================================================
BEGIN;
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'ingested') = 4,
  '0R-F1: 4 unites canonical actives (ATB, BICIS, BIS, BRIDGE)');
SELECT poc_test.e2e0r_snapshot('B_after_promotion');
COMMIT;

-- ============================================================================
-- G. R1 — redépôt STRICTEMENT identique après promotion => duplicate.
--    Le payload rejoué est la MÊME ligne d'artefact (mêmes octets Excel).
-- ============================================================================
BEGIN;
SELECT poc_test.ctx_set('atb1_hash_before',
  (SELECT active_day_content_hash FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb1_canonical')::uuid));
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('atb_v1', 'atbdup');
SELECT poc_test.assert(poc_test.ctx_get('atbdup_status') = 'duplicate',
  '0R-G1: redepot strictement identique -> duplicate (R1)');
COMMIT;

BEGIN;
-- R1 ne stage AUCUNE ligne : le contenu identique vit déjà en canonical.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('atbdup_staging')::uuid) = 0,
  '0R-G2: aucune ligne stagee pour un duplicate');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'ingested') = 4,
  '0R-G3: canonical inchangee en nombre');
SELECT poc_test.assert(
  (SELECT active_day_content_hash FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb1_canonical')::uuid) = poc_test.ctx_get('atb1_hash_before'),
  '0R-G4: canonical ATB inchangee en contenu');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('atbdup_staging')::uuid
     AND event_type = 'unit_duplicate') = 1,
  '0R-G5: evenement unit_duplicate emis');
COMMIT;

-- ============================================================================
-- H. R2 — même journée / compte / devise, contenu différent => conflict.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('atb_v2_conflict', 'atbcfl');
SELECT poc_test.assert(poc_test.ctx_get('atbcfl_status') = 'conflict',
  '0R-H1: meme journee, contenu different -> conflict (R2)');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  poc_test.ctx_get('atbcfl_duid') = poc_test.ctx_get('atb1_duid'),
  '0R-H2: le conflit porte bien sur la MEME journee (day_unit_id identique)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging
   WHERE staging_unit_id = poc_test.ctx_get('atbcfl_staging')::uuid) = 2,
  '0R-H3: le conflict conserve ses lignes (matiere du supersede)');
-- Un conflict n'est jamais promouvable directement.
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format('SELECT public.promote_daily_statement_unit(%L::uuid)', poc_test.ctx_get('atbcfl_staging')),
  '%DAILY_STMT_PROMOTE_GATE%',
  '0R-H4: promotion directe d un conflict refusee');
COMMIT;

-- ============================================================================
-- I. Supersede contrôlé — raison obligatoire, admin seul.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format('SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, NULL)',
         poc_test.ctx_get('atb1_canonical'), poc_test.ctx_get('atbcfl_staging')),
  '%DAILY_STMT_REASON_REQUIRED%',
  '0R-I1: supersede SANS raison refuse');
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error(
  format('SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, %L)',
         poc_test.ctx_get('atb1_canonical'), poc_test.ctx_get('atbcfl_staging'),
         'E2E0R: tentative manager'),
  '%DAILY_STMT_ROLE_DENIED%',
  '0R-I2: supersede par le MANAGER refuse (admin seul)');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('atb_new_canonical',
  public.supersede_daily_statement_unit(
    poc_test.ctx_get('atb1_canonical')::uuid,
    poc_test.ctx_get('atbcfl_staging')::uuid,
    'E2E0R: correction synthetique de la journee ATB'
  ) ->> 'new_canonical_unit_id');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb1_canonical')::uuid) = 'superseded',
  '0R-I3: ancienne canonical -> superseded');
SELECT poc_test.assert(
  (SELECT superseded_by FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb1_canonical')::uuid)
  = poc_test.ctx_get('atb_new_canonical')::uuid,
  '0R-I4: chainage superseded_by vers la remplacante');
SELECT poc_test.assert(
  (SELECT superseded_at IS NOT NULL FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb1_canonical')::uuid),
  '0R-I5: superseded_at renseigne');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = poc_test.ctx_get('atb1_canonical')::uuid AND is_active) = 0,
  '0R-I6: anciennes lignes desactivees');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb_new_canonical')::uuid) = 'ingested',
  '0R-I7: nouvelle canonical ingested');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.ctx_get('atb1_duid') AND status = 'ingested') = 1,
  '0R-I8: exactement UNE canonical active pour la journee');
SELECT poc_test.assert(
  (SELECT day_total_debits FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('atb_new_canonical')::uuid) = 150.00,
  '0R-I9: la remplacante porte le contenu du second classeur (150.00)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE canonical_unit_id = poc_test.ctx_get('atb1_canonical')::uuid
     AND event_type = 'unit_superseded') = 1,
  '0R-I10: evenement unit_superseded emis');
-- Aucune suppression : l'ancienne unité et ses lignes existent toujours.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = poc_test.ctx_get('atb1_canonical')::uuid) = 2,
  '0R-I11: les anciennes lignes sont conservees (jamais de DELETE)');
COMMIT;

-- Reporting — checkpoint C : après supersede.
BEGIN;
SELECT poc_test.e2e0r_snapshot('C_after_supersede');
COMMIT;

-- ============================================================================
-- J. R3 — daily_line_hash actif réutilisé sous une AUTRE journée.
-- ============================================================================
-- IMPORTANT : le pipeline TypeScript NE PEUT PAS produire ce cas. La préimage
-- du daily_line_hash embarque le dayUnitId
-- (structuredBankStatementCsvBrowserIdempotencyKeys.ts, buildStructuredBankStatement
-- DailyLineHash : [domaine, dayUnitId, valueDate, direction, montant, devise,
-- description, ordinal]) : deux journées distinctes ne peuvent donc jamais
-- partager un hash de ligne. R3 est une ceinture de defense-in-depth contre un
-- client bogué ou compromis, PAS un chemin applicatif.
--
-- La sonde ci-dessous est DERIVEE du payload reel 'atb_d2' : on y substitue UN
-- daily_line_hash par un hash ACTIF de la journee ATB D1, puis on recalcule le
-- day_content_hash avec le helper de la migration elle-meme. C'est exactement ce
-- qu'un client defaillant enverrait. Aucun second jeu de fixtures n'est cree.
BEGIN;
DO $probe$
DECLARE
  v_att      jsonb;
  v_units    jsonb;
  v_lines    jsonb;
  v_guard    jsonb;
  v_duid_d2  text;
  v_victim   text;
  v_other    text;
  v_content  text;
BEGIN
  SELECT p_attempt, p_units, p_lines, p_guard
  INTO v_att, v_units, v_lines, v_guard
  FROM poc_test.e2e0r_payload WHERE key = 'atb_d2';

  v_duid_d2 := v_units -> 0 ->> 'day_unit_id';

  -- Un hash de ligne ACTIF appartenant a la journee ATB D1 (post-supersede).
  SELECT lc.daily_line_hash INTO v_victim
  FROM public.daily_statement_lines_canonical lc
  WHERE lc.is_active
    AND lc.day_unit_id = poc_test.ctx_get('atb1_duid')
  ORDER BY lc.daily_line_hash
  LIMIT 1;

  v_other := v_lines -> 1 ->> 'daily_line_hash';

  v_content := public.daily_stmt_day_content_hash(v_duid_d2, ARRAY[v_victim, v_other]);

  INSERT INTO poc_test.e2e0r_payload (key, p_attempt, p_units, p_lines, p_guard)
  VALUES (
    'atb_d2_r3_probe',
    v_att,
    jsonb_build_array(jsonb_set(v_units -> 0, '{day_content_hash}', to_jsonb(v_content))),
    jsonb_build_array(
      jsonb_set(v_lines -> 0, '{daily_line_hash}', to_jsonb(v_victim)),
      v_lines -> 1
    ),
    v_guard
  );
END
$probe$;
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('atb_d2_r3_probe', 'r3');
SELECT poc_test.assert(poc_test.ctx_get('r3_status') = 'needs_review',
  '0R-J1: hash de ligne actif sous une autre journee -> needs_review (R3)');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
-- needs_review est TERMINAL : ni promote (exige staged) ni supersede (exige conflict).
SELECT poc_test.expect_error(
  format('SELECT public.promote_daily_statement_unit(%L::uuid)', poc_test.ctx_get('r3_staging')),
  '%DAILY_STMT_PROMOTE_GATE%',
  '0R-J2: promotion d une unite needs_review (R3) refusee');
SELECT poc_test.expect_error(
  format('SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, %L)',
         poc_test.ctx_get('atb_new_canonical'), poc_test.ctx_get('r3_staging'),
         'E2E0R: tentative supersede sur needs_review'),
  '%DAILY_STMT_SUPERSEDE_GATE%',
  '0R-J3: supersede d une unite needs_review (R3) refuse -> impasse terminale');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('r3_staging')::uuid
     AND event_type = 'unit_needs_review') = 1,
  '0R-J4: evenement unit_needs_review emis');
COMMIT;

-- ============================================================================
-- K. Journée non close => provisional, jamais promouvable.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('atb_provisional', 'prov');
SELECT poc_test.assert(poc_test.ctx_get('prov_status') = 'provisional',
  '0R-K1: journee non close (accounting_date >= export_reference_date) -> provisional');
SELECT poc_test.expect_error(
  format('SELECT public.promote_daily_statement_unit(%L::uuid)', poc_test.ctx_get('prov_staging')),
  '%DAILY_STMT_PROVISIONAL_NOT_PROMOTABLE%',
  '0R-K2: promotion d une journee provisional refusee');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE staging_unit_id = poc_test.ctx_get('prov_staging')::uuid
     AND event_type = 'unit_provisional_held') = 1,
  '0R-K3: evenement unit_provisional_held emis');
COMMIT;

-- ============================================================================
-- L. Matrice des rôles réelle.
-- ============================================================================
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
-- Le manager dépose (déjà prouvé en B2) mais ne promeut jamais.
SELECT poc_test.expect_error(
  format('SELECT public.promote_daily_statement_unit(%L::uuid)', poc_test.ctx_get('bis1_staging')),
  '%DAILY_STMT_ROLE_DENIED%',
  '0R-L1: promote par le MANAGER refuse');
-- Backfill = admin seul, même avec un grant valide.
SELECT poc_test.expect_error($bf$
  SELECT public.pre_ingest_daily_statement_units(p_attempt, p_units, p_lines, p_guard)
  FROM poc_test.e2e0r_payload WHERE key = 'bis_backfill'
$bf$, '%DAILY_STMT_BACKFILL_ADMIN_ONLY%',
  '0R-L2: depot backfill par le MANAGER refuse');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.expect_error($au$
  SELECT public.pre_ingest_daily_statement_units(p_attempt, p_units, p_lines, p_guard)
  FROM poc_test.e2e0r_payload WHERE key = 'bis_v1'
$au$, '%DAILY_STMT_ROLE_DENIED%',
  '0R-L3: depot par l AUDITOR refuse');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.expect_error($us$
  SELECT public.pre_ingest_daily_statement_units(p_attempt, p_units, p_lines, p_guard)
  FROM poc_test.e2e0r_payload WHERE key = 'bis_v1'
$us$, '%DAILY_STMT_ROLE_DENIED%',
  '0R-L4: depot par le role USER refuse');
-- RLS : le rôle user ne voit RIEN.
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical) = 0,
  '0R-L5: RLS - le role USER ne lit aucune canonical');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events) = 0,
  '0R-L6: RLS - le role USER ne lit aucun evenement d audit');
COMMIT;

BEGIN;
-- RLS : le manager voit le staging mais JAMAIS la canonical ni l'audit.
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging) > 0,
  '0R-L7: RLS - le MANAGER lit les unites de staging');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical) = 0,
  '0R-L8: RLS - le MANAGER ne lit AUCUNE canonical');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_staging) = 0,
  '0R-L9: RLS - le MANAGER ne lit aucune ligne de staging (libelles sensibles)');
COMMIT;

BEGIN;
-- RLS : l'auditor voit canonical + audit, jamais le staging.
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'ingested') = 4,
  '0R-L10: RLS - l AUDITOR lit les 4 canonical actives');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events) > 0,
  '0R-L11: RLS - l AUDITOR lit l audit');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging) = 0,
  '0R-L12: RLS - l AUDITOR ne lit aucun staging');
COMMIT;

BEGIN;
SELECT poc_test.as_anon();
SELECT poc_test.expect_error(
  'SELECT count(*) FROM public.daily_statement_units_canonical',
  '%permission denied%',
  '0R-L13: anon n a aucun privilege sur la canonical');
COMMIT;

-- Le backfill reste ouvert à l'admin, sous grant explicite.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.e2e0r_deposit('bis_backfill', 'bisbf');
SELECT poc_test.assert(poc_test.ctx_get('bisbf_status') = 'staged',
  '0R-L14: depot backfill par l ADMIN accepte sous grant');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_import_events
   WHERE attempt_id = poc_test.ctx_get('bisbf_attempt')::uuid
     AND event_type = 'backfill_deposit') = 1,
  '0R-L15: evenement backfill_deposit emis');
COMMIT;

-- ============================================================================
-- M. Audit append-only : aucune écriture applicative, aucune suppression.
-- ============================================================================
BEGIN;
SELECT poc_test.ctx_set('events_total',
  (SELECT count(*)::text FROM public.daily_statement_import_events));
-- Aucun privilège d'écriture sur l'audit pour les rôles applicatifs.
SELECT poc_test.assert(
  NOT has_table_privilege('authenticated', 'public.daily_statement_import_events', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.daily_statement_import_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.daily_statement_import_events', 'INSERT'),
  '0R-M1: authenticated n a ni INSERT, ni UPDATE, ni DELETE sur l audit');
SELECT poc_test.assert(
  NOT has_table_privilege('service_role', 'public.daily_statement_import_events', 'DELETE'),
  '0R-M2: service_role n a pas DELETE sur l audit');
-- Aucune policy d'écriture nulle part sur les 6 tables Daily v2.
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename LIKE 'daily_statement_%'
     AND cmd <> 'SELECT') = 0,
  '0R-M3: aucune policy INSERT/UPDATE/DELETE sur les tables Daily v2');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  'DELETE FROM public.daily_statement_import_events',
  '%permission denied%',
  '0R-M4: DELETE audit refuse meme pour l ADMIN authentifie');
SELECT poc_test.expect_error(
  'DELETE FROM public.daily_statement_units_canonical',
  '%permission denied%',
  '0R-M5: DELETE canonical refuse meme pour l ADMIN authentifie');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT count(*)::text FROM public.daily_statement_import_events) = poc_test.ctx_get('events_total'),
  '0R-M6: aucun evenement supprime (audit strictement append-only)');
-- Les types d'événements attendus par la matrice ont tous été émis.
SELECT poc_test.assert(
  (SELECT count(DISTINCT event_type) FROM public.daily_statement_import_events
   WHERE event_type IN ('attempt_received','backfill_deposit','unit_staged','unit_provisional_held',
                        'unit_duplicate','unit_conflict','unit_needs_review','unit_promoted',
                        'unit_promotion_approved','unit_superseded')) = 10,
  '0R-M7: les 10 types d evenements attendus ont ete emis');
COMMIT;

-- ============================================================================
-- N. Invariants finaux.
-- ============================================================================
BEGIN;
SELECT poc_test.assert(
  (SELECT count(*) FROM (
     SELECT day_unit_id FROM public.daily_statement_units_canonical
     WHERE status = 'ingested' GROUP BY day_unit_id HAVING count(*) > 1) x) = 0,
  '0R-N1: jamais deux canonical actives pour une meme journee');
SELECT poc_test.assert(
  (SELECT count(*) FROM (
     SELECT daily_line_hash FROM public.daily_statement_lines_canonical
     WHERE is_active GROUP BY daily_line_hash HAVING count(*) > 1) x) = 0,
  '0R-N2: jamais deux lignes actives pour un meme daily_line_hash');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'ingested') = 4,
  '0R-N3: 4 journees canonical actives en fin de scenario');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical WHERE status = 'superseded') = 1,
  '0R-N4: 1 journee superseded conservee');
COMMIT;

SELECT 'ALL_E2E_0R_SQL_PASS' AS status;
