-- Structure et privilèges minimaux des objets du lot. Lecture seule.
\set ON_ERROR_STOP on

-- Schéma privé fermé aux rôles de l'API.
SELECT tr_test.assert(NOT has_schema_privilege(r, 'treasury_private', 'USAGE'), 'schéma privé fermé à ' || r)
FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT tr_test.assert(NOT has_table_privilege(r, c.oid, p), format('%s fermé à %s (%s)', c.relname, r, p))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
WHERE n.nspname = 'treasury_private' AND c.relkind = 'r';
SELECT tr_test.assert(c.relrowsecurity, c.relname || ' : RLS active (défense en profondeur, aucune politique)')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'treasury_private' AND c.relkind = 'r';
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'treasury_private'), 'aucune politique : accès direct impossible');

-- Fonctions internes non exécutables par l'API ; canal opérateur non exposé.
SELECT tr_test.assert(NOT has_function_privilege(r, p.oid, 'EXECUTE'), p.oid::regprocedure::text || ' fermée à ' || r)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
WHERE n.nspname = 'treasury_private';
SELECT tr_test.assert(p.proacl IS NOT NULL AND p.proacl::text !~ '(\{|,)=X/', p.oid::regprocedure::text || ' : aucun EXECUTE à PUBLIC')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'treasury_private' OR (n.nspname = 'public' AND p.proname LIKE 'treasury\_%');

-- Fonctions publiques : authenticated seulement, SECURITY DEFINER, chemin épinglé.
SELECT tr_test.assert(has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  AND p.prosecdef AND p.proconfig::text LIKE '%search_path=public, pg_temp%', p.oid::regprocedure::text || ' : privilèges minimaux')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'treasury\_%';
SELECT tr_test.assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'treasury\_%') = 5, 'cinq fonctions publiques exactement');

-- Lecture en une instruction, instantané de l'appelant.
SELECT tr_test.assert((SELECT provolatile FROM pg_proc WHERE oid = 'public.treasury_balances_at_v1(date)'::regprocedure) = 's',
  'lecture STABLE');
SELECT tr_test.assert((SELECT provolatile = 's' AND prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
  FROM pg_proc WHERE oid = 'treasury_private.balances_snapshot(date, date)'::regprocedure), 'calcul : une instruction SQL STABLE');

-- Provenance établie format par format ; aucune qualification posée par la migration.
SELECT tr_test.assert_eq((SELECT string_agg(bank || ':' || period_provenance, ',' ORDER BY bank)
  FROM treasury_private.supported_formats), 'ATB:INFERRED,BDK:DECLARED,BICIS:INFERRED,BIS:INFERRED,BRIDGE:INFERRED,ORA:DECLARED',
  'provenance des périodes');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.bank_format_qualifications) = 0,
  'aucune qualification posée par la migration : rien n''est QUALIFIÉ par défaut');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.module_switch_events) = 0,
  'aucune ouverture posée par la migration : module fermé par défaut');

SELECT 'PASS 10_structure_security' AS marker;
