-- target: 46_operational.sql
-- Mutant (P2 de la contre-revue CTO de la PR #156) : une réfutation dont une
-- source n'est plus couverte reste affichée comme effective.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN coalesce(un.uncovered_n, 0) > 0 THEN ''PARTIAL''', 'WHEN false THEN ''PARTIAL''');
