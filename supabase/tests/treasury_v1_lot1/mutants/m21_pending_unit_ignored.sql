-- target: 46_operational.sql
-- Mutant (P1-2b, R6) une journée disputée par une version en attente, en accord établi, est retenue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'OR coalesce(dc.pending, false)',
  'OR false');
