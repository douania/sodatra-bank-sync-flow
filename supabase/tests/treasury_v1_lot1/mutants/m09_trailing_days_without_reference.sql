-- target: 40_balances.sql
-- Mutant : toute la période déclarée est réputée close, même après la dernière ligne.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'coalesce(eu.last_line_day, a.export_period_start) - 1', 'a.export_period_end');
