-- target: 40_balances.sql
-- Mutant (CTO P2) : l'unité suivante qui confirme la clôture n'est plus rendue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN c.source_role_d = ''CLOSING'' AND c.closure_basis_d = ''NEXT_OPENING'' THEN', 'WHEN false THEN');
