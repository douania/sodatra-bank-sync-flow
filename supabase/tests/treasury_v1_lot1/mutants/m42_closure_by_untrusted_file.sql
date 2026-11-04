-- target: 40_balances.sql
-- Mutant (revue 3, P2-1) : un fichier à revoir ou non accepté prouve encore la clôture d'une journée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'JOIN trusted_exports te ON te.export_id = s2.export_id',
  'JOIN (SELECT a.id AS export_id, a.created_at AS export_ingested_at FROM public.daily_statement_export_attempts a) te ON te.export_id = s2.export_id');
