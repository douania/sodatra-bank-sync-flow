-- ============================================================================
-- 0M-E — BRIDGE PLAN B : neutralisation from-scratch de unique_excel_upsert
-- ============================================================================
-- Position dans la chaîne : après 20250626100949_still_violet.sql et avant
-- 20250626101422_yellow_valley.sql (ni l'une ni l'autre ne peut être modifiée :
-- toutes deux sont présentes au ledger prod — vérification opérateur Dashboard
-- du 2026-07-09, voir docs/DB_TRUTH.md).
--
-- Problème résolu :
--   * Sur base VIERGE, still_violet crée la contrainte unique_excel_upsert
--     (UNIQUE ... DEFERRABLE), dont Postgres fait dépendre un index du même
--     nom. yellow_valley exécute ensuite `DROP INDEX IF EXISTS
--     unique_excel_upsert` : supprimer l'index porté par une contrainte est
--     interdit (erreur 2BP01) → rejeu from-scratch impossible sans ce bridge.
--   * Sur la PROD réelle, cet enchaînement n'a pas laissé la contrainte en
--     place (yellow_valley y est passé) : ce bridge est donc un NO-OP prod.
--
-- Le bridge droppe proprement la CONTRAINTE (ce qui supprime aussi son index
-- porteur), puis, par ceinture de sécurité, un éventuel index isolé du même
-- nom. Idempotent, no-op si l'objet n'existe pas, aucune donnée touchée.
--
-- idx_collection_excel_upsert_partial (2e objet de still_violet) n'est PAS
-- touché ici : white_meadow (20250627095510) le droppe déjà plus loin dans la
-- chaîne — validé par le test full-chain (supabase/tests/full_chain_replay/).
-- ============================================================================

ALTER TABLE public.collection_report DROP CONSTRAINT IF EXISTS unique_excel_upsert;

DROP INDEX IF EXISTS public.unique_excel_upsert;
