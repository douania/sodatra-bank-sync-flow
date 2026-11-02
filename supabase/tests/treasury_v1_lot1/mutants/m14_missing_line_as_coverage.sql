-- target: 40_balances.sql
-- Mutant : l'absence de ligne suffit à couvrir une journée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  E'pe.closed_until) THEN ''NOMOV''\n           ELSE ''UNPROVEN''', E'pe.closed_until) THEN ''NOMOV''\n           ELSE ''NOMOV''');
