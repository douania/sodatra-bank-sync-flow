\set ON_ERROR_STOP on

DO $data_unchanged$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'bank_reports',
    'bank_facilities',
    'deposits_not_cleared',
    'impayes',
    'fund_position',
    'fund_position_detail',
    'fund_position_hold'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
    PERFORM test.assert(v_count = 1, v_table || ' rows changed during lockdown migration');
  END LOOP;
END
$data_unchanged$;

SELECT test.assert(
  count(*) = 7,
  'all seven financial tables must retain an authenticated SELECT policy'
)
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY[
    'bank_reports', 'bank_facilities', 'deposits_not_cleared', 'impayes',
    'fund_position', 'fund_position_detail', 'fund_position_hold'
  ])
  AND cmd = 'SELECT';

SELECT test.assert(
  count(*) = 0,
  'no direct authenticated write policy may remain on financial tables'
)
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY[
    'bank_reports', 'bank_facilities', 'deposits_not_cleared', 'impayes',
    'fund_position', 'fund_position_detail', 'fund_position_hold'
  ])
  AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

SELECT test.assert(
  bool_and(has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')),
  'authenticated SELECT must remain granted on all seven financial tables'
)
FROM unnest(ARRAY[
  'bank_reports', 'bank_facilities', 'deposits_not_cleared', 'impayes',
  'fund_position', 'fund_position_detail', 'fund_position_hold'
]) AS tables(table_name);

SELECT test.assert(
  bool_and(NOT has_table_privilege(
    'authenticated',
    'public.' || table_name,
    privilege_name
  )),
  'authenticated direct write privileges must be revoked on all seven tables'
)
FROM unnest(ARRAY[
  'bank_reports', 'bank_facilities', 'deposits_not_cleared', 'impayes',
  'fund_position', 'fund_position_detail', 'fund_position_hold'
]) AS tables(table_name)
CROSS JOIN unnest(ARRAY[
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
]) AS privileges(privilege_name);

SELECT test.assert(
  has_function_privilege(
    'authenticated',
    'public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated must retain bank-report RPC execution'
);
SELECT test.assert(
  has_function_privilege(
    'authenticated',
    'public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated must retain fund-position RPC execution'
);

DO $direct_insert_blocked$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SET LOCAL ROLE ops_test_manager;
  BEGIN
    INSERT INTO public.bank_reports(
      bank_name, report_date, opening_balance, closing_balance
    ) VALUES ('DIRECT-BLOCKED', DATE '2026-08-13', 1, 2);
    RAISE EXCEPTION 'DIRECT_INSERT_UNEXPECTEDLY_SUCCEEDED';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$direct_insert_blocked$;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);

SET ROLE ops_test_manager;

SELECT public.save_bank_report_atomic_v1(
  '00000000-0000-4000-8000-000000000401',
  '{"bank_name":"RPC-ONLY","report_date":"2026-08-13","opening_balance":1,"closing_balance":2}',
  '[]',
  '[]',
  '[]'
) AS locked_bank_report_id \gset

SELECT test.assert(
  EXISTS (
    SELECT 1 FROM public.bank_reports
    WHERE id = :'locked_bank_report_id'::uuid
      AND bank_name = 'RPC-ONLY'
  ),
  'the SECURITY DEFINER bank-report RPC must still persist atomically'
);

SELECT public.save_fund_position_atomic_v1(
  '00000000-0000-4000-8000-000000000402',
  '{"report_date":"2026-08-13","total_fund_available":1,"collections_not_deposited":2,"grand_total":3,"deposit_for_day":null,"payment_for_day":null}',
  '[]',
  '[]'
) AS locked_fund_position_id \gset

SELECT test.assert(
  EXISTS (
    SELECT 1 FROM public.fund_position
    WHERE id = :'locked_fund_position_id'::uuid
      AND grand_total = 3
  ),
  'the SECURITY DEFINER fund-position RPC must still persist atomically'
);

RESET ROLE;

BEGIN;
  INSERT INTO public.bank_reports(
    bank_name, report_date, opening_balance, closing_balance
  ) VALUES ('ROLLBACK-SYNTH', DATE '2026-08-13', 10, 20);
ROLLBACK;

SELECT test.assert(
  NOT EXISTS (SELECT 1 FROM public.bank_reports WHERE bank_name = 'ROLLBACK-SYNTH'),
  'transaction rollback must preserve the pre-test data state'
);
