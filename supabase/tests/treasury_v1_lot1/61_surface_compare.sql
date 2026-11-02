-- Surface APRÈS la migration : rien d'existant n'a changé ni disparu ; les
-- seuls ajouts sont les objets du lot, et le seul nouvel accès de l'API est
-- l'exécution des cinq fonctions publiques par authenticated.
\set ON_ERROR_STOP on
SELECT tr_test.assert(tr_surface.capture('after') > 100, 'surface après capturée');

CREATE TEMP TABLE surface_removed AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'before'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after';
CREATE TEMP TABLE surface_added AS
  SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'after'
  EXCEPT SELECT kind, object, detail FROM tr_surface.snap WHERE phase = 'before';

SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM surface_removed),
  'aucun objet existant modifié ou retiré : ' || coalesce((SELECT string_agg(kind || ' ' || object, '; ') FROM
  (SELECT * FROM surface_removed LIMIT 10) x), ''));
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM surface_added
  WHERE object NOT LIKE 'treasury\_private%' AND object NOT LIKE 'public.treasury\_%'),
  'ajouts limités aux objets du lot : ' || coalesce((SELECT string_agg(kind || ' ' || object, '; ') FROM
  (SELECT * FROM surface_added WHERE object NOT LIKE 'treasury\_private%' AND object NOT LIKE 'public.treasury\_%' LIMIT 10) x), ''));
SELECT tr_test.assert_eq((SELECT string_agg(object || '=' || detail, ';' ORDER BY object) FROM surface_added
  WHERE kind IN ('relacl', 'funcacl')),
  'public.treasury_admin_add_expected_account_v1(text,uuid,text,text,text,text)=authenticated:EXECUTE;'
  || 'public.treasury_admin_attest_inventory_v1(text,text,text)=authenticated:EXECUTE;'
  || 'public.treasury_admin_link_expected_account_v1(text,uuid,uuid,text)=authenticated:EXECUTE;'
  || 'public.treasury_admin_retire_expected_account_v1(text,uuid,text)=authenticated:EXECUTE;'
  || 'public.treasury_balances_at_v1(date)=authenticated:EXECUTE',
  'seuls nouveaux accès : exécution des cinq fonctions publiques par authenticated');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM surface_added WHERE kind = 'policy'), 'aucune politique RLS ajoutée');

SELECT 'PASS 61_surface_compare (' || (SELECT count(*) FROM surface_added) || ' ajouts du lot, 0 changement existant)' AS marker;
