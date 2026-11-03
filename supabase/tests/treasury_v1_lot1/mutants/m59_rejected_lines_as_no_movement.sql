-- target: 46_operational.sql
-- Mutant (R6, arbitrage 11) une livraison écartée avec lignes admet l'absence de mouvement.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN coalesce(sd.rejected_n, 0) > 0 THEN ''UNPROVEN''',
  'WHEN false THEN ''UNPROVEN''');
