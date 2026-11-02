-- target: 40_balances.sql
-- Mutant (revue 3, P2-3) : les périodes qui portent une clôture confirmée par l'ouverture suivante ne sont plus rendues.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'c.source_role_d = ''CLOSING'' AND c.closure_basis_d = ''NEXT_OPENING''),', 'false),');
