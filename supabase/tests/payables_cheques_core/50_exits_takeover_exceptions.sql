-- Sorties hors banque, reprise initiale, formules pré-signées et instruction
-- des exceptions (S15, S16, S22, S29, S59 ; §9 critères 4–7, 12–14, 18, 25, 38, 44, 57–59).

CREATE FUNCTION pc_test.exit_version(p_exit uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.row_version FROM public.payables_exits e WHERE e.id = p_exit
$$;
CREATE FUNCTION pc_test.exception_version(p_exception uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.row_version FROM public.payables_exceptions e WHERE e.id = p_exception
$$;
CREATE FUNCTION pc_test.batch_version(p_batch uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.row_version FROM public.payables_takeover_batches b WHERE b.id = p_batch
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- ---------------------------------------------------------------------------
-- Annulation : demande ≠ validation, libération seulement à la validation.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_request_exit_v1(pc_test.key('exit-notissued'), pc_test.id('form_pay_absent'),
  pc_test.form_version(pc_test.id('form_pay_absent')), 'CANCELLATION', NULL, 'Pièce', 'Annulation')$$, 'PAYABLES_EXIT_STATE_INVALID');
SELECT pc_test.put('exit_relax', (public.payables_request_exit_v1(pc_test.key('exit-relax'), pc_test.id('form_pay_relax'),
  pc_test.form_version(pc_test.id('form_pay_relax')), 'CANCELLATION', NULL, 'Opposition bancaire', 'Chèque à annuler')
  ->> 'exit_id')::uuid);
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_pay_relax')) = 0, 'a request alone releases nothing');
SELECT pc_test.expect_error($$SELECT public.payables_validate_exit_v1(pc_test.key('exit-relax-self'), pc_test.id('exit_relax'),
  pc_test.exit_version(pc_test.id('exit_relax')), true, 'Auto validation')$$, 'PAYABLES_SECOND_ACTOR_REQUIRED');
SELECT pc_test.as_user('acc2');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-relax-ok'), pc_test.id('exit_relax'),
  pc_test.exit_version(pc_test.id('exit_relax')), true, 'Annulation validée');
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_pay_relax')) = 'CANCELLED'
  AND (SELECT remaining FROM pc_test.overview('inv_pay_relax')) = 18000, 'validated cancellation releases the engagement');

-- ---------------------------------------------------------------------------
-- Remplacement : transfert atomique, remplaçant RÉSERVÉ hors circulation (S15, §9-38, 44).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('exit_conj', (public.payables_request_exit_v1(pc_test.key('exit-conj'), pc_test.id('form_pay_conj_ok'),
  pc_test.form_version(pc_test.id('form_pay_conj_ok')), 'REPLACEMENT', jsonb_build_object('beneficiary', 'Bénéficiaire corrigé'),
  'Courrier du bénéficiaire', 'Chèque perdu par le bénéficiaire') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT pc_test.put('pay_conj_replacement', (public.payables_validate_exit_v1(pc_test.key('exit-conj-ok'), pc_test.id('exit_conj'),
  pc_test.exit_version(pc_test.id('exit_conj')), true, 'Remplacement validé') ->> 'replacement_payment_id')::uuid);
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_pay_conj_ok')) = 'REPLACED',
  'old cheque leaves circulation as replaced');
SELECT pc_test.assert((SELECT a.status = 'RESERVED' AND a.amount = 17000 AND p.replaces_payment_id = pc_test.id('pay_conj_ok')
  AND p.beneficiary = 'Bénéficiaire corrigé'
  FROM public.payables_allocations a JOIN public.payables_payments p ON p.id = a.payment_id
  WHERE p.id = pc_test.id('pay_conj_replacement')), 'replacement reserved, linked, not yet issued');
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_pay_conj_ok')) = 0, 'no window: remaining stays at zero');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_allocations a JOIN public.payables_payments p ON p.id = a.payment_id
  WHERE p.invoice_id = pc_test.id('inv_pay_conj_ok') AND a.status IN ('RESERVED','ENGAGED')) = 1, 'no double counting');
-- Remplacement au-delà du plafond : refus atomique, chèque initial inchangé.
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('exit_early', (public.payables_request_exit_v1(pc_test.key('exit-early'), pc_test.id('form_pay_early'),
  pc_test.form_version(pc_test.id('form_pay_early')), 'REPLACEMENT', jsonb_build_object('amount', 999999), 'Pièce',
  'Remplacement surévalué') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT pc_test.expect_error($$SELECT public.payables_validate_exit_v1(pc_test.key('exit-early-ok'), pc_test.id('exit_early'),
  pc_test.exit_version(pc_test.id('exit_early')), true, 'Validation')$$, 'PAYABLES_REPLACEMENT_EXCEEDS_CEILING');
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_pay_early')) = 'ISSUED'
  AND (SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_early')) = 'ENGAGED',
  'refused replacement leaves no partial effect');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-early-no'), pc_test.id('exit_early'),
  pc_test.exit_version(pc_test.id('exit_early')), false, 'Montant non justifié');

-- Correction de la date réelle d'émission : révision, historique conservé.
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_request_exit_v1(pc_test.key('exit-corr-future'), pc_test.id('form_pay_early'),
  pc_test.form_version(pc_test.id('form_pay_early')), 'CORRECTION', jsonb_build_object('issue_date', '2099-01-01'), 'Pièce',
  'Date future')$$, 'PAYABLES_FUTURE_DATE_FORBIDDEN');
SELECT pc_test.put('exit_corr', (public.payables_request_exit_v1(pc_test.key('exit-corr'), pc_test.id('form_pay_early'),
  pc_test.form_version(pc_test.id('form_pay_early')), 'CORRECTION', jsonb_build_object('issue_date', '2026-05-26'),
  'Talon du chéquier', 'Date réelle d''émission') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc3');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-corr-ok'), pc_test.id('exit_corr'),
  pc_test.exit_version(pc_test.id('exit_corr')), true, 'Correction validée');
SELECT pc_test.assert((SELECT count(*) = 2 AND max(issue_date) = DATE '2026-05-26' AND min(issue_date) = DATE '2026-05-25'
  FROM public.payables_issuances WHERE form_id = pc_test.id('form_pay_early')), 'correction adds a revision');
-- Revue P2-1 : une correction de date ne contourne ni la signature ni l'habilitation.
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('exit_corr_before_sig', (public.payables_request_exit_v1(pc_test.key('exit-corr-before-sig'),
  pc_test.id('form_pay_early'), pc_test.form_version(pc_test.id('form_pay_early')), 'CORRECTION',
  jsonb_build_object('issue_date', '2026-05-19'), 'Talon du chéquier', 'Date antérieure à la signature') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_validate_exit_v1(pc_test.key('exit-corr-before-sig-ok'),
  pc_test.id('exit_corr_before_sig'), pc_test.exit_version(pc_test.id('exit_corr_before_sig')), true, 'Validation')$$,
  'PAYABLES_SIGNATURE_AFTER_ISSUE');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-corr-before-sig-no'), pc_test.id('exit_corr_before_sig'),
  pc_test.exit_version(pc_test.id('exit_corr_before_sig')), false, 'Date incompatible avec la signature');
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('exit_corr_revoked', (public.payables_request_exit_v1(pc_test.key('exit-corr-revoked'),
  pc_test.id('form_pay_early'), pc_test.form_version(pc_test.id('form_pay_early')), 'CORRECTION',
  jsonb_build_object('issue_date', '2026-06-20'), 'Talon du chéquier', 'Date postérieure à la révocation') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_validate_exit_v1(pc_test.key('exit-corr-revoked-ok'),
  pc_test.id('exit_corr_revoked'), pc_test.exit_version(pc_test.id('exit_corr_revoked')), true, 'Validation')$$,
  'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-corr-revoked-no'), pc_test.id('exit_corr_revoked'),
  pc_test.exit_version(pc_test.id('exit_corr_revoked')), false, 'Signataire révoqué à cette date');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_issuances WHERE form_id = pc_test.id('form_pay_early')) = 2,
  'refused corrections add no revision');

-- Facture bloquée : aucun remplaçant ne peut être créé.
SELECT pc_test.as_user('acc1');
SELECT public.payables_declare_transfer_v1(pc_test.key('trf-early-block'), pc_test.id('inv_pay_early'), pc_test.id('acct_ora'),
  'ALL_PAYMENTS', 15000, 'VIR-SYN-7', 'EXECUTED', DATE '2026-10-20', 'Avis', 'Second règlement constaté');
SELECT pc_test.put('exit_early_blocked', (public.payables_request_exit_v1(pc_test.key('exit-early-blocked'),
  pc_test.id('form_pay_early'), pc_test.form_version(pc_test.id('form_pay_early')), 'REPLACEMENT', NULL, 'Pièce',
  'Remplacement demandé') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT pc_test.expect_error($$SELECT public.payables_validate_exit_v1(pc_test.key('exit-early-blocked-ok'),
  pc_test.id('exit_early_blocked'), pc_test.exit_version(pc_test.id('exit_early_blocked')), true, 'Validation')$$,
  'PAYABLES_INVOICE_BLOCKED');
SELECT public.payables_validate_exit_v1(pc_test.key('exit-early-blocked-no'), pc_test.id('exit_early_blocked'),
  pc_test.exit_version(pc_test.id('exit_early_blocked')), false, 'Facture bloquée');
SELECT public.payables_resolve_exception_v1(pc_test.key('trf-early-res'),
  (SELECT e.id FROM public.payables_exceptions e JOIN public.payables_payments p ON p.id = e.payment_id
    WHERE p.invoice_id = pc_test.id('inv_pay_early') AND e.status = 'OPEN'), 1, 'DOCUMENTED_NO_ALLOCATION', NULL,
  'Avis bancaire', 'Doublon de règlement documenté');

-- ---------------------------------------------------------------------------
-- Reprise initiale : contrôles, second acteur, attestation, collisions (§9-4–6).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_prepare_takeover_v1(pc_test.key('tk-mismatch'), pc_test.id('acct_bdk'),
  DATE '2026-09-30', 'Registre manuel synthétique', 2, 1000, jsonb_build_array(
    jsonb_build_object('cheque_number', '0100001', 'beneficiary', 'Bénéficiaire R1', 'amount', 400, 'issue_date', '2026-09-01'),
    jsonb_build_object('cheque_number', '0100002', 'beneficiary', 'Bénéficiaire R2', 'amount', 500, 'issue_date', '2026-09-02')),
  'Reprise')$$, 'PAYABLES_TAKEOVER_CONTROL_MISMATCH');
SELECT pc_test.expect_error($$SELECT public.payables_prepare_takeover_v1(pc_test.key('tk-dup'), pc_test.id('acct_bdk'),
  DATE '2026-09-30', 'Registre manuel synthétique', 2, 800, jsonb_build_array(
    jsonb_build_object('cheque_number', '0100001', 'beneficiary', 'Bénéficiaire R1', 'amount', 400, 'issue_date', '2026-09-01'),
    jsonb_build_object('cheque_number', '0100001', 'beneficiary', 'Bénéficiaire R1', 'amount', 400, 'issue_date', '2026-09-01')),
  'Reprise')$$, 'PAYABLES_TAKEOVER_DUPLICATE_ITEM');
SELECT pc_test.expect_error($$SELECT public.payables_prepare_takeover_v1(pc_test.key('tk-late'), pc_test.id('acct_bdk'),
  DATE '2026-09-30', 'Registre manuel synthétique', 1, 400, jsonb_build_array(
    jsonb_build_object('cheque_number', '0100009', 'beneficiary', 'Bénéficiaire R9', 'amount', 400, 'issue_date', '2026-10-02')),
  'Reprise')$$, 'PAYABLES_TAKEOVER_ITEM_AFTER_CUTOFF');
SELECT pc_test.put('tk_bdk', (public.payables_prepare_takeover_v1(pc_test.key('tk-bdk'), pc_test.id('acct_bdk'),
  DATE '2026-09-30', 'Registre manuel synthétique', 3, 120000, jsonb_build_array(
    jsonb_build_object('cheque_number', '0100001', 'beneficiary', 'Bénéficiaire R1', 'amount', 50000, 'issue_date', '2026-09-01'),
    jsonb_build_object('cheque_number', '0100002', 'beneficiary', 'Bénéficiaire R2', 'amount', 40000, 'issue_date', '2026-09-12'),
    jsonb_build_object('cheque_number', '0100003', 'beneficiary', 'Bénéficiaire R3', 'amount', 30000, 'issue_date', '2026-09-28')),
  'Reprise initiale BDK') ->> 'batch_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_decide_takeover_v1(pc_test.key('tk-bdk-self'), pc_test.id('tk_bdk'),
  pc_test.batch_version(pc_test.id('tk_bdk')), true, true, 'Auto approbation')$$, 'PAYABLES_SECOND_ACTOR_REQUIRED');
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_decide_takeover_v1(pc_test.key('tk-bdk-ok'), pc_test.id('tk_bdk'),
  pc_test.batch_version(pc_test.id('tk_bdk')), true, true, 'Attestation d''exhaustivité') ->> 'outcome') = 'INTEGRATED',
  'takeover integrated once');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_cheque_forms WHERE bank_account_id = pc_test.id('acct_bdk')
  AND provenance = 'TAKEOVER' AND state = 'ISSUED') = 3, 'takeover cheques are in circulation');
-- §9-4 : réimport du même lot → aucun doublon, collision instruite.
SELECT pc_test.as_user('acc3');
SELECT pc_test.put('tk_bdk_again', (public.payables_prepare_takeover_v1(pc_test.key('tk-bdk-again'), pc_test.id('acct_bdk'),
  DATE '2026-09-30', 'Registre manuel synthétique', 1, 50000, jsonb_build_array(
    jsonb_build_object('cheque_number', '0100001', 'beneficiary', 'Bénéficiaire R1', 'amount', 50000, 'issue_date', '2026-09-01')),
  'Réimport') ->> 'batch_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_decide_takeover_v1(pc_test.key('tk-bdk-again-ok'), pc_test.id('tk_bdk_again'),
  pc_test.batch_version(pc_test.id('tk_bdk_again')), true, true, 'Approbation') ->> 'outcome') = 'COLLISION', 'reimport collides');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_cheque_forms WHERE bank_account_id = pc_test.id('acct_bdk')
  AND cheque_number = '0100001') = 1, 'no duplicate instrument');
SELECT pc_test.as_user('acc3');
SELECT public.payables_resolve_exception_v1(pc_test.key('tk-collision-res'),
  (SELECT id FROM public.payables_exceptions WHERE takeover_batch_id = pc_test.id('tk_bdk_again')), 1, 'BATCH_ABANDONED', NULL,
  'Note de contrôle', 'Lot déjà intégré');
-- §9-5 : collision reprise ↔ saisie courante sur le compte ORABANK.
SELECT pc_test.put('tk_ora_collide', (public.payables_prepare_takeover_v1(pc_test.key('tk-ora-collide'), pc_test.id('acct_ora'),
  DATE '2026-09-30', 'Registre manuel synthétique', 1, 1000000, jsonb_build_array(
    jsonb_build_object('cheque_number', '0001234', 'beneficiary', 'Bénéficiaire X', 'amount', 1000000, 'issue_date', '2026-09-15')),
  'Reprise ORA') ->> 'batch_id')::uuid);
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_decide_takeover_v1(pc_test.key('tk-ora-collide-ok'), pc_test.id('tk_ora_collide'),
  pc_test.batch_version(pc_test.id('tk_ora_collide')), true, true, 'Approbation') ->> 'outcome') = 'COLLISION',
  'takeover colliding with current entry is refused');

-- ---------------------------------------------------------------------------
-- Formules pré-signées : inventaire du risque, utilisation jamais approuvée.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('presigned_1', (public.payables_record_presigned_form_v1(pc_test.key('presigned-1'), pc_test.id('acct_ora'),
  '0200001', pc_test.id('p_dir'), 'Coffre de la direction', 'Inventaire à la bascule') ->> 'form_id')::uuid);
SELECT pc_test.put('presigned_2', (public.payables_record_presigned_form_v1(pc_test.key('presigned-2'), pc_test.id('acct_ora'),
  '0200002', pc_test.id('p_dir'), 'Coffre de la direction', 'Inventaire à la bascule') ->> 'form_id')::uuid);
SELECT pc_test.assert((SELECT state = 'PRESIGNED_HELD' AND presigned FROM public.payables_cheque_forms
  WHERE id = pc_test.id('presigned_1')), 'presigned form held outside circulation');
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_declare_issuance_exception_v1(pc_test.key('declare-presigned'), pc_test.id('acct_ora'),
  '0200002', 25000, DATE '2026-10-26', NULL, 'PRESIGNED_OUTSIDE_PROTOCOL', 'Copie', 'Formule pré-signée utilisée')
  ->> 'form_id')::uuid = pc_test.id('presigned_2'), 'use of a presigned form is only a declared exception');
SELECT public.payables_resolve_exception_v1(pc_test.key('presigned-lost'),
  (SELECT id FROM public.payables_exceptions WHERE form_id = pc_test.id('presigned_1') AND kind = 'PRESIGNED_FORM_RISK'), 1,
  'FORM_LOST', NULL, 'Procès-verbal', 'Formule introuvable');
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('presigned_1')) = 'LOST'
  AND EXISTS (SELECT 1 FROM public.payables_exceptions WHERE form_id = pc_test.id('presigned_1') AND kind = 'FORM_LOST'
    AND status = 'OPEN' AND blocks_account), 'lost presigned form is a blocking exception');

-- ---------------------------------------------------------------------------
-- Instruction des exceptions : second acteur, codes fermés, faits préservés.
-- ---------------------------------------------------------------------------
SELECT pc_test.expect_error($$SELECT public.payables_resolve_exception_v1(pc_test.key('exc-prep-self'), pc_test.id('exc_prep'),
  pc_test.exception_version(pc_test.id('exc_prep')), 'REGULARIZED', NULL, 'Pièce', 'Auto instruction')$$,
  'PAYABLES_SECOND_ACTOR_REQUIRED');
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_resolve_exception_v1(pc_test.key('exc-prep-code'), pc_test.id('exc_prep'),
  pc_test.exception_version(pc_test.id('exc_prep')), 'FOUND_UNUSED', NULL, 'Pièce', 'Mauvais code')$$,
  'PAYABLES_RESOLUTION_CODE_INVALID');
SELECT public.payables_resolve_exception_v1(pc_test.key('exc-prep-ok'), pc_test.id('exc_prep'),
  pc_test.exception_version(pc_test.id('exc_prep')), 'REGULARIZED', NULL, 'Note de régularisation', 'Pouvoirs vérifiés a posteriori');
SELECT pc_test.as_user('acc2');
SELECT pc_test.put('exc_unknown_2', (public.payables_declare_issuance_exception_v1(pc_test.key('declare-unknown-2'),
  pc_test.id('acct_ora'), '0009997', NULL, DATE '2026-10-26', NULL, 'OTHER_OUTSIDE_CIRCUIT', 'Talon', 'Montant inconnu')
  ->> 'exception_id')::uuid);
SELECT pc_test.as_user('acc3');
SELECT pc_test.expect_error($$SELECT public.payables_resolve_exception_v1(pc_test.key('exc-unknown2-reg'), pc_test.id('exc_unknown_2'),
  pc_test.exception_version(pc_test.id('exc_unknown_2')), 'REGULARIZED', NULL, 'Pièce', 'Régularisation')$$,
  'PAYABLES_AMOUNT_STILL_UNKNOWN');
-- Dépassement instruit : allocation plafonnée au restant, excédent documenté.
SELECT public.payables_resolve_exception_v1(pc_test.key('overrun-res'),
  (SELECT id FROM public.payables_exceptions WHERE payment_id = pc_test.id('pay_over') AND kind = 'ISSUANCE_OVERRUN'), 1,
  'ALLOCATE_REMAINING', NULL, 'Relevé fournisseur', 'Engagement plafonné au montant de la facture');
SELECT pc_test.assert((SELECT status = 'ENGAGED' AND amount = 100000 FROM public.payables_allocations
  WHERE payment_id = pc_test.id('pay_over')), 'instructed overrun engages at most the invoice amount');
SELECT pc_test.assert(NOT (SELECT blocked FROM pc_test.overview('inv_pay_over')), 'invoice released after instruction');
RESET ROLE;

SELECT 'PASS 50_exits_takeover_exceptions' AS marker;
