-- Fournisseurs, factures, demandes de paiement, plafonds, virements déclarés,
-- fusions, versions et verrous (S6–S22, S36, S64 ; §9 critères 22, 28–30, 40–42, 45, 46).

CREATE FUNCTION pc_test.overview(p_invoice text)
RETURNS TABLE (reserved numeric, engaged numeric, remaining numeric, blocked boolean)
LANGUAGE sql AS $$
  SELECT o.reserved_amount, o.engaged_amount, o.remaining_amount, o.blocked
  FROM public.payables_invoice_overview_v1() o WHERE o.invoice_id = pc_test.id(p_invoice)
$$;
CREATE FUNCTION pc_test.payment_version(p_payment text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT row_version FROM public.payables_payments WHERE id = pc_test.id(p_payment)
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- ---------------------------------------------------------------------------
-- Fournisseurs : recherche de doublons serveur (S21, §9-45).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.put('sup_alpha', (public.payables_create_supplier_v1(pc_test.key('sup-alpha'), 'Fournisseur Alpha SARL',
  'Référentiel synthétique') ->> 'supplier_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('sup-alpha-dup'),
  '  fournisseur   alpha sarl ', 'Doublon')$$, 'PAYABLES_SUPPLIER_DUPLICATE');
SELECT pc_test.put('sup_beta', (public.payables_create_supplier_v1(pc_test.key('sup-beta'), 'Fournisseur Béta', 'Création')
  ->> 'supplier_id')::uuid);
SELECT pc_test.put('sup_gamma', (public.payables_create_supplier_v1(pc_test.key('sup-gamma'), 'Fournisseur Gamma', 'Création')
  ->> 'supplier_id')::uuid);
SELECT pc_test.put('sup_delta', (public.payables_create_supplier_v1(pc_test.key('sup-delta'), 'Fournisseur Delta', 'Création')
  ->> 'supplier_id')::uuid);
SELECT pc_test.put('sup_epsilon', (public.payables_create_supplier_v1(pc_test.key('sup-eps'), 'Delta Services', 'Création')
  ->> 'supplier_id')::uuid);
SELECT pc_test.assert((SELECT normalized_name FROM public.payables_suppliers WHERE id = pc_test.id('sup_beta'))
  = 'FOURNISSEUR BETA', 'normalization folds accents and case');

-- ---------------------------------------------------------------------------
-- Factures : identité fournisseur + référence exacte, collision instruite (§9-40).
-- ---------------------------------------------------------------------------
SELECT pc_test.put('inv_a1', (public.payables_create_invoice_v1(pc_test.key('inv-a1'), pc_test.id('sup_alpha'), 'FA-0001',
  1000000, 'XOF', DATE '2026-10-01', DATE '2026-11-15', 'Original papier A1') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_a2', (public.payables_create_invoice_v1(pc_test.key('inv-a2'), pc_test.id('sup_alpha'), 'FA-0002',
  300000, 'XOF', NULL, NULL, 'Original papier A2') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_b1', (public.payables_create_invoice_v1(pc_test.key('inv-b1'), pc_test.id('sup_beta'), 'B-77',
  500000, 'XOF', NULL, DATE '2026-10-20', 'Original papier B1') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_c1', (public.payables_create_invoice_v1(pc_test.key('inv-c1'), pc_test.id('sup_gamma'), 'C-1',
  400000, 'XOF', NULL, DATE '2026-12-01', 'Original papier C1') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_c2', (public.payables_create_invoice_v1(pc_test.key('inv-c2'), pc_test.id('sup_gamma'), 'C-2',
  200000, 'XOF', NULL, NULL, 'Original papier C2') ->> 'invoice_id')::uuid);
SELECT pc_test.put('inv_e1', (public.payables_create_invoice_v1(pc_test.key('inv-e1'), pc_test.id('sup_epsilon'), 'E-1',
  100000, 'XOF', NULL, NULL, 'Original papier E1') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_invoice_v1(pc_test.key('inv-eur'), pc_test.id('sup_alpha'),
  'FA-9', 1000, 'EUR', NULL, NULL, 'Original')$$, 'PAYABLES_CURRENCY_NOT_SUPPORTED');
SELECT pc_test.expect_error($$SELECT public.payables_create_invoice_v1(pc_test.key('inv-dec'), pc_test.id('sup_alpha'),
  'FA-10', 1000.50, 'XOF', NULL, NULL, 'Original')$$, 'PAYABLES_AMOUNT_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_create_invoice_v1(pc_test.key('inv-space'), pc_test.id('sup_alpha'),
  'FA-11 ', 1000, 'XOF', NULL, NULL, 'Original')$$, 'PAYABLES_REFERENCE_INVALID');
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_a2')) = 300000, 'unknown due date keeps invoice visible');

-- Collision : aucune facture créée, exception ouverte, rejeu stable.
SELECT pc_test.put('exc_collision', (public.payables_create_invoice_v1(pc_test.key('inv-a1-bis'), pc_test.id('sup_alpha'),
  'FA-0001', 999, 'XOF', NULL, NULL, 'Second original') ->> 'exception_id')::uuid);
SELECT pc_test.assert((public.payables_create_invoice_v1(pc_test.key('inv-a1-bis'), pc_test.id('sup_alpha'), 'FA-0001', 999,
  'XOF', NULL, NULL, 'Second original') ->> 'outcome') = 'COLLISION', 'collision replay is stable');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_invoices WHERE reference_exact = 'FA-0001') = 1,
  'collision created no invoice');
SELECT pc_test.expect_error($$SELECT public.payables_resolve_exception_v1(pc_test.key('coll-self'), pc_test.id('exc_collision'),
  1, 'AUTHORIZE_DISTINCT', NULL, 'Pièce', 'Auto instruction')$$, 'PAYABLES_CAPABILITY_REQUIRED:EXCEPTION_INSTRUCT');
SELECT pc_test.as_user('acc2');
SELECT pc_test.put('inv_a1_bis', (public.payables_resolve_exception_v1(pc_test.key('coll-ok'), pc_test.id('exc_collision'),
  1, 'AUTHORIZE_DISTINCT', NULL, 'Courrier fournisseur', 'Réutilisation légitime confirmée') ->> 'new_invoice_id')::uuid);
SELECT pc_test.assert((SELECT collision_ordinal FROM public.payables_invoices WHERE id = pc_test.id('inv_a1_bis')) = 1,
  'authorized duplicate keeps the exact reference with an ordinal');

-- ---------------------------------------------------------------------------
-- Demandes de paiement : paiement unique par défaut, partiel explicite (§9-22, 28, 29).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-cat'), pc_test.id('inv_a1'),
  pc_test.id('acct_ora'), 'NOPE', NULL, false, 'Fournisseur Alpha', 'Paiement')$$, 'PAYABLES_CATEGORY_INACTIVE');
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-eur'), pc_test.id('inv_a1'),
  pc_test.id('acct_eur'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Alpha', 'Paiement')$$, 'PAYABLES_CURRENCY_NOT_SUPPORTED');
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-flag'), pc_test.id('inv_a1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', 400000, false, 'Fournisseur Alpha', 'Paiement')$$, 'PAYABLES_PARTIAL_FLAG_REQUIRED');
SELECT pc_test.put('pay_a1', (public.payables_create_cheque_request_v1(pc_test.key('pay-a1'), pc_test.id('inv_a1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Alpha SARL', 'Règlement facture A1') ->> 'payment_id')::uuid);
SELECT pc_test.assert((SELECT amount FROM public.payables_payments WHERE id = pc_test.id('pay_a1')) = 1000000,
  'default amount is the remaining amount');
SELECT pc_test.assert((SELECT reserved FROM pc_test.overview('inv_a1')) = 1000000
  AND (SELECT remaining FROM pc_test.overview('inv_a1')) = 0, 'reservation consumes the remaining');
-- S22 : facture entièrement engagée, nouvelle préparation bloquée.
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-a1-2'), pc_test.id('inv_a1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Alpha', 'Second paiement')$$, 'PAYABLES_INVOICE_FULLY_ENGAGED');
-- S12 : plafond calculé hors la propre allocation ; dépassement refusé (S10 version).
SELECT pc_test.expect_error($$SELECT public.payables_adjust_payment_v1(pc_test.key('adj-stale'), pc_test.id('pay_a1'), 99,
  1000000, 'Fournisseur Alpha SARL', 'Ajustement')$$, 'PAYABLES_STALE_VERSION');
SELECT public.payables_adjust_payment_v1(pc_test.key('adj-same'), pc_test.id('pay_a1'), pc_test.payment_version('pay_a1'),
  1000000, 'Fournisseur Alpha SARL', 'Ajustement au plafond exact');
SELECT pc_test.expect_error($$SELECT public.payables_adjust_payment_v1(pc_test.key('adj-over'), pc_test.id('pay_a1'),
  pc_test.payment_version('pay_a1'), 1000001, 'Fournisseur Alpha SARL', 'Dépassement')$$, 'PAYABLES_AMOUNT_EXCEEDS_CEILING');
-- Facture engagée : correction refusée (aucun changement silencieux).
SELECT pc_test.expect_error($$SELECT public.payables_correct_invoice_v1(pc_test.key('corr-a1'), pc_test.id('inv_a1'), 1,
  2000000, NULL, NULL, 'Original', 'Correction')$$, 'PAYABLES_INVOICE_ENGAGED_CHANGE_FORBIDDEN');
SELECT public.payables_correct_invoice_v1(pc_test.key('corr-a2'), pc_test.id('inv_a2'), 1, 350000, NULL, DATE '2026-11-30',
  'Original papier A2', 'Montant mal saisi');
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_a2')) = 350000, 'correction before any allocation applied');
-- Arbitrage CTO : sans allocation active, correction sans second acteur, mais
-- toujours sous version attendue et avec historique avant/après conservé.
SELECT pc_test.expect_error($$SELECT public.payables_correct_invoice_v1(pc_test.key('corr-a2-stale'), pc_test.id('inv_a2'), 1,
  360000, NULL, NULL, 'Original papier A2', 'Version périmée')$$, 'PAYABLES_STALE_VERSION');
RESET ROLE;
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'INVOICE_CORRECTED'
  AND aggregate_id = pc_test.id('inv_a2') AND metadata #>> '{before,amount}' IS NOT NULL
  AND metadata #>> '{after,amount}' = '350000') = 1, 'invoice correction history keeps before and after');
SELECT pc_test.as_user('acc1');

-- Paiements partiels successifs, aucun dépassement (§9-28, 29, 35).
SELECT pc_test.put('pay_b1a', (public.payables_create_cheque_request_v1(pc_test.key('pay-b1a'), pc_test.id('inv_b1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', 200000, true, 'Fournisseur Béta', 'Acompte') ->> 'payment_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-b1x'), pc_test.id('inv_b1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', 300001, true, 'Fournisseur Béta', 'Solde')$$, 'PAYABLES_AMOUNT_EXCEEDS_REMAINING');
SELECT pc_test.put('pay_b1b', (public.payables_create_cheque_request_v1(pc_test.key('pay-b1b'), pc_test.id('inv_b1'),
  pc_test.id('acct_bdk'), 'ALL_PAYMENTS', 300000, true, 'Fournisseur Béta', 'Solde') ->> 'payment_id')::uuid);
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_b1')) = 0, 'two partial payments cover the invoice exactly');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_invoices WHERE supplier_id = pc_test.id('sup_beta')) = 1,
  'partial payments never duplicate the invoice');
-- Abandon jamais imprimé : allocation libérée.
SELECT public.payables_abandon_payment_v1(pc_test.key('abandon-b1b'), pc_test.id('pay_b1b'), pc_test.payment_version('pay_b1b'),
  'Abandon avant impression');
SELECT pc_test.assert((SELECT remaining FROM pc_test.overview('inv_b1')) = 300000, 'abandon before printing releases');
SELECT pc_test.put('pay_b1c', (public.payables_create_cheque_request_v1(pc_test.key('pay-b1c'), pc_test.id('inv_b1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Béta', 'Solde') ->> 'payment_id')::uuid);

-- ---------------------------------------------------------------------------
-- Virements déclarés : écriture unique, aucun ordre bancaire (§9-30, 41, 42 ; S17–S19).
-- ---------------------------------------------------------------------------
SELECT pc_test.put('trf_c1', (public.payables_declare_transfer_v1(pc_test.key('trf-c1'), pc_test.id('inv_c1'),
  pc_test.id('acct_bdk'), 'ALL_PAYMENTS', 150000, 'VIR-SYN-1', 'EXECUTED', DATE '2026-10-02', 'Avis synthétique',
  'Virement effectué') ->> 'payment_id')::uuid);
SELECT pc_test.assert((SELECT engaged FROM pc_test.overview('inv_c1')) = 150000, 'declared transfer engages once');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_payments WHERE invoice_id = pc_test.id('inv_c1')) = 1,
  'single persistent write for a declared transfer');
SELECT pc_test.put('pay_c1', (public.payables_create_cheque_request_v1(pc_test.key('pay-c1'), pc_test.id('inv_c1'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Gamma', 'Solde par chèque') ->> 'payment_id')::uuid);
SELECT pc_test.assert((SELECT amount FROM public.payables_payments WHERE id = pc_test.id('pay_c1')) = 250000,
  'cheque after transfer uses the remaining only');
-- S17 : virement en dépassement conservé, sans allocation, facture bloquée.
SELECT pc_test.put('trf_c2', (public.payables_declare_transfer_v1(pc_test.key('trf-c2'), pc_test.id('inv_c2'),
  pc_test.id('acct_bdk'), 'ALL_PAYMENTS', 300000, 'VIR-SYN-2', 'EXECUTED', DATE '2026-10-03', 'Avis synthétique',
  'Virement effectué') ->> 'payment_id')::uuid);
SELECT pc_test.assert((SELECT allocation_outcome FROM public.payables_transfer_declarations WHERE payment_id = pc_test.id('trf_c2'))
  = 'UNALLOCATED', 'overrun transfer kept without allocation');
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_c2')) AND (SELECT remaining FROM pc_test.overview('inv_c2')) IS NULL,
  'blocked invoice shows no available remaining');
-- S18 : création d'un paiement sur facture bloquée refusée.
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('pay-c2'), pc_test.id('inv_c2'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Fournisseur Gamma', 'Paiement')$$, 'PAYABLES_INVOICE_BLOCKED');
-- Fait déjà réalisé sur facture bloquée : enregistrable, rejoint l'exception.
SELECT pc_test.assert((public.payables_declare_transfer_v1(pc_test.key('trf-c2b'), pc_test.id('inv_c2'), pc_test.id('acct_bdk'),
  'ALL_PAYMENTS', 10000, 'VIR-SYN-3', 'EXECUTED', DATE '2026-10-04', 'Avis synthétique', 'Second virement réalisé')
  ->> 'allocation_outcome') = 'UNALLOCATED', 'realized transfer on blocked invoice stays recordable');
SELECT pc_test.expect_error($$SELECT public.payables_declare_transfer_v1(pc_test.key('trf-future'), pc_test.id('inv_c2'),
  pc_test.id('acct_bdk'), 'ALL_PAYMENTS', 1, 'VIR-SYN-4', 'EXECUTED', DATE '2099-01-01', 'Avis', 'Futur')$$,
  'PAYABLES_FUTURE_DATE_FORBIDDEN');
-- Revue P2-4 : une même référence bancaire n'est jamais déclarée deux fois sur un
-- compte (casse ignorée).
SELECT pc_test.expect_error($$SELECT public.payables_declare_transfer_v1(pc_test.key('trf-dup-ref'), pc_test.id('inv_c2'),
  pc_test.id('acct_bdk'), 'ALL_PAYMENTS', 5000, 'vir-syn-3', 'EXECUTED', DATE '2026-10-04', 'Avis', 'Doublon de saisie')$$,
  'PAYABLES_TRANSFER_REFERENCE_DUPLICATE');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_payments WHERE invoice_id = pc_test.id('inv_c2') AND mode = 'TRANSFER') = 2,
  'refused duplicate leaves no payment');
-- Instruction par un second acteur : allocation limitée au restant, puis déblocage.
SELECT pc_test.as_user('acc2');
SELECT public.payables_resolve_exception_v1(pc_test.key('trf-c2-res'),
  (SELECT id FROM public.payables_exceptions WHERE payment_id = pc_test.id('trf_c2')), 1, 'ALLOCATE_REMAINING', NULL,
  'Relevé fournisseur', 'Virement affecté dans la limite du restant');
SELECT public.payables_resolve_exception_v1(pc_test.key('trf-c2b-res'),
  (SELECT e.id FROM public.payables_exceptions e JOIN public.payables_payments p ON p.id = e.payment_id
    WHERE p.invoice_id = pc_test.id('inv_c2') AND e.status = 'OPEN'), 1, 'DOCUMENTED_NO_ALLOCATION', NULL,
  'Relevé fournisseur', 'Excédent documenté, aucune affectation');
SELECT pc_test.assert(NOT (SELECT blocked FROM pc_test.overview('inv_c2')) AND (SELECT remaining FROM pc_test.overview('inv_c2')) = 0,
  'instructed allocation caps the transfer at the remaining');

-- ---------------------------------------------------------------------------
-- Fusions : sans engagement appliquée ; avec collision non appliquée (S64, §9-46).
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert((public.payables_propose_supplier_merge_v1(pc_test.key('merge-eps'), pc_test.id('sup_epsilon'),
  pc_test.id('sup_delta'), 'Même société') ->> 'outcome') = 'APPLIED', 'merge without engagement applies directly');
SELECT pc_test.assert((SELECT supplier_id FROM public.payables_invoices WHERE id = pc_test.id('inv_e1')) = pc_test.id('sup_delta'),
  'invoices follow the kept supplier');
SELECT pc_test.expect_error($$SELECT public.payables_create_invoice_v1(pc_test.key('inv-merged'), pc_test.id('sup_epsilon'),
  'E-9', 1000, 'XOF', NULL, NULL, 'Original')$$, 'PAYABLES_SUPPLIER_MERGED');
SELECT pc_test.put('inv_g_b77', (public.payables_create_invoice_v1(pc_test.key('inv-g-b77'), pc_test.id('sup_gamma'), 'B-77',
  50000, 'XOF', NULL, NULL, 'Original Gamma B-77') ->> 'invoice_id')::uuid);
SELECT pc_test.put('merge_beta', (public.payables_propose_supplier_merge_v1(pc_test.key('merge-beta'), pc_test.id('sup_beta'),
  pc_test.id('sup_gamma'), 'Rapprochement de fournisseurs') ->> 'merge_id')::uuid);
SELECT pc_test.assert((SELECT status FROM public.payables_supplier_merges WHERE id = pc_test.id('merge_beta')) = 'PROPOSED',
  'merge touching engagements waits for a second actor');
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_decide_supplier_merge_v1(pc_test.key('merge-beta-ok'), pc_test.id('merge_beta'), true,
  'Validation fusion') ->> 'outcome') = 'PENDING_INSTRUCTION', 'ambiguous merge is not applied');
SELECT pc_test.assert((SELECT supplier_id FROM public.payables_invoices WHERE id = pc_test.id('inv_b1')) = pc_test.id('sup_beta'),
  'no invoice moved by an ambiguous merge');
SELECT pc_test.assert((SELECT blocked FROM pc_test.overview('inv_b1')) AND (SELECT blocked FROM pc_test.overview('inv_g_b77')),
  'both colliding invoices are blocked');
SELECT pc_test.as_user('acc3');
SELECT public.payables_resolve_exception_v1(pc_test.key('merge-abandon'),
  (SELECT id FROM public.payables_exceptions WHERE invoice_id = pc_test.id('inv_b1') AND kind = 'MERGE_COLLISION'), 1,
  'MERGE_ABANDONED', NULL, 'Note de décision', 'Fusion abandonnée');
SELECT pc_test.assert(NOT (SELECT blocked FROM pc_test.overview('inv_b1')) AND NOT (SELECT blocked FROM pc_test.overview('inv_g_b77')),
  'abandoned merge releases both invoices');
SELECT pc_test.assert((SELECT status FROM public.payables_supplier_merges WHERE id = pc_test.id('merge_beta')) = 'REJECTED',
  'merge abandoned');

-- ---------------------------------------------------------------------------
-- Verrous de traitement (S11) et contrôle de version.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert((public.payables_acquire_lock_v1('PAYMENT', pc_test.id('pay_c1')) ->> 'outcome') = 'ACQUIRED', 'lock acquired');
SELECT pc_test.as_user('acc3');
SELECT pc_test.assert((public.payables_acquire_lock_v1('PAYMENT', pc_test.id('pay_c1')) ->> 'outcome') = 'HELD_BY_OTHER',
  'second operator sees the lock');
SELECT pc_test.expect_error($$SELECT public.payables_adjust_payment_v1(pc_test.key('adj-locked'), pc_test.id('pay_c1'),
  pc_test.payment_version('pay_c1'), 250000, 'Fournisseur Gamma', 'Ajustement')$$, 'PAYABLES_LOCKED_BY_OTHER');
SELECT public.payables_force_release_lock_v1(pc_test.key('force-1'),
  (SELECT id FROM public.payables_work_locks WHERE object_id = pc_test.id('pay_c1') AND released_at IS NULL), 'Collègue absent');
SELECT public.payables_adjust_payment_v1(pc_test.key('adj-unlocked'), pc_test.id('pay_c1'), pc_test.payment_version('pay_c1'),
  250000, 'Fournisseur Gamma SA', 'Correction du bénéficiaire');
RESET ROLE;
-- Expiration : simulée par l'opérateur de test, levée tracée à la reprise.
SELECT pc_test.as_user('acc3');
SELECT public.payables_acquire_lock_v1('INVOICE', pc_test.id('inv_a2'));
RESET ROLE;
UPDATE public.payables_work_locks SET expires_at = statement_timestamp() - interval '1 minute'
 WHERE object_id = pc_test.id('inv_a2') AND released_at IS NULL;
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert((public.payables_acquire_lock_v1('INVOICE', pc_test.id('inv_a2')) ->> 'outcome') = 'ACQUIRED',
  'expired lock is taken over');
RESET ROLE;
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'LOCK_EXPIRED') = 1, 'expiry traced');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'LOCK_FORCED_RELEASE') = 1,
  'forced release traced');

SELECT 'PASS 30_invoices_payments' AS marker;
