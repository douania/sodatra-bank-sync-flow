-- target: 40_balances.sql
-- Mutant (CTO P2) : la couverture ignore une ouverture ultérieure contradictoire.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND NOT (v.next_mismatch AND (v.only_nomov_between OR v.no_lines_between))', '');
