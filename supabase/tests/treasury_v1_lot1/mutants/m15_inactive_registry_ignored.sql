-- target: 40_balances.sql
-- Mutant : un compte du registre désactivé n'est plus signalé.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND i.registry_status <> ''active'' THEN ''REGISTRY_ACCOUNT_INACTIVE''', 'AND false THEN ''REGISTRY_ACCOUNT_INACTIVE''');
