-- Surface APRÈS la migration des refus d'état périmé (scénario upgrade), comparée à
-- la surface après le Lot 1 opérationnel : seules changent les définitions des deux
-- commandes, et seulement par les trois SQLSTATE 40001 -> 22023 ; signatures,
-- attributs, propriétaire et droits inchangés ; aucun objet, droit ni politique
-- ajouté ou retiré.
\set ON_ERROR_STOP on
SELECT tr_test.assert(tr_surface.capture('after_stale') > 100, 'surface après la migration capturée');

CREATE TEMP TABLE stale_removed AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_op'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_stale';
CREATE TEMP TABLE stale_added AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_stale'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after_op';
SELECT tr_test.assert_eq((SELECT string_agg(kind || ' ' || object, ';' ORDER BY object COLLATE "C") FROM stale_removed),
  'funcdef public.treasury_admin_attest_inventory_v1(text,text,text);'
  || 'funcdef public.treasury_admin_set_verified_start_v1(text,uuid,date,uuid,text,text,text,text)',
  'seules les deux définitions annoncées changent');
SELECT tr_test.assert_eq((SELECT string_agg(kind || ' ' || object, ';' ORDER BY object COLLATE "C") FROM stale_added),
  'funcdef public.treasury_admin_attest_inventory_v1(text,text,text);'
  || 'funcdef public.treasury_admin_set_verified_start_v1(text,uuid,date,uuid,text,text,text,text)',
  'aucun objet, droit ni politique ajouté');

CREATE TEMP TABLE stale_after AS
SELECT p.oid::regprocedure::text AS signature, replace(p.prosrc, E'\r', '') AS body, p.prosecdef, p.provolatile,
       p.proconfig, p.proowner::regrole::text AS owner, p.proacl::text AS acl, pg_get_function_result(p.oid) AS result,
       p.proargnames, p.pronargdefaults, l.lanname
FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid IN ('public.treasury_admin_attest_inventory_v1(text, text, text)'::regprocedure,
                'public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)'::regprocedure);
SELECT tr_test.assert(NOT EXISTS (
    (SELECT signature, prosecdef, provolatile, proconfig, owner, acl, result, proargnames, pronargdefaults, lanname FROM tr_surface.stale_before)
    EXCEPT (SELECT signature, prosecdef, provolatile, proconfig, owner, acl, result, proargnames, pronargdefaults, lanname FROM stale_after))
  AND (SELECT count(*) FROM stale_after) = 2,
  'signatures, attributs (SECURITY DEFINER, search_path), propriétaire et droits inchangés');
SELECT tr_test.assert(NOT EXISTS (
    SELECT 1 FROM tr_surface.stale_before b JOIN stale_after a USING (signature)
    WHERE replace(replace(a.body,
            'ERRCODE = ''22023'', MESSAGE = ''TREASURY_INVENTORY_CHANGED''',
            'ERRCODE = ''40001'', MESSAGE = ''TREASURY_INVENTORY_CHANGED'''),
            'ERRCODE = ''22023'', MESSAGE = ''TREASURY_VERIFIED_START_STALE''',
            'ERRCODE = ''40001'', MESSAGE = ''TREASURY_VERIFIED_START_STALE''') <> b.body),
  'corps identiques, aux trois SQLSTATE près');
SELECT tr_test.assert_eq((SELECT sum(cardinality(regexp_split_to_array(body, 'ERRCODE = ''22023'', MESSAGE = ''TREASURY_(INVENTORY_CHANGED|VERIFIED_START_STALE)''')) - 1)::text
  FROM stale_after), '3', 'trois refus d''état périmé en 22023');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM stale_after WHERE position('ERRCODE = ''40001''' IN body) > 0),
  'plus aucun 40001 dans les deux commandes');

SELECT 'PASS 64_surface_compare_stale_sqlstate' AS marker;
