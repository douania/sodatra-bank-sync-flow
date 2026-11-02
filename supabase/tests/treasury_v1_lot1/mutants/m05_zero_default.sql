-- target: 40_balances.sql
-- Mutant : un solde indisponible devient zéro.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '''balance_at_date'', CASE WHEN c.status = ''AVAILABLE'' THEN c.balance_d::text END,',
  '''balance_at_date'', coalesce(CASE WHEN c.status = ''AVAILABLE'' THEN c.balance_d::text END, ''0.00''),');
