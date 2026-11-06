-- Règles de l'inventaire (ni doublon ni double comptage, rattachement, retrait,
-- attestation, idempotence, autorité unique, ajout seul). Exécuté dans une
-- transaction annulée par le runner : aucun effet ne subsiste.
\set ON_ERROR_STOP on

-- Autorité : seul l'administrateur unique décide.
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('r-1'), NULL, 'NSIA', 'XOF',
  'TR NSIA bis', 'Tentative sans autorité')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_attest_inventory_v1(tr_test.key('r-2'), repeat('a', 64),
  'Tentative sans autorité')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT tr_test.expect_error($$SELECT * FROM treasury_private.expected_accounts$$, 'permission denied');
SELECT tr_test.expect_error($$SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv',
  'QUALIFIED', 'x', 'Qualification depuis le navigateur', 'intrus')$$, 'permission denied');
RESET ROLE;

SELECT tr_test.as_user('t_admin');
-- Ni doublon ni double comptage.
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-1'), tr_test.id('ora_main'),
  NULL, NULL, NULL, 'Second ajout du même compte')$$, 'TREASURY_REGISTRY_ACCOUNT_ALREADY_EXPECTED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-2'), NULL, 'ORA', 'XOF',
  'tr ora HORS inventaire', 'Alias d''un compte déjà au registre')$$, 'TREASURY_REGISTRY_ACCOUNT_EXISTS_LINK_INSTEAD');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-3'), NULL, 'NSIA', 'XOF',
  ' tr nsia principal ', 'Doublon d''alias non enregistré')$$, 'TREASURY_EXPECTED_ACCOUNT_DUPLICATE');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-4'), tr_test.id('ora_unlisted'),
  NULL, NULL, 'Alias libre', 'Alias interdit pour un compte du registre')$$, 'TREASURY_ALIAS_NOT_ALLOWED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-5'), tr_test.id('ora_unlisted'),
  'BDK', NULL, NULL, 'Banque contradictoire')$$, 'TREASURY_BANK_MISMATCH');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-6'), tr_test.id('bridge_inactive'),
  NULL, NULL, NULL, 'Compte désactivé')$$, 'TREASURY_REGISTRY_ACCOUNT_INACTIVE');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-7'), gen_random_uuid(),
  NULL, NULL, NULL, 'Compte inconnu')$$, 'TREASURY_REGISTRY_ACCOUNT_UNKNOWN');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-8'), NULL, 'SGBS', 'XOF',
  'TR SGBS', 'Banque hors périmètre')$$, 'TREASURY_BANK_UNSUPPORTED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('d-9'), NULL, 'NSIA', 'XOF',
  'TR NSIA deux', 'abc')$$, 'TREASURY_REASON_REQUIRED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1('court', NULL, 'NSIA', 'XOF',
  'TR NSIA deux', 'Clé de commande invalide')$$, 'TREASURY_COMMAND_KEY_INVALID');

-- Rattachement d'un compte attendu non enregistré à son compte du registre.
SELECT tr_test.expect_error($$SELECT public.treasury_admin_link_expected_account_v1(tr_test.key('l-1'), tr_test.id('x_bdk_future'),
  tr_test.id('ora_unlisted'), 'Banque différente')$$, 'TREASURY_BANK_MISMATCH');
SELECT public.treasury_admin_link_expected_account_v1(tr_test.key('l-2'), tr_test.id('x_bdk_future'), tr_test.id('bdk_new'),
  'Compte ouvert et enregistré');
RESET ROLE;
SELECT tr_test.assert((SELECT registry_account_id FROM treasury_private.expected_accounts WHERE id = tr_test.id('x_bdk_future'))
  = tr_test.id('bdk_new'), 'rattachement enregistré');
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_link_expected_account_v1(tr_test.key('l-3'), tr_test.id('x_bdk_future'),
  tr_test.id('bdk_new'), 'Second rattachement')$$, 'TREASURY_EXPECTED_ACCOUNT_ALREADY_LINKED');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('l-4'), tr_test.id('bdk_new'),
  NULL, NULL, NULL, 'Compte déjà rattaché')$$, 'TREASURY_REGISTRY_ACCOUNT_ALREADY_EXPECTED');
RESET ROLE;
SELECT tr_test.check('2026-10-01', 'x_bdk_future', 'NOT_COVERED', NULL, 'NO_STATEMENT', 'compte rattaché : relevés du registre');
SELECT tr_test.assert_eq((SELECT count(*)::text FROM jsonb_array_elements(tr_test.read_as('t_reader', '2026-10-01') -> 'accounts') a
  WHERE a ->> 'registry_account_id' = tr_test.id('bdk_new')::text), '1', 'compte rattaché compté une seule fois');

-- Attestation : ce que l'administrateur a vu, et rien d'autre.
SELECT tr_test.as_user('t_admin');
-- Empreinte périmée : refus 22023, jamais 40001 (rejoué en boucle par PostgREST, sans réponse).
SELECT tr_test.expect_error_state($$SELECT public.treasury_admin_attest_inventory_v1(tr_test.key('a-1'), repeat('0', 64),
  'Empreinte périmée')$$, '22023', 'TREASURY_INVENTORY_CHANGED');
RESET ROLE;
DO $$
DECLARE v_fp text := tr_test.read_as('t_reader', '2026-10-01') -> 'inventory' ->> 'fingerprint'; v jsonb; v2 jsonb;
BEGIN
  PERFORM tr_test.assert(v_fp = treasury_private.inventory_fingerprint(), 'empreinte lue = empreinte serveur');
  PERFORM tr_test.as_user('t_admin');
  v := public.treasury_admin_attest_inventory_v1(tr_test.key('a-2'), v_fp, 'Inventaire complet attesté');
  v2 := public.treasury_admin_attest_inventory_v1(tr_test.key('a-2'), v_fp, 'Inventaire complet attesté');
  PERFORM tr_test.expect_error(format($f$SELECT public.treasury_admin_attest_inventory_v1(tr_test.key('a-2'), %L,
    'Autre motif')$f$, v_fp), 'TREASURY_COMMAND_KEY_REUSED');
  RESET ROLE;
  PERFORM tr_test.assert(v = v2, 'rejeu identique : même résultat');
  PERFORM tr_test.assert((SELECT count(*) FROM treasury_private.inventory_attestations) = 1, 'rejeu : une seule attestation');
END $$;
SELECT tr_test.assert((tr_test.read_as('t_reader', '2026-10-01') -> 'inventory' ->> 'attested')::boolean, 'inventaire attesté');

SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_retire_expected_account_v1(tr_test.key('t-1'), tr_test.id('x_nsia'), 'Compte retiré du périmètre');
SELECT tr_test.expect_error($$SELECT public.treasury_admin_retire_expected_account_v1(tr_test.key('t-2'), tr_test.id('x_nsia'),
  'Second retrait')$$, 'TREASURY_EXPECTED_ACCOUNT_RETIRED');
RESET ROLE;
SELECT tr_test.assert(NOT (tr_test.read_as('t_reader', '2026-10-01') -> 'inventory' ->> 'attested')::boolean,
  'un retrait rend l''attestation caduque');

-- Ajout seul : journal, attestations, qualifications, formats et comptes.
SELECT tr_test.expect_error($$UPDATE treasury_private.events SET reason = 'x'$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$DELETE FROM treasury_private.inventory_attestations$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$UPDATE treasury_private.bank_format_qualifications SET status = 'QUALIFIED'$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$UPDATE treasury_private.supported_formats SET period_provenance = 'DECLARED'$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$DELETE FROM treasury_private.expected_accounts WHERE id = tr_test.id('x_nsia')$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$UPDATE treasury_private.expected_accounts SET bank = 'BDK' WHERE id = tr_test.id('x_nsia')$$,
  'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$TRUNCATE treasury_private.events$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.expect_error($$UPDATE treasury_private.commands SET result = '{}'::jsonb$$, 'TREASURY_APPEND_ONLY');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.events WHERE event_type IN
  ('EXPECTED_ACCOUNT_LINKED', 'EXPECTED_ACCOUNT_RETIRED', 'INVENTORY_ATTESTED')) = 3, 'décisions journalisées');

SELECT 'PASS 25_inventory_rules' AS marker;
