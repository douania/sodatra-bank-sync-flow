-- target: 46_operational.sql
-- Mutant (R6, C5) la révocation d'un point de départ est ignorée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHERE NOT v.revoked AND v.static_failure IS NULL',
  'WHERE v.static_failure IS NULL');
