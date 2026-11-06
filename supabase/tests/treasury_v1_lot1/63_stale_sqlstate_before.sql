-- Corps et attributs des deux commandes AVANT la migration des refus d'état périmé
-- (scénario upgrade, base peuplée) : la comparaison 64 exige que seuls changent les
-- trois SQLSTATE 40001 -> 22023.
\set ON_ERROR_STOP on
CREATE TABLE tr_surface.stale_before AS
SELECT p.oid::regprocedure::text AS signature, replace(p.prosrc, E'\r', '') AS body, p.prosecdef, p.provolatile,
       p.proconfig, p.proowner::regrole::text AS owner, p.proacl::text AS acl, pg_get_function_result(p.oid) AS result,
       p.proargnames, p.pronargdefaults, l.lanname
FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid IN ('public.treasury_admin_attest_inventory_v1(text, text, text)'::regprocedure,
                'public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)'::regprocedure);
SELECT tr_test.assert((SELECT count(*) FROM tr_surface.stale_before) = 2, 'deux commandes relevées avant la migration');
SELECT tr_test.assert_eq((SELECT sum(cardinality(regexp_split_to_array(body, 'ERRCODE = ''40001''')) - 1)::text
  FROM tr_surface.stale_before), '3', 'trois refus 40001 avant la migration');
SELECT 'PASS 63_stale_sqlstate_before' AS marker;
