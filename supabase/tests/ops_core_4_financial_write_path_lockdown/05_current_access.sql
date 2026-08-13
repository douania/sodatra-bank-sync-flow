\set ON_ERROR_STOP on

ALTER TABLE public.bank_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits_not_cleared ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impayes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_hold ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.bank_reports,
  public.bank_facilities,
  public.deposits_not_cleared,
  public.impayes,
  public.fund_position,
  public.fund_position_detail,
  public.fund_position_hold
TO authenticated;

DO $policies$
DECLARE
  v_table text;
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
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_table || '_select',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      v_table || '_insert',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      v_table || '_update',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)',
      v_table || '_delete',
      v_table
    );
  END LOOP;
END
$policies$;

INSERT INTO public.bank_reports(
  id, bank_name, report_date, opening_balance, closing_balance
) VALUES (
  '00000000-0000-4000-8000-000000000410',
  'PRE-LOCKDOWN-SYNTH',
  DATE '2026-08-12',
  10,
  20
);
INSERT INTO public.bank_facilities(
  bank_report_id, facility_type, limit_amount, used_amount, available_amount
) VALUES (
  '00000000-0000-4000-8000-000000000410', 'SYNTH', 30, 10, 20
);
INSERT INTO public.deposits_not_cleared(
  bank_report_id, date_depot, type_reglement, montant
) VALUES (
  '00000000-0000-4000-8000-000000000410', DATE '2026-08-12', 'SYNTH', 40
);
INSERT INTO public.impayes(
  bank_report_id, date_echeance, client_code, montant
) VALUES (
  '00000000-0000-4000-8000-000000000410', DATE '2026-08-12', 'SYNTH', 50
);
INSERT INTO public.fund_position(
  id, report_date, total_fund_available, collections_not_deposited, grand_total
) VALUES (
  '00000000-0000-4000-8000-000000000420', DATE '2026-08-12', 60, 70, 130
);
INSERT INTO public.fund_position_detail(
  fund_position_id, bank_name, balance, fund_applied, net_balance,
  non_validated_deposit, grand_balance
) VALUES (
  '00000000-0000-4000-8000-000000000420', 'SYNTH', 80, 10, 70, 5, 75
);
INSERT INTO public.fund_position_hold(
  fund_position_id, hold_date, client_name, amount
) VALUES (
  '00000000-0000-4000-8000-000000000420', DATE '2026-08-12', 'SYNTH', 90
);
