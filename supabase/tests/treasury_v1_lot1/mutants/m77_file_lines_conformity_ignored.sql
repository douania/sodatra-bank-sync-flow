-- target: 46_operational.sql
-- Mutant (P1 de la contre-revue CTO de la PR #156) : une livraison aux lignes non
-- conformes reste propre ; son fichier redevient preuve de clôture.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'cardinality(a.residual) = 0 AND lo.lines_ok', 'cardinality(a.residual) = 0 AND true');
