-- ============================================================================
-- SEC-05 — DÉSACTIVATION GRAPHQL ET PRIVILÈGES ANON FAIL-CLOSED
-- ============================================================================
--
-- Objectifs :
--   - supprimer la surface pg_graphql, sans CASCADE ;
--   - retirer tous les privilèges anon/PUBLIC des 13 tables métier historiques ;
--   - fermer l'exécution anonyme de clean_client_name(text, text) ;
--   - empêcher les futurs objets public de recevoir implicitement des droits
--     anon ou PUBLIC.
--
-- Les grants explicites authenticated/service_role et les policies RLS ne sont
-- pas modifiés. DROP EXTENSION reste volontairement RESTRICT : toute dépendance
-- inattendue fait échouer la migration au lieu d'être supprimée en cascade.
-- ============================================================================

BEGIN;

DROP EXTENSION IF EXISTS pg_graphql RESTRICT;

REVOKE ALL PRIVILEGES ON TABLE
  public.bank_audit_log,
  public.bank_evolution_tracking,
  public.bank_facilities,
  public.bank_reports,
  public.client_reconciliation,
  public.collection_report,
  public.deposits_not_cleared,
  public.fund_position,
  public.fund_position_detail,
  public.fund_position_hold,
  public.impayes,
  public.universal_bank_reports,
  public.user_roles
FROM PUBLIC, anon;

REVOKE ALL PRIVILEGES ON FUNCTION public.clean_client_name(text, text)
FROM PUBLIC, anon;

-- Les objets futurs du schéma public naissent fermés pour anon. PUBLIC est
-- également révoqué globalement sur les fonctions car PostgreSQL lui accorde
-- EXECUTE par défaut. Une révocation limitée au schéma ne peut pas annuler ce
-- privilège global ; anon l'hériterait encore. Cette ligne affecte donc toutes
-- les futures fonctions créées par postgres, quel que soit leur schéma.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon;

COMMIT;
