-- ============================================================================
-- 0H — TESTS SUPERSEDE À GRANULARITÉ JOURNÉE (jamais de DELETE, audit)
-- ============================================================================
-- Dépend de 12_pipeline_rules.sql (ctx : c_active_canonical = canonical actif
-- 01/05 BKTEST ; d_conflict_staging = conflict R2 sur la même journée).
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

-- S1 : une unite 'staged' (non conflict) n'est pas une cible de supersede.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, 'SYNTH raison') $q$,
         poc_test.ctx_get('c_active_canonical'), poc_test.ctx_get('b_staging_02')),
  '%DAILY_STMT_SUPERSEDE_GATE%', 'S1: supersede exige une unite en conflict');

-- S2 : raison vide refusee.
SELECT poc_test.expect_error(
  format($q$ SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, '  ') $q$,
         poc_test.ctx_get('c_active_canonical'), poc_test.ctx_get('d_conflict_staging')),
  '%DAILY_STMT_REASON_REQUIRED%', 'S2: raison vide refusee');

-- S2bis : manager jamais.
ROLLBACK;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error(
  format($q$ SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, 'SYNTH raison') $q$,
         poc_test.ctx_get('c_active_canonical'), poc_test.ctx_get('d_conflict_staging')),
  '%DAILY_STMT_ROLE_DENIED%', 'S2bis: supersede admin seul');
ROLLBACK;

-- S3 : supersede nominal — l'ancienne journee est remplacee, jamais supprimee.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s3_result', public.supersede_daily_statement_unit(
  poc_test.ctx_get('c_active_canonical')::uuid,
  poc_test.ctx_get('d_conflict_staging')::uuid,
  'SYNTH: journee corrigee par la banque')::text);
COMMIT;
SELECT poc_test.ctx_set('s3_new_canonical',
  (poc_test.ctx_get('s3_result')::jsonb ->> 'new_canonical_unit_id'));
SELECT poc_test.assert(
  (poc_test.ctx_get('s3_result')::jsonb ->> 'outcome') = 'superseded',
  'S3: outcome superseded'
);
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('c_active_canonical')::uuid) = 'superseded'
  AND (SELECT superseded_by FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('c_active_canonical')::uuid)
      = poc_test.ctx_get('s3_new_canonical')::uuid
  AND (SELECT superseded_at FROM public.daily_statement_units_canonical
   WHERE id = poc_test.ctx_get('c_active_canonical')::uuid) IS NOT NULL,
  'S3: ancienne unite superseded, chainee, datee — pas de DELETE'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = poc_test.ctx_get('c_active_canonical')::uuid AND is_active) = 0,
  'S3: lignes de l''ancienne unite desactivees'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = poc_test.ctx_get('s3_new_canonical')::uuid AND is_active) = 1,
  'S3: lignes de la nouvelle unite actives'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.day_unit_id('BKTEST','01/05/2026') AND status = 'ingested') = 1,
  'S3: exactement UNE unite canonical active pour la journee'
);
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('d_conflict_staging')::uuid) = 'promoted',
  'S3: le staging conflict est passe promoted'
);
SELECT poc_test.assert(
  EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE canonical_unit_id = poc_test.ctx_get('c_active_canonical')::uuid
            AND event_type = 'unit_superseded')
  AND EXISTS (SELECT 1 FROM public.daily_statement_import_events
          WHERE canonical_unit_id = poc_test.ctx_get('s3_new_canonical')::uuid
            AND event_type = 'unit_promoted'),
  'S3: audit unit_superseded + unit_promoted present'
);

-- S4 : supersede a contenu identique => duplicate controle (R1 du supersede).
-- Deux conflits X et Y de MEME contenu (différent de l'actif l_b1x) ; le
-- premier supersede installe X ; le second (Y, contenu = actif) => duplicate.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s4_x', (public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','01/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_x1')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_x1'), 1, 0)),
  poc_test.mk_guard(true, 1)) -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.ctx_set('s4_y', (public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','01/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_x1')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_x1'), 1, 0)),
  poc_test.mk_guard(true, 1)) -> 'units' -> 0 ->> 'staging_unit_id'));
COMMIT;
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('s4_x')::uuid) = 'conflict'
  AND (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('s4_y')::uuid) = 'conflict',
  'S4: deux conflits candidats de meme contenu'
);
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s4_first', public.supersede_daily_statement_unit(
  poc_test.ctx_get('s3_new_canonical')::uuid,
  poc_test.ctx_get('s4_x')::uuid,
  'SYNTH: seconde correction')::text);
COMMIT;
SELECT poc_test.ctx_set('s4_active',
  (poc_test.ctx_get('s4_first')::jsonb ->> 'new_canonical_unit_id'));
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('s4_second', public.supersede_daily_statement_unit(
  poc_test.ctx_get('s4_active')::uuid,
  poc_test.ctx_get('s4_y')::uuid,
  'SYNTH: correction redondante')::text);
COMMIT;
SELECT poc_test.assert(
  (poc_test.ctx_get('s4_second')::jsonb ->> 'outcome') = 'duplicate',
  'S4: supersede a contenu identique => duplicate controle, actif conserve'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.day_unit_id('BKTEST','01/05/2026') AND status = 'ingested') = 1,
  'S4: toujours UNE seule unite canonical active'
);

-- S5 : cible perimee (canonical deja superseded) => STALE, rollback total.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('s5_z', (public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','01/05/2026','01/05/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','01/05/2026', ARRAY[poc_test.hex64('l_z1')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','01/05/2026', poc_test.hex64('l_z1'), 1, 0)),
  poc_test.mk_guard(true, 1)) -> 'units' -> 0 ->> 'staging_unit_id'));
COMMIT;
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  format($q$ SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, 'SYNTH raison') $q$,
         poc_test.ctx_get('c_active_canonical'), poc_test.ctx_get('s5_z')),
  '%DAILY_STMT_STALE_CANONICAL%', 'S5: cible superseded re-lue sous verrou => rejet');
ROLLBACK;

-- Invariant Option A : is_active coherent avec le statut du parent.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM public.daily_statement_lines_canonical l
    JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
    WHERE (l.is_active AND u.status <> 'ingested')
       OR (NOT l.is_active AND u.status = 'ingested')),
  'invariant Option A: is_active toujours coherent avec le parent'
);

SELECT 'supersede v2: PASS' AS status;
