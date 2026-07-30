-- ============================================================================
-- DAILY V2 — EXPOSITION READ-ONLY DU VERROU RUNTIME
-- ============================================================================
-- Objectif :
--   - permettre au frontend authentifié d'aligner ses capacités de mutation
--     sur le verrou PostgreSQL installé par 20260730170000 ;
--   - ne révéler qu'un booléen non sensible ;
--   - rester fail-closed si le singleton de contrôle est absent.
--
-- Cette migration n'ajoute aucun setter et ne modifie jamais l'état du verrou.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.daily_stmt_mutations_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT control.mutations_enabled
      FROM daily_v2_private.runtime_control AS control
      WHERE control.singleton = true
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.daily_stmt_mutations_enabled()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.daily_stmt_mutations_enabled()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.daily_stmt_mutations_enabled() IS
  'Read-only Daily v2 runtime lock state. Returns false when the control singleton is absent.';

COMMIT;
