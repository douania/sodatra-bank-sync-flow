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
-- Course fusion fournisseur ↔ réservation (revue CTO P2-6).
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('sup_race_abs', (public.payables_create_supplier_v1(pc_test.key('sup-race-abs'),
  'Fournisseur course absorbe', 'Course fusion') ->> 'supplier_id')::uuid);
SELECT pc_test.put('sup_race_kept', (public.payables_create_supplier_v1(pc_test.key('sup-race-kept'),
  'Fournisseur course conserve', 'Course fusion') ->> 'supplier_id')::uuid);
SELECT pc_test.put('inv_race_merge', (public.payables_create_invoice_v1(pc_test.key('inv-race-merge'), pc_test.id('sup_race_abs'),
  'MERGE-RACE-1', 7000, 'XOF', NULL, NULL, 'Original course fusion') ->> 'invoice_id')::uuid);
RESET ROLE;
-- Course rattachement ↔ remise en revue concurrente de l'unité (contre-revue CTO
-- de 4fbb65f) : rapprochement confirmé, relevé remplacé, ligne remplaçante prête.
SELECT pc_test.as_user('acc2');
SELECT public.payables_declare_issuance_exception_v1(pc_test.key('declare-race-rebind'), pc_test.id('acct_ora'), '0004101', 6000,
  DATE '2026-10-20', NULL, 'OTHER_OUTSIDE_CIRCUIT', 'Talon du chéquier', 'Course rattachement');
RESET ROLE;
SELECT pc_test.put('u_race_rb', pc_test.add_unit('acct_ora', DATE '2026-10-21', 8100000));
SELECT pc_test.add_line(pc_test.id('u_race_rb'), 'l_race_rb', 'CHQ RECU COMPENSE 0004101 CHQ OCI N. 0004101', 6000);
SELECT pc_test.as_user('acc4');
SELECT public.payables_propose_bank_matches_v1(pc_test.key('prop-race-rb'), pc_test.id('acct_ora'), DATE '2026-10-21');
SELECT pc_test.assert((public.payables_decide_bank_match_v1(pc_test.key('confirm-race-rb'), pc_test.proposal_for_line('l_race_rb'),
  pc_test.proposal_version(pc_test.proposal_for_line('l_race_rb')), 'CONFIRM', NULL) ->> 'outcome') = 'CONFIRMED',
  'race rebind: match confirmed');
SELECT pc_test.put('match_race_rb', pc_test.proposal_for_line('l_race_rb'));
RESET ROLE;
SELECT pc_test.put('u_race_rb_r', pc_test.supersede(pc_test.id('u_race_rb'), '_r1'));
-- Lecture cohérente pendant une écriture concurrente (contre-revue CTO P2) :
-- deux factures dont l'une changera de place et de montant pendant la lecture.
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('inv_read_1', (public.payables_create_invoice_v1(pc_test.key('inv-read-1'), pc_test.id('sup_delta'),
  'READ-RACE-1', 1000, 'XOF', NULL, DATE '2026-12-01', 'Original lecture 1') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_read_2', (public.payables_create_invoice_v1(pc_test.key('inv-read-2'), pc_test.id('sup_delta'),
  'READ-RACE-2', 2000, 'XOF', NULL, DATE '2026-11-15', 'Original lecture 2') ->> 'invoice_id')::uuid);
RESET ROLE;
CREATE TABLE pc_test.read_capture (payload jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp());
GRANT INSERT, SELECT ON pc_test.read_capture TO authenticated;
CREATE TABLE pc_test.read_before (invoice_count bigint, total numeric);
INSERT INTO pc_test.read_before SELECT count(*), sum(amount) FROM public.payables_invoices;
SELECT 'PASS 70_concurrency_setup' AS marker;
