-- target: 46_operational.sql
-- Mutant (R6, point F) la fraîcheur de la livraison adoptée n'est pas exigée.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['OR coalesce(te.last_line_day > sm.last_first_seen_day, false)) AS effective',
        'AND NOT coalesce(te.last_line_day > (sf.first_seen_at AT TIME ZONE ''Africa/Dakar'')::date, false)) AS effective'],
  ARRAY['OR true) AS effective', 'AND false) AS effective']);
