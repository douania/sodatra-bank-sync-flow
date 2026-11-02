-- Isolation : les fonctions du lot ne lisent aucune donnée de paiement ni
-- aucune table legacy ; seule l'autorité existante du module chèques est
-- appelée (require_bank_read, require_admin). Lecture seule.
\set ON_ERROR_STOP on

WITH f AS (
  SELECT p.oid::regprocedure::text AS sig, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'treasury_private' OR (n.nspname = 'public' AND p.proname LIKE 'treasury\_%')
)
SELECT tr_test.assert(f.prosrc !~* '(bank_reports|fund_position|deposits_not_cleared|impayes|collection_|bank_facilities|client_reconciliation|bank_evolution_tracking|universal_bank_reports|public\.payables_)',
  f.sig || ' : aucune table legacy ni table de paiement')
FROM f;

WITH calls AS (
  SELECT DISTINCT m[1] AS helper
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL regexp_matches(p.prosrc, 'payables_private\.([a-z_]+)', 'g') m
  WHERE n.nspname = 'treasury_private' OR (n.nspname = 'public' AND p.proname LIKE 'treasury\_%')
)
SELECT tr_test.assert_eq((SELECT string_agg(helper, ',' ORDER BY helper) FROM calls), 'require_admin,require_bank_read',
  'seule l''autorité existante du module chèques est appelée');

SELECT tr_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
  WHERE n.nspname = 'treasury_private' AND cn.nspname <> 'treasury_private'), 'aucun déclencheur posé hors du schéma du lot');

SELECT 'PASS 70_isolation' AS marker;
