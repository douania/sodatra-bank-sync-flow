-- target: 46_operational.sql
-- Mutant (R6, C5) la journée du point garde sa transition incertaine.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'ELSE ''VERIFIED_START'' END',
  'ELSE w.transition END');
