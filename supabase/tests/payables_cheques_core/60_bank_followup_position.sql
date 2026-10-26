-- Suivi bancaire multibanque et vue opérationnelle par compte (S16, S39–S41
-- adaptés ; §9 critères 6, 8–12, 15, 32, 39 ; arbitrages CTO du 25 octobre 2026).
-- Libellés strictement synthétiques : formes structurelles caractérisées,
-- numéros, bénéficiaires et montants inventés.

-- ---------------------------------------------------------------------------
-- 1. Corpus commun des grammaires (lu aussi par bankChequeGrammar.synthetic.test.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE pc_test.grammar_corpus (bank text, label text, outcome text, reference text);
-- CORPUS-BEGIN
INSERT INTO pc_test.grammar_corpus (bank, label, outcome, reference) VALUES
  ('BDK', 'CHEQUE RECU COMPENSE CHQ N 0123456 BENEFICIAIRE FICTIF', 'REFERENCE', '0123456'),
  ('BDK', 'cheque  recu compense chq n 0000001  fictif', 'REFERENCE', '0000001'),
  ('BDK', E'\tCHEQUE RECU COMPENSE\tCHQ N 0000002 FICTIF\n', 'REFERENCE', '0000002'),
  ('BDK', E'CHEQUE RECU COMPENSE CHQ N 0000003 FICTIF', 'NO_REFERENCE', NULL),
  ('BDK', E' CHEQUE RECU COMPENSE CHQ N 0000004 FICTIF', 'UNKNOWN_FORM', NULL),
  ('BDK', 'CHEQUE RECU COMPENSE (*)', 'NO_REFERENCE', NULL),
  ('BDK', 'CHEQUE RECU COMPENSE CHQ N 123456 BENEFICIAIRE FICTIF', 'NO_REFERENCE', NULL),
  ('BDK', 'RETRAIT ESPECES GUICHET 123456789 CHQ N X 0123456', 'EXCLUDED_WITHDRAWAL', NULL),
  ('BDK', 'FRAIS SUR CHEQUE CHQ N 0123456', 'EXCLUDED_FEE', NULL),
  ('BDK', 'CHEQUE DE GUICHET N 123456 FICTIF', 'UNKNOWN_FORM', NULL),
  ('BDK', 'VIREMENT EMIS FICTIF 12345678', 'NOT_CHEQUE', NULL),
  ('ORA', 'CHQ RECU COMPENSE 0012345 CHQ OCI N. 0012345', 'REFERENCE', '0012345'),
  ('ORA', 'CHQ RECU COMPENSE 0012345 CHQ OCI N. 0012346', 'AMBIGUOUS', NULL),
  ('ORA', 'CHQ RECU COMPENSE 0012345 CHQ OCI N. 0012345 SUITE', 'NO_REFERENCE', NULL),
  ('ORA', 'VIREMENT SUR COMPTE NO 12345678', 'NOT_CHEQUE', NULL),
  ('ATB', 'REGLMT CHEQUE COMPENSE CHEQUE REF 0765432', 'REFERENCE', '0765432'),
  ('ATB', 'REGLMT CHEQUE COMPENSE CHEQUE REF 765432', 'NO_REFERENCE', NULL),
  ('ATB', 'COM REGLMT CHEQUE COMPENSE CHEQUE REF 0765432', 'EXCLUDED_FEE', NULL),
  ('BICIS', 'REGLMT CHQ COMPENSE NO 0654321 FAVEUR BENEFICIAIRE 9876543', 'REFERENCE', '0654321'),
  ('BICIS', 'REGLMT CHQ COMPENSE NO 0654321', 'NO_REFERENCE', NULL),
  ('BICIS', 'FRAIS SUR CHEQUE NO 0654321 CHEQUE NO 0654321', 'EXCLUDED_FEE', NULL),
  ('BICIS', 'TVA SUR FRAIS CHQ NO 0654321', 'EXCLUDED_FEE', NULL),
  ('BIS', 'CHÈQUE PAYE 01/02/26 CHQ 0000123456', 'BANK_NOT_QUALIFIED', NULL),
  ('BRIDGE', 'PAIEMENT CHQ NO 0123456 789012345678', 'BANK_NOT_QUALIFIED', NULL),
  ('NSIA', 'CHQ 0123456', 'BANK_NOT_QUALIFIED', NULL);
-- CORPUS-END

SELECT pc_test.assert(x.outcome = c.outcome AND x.reference_text IS NOT DISTINCT FROM c.reference,
  format('grammar %s [%s] → %s/%s, expected %s/%s', c.bank, c.label, x.outcome, x.reference_text, c.outcome, c.reference))
FROM pc_test.grammar_corpus c CROSS JOIN LATERAL payables_private.extract_cheque_reference(c.bank, c.label) x;
SELECT pc_test.assert(payables_private.cheque_grammar_version('BDK') = 'PCG-BDK-V1'
  AND payables_private.cheque_grammar_version('BIS') = 'PCG-BIS-NOT-QUALIFIED', 'grammar versions are explicit');

-- ---------------------------------------------------------------------------
-- 2. Relevés Daily v2 synthétiques (lecture seule pour le domaine).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pc_test.add_unit(p_account text, p_date date, p_closing numeric, p_validation text DEFAULT 'valid',
  p_aggregates text DEFAULT 'derived')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_acc public.daily_statement_account_registry;
BEGIN
  SELECT * INTO v_acc FROM public.daily_statement_account_registry WHERE id = pc_test.id(p_account);
  INSERT INTO public.daily_statement_units_canonical (day_unit_id, bank, account_fingerprint, currency, accounting_date,
    closing_balance_derived, aggregates_status, validation_status, account_registry_id)
  VALUES (gen_random_uuid()::text, v_acc.bank, v_acc.account_fingerprint, v_acc.currency, p_date,
    CASE WHEN p_aggregates = 'derived' THEN p_closing END, p_aggregates, p_validation, v_acc.id)
  RETURNING id INTO v;
  RETURN v;
END $$;
CREATE FUNCTION pc_test.add_line(p_unit uuid, p_name text, p_label text, p_debit numeric, p_value_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_unit public.daily_statement_units_canonical;
BEGIN
  SELECT * INTO v_unit FROM public.daily_statement_units_canonical WHERE id = p_unit;
  INSERT INTO public.daily_statement_lines_canonical (canonical_unit_id, daily_line_hash, is_active, accounting_date, value_date,
    description_sanitized, debit_amount, signed_amount, direction, currency)
  VALUES (p_unit, encode(sha256(convert_to(p_name, 'UTF8')), 'hex'), true, v_unit.accounting_date,
    coalesce(p_value_date, v_unit.accounting_date), p_label, p_debit, -p_debit, 'debit', v_unit.currency)
  RETURNING id INTO v;
  RETURN pc_test.put(p_name, v);
END $$;
-- Remplacement d'une journée comme Daily v2 : ancienne unité remplacée, lignes
-- inactives, nouvelle unité et nouvelles lignes (nouveaux identifiants).
CREATE FUNCTION pc_test.supersede(p_unit uuid, p_suffix text, p_override_line text DEFAULT NULL, p_override_amount numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_old public.daily_statement_units_canonical; v_new uuid; v_line record; v_name text;
BEGIN
  SELECT * INTO v_old FROM public.daily_statement_units_canonical WHERE id = p_unit;
  UPDATE public.daily_statement_units_canonical SET status = 'superseded' WHERE id = p_unit;
  UPDATE public.daily_statement_lines_canonical SET is_active = false WHERE canonical_unit_id = p_unit;
  INSERT INTO public.daily_statement_units_canonical (day_unit_id, bank, account_fingerprint, currency, accounting_date,
    closing_balance_derived, aggregates_status, validation_status, account_registry_id)
  VALUES (v_old.day_unit_id || '-r', v_old.bank, v_old.account_fingerprint, v_old.currency, v_old.accounting_date,
    v_old.closing_balance_derived, v_old.aggregates_status, v_old.validation_status, v_old.account_registry_id)
  RETURNING id INTO v_new;
  FOR v_line IN SELECT l.*, i.name FROM public.daily_statement_lines_canonical l
                LEFT JOIN pc_test.ids i ON i.id = l.id WHERE l.canonical_unit_id = p_unit LOOP
    v_name := coalesce(v_line.name, v_line.id::text) || p_suffix;
    PERFORM pc_test.add_line(v_new, v_name, v_line.description_sanitized,
      CASE WHEN v_line.name = p_override_line THEN p_override_amount ELSE v_line.debit_amount END, v_line.value_date);
  END LOOP;
  RETURN v_new;
END $$;
CREATE FUNCTION pc_test.proposal_for_line(p_line text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id FROM public.payables_bank_match_proposals m WHERE m.line_id = pc_test.id(p_line) ORDER BY m.proposed_at DESC LIMIT 1
$$;
CREATE FUNCTION pc_test.proposal_version(p_proposal uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.row_version FROM public.payables_bank_match_proposals m WHERE m.id = p_proposal
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- BDK : reprise attestée au 30/09 (0100001 50 000, 0100002 40 000, 0100003 30 000).
SELECT pc_test.put('u_bdk_1001', pc_test.add_unit('acct_bdk', DATE '2026-10-01', 5100000));
SELECT pc_test.add_line(pc_test.id('u_bdk_1001'), 'l_bdk_chq1', 'CHEQUE RECU COMPENSE CHQ N 0100001 BENEFICIAIRE FICTIF UN', 50000);
SELECT pc_test.add_line(pc_test.id('u_bdk_1001'), 'l_bdk_fee', 'FRAIS TENUE DE COMPTE', 5000);
SELECT pc_test.put('u_bdk_1002', pc_test.add_unit('acct_bdk', DATE '2026-10-02', 5060000));
SELECT pc_test.add_line(pc_test.id('u_bdk_1002'), 'l_bdk_withdrawal', 'RETRAIT ESPECES GUICHET CHQ N X 0100002', 40000);
SELECT pc_test.add_line(pc_test.id('u_bdk_1002'), 'l_bdk_transfer', 'VIREMENT EMIS FICTIF', 1000);
SELECT pc_test.put('u_bdk_1005', pc_test.add_unit('acct_bdk', DATE '2026-10-05', 5000000));
SELECT pc_test.add_line(pc_test.id('u_bdk_1005'), 'l_bdk_chq3_bad', 'CHEQUE RECU COMPENSE CHQ N 0100003 BENEFICIAIRE FICTIF', 30001);

-- ATB : reprise non attestée ; deux débits portant la même référence.
SELECT pc_test.as_user('acc3');
SELECT pc_test.put('tk_atb', (public.payables_prepare_takeover_v1(pc_test.key('tk-atb'), pc_test.id('acct_atb'),
  DATE '2026-09-30', 'Registre manuel synthétique', 2, 15000, jsonb_build_array(
    jsonb_build_object('cheque_number', '0300001', 'beneficiary', 'Bénéficiaire A1', 'amount', 7000, 'issue_date', '2026-09-20'),
    jsonb_build_object('cheque_number', '300002', 'beneficiary', 'Bénéficiaire A2', 'amount', 8000, 'issue_date', '2026-09-21')),
  'Reprise ATB') ->> 'batch_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT public.payables_decide_takeover_v1(pc_test.key('tk-atb-ok'), pc_test.id('tk_atb'), pc_test.batch_version(pc_test.id('tk_atb')),
  true, false, 'Intégration sans attestation');
RESET ROLE;
SELECT pc_test.put('u_atb_1003', pc_test.add_unit('acct_atb', DATE '2026-10-03', 900000));
SELECT pc_test.add_line(pc_test.id('u_atb_1003'), 'l_atb_dup1', 'REGLMT CHEQUE COMPENSE CHEQUE REF 0300001', 7000);
SELECT pc_test.add_line(pc_test.id('u_atb_1003'), 'l_atb_dup2', 'REGLMT CHEQUE COMPENSE CHEQUE REF 0300001', 7000);
SELECT pc_test.add_line(pc_test.id('u_atb_1003'), 'l_atb_zero', 'REGLMT CHEQUE COMPENSE CHEQUE REF 0300002', 8000);

-- ORA : chèque natif émis (0001234, 1 000 000) et chèque annulé (0003009, 18 000).
SELECT pc_test.put('u_ora_1026', pc_test.add_unit('acct_ora', DATE '2026-10-26', 9000000));
SELECT pc_test.add_line(pc_test.id('u_ora_1026'), 'l_ora_a1', 'CHQ RECU COMPENSE 0001234 CHQ OCI N. 0001234', 1000000, DATE '2026-10-27');
SELECT pc_test.add_line(pc_test.id('u_ora_1026'), 'l_ora_cancelled', 'CHQ RECU COMPENSE 0003009 CHQ OCI N. 0003009', 18000);
SELECT pc_test.add_line(pc_test.id('u_ora_1026'), 'l_ora_ambiguous', 'CHQ RECU COMPENSE 0003006 CHQ OCI N. 0003007', 15000);

-- BICIS : dernière journée en revue, une journée valide antérieure.
SELECT pc_test.add_unit('acct_bicis', DATE '2026-10-01', 700000);
SELECT pc_test.add_unit('acct_bicis', DATE '2026-10-02', 650000, 'needs_review');

-- ---------------------------------------------------------------------------
-- 3. Propositions : uniquement des correspondances exactes et non ambiguës.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_propose_bank_matches_v1(pc_test.key('prop-nocap'), pc_test.id('acct_bdk'),
  DATE '2026-10-05')$$, 'PAYABLES_CAPABILITY_REQUIRED:BANK_FOLLOWUP');
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-bdk-1'), pc_test.id('acct_bdk'), DATE '2026-10-05')
  ->> 'proposed')::int = 1, 'one exact proposal on BDK (fee, withdrawal and wrong amount excluded)');
SELECT pc_test.assert((SELECT outcome FROM public.payables_bank_line_references WHERE line_id = pc_test.id('l_bdk_withdrawal'))
  = 'EXCLUDED_WITHDRAWAL' AND NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals
  WHERE line_id = pc_test.id('l_bdk_withdrawal')), 'withdrawal never proposed even with matching number and amount');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals WHERE line_id = pc_test.id('l_bdk_chq3_bad')),
  'amount mismatch produces no proposal');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_bank_line_references
  WHERE account_registry_id = pc_test.id('acct_bdk')) = 5, 'references stored once per line and grammar version');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-bdk-2'), pc_test.id('acct_bdk'), DATE '2026-10-05')
  ->> 'proposed')::int = 0, 'proposals are not duplicated');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-atb'), pc_test.id('acct_atb'), DATE '2026-10-03')
  ->> 'proposed')::int = 0, 'duplicate references are ambiguous; leading zeros never stripped');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-ora'), pc_test.id('acct_ora'), DATE '2026-10-26')
  ->> 'alerts')::int = 1, 'cancelled cheque presented raises an alert');
SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_exceptions WHERE kind = 'CANCELLED_CHEQUE_PRESENTED'
  AND form_id = pc_test.id('form_pay_relax') AND blocks_account), 'cancelled cheque debit is a blocking exception');
SELECT pc_test.assert((SELECT outcome FROM public.payables_bank_line_references WHERE line_id = pc_test.id('l_ora_ambiguous'))
  = 'AMBIGUOUS', 'competing numbers are ambiguous');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_bank_followup_lines_v1(pc_test.id('acct_ora'), DATE '2026-10-01',
  DATE '2026-10-26') f WHERE f.outcome IS NULL), 'follow-up view exposes outcomes');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM information_schema.routines r
  JOIN information_schema.parameters p ON p.specific_name = r.specific_name
  WHERE r.routine_name = 'payables_bank_followup_lines_v1' AND p.parameter_name ILIKE '%description%'),
  'follow-up view never returns bank labels');

-- Confirmation par un comptable habilité, recontrôle serveur.
SELECT pc_test.put('prop_bdk_chq1', pc_test.proposal_for_line('l_bdk_chq1'));
SELECT pc_test.put('prop_ora_a1', pc_test.proposal_for_line('l_ora_a1'));
SELECT pc_test.assert((public.payables_decide_bank_match_v1(pc_test.key('confirm-bdk-1'), pc_test.id('prop_bdk_chq1'),
  pc_test.proposal_version(pc_test.id('prop_bdk_chq1')), 'CONFIRM', NULL) ->> 'outcome') = 'CONFIRMED', 'BDK match confirmed');
SELECT pc_test.assert((public.payables_decide_bank_match_v1(pc_test.key('confirm-ora-a1'), pc_test.id('prop_ora_a1'),
  pc_test.proposal_version(pc_test.id('prop_ora_a1')), 'CONFIRM', NULL) ->> 'outcome') = 'CONFIRMED', 'ORA match confirmed');
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_a1')) = 'CLEARED',
  'confirmed cheque leaves circulation');
SELECT pc_test.assert((SELECT accounting_date = DATE '2026-10-26' AND value_date = DATE '2026-10-27' FROM public.payables_exits
  WHERE form_id = pc_test.id('form_a1') AND kind = 'BANK_MATCH'), 'exit dated on both bank axes');
-- S16 / §9-39 : un débit rapproché ne recrée jamais de restant à engager.
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_a1')) = 0
  AND (SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_a1')) = 'ENGAGED',
  'bank match keeps the payment consumed');
-- Aucune double consommation d'une ligne ni d'un chèque.
RESET ROLE;
SELECT pc_test.add_line(pc_test.id('u_ora_1026'), 'l_ora_a1_twice', 'CHQ RECU COMPENSE 0001234 CHQ OCI N. 0001234', 1000000);
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-ora-2'), pc_test.id('acct_ora'), DATE '2026-10-26')
  ->> 'proposed')::int = 0, 'a cleared cheque is never proposed again');
-- Revue P2-5 : débit d'une formule imprimée mais jamais confirmée émise →
-- exception bloquante (facture et compte), jamais un simple écart ignoré.
RESET ROLE;
SELECT pc_test.add_line(pc_test.id('u_ora_1026'), 'l_ora_unissued', 'CHQ RECU COMPENSE 0003003 CHQ OCI N. 0003003', 12000);
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-ora-3'), pc_test.id('acct_ora'), DATE '2026-10-26')
  ->> 'alerts')::int = 1, 'debit of an unissued form raises an alert');
SELECT pc_test.assert((SELECT blocks_invoice AND blocks_account AND details->>'form_state' = 'PRINTED'
  FROM public.payables_exceptions WHERE kind = 'UNISSUED_FORM_PRESENTED' AND form_id = pc_test.id('form_pay_absent')),
  'unissued form debit blocks invoice and account');
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_pay_absent')), 'invoice of the presented form is blocked');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals WHERE line_id = pc_test.id('l_ora_unissued')),
  'no proposal for an unissued form');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-ora-4'), pc_test.id('acct_ora'), DATE '2026-10-26')
  ->> 'alerts')::int = 0, 'alert is not duplicated');

-- Remplacement de relevé avant confirmation : proposition invalidée.
SELECT public.payables_propose_bank_matches_v1(pc_test.key('prop-bdk-3'), pc_test.id('acct_bdk'), DATE '2026-10-05');
RESET ROLE;
SELECT pc_test.put('u_bdk_1005_r', pc_test.supersede(pc_test.id('u_bdk_1005'), '_r1', 'l_bdk_chq3_bad', 30000));
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_propose_bank_matches_v1(pc_test.key('prop-bdk-4'), pc_test.id('acct_bdk'), DATE '2026-10-05')
  ->> 'proposed')::int = 1, 'corrected replacement line is proposed');
SELECT pc_test.put('prop_bdk_chq3', pc_test.proposal_for_line('l_bdk_chq3_bad_r1'));

-- Changement de grammaire entre proposition et confirmation : invalidation.
RESET ROLE;
ALTER FUNCTION payables_private.cheque_grammar_version(text) RENAME TO cheque_grammar_version_v1;
CREATE FUNCTION payables_private.cheque_grammar_version(p_bank text) RETURNS text LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN p_bank IN ('BDK','ORA','ATB','BICIS') THEN 'PCG-' || p_bank || '-V2' ELSE 'PCG-' || p_bank || '-NOT-QUALIFIED' END $$;
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_decide_bank_match_v1(pc_test.key('confirm-bdk-3-v2'), pc_test.id('prop_bdk_chq3'),
  pc_test.proposal_version(pc_test.id('prop_bdk_chq3')), 'CONFIRM', NULL) ->> 'outcome') = 'INVALIDATED',
  'grammar change invalidates a pending proposal');
SELECT pc_test.assert((SELECT status FROM public.payables_bank_match_proposals WHERE id = pc_test.id('prop_bdk_chq1')) = 'CONFIRMED'
  AND (SELECT grammar_version FROM public.payables_bank_match_proposals WHERE id = pc_test.id('prop_bdk_chq1')) = 'PCG-BDK-V1',
  'confirmed match keeps its grammar version');
SELECT public.payables_refresh_bank_references_v1(pc_test.key('refresh-v2'), pc_test.id('acct_bdk'), DATE '2026-10-01', DATE '2026-10-05');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_bank_line_references WHERE line_id = pc_test.id('l_bdk_chq1')) = 2,
  'new grammar adds references, old ones kept');
RESET ROLE;
DROP FUNCTION payables_private.cheque_grammar_version(text);
ALTER FUNCTION payables_private.cheque_grammar_version_v1(text) RENAME TO cheque_grammar_version;
SELECT pc_test.as_user('acc4');
SELECT public.payables_propose_bank_matches_v1(pc_test.key('prop-bdk-5'), pc_test.id('acct_bdk'), DATE '2026-10-05');
SELECT pc_test.assert((public.payables_decide_bank_match_v1(pc_test.key('confirm-bdk-3'), pc_test.proposal_for_line('l_bdk_chq3_bad_r1'),
  pc_test.proposal_version(pc_test.proposal_for_line('l_bdk_chq3_bad_r1')), 'CONFIRM', NULL) ->> 'outcome') = 'CONFIRMED',
  'proposal under the current grammar confirmed');

-- Remplacement de relevé après confirmation : jamais réinterprété en silence.
RESET ROLE;
SELECT pc_test.put('u_bdk_1001_r', pc_test.supersede(pc_test.id('u_bdk_1001'), '_r1'));
SELECT pc_test.as_user('acc4');
SELECT pc_test.assert((public.payables_scan_match_evidence_v1(pc_test.key('scan-1')) ->> 'opened')::int = 1,
  'inactive evidence of a confirmed match is flagged');
SELECT pc_test.assert((SELECT status FROM public.payables_bank_match_proposals WHERE id = pc_test.id('prop_bdk_chq1')) = 'CONFIRMED',
  'flagging does not rewrite the confirmed match');
SELECT pc_test.expect_error($$SELECT public.payables_rebind_bank_match_v1(pc_test.key('rebind-bad'), pc_test.id('prop_bdk_chq1'),
  pc_test.id('l_bdk_fee_r1'), 'Mauvaise ligne')$$, 'PAYABLES_REBIND_EVIDENCE_INVALID');
SELECT public.payables_rebind_bank_match_v1(pc_test.key('rebind-ok'), pc_test.id('prop_bdk_chq1'), pc_test.id('l_bdk_chq1_r1'),
  'Rattachement à la ligne remplaçante');
SELECT pc_test.assert((SELECT status FROM public.payables_bank_match_proposals WHERE id = pc_test.id('prop_bdk_chq1')) = 'SUPERSEDED'
  AND EXISTS (SELECT 1 FROM public.payables_bank_match_proposals WHERE supersedes_id = pc_test.id('prop_bdk_chq1')
  AND status = 'CONFIRMED'), 'rebind keeps history');
SELECT pc_test.as_user('acc2');
SELECT public.payables_resolve_exception_v1(pc_test.key('evidence-res'),
  (SELECT id FROM public.payables_exceptions WHERE kind = 'MATCH_EVIDENCE_INACTIVE' AND status = 'OPEN'), 1, 'REBOUND_VERIFIED',
  NULL, 'Relevé remplacé contrôlé', 'Rattachement vérifié');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. Vue opérationnelle : solde daté, circulation, engagements, motifs.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT public.payables_declare_transfer_v1(pc_test.key('trf-bdk-committed'), pc_test.id('inv_pay_bdk'), pc_test.id('acct_bdk'),
  'ALL_PAYMENTS', 1000, 'VIR-SYN-9', 'COMMITTED', NULL, 'Ordre signé', 'Virement engagé non exécuté');
SELECT pc_test.as_user('acc4');
CREATE TEMP TABLE pos AS SELECT * FROM public.payables_account_positions_v1(DATE '2026-10-26');
SELECT pc_test.assert((SELECT last_statement_date = DATE '2026-10-05' AND bank_balance = 5000000 AND balance_status = 'AVAILABLE'
  AND register_status = 'COMPLETE' AND circulation_count = 1 AND circulation_amount = 40000
  AND circulation_at_statement_amount = 40000 AND pending_bank_items = 0 AND open_blocking_exceptions = 0
  AND indicative_position = 4960000 AND cardinality(indicative_reasons) = 0 AND transfers_pending_count = 1
  AND transfers_pending_amount = 1000
  FROM pos WHERE account_id = pc_test.id('acct_bdk')), 'BDK indicative position after cheques, transfers kept apart');
SELECT pc_test.assert((SELECT indicative_position IS NULL AND 'REGISTER_INCOMPLETE' = ANY (indicative_reasons)
  AND 'BANK_FOLLOWUP_PENDING' = ANY (indicative_reasons) AND pending_bank_items = 3
  FROM pos WHERE account_id = pc_test.id('acct_atb')), 'ATB unavailable: register incomplete and follow-up pending');
SELECT pc_test.assert((SELECT bank_balance IS NULL AND balance_status = 'UNIT_NEEDS_REVIEW' AND last_statement_date = DATE '2026-10-02'
  FROM pos WHERE account_id = pc_test.id('acct_bicis')), 'no fallback to an older valid balance');
SELECT pc_test.assert((SELECT circulation_amount IS NULL AND circulation_unknown_count = 1
  AND 'BLOCKING_EXCEPTION_OPEN' = ANY (indicative_reasons) AND indicative_position IS NULL
  FROM pos WHERE account_id = pc_test.id('acct_ora')), 'unknown amount is never zero; blocking exception reported');
SELECT pc_test.assert((SELECT 'BANK_NOT_QUALIFIED' = ANY (indicative_reasons) AND balance_status = 'NO_STATEMENT'
  FROM pos WHERE account_id = pc_test.id('acct_bis')), 'BIS not qualified, no statement');
SELECT pc_test.assert((SELECT 'CURRENCY_NOT_SUPPORTED' = ANY (indicative_reasons)
  FROM pos WHERE account_id = pc_test.id('acct_eur')), 'non-XOF account never mixed');
-- Position à une date antérieure : seuls les relevés connus à cette date.
SELECT pc_test.assert((SELECT last_statement_date = DATE '2026-10-02' AND circulation_at_statement_amount = 70000
  FROM public.payables_account_positions_v1(DATE '2026-10-02') WHERE account_id = pc_test.id('acct_bdk')),
  'as-of date limits statements and circulation');
SELECT pc_test.expect_error($$SELECT * FROM public.payables_account_positions_v1(DATE '2099-01-01')$$, 'PAYABLES_FUTURE_DATE_FORBIDDEN');
-- File de travail partagée : éléments, ancienneté, verrous visibles.
SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_work_queue_v1() WHERE item_type = 'EXCEPTION_OPEN')
  AND EXISTS (SELECT 1 FROM public.payables_work_queue_v1() WHERE item_type = 'AWAITING_SIGNATURE_OR_CONFIRMATION'),
  'work queue lists pending work');
RESET ROLE;
SELECT pc_test.as_user('outsider');
SELECT pc_test.expect_error($$SELECT * FROM public.payables_account_positions_v1(NULL)$$, 'PAYABLES_CAPABILITY_REQUIRED:READ');
SELECT pc_test.expect_error($$SELECT * FROM public.payables_work_queue_v1()$$, 'PAYABLES_CAPABILITY_REQUIRED:READ');
RESET ROLE;

SELECT 'PASS 60_bank_followup_position' AS marker;
