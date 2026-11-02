-- target: 40_balances.sql
-- Mutant (revue 4, P3-2) : une unité sans solde dérivable, qui ne se résoudra pas, bloque l'ancrage suivant.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '''UNIT_REVIEW'', ''UNIT_UNSUPPORTED''))', '''UNIT_REVIEW'', ''UNIT_UNSUPPORTED'', ''UNIT_NO_BALANCE''))');
