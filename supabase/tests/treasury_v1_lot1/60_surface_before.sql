-- Surface d'accès et définitions AVANT la migration du lot (scénario upgrade).
\set ON_ERROR_STOP on
CREATE SCHEMA tr_surface;
CREATE TABLE tr_surface.snap (phase text NOT NULL, kind text NOT NULL, object text NOT NULL, detail text NOT NULL);

CREATE FUNCTION tr_surface.capture(p_phase text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO tr_surface.snap (phase, kind, object, detail)
  -- Privilèges des relations pour les rôles de l'API et PUBLIC.
  SELECT p_phase, 'relacl', n.nspname || '.' || c.relname,
         coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'tr_test', 'tr_surface')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role'))
  UNION ALL
  SELECT p_phase, 'rls', n.nspname || '.' || c.relname, c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'tr_test', 'tr_surface') AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT p_phase, 'policy', n.nspname || '.' || c.relname || '/' || p.polname,
         md5(p.polcmd::text || '|' || p.polpermissive::text || '|' || p.polroles::text || '|'
             || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  UNION ALL
  -- Droit d'exécution des fonctions pour les rôles de l'API et PUBLIC.
  SELECT p_phase, 'funcacl', n.nspname || '.' || f.proname || '(' || array_to_string(f.proargtypes::regtype[]::text[], ',') || ')',
         coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type
  FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'tr_test', 'tr_surface')
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role'))
  UNION ALL
  -- Définitions des fonctions, colonnes, déclencheurs et schémas existants.
  SELECT p_phase, 'funcdef', n.nspname || '.' || f.proname || '(' || array_to_string(f.proargtypes::regtype[]::text[], ',') || ')',
         md5(pg_get_functiondef(f.oid))
  FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'tr_test', 'tr_surface') AND f.prokind IN ('f', 'p')
  UNION ALL
  SELECT p_phase, 'column', n.nspname || '.' || c.relname || '.' || at.attname,
         format_type(at.atttypid, at.atttypmod) || '|' || at.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
  FROM pg_attribute at JOIN pg_class c ON c.oid = at.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = at.attrelid AND d.adnum = at.attnum
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'tr_test', 'tr_surface')
    AND c.relkind IN ('r', 'p', 'v', 'm') AND at.attnum > 0 AND NOT at.attisdropped
  UNION ALL
  SELECT p_phase, 'trigger', n.nspname || '.' || c.relname || '/' || t.tgname, md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname NOT IN ('tr_test', 'tr_surface')
  UNION ALL
  SELECT p_phase, 'nspacl', n.nspname, coalesce(n.nspacl::text, 'DEFAULT')
  FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'tr_test', 'tr_surface')
    AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

SELECT tr_test.assert(tr_surface.capture('before') > 100, 'surface avant capturée');
SELECT 'PASS 60_surface_before' AS marker;
