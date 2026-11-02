-- target: 40_balances.sql
-- Mutant (revue 3, P3-1) : une période qui ne prouve aucune journée est rendue comme preuve.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHERE pe.rid = c.rid AND pe.closed_until >= pe.p_start', 'WHERE pe.rid = c.rid');
