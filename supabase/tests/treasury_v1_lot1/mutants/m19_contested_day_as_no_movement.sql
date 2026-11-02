-- target: 40_balances.sql
-- Mutant (P1-2b) : une journée livrée mais non retenue est réputée sans mouvement.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN sd.has_live THEN ''CONTESTED''', 'WHEN false THEN ''CONTESTED''');
