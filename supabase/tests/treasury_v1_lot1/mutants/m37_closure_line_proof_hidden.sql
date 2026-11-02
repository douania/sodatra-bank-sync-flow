-- target: 40_balances.sql
-- Mutant (CTO P2) : le fichier ultérieur qui prouve la clôture n'est plus rendu.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN c.source_role_d = ''CLOSING'' AND c.closure_basis_d = ''LATER_LINE'' THEN', 'WHEN false THEN');
