-- target: 46_operational.sql
-- Mutant (R6) l'ouverture d'une livraison écartée sort des ouvertures connues.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHERE d.opening IS NOT NULL AND d.status <> ''superseded'' AND NOT coalesce(c.covered, false)',
  'WHERE d.opening IS NOT NULL AND d.status NOT IN (''superseded'', ''rejected'') AND NOT coalesce(c.covered, false)');
