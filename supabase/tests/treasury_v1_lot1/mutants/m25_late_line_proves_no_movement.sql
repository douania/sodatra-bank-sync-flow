-- target: 40_balances.sql
-- Mutant (N2) : une ligne datée après le dépôt du fichier prouve l'absence de mouvement.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['FILTER (WHERE d.day <= (x.export_ingested_at AT TIME ZONE ''Africa/Dakar'')::date)',
        'FILTER (WHERE d.day <= (a.export_ingested_at AT TIME ZONE ''Africa/Dakar'')::date)'],
  ARRAY['FILTER (WHERE true)', 'FILTER (WHERE true)']);
