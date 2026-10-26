-- Formules gâchées ou incertaines, signatures, émission (deux voies) et remise
-- (S8, S13, S14, S23–S32, S48, S49, S52 ; §9 critères 17, 19, 20, 31, 36, 37, 47–64).

-- Formule gâchée : enregistrée inutilisée, numéro jamais réaffecté (§9-20).
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('form_b1a_spoiled', (public.payables_assign_cheque_form_v1(pc_test.key('assign-b1a'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), '0001300', 'ORA_CHQ_170X95', DATE '2026-10-24') ->> 'form_id')::uuid);
SELECT pc_test.put('pe_b1a', (public.payables_record_print_intent_v1(pc_test.key('intent-b1a'), pc_test.id('form_b1a_spoiled'),
  pc_test.form_version(pc_test.id('form_b1a_spoiled')), pc_test.content_of(pc_test.id('form_b1a_spoiled')), 'Impression')
  ->> 'print_event_id')::uuid);
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-b1a'), pc_test.id('pe_b1a'), 'SPOILED', 'Formule froissée');
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_b1a_spoiled')) = 'UNUSED',
  'spoiled form recorded unused');
SELECT pc_test.expect_error($$SELECT public.payables_assign_cheque_form_v1(pc_test.key('assign-b1a-reuse'), pc_test.id('pay_b1a'),
  pc_test.payment_version(pc_test.id('pay_b1a')), '0001300', 'ORA_CHQ_170X95', DATE '2026-10-24')$$, 'PAYABLES_FORM_ALREADY_USED');
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_b1a')) = 'RESERVED',
  'allocation stays attached to the payment, not to the paper form');

-- S14 / §9-36, 37 : résultat incertain, aucune libération automatique.
SELECT pc_test.put('form_b1c', (public.payables_assign_cheque_form_v1(pc_test.key('assign-b1c'), pc_test.id('pay_b1c'),
  pc_test.payment_version(pc_test.id('pay_b1c')), '0001400', 'ORA_CHQ_170X95', DATE '2026-10-24') ->> 'form_id')::uuid);
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-b1c'),
  (public.payables_record_print_intent_v1(pc_test.key('intent-b1c'), pc_test.id('form_b1c'), pc_test.form_version(pc_test.id('form_b1c')),
   pc_test.content_of(pc_test.id('form_b1c')), 'Impression') ->> 'print_event_id')::uuid, 'UNCERTAIN', 'Imprimante muette');
SELECT pc_test.expect_error($$SELECT public.payables_abandon_payment_v1(pc_test.key('abandon-b1c'), pc_test.id('pay_b1c'),
  pc_test.payment_version(pc_test.id('pay_b1c')), 'Abandon')$$, 'PAYABLES_RELEASE_FORBIDDEN_FORM_UNCERTAIN');
SELECT pc_test.as_user('acc2');
SELECT public.payables_resolve_exception_v1(pc_test.key('uncertain-res'),
  (SELECT id FROM public.payables_exceptions WHERE form_id = pc_test.id('form_b1c') AND kind = 'FORM_PRINT_UNCERTAIN'), 1,
  'FOUND_UNUSED', NULL, 'Formule retrouvée vierge', 'Formule retrouvée non imprimée');
SELECT pc_test.as_user('acc1');
SELECT public.payables_abandon_payment_v1(pc_test.key('abandon-b1c-ok'), pc_test.id('pay_b1c'),
  pc_test.payment_version(pc_test.id('pay_b1c')), 'Abandon après instruction');
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_b1c')) = 'CANCELLED',
  'release only after instructed decision');
-- Revue P1-2 : une formule déclarée perdue interdit toute libération (encaissement possible).
SELECT pc_test.new_payment('acc1', 'pay_lost', 'sup_delta', 23000, 'acct_ora');
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('form_pay_lost', (public.payables_assign_cheque_form_v1(pc_test.key('assign-lost'), pc_test.id('pay_lost'),
  pc_test.payment_version(pc_test.id('pay_lost')), '0001500', 'ORA_CHQ_170X95', DATE '2026-10-24') ->> 'form_id')::uuid);
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-lost'),
  (public.payables_record_print_intent_v1(pc_test.key('intent-lost'), pc_test.id('form_pay_lost'),
   pc_test.form_version(pc_test.id('form_pay_lost')), pc_test.content_of(pc_test.id('form_pay_lost')), 'Impression')
   ->> 'print_event_id')::uuid, 'UNCERTAIN', 'Bourrage papier');
SELECT pc_test.as_user('acc2');
SELECT public.payables_resolve_exception_v1(pc_test.key('lost-res'),
  (SELECT id FROM public.payables_exceptions WHERE form_id = pc_test.id('form_pay_lost') AND kind = 'FORM_PRINT_UNCERTAIN'), 1,
  'FORM_LOST', NULL, 'Déclaration de perte', 'Formule introuvable après bourrage');
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_abandon_payment_v1(pc_test.key('abandon-lost'), pc_test.id('pay_lost'),
  pc_test.payment_version(pc_test.id('pay_lost')), 'Abandon après perte')$$, 'PAYABLES_RELEASE_FORBIDDEN_FORM_UNCERTAIN');
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_lost')) = 'RESERVED',
  'a lost form keeps the reservation');

-- ---------------------------------------------------------------------------
-- Signatures et confirmation de l'émission (voie normale).
-- ---------------------------------------------------------------------------
SELECT pc_test.backdate_prints();
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sig-nocap'), pc_test.id('form_a1'),
  pc_test.content_of(pc_test.id('form_a1')), pc_test.id('p_dir'), DATE '2026-10-24', NULL)$$,
  'PAYABLES_CAPABILITY_REQUIRED:CHEQUE_CONFIRM_ISSUE');
SELECT pc_test.as_user('acc2');
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-nosig'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-25', false)$$, 'PAYABLES_SIGNATURE_RULE_NOT_MET');
SELECT public.payables_record_signature_v1(pc_test.key('sig-a1-dir'), pc_test.id('form_a1'), pc_test.content_of(pc_test.id('form_a1')),
  pc_test.id('p_dir'), DATE '2026-10-24', 'Signé au bureau');
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sig-a1-dir-2'), pc_test.id('form_a1'),
  pc_test.content_of(pc_test.id('form_a1')), pc_test.id('p_dir'), DATE '2026-10-24', NULL)$$, 'PAYABLES_SIGNATURE_ALREADY_RECORDED');
-- S32 : formule pré-signée hors protocole.
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-presigned'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-25', true)$$, 'PAYABLES_PRESIGNED_FORM_USE_DISABLED');
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-before-sig'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-23', false)$$, 'PAYABLES_SIGNATURE_AFTER_ISSUE');
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-future'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2099-01-01', false)$$, 'PAYABLES_FUTURE_DATE_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-stale'), pc_test.id('form_a1'), 1,
  DATE '2026-10-25', false)$$, 'PAYABLES_STALE_VERSION');
SELECT pc_test.put('form_a1_version_before', pc_test.id('form_a1'));
SELECT pc_test.put('iss_a1', (public.payables_confirm_issuance_v1(pc_test.key('confirm-a1'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-25', false) ->> 'issuance_id')::uuid);
-- S13 / §9-34 : RÉSERVÉ → ENGAGÉ sur la même allocation, restant inchangé.
SELECT pc_test.assert((SELECT count(*) = 1 AND bool_and(status = 'ENGAGED') AND sum(amount) = 1000000
  FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_a1')), 'single allocation engaged');
SELECT pc_test.assert((SELECT engaged FROM pc_test.overview('inv_a1')) = 1000000
  AND (SELECT remaining FROM pc_test.overview('inv_a1')) = 0, 'remaining unchanged at confirmation');
-- S8 : double clic = un seul effet ; autre clé = déjà enregistré.
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('confirm-a1'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')) - 1, DATE '2026-10-25', false) ->> 'replayed')::boolean, 'confirmation replay');
SELECT pc_test.expect_error($$SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-a1-again'), pc_test.id('form_a1'),
  pc_test.form_version(pc_test.id('form_a1')), DATE '2026-10-25', false)$$, 'PAYABLES_ISSUE_ALREADY_RECORDED');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_issuances WHERE form_id = pc_test.id('form_a1')) = 1, 'one issuance');
SELECT pc_test.assert((SELECT applied_versions -> 'signatures' -> 0 ->> 'version_at_issue' FROM public.payables_issuances
  WHERE id = pc_test.id('iss_a1'))::uuid = pc_test.id('sig_dir_ora_v1'), 'applied parameter versions are kept');
-- Remise au bénéficiaire, événement distinct.
SELECT pc_test.expect_error($$SELECT public.payables_record_delivery_v1(pc_test.key('deliver-early'), pc_test.id('form_a1'),
  DATE '2026-10-24', NULL)$$, 'PAYABLES_DELIVERY_BEFORE_ISSUE');
SELECT public.payables_record_delivery_v1(pc_test.key('deliver-a1'), pc_test.id('form_a1'), DATE '2026-10-25', 'Remis au coursier');
SELECT pc_test.expect_error($$SELECT public.payables_record_delivery_v1(pc_test.key('deliver-a1-2'), pc_test.id('form_a1'),
  DATE '2026-10-26', NULL)$$, 'PAYABLES_DELIVERY_ALREADY_RECORDED');
RESET ROLE;

-- Jeu de paiements dédiés aux contrôles d'admissibilité (préparateur acc1 sauf mention).
SELECT pc_test.new_payment('acc1', 'pay_prep', 'sup_delta', 10000, 'acct_ora');
SELECT pc_test.new_payment('acc4', 'pay_unlinked', 'sup_delta', 11000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_absent', 'sup_delta', 12000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_pending', 'sup_delta', 13000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_revoked', 'sup_delta', 14000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_early', 'sup_delta', 15000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_conj_fail', 'sup_delta', 16000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_conj_ok', 'sup_delta', 17000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_relax', 'sup_delta', 18000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_ceiling', 'sup_delta', 60000000, 'acct_ora');
SELECT pc_test.new_payment('acc1', 'pay_over', 'sup_delta', 100000, 'acct_ora');
SELECT pc_test.print_cheque('acc1', 'pay_prep', '0003001', DATE '2026-10-20');
SELECT pc_test.print_cheque('acc4', 'pay_unlinked', '0003002', DATE '2026-10-20');
SELECT pc_test.print_cheque('acc1', 'pay_absent', '0003003', DATE '2026-10-20');
SELECT pc_test.print_cheque('acc1', 'pay_pending', '0003004', DATE '2026-10-20');
SELECT pc_test.print_cheque('acc1', 'pay_revoked', '0003005', DATE '2026-05-20');
SELECT pc_test.print_cheque('acc1', 'pay_early', '0003006', DATE '2026-05-20');
SELECT pc_test.print_cheque('acc1', 'pay_conj_fail', '0003007', DATE '2026-10-19');
SELECT pc_test.print_cheque('acc1', 'pay_conj_ok', '0003008', DATE '2026-10-21');
SELECT pc_test.print_cheque('acc1', 'pay_relax', '0003009', DATE '2026-10-19');
SELECT pc_test.print_cheque('acc1', 'pay_ceiling', '0003010', DATE '2026-10-20');
SELECT pc_test.print_cheque('acc1', 'pay_over', '0003011', DATE '2026-10-20');
RESET ROLE;

CREATE FUNCTION pc_test.sign(p_payment text, p_person text, p_on date)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pc_test.backdate_prints();
  PERFORM pc_test.as_user('acc2');
  PERFORM public.payables_record_signature_v1(pc_test.key('sign:' || p_payment || ':' || p_person),
    pc_test.id('form_' || p_payment), pc_test.content_of(pc_test.id('form_' || p_payment)), pc_test.id(p_person), p_on, NULL);
END $$;
CREATE FUNCTION pc_test.confirm_sql(p_payment text, p_date date)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.payables_confirm_issuance_v1(%L, %L::uuid, %s, %L::date, false)',
    pc_test.key('confirm:' || p_payment || ':' || p_date), pc_test.id('form_' || p_payment),
    pc_test.form_version(pc_test.id('form_' || p_payment)), p_date)
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- S23 : signataire identique au préparateur → approbation refusée.
SELECT pc_test.sign('pay_prep', 'p_acc1', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_prep', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_IS_PREPARER');
-- Revue P1-3 : le déclarant d'un résultat d'impression et l'auteur d'un
-- ajustement du contenu signable sont des préparateurs, exclus des signataires.
SELECT pc_test.new_payment('acc3', 'pay_prep_outcome', 'sup_delta', 21000, 'acct_ora');
SELECT pc_test.new_payment('acc3', 'pay_prep_adjust', 'sup_delta', 22000, 'acct_ora');
SELECT pc_test.as_user('acc3');
SELECT pc_test.put('form_pay_prep_outcome', (public.payables_assign_cheque_form_v1(pc_test.key('assign-prep-outcome'),
  pc_test.id('pay_prep_outcome'), pc_test.payment_version(pc_test.id('pay_prep_outcome')), '0003021', 'ORA_CHQ_170X95',
  DATE '2026-10-26') ->> 'form_id')::uuid);
SELECT pc_test.put('pe_prep_outcome', (public.payables_record_print_intent_v1(pc_test.key('intent-prep-outcome'),
  pc_test.id('form_pay_prep_outcome'), pc_test.form_version(pc_test.id('form_pay_prep_outcome')),
  pc_test.content_of(pc_test.id('form_pay_prep_outcome')), 'Impression') ->> 'print_event_id')::uuid);
SELECT pc_test.as_user('acc1');
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-prep-outcome'), pc_test.id('pe_prep_outcome'), 'PRINTED', NULL);
SELECT pc_test.sign('pay_prep_outcome', 'p_acc1', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_prep_outcome', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_IS_PREPARER');
SELECT pc_test.as_user('acc3');
SELECT pc_test.put('form_pay_prep_adjust', (public.payables_assign_cheque_form_v1(pc_test.key('assign-prep-adjust'),
  pc_test.id('pay_prep_adjust'), pc_test.payment_version(pc_test.id('pay_prep_adjust')), '0003022', 'ORA_CHQ_170X95',
  DATE '2026-10-26') ->> 'form_id')::uuid);
SELECT pc_test.as_user('acc1');
SELECT public.payables_adjust_payment_v1(pc_test.key('adjust-prep'), pc_test.id('pay_prep_adjust'),
  pc_test.payment_version(pc_test.id('pay_prep_adjust')), 21500, 'Bénéficiaire synthétique ajusté', 'Montant ajusté');
SELECT pc_test.as_user('acc3');
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-prep-adjust'),
  (public.payables_record_print_intent_v1(pc_test.key('intent-prep-adjust'), pc_test.id('form_pay_prep_adjust'),
   pc_test.form_version(pc_test.id('form_pay_prep_adjust')), pc_test.content_of(pc_test.id('form_pay_prep_adjust')), 'Impression')
   ->> 'print_event_id')::uuid, 'PRINTED', NULL);
SELECT pc_test.sign('pay_prep_adjust', 'p_acc1', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_prep_adjust', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_IS_PREPARER');
-- Préparateur sans rattachement vérifié : aucune comparaison sur un nom libre.
SELECT pc_test.sign('pay_unlinked', 'p_dir', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_unlinked', DATE '2026-10-26'), 'PAYABLES_PREPARER_NOT_LINKED');
-- S27 : plafond absent ; S28 : signataire en attente de confirmation.
SELECT pc_test.sign('pay_absent', 'p_sig2', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_absent', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
SELECT pc_test.sign('pay_pending', 'p_dex', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_pending', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
-- S24 : révocation avant l'émission ; S25 : émission réellement antérieure saisie tard.
SELECT pc_test.sign('pay_revoked', 'p_sig3', DATE '2026-05-20');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_revoked', DATE '2026-06-15'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
SELECT pc_test.sign('pay_early', 'p_sig3', DATE '2026-05-20');
SELECT pc_test.as_user('acc2');
SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-early'), pc_test.id('form_pay_early'),
  pc_test.form_version(pc_test.id('form_pay_early')), DATE '2026-05-25', false);
-- S48 : règle devenue conjointe avant l'émission ; S49 : règle redevenue simple.
SELECT pc_test.sign('pay_conj_fail', 'p_dir', DATE '2026-10-19');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_conj_fail', DATE '2026-10-22'), 'PAYABLES_SIGNATURE_RULE_NOT_MET');
SELECT pc_test.sign('pay_conj_ok', 'p_dir', DATE '2026-10-21');
SELECT pc_test.sign('pay_conj_ok', 'p_sig4', DATE '2026-10-21');
SELECT pc_test.as_user('acc2');
SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-conj'), pc_test.id('form_pay_conj_ok'),
  pc_test.form_version(pc_test.id('form_pay_conj_ok')), DATE '2026-10-21', false);
SELECT pc_test.assert((SELECT (applied_versions ->> 'required_signatures')::int = 2
  AND jsonb_array_length(applied_versions -> 'signatures') = 2 FROM public.payables_issuances
  WHERE form_id = pc_test.id('form_pay_conj_ok')), 'joint rule satisfied by two distinct signatories');
SELECT pc_test.sign('pay_relax', 'p_dir', DATE '2026-10-19');
SELECT pc_test.as_user('acc2');
SELECT public.payables_confirm_issuance_v1(pc_test.key('confirm-relax'), pc_test.id('form_pay_relax'),
  pc_test.form_version(pc_test.id('form_pay_relax')), DATE '2026-10-25', false);
-- Plafond explicite dépassé.
SELECT pc_test.sign('pay_ceiling', 'p_dir', DATE '2026-10-26');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_ceiling', DATE '2026-10-26'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
RESET ROLE;

-- S52 analogue : signature sur une version périmée du contenu refusée.
SELECT pc_test.new_payment('acc1', 'pay_vm', 'sup_delta', 19000, 'acct_ora');
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('form_pay_vm', (public.payables_assign_cheque_form_v1(pc_test.key('assign-vm'), pc_test.id('pay_vm'),
  pc_test.payment_version(pc_test.id('pay_vm')), '0003012', 'ORA_CHQ_170X95', DATE '2026-10-20') ->> 'form_id')::uuid);
SELECT pc_test.put('content_vm_v1', pc_test.content_of(pc_test.id('form_pay_vm')));
SELECT public.payables_revise_cheque_content_v1(pc_test.key('revise-vm'), pc_test.id('form_pay_vm'),
  pc_test.form_version(pc_test.id('form_pay_vm')), DATE '2026-10-21', 'Date corrigée');
SELECT public.payables_record_print_outcome_v1(pc_test.key('outcome-vm'),
  (public.payables_record_print_intent_v1(pc_test.key('intent-vm'), pc_test.id('form_pay_vm'),
   pc_test.form_version(pc_test.id('form_pay_vm')), pc_test.content_of(pc_test.id('form_pay_vm')), 'Impression')
   ->> 'print_event_id')::uuid, 'PRINTED', NULL);
SELECT pc_test.backdate_prints(DATE '2026-10-21', pc_test.id('form_pay_vm'));
SELECT pc_test.as_user('acc2');
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sig-vm-old'), pc_test.id('form_pay_vm'),
  pc_test.id('content_vm_v1'), pc_test.id('p_dir'), DATE '2026-10-21', NULL)$$, 'PAYABLES_SIGNATURE_VERSION_MISMATCH');
-- Revue P2-1 : aucune signature antérieure à l'impression de la version signable.
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sig-vm-before-print'),
  pc_test.id('form_pay_vm'), pc_test.content_of(pc_test.id('form_pay_vm')), pc_test.id('p_dir'), DATE '2026-10-20', NULL)$$,
  'PAYABLES_SIGNATURE_BEFORE_PRINT');

-- ---------------------------------------------------------------------------
-- Émission déclarée en exception (S29–S31 ; §9-61–64).
-- ---------------------------------------------------------------------------
SELECT pc_test.put('exc_prep', (public.payables_declare_issuance_exception_v1(pc_test.key('declare-prep'), pc_test.id('acct_ora'),
  '0003001', 10000, DATE '2026-10-26', pc_test.id('pay_prep'), 'SIGNATORY_IS_PREPARER', 'Copie du chèque signé',
  'Chèque signé par son préparateur et remis') ->> 'exception_id')::uuid);
SELECT pc_test.assert((SELECT count(*) FROM public.payables_cheque_forms WHERE bank_account_id = pc_test.id('acct_ora')
  AND cheque_number = '0003001') = 1, 'declaration attaches to the existing form');
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_prep')) = 'ENGAGED',
  'known amount counted once');
SELECT pc_test.assert((SELECT blocks_account FROM public.payables_exceptions WHERE id = pc_test.id('exc_prep')),
  'exception blocks the account');
SELECT pc_test.expect_error(pc_test.confirm_sql('pay_prep', DATE '2026-10-26'), 'PAYABLES_ISSUE_ALREADY_RECORDED');
SELECT pc_test.expect_error($$SELECT public.payables_declare_issuance_exception_v1(pc_test.key('declare-prep-2'),
  pc_test.id('acct_ora'), '0003001', 10000, DATE '2026-10-26', pc_test.id('pay_prep'), 'SIGNATORY_IS_PREPARER', 'Copie',
  'Seconde déclaration')$$, 'PAYABLES_ISSUE_ALREADY_RECORDED');
SELECT pc_test.expect_error($$SELECT public.payables_declare_issuance_exception_v1(pc_test.key('declare-noev'),
  pc_test.id('acct_ora'), '0009998', NULL, DATE '2026-10-26', NULL, 'OTHER_OUTSIDE_CIRCUIT', NULL, 'Sans pièce')$$,
  'PAYABLES_EVIDENCE_INVALID');
-- S30 : montant inconnu, jamais zéro.
SELECT pc_test.put('exc_unknown', (public.payables_declare_issuance_exception_v1(pc_test.key('declare-unknown'),
  pc_test.id('acct_ora'), '0009999', NULL, DATE '2026-10-26', NULL, 'OTHER_OUTSIDE_CIRCUIT', 'Talon de chéquier',
  'Chèque émis hors circuit, montant non retrouvé') ->> 'exception_id')::uuid);
SELECT pc_test.assert((SELECT i.amount IS NULL AND f.provenance = 'EXCEPTION' FROM public.payables_issuances i
  JOIN public.payables_cheque_forms f ON f.id = i.form_id WHERE f.cheque_number = '0009999'), 'unknown amount stays unknown');
-- Dépassement : aucune allocation automatique, facture bloquée.
SELECT pc_test.assert((public.payables_declare_issuance_exception_v1(pc_test.key('declare-over'), pc_test.id('acct_ora'),
  '0003011', 150000, DATE '2026-10-26', pc_test.id('pay_over'), 'SIGNATURE_MISSING', 'Copie', 'Montant supérieur à la facture')
  ->> 'overrun_exception_id') IS NOT NULL, 'overrun exception opened');
SELECT pc_test.assert((SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_over')) = 'RESERVED',
  'no automatic allocation on overrun');
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_pay_over')), 'overrun blocks the invoice');
-- Revue P2-2 : une facture bloquée ne se corrige pas avant instruction.
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error(format('SELECT public.payables_correct_invoice_v1(%L, %L::uuid, %s, 200000, NULL, NULL, %L, %L)',
  pc_test.key('correct-blocked'), pc_test.id('inv_pay_over'),
  (SELECT row_version FROM public.payables_invoices WHERE id = pc_test.id('inv_pay_over')), 'Facture rectifiée',
  'Correction sur facture bloquée'), 'PAYABLES_INVOICE_BLOCKED');
SELECT pc_test.as_user('acc2');
-- L'établissement du montant inconnu ne clôt pas l'exception d'émission.
SELECT pc_test.as_user('acc3');
SELECT public.payables_resolve_exception_v1(pc_test.key('unknown-amount'), pc_test.id('exc_unknown'), 1, 'AMOUNT_ESTABLISHED',
  jsonb_build_object('amount', 42000), 'Relevé de compte', 'Montant établi');
SELECT pc_test.assert((SELECT amount FROM public.payables_issuances i JOIN public.payables_cheque_forms f ON f.id = i.form_id
  WHERE f.cheque_number = '0009999' ORDER BY i.revision_no DESC LIMIT 1) = 42000
  AND (SELECT count(*) FROM public.payables_issuances i JOIN public.payables_cheque_forms f ON f.id = i.form_id
  WHERE f.cheque_number = '0009999') = 2, 'amount established by a new revision, history kept');
SELECT pc_test.assert((SELECT status FROM public.payables_exceptions WHERE id = pc_test.id('exc_unknown')) = 'OPEN',
  'issuance exception stays open until regularized');
-- Revue P2-3 : montant inconnu sur un paiement rattaché → facture bloquée
-- jusqu'à l'établissement du montant (la réservation n'en est pas une preuve).
SELECT pc_test.new_payment('acc1', 'pay_unk', 'sup_delta', 24000, 'acct_ora');
SELECT pc_test.as_user('acc2');
SELECT pc_test.put('exc_unk_linked', (public.payables_declare_issuance_exception_v1(pc_test.key('declare-unk-linked'),
  pc_test.id('acct_ora'), '0003023', NULL, DATE '2026-10-26', pc_test.id('pay_unk'), 'SIGNATURE_MISSING', 'Talon',
  'Chèque émis, montant à établir') ->> 'exception_id')::uuid);
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_pay_unk')), 'unknown amount on a linked payment blocks the invoice');
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('req-unk-second'), pc_test.id('inv_pay_unk'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Bénéficiaire', 'Second paiement')$$, 'PAYABLES_INVOICE_BLOCKED');
SELECT pc_test.as_user('acc3');
SELECT public.payables_resolve_exception_v1(pc_test.key('unk-linked-amount'), pc_test.id('exc_unk_linked'), 1, 'AMOUNT_ESTABLISHED',
  jsonb_build_object('amount', 24000), 'Relevé de compte', 'Montant établi');
SELECT pc_test.assert(NOT (SELECT blocked FROM pc_test.overview('inv_pay_unk'))
  AND (SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_unk')) = 'ENGAGED',
  'established amount within ceiling engages once and lifts the invoice block');

-- Formule d'un paiement abandonné finalement émise : fait enregistré sans
-- allocation, facture bloquée contre tout second paiement.
SELECT pc_test.as_user('acc2');
SELECT pc_test.expect_error($$SELECT public.payables_declare_issuance_exception_v1(pc_test.key('declare-abandoned-pay'),
  pc_test.id('acct_ora'), '0001400', 300000, DATE '2026-10-26', pc_test.id('pay_b1c'), 'SIGNATURE_MISSING', 'Copie',
  'Paiement abandonné')$$, 'PAYABLES_PAYMENT_STATE_INVALID');
SELECT pc_test.put('exc_abandoned', (public.payables_declare_issuance_exception_v1(pc_test.key('declare-abandoned'),
  pc_test.id('acct_ora'), '0001400', 300000, DATE '2026-10-26', NULL, 'SIGNATURE_MISSING', 'Copie du chèque',
  'Formule réputée inutilisée retrouvée émise') ->> 'overrun_exception_id')::uuid);
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_b1')) AND (SELECT state FROM public.payables_cheque_forms
  WHERE cheque_number = '0001400') = 'ISSUED', 'invoice of an abandoned payment is blocked once its form is found issued');
SELECT pc_test.as_user('acc3');
SELECT public.payables_resolve_exception_v1(pc_test.key('abandoned-res'), pc_test.id('exc_abandoned'), 1,
  'DOCUMENTED_NO_ALLOCATION', NULL, 'Note de rapprochement fournisseur', 'Règlement constaté hors engagement');
RESET ROLE;

SELECT 'PASS 41_cheque_issuance' AS marker;
