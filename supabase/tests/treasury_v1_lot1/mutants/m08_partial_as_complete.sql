-- target: 45_consolidation.sql
-- Mutant : un sous-total partiel est présenté comme complet.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)', 'ELSE ''PARTIAL'' END,', 'ELSE ''COMPLETE'' END,');
