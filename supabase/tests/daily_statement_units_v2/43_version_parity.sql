-- Lot 1 opérationnel, test différentiel : les règles de version de l'interface
-- (dailyV2Types : clé, cohérence, comparaison à trois issues), calculées par le
-- générateur, face aux fonctions du serveur sur les mêmes cas. Toute
-- divergence ferait refuser par le serveur (« STALE ») une décision affichée.
\set ON_ERROR_STOP on
SELECT tr_test.assert((SELECT count(*) FROM opx.version_parity) >= 1900, 'parité : cas générés');
SELECT tr_test.assert_eq((
  SELECT count(*)::text FROM opx.version_parity p
  WHERE public.daily_stmt_version_compare(p.wh, p.wa, p.wo, p.wc, p.wd, p.wk, p.rh, p.ra, p.ro, p.rc, p.rd, p.rk)
          IS DISTINCT FROM p.expected_comparison
     OR public.daily_stmt_version_key(p.wh, p.wa, p.wo, p.wc, p.wd, p.wk) IS DISTINCT FROM p.expected_key
     OR public.daily_stmt_version_coherent(p.wa, p.wo, p.wc, p.wd, p.wk) IS DISTINCT FROM p.expected_coherent),
  '0', 'parité : aucun écart entre l''interface et le serveur');
SELECT tr_test.assert((SELECT count(DISTINCT expected_comparison) FROM opx.version_parity) = 6,
  'parité : les six issues de comparaison sont couvertes');
SELECT tr_test.assert((SELECT count(DISTINCT expected_coherent) FROM opx.version_parity) = 2,
  'parité : versions cohérentes et incohérentes couvertes');
SELECT 'PASS 43_version_parity' AS marker;
