-- Faits immuables, ajout seul, hygiène des messages et refermeture (S37, S38, S47, S63).

-- Ajout seul, y compris pour l'opérateur base de données.
SELECT pc_test.expect_error($$UPDATE public.payables_events SET reason = 'réécriture'$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$DELETE FROM public.payables_events$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$TRUNCATE public.payables_events$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$UPDATE public.payables_cheque_contents SET fields = '{}'::jsonb$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$UPDATE public.payables_signatures SET signed_on = DATE '2026-01-01'$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$UPDATE public.payables_issuances SET amount = 1$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$UPDATE public.payables_bank_line_references SET reference_text = '1'$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$DELETE FROM public.payables_payments$$, 'PAYABLES_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$DELETE FROM public.payables_cheque_forms$$, 'PAYABLES_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$TRUNCATE public.payables_allocations CASCADE$$, 'PAYABLES_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$DELETE FROM public.payables_bank_match_proposals$$, 'PAYABLES_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$UPDATE public.payables_parameter_versions SET payload = '{}'::jsonb WHERE status = 'VALIDATED'$$,
  'PAYABLES_DECIDED_ROW_IMMUTABLE');

-- S38 : l'horodatage est fixé par le serveur ; aucune API n'accepte d'horodatage.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.parameters p JOIN information_schema.routines r ON r.specific_name = p.specific_name
  WHERE r.routine_schema = 'public' AND r.routine_name LIKE 'payables\_%' ESCAPE '\'
    AND p.parameter_mode = 'IN' AND p.data_type LIKE 'timestamp%'), 'no API parameter carries a timestamp');

-- Métadonnées sensibles refusées dans le journal.
SELECT pc_test.expect_error($$SELECT payables_private.append_event(NULL, 'TEST', 'TEST', 'TEST', NULL, gen_random_uuid(), NULL,
  NULL, jsonb_build_object('iban', 'X'))$$, 'PAYABLES_EVENT_SENSITIVE_METADATA_REJECTED');
SELECT pc_test.expect_error($$SELECT payables_private.append_event(NULL, 'TEST', 'TEST', 'TEST', NULL, gen_random_uuid(), NULL,
  NULL, jsonb_build_object('description_sanitized', 'X'))$$, 'PAYABLES_EVENT_SENSITIVE_METADATA_REJECTED');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_events
  WHERE metadata::text ~* '(cheque_number|beneficiary|iban|description)'), 'journal carries no cheque number, name or label');

-- S47 : un refus ne renvoie jamais une valeur sentinelle fournie par l'appelant.
CREATE FUNCTION pc_test.error_of(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pc_test.error_of(text) TO authenticated;
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert(m IS NOT NULL AND m ~ '^PAYABLES_[A-Z0-9_:]+$' AND position('SENTINELLE' IN m) = 0,
  'closed vocabulary without sentinel: ' || coalesce(m, 'NULL'))
FROM (VALUES
  (pc_test.error_of($$SELECT public.payables_create_invoice_v1(pc_test.key('s47-1'), pc_test.id('sup_alpha'), 'SENTINELLE-REF',
    123456789, 'EUR', NULL, NULL, 'SENTINELLE pièce')$$)),
  (pc_test.error_of($$SELECT public.payables_create_supplier_v1(pc_test.key('s47-2'), 'Fournisseur Alpha SARL',
    'SENTINELLE raison')$$)),
  (pc_test.error_of($$SELECT public.payables_create_cheque_request_v1(pc_test.key('s47-3'), pc_test.id('inv_a1'),
    pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'SENTINELLE bénéficiaire', 'SENTINELLE raison')$$)),
  (pc_test.error_of($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('s47-4'), pc_test.id('pay_b1a'),
    pc_test.payment_version(pc_test.id('pay_b1a')), 'SENTINELLE', 'ORA_CHQ_170X95', DATE '2026-10-26')$$))
) AS t(m);
RESET ROLE;

-- Refermeture : écritures refusées, lectures conservées.
UPDATE payables_private.runtime_control
   SET business_writes_enabled = false, change_reason = 'Close synthetic PG17 qualification window';
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('closed-again'), 'Fournisseur Zeta',
  'Après refermeture')$$, 'PAYABLES_DOMAIN_READ_ONLY');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_suppliers) > 0, 'reads remain available when closed');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() ->> 'business_writes_enabled')::boolean, 'client sees the closed switch');
RESET ROLE;

SELECT 'PASS 80_immutability_hygiene' AS marker;
