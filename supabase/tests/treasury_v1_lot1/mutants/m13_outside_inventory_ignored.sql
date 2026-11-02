-- target: 40_balances.sql
-- Mutant : les comptes du registre hors inventaire ne sont plus comptés.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '(SELECT count(*) FROM unlisted u WHERE u.currency = ''XOF''', '(SELECT 0 * count(*) FROM unlisted u WHERE u.currency = ''XOF''');
