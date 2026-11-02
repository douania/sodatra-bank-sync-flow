-- target: 40_balances.sql
-- Mutant (CTO P1) : l'ouverture d'une journée disputée n'est plus contrôlée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'CASE WHEN c.unit_id IS NULL OR c.opening IS NULL THEN NULL', 'CASE WHEN c.kind NOT IN (''UNIT'', ''NOT_CLOSED'') OR c.opening IS NULL THEN NULL');
