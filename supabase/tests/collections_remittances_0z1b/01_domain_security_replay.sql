\set ON_ERROR_STOP on

-- Données exclusivement synthétiques : aucun nom, compte ou mouvement réel.
CREATE SCHEMA poc_0z1b;
CREATE FUNCTION poc_0z1b.assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'TEST_FAILED: %', p_message;
  END IF;
  RAISE NOTICE 'OK: %', p_message;
END;
$$;

CREATE FUNCTION poc_0z1b.expect_error(p_sql text, p_fragment text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) > 0 THEN
      RAISE NOTICE 'OK: %', p_message;
      RETURN;
    END IF;
    RAISE EXCEPTION 'TEST_FAILED: % (erreur inattendue: %)', p_message, SQLERRM;
  END;
  RAISE EXCEPTION 'TEST_FAILED: % (aucune erreur)', p_message;
END;
$$;

GRANT USAGE ON SCHEMA poc_0z1b TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_0z1b TO authenticated, anon;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'entry.synthetic@local.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'review.synthetic@local.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'audit.synthetic@local.invalid')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, created_by) VALUES
  ('11111111-1111-4111-8111-111111111111', 'manager', '9539d4f5-a600-4bf7-931f-315e597e4441'),
  ('22222222-2222-4222-8222-222222222222', 'manager', '9539d4f5-a600-4bf7-931f-315e597e4441'),
  ('33333333-3333-4333-8333-333333333333', 'auditor', '9539d4f5-a600-4bf7-931f-315e597e4441')
ON CONFLICT (user_id, role) DO NOTHING;

-- La garde Daily v2 est volontairement contournée uniquement pour construire
-- les fixtures canonical synthétiques de ce replay superuser jetable.
SET session_replication_role = replica;
INSERT INTO public.daily_statement_account_registry (
  id, created_by, bank, currency, safe_alias, account_fingerprint, account_number_masked
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '9539d4f5-a600-4bf7-931f-315e597e4441',
  'ATB', 'XOF', 'COMPTE SYNTHETIQUE 0Z1B', repeat('a', 64), '****0001'
);

-- Les lignes Daily v2 ci-dessous émulent un état canonical déjà promu. Le
-- contournement des triggers est réservé à cette fixture superuser locale.
INSERT INTO public.daily_statement_units_canonical (
  id, promoted_from_staging_unit_id, day_unit_id, bank, account_fingerprint,
  currency, accounting_date, active_day_content_hash, line_count,
  day_total_debits, day_total_credits, aggregates_status, validation_status,
  status, ingested_by, account_registry_id
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000011',repeat('1',64),
   'ATB',repeat('a',64),'XOF',DATE '2030-01-10',repeat('b',64),4,0,2000,'derived','valid','ingested',
   '9539d4f5-a600-4bf7-931f-315e597e4441','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000012',repeat('2',64),
   'ATB',repeat('a',64),'XOF',DATE '2030-01-11',repeat('c',64),1,0,400,'derived','valid','ingested',
   '9539d4f5-a600-4bf7-931f-315e597e4441','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000013',repeat('3',64),
   'ATB',repeat('a',64),'XOF',DATE '2030-01-12',repeat('8',64),1,1000,0,'derived','valid','ingested',
   '9539d4f5-a600-4bf7-931f-315e597e4441','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.daily_statement_lines_canonical (
  id, canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal,
  source_line_index, is_active, accounting_date, value_date, description_sanitized,
  credit_amount, signed_amount, direction, currency
) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',repeat('1',64),repeat('d',64),1,1,true,
   DATE '2030-01-10',DATE '2030-01-10','CREDIT SYNTHETIQUE PARTIEL 1',400,400,'credit','XOF'),
  ('bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',repeat('1',64),repeat('e',64),1,2,true,
   DATE '2030-01-10',DATE '2030-01-10','CREDIT SYNTHETIQUE PARTIEL 2',600,600,'credit','XOF'),
  ('bbbbbbbb-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001',repeat('1',64),repeat('f',64),1,3,true,
   DATE '2030-01-10',DATE '2030-01-10','REGLEMENT EFFET SYNTHETIQUE PARTIEL',300,300,'credit','XOF'),
  ('bbbbbbbb-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001',repeat('1',64),repeat('9',64),1,4,true,
   DATE '2030-01-10',DATE '2030-01-10','REGLEMENT EFFET SYNTHETIQUE SOLDE',700,700,'credit','XOF'),
  ('bbbbbbbb-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000002',repeat('2',64),repeat('d',64),1,1,false,
   DATE '2030-01-11',DATE '2030-01-11','CREDIT SYNTHETIQUE REPRISE',400,400,'credit','XOF');
INSERT INTO public.daily_statement_lines_canonical (
  id, canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal,
  source_line_index, is_active, accounting_date, value_date, description_sanitized,
  debit_amount, signed_amount, direction, currency
) VALUES (
  'bbbbbbbb-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000003',repeat('3',64),repeat('7',64),1,1,true,
  DATE '2030-01-12',DATE '2030-01-12','RETOUR IMPAYE SYNTHETIQUE',1000,-1000,'debit','XOF'
);
SET session_replication_role = origin;

-- Attribution des capacités par l'admin synthétique.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9539d4f5-a600-4bf7-931f-315e597e4441',false);
SELECT public.grant_collection_capability_v1(
  actor_id, capability, NULL, NULL, 'Attribution locale pour replay 0Z1B',
  'grant-' || lower(replace(capability,'_','-')) || '-' || right(actor_id::text,4)
)
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid,'ENTRY'),
  ('11111111-1111-4111-8111-111111111111'::uuid,'PROPOSE_MATCH'),
  ('11111111-1111-4111-8111-111111111111'::uuid,'CONFIRM_MATCH'),
  ('11111111-1111-4111-8111-111111111111'::uuid,'APPROVE_PROROGATION'),
  ('11111111-1111-4111-8111-111111111111'::uuid,'ISSUE_FUNDING_CHEQUE'),
  ('11111111-1111-4111-8111-111111111111'::uuid,'MANAGE_CONFIG'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'CONFIRM_MATCH'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'APPROVE_PROROGATION'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'CONFIRM_DELIVERY'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'CORRECT_EVENT'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'MANAGE_CONFIG'),
  ('33333333-3333-4333-8333-333333333333'::uuid,'AUDIT')
) AS grants(actor_id, capability);

-- Aucun accès anonyme, même en lecture ou par RPC.
RESET ROLE;
SET ROLE anon;
SELECT poc_0z1b.expect_error(
  $$SELECT count(*) FROM public.collection_receipts$$,
  'permission denied', 'anon ne lit aucune table Collections');
SELECT poc_0z1b.expect_error(
  $$SELECT public.create_collection_receipt_v1('{}'::jsonb,'anonymous-key')$$,
  'permission denied', 'anon ne peut exécuter aucune commande Collections');
RESET ROLE;

-- L'utilisateur applicatif ne dispose d'aucune DML directe.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT poc_0z1b.expect_error(
  $$INSERT INTO public.collection_receipts (
      source_type,client_name_snapshot,method,business_nature,amount,currency,
      bank_submission_date,created_by,updated_by
    ) VALUES ('MANUAL','INTERDIT','CASH','OTHER',1,'XOF',current_date,
      auth.uid(),auth.uid())$$,
  'permission denied', 'authenticated ne peut pas insérer directement');

-- Capture d'un effet de prorogation et idempotence stricte.
SELECT set_config('poc.effect_result', public.create_collection_receipt_v1(
  jsonb_build_object(
    'source_type','MANUAL','client_reference','CLIENT-SYNTH-01',
    'client_name_snapshot','CLIENT SYNTHETIQUE','method','EFFECT',
    'business_nature','PROROGATION','amount',1000,'currency','XOF',
    'bank_submission_date','2030-01-01','counterparty_bank_snapshot','BANQUE CLIENT SYNTHETIQUE',
    'deposit_account_registry_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'instrument',jsonb_build_object('instrument_type','EFFECT','effect_reference','EFF-SYNTH-01',
      'maturity_date','2030-02-01')
  ), 'receipt-effect-synth-0001'
)::text, false);
SELECT poc_0z1b.assert(
  (public.create_collection_receipt_v1(
    jsonb_build_object(
      'source_type','MANUAL','client_reference','CLIENT-SYNTH-01',
      'client_name_snapshot','CLIENT SYNTHETIQUE','method','EFFECT',
      'business_nature','PROROGATION','amount',1000,'currency','XOF',
      'bank_submission_date','2030-01-01','counterparty_bank_snapshot','BANQUE CLIENT SYNTHETIQUE',
      'deposit_account_registry_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'instrument',jsonb_build_object('instrument_type','EFFECT','effect_reference','EFF-SYNTH-01',
        'maturity_date','2030-02-01')
    ), 'receipt-effect-synth-0001')->>'receipt_id') =
   (current_setting('poc.effect_result')::jsonb->>'receipt_id'),
  'la répétition idempotente retourne le même objet');
SELECT poc_0z1b.expect_error(
  $$SELECT public.create_collection_receipt_v1(
      jsonb_build_object('source_type','MANUAL','client_name_snapshot','DIFFERENT',
        'method','CASH','business_nature','OTHER','amount',2,'currency','XOF',
        'bank_submission_date','2030-01-01'), 'receipt-effect-synth-0001')$$,
  'COLLECTION_IDEMPOTENCY_PAYLOAD_MISMATCH', 'une clé rejouée avec un autre payload est refusée');

-- Prorogation : nominal exact, plusieurs chèques et contrôle à deux acteurs.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT set_config('poc.prorogation_result', public.create_collection_prorogation_v1(
  'CLIENT-SYNTH-01',1000,'XOF',DATE '2030-01-31','prorogation-synth-0001')::text,false);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.attach_collection_prorogation_source_v1(
  (current_setting('poc.prorogation_result')::jsonb->>'prorogation_id')::uuid,
  'RECEIVABLE','CREANCE-SYNTH-01',1000,1,'attach-source-synth-0001');
SELECT set_config('poc.attach_result', public.attach_collection_replacement_effect_v1(
  (current_setting('poc.prorogation_result')::jsonb->>'prorogation_id')::uuid,
  (current_setting('poc.effect_result')::jsonb->>'instrument_id')::uuid,1000,2,
  'attach-effect-synth-0001')::text,false);
SELECT set_config('poc.cheque1', public.prepare_collection_funding_cheque_v1(
  (current_setting('poc.prorogation_result')::jsonb->>'prorogation_id')::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BENEFICIAIRE SYNTHETIQUE','CHK-SYNTH-001',
  400,DATE '2030-01-15',3,'prepare-cheque-synth-0001')::text,false);
SELECT set_config('poc.cheque2', public.prepare_collection_funding_cheque_v1(
  (current_setting('poc.prorogation_result')::jsonb->>'prorogation_id')::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BENEFICIAIRE SYNTHETIQUE','CHK-SYNTH-002',
  600,DATE '2030-01-16',4,'prepare-cheque-synth-0002')::text,false);
SELECT poc_0z1b.expect_error(format(
  'SELECT public.approve_collection_funding_cheque_v1(%L::uuid,1,%L,%L)',
  current_setting('poc.cheque1')::jsonb->>'outbound_cheque_id',
  'Validation volontairement interdite', 'self-approve-cheque-0001'),
  'COLLECTION_TWO_ACTORS_REQUIRED', 'le préparateur ne peut pas approuver son propre chèque');

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.approve_collection_funding_cheque_v1(
  (current_setting('poc.cheque1')::jsonb->>'outbound_cheque_id')::uuid,1,
  'Validation par le second acteur','approve-cheque-synth-0001');
SELECT public.approve_collection_funding_cheque_v1(
  (current_setting('poc.cheque2')::jsonb->>'outbound_cheque_id')::uuid,1,
  'Validation par le second acteur','approve-cheque-synth-0002');
SELECT public.confirm_collection_funding_delivery_v1(
  (current_setting('poc.cheque1')::jsonb->>'outbound_cheque_id')::uuid,DATE '2030-01-20',
  'PREUVE-SYNTH-DELIVERY-001',2,NULL,'delivery-cheque-synth-0001');
SELECT public.confirm_collection_funding_delivery_v1(
  (current_setting('poc.cheque2')::jsonb->>'outbound_cheque_id')::uuid,DATE '2030-01-21',
  'PREUVE-SYNTH-DELIVERY-002',2,NULL,'delivery-cheque-synth-0002');
SELECT poc_0z1b.assert((SELECT status='FUNDING_COMPLETE'
  FROM public.collection_prorogations
  WHERE id=(current_setting('poc.prorogation_result')::jsonb->>'prorogation_id')::uuid),
  'deux chèques de 400 et 600 couvrent exactement le nominal 1000');

-- Rapprochement partiel puis complet d'une remise de 1000.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.receipt_result', public.create_collection_receipt_v1(
  jsonb_build_object('source_type','MANUAL','client_reference','CLIENT-SYNTH-02',
    'client_name_snapshot','CLIENT SYNTHETIQUE DEUX','method','TRANSFER',
    'business_nature','INVOICE_SETTLEMENT','amount',1000,'currency','XOF',
    'bank_submission_date','2030-01-09',
    'deposit_account_registry_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'receipt-transfer-synth-0001')::text,false);
SELECT set_config('poc.proposal1', public.propose_collection_match_v1(
  'RECEIPT',(current_setting('poc.receipt_result')::jsonb->>'receipt_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000001','BANK_TRANSFER_CREDIT_CONFIRMED',
  400,95,ARRAY['AMOUNT_PARTIAL','ACCOUNT','CURRENCY'],'algo-synth-1','{"amount_tolerance":0}'::jsonb,
  'proposal-transfer-synth-0001')::text,false);
SELECT poc_0z1b.expect_error(format(
  'SELECT public.confirm_collection_match_v1(%L::uuid,%L,%L)',
  current_setting('poc.proposal1')::jsonb->>'proposal_id',
  'Auto validation interdite','self-confirm-match-0001'),
  'COLLECTION_TWO_ACTORS_REQUIRED', 'le proposant ne confirme pas son rapprochement');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT set_config('poc.confirm1', public.confirm_collection_match_v1(
  (current_setting('poc.proposal1')::jsonb->>'proposal_id')::uuid,
  'Preuve partielle confirmée','confirm-match-synth-0001')::text,false);
SELECT poc_0z1b.assert((SELECT settlement_state='PARTIALLY_MATCHED'
  FROM public.collection_receipts
  WHERE id=(current_setting('poc.receipt_result')::jsonb->>'receipt_id')::uuid),
  'un crédit partiel laisse un solde ouvert');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.proposal2', public.propose_collection_match_v1(
  'RECEIPT',(current_setting('poc.receipt_result')::jsonb->>'receipt_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000002','BANK_TRANSFER_CREDIT_CONFIRMED',
  600,96,ARRAY['AMOUNT_RESIDUAL','ACCOUNT','CURRENCY'],'algo-synth-1','{"amount_tolerance":0}'::jsonb,
  'proposal-transfer-synth-0002')::text,false);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.confirm_collection_match_v1(
  (current_setting('poc.proposal2')::jsonb->>'proposal_id')::uuid,
  'Preuve finale confirmée','confirm-match-synth-0002');
SELECT poc_0z1b.assert((SELECT settlement_state='CONFIRMED'
  FROM public.collection_receipts
  WHERE id=(current_setting('poc.receipt_result')::jsonb->>'receipt_id')::uuid),
  'les crédits 400 et 600 confirment exactement la remise 1000');

-- Un même effet peut être réglé partiellement ; le reliquat reste explicite.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.partial_effect', public.create_collection_receipt_v1(
  jsonb_build_object('source_type','MANUAL','client_reference','CLIENT-SYNTH-03',
    'client_name_snapshot','CLIENT SYNTHETIQUE TROIS','method','EFFECT',
    'business_nature','INVOICE_SETTLEMENT','amount',1000,'currency','XOF',
    'bank_submission_date','2030-01-08',
    'deposit_account_registry_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'instrument',jsonb_build_object('instrument_type','EFFECT','effect_reference','EFF-SYNTH-PARTIAL',
      'maturity_date','2030-02-15')),
  'receipt-effect-partial-0001')::text,false);
SELECT set_config('poc.effect_proposal1', public.propose_collection_match_v1(
  'INSTRUMENT',(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000004','EFFECT_PARTIAL_SETTLEMENT_CONFIRMED',
  300,94,ARRAY['PARTIAL_PAYMENT','ACCOUNT','CURRENCY'],'algo-synth-1','{"amount_tolerance":0}'::jsonb,
  'proposal-effect-partial-0001')::text,false);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.confirm_collection_match_v1(
  (current_setting('poc.effect_proposal1')::jsonb->>'proposal_id')::uuid,
  'Règlement partiel prouvé','confirm-effect-partial-0001');
SELECT poc_0z1b.assert((SELECT settlement_state='PARTIALLY_SETTLED' AND settled_amount=300
  FROM public.collection_instruments
  WHERE id=(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid),
  'un effet réglé à 300 sur 1000 conserve un reliquat de 700');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.effect_proposal2', public.propose_collection_match_v1(
  'INSTRUMENT',(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000005','EFFECT_SETTLEMENT_CONFIRMED',
  700,97,ARRAY['RESIDUAL_PAYMENT','ACCOUNT','CURRENCY'],'algo-synth-1','{"amount_tolerance":0}'::jsonb,
  'proposal-effect-partial-0002')::text,false);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.confirm_collection_match_v1(
  (current_setting('poc.effect_proposal2')::jsonb->>'proposal_id')::uuid,
  'Solde final prouvé','confirm-effect-partial-0002');
SELECT poc_0z1b.assert((SELECT settlement_state='SETTLED' AND settled_amount=1000
  FROM public.collection_instruments
  WHERE id=(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid),
  'le second règlement de 700 clôt exactement le même effet');

-- Un impayé constaté après le crédit est un nouvel événement bancaire ; il
-- n'efface jamais les deux règlements qui le précèdent.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.unpaid_proposal', public.propose_collection_match_v1(
  'INSTRUMENT',(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000006','EFFECT_UNPAID_CONFIRMED',
  1000,99,ARRAY['BANK_RETURN','FULL_AMOUNT','ACCOUNT'],'algo-synth-1','{"amount_tolerance":0}'::jsonb,
  'proposal-effect-unpaid-0001')::text,false);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.confirm_collection_match_v1(
  (current_setting('poc.unpaid_proposal')::jsonb->>'proposal_id')::uuid,
  'Impayé post crédit prouvé par débit bancaire','confirm-effect-unpaid-0001');
SELECT poc_0z1b.assert(
  (SELECT settlement_state='UNPAID' AND settled_amount=1000
   FROM public.collection_instruments
   WHERE id=(current_setting('poc.partial_effect')::jsonb->>'instrument_id')::uuid)
  AND (SELECT recourse_state='UNPAID'
       FROM public.collection_receipts
       WHERE id=(current_setting('poc.partial_effect')::jsonb->>'receipt_id')::uuid),
  'l impayé post crédit conserve l historique réglé et ouvre le recours');

-- Une supersession Daily v2 rend la preuve visible comme à reprendre, puis la
-- réassociation par hash actif restaure une preuve courante sans disparition.
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.daily_statement_lines_canonical
SET is_active=false WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
UPDATE public.daily_statement_lines_canonical
SET is_active=true WHERE id='bbbbbbbb-0000-4000-8000-000000000003';
SET session_replication_role = origin;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT poc_0z1b.assert(EXISTS(
  SELECT 1 FROM public.collection_bank_line_evidence_status_v
  WHERE daily_line_id='bbbbbbbb-0000-4000-8000-000000000001'
    AND control_state='REVIEW_REQUIRED'),
  'une preuve Daily supersédée déclenche une reprise explicite');
SELECT public.rebind_collection_superseded_evidence_v1(
  (current_setting('poc.confirm1')::jsonb->>'allocation_id')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000003','Réassociation déterministe par même hash actif',
  'rebind-evidence-synth-0001');
SELECT poc_0z1b.assert(
  (SELECT evidence_state='EVIDENCE_SUPERSEDED' FROM public.collection_bank_line_allocations
   WHERE id=(current_setting('poc.confirm1')::jsonb->>'allocation_id')::uuid)
  AND EXISTS (SELECT 1 FROM public.collection_bank_line_allocations
              WHERE supersedes_allocation_id=(current_setting('poc.confirm1')::jsonb->>'allocation_id')::uuid
                AND evidence_state='REBOUND'),
  'la preuve ancienne reste tracée et la nouvelle est liée');

-- Agios : règle attendue à deux acteurs, calcul automatique, observé séparé.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('poc.rule', public.create_collection_charge_rule_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DISCOUNT_SYNTH',DATE '2030-01-01',
  0.10,360,100,0.01,50,0.18,0,'Paramètres synthétiques à valider',
  'charge-rule-synth-0001')::text,false);
SELECT poc_0z1b.expect_error(format(
  'SELECT public.approve_collection_charge_rule_v1(%L::uuid,%L,%L)',
  current_setting('poc.rule')::jsonb->>'charge_rule_id',
  'Auto validation interdite','self-approve-rule-0001'),
  'COLLECTION_CONFIG_TWO_ACTORS_REQUIRED', 'le créateur ne valide pas sa règle de frais');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.approve_collection_charge_rule_v1(
  (current_setting('poc.rule')::jsonb->>'charge_rule_id')::uuid,
  'Validation indépendante de la formule','approve-rule-synth-0001');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT poc_0z1b.assert(
  (public.calculate_collection_expected_charge_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DISCOUNT_SYNTH',10000,
    DATE '2030-01-01',DATE '2030-01-31')->>'observed_amount') IS NULL,
  'le calcul attendu ne fabrique jamais un montant bancaire observé');

-- Contrôles catalogue finaux.
RESET ROLE;
SELECT poc_0z1b.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name LIKE 'collection_%'
    AND table_name <> 'collection_report'
    AND grantee IN ('anon','service_role')
    AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')),
  'anon et service_role n ont aucun droit table direct sur le nouveau domaine');
SELECT poc_0z1b.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name LIKE 'collection_%'
    AND table_name <> 'collection_report'
    AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE','DELETE')),
  'authenticated ne détient aucun DML direct sur le nouveau domaine');
SELECT poc_0z1b.assert(
  NOT has_schema_privilege('anon','public','CREATE')
  AND NOT has_schema_privilege('authenticated','public','CREATE')
  AND NOT has_schema_privilege('service_role','public','CREATE'),
  'aucun rôle applicatif ne peut créer un objet concurrent dans public');
SELECT poc_0z1b.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND (p.proname LIKE '%collection%' OR p.proname LIKE 'collection_%')
    AND NOT ('search_path=public, pg_temp'=ANY(coalesce(p.proconfig,'{}'::text[])))),
  'toutes les fonctions SECURITY DEFINER du lot ont un search_path fixe');
SELECT poc_0z1b.expect_error(
  $$UPDATE public.collection_events SET reason='mutation interdite'$$,
  'COLLECTION_APPEND_ONLY_OBJECT', 'les événements métier sont append-only');
SELECT poc_0z1b.expect_error(
  $$DELETE FROM public.collection_audit_events$$,
  'COLLECTION_APPEND_ONLY_OBJECT', 'l audit est append-only');

SELECT 'ALL_0Z1B_ASSERTIONS_PASS' AS result;
