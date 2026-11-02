-- target: 40_balances.sql
-- Mutant : toute la période déclarée est réputée close, même après la dernière ligne.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'coalesce(te.last_line_day, te.export_period_start) - 1', 'te.export_period_end');
