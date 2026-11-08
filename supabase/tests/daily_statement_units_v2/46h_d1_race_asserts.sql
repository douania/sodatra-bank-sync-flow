-- D1, concurrence : issues et état final des cinq courses.
\set ON_ERROR_STOP on

-- C1 : promotion bloquée par le dépôt, puis retrait à l'activation.
SELECT tr_test.assert(d1.status(d1.unit('c1:old', '08/10/2026')) = 'superseded'
  AND (d1.d1_event(d1.unit('c1:old', '08/10/2026'))).safe_details ->> 'resolution' = 'retired_at_activation'
  AND (d1.d1_event(d1.unit('c1:old', '08/10/2026'))).canonical_unit_id = d1.canon('c1', '08/10/2026')
  AND d1.nlines(d1.unit('c1:old', '08/10/2026')) = 2 AND d1.live('c1', '08/10/2026') = 0,
  '46h C1 : la promotion attend le dépôt, puis retire la provisoire identique (lignes conservées)');
-- C2 : dépôt bloqué par la promotion, puis retrait au dépôt.
SELECT tr_test.assert(d1.reply('c2:old', '08/10/2026') ->> 'unit_status' = 'superseded'
  AND (d1.d1_event(d1.unit('c2:old', '08/10/2026'))).safe_details ->> 'resolution' = 'retired_at_deposit_lines_stored'
  AND d1.nlines(d1.unit('c2:old', '08/10/2026')) = 2 AND d1.live('c2', '08/10/2026') = 0,
  '46h C2 : le dépôt attend la promotion, puis se retire');
-- C1 = C2 : même état final, mêmes sources, même lecture.
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_units_canonical WHERE day_unit_id = d1.duid(c, '08/10/2026')
  AND status = 'ingested') = 1, '46h ' || c || ' : un seul canonical actif') FROM unnest(ARRAY['c1', 'c2']) c;
SELECT tr_test.assert_eq(
  (SELECT jsonb_agg(x - 'raw_text_hash' - 'account_registry_id') FROM jsonb_array_elements(
     d1.sources(d1.duid('c1', '08/10/2026'), d1.cvkey(d1.canon('c1', '08/10/2026')))) x)::text,
  (SELECT jsonb_agg(x - 'raw_text_hash' - 'account_registry_id') FROM jsonb_array_elements(
     d1.sources(d1.duid('c2', '08/10/2026'), d1.cvkey(d1.canon('c2', '08/10/2026')))) x)::text,
  '46h : mêmes sources de la version retenue');
SELECT tr_test.assert_eq(d1.strip(d1.read('c1', '08/10/2026'))::text, d1.strip(d1.read('c2', '08/10/2026'))::text,
  '46h : même lecture du 08 quel que soit l''ordre');
SELECT tr_test.assert(d1.read('c1', '08/10/2026') ->> 'status' = 'AVAILABLE', '46h : le 08 est disponible');
-- C3 : les deux dépôts identiques retirés, une seule copie, divergente intacte.
SELECT tr_test.assert(d1.status(d1.unit('c3:twin_a', '08/10/2026')) = 'superseded'
  AND d1.status(d1.unit('c3:twin_b', '08/10/2026')) = 'superseded'
  AND d1.nlines(d1.unit('c3:twin_a', '08/10/2026')) = 2 AND d1.nlines(d1.unit('c3:twin_b', '08/10/2026')) = 0
  AND (d1.d1_event(d1.unit('c3:twin_b', '08/10/2026'))).safe_details ->> 'resolution' = 'retired_at_deposit_lines_not_restaged',
  '46h C3 : deux retraits, une seule copie des lignes (la seconde voit la copie validée)');
SELECT tr_test.assert(d1.snapshot(d1.unit('c3:div', '08/10/2026')) = d1.get('c3:div_snapshot') #>> '{}'
  AND d1.d1_events(d1.unit('c3:div', '08/10/2026')) = 0 AND d1.live('c3', '08/10/2026') = 1,
  '46h C3 : la divergente reste seule vivante, inchangée, sans événement');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM public.daily_statement_units_staging
  WHERE status = 'provisional' AND day_unit_id IN (d1.duid('c1', '08/10/2026'), d1.duid('c2', '08/10/2026'))),
  '46h : aucune provisoire vivante restante en C1 et C2');

-- C4 : la promotion attend les deux redépôts de A, puis retire la provisoire
-- (lignes conservées) et les deux doublons R1-provisional (sans lignes).
SELECT tr_test.assert(
  (SELECT bool_and(d1.status(d1.unit('c4:' || k, '08/10/2026')) = 'superseded'
                   AND d1.d1_events(d1.unit('c4:' || k, '08/10/2026')) = 1
                   AND (d1.d1_event(d1.unit('c4:' || k, '08/10/2026'))).canonical_unit_id = d1.canon('c4', '08/10/2026')
                   AND (d1.d1_event(d1.unit('c4:' || k, '08/10/2026'))).safe_details ->> 'resolution'
                       = CASE k WHEN 'bis1' THEN 'retired_at_activation' ELSE 'provisional_duplicate_retired_at_activation' END
                   AND d1.nlines(d1.unit('c4:' || k, '08/10/2026')) = CASE k WHEN 'bis1' THEN 2 ELSE 0 END)
   FROM unnest(ARRAY['bis1', 'bis2', 'bis3']) k)
  AND (SELECT bool_and(d1.ev(d1.unit('c4:' || k, '08/10/2026'), 'unit_duplicate', 'provisional_redeposit_duplicate') = 1)
       FROM unnest(ARRAY['bis2', 'bis3']) k),
  '46h C4 : la promotion attend les redépôts, puis retire la provisoire et les deux doublons R1-provisional');
-- C5 : le redépôt attend la promotion de A, puis se retire sans nouvelle copie ;
-- A a retiré la provisoire et le doublon déposés en amorçage.
SELECT tr_test.assert(d1.reply('c5:bis3', '08/10/2026') ->> 'unit_status' = 'superseded'
  AND (SELECT bool_and(d1.status(d1.unit('c5:' || k, '08/10/2026')) = 'superseded'
                       AND d1.d1_events(d1.unit('c5:' || k, '08/10/2026')) = 1
                       AND (d1.d1_event(d1.unit('c5:' || k, '08/10/2026'))).safe_details ->> 'resolution'
                           = CASE k WHEN 'bis1' THEN 'retired_at_activation' WHEN 'bis2' THEN 'provisional_duplicate_retired_at_activation'
                                    ELSE 'retired_at_deposit_lines_not_restaged' END
                       AND d1.nlines(d1.unit('c5:' || k, '08/10/2026')) = CASE k WHEN 'bis1' THEN 2 ELSE 0 END)
       FROM unnest(ARRAY['bis1', 'bis2', 'bis3']) k),
  '46h C5 : le redépôt attend la promotion, puis se retire sans copie ; provisoire et doublon retirés à l''activation');
-- C4 = C5 : mêmes statuts, mêmes volumes, une seule source, même lecture, avant
-- et après une correction ultérieure (le doublon résiduel la bloquerait).
SELECT tr_test.assert(d1.live(c, '08/10/2026') = 0 AND d1.day_lines(c, '08/10/2026') = 4
  AND jsonb_array_length(d1.sources(d1.duid(c, '08/10/2026'), d1.cvkey(d1.canon(c, '08/10/2026')))) = 1
  AND d1.sources(d1.duid(c, '08/10/2026'), d1.cvkey(d1.canon(c, '08/10/2026'))) -> 0 ->> 'raw_text_hash' = d1.hex64('file|' || c || '|close'),
  '46h ' || c || ' : aucune provisoire vivante, volume du 08 = 4, une seule source (fichier de clôture)')
FROM unnest(ARRAY['c4', 'c5']) c;
SELECT tr_test.assert_eq(d1.strip(d1.read('c4', '08/10/2026'))::text, d1.strip(d1.read('c5', '08/10/2026'))::text,
  '46h : C4 et C5, même lecture du 08 quel que soit l''ordre');
SELECT tr_test.assert(d1.read('c4', '08/10/2026') ->> 'status' = 'AVAILABLE', '46h : C4 et C5, le 08 est disponible');
SELECT d1.put(c || ':after_fix', d1.race_correct(c)) FROM unnest(ARRAY['c4', 'c5']) c;
SELECT tr_test.assert((d1.get(c || ':after_fix') ->> 'status') = 'AVAILABLE',
  '46h ' || c || ' : correction ultérieure du 08 acceptée (disponible)') FROM unnest(ARRAY['c4', 'c5']) c;
SELECT tr_test.assert_eq(d1.strip(d1.get('c4:after_fix'))::text, d1.strip(d1.get('c5:after_fix'))::text,
  '46h : C4 et C5, même lecture du 08 après correction');
SELECT 'PASS 46h_d1_race_asserts' AS marker;
