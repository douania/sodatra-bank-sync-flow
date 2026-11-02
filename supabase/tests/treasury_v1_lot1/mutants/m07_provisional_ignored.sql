-- target: 40_balances.sql
-- Mutant : une journée provisoire n'est plus signalée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN ''PROVISIONAL'' THEN ''PROVISIONAL_DAY''', 'WHEN ''PROVISIONAL'' THEN NULL');
