-- Surface APRÈS les migrations du Lot 1 opérationnel (scénario upgrade), comparée
-- à la surface après le lot : seules changent les cinq fonctions annoncées
-- (deux cœurs du dépôt pour H1, require_reason, l'ajout de compte attendu et la
-- lecture) ; les seuls ajouts sont les objets du pack, et les seuls nouveaux
-- accès de l'API sont la lecture des quatre tables de décision et l'exécution
-- des neuf commandes et des deux lectures Daily v2 (plan d'approbation groupée,
-- statut des réfutations) par authenticated.
\set ON_ERROR_STOP on
SELECT tr_test.assert(tr_surface.capture('after_op') > 100, 'surface après le pack capturée');

CREATE TEMP TABLE op_removed AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_op';
CREATE TEMP TABLE op_added AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_op'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after';

SELECT tr_test.assert_eq((SELECT string_agg(kind || ' ' || object, ';' ORDER BY object COLLATE "C") FROM op_removed),
  'funcdef public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb);'
  || 'funcdef public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb);'
  || 'funcdef public.treasury_admin_add_expected_account_v1(text,uuid,text,text,text,text);'
  || 'funcdef treasury_private.balances_snapshot(date,date);'
  || 'funcdef treasury_private.require_reason(text)',
  'seules les cinq fonctions annoncées changent');

SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM op_added
  WHERE NOT (object LIKE 'treasury\_private.%'
          OR object LIKE 'public.treasury\_admin\_%'
          OR object LIKE 'public.daily\_statement\_attempt\_attestations%'
          OR object LIKE 'public.daily\_statement\_correction\_pieces%'
          OR object LIKE 'public.daily\_statement\_version\_refutations%'
          OR object LIKE 'public.daily\_statement\_refutation\_sources%'
          OR object LIKE 'daily\_v2\_private.decision\_commands%'
          OR object LIKE 'daily\_v2\_private.guard\_decision\_commands%'
          OR object LIKE 'daily\_v2\_private.command\_%'
          OR object LIKE 'public.daily\_stmt\_%'
          OR object IN ('public.attest_daily_statement_attempt(text,uuid,text,text,uuid,text,text,text)',
                        'public.revoke_daily_statement_attempt_attestation(text,uuid,text)',
                        'public.reject_daily_statement_unit(text,uuid,text,uuid,text,text)',
                        'public.promote_daily_statement_attempt_units(text,uuid,jsonb,text)',
                        'public.supersede_daily_statement_unit_balances(text,uuid,uuid,text,text)',
                        'public.refute_daily_statement_version(text,text,text,text,jsonb,jsonb,text)',
                        'public.revoke_daily_statement_version_refutation(text,uuid,text)',
                        'public.daily_v2_attempt_batch_plan_v1(uuid)',
                        'public.daily_v2_refutation_status_v1(text)'))),
  'ajouts limités aux objets du pack : ' || coalesce((SELECT string_agg(kind || ' ' || object, '; ') FROM
  (SELECT * FROM op_added WHERE object NOT LIKE 'treasury\_private.%' AND object NOT LIKE 'public.daily\_%'
     AND object NOT LIKE 'daily\_v2\_private.%' LIMIT 10) x), ''));

CREATE TEMP TABLE op_expected_access (entry text);
INSERT INTO op_expected_access VALUES
  ('public.attest_daily_statement_attempt(text,uuid,text,text,uuid,text,text,text)=authenticated:EXECUTE'),
  ('public.daily_v2_attempt_batch_plan_v1(uuid)=authenticated:EXECUTE'),
  ('public.daily_v2_refutation_status_v1(text)=authenticated:EXECUTE'),
  ('public.promote_daily_statement_attempt_units(text,uuid,jsonb,text)=authenticated:EXECUTE'),
  ('public.refute_daily_statement_version(text,text,text,text,jsonb,jsonb,text)=authenticated:EXECUTE'),
  ('public.reject_daily_statement_unit(text,uuid,text,uuid,text,text)=authenticated:EXECUTE'),
  ('public.revoke_daily_statement_attempt_attestation(text,uuid,text)=authenticated:EXECUTE'),
  ('public.revoke_daily_statement_version_refutation(text,uuid,text)=authenticated:EXECUTE'),
  ('public.supersede_daily_statement_unit_balances(text,uuid,uuid,text,text)=authenticated:EXECUTE'),
  ('public.treasury_admin_revoke_verified_start_v1(text,uuid,text)=authenticated:EXECUTE'),
  ('public.treasury_admin_set_verified_start_v1(text,uuid,date,uuid,text,text,text,text)=authenticated:EXECUTE'),
  ('public.daily_statement_attempt_attestations=authenticated:SELECT'),
  ('public.daily_statement_correction_pieces=authenticated:SELECT'),
  ('public.daily_statement_refutation_sources=authenticated:SELECT'),
  ('public.daily_statement_version_refutations=authenticated:SELECT');
SELECT tr_test.assert(NOT EXISTS (
    (SELECT object || '=' || detail FROM op_added WHERE kind IN ('relacl', 'funcacl'))
    EXCEPT SELECT entry FROM op_expected_access)
  AND NOT EXISTS (
    SELECT entry FROM op_expected_access
    EXCEPT (SELECT object || '=' || detail FROM op_added WHERE kind IN ('relacl', 'funcacl'))),
  'seuls nouveaux accès : lecture des quatre tables de décision, exécution des neuf commandes et des deux lectures : '
  || coalesce((SELECT string_agg(object || '=' || detail, '; ') FROM op_added WHERE kind IN ('relacl', 'funcacl')), ''));
SELECT tr_test.assert_eq((SELECT string_agg(object, ';' ORDER BY object COLLATE "C") FROM op_added WHERE kind = 'policy'),
  'public.daily_statement_attempt_attestations/daily_statement_attempt_attestations_select;'
  || 'public.daily_statement_correction_pieces/daily_statement_correction_pieces_select;'
  || 'public.daily_statement_refutation_sources/daily_statement_refutation_sources_select;'
  || 'public.daily_statement_version_refutations/daily_statement_version_refutations_select',
  'quatre politiques de lecture, sur les seules tables de décision');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM op_added WHERE kind = 'nspacl'), 'aucun droit de schéma ajouté');

SELECT 'PASS 62_surface_compare_operational (' || (SELECT count(*) FROM op_added) || ' ajouts, '
       || (SELECT count(*) FROM op_removed) || ' définitions modifiées)' AS marker;
