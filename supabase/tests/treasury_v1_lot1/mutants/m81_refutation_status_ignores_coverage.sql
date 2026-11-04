-- target: 46_operational.sql
-- Mutant (revue indépendante de la correction P2) : une source couverte par
-- l'adoption ou une autre réfutation effective est comptée non couverte.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  '    WHERE NOT c.covered
      AND NOT EXISTS (SELECT 1 FROM public.daily_statement_refutation_sources rs
                      WHERE rs.refutation_id = r2.id AND rs.raw_text_hash = c.raw_text_hash',
  '    WHERE true
      AND NOT EXISTS (SELECT 1 FROM public.daily_statement_refutation_sources rs
                      WHERE rs.refutation_id = r2.id AND rs.raw_text_hash = c.raw_text_hash');
