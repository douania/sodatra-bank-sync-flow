-- Structure, privilèges et interrupteur (S1–S5). Rôle postgres sauf mention.

-- Transport du rejeu : un accent doit arriver intact (sinon les tests de
-- normalisation échoueraient pour une mauvaise raison).
SELECT pc_test.assert(encode(convert_to('é', 'UTF8'), 'hex') = 'c3a9', 'SQL transport keeps UTF-8 intact');

-- Aucune politique ouverte à tous, aucune politique d'écriture.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE tablename LIKE 'payables\_%' ESCAPE '\'
    AND (qual IN ('true','(true)') OR with_check IS NOT NULL OR cmd <> 'SELECT')),
  'policies are SELECT-only and never USING(true)');

-- RLS active sur toutes les tables du domaine.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'payables\_%' ESCAPE '\' AND NOT c.relrowsecurity),
  'RLS enabled on every payables table');

-- Aucune écriture directe pour les rôles applicatifs (S4).
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_name LIKE 'payables\_%' ESCAPE '\' AND grantee IN ('anon','authenticated','service_role','PUBLIC')
    AND privilege_type <> 'SELECT'),
  'no write privilege for application roles');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_name LIKE 'payables\_%' ESCAPE '\' AND grantee IN ('anon','service_role','PUBLIC')),
  'anon and service_role cannot read domain tables');
SELECT pc_test.assert(NOT has_table_privilege('authenticated', 'public.payables_command_idempotency', 'SELECT'),
  'command registry is not readable');

-- Schéma privé fermé, aucune fonction exécutable par les rôles applicatifs hors API.
SELECT pc_test.assert(NOT has_schema_privilege(r, 'payables_private', 'USAGE'), 'private schema closed to ' || r)
FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\')
    AND (has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'no payables function executable by service_role or anon');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'payables_private' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'no private helper executable by authenticated');

-- Chaque fonction SECURITY DEFINER épingle son chemin de recherche.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\') AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')),
  'every SECURITY DEFINER function pins search_path');

-- Aucune fonction de purge (S63).
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\')
    AND p.prorettype <> 'trigger'::regtype
    AND p.proname ~ '(purge|delete|truncate|drop)'), 'no purge function exists');

-- Interrupteur fermé par défaut ; la portée export ne peut pas s'ouvrir dans ce lot.
SELECT pc_test.assert((SELECT NOT business_writes_enabled AND NOT export_enabled FROM payables_private.runtime_control),
  'runtime control closed by default');
SELECT pc_test.expect_error($$UPDATE payables_private.runtime_control SET export_enabled = true,
  business_writes_enabled = true, change_reason = 'Attempt to open export scope'$$, 'runtime_control_export_enabled_check');
SELECT pc_test.expect_error($$DELETE FROM payables_private.runtime_control$$, 'PAYABLES_RUNTIME_CONTROL_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$UPDATE payables_private.runtime_control SET change_reason = 'Same mode new reason'$$,
  'PAYABLES_RUNTIME_CONTROL_MODE_UNCHANGED');

-- S1 : appel sans identité.
SELECT pc_test.as_anonymous();
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1('pc-test:anon-1','X','reason')$$, 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1('pc-test:anon-2','Fournisseur','Raison test')$$,
  'PAYABLES_AUTH_REQUIRED');

-- S2 : domaine fermé, écriture refusée avant tout contrôle de capacité.
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1('pc-test:closed-1','Fournisseur','Raison test')$$,
  'PAYABLES_DOMAIN_READ_ONLY');
-- S5 : un compte authentifié sans capacité ne lit rien.
SELECT pc_test.assert((SELECT count(*) FROM public.payables_suppliers) = 0, 'no read without capability');
SELECT pc_test.expect_error($$SELECT * FROM public.payables_invoice_overview_v1()$$, 'PAYABLES_CAPABILITY_REQUIRED:READ');
-- S4 : écriture directe impossible.
SELECT pc_test.expect_error($$INSERT INTO public.payables_suppliers (canonical_name, normalized_name, created_by)
  VALUES ('X', 'X', auth.uid())$$, 'permission denied');
SELECT pc_test.expect_error($$SELECT payables_private.has_capability(auth.uid(), 'READ')$$, 'permission denied');
RESET ROLE;

-- Ouverture opérateur (test local uniquement) : la bascule est journalisée.
UPDATE payables_private.runtime_control
   SET business_writes_enabled = true, change_reason = 'Open synthetic PG17 qualification window';
SELECT pc_test.assert((SELECT count(*) FROM payables_private.runtime_control_events WHERE new_business) = 1,
  'runtime opening journaled');
SELECT pc_test.expect_error($$DELETE FROM payables_private.runtime_control_events$$, 'PAYABLES_APPEND_ONLY');

-- S3 : un administrateur technique sans capacité métier est refusé.
SELECT pc_test.as_user('admin');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1('pc-test:admin-1','Fournisseur','Raison test')$$,
  'PAYABLES_CAPABILITY_REQUIRED:SUPPLIER_MANAGE');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1('pc-test:admin-2', pc_test.id('admin'),
  'READ','GRANT','Auto attribution')$$, 'PAYABLES_CAPABILITY_REQUIRED:PARAM_PROPOSE');
RESET ROLE;

-- Amorçage de la gouvernance : opérateur seulement, deux personnes distinctes, une fois.
SELECT pc_test.expect_error($$SELECT payables_private.bootstrap_parameter_governance(pc_test.id('gov_a'), pc_test.id('gov_a'),
  'Bootstrap with one user')$$, 'PAYABLES_BOOTSTRAP_TWO_DISTINCT_USERS_REQUIRED');
SELECT payables_private.bootstrap_parameter_governance(pc_test.id('gov_a'), pc_test.id('gov_b'),
  'Synthetic bootstrap of parameter governance');
SELECT pc_test.expect_error($$SELECT payables_private.bootstrap_parameter_governance(pc_test.id('acc1'), pc_test.id('acc2'),
  'Second bootstrap attempt')$$, 'PAYABLES_BOOTSTRAP_ALREADY_DONE');
SELECT pc_test.assert(payables_private.has_capability(pc_test.id('gov_a'), 'PARAM_PROPOSE')
  AND payables_private.has_capability(pc_test.id('gov_b'), 'PARAM_VALIDATE')
  AND NOT payables_private.has_capability(pc_test.id('acc1'), 'READ'), 'bootstrap grants only governors');

SELECT 'PASS 10_structure_security' AS marker;
