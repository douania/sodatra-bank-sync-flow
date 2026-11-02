-- Qualification par le seul canal opérateur (session postgres de test). Les
-- statuts posés ici sont des FIXTURES de test : la migration n'en pose aucun et
-- aucun statut ne découle des tests synthétiques (voir 10_structure_security).
\set ON_ERROR_STOP on

SELECT treasury_private.set_bank_format_qualification(b, f, 'QUALIFIED', 'tr-test:preuve-synthetique-' || lower(b),
  'Qualification synthétique de test, sans valeur réelle', 'operateur-test')
FROM (VALUES ('ORA', 'structured_bank_statement_csv'), ('BDK', 'structured_bank_statement_csv'),
             ('ATB', 'structured_bank_statement_xls'), ('BIS', 'structured_bank_statement_xls')) AS q(b, f);

SELECT tr_test.assert((SELECT count(*) FROM treasury_private.bank_format_qualifications) = 4, 'quatre qualifications');
SELECT tr_test.assert((SELECT count(*) FROM treasury_private.events WHERE event_type = 'QUALIFICATION_RECORDED'
  AND actor_id IS NULL AND operator_label = 'operateur-test') = 4, 'qualifications journalisées côté opérateur');
SELECT tr_test.expect_error($$SELECT treasury_private.set_bank_format_qualification('NSIA', 'structured_bank_statement_csv',
  'QUALIFIED', 'x', 'Banque sans format pris en charge', 'operateur-test')$$, 'TREASURY_FORMAT_UNSUPPORTED');
SELECT tr_test.expect_error($$SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_xls',
  'QUALIFIED', 'x', 'Couple banque-format non pris en charge', 'operateur-test')$$, 'TREASURY_FORMAT_UNSUPPORTED');
SELECT tr_test.expect_error($$SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv',
  'VALIDÉ', 'x', 'Statut hors vocabulaire fermé', 'operateur-test')$$, 'bank_format_qualifications_status_check');

SELECT 'PASS 30_qualification_setup' AS marker;
