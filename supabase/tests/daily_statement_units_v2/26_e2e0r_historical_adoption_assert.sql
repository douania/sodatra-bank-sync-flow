-- ============================================================================
-- LOCAL-E2E-0U3 — ASSERTIONS DU PONT D'ADOPTION HISTORIQUE
-- ============================================================================
\set ON_ERROR_STOP on

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
COMMIT;

BEGIN;
SELECT poc_test.assert(
  (SELECT account_fingerprint = repeat('9',64)
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
     AND account_fingerprint = repeat('9',64)) = 3,
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
  position(repeat('9',64) IN (
    SELECT coalesce(string_agg(safe_message || coalesce(safe_details::text,''),''),'')
    FROM public.daily_statement_account_events
    WHERE account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid
  )) = 0,
  '0U3-A15: le fingerprint n apparait jamais dans l audit');
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
WHERE account_registry_id = poc_test.ctx_get('0u3_registry_id')::uuid;
DELETE FROM public.daily_statement_units_canonical
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%';
DELETE FROM public.daily_statement_units_staging
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%';
DELETE FROM public.daily_statement_export_attempts
WHERE id::text LIKE '00000000-0000-4000-8000-00000000a9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000b9%'
   OR id::text LIKE '00000000-0000-4000-8000-00000000c9%';
DELETE FROM public.daily_statement_account_registry
WHERE id = poc_test.ctx_get('0u3_registry_id')::uuid;

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_export_attempts) = 0
  AND (SELECT count(*) FROM public.daily_statement_account_registry) = 0
  AND (SELECT count(*) FROM public.daily_statement_account_events) = 0,
  '0U3-A19: teardown cible, campagne 0R retrouve un etat vide');
COMMIT;

SELECT 'ALL_E2E_0U3_HISTORICAL_ADOPTION_PASS' AS result;
