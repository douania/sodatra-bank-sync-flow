-- Préparation des courses réelles à deux sessions (S8, S9, interrupteur).
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('inv_conc', (public.payables_create_invoice_v1(pc_test.key('inv-conc'), pc_test.id('sup_delta'), 'CONC-1',
  5000, 'XOF', NULL, NULL, 'Original concurrence') ->> 'invoice_id')::uuid);
RESET ROLE;
SELECT pc_test.new_payment('acc1', 'pay_race', 'sup_delta', 21000, 'acct_ora');
SELECT pc_test.print_cheque('acc1', 'pay_race', '0004001', DATE '2026-10-26');
SELECT pc_test.sign('pay_race', 'p_dir', DATE '2026-10-26');
RESET ROLE;
SELECT pc_test.put('race_form_version', pc_test.id('form_pay_race'));
CREATE TABLE pc_test.race_state (name text PRIMARY KEY, value integer);
INSERT INTO pc_test.race_state VALUES ('form_version', pc_test.form_version(pc_test.id('form_pay_race')));
GRANT SELECT ON pc_test.race_state TO authenticated;
SELECT 'PASS 70_concurrency_setup' AS marker;
