-- Interrupteur serveur puis inventaire des comptes attendus, constitué par
-- l'administrateur unique par les seules commandes publiques. Validé
-- (committed) : base des scénarios suivants.
\set ON_ERROR_STOP on

-- Module fermé tant que le canal opérateur ne l'a pas ouvert : ni lecture ni commande.
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM treasury_private.module_switch_events), 'aucune décision posée par la migration');
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'TREASURY_MODULE_CLOSED');
RESET ROLE;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1('setup-closed-add', NULL, 'NSIA', 'XOF',
  'TR NSIA fermé', 'Commande refusée tant que le module est fermé')$$, 'TREASURY_MODULE_CLOSED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM treasury_private.commands), 'aucune commande enregistrée module fermé');

SELECT treasury_private.set_module_open(true, 'tr-test:ouverture-locale', 'Ouverture synthétique pour la suite locale',
  'operateur-test');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.events WHERE event_type = 'MODULE_SWITCH_RECORDED'
  AND actor_id IS NULL AND operator_label = 'operateur-test') = 1, 'ouverture journalisée côté opérateur');

SELECT tr_test.as_user('t_admin');
SELECT tr_test.put('x_' || n, (public.treasury_admin_add_expected_account_v1(tr_test.key('add-' || n), tr_test.id(n), NULL, NULL,
  NULL, 'Compte attendu synthétique ' || n) ->> 'expected_account_id')::uuid)
FROM unnest(ARRAY['ora_main', 'bdk_break', 'atb_gap', 'bis_gap', 'bicis_prov', 'ora_cur', 'bridge_inactive', 'eur_acc',
                  'ora_review', 'bdk_noref', 'ora_conflict', 'ora_lead', 'ora_nostmt', 'ora_after', 'bdk_intraday',
                  'ora_contest', 'ora_oldparser', 'ora_identity', 'ora_next', 'atb_weekend', 'ora_cont', 'ora_reset',
                  'ora_tail', 'ora_dispute', 'ora_pending_mid', 'ora_staged_mid', 'ora_back', 'ora_lead_pending',
                  'ora_first_pending', 'ora_prov', 'bis_nobal_first']) n;
SELECT tr_test.put('x_nsia', (public.treasury_admin_add_expected_account_v1(tr_test.key('add-nsia'), NULL, 'NSIA', 'XOF',
  'TR NSIA principal', 'Banque attendue sans export pris en charge') ->> 'expected_account_id')::uuid);
SELECT tr_test.put('x_bdk_future', (public.treasury_admin_add_expected_account_v1(tr_test.key('add-bdk-future'), NULL, 'bdk', 'xof',
  'TR BDK à ouvrir', 'Compte attendu non encore enregistré') ->> 'expected_account_id')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Le compte BRIDGE est ensuite désactivé dans le registre Daily v2 (jeu d'essai).
SET session_replication_role = replica;
UPDATE public.daily_statement_account_registry
   SET status = 'inactive', deactivated_at = now(), deactivated_by = tr_test.id('t_admin'),
       deactivation_reason = 'Désactivation synthétique'
 WHERE id = tr_test.id('bridge_inactive');
SET session_replication_role = origin;

SELECT tr_test.assert((SELECT count(*) FROM treasury_private.expected_accounts WHERE status = 'ACTIVE') = 33,
  '33 comptes attendus actifs');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.events WHERE event_type = 'EXPECTED_ACCOUNT_ADDED') = 33,
  'chaque ajout journalisé');
SELECT tr_test.assert((SELECT bank || '/' || currency FROM treasury_private.expected_accounts WHERE id = tr_test.id('x_bdk_future'))
  = 'BDK/XOF', 'banque et devise normalisées');

SELECT 'PASS 20_inventory_setup' AS marker;
