-- target: 46_operational.sql
-- Mutant (R6, point F) l'adoption fraîche ne réfute plus la version remplacée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'OR EXISTS (SELECT 1 FROM auto_eff ae',
  'OR false AND EXISTS (SELECT 1 FROM auto_eff ae');
