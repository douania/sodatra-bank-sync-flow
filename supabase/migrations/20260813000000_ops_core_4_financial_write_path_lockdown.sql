BEGIN;

-- OPS-CORE-4: authenticated clients must persist these financial aggregates
-- exclusively through the two audited OPS-CORE-2 SECURITY DEFINER RPCs.
-- Read policies and service_role privileges remain unchanged.
DO $lockdown$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'bank_reports',
        'bank_facilities',
        'deposits_not_cleared',
        'impayes',
        'fund_position',
        'fund_position_detail',
        'fund_position_hold'
      ])
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END
$lockdown$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.bank_reports,
  public.bank_facilities,
  public.deposits_not_cleared,
  public.impayes,
  public.fund_position,
  public.fund_position_detail,
  public.fund_position_hold
FROM authenticated;

COMMENT ON FUNCTION public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb) IS
  'Exclusive authenticated write path for bank reports and their financial child rows.';
COMMENT ON FUNCTION public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb) IS
  'Exclusive authenticated write path for fund positions and their financial child rows.';

COMMIT;
