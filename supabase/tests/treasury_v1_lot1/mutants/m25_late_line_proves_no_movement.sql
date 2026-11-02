-- target: 40_balances.sql
-- Mutant (N2) : une ligne datée après le dépôt du fichier prouve l'absence de mouvement.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'FILTER (WHERE s.accounting_date <= (a.created_at AT TIME ZONE ''Africa/Dakar'')::date)', 'FILTER (WHERE true)');
