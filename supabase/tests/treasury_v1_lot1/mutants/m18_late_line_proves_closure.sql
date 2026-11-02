-- target: 40_balances.sql
-- Mutant (N2) : une ligne datée après le dépôt du fichier prouve la clôture d'une journée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND s3.accounting_date <= (a2.created_at AT TIME ZONE ''Africa/Dakar'')::date', '');
