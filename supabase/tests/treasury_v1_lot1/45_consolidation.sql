-- Consolidation : registre attesté ou non, comptes hors inventaire, statut
-- PARTIEL ou BLOQUÉ propagé, total seulement lorsque tout est couvert.
-- Exécuté dans une transaction annulée par le runner.
\set ON_ERROR_STOP on

-- Ne garder que deux comptes disponibles au 05 (ORA principal, ATB).
SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_retire_expected_account_v1(tr_test.key('c-retire-' || n), tr_test.id(n), 'Réduction du périmètre de test')
FROM unnest(ARRAY['x_bdk_break', 'x_bis_gap', 'x_bicis_prov', 'x_ora_cur', 'x_bridge_inactive', 'x_eur_acc', 'x_ora_review',
                  'x_bdk_noref', 'x_ora_conflict', 'x_ora_lead', 'x_ora_nostmt', 'x_ora_after', 'x_bdk_intraday',
                  'x_ora_contest', 'x_ora_oldparser', 'x_ora_identity', 'x_ora_next', 'x_atb_weekend', 'x_ora_cont',
                  'x_ora_reset', 'x_ora_tail', 'x_nsia', 'x_bdk_future']) n;
RESET ROLE;

-- Comptes du registre restés hors inventaire : la ligne reste partielle.
DO $$
DECLARE c jsonb := tr_test.read_as('t_reader', '2026-10-05') -> 'consolidation';
BEGIN
  PERFORM tr_test.assert_eq(c ->> 'status', 'PARTIAL', 'comptes hors inventaire : partiel');
  PERFORM tr_test.assert_eq(c ->> 'amount', '1850.00', 'sous-total 1150 + 700');
  PERFORM tr_test.assert(c -> 'reasons' ? 'REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY', 'motif : comptes hors inventaire');
  PERFORM tr_test.assert(c -> 'reasons' ? 'INVENTORY_NOT_ATTESTED', 'motif : inventaire non attesté');
END $$;

-- Les comptes retirés restent actifs au registre : ils sont signalés hors
-- inventaire. Ils sont désactivés au registre (jeu d'essai), sauf les deux gardés.
SET session_replication_role = replica;
UPDATE public.daily_statement_account_registry
   SET status = 'inactive', deactivated_at = now(), deactivated_by = tr_test.id('t_admin'), deactivation_reason = 'Hors test'
 WHERE status = 'active' AND id NOT IN (tr_test.id('ora_main'), tr_test.id('atb_gap'));
SET session_replication_role = origin;

DO $$
DECLARE c jsonb := tr_test.read_as('t_reader', '2026-10-05') -> 'consolidation';
BEGIN
  PERFORM tr_test.assert_eq(c ->> 'status', 'PARTIAL', 'registre non attesté : partiel');
  PERFORM tr_test.assert_eq(c -> 'reasons' #>> '{}', '["INVENTORY_NOT_ATTESTED"]', 'seul motif : attestation');
END $$;

-- Attestation de l'inventaire affiché : total complet.
DO $$
DECLARE v_fp text := tr_test.read_as('t_reader', '2026-10-05') -> 'inventory' ->> 'fingerprint'; c jsonb;
BEGIN
  PERFORM tr_test.as_user('t_admin');
  PERFORM public.treasury_admin_attest_inventory_v1(tr_test.key('c-attest'), v_fp, 'Inventaire de test attesté');
  RESET ROLE;
  c := tr_test.read_as('t_reader', '2026-10-05') -> 'consolidation';
  PERFORM tr_test.assert_eq(c ->> 'status', 'COMPLETE', 'tout est couvert et attesté : complet');
  PERFORM tr_test.assert_eq(c ->> 'amount', '1850.00', 'total à D');
  PERFORM tr_test.assert_eq(jsonb_array_length(c -> 'reasons')::text, '0', 'aucun motif');
  -- Même inventaire, autre date : un compte non couvert rend la ligne partielle, sans le masquer.
  c := tr_test.read_as('t_reader', '2026-10-03') -> 'consolidation';
  PERFORM tr_test.assert_eq(c ->> 'status', 'PARTIAL', 'ATB non couvert le 03 : partiel');
  PERFORM tr_test.assert_eq(c ->> 'amount', '1200.00', 'sous-total partiel : ORA seul');
  PERFORM tr_test.assert_eq(c ->> 'accounts_available' || '/' || (c ->> 'accounts_expected'), '1/2', '1 compte sur 2');
END $$;

-- Un compte attendu ajouté après l'attestation : non attesté et non couvert.
SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('c-add-nsia'), NULL, 'NSIA', 'XOF', 'TR NSIA neuf',
  'Compte attendu ajouté après attestation');
RESET ROLE;
DO $$
DECLARE c jsonb := tr_test.read_as('t_reader', '2026-10-05') -> 'consolidation';
BEGIN
  PERFORM tr_test.assert_eq(c ->> 'status', 'PARTIAL', 'ajout après attestation : partiel');
  PERFORM tr_test.assert(c -> 'reasons' ? 'INVENTORY_NOT_ATTESTED' AND c -> 'reasons' ? 'ACCOUNTS_NOT_COVERED', 'motifs');
END $$;

-- Un compte bloqué bloque la ligne : il ne disparaît pas du total.
SET session_replication_role = replica;
UPDATE public.daily_statement_account_registry
   SET status = 'active', deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL
 WHERE id = tr_test.id('bdk_break');
SET session_replication_role = origin;
SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('c-readd-bdk'), tr_test.id('bdk_break'), NULL, NULL, NULL,
  'Compte bloqué remis dans l''inventaire');
RESET ROLE;
DO $$
DECLARE r jsonb := tr_test.read_as('t_reader', '2026-10-05'); c jsonb := r -> 'consolidation';
BEGIN
  PERFORM tr_test.assert_eq(c ->> 'status', 'BLOCKED', 'un compte bloqué bloque la ligne');
  PERFORM tr_test.assert_eq(c ->> 'accounts_blocked', '1', 'compte bloqué compté');
  PERFORM tr_test.assert_eq(tr_test.account(r, 'bdk_break') ->> 'status', 'BLOCKED', 'compte bloqué toujours listé');
END $$;

SELECT 'PASS 45_consolidation' AS marker;
