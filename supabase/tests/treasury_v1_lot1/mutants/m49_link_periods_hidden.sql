-- target: 40_balances.sql
-- Mutant (revue 3, P3-2) : les périodes qui portent la clôture comparée à l'ouverture ne sont plus rendues.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'c.source_link_d IN (''OK'', ''BREAK''))) r(lo, hi, used)', 'false)) r(lo, hi, used)');
