-- target: 46_operational.sql
-- Mutant (réserve CTO 4.1, F1 de la revue) : la propreté d'une livraison, donc la
-- dignité de preuve de son fichier, n'exige plus la cohérence financière.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '          AND public.daily_stmt_version_coherent(s.aggregates_status, s.opening_balance_derived,
                s.closing_balance_derived, s.day_total_debits, s.day_total_credits)) AS clean',
  '          AND true) AS clean');
