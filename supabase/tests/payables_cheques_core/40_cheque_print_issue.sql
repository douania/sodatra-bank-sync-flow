-- Formules, contenu signable, impression, signatures, émission et remise
-- (S8, S12–S14, S23–S32, S48–S52 ; §9 critères 2, 17, 19–21, 31, 33, 34, 47–65).

CREATE FUNCTION pc_test.form_of(p_payment text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id FROM public.payables_cheque_forms f WHERE f.payment_id = pc_test.id(p_payment)
  ORDER BY f.created_at DESC, f.id LIMIT 1
$$;
CREATE FUNCTION pc_test.form_version(p_form uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.row_version FROM public.payables_cheque_forms f WHERE f.id = p_form
$$;
CREATE FUNCTION pc_test.content_of(p_form uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id FROM public.payables_cheque_contents c WHERE c.form_id = p_form ORDER BY c.version_no DESC LIMIT 1
$$;
CREATE FUNCTION pc_test.payment_version(p_payment uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.row_version FROM public.payables_payments p WHERE p.id = p_payment
$$;
-- Prépare une formule imprimée (intention + résultat PRINTED) pour un paiement.
CREATE FUNCTION pc_test.print_cheque(p_actor text, p_payment text, p_number text, p_date date)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_form uuid; v_event uuid;
BEGIN
  PERFORM pc_test.as_user(p_actor);
  v_form := (public.payables_assign_cheque_form_v1(pc_test.key('assign:' || p_payment), pc_test.id(p_payment),
    pc_test.payment_version(pc_test.id(p_payment)), p_number, 'ORA_CHQ_170X95', p_date) ->> 'form_id')::uuid;
  v_event := (public.payables_record_print_intent_v1(pc_test.key('intent:' || p_payment), v_form, pc_test.form_version(v_form),
    pc_test.content_of(v_form), 'Impression synthétique') ->> 'print_event_id')::uuid;
  PERFORM public.payables_record_print_outcome_v1(pc_test.key('outcome:' || p_payment), v_event, 'PRINTED', NULL);
  RETURN pc_test.put('form_' || p_payment, v_form);
END $$;
CREATE FUNCTION pc_test.new_payment(p_actor text, p_label text, p_supplier text, p_amount numeric, p_account text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_invoice uuid;
BEGIN
  PERFORM pc_test.as_user('acc1');
  v_invoice := (public.payables_create_invoice_v1(pc_test.key('inv:' || p_label), pc_test.id(p_supplier), 'REF-' || p_label,
    p_amount, 'XOF', NULL, NULL, 'Original ' || p_label) ->> 'invoice_id')::uuid;
  PERFORM pc_test.put('inv_' || p_label, v_invoice);
  PERFORM pc_test.as_user(p_actor);
  RETURN pc_test.put(p_label, (public.payables_create_cheque_request_v1(pc_test.key('req:' || p_label), v_invoice,
    pc_test.id(p_account), 'ALL_PAYMENTS', NULL, false, 'Bénéficiaire synthétique ' || p_label, 'Paiement ' || p_label)
    ->> 'payment_id')::uuid);
END $$;
-- Simulation du temps (fixture de test uniquement, superutilisateur, triggers
-- de garde suspendus le temps d'une instruction) : les scénarios datés dans le
-- passé supposent que les impressions synthétiques ont eu lieu au plus tard à
-- la date donnée (par défaut en début de période). Aucun équivalent n'existe
-- côté production.
CREATE FUNCTION pc_test.backdate_prints(p_on date DEFAULT DATE '2026-01-02', p_form uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_role text := current_setting('role'); v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.payables_print_events e
     SET requested_at = p_on::timestamp AT TIME ZONE 'Africa/Dakar'
   WHERE (p_form IS NULL OR e.form_id = p_form) AND (e.requested_at AT TIME ZONE 'Africa/Dakar')::date > p_on;
  PERFORM set_config('session_replication_role', 'origin', true);
  IF v_role <> 'none' THEN PERFORM set_config('role', v_role, false); END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), false);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- Paramètres complémentaires : signataires dédiés et changements de règle datés.
SELECT pc_test.make_person('p_sig3', 'Signataire révoqué synthétique');
SELECT pc_test.make_person('p_sig4', 'Signataire conjoint synthétique');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_acc1')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_acc1'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce acc1', 'sig_acc1_ora');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_sig3')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_sig3'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce sig3', 'sig_sig3_v1');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_sig3')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-06-01',
  jsonb_build_object('person_id', pc_test.id('p_sig3'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'REVOKED',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Révocation sig3', 'sig_sig3_v2');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_sig4')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_sig4'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce sig4', 'sig_sig4');
SELECT pc_test.set_param('SIGNATURE_RULE', pc_test.id('acct_ora')::text, DATE '2026-10-20',
  jsonb_build_object('account_registry_id', pc_test.id('acct_ora'), 'required_signatures', 2), NULL, 'rule_ora_v2');
SELECT pc_test.set_param('SIGNATURE_RULE', pc_test.id('acct_ora')::text, DATE '2026-10-25',
  jsonb_build_object('account_registry_id', pc_test.id('acct_ora'), 'required_signatures', 1), NULL, 'rule_ora_v3');
SELECT pc_test.grant_cap('gov_a', 'gov_b', 'acc4', 'CHEQUE_PREPARE_PRINT');

-- ---------------------------------------------------------------------------
-- Formule et contenu signable produits par le serveur (§9-21, 47).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('form_a1', (public.payables_assign_cheque_form_v1(pc_test.key('assign-a1'), pc_test.id('pay_a1'),
  pc_test.payment_version(pc_test.id('pay_a1')), '0001234', 'ORA_CHQ_170X95', DATE '2026-10-24') ->> 'form_id')::uuid);
SELECT pc_test.assert((SELECT cheque_number FROM public.payables_cheque_forms WHERE id = pc_test.id('form_a1')) = '0001234',
  'pre-printed number kept as text with leading zeros');
SELECT pc_test.assert((SELECT fields ->> 'amount_words' FROM public.payables_cheque_contents
  WHERE id = pc_test.content_of(pc_test.id('form_a1'))) = 'UN MILLION FRANCS CFA', 'amount in words produced by the server');
SELECT pc_test.assert((SELECT fields ->> 'amount_figures' FROM public.payables_cheque_contents
  WHERE id = pc_test.content_of(pc_test.id('form_a1'))) = '1 000 000', 'grouped figures');
SELECT pc_test.assert((SELECT fields ->> 'place' = 'Dakar' AND fields ->> 'issue_date_text' = '24/10/2026'
  FROM public.payables_cheque_contents WHERE id = pc_test.content_of(pc_test.id('form_a1'))), 'place and printed date');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-a1-bis'), pc_test.id('pay_a1'),
  pc_test.payment_version(pc_test.id('pay_a1')), '0001235', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_FORM_ALREADY_ACTIVE');
-- Un numéro est unique par compte ; aucun numéro inventé ni réutilisé.
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-dup'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), '0001234', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_FORM_ALREADY_USED');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-nan'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), '12A4', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_CHEQUE_NUMBER_INVALID');
-- Aucun repli sur le profil ORABANK pour une autre banque.
SELECT pc_test.new_payment('acc1', 'pay_bdk', 'sup_delta', 75000, 'acct_bdk');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-bdk'), pc_test.id('pay_bdk'),
  pc_test.payment_version(pc_test.id('pay_bdk')), '0000001', 'ORA_CHQ_170X95', DATE '2026-10-24')$$,
  'PAYABLES_PRINT_PROFILE_NOT_VALIDATED');
-- Dépassement de mise en page refusé avant toute impression.
SELECT pc_test.new_payment('acc1', 'pay_big', 'sup_delta', 777777777, 'acct_ora');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-big'), pc_test.id('pay_big'),
  pc_test.payment_version(pc_test.id('pay_big')), '0002000', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_PRINT_LAYOUT_OVERFLOW');
-- Bénéficiaire plus long que la zone imprimable : accepté sur le paiement,
-- refusé à l'assignation de la formule (aucune troncature silencieuse).
SELECT public.payables_adjust_payment_v1(pc_test.key('adj-long'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), 200000, repeat('B', 60), 'Nom long');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-long'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), '0001299', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_PRINT_LAYOUT_OVERFLOW');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_cheque_forms WHERE cheque_number = '0001299'),
  'refused assignment leaves no form behind');
SELECT public.payables_adjust_payment_v1(pc_test.key('adj-short'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), 200000, 'Fournisseur Béta', 'Nom raccourci');
SELECT pc_test.expect_error($$SELECT public.payables_adjust_payment_v1(pc_test.key('adj-too-long'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), 200000, repeat('B', 121), 'Nom trop long')$$, 'PAYABLES_BENEFICIARY_INVALID');

-- ---------------------------------------------------------------------------
-- Impression : intention avant impression, résultat confirmé par le comptable.
-- ---------------------------------------------------------------------------
-- Contenu révisé avant impression : l'ancienne version est périmée.
SELECT public.payables_revise_cheque_content_v1(pc_test.key('revise-a1'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-25', 'Date d''émission prévue décalée');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_cheque_contents WHERE form_id = pc_test.id('form_a1')) = 2,
  'revision creates a new immutable content version');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_intent_v1(pc_test.key('intent-stale'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')),
  (SELECT id FROM public.payables_cheque_contents WHERE form_id = pc_test.id('form_a1') AND version_no = 1), 'Impression')$$,
  'PAYABLES_CONTENT_VERSION_STALE');
SELECT pc_test.put('pe_a1_1', (public.payables_record_print_intent_v1(pc_test.key('intent-a1'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), pc_test.content_of(pc_test.id('form_a1')), 'Première impression')
  ->> 'print_event_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_record_print_intent_v1(pc_test.key('intent-a1-dup'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), pc_test.content_of(pc_test.id('form_a1')), 'Double intention')$$,
  'PAYABLES_FORM_STATE_INVALID');
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-a1-1'), pc_test.id('pe_a1_1'), 'NOT_PRINTED',
  'Bourrage avant contact papier');
SELECT pc_test.assert((public.payables_record_print_intent_v1(pc_test.key('intent-a1-2'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), pc_test.content_of(pc_test.id('form_a1')), 'Nouvel essai') ->> 'kind') = 'REPRINT',
  'retry is traced as a reprint');
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-a1-2'),
  (SELECT id FROM public.payables_print_events WHERE form_id = pc_test.id('form_a1') AND status = 'PENDING'), 'PRINTED', NULL);
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_a1')) = 'PRINTED', 'printed');
-- §9-19 : imprimé n'est pas émis ; aucune entrée en circulation.
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_a1')) = 'RESERVED',
  'printing never engages');
SELECT pc_test.expect_error($$SELECT public.payables_revise_cheque_content_v1(pc_test.key('revise-printed'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-26', 'Après impression')$$, 'PAYABLES_FORM_STATE_INVALID');
SELECT pc_test.expect_error($$UPDATE public.payables_print_events SET status = 'SPOILED' WHERE form_id = pc_test.id('form_a1')$$,
  'permission denied');
RESET ROLE;

SELECT 'PASS 40_cheque_print_issue' AS marker;
