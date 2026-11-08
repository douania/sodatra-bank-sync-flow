-- D1, concurrence : amorçage de cinq courses à sessions réelles (validé).
--   C1 : la session A tient le verrou de journée avec le dépôt tardif, B promeut ;
--   C2 : la session A tient le verrou avec la promotion, B dépose le fichier tardif ;
--   C3 : deux dépôts tardifs identiques du même fichier sur une journée qui porte
--        une provisoire divergente vivante ;
--   C4 (correction C1 du verdict CTO, jouée avec la paire C1) : une première
--        réception du fichier tardif est déposée ; A le redépose deux fois et
--        tient le verrou ; B promeut ;
--   C5 (jouée avec la paire C2) : deux réceptions du fichier tardif sont
--        déposées ; A promeut et tient le verrou ; B le redépose une troisième fois.
\set ON_ERROR_STOP on

CREATE FUNCTION d1.race_cal() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"start": 1000, "days": {"2026-10-08": [["c", 20], ["c2", 4]], "2026-10-09": [["d", 5]]}}'::jsonb $$;
CREATE FUNCTION d1.race_file(p_account text, p_file text, p_to text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.mk(p_account, p_file, d1.days(d1.race_cal(), DATE '2026-10-08', p_to::date)) $$;
-- Correction ultérieure du 08 (opération x ajoutée), fichier du 08 au 12 reçu le
-- 22/10 : approbation groupée puis remplacement ; rend la lecture du 08.
CREATE FUNCTION d1.race_correct(p_account text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.dep(p_account || ':fix', d1.mk(p_account, 'fix', d1.days(
    '{"start": 1000, "days": {"2026-10-08": [["c", 20], ["c2", 4], ["x", 7]], "2026-10-09": [["d", 5]],
      "2026-10-10": [["e", 3]], "2026-10-11": [["f", 2]], "2026-10-12": [["g", 1]]}}'::jsonb,
    DATE '2026-10-08', DATE '2026-10-12')), d1.at('2026-10-22 17:00'));
  PERFORM d1.batch(p_account || ':fix', 'd1-race-fix-batch-' || p_account);
  PERFORM d1.supersede(p_account, '08/10/2026', p_account || ':fix');
  RETURN d1.read(p_account, '08/10/2026');
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA d1 TO authenticated;

-- C1 et C2 : fichier de clôture déposé (08 clos, 09 provisoire), non promu.
SELECT d1.account(c, 'ORA') FROM unnest(ARRAY['c1', 'c2']) c;
SELECT d1.dep(c || ':close', d1.race_file(c, 'close', '2026-10-09'), d1.at('2026-10-09 17:00')) FROM unnest(ARRAY['c1', 'c2']) c;
SELECT d1.put(c || ':day08', to_jsonb(d1.duid(c, '08/10/2026'))) FROM unnest(ARRAY['c1', 'c2']) c;

-- C3 : 08 retenu, provisoire divergente vivante.
SELECT d1.account('c3', 'ORA');
SELECT d1.dep('c3:close', d1.race_file('c3', 'close', '2026-10-09'), d1.at('2026-10-09 17:00'));
SELECT d1.promote('c3:close', '08/10/2026');
SELECT d1.dep('c3:div', d1.mk('c3', 'div', '[{"d": "08/10/2026", "o": 1000, "ops": [["c", 20]]}]'), d1.at('2026-10-10 12:00'));
SELECT d1.put('c3:div_snapshot', to_jsonb(d1.snapshot(d1.unit('c3:div', '08/10/2026'))));
SELECT d1.put('c3:day08', to_jsonb(d1.duid('c3', '08/10/2026')));

-- C4 et C5 : fichier de clôture déposé, non promu ; réceptions du fichier tardif
-- « bis » (sa dernière journée, le 08, est provisoire) avant la course.
SELECT d1.account(c, 'ORA') FROM unnest(ARRAY['c4', 'c5']) c;
SELECT d1.dep(c || ':close', d1.race_file(c, 'close', '2026-10-09'), d1.at('2026-10-09 17:00')) FROM unnest(ARRAY['c4', 'c5']) c;
SELECT d1.dep(c || ':bis1', d1.race_file(c, 'bis', '2026-10-08'), d1.at('2026-10-20 17:01')) FROM unnest(ARRAY['c4', 'c5']) c;
SELECT d1.dep('c5:bis2', d1.race_file('c5', 'bis', '2026-10-08'), d1.at('2026-10-20 17:02'));

SELECT tr_test.assert(d1.status(d1.unit('c1:close', '08/10/2026')) = 'staged' AND d1.status(d1.unit('c2:close', '08/10/2026')) = 'staged'
  AND d1.status(d1.unit('c3:div', '08/10/2026')) = 'provisional' AND d1.live('c3', '08/10/2026') = 1,
  '46a : état initial des courses C1 à C3');
SELECT tr_test.assert(d1.status(d1.unit('c4:close', '08/10/2026')) = 'staged' AND d1.status(d1.unit('c5:close', '08/10/2026')) = 'staged'
  AND d1.status(d1.unit('c4:bis1', '08/10/2026')) = 'provisional' AND d1.status(d1.unit('c5:bis1', '08/10/2026')) = 'provisional'
  AND d1.status(d1.unit('c5:bis2', '08/10/2026')) = 'duplicate'
  AND d1.ev(d1.unit('c5:bis2', '08/10/2026'), 'unit_duplicate', 'provisional_redeposit_duplicate') = 1,
  '46a : état initial des courses C4 et C5 (provisoire tardive ; doublon R1-provisional en C5)');
SELECT 'PASS 46a_d1_race_setup' AS marker;
