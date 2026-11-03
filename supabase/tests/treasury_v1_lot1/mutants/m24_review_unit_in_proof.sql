-- target: 40_balances.sql
-- Mutant (P2-4) : un export dont une journée livrée est à revoir prouve ses journées.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'count(*) FILTER (WHERE NOT d.clean OR NOT (', 'count(*) FILTER (WHERE NOT (');
