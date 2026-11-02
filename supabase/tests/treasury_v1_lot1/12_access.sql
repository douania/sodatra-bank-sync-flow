-- Accès : BANK_READ par le mécanisme existant (READ ou AUDIT + BANK_READ),
-- refus sans habilitation, sans session ou en anonyme ; dates refusées.
-- Lecture seule ; rejouable dans une transaction (mutants).
\set ON_ERROR_STOP on

-- Module refermé par le canal opérateur : lecture et commandes refusées à tous,
-- administrateur compris, avant toute autre vérification.
SELECT treasury_private.set_module_open(false, 'tr-test:fermeture', 'Fermeture synthétique du module', 'operateur-test');
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'TREASURY_MODULE_CLOSED');
RESET ROLE;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'TREASURY_MODULE_CLOSED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_attest_inventory_v1('access-closed-attest', 'x',
  'Attestation refusée module fermé')$$, 'TREASURY_MODULE_CLOSED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.expect_error($$SELECT treasury_private.set_module_open(NULL, 'x', 'Décision absente', 'operateur-test')$$,
  'TREASURY_SWITCH_INVALID');
SELECT treasury_private.set_module_open(true, 'tr-test:reouverture', 'Réouverture synthétique du module', 'operateur-test');

SELECT tr_test.as_user('t_plain');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'PAYABLES_CAPABILITY_REQUIRED:READ');
RESET ROLE;
SELECT tr_test.as_user('t_read_only');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'PAYABLES_CAPABILITY_REQUIRED:BANK_READ');
RESET ROLE;
SELECT tr_test.as_anonymous();
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE authenticated;
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1('2026-10-01')$$, 'TREASURY_AUTH_REQUIRED');
RESET ROLE;

SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error($$SELECT public.treasury_balances_at_v1(NULL)$$, 'TREASURY_AS_OF_REQUIRED');
SELECT tr_test.expect_error(format('SELECT public.treasury_balances_at_v1(%L::date)',
  ((now() AT TIME ZONE 'Africa/Dakar')::date + 1)::text), 'TREASURY_FUTURE_DATE_FORBIDDEN');
SELECT tr_test.assert((public.treasury_balances_at_v1('2026-10-01') ->> 'contract') = 'treasury_balances_at_v1', 'lecture autorisée');
RESET ROLE;

SELECT tr_test.as_user('t_auditor');
SELECT tr_test.assert((public.treasury_balances_at_v1('2026-10-01') ->> 'contract') = 'treasury_balances_at_v1',
  'AUDIT + BANK_READ autorisé');
RESET ROLE;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.assert((public.treasury_balances_at_v1('2026-10-01') ->> 'contract') = 'treasury_balances_at_v1',
  'administrateur : capacités implicites existantes');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT 'PASS 12_access' AS marker;
