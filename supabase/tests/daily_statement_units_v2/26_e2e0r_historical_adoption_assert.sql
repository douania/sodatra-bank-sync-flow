-- ============================================================================
-- LOCAL-E2E-0U3 — ASSERTIONS DU PONT D'ADOPTION HISTORIQUE
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;
SELECT poc_test.as_super();
SELECT poc_test.assert(
  public.daily_stmt_classify_fingerprint_scheme(
    'legacy_atb_identity_token_v1_01'
  ) = 'legacy_opaque_v1',
  '0U4-S1: le token historique opaque sur est classe legacy');
SELECT poc_test.assert(
  public.daily_stmt_classify_fingerprint_scheme(repeat('a',64)) = 'sha256_hex_v1',
  '0U4-S2: le format SHA-256 canonique reste accepte');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme('legacy short')$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S3: espace et longueur insuffisante refuses');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme('legacy_identity_12345678')$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S4: suite de huit chiffres refusee');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme('FR761234ABCDEF1234567890')$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S5: forme IBAN refusee');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme('legacy_identity_****9999')$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S6: forme masquee refusee');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme(repeat('A',64))$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S7: hex64 majuscule refuse au lieu d etre reclasse legacy');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme(repeat('x',15))$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S8: token trop court refuse');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme(repeat('x',129))$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S9: token trop long refuse');
SELECT poc_test.expect_error(
  $$SELECT public.daily_stmt_classify_fingerprint_scheme(E'legacy_identity\ncontrol')$$,
  '%DAILY_STMT_FINGERPRINT_UNSUPPORTED%',
  '0U4-S10: caractere de controle refuse');
SELECT poc_test.expect_error(
  $$INSERT INTO public.daily_statement_account_registry (
       created_by, bank, currency, safe_alias,
       account_fingerprint, fingerprint_scheme
     ) VALUES (
       poc_test.uid_admin(),'ATB','XOF','E2E0R BAD SCHEME',
       'legacy_atb_identity_token_v1_01','sha256_hex_v1'
     )$$,
  '%daily_stmt_account_registry_fingerprint_scheme_coherent%',
  '0U4-S11: la contrainte refuse un token legacy declare SHA');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account(
       'ATB','XOF','E2E0R HISTORICAL MANAGER')$$,
  '%DAILY_STMT_HISTORICAL_ADOPTION_ADMIN_REQUIRED%',
  '0U3-A1: un manager ne peut pas adopter une identite historique');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account(
       'BICIS','XOF','E2E0R AMBIGUOUS')$$,
  '%DAILY_STMT_HISTORICAL_IDENTITY_AMBIGUOUS%',
  '0U3-A2: plusieurs fingerprints du meme contexte sont refuses');
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account(
       'ORA','XOF','E2E0R MASK AMBIGUOUS')$$,
  '%DAILY_STMT_HISTORICAL_MASK_AMBIGUOUS%',
  '0U3-A3: plusieurs masques de la meme identite sont refuses');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_account_registry
   WHERE bank IN ('BICIS','ORA')) = 0,
  '0U3-A4: les refus ambigus ne laissent aucun registre partiel');
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account(
       'ATB','XOF','12345678')$$,
  '%DAILY_STMT_ACCOUNT_ALIAS_SENSITIVE%',
  '0U3-A5: un alias ressemblant a un compte est refuse');

SELECT poc_test.ctx_set(
  '0u3_adoption_result',
  public.adopt_daily_statement_historical_account(
    'ATB','XOF','E2E0R HISTORICAL ACCOUNT'
  )::text
);

SELECT poc_test.ctx_set(
  '0u3_registry_id',
  poc_test.ctx_get('0u3_adoption_result')::jsonb ->> 'account_registry_id'
);

SELECT poc_test.assert(
  NOT (poc_test.ctx_get('0u3_adoption_result')::jsonb ? 'account_fingerprint')
  AND NOT (poc_test.ctx_get('0u3_adoption_result')::jsonb ? 'account_number_masked'),
  '0U3-A6: la reponse n expose ni fingerprint ni masque');
SELECT poc_test.assert(
  poc_test.ctx_get('0u3_adoption_result')::jsonb ->> 'outcome' = 'adopted',
  '0U3-A7: adoption atomique acceptee');
SELECT poc_test.assert(
  poc_test.ctx_get('0u3_adoption_result')::jsonb ->> 'fingerprint_scheme'
    = 'legacy_opaque_v1',
  '0U4-A1: seul le schema non sensible est renvoye');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT account_fingerprint = 'legacy_atb_identity_token_v1_01'
     AND fingerprint_scheme = 'legacy_opaque_v1'
     AND account_number_masked = '****9999'
   FROM public.daily_statement_account_registry
   WHERE id = poc_test.ctx_get('0u3_registry_id')::uuid),
  '0U3-A8: fingerprint et masque historiques strictement conserves');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts
   WHERE id IN (
     '00000000-0000-4000-8000-00000000a900',
     '00000000-0000-4000-8000-00000000a910'
   ) AND account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid) = 2,
  '0U3-A9: toutes les attempts historiques sont rattachees');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
     AND account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid) = 4,
  '0U3-A10: promoted et conflict staging sont rattaches');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
     AND account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid) = 3,
  '0U3-A11: tous les canonical historiques sont rattaches');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE id = '00000000-0000-4000-8000-00000000a911'
     AND status = 'conflict'
     AND day_unit_id = repeat('1',64)
     AND day_content_hash = repeat('d',64)) = 1,
  '0U3-A12: le conflit et ses identites de jour restent inchanges');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
     AND status = 'ingested'
     AND account_fingerprint = 'legacy_atb_identity_token_v1_01') = 3,
  '0U3-A13: statuts et fingerprint canonical restent inchanges');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_account_events
   WHERE account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid
     AND event_type = 'account_provisioned'
     AND safe_message = 'historical daily statement account adopted'
     AND NOT (safe_details ? 'account_fingerprint')
     AND safe_details ->> 'attempts_mapped' = '2'
     AND safe_details ->> 'staging_units_mapped' = '4'
     AND safe_details ->> 'canonical_units_mapped' = '3') = 1,
  '0U3-A14: adoption auditee par compteurs surs uniquement');
SELECT poc_test.assert(
  position('legacy_atb_identity_token_v1_01' IN (
    SELECT coalesce(string_agg(safe_message || coalesce(safe_details::text,''),''),'')
    FROM public.daily_statement_account_events
    WHERE account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid
  )) = 0,
  '0U3-A15: le fingerprint n apparait jamais dans l audit');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set(
  '0u4_sha_adoption_result',
  public.adopt_daily_statement_historical_account(
    'BRIDGE','XOF','E2E0R HISTORICAL SHA ACCOUNT'
  )::text
);
SELECT poc_test.ctx_set(
  '0u4_sha_registry_id',
  poc_test.ctx_get('0u4_sha_adoption_result')::jsonb ->> 'account_registry_id'
);
SELECT poc_test.assert(
  poc_test.ctx_get('0u4_sha_adoption_result')::jsonb ->> 'fingerprint_scheme'
    = 'sha256_hex_v1'
  AND NOT (poc_test.ctx_get('0u4_sha_adoption_result')::jsonb ? 'account_fingerprint'),
  '0U4-A2: le pont SHA reste compatible sans exposer le fingerprint');
SELECT poc_test.assert(
  (SELECT account_fingerprint = repeat('2',64)
     AND fingerprint_scheme = 'sha256_hex_v1'
   FROM public.daily_statement_account_registry
   WHERE id = poc_test.ctx_get('0u4_sha_registry_id')::uuid),
  '0U4-A3: le pont SHA conserve identite et schema');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts
   WHERE id = '00000000-0000-4000-8000-00000000d900'
     AND account_registry_id = poc_test.ctx_get('0u4_sha_registry_id')::uuid) = 1
  AND
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE id = '00000000-0000-4000-8000-00000000d901'
     AND account_registry_id = poc_test.ctx_get('0u4_sha_registry_id')::uuid) = 1
  AND
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE id = '00000000-0000-4000-8000-00000000d921'
     AND account_registry_id = poc_test.ctx_get('0u4_sha_registry_id')::uuid) = 1,
  '0U4-A4: le pont SHA rattache les trois niveaux atomiquement');
COMMIT;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account(
       'ATB','XOF','E2E0R SECOND ADOPTION')$$,
  '%DAILY_STMT_HISTORICAL_IDENTITY_NOT_FOUND%',
  '0U3-A16: une seconde adoption est refusee fail-closed');
COMMIT;

BEGIN;
SELECT poc_test.assert(
  has_function_privilege(
    'authenticated',
    'public.adopt_daily_statement_historical_account(text,text,text)',
    'EXECUTE'),
  '0U3-A17: authenticated peut appeler la RPC (controle admin interne)');
SELECT poc_test.assert(
  NOT has_function_privilege(
    'anon',
    'public.adopt_daily_statement_historical_account(text,text,text)',
    'EXECUTE')
  AND NOT has_function_privilege(
    'service_role',
    'public.adopt_daily_statement_historical_account(text,text,text)',
    'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    WHERE p.oid =
      'public.adopt_daily_statement_historical_account(text,text,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  '0U3-A18: anon, service_role et PUBLIC ne peuvent pas executer');
COMMIT;

-- Nettoyage ciblé des seules fixtures 0U3 pour préserver les invariants de la
-- campagne 0R qui suit. Exécution superuser locale, jamais runtime applicatif.
BEGIN;
DELETE FROM public.daily_statement_account_events
WHERE account_registry_id IN (
  poc_test.ctx_get('0u3_registry_id')::uuid,
  poc_test.ctx_get('0u4_sha_registry_id')::uuid
);
DELETE FROM public.daily_statement_units_canonical
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000d9%';
DELETE FROM public.daily_statement_units_staging
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000d9%';
DELETE FROM public.daily_statement_export_attempts
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000d9%';
DELETE FROM public.daily_statement_account_registry
WHERE id IN (
  poc_test.ctx_get('0u3_registry_id')::uuid,
  poc_test.ctx_get('0u4_sha_registry_id')::uuid
);

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_export_attempts) = 0
  AND (SELECT count(*) FROM public.daily_statement_account_registry) = 0
  AND (SELECT count(*) FROM public.daily_statement_account_events) = 0,
  '0U3-A19: teardown cible, campagne 0R retrouve un etat vide');
COMMIT;

SELECT 'ALL_E2E_0U3_HISTORICAL_ADOPTION_PASS' AS result;
