\set ON_ERROR_STOP on

SELECT test.assert(
  has_function_privilege('authenticated','public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE'),
  'authenticated must execute bank RPC'
);
SELECT test.assert(
  NOT has_function_privilege('anon','public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE'),
  'anon must not execute bank RPC through PUBLIC'
);
SELECT test.assert(
  NOT has_function_privilege('service_role','public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE'),
  'service_role must not execute bank RPC'
);
SELECT test.assert(
  has_function_privilege('authenticated','public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE'),
  'authenticated must execute fund RPC'
);
SELECT test.assert(
  NOT has_function_privilege('anon','public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE'),
  'anon must not execute fund RPC through PUBLIC'
);
SELECT test.assert(
  NOT has_function_privilege('service_role','public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE'),
  'service_role must not execute fund RPC'
);
SELECT test.assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_write_commands'::regclass),
  'command ledger must have RLS enabled'
);
SELECT test.assert(
  (SELECT count(*)=0 FROM pg_policies WHERE schemaname='public' AND tablename='financial_write_commands'),
  'private command ledger must expose no policy'
);

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.save_bank_report_atomic_v1(
      '10000000-0000-4000-8000-000000000001',
      '{"bank_name":"SYNTH","report_date":"2026-08-11","opening_balance":0,"closing_balance":0}',
      '[]','[]','[]'
    );
    RAISE EXCEPTION 'TEST_FAILED: user role wrote a bank report';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'FINANCIAL_WRITE_FORBIDDEN' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;

DO $$ BEGIN
  BEGIN
    PERFORM public.save_bank_report_atomic_v1(
      '10000000-0000-4000-8000-000000000010',
      '{"bank_name":"SYNTH FRACTION","report_date":"2026-08-11","opening_balance":1.5,"closing_balance":0}',
      '[]','[]','[]'
    );
    RAISE EXCEPTION 'TEST_FAILED: fractional bigint payload unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'BANK_REPORT_VALUES_INVALID' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.save_fund_position_atomic_v1(
      '20000000-0000-4000-8000-000000000010',
      '{"report_date":"2026-08-11","total_fund_available":100,"collections_not_deposited":10,"grand_total":110.5,"deposit_for_day":null,"payment_for_day":null}',
      '[]','[]'
    );
    RAISE EXCEPTION 'TEST_FAILED: fractional fund bigint payload unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FUND_POSITION_VALUES_INVALID' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.save_bank_report_atomic_v1(
      '10000000-0000-4000-8000-000000000002',
      '{"bank_name":"SYNTH FAIL","report_date":"2026-08-11","opening_balance":100,"closing_balance":90}',
      '[{"facility_type":"SYNTH","limit_amount":100,"used_amount":10,"available_amount":90}]',
      '[{"date_depot":"2026-08-10","date_valeur":null,"type_reglement":"VIREMENT","client_code":null,"reference":null,"montant":10}]',
      '[{"date_echeance":"NOT-A-DATE","date_retour":null,"client_code":"SYNTH-FAIL","description":null,"montant":10}]'
    );
    RAISE EXCEPTION 'TEST_FAILED: invalid unpaid item unexpectedly succeeded';
  EXCEPTION WHEN invalid_datetime_format THEN NULL;
  END;
END $$;

RESET ROLE;
SELECT test.assert((SELECT count(*)=0 FROM public.bank_reports), 'failed bank RPC retained parent');
SELECT test.assert((SELECT count(*)=0 FROM public.bank_facilities), 'failed bank RPC retained facility');
SELECT test.assert((SELECT count(*)=0 FROM public.deposits_not_cleared), 'failed bank RPC retained deposit');
SELECT test.assert((SELECT count(*)=0 FROM public.financial_write_commands), 'failed bank RPC retained command');
SET ROLE authenticated;

SELECT public.save_bank_report_atomic_v1(
  '10000000-0000-4000-8000-000000000003',
  '{"bank_name":"SYNTH OK","report_date":"2026-08-11","opening_balance":100,"closing_balance":90}',
  '[{"facility_type":"SYNTH","limit_amount":100,"used_amount":10,"available_amount":90}]',
  '[{"date_depot":"2026-08-10","date_valeur":null,"type_reglement":"VIREMENT","client_code":null,"reference":null,"montant":10}]',
  '[{"date_echeance":"2026-08-09","date_retour":null,"client_code":"SYNTH-1","description":null,"montant":10}]'
) AS id \gset bank_

RESET ROLE;
SELECT test.assert((SELECT count(*)=1 FROM public.bank_reports), 'bank parent missing');
SELECT test.assert((SELECT count(*)=1 FROM public.bank_facilities), 'bank facility missing');
SELECT test.assert((SELECT count(*)=1 FROM public.deposits_not_cleared), 'bank deposit missing');
SELECT test.assert((SELECT count(*)=1 FROM public.impayes), 'bank unpaid item missing');
SELECT test.assert((SELECT count(*)=1 FROM public.financial_write_commands WHERE result_id=:'bank_id'::uuid), 'bank command incomplete');
SET ROLE authenticated;

SELECT test.assert(
  public.save_bank_report_atomic_v1(
    '10000000-0000-4000-8000-000000000003',
    '{"bank_name":"SYNTH OK","report_date":"2026-08-11","opening_balance":100,"closing_balance":90}',
    '[{"facility_type":"SYNTH","limit_amount":100,"used_amount":10,"available_amount":90}]',
    '[{"date_depot":"2026-08-10","date_valeur":null,"type_reglement":"VIREMENT","client_code":null,"reference":null,"montant":10}]',
    '[{"date_echeance":"2026-08-09","date_retour":null,"client_code":"SYNTH-1","description":null,"montant":10}]'
  )=:'bank_id'::uuid,
  'bank retry returned another id'
);
RESET ROLE;
SELECT test.assert((SELECT count(*)=1 FROM public.bank_reports), 'bank retry duplicated parent');
SET ROLE authenticated;

DO $$ BEGIN
  BEGIN
    PERFORM public.save_bank_report_atomic_v1(
      '10000000-0000-4000-8000-000000000003',
      '{"bank_name":"SYNTH CHANGED","report_date":"2026-08-11","opening_balance":100,"closing_balance":90}',
      '[]','[]','[]'
    );
    RAISE EXCEPTION 'TEST_FAILED: changed command payload unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FINANCIAL_COMMAND_PAYLOAD_MISMATCH' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.save_fund_position_atomic_v1(
      '20000000-0000-4000-8000-000000000001',
      '{"report_date":"2026-08-11","total_fund_available":100,"collections_not_deposited":10,"grand_total":110,"deposit_for_day":null,"payment_for_day":null}',
      '[{"bank_name":"SYNTH","balance":100,"fund_applied":0,"net_balance":100,"non_validated_deposit":0,"grand_balance":100}]',
      '[{"hold_date":"NOT-A-DATE","cheque_number":null,"client_bank":null,"client_name":"SYNTH FAIL","facture_reference":null,"amount":10,"deposit_date":null,"days_remaining":null}]'
    );
    RAISE EXCEPTION 'TEST_FAILED: invalid hold unexpectedly succeeded';
  EXCEPTION WHEN invalid_datetime_format THEN NULL;
  END;
END $$;

RESET ROLE;
SELECT test.assert((SELECT count(*)=0 FROM public.fund_position), 'failed fund RPC retained parent');
SELECT test.assert((SELECT count(*)=0 FROM public.fund_position_detail), 'failed fund RPC retained detail');
SELECT test.assert((SELECT count(*)=0 FROM public.fund_position_hold), 'failed fund RPC retained hold');
SELECT test.assert((SELECT count(*)=1 FROM public.financial_write_commands), 'failed fund RPC retained command');
SET ROLE authenticated;

SELECT public.save_fund_position_atomic_v1(
  '20000000-0000-4000-8000-000000000002',
  '{"report_date":"2026-08-11","total_fund_available":100,"collections_not_deposited":10,"grand_total":110,"deposit_for_day":null,"payment_for_day":null}',
  '[{"bank_name":"SYNTH","balance":100,"fund_applied":0,"net_balance":100,"non_validated_deposit":0,"grand_balance":100}]',
  '[{"hold_date":"2026-08-11","cheque_number":null,"client_bank":null,"client_name":"SYNTH CLIENT","facture_reference":null,"amount":10,"deposit_date":null,"days_remaining":null}]'
) AS id \gset fund_

RESET ROLE;
SELECT test.assert((SELECT count(*)=1 FROM public.fund_position), 'fund parent missing');
SELECT test.assert((SELECT count(*)=1 FROM public.fund_position_detail), 'fund detail missing');
SELECT test.assert((SELECT count(*)=1 FROM public.fund_position_hold), 'fund hold missing');
SET ROLE authenticated;
SELECT test.assert(
  public.save_fund_position_atomic_v1(
    '20000000-0000-4000-8000-000000000002',
    '{"report_date":"2026-08-11","total_fund_available":100,"collections_not_deposited":10,"grand_total":110,"deposit_for_day":null,"payment_for_day":null}',
    '[{"bank_name":"SYNTH","balance":100,"fund_applied":0,"net_balance":100,"non_validated_deposit":0,"grand_balance":100}]',
    '[{"hold_date":"2026-08-11","cheque_number":null,"client_bank":null,"client_name":"SYNTH CLIENT","facture_reference":null,"amount":10,"deposit_date":null,"days_remaining":null}]'
  )=:'fund_id'::uuid,
  'fund retry returned another id'
);
RESET ROLE;
SELECT test.assert((SELECT count(*)=1 FROM public.fund_position), 'fund retry duplicated parent');

CREATE FUNCTION test.slow_concurrent_bank_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bank_name = 'SYNTH CONCURRENT' THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_slow_concurrent_bank_insert
BEFORE INSERT ON public.bank_reports
FOR EACH ROW EXECUTE FUNCTION test.slow_concurrent_bank_insert();

SELECT dblink_connect(
  'ops_core_2_c1',
  'host=127.0.0.1 dbname=postgres user=ops_test_manager options=''-c request.jwt.claim.sub=00000000-0000-0000-0000-000000000002'''
);
SELECT dblink_connect(
  'ops_core_2_c2',
  'host=127.0.0.1 dbname=postgres user=ops_test_manager options=''-c request.jwt.claim.sub=00000000-0000-0000-0000-000000000002'''
);

SELECT test.assert(
  dblink_send_query(
    'ops_core_2_c1',
    $concurrent$
      SELECT public.save_bank_report_atomic_v1(
        '30000000-0000-4000-8000-000000000001',
        '{"bank_name":"SYNTH CONCURRENT","report_date":"2026-08-12","opening_balance":50,"closing_balance":50}',
        '[]','[]','[]'
      )
    $concurrent$
  )=1,
  'first concurrent command was not dispatched'
);
SELECT test.assert(
  dblink_send_query(
    'ops_core_2_c2',
    $concurrent$
      SELECT public.save_bank_report_atomic_v1(
        '30000000-0000-4000-8000-000000000001',
        '{"bank_name":"SYNTH CONCURRENT","report_date":"2026-08-12","opening_balance":50,"closing_balance":50}',
        '[]','[]','[]'
      )
    $concurrent$
  )=1,
  'second concurrent command was not dispatched'
);

SELECT result_id FROM dblink_get_result('ops_core_2_c1') AS t(result_id uuid) \gset concurrent_1_
SELECT result_id FROM dblink_get_result('ops_core_2_c2') AS t(result_id uuid) \gset concurrent_2_

SELECT test.assert(
  :'concurrent_1_result_id'::uuid = :'concurrent_2_result_id'::uuid,
  'concurrent retries returned different ids'
);
SELECT test.assert(
  (SELECT count(*)=1 FROM public.bank_reports WHERE bank_name='SYNTH CONCURRENT'),
  'concurrent retries duplicated the bank report'
);
SELECT test.assert(
  (
    SELECT count(*)=1
    FROM public.financial_write_commands
    WHERE operation='SAVE_BANK_REPORT_V1'
      AND command_key='30000000-0000-4000-8000-000000000001'
      AND result_id=:'concurrent_1_result_id'::uuid
  ),
  'concurrent retries did not converge on one completed command'
);

SELECT dblink_disconnect('ops_core_2_c1');
SELECT dblink_disconnect('ops_core_2_c2');
DROP TRIGGER test_slow_concurrent_bank_insert ON public.bank_reports;
DROP FUNCTION test.slow_concurrent_bank_insert();

SELECT 'OPS_CORE_2_ATOMIC_SECURITY_PASS' AS result;
