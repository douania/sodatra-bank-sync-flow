-- D1 : règles du dépôt par l'enveloppe réelle pre_ingest_daily_statement_units
-- (matrice V1 à V20 du cadrage R2, réserves CTO R1 à R4, V21 à V24 de la revue
-- indépendante, V25 et V26 des corrections C1 et C2, V27 et V28 de leur
-- contre-revue, V29 et W8 à W9 de la version d'analyse et du retrait au dépôt)
-- et mordants M1 à M23.
-- Chaque scénario est une fonction paramétrée par une étiquette : il crée son
-- propre compte, ce qui permet de le rejouer à l'identique sous une mutation.
-- Transaction annulée en fin de suite.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION d1.ok(p_condition boolean, p_label text) RETURNS void LANGUAGE sql AS $$
  SELECT tr_test.assert(p_condition, '45b ' || p_label) $$;
-- Nombre d'occurrences d'un fragment dans un texte (gardes structurelles).
CREATE FUNCTION d1.occ(p_text text, p_fragment text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT (length(p_text) - length(replace(p_text, p_fragment, ''))) / length(p_fragment) $$;

-- Historique de base ORABANK : journées du 05 et du 06 retenues, 07 provisoire
-- vivante. Le 06 porte des centimes (échelle numérique, V5).
CREATE FUNCTION d1.day05() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"d": "05/10/2026", "o": 900, "ops": [["z", 100]]}'::jsonb $$;
CREATE FUNCTION d1.day06(p_variant jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"d": "06/10/2026", "o": 1000.00, "ops": [["a", 100.50], ["b", -30.25]]}'::jsonb || p_variant $$;
CREATE FUNCTION d1.day07() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"d": "07/10/2026", "o": 1070.25, "ops": [["c", 50]]}'::jsonb $$;
CREATE FUNCTION d1.base(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fa', d1.mk(p_tag, 'fa', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())),
    d1.at('2026-10-07 17:00'));
  PERFORM d1.promote(p_tag || ':fa', '05/10/2026');
  PERFORM d1.promote(p_tag || ':fa', '06/10/2026');
END $$;
-- Fichier ancien reçu en retard : 05 et 06, le 06 étant sa dernière journée.
CREATE FUNCTION d1.late(p_tag text, p_file text, p_day06 jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.mk(p_tag, p_file, jsonb_build_array(d1.day05(), d1.day06(p_day06))) $$;

-- --------------------------------------------------------------------------
-- V1 : fichier tardif, dernière journée identique (ORABANK).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.v1(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; c uuid; e public.daily_statement_import_events;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late'), d1.at('2026-10-12 17:00'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  c := d1.canon(p_tag, '06/10/2026');
  PERFORM d1.ok(d1.reply(p_tag || ':late', '06/10/2026') ->> 'unit_status' = 'superseded'
    AND (d1.reply(p_tag || ':late', '06/10/2026') ->> 'active_canonical_unit_id')::uuid = c,
    'V1 : réponse superseded rattachée au canonical actif');
  PERFORM d1.ok(d1.status(u) = 'superseded', 'V1 : livraison retirée');
  PERFORM d1.ok(d1.nlines(u) = 2, 'V1 : lignes de la première copie du fichier stockées');
  PERFORM d1.ok((SELECT count(*) = 1 AND bool_and(canonical_unit_id = c AND new_status = 'provisional')
    FROM public.daily_statement_import_events WHERE staging_unit_id = u AND event_type = 'unit_provisional_held'),
    'V1 : réception tracée (unit_provisional_held, canonical désigné)');
  e := d1.d1_event(u);
  PERFORM d1.ok(e.event_type = 'status_changed' AND e.previous_status = 'provisional' AND e.new_status = 'superseded'
    AND e.canonical_unit_id = c AND e.attempt_id = d1.attempt(p_tag || ':late')
    AND e.safe_details ->> 'resolution' = 'retired_at_deposit_lines_stored' AND d1.d1_events(u) = 1,
    'V1 : retrait audité (motif D1, canonical, tentative, lignes stockées)');
  PERFORM d1.ok(d1.live(p_tag, '06/10/2026') = 0, 'V1 : aucune provisoire vivante le 06');
  PERFORM d1.ok(d1.reply(p_tag || ':late', '05/10/2026') ->> 'unit_status' = 'duplicate'
    AND d1.nlines(d1.unit(p_tag || ':late', '05/10/2026')) = 0
    AND d1.d1_events(d1.unit(p_tag || ':late', '05/10/2026')) = 0, 'V1 : la journée close du 05 reste un doublon R1');
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':fa', '07/10/2026')) = 'provisional'
    AND d1.d1_events(d1.unit(p_tag || ':fa', '07/10/2026')) = 0, 'V1 : la provisoire du 07 (autre journée) est intacte');
  PERFORM tr_test.as_user('t_admin');
  PERFORM tr_test.expect_error(format('SELECT public.promote_daily_statement_unit(%L::uuid)', u), 'DAILY_STMT_PROMOTE_GATE');
  PERFORM d1.reset();
END $$;

-- V2 : mêmes mouvements, soldes différents -> provisoire vivante.
CREATE FUNCTION d1.v2(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late', '{"o": 1001.00}'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.live(p_tag, '06/10/2026') = 1
    AND (SELECT day_content_hash FROM public.daily_statement_units_staging WHERE id = u)
        = (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE id = d1.canon(p_tag, '06/10/2026')),
    'V2 : mêmes mouvements, soldes différents : provisoire vivante');
END $$;

-- V3 : journée partielle (mouvements différents) -> provisoire vivante (Q3).
CREATE FUNCTION d1.v3(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late', '{"ops": [["a", 100.50]]}'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.live(p_tag, '06/10/2026') = 1,
    'V3 : journée partielle : provisoire vivante');
END $$;

-- V4 : version « unavailable » identique retirée ; unavailable contre derived : vivante.
CREATE FUNCTION d1.v4(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; w uuid;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fu', d1.mk(p_tag, 'fu', '[{"d": "10/10/2026", "agg": "unavailable", "ops": [["e", 10], ["f", 5]]},
    {"d": "11/10/2026", "o": 0, "ops": [["g", 1]]}]'));
  PERFORM d1.promote(p_tag || ':fu', '10/10/2026', 'Approbation synthetique sans soldes D1');
  PERFORM d1.ok((SELECT aggregates_status = 'unavailable' AND opening_balance_derived IS NULL
    FROM public.daily_statement_units_canonical WHERE id = d1.canon(p_tag, '10/10/2026')), 'V4 : canonical sans soldes');
  PERFORM d1.dep(p_tag || ':lu', d1.mk(p_tag, 'lu', '[{"d": "10/10/2026", "agg": "unavailable", "ops": [["e", 10], ["f", 5]]}]'));
  u := d1.unit(p_tag || ':lu', '10/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.d1_events(u) = 1
    AND (SELECT opening_balance_derived IS NULL AND closing_balance_derived IS NULL
         FROM public.daily_statement_units_staging WHERE id = u), 'V4 : unavailable identique retirée, aucun solde inventé');
  PERFORM d1.dep(p_tag || ':ld', d1.mk(p_tag, 'ld', '[{"d": "10/10/2026", "o": 500, "ops": [["e", 10], ["f", 5]]}]'));
  w := d1.unit(p_tag || ':ld', '10/10/2026');
  PERFORM d1.ok(d1.status(w) = 'provisional' AND d1.d1_events(w) = 0, 'V4 : derived contre unavailable : provisoire vivante');
END $$;

-- V5 : montants à échelle réduite (10.5 contre 10.50) -> retirée (mordant M5).
CREATE FUNCTION d1.v5(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p jsonb; u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  p := d1.trimmed(d1.late(p_tag, 'late'));
  PERFORM d1.ok(p -> 'units' -> 1 ->> 'day_total_credits' = '100.5' AND p -> 'units' -> 1 ->> 'opening_balance_derived' = '1000'
    AND (SELECT day_total_credits::text FROM public.daily_statement_units_canonical WHERE id = d1.canon(p_tag, '06/10/2026')) = '100.50',
    'V5 : la charge porte 100.5 et 1000, la version retenue 100.50 et 1000.00');
  PERFORM d1.dep(p_tag || ':late', p);
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.d1_events(u) = 1, 'V5 : égalité numérique : retirée');
END $$;

-- V6 : version identique mais incohérente -> provisoire vivante.
CREATE FUNCTION d1.v6(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; c uuid;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fi', d1.mk(p_tag, 'fi', '[{"d": "12/10/2026", "o": 100, "ops": [["g", 10]], "fix": {"closing_balance_derived": 999}},
    {"d": "13/10/2026", "o": 0, "ops": [["h", 1]]}]'));
  PERFORM d1.promote(p_tag || ':fi', '12/10/2026');
  c := d1.canon(p_tag, '12/10/2026');
  PERFORM d1.ok((SELECT NOT public.daily_stmt_version_coherent(aggregates_status, opening_balance_derived, closing_balance_derived,
    day_total_debits, day_total_credits) FROM public.daily_statement_units_canonical WHERE id = c), 'V6 : version retenue incohérente');
  PERFORM d1.dep(p_tag || ':li', d1.mk(p_tag, 'li', '[{"d": "12/10/2026", "o": 100, "ops": [["g", 10]], "fix": {"closing_balance_derived": 999}}]'));
  u := d1.unit(p_tag || ':li', '12/10/2026');
  PERFORM d1.ok(d1.vkey(u) = d1.cvkey(c) AND d1.status(u) = 'provisional' AND d1.d1_events(u) = 0,
    'V6 : même version, incohérente : provisoire vivante');
END $$;

-- V7 : faits identiques, lignes non conformes -> provisoire vivante (mordant M3).
CREATE FUNCTION d1.v7(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late', '{"run": "flat"}'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok(d1.vkey(u) = d1.cvkey(d1.canon(p_tag, '06/10/2026')) AND NOT public.daily_stmt_staging_lines_conform(u),
    'V7 : faits identiques, lignes non conformes');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.live(p_tag, '06/10/2026') = 1,
    'V7 : lignes non conformes : provisoire vivante');
END $$;

-- V8 : une divergente vivante, puis une identique tardive (réserve CTO R3).
CREATE FUNCTION d1.v8(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid; u uuid; v_snap text; v_events integer;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':div', d1.late(p_tag, 'div', '{"ops": [["a", 100.50]]}'));
  d := d1.unit(p_tag || ':div', '06/10/2026');
  v_snap := d1.snapshot(d);
  SELECT count(*) INTO v_events FROM public.daily_statement_import_events WHERE staging_unit_id = d;
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.d1_events(u) = 1, 'V8 : identique retirée');
  PERFORM d1.ok(d1.snapshot(d) = v_snap AND d1.status(d) = 'provisional', 'V8 : divergente intacte (identifiant, statut, faits, lignes)');
  PERFORM d1.ok((SELECT count(*) FROM public.daily_statement_import_events WHERE staging_unit_id = d) = v_events
    AND d1.d1_events(d) = 0, 'V8 : aucun événement ne vise la divergente');
  PERFORM d1.ok(d1.live(p_tag, '06/10/2026') = 1, 'V8 : la divergente reste la seule vivante');
END $$;

-- V9 : provisoire identique héritée (déposée sans D1), puis identique tardive : les deux retirées.
CREATE FUNCTION d1.v9(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h uuid; u uuid; e public.daily_statement_import_events;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.legacy_deposits(true);
  PERFORM d1.dep(p_tag || ':legacy', d1.late(p_tag, 'legacy'));
  PERFORM d1.legacy_deposits(false);
  h := d1.unit(p_tag || ':legacy', '06/10/2026');
  PERFORM d1.ok(d1.status(h) = 'provisional' AND d1.nlines(h) = 2, 'V9 : état hérité : provisoire identique vivante');
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late'));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  e := d1.d1_event(h);
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.status(h) = 'superseded' AND d1.live(p_tag, '06/10/2026') = 0,
    'V9 : nouvelle et héritée retirées');
  PERFORM d1.ok(e.safe_details ->> 'resolution' = 'retired_at_deposit' AND e.canonical_unit_id = d1.canon(p_tag, '06/10/2026')
    AND e.attempt_id = d1.attempt(p_tag || ':late') AND d1.nlines(h) = 2, 'V9 : retrait hérité audité, lignes conservées');
END $$;

-- V10 : provisoire identique héritée, puis divergente tardive : chemin existant.
CREATE FUNCTION d1.v10(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h uuid; d uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.legacy_deposits(true);
  PERFORM d1.dep(p_tag || ':legacy', d1.late(p_tag, 'legacy'));
  PERFORM d1.legacy_deposits(false);
  h := d1.unit(p_tag || ':legacy', '06/10/2026');
  PERFORM d1.dep(p_tag || ':div', d1.late(p_tag, 'div', '{"ops": [["a", 100.50]]}'));
  d := d1.unit(p_tag || ':div', '06/10/2026');
  PERFORM d1.ok(d1.status(d) = 'provisional' AND d1.status(h) = 'superseded'
    AND d1.ev(h, 'status_changed', 'provisional_superseded_by_redeposit') = 1
    AND d1.d1_events(h) = 0 AND d1.d1_events(d) = 0 AND d1.live(p_tag, '06/10/2026') = 1,
    'V10 : divergente tardive : balayage de redépôt existant, aucun événement D1');
END $$;

-- V11 : fenêtre « déposée, non promue » (Q5).
CREATE FUNCTION d1.v11(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; d uuid; e public.daily_statement_import_events; v_snap text;
BEGIN
  -- a) identique déposée pendant la fenêtre : retirée à la promotion.
  PERFORM d1.account(p_tag || 'a', 'ORA');
  PERFORM d1.dep(p_tag || 'a:fc', d1.mk(p_tag || 'a', 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'a:late', d1.late(p_tag || 'a', 'late'));
  u := d1.unit(p_tag || 'a:late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional', 'V11a : fenêtre : identique encore vivante (aucun canonical)');
  PERFORM d1.promote(p_tag || 'a:fc', '06/10/2026');
  e := d1.d1_event(u);
  PERFORM d1.ok(d1.status(u) = 'superseded' AND e.safe_details ->> 'resolution' = 'retired_at_activation'
    AND e.canonical_unit_id = d1.canon(p_tag || 'a', '06/10/2026') AND e.attempt_id = d1.attempt(p_tag || 'a:fc')
    AND d1.nlines(u) = 2 AND d1.live(p_tag || 'a', '06/10/2026') = 0, 'V11a : retirée à la promotion, lignes conservées');
  -- b) divergente déposée pendant la fenêtre : intacte à la promotion.
  PERFORM d1.account(p_tag || 'b', 'ORA');
  PERFORM d1.dep(p_tag || 'b:fc', d1.mk(p_tag || 'b', 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'b:div', d1.late(p_tag || 'b', 'div', '{"ops": [["a", 100.50]]}'));
  d := d1.unit(p_tag || 'b:div', '06/10/2026');
  v_snap := d1.snapshot(d);
  PERFORM d1.promote(p_tag || 'b:fc', '06/10/2026');
  PERFORM d1.ok(d1.snapshot(d) = v_snap AND d1.d1_events(d) = 0 AND d1.live(p_tag || 'b', '06/10/2026') = 1,
    'V11b : divergente intacte à la promotion');
END $$;

-- V12 : chemins d'activation partagés : promotion groupée, remplacement,
-- correction des seuls soldes.
CREATE FUNCTION d1.v12(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; e public.daily_statement_import_events;
BEGIN
  -- a) promotion groupée du fichier de clôture.
  PERFORM d1.account(p_tag || 'a', 'ORA');
  PERFORM d1.dep(p_tag || 'a:fc', d1.mk(p_tag || 'a', 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'a:late', d1.late(p_tag || 'a', 'late'));
  u := d1.unit(p_tag || 'a:late', '06/10/2026');
  PERFORM d1.batch(p_tag || 'a:fc', 'd1-v12a-batch-' || p_tag);
  e := d1.d1_event(u);
  PERFORM d1.ok(d1.status(u) = 'superseded' AND e.safe_details ->> 'resolution' = 'retired_at_activation'
    AND e.attempt_id = d1.attempt(p_tag || 'a:fc'), 'V12a : promotion groupée : retrait de la provisoire identique');
  -- b) remplacement vers V06x : seule la provisoire identique à V06x est retirée.
  PERFORM d1.base(p_tag || 'b');
  PERFORM d1.dep(p_tag || 'b:fx', d1.mk(p_tag || 'b', 'fx', jsonb_build_array(d1.day05(),
    d1.day06('{"ops": [["a", 100.50], ["b", -30.25], ["x", 7]]}'), d1.day07())));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || 'b:fx', '06/10/2026')) = 'conflict', 'V12b : livraison en conflit');
  PERFORM d1.dep(p_tag || 'b:late', d1.late(p_tag || 'b', 'latex', '{"ops": [["a", 100.50], ["b", -30.25], ["x", 7]]}'));
  u := d1.unit(p_tag || 'b:late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional', 'V12b : provisoire de V06x vivante avant le remplacement');
  PERFORM d1.supersede(p_tag || 'b', '06/10/2026', p_tag || 'b:fx');
  e := d1.d1_event(u);
  PERFORM d1.ok(d1.status(u) = 'superseded' AND e.safe_details ->> 'resolution' = 'retired_at_activation'
    AND e.canonical_unit_id = d1.canon(p_tag || 'b', '06/10/2026'), 'V12b : remplacement : retrait de la provisoire identique');
  -- c) correction des seuls soldes vers V06b.
  PERFORM d1.base(p_tag || 'c');
  PERFORM d1.dep(p_tag || 'c:fb', d1.mk(p_tag || 'c', 'fb', jsonb_build_array(d1.day05(), d1.day06('{"o": 1001.00}'),
    '{"d": "07/10/2026", "o": 1071.25, "ops": [["c", 50]]}'::jsonb)));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || 'c:fb', '06/10/2026')) = 'duplicate' AND d1.nlines(d1.unit(p_tag || 'c:fb', '06/10/2026')) = 2,
    'V12c : doublon à version différente, lignes conservées (H1)');
  PERFORM d1.dep(p_tag || 'c:late', d1.late(p_tag || 'c', 'lateb', '{"o": 1001.00}'));
  u := d1.unit(p_tag || 'c:late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional', 'V12c : provisoire de V06b vivante avant la correction');
  PERFORM d1.balances('d1-v12c-bal-' || p_tag, p_tag || 'c', '06/10/2026', p_tag || 'c:fb');
  e := d1.d1_event(u);
  PERFORM d1.ok(d1.status(u) = 'superseded' AND e.safe_details ->> 'resolution' = 'retired_at_activation',
    'V12c : correction des soldes : retrait de la provisoire identique');
END $$;

-- V13 : promotion sans activation (conflit, revue, doublon) : aucun retrait.
CREATE FUNCTION d1.v13(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l uuid; v_h text := d1.hex64('v13-shared-line-' || p_tag); v_r jsonb; v_n integer;
BEGIN
  -- a) issue « conflit », puis remplacement qui active W.
  PERFORM d1.account(p_tag || 'a', 'ORA');
  PERFORM d1.dep(p_tag || 'a:fv', d1.mk(p_tag || 'a', 'fv', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'a:fw', d1.mk(p_tag || 'a', 'fw', jsonb_build_array(d1.day05(),
    d1.day06('{"ops": [["a", 100.50], ["b", -30.25], ["w", 3]]}'), d1.day07())));
  PERFORM d1.dep(p_tag || 'a:late', d1.late(p_tag || 'a', 'latew', '{"ops": [["a", 100.50], ["b", -30.25], ["w", 3]]}'));
  l := d1.unit(p_tag || 'a:late', '06/10/2026');
  PERFORM d1.promote(p_tag || 'a:fv', '06/10/2026');
  v_r := d1.promote(p_tag || 'a:fw', '06/10/2026');
  PERFORM d1.ok(v_r ->> 'outcome' = 'conflict' AND d1.status(l) = 'provisional' AND d1.d1_events(l) = 0,
    'V13a : promotion sans activation (conflit) : aucun retrait');
  PERFORM d1.supersede(p_tag || 'a', '06/10/2026', p_tag || 'a:fw');
  PERFORM d1.ok(d1.status(l) = 'superseded' AND d1.d1_events(l) = 1, 'V13a : l''activation de W retire sa provisoire');
  -- b) issue « revue » (R3 apparu entre dépôt et promotion).
  PERFORM d1.account(p_tag || 'b', 'ORA');
  PERFORM d1.dep(p_tag || 'b:fs', d1.mk(p_tag || 'b', 'fs', jsonb_build_array(
    jsonb_build_object('d', '08/10/2026', 'o', 10, 'ops', jsonb_build_array(jsonb_build_array('s1', 5, v_h))),
    '{"d": "09/10/2026", "o": 15, "ops": [["s2", 1]]}'::jsonb)));
  PERFORM d1.dep(p_tag || 'b:ft', d1.mk(p_tag || 'b', 'ft', jsonb_build_array(
    jsonb_build_object('d', '06/10/2026', 'o', 0, 'ops', jsonb_build_array(jsonb_build_array('t1', 5, v_h))),
    '{"d": "07/10/2026", "o": 5, "ops": [["t2", 1]]}'::jsonb)));
  PERFORM d1.promote(p_tag || 'b:ft', '06/10/2026');
  PERFORM d1.dep(p_tag || 'b:late', d1.mk(p_tag || 'b', 'late', jsonb_build_array(
    jsonb_build_object('d', '08/10/2026', 'o', 10, 'ops', jsonb_build_array(jsonb_build_array('s1', 5, v_h))))));
  l := d1.unit(p_tag || 'b:late', '08/10/2026');
  v_r := d1.promote(p_tag || 'b:fs', '08/10/2026');
  PERFORM d1.ok(v_r ->> 'outcome' = 'needs_review' AND d1.status(l) = 'provisional' AND d1.d1_events(l) = 0,
    'V13b : promotion sans activation (revue) : aucun retrait');
  -- c) issue « doublon » : aucun événement D1.
  PERFORM d1.account(p_tag || 'c', 'ORA');
  PERFORM d1.dep(p_tag || 'c:f1', d1.mk(p_tag || 'c', 'f1', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'c:f2', d1.mk(p_tag || 'c', 'f2', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.promote(p_tag || 'c:f1', '06/10/2026');
  SELECT count(*) INTO v_n FROM public.daily_statement_import_events
  WHERE safe_details ->> 'reason_code' = 'late_provisional_same_version_superseded';
  v_r := d1.promote(p_tag || 'c:f2', '06/10/2026');
  PERFORM d1.ok(v_r ->> 'outcome' = 'duplicate' AND (SELECT count(*) FROM public.daily_statement_import_events
    WHERE safe_details ->> 'reason_code' = 'late_provisional_same_version_superseded') = v_n,
    'V13c : promotion sans activation (doublon) : aucun événement D1');
END $$;

-- V14 : journée close déposée sur une journée retenue : comportement 0Z inchangé.
CREATE FUNCTION d1.v14(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':div', d1.late(p_tag, 'div', '{"ops": [["a", 100.50]]}'));
  d := d1.unit(p_tag || ':div', '06/10/2026');
  PERFORM d1.dep(p_tag || ':close', d1.mk(p_tag, 'close', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':close', '06/10/2026')) = 'duplicate' AND d1.status(d) = 'superseded'
    AND d1.ev(d, 'status_changed', 'provisional_superseded_by_day_closure') = 1 AND d1.d1_events(d) = 0
    AND d1.live(p_tag, '06/10/2026') = 0, 'V14 : la clôture balaie toutes les provisoires, sans motif D1');
END $$;

-- V15 : BDK avec date de référence, plusieurs journées provisoires.
CREATE FUNCTION d1.v15(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.account(p_tag, 'BDK');
  PERFORM d1.dep(p_tag || ':f1', d1.mk(p_tag, 'f1', '[{"d": "08/10/2026", "o": 100, "ops": [["k1", 10]]},
    {"d": "09/10/2026", "o": 110, "ops": [["k2", 20], ["k3", -5]]}, {"d": "10/10/2026", "o": 125, "ops": [["k4", 1]]}]', '11/10/2026'));
  PERFORM d1.promote(p_tag || ':f1', d) FROM unnest(ARRAY['08/10/2026', '09/10/2026', '10/10/2026']) d;
  PERFORM d1.dep(p_tag || ':f2', d1.mk(p_tag, 'f2', '[{"d": "08/10/2026", "o": 100, "ops": [["k1", 10]]},
    {"d": "09/10/2026", "o": 110, "ops": [["k2", 20], ["k3", -5]]}, {"d": "10/10/2026", "o": 125, "ops": [["k4", 1], ["k5", 2]]},
    {"d": "11/10/2026", "o": 128, "ops": [["k6", 3]]}]', '09/10/2026'));
  PERFORM d1.ok(d1.reply(p_tag || ':f2', '08/10/2026') ->> 'unit_status' = 'duplicate', 'V15 : 08 (avant la référence) : doublon R1');
  PERFORM d1.ok(d1.reply(p_tag || ':f2', '09/10/2026') ->> 'unit_status' = 'superseded'
    AND d1.d1_events(d1.unit(p_tag || ':f2', '09/10/2026')) = 1, 'V15 : 09 identique : retirée');
  PERFORM d1.ok(d1.reply(p_tag || ':f2', '10/10/2026') ->> 'unit_status' = 'provisional'
    AND d1.d1_events(d1.unit(p_tag || ':f2', '10/10/2026')) = 0, 'V15 : 10 divergente : provisoire vivante');
  PERFORM d1.ok(d1.reply(p_tag || ':f2', '11/10/2026') ->> 'unit_status' = 'provisional', 'V15 : 11 sans canonical : provisoire');
END $$;

-- V16 : gardes sur une livraison retirée ; déclencheur anti-promotion intact.
CREATE FUNCTION d1.v16(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r uuid; c uuid; c_hash text; r_vkey text;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':fx', d1.mk(p_tag, 'fx', jsonb_build_array(d1.day05(),
    d1.day06('{"ops": [["a", 100.50], ["b", -30.25], ["x", 7]]}'), d1.day07())));
  PERFORM d1.dep(p_tag || ':late', d1.late(p_tag, 'late'));
  r := d1.unit(p_tag || ':late', '06/10/2026');
  r_vkey := d1.vkey(r);
  c := d1.canon(p_tag, '06/10/2026');
  c_hash := (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE id = c);
  PERFORM d1.ok(d1.status(r) = 'superseded', 'V16 : livraison retirée');
  PERFORM tr_test.as_user('t_admin');
  PERFORM tr_test.expect_error(format('SELECT public.promote_daily_statement_unit(%L::uuid)', r), 'DAILY_STMT_PROMOTE_GATE');
  PERFORM tr_test.expect_error(format('SELECT public.reject_daily_statement_unit(%L, %L::uuid, %L, %L::uuid, %L, %L)',
    'd1-v16-reject-' || p_tag, r, 'superseded', c, c_hash, 'Ecartement synthetique D1'), 'DAILY_STMT_REJECT_ORIGIN_FORBIDDEN');
  PERFORM tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, %L)',
    c, r, 'Remplacement synthetique D1'), 'DAILY_STMT_SUPERSEDE_GATE');
  PERFORM tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
    'd1-v16-bal-' || p_tag, c, r, r_vkey, 'Correction synthetique D1'), 'DAILY_STMT_BALANCES_GATE');
  PERFORM d1.reset();
  PERFORM d1.ok(d1.refute('d1-v16-refute-' || p_tag, p_tag, '06/10/2026', d1.vkey(d1.unit(p_tag || ':fx', '06/10/2026')), r)
    = 'DAILY_STMT_REFUTATION_PROOF_INVALID', 'V16 : une livraison retirée ne sert pas de preuve de réfutation');
  PERFORM tr_test.expect_error(format($i$INSERT INTO public.daily_statement_units_canonical (id, promoted_from_staging_unit_id,
    day_unit_id, bank, account_fingerprint, currency, accounting_date, active_day_content_hash, line_count, day_total_debits,
    day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status, validation_status, status)
    SELECT gen_random_uuid(), s.id, s.day_unit_id, s.bank, s.account_fingerprint, s.currency, s.accounting_date,
      s.day_content_hash, s.line_count, s.day_total_debits, s.day_total_credits, s.opening_balance_derived,
      s.closing_balance_derived, s.aggregates_status, s.validation_status, 'ingested'
    FROM public.daily_statement_units_staging s WHERE s.id = %L::uuid$i$, r), 'DAILY_STMT_TRIGGER_GATE');
END $$;

-- V17 : portée fermée, rôles, cœur BIS.
CREATE FUNCTION d1.v17(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_attempts integer; v_p jsonb; u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  v_p := d1.late(p_tag, 'late');
  SELECT count(*) INTO v_attempts FROM public.daily_statement_export_attempts;
  UPDATE daily_v2_private.runtime_control SET daily_scope_enabled = false, change_reason = 'D1 V17 fermeture du scope daily ' || p_tag
   WHERE singleton = true;
  PERFORM tr_test.expect_error(format('SELECT d1.dep(%L, %L::jsonb)', p_tag || ':closed', v_p), 'DAILY_V2_RUNTIME_SCOPE_DISABLED');
  PERFORM d1.reset();
  UPDATE daily_v2_private.runtime_control SET daily_scope_enabled = true, change_reason = 'D1 V17 reouverture du scope daily ' || p_tag
   WHERE singleton = true;
  PERFORM d1.ok((SELECT count(*) FROM public.daily_statement_export_attempts) = v_attempts, 'V17 : portée fermée : refus avant tout effet');
  PERFORM tr_test.expect_error(format('SELECT d1.dep(%L, %L::jsonb, NULL, %L)', p_tag || ':reader', v_p, 't_reader'),
    'DAILY_STMT_ROLE_DENIED');
  PERFORM d1.reset();
  PERFORM d1.dep(p_tag || ':manager', v_p, NULL, 'd1_manager');
  u := d1.unit(p_tag || ':manager', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND (d1.d1_event(u)).actor_id = tr_test.id('d1_manager'),
    'V17 : dépôt par un manager : retrait audité sous son identité');
  PERFORM d1.ok(position('retire_same_version' IN pg_get_functiondef(
    'public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)'::regprocedure)) = 0,
    'V17 : le cœur BIS (journées closes) n''est pas concerné par D1');
END $$;

-- V18 : redépôts du même fichier tardif (réserve CTO R1) : une seule copie des
-- lignes, première réception inchangée, sources de la version retenue intactes.
CREATE FUNCTION d1.v18(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_src06 jsonb; v_k text; v_d text; v_vk05 text; v_src05 jsonb;
BEGIN
  PERFORM d1.base(p_tag);
  v_src06 := d1.sources(d1.duid(p_tag, '06/10/2026'), d1.cvkey(d1.canon(p_tag, '06/10/2026')));
  FOREACH v_k IN ARRAY ARRAY['a', 'b', 'c'] LOOP
    PERFORM d1.dep(p_tag || ':late_' || v_k, d1.late(p_tag, 'late'),
      d1.at('2026-10-1' || (CASE v_k WHEN 'a' THEN 0 WHEN 'b' THEN 1 ELSE 2 END)::text || ' 10:00'));
  END LOOP;
  PERFORM d1.dep(p_tag || ':late2', d1.late(p_tag, 'late2'), d1.at('2026-10-13 10:00'));
  PERFORM d1.ok((SELECT bool_and(d1.status(d1.unit(p_tag || k, '06/10/2026')) = 'superseded')
    FROM unnest(ARRAY[':late_a', ':late_b', ':late_c', ':late2']) k), 'V18 : chaque redépôt identique est retiré');
  PERFORM d1.ok(d1.nlines(d1.unit(p_tag || ':late_a', '06/10/2026')) = 2
    AND d1.nlines(d1.unit(p_tag || ':late_b', '06/10/2026')) = 0
    AND d1.nlines(d1.unit(p_tag || ':late_c', '06/10/2026')) = 0
    AND d1.nlines(d1.unit(p_tag || ':late2', '06/10/2026')) = 2, 'V18 : une copie par fichier, aucune par redépôt');
  PERFORM d1.ok((d1.d1_event(d1.unit(p_tag || ':late_b', '06/10/2026'))).safe_details ->> 'resolution'
    = 'retired_at_deposit_lines_not_restaged', 'V18 : dispense de copie auditée');
  PERFORM d1.ok(d1.day_lines(p_tag, '06/10/2026') = 6, 'V18 : volume stocké pour le 06 : 2 (retenue) + 2 + 2');
  PERFORM d1.ok(d1.sources(d1.duid(p_tag, '06/10/2026'), d1.cvkey(d1.canon(p_tag, '06/10/2026'))) = v_src06
    AND jsonb_array_length(v_src06) = 1, 'V18 : sources de la version retenue du 06 inchangées');
  v_vk05 := d1.cvkey(d1.canon(p_tag, '05/10/2026'));
  v_src05 := d1.sources(d1.duid(p_tag, '05/10/2026'), v_vk05);
  PERFORM d1.ok((SELECT (x ->> 'first_seen_at')::timestamptz = d1.at('2026-10-10 10:00') FROM jsonb_array_elements(v_src05) x
    WHERE x ->> 'raw_text_hash' = d1.hex64('file|' || p_tag || '|late')), 'V18 : première réception du fichier tardif inchangée');
  PERFORM d1.ok((SELECT deliveries FROM public.daily_stmt_version_sources(d1.duid(p_tag, '05/10/2026'), v_vk05)
    WHERE raw_text_hash = d1.hex64('file|' || p_tag || '|late')) = 3, 'V18 : trois réceptions du fichier tracées');
END $$;

-- V21 (revue indépendante, P3) : deux lignes de la journée au même index de
-- ligne : ordre ambigu, rien n'est retiré, au dépôt comme à l'activation.
CREATE FUNCTION d1.tie(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p, '{lines,2,source_line_index}', p -> 'lines' -> 1 -> 'source_line_index') $$;
CREATE FUNCTION d1.v21(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':late', d1.tie(d1.late(p_tag, 'late')));
  u := d1.unit(p_tag || ':late', '06/10/2026');
  PERFORM d1.ok((SELECT count(DISTINCT source_line_index) FROM public.daily_statement_lines_staging WHERE staging_unit_id = u) = 1
    AND d1.status(u) = 'provisional' AND d1.d1_events(u) = 0, 'V21 : ordre des lignes ambigu au dépôt : non retirée');
  PERFORM d1.account(p_tag || 'w', 'ORA');
  PERFORM d1.dep(p_tag || 'w:fc', d1.mk(p_tag || 'w', 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || 'w:late', d1.tie(d1.late(p_tag || 'w', 'late')));
  PERFORM d1.promote(p_tag || 'w:fc', '06/10/2026');
  u := d1.unit(p_tag || 'w:late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0, 'V21 : ordre ambigu à l''activation : non retirée');
END $$;

-- V22 (revue indépendante, P2-3a) : la fonction de retrait exige le verrou de
-- la journée visée. Le verrou de journée vaut jusqu'à la fin de la transaction :
-- les journées d'un compte neuf, jamais verrouillées dans cette suite, servent
-- de témoins.
CREATE FUNCTION d1.v22(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c uuid := gen_random_uuid(); v_day text; v_other text;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  v_day := d1.duid(p_tag, '06/10/2026');
  v_other := d1.duid(p_tag, '05/10/2026');
  PERFORM tr_test.expect_error(format('SELECT public.daily_stmt_retire_same_version_provisionals(%L, %L::uuid, NULL, NULL, NULL, NULL)',
    v_day, c), 'DAILY_STMT_D1_DAY_LOCK_REQUIRED');
  PERFORM tr_test.expect_error(format('SELECT public.daily_stmt_retire_same_version_provisionals(%L, %L::uuid, NULL, NULL, NULL, NULL)
    FROM (SELECT public.daily_stmt_acquire_day_lock(%L)) l', v_day, c, v_other), 'DAILY_STMT_D1_DAY_LOCK_REQUIRED');
  PERFORM public.daily_stmt_acquire_day_lock(v_day);
  PERFORM d1.ok(public.daily_stmt_retire_same_version_provisionals(v_day, c, NULL, NULL, NULL, NULL) = 0,
    'V22 : verrou de la journée tenu : appel admis (rien à retirer)');
END $$;

-- V23 (revue indépendante, P2-3b) : provisoire stockée de mêmes faits, lignes
-- non conformes, déposée pendant la fenêtre : non retirée à l'activation.
CREATE FUNCTION d1.v23(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fc', d1.mk(p_tag, 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || ':flat', d1.late(p_tag, 'flat', '{"run": "flat"}'));
  u := d1.unit(p_tag || ':flat', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.vkey(u) = d1.vkey(d1.unit(p_tag || ':fc', '06/10/2026'))
    AND NOT public.daily_stmt_staging_lines_conform(u), 'V23 : provisoire vivante de mêmes faits, lignes non conformes');
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.live(p_tag, '06/10/2026') = 1,
    'V23 : non retirée à l''activation');
END $$;

-- V24 (revue indépendante, P2-3c) : activation avec une provisoire identique et
-- une divergente vivantes en même temps (état hérité simulé en mode réplica,
-- comme Z8 : le cycle 0Z n'en laisse qu'une).
CREATE FUNCTION d1.v24(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; v_snap text; e public.daily_statement_import_events;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fc', d1.mk(p_tag, 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())));
  PERFORM d1.dep(p_tag || ':same', d1.late(p_tag, 'same'));
  PERFORM d1.dep(p_tag || ':div', d1.late(p_tag, 'div', '{"ops": [["a", 100.50]]}'));
  p := d1.unit(p_tag || ':same', '06/10/2026');
  d := d1.unit(p_tag || ':div', '06/10/2026');
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.daily_statement_units_staging SET status = 'provisional' WHERE id = p;
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM d1.ok(d1.live(p_tag, '06/10/2026') = 2, 'V24 : deux provisoires vivantes (identique et divergente)');
  v_snap := d1.snapshot(d);
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  e := d1.d1_event(p);
  PERFORM d1.ok(d1.status(p) = 'superseded' AND e.safe_details ->> 'resolution' = 'retired_at_activation'
    AND d1.snapshot(d) = v_snap AND d1.d1_events(d) = 0 AND d1.live(p_tag, '06/10/2026') = 1,
    'V24 : activation : identique retirée, divergente intacte');
END $$;

-- --------------------------------------------------------------------------
-- V25 (C1, verdict CTO) : à l'activation, seuls les doublons dont l'origine
-- provisoire est établie (événement de réception R1-provisional) et qui ont la
-- version complète activée, cohérente, avec une copie conforme détenue par une
-- livraison du cycle provisoire du même fichier, sont retirés. Témoins fermés :
-- W1 doublon canonique légitime, W2 copie non conforme, W3 version financière
-- différente, W4 autre fichier (conformité non établissable), W5 dépôt.
-- --------------------------------------------------------------------------
-- Journées BDK du 05 et du 06 (ouverture du 06 paramétrée : version financière).
CREATE FUNCTION d1.bdk56(p_open06 numeric) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(d1.day05(), d1.day06(jsonb_build_object('o', p_open06))) $$;
-- W1 : la correction des seuls soldes active V06' ; un doublon canonique de
-- V06' (H1, sans lignes) dont le fichier (même empreinte brute, date de
-- référence différente) détient aussi une copie conforme du cycle provisoire de
-- V06' (provisoire balayée par la clôture, règle 0Z) reste un doublon et une
-- source : sa réception n'est pas R1-provisional.
CREATE FUNCTION d1.v25_w1(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; x1 uuid; x2 uuid; v_snap text; v_vk text; v_src jsonb;
BEGIN
  PERFORM d1.account(p_tag, 'BDK');
  PERFORM d1.dep(p_tag || ':fa', d1.mk(p_tag, 'fa', d1.bdk56(1000.00), '07/10/2026'), d1.at('2026-10-07 17:00'));
  PERFORM d1.promote(p_tag || ':fa', '05/10/2026');
  PERFORM d1.promote(p_tag || ':fa', '06/10/2026');
  PERFORM d1.dep(p_tag || ':xp', d1.mk(p_tag, 'x', d1.bdk56(1001.00), '06/10/2026'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':xc1', d1.mk(p_tag, 'x', d1.bdk56(1001.00), '07/10/2026'), d1.at('2026-10-11 10:00'));
  PERFORM d1.dep(p_tag || ':xc2', d1.mk(p_tag, 'x', d1.bdk56(1001.00), '07/10/2026'), d1.at('2026-10-12 10:00'));
  p := d1.unit(p_tag || ':xp', '06/10/2026');
  x1 := d1.unit(p_tag || ':xc1', '06/10/2026');
  x2 := d1.unit(p_tag || ':xc2', '06/10/2026');
  v_vk := d1.vkey(x1);
  PERFORM d1.ok(d1.status(p) = 'superseded' AND d1.nlines(p) = 2 AND public.daily_stmt_staging_lines_conform(p)
    AND d1.ev(p, 'status_changed', 'provisional_superseded_by_day_closure') = 1 AND d1.vkey(p) = v_vk
    AND d1.status(x1) = 'duplicate' AND d1.nlines(x1) = 2
    AND d1.status(x2) = 'duplicate' AND d1.nlines(x2) = 0 AND d1.vkey(x2) = v_vk
    AND d1.ev(x2, 'unit_duplicate') = 1 AND d1.ev(x2, 'unit_duplicate', 'provisional_redeposit_duplicate') = 0,
    'V25 W1 : copie conforme du cycle provisoire de V06'' (balayée par la clôture), doublon H1 avec lignes, doublon canonique sans lignes, même fichier');
  v_snap := d1.snapshot(x2);
  v_src := d1.sources(d1.duid(p_tag, '06/10/2026'), v_vk);
  PERFORM d1.balances('d1-v25-w1-' || p_tag, p_tag, '06/10/2026', p_tag || ':xc1');
  PERFORM d1.ok(d1.cvkey(d1.canon(p_tag, '06/10/2026')) = v_vk AND d1.d1_events(p) = 0,
    'V25 W1 : V06'' activée par la correction des seuls soldes');
  PERFORM d1.ok(d1.status(x2) = 'duplicate' AND d1.snapshot(x2) = v_snap AND d1.d1_events(x2) = 0,
    'V25 W1 : doublon canonique légitime intact, sans événement');
  PERFORM d1.ok(d1.sources(d1.duid(p_tag, '06/10/2026'), v_vk) = v_src AND jsonb_array_length(v_src) = 1
    AND (v_src -> 0 ->> 'first_seen_at')::timestamptz = d1.at('2026-10-11 10:00')
    AND (SELECT deliveries FROM public.daily_stmt_version_sources(d1.duid(p_tag, '06/10/2026'), v_vk)
         WHERE raw_text_hash = d1.hex64('file|' || p_tag || '|x')) = 2,
    'V25 W1 : source et première réception du doublon canonique inchangées (deux réceptions)');
END $$;
-- Fenêtre « déposée, non promue » : fichier de clôture du 05 au 07, non promu.
CREATE FUNCTION d1.v25_window(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fc', d1.mk(p_tag, 'fc', jsonb_build_array(d1.day05(), d1.day06(), d1.day07())), d1.at('2026-10-07 17:00'));
END $$;
-- W2 et W3 : fichier tardif reçu deux fois pendant la fenêtre ; la seconde
-- réception est un doublon R1-provisional. Copie non conforme (W2) ou version
-- financière différente (W3) : la provisoire et le doublon restent intacts.
CREATE FUNCTION d1.v25_w23(p_tag text, p_variant jsonb, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; v_sp text; v_sd text;
BEGIN
  PERFORM d1.v25_window(p_tag);
  PERFORM d1.dep(p_tag || ':x1', d1.late(p_tag, 'x', p_variant), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':x2', d1.late(p_tag, 'x', p_variant), d1.at('2026-10-10 10:05'));
  p := d1.unit(p_tag || ':x1', '06/10/2026');
  d := d1.unit(p_tag || ':x2', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.status(d) = 'duplicate' AND d1.nlines(d) = 0
    AND d1.ev(d, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1, 'V25 ' || p_label || ' : provisoire et doublon R1-provisional');
  v_sp := d1.snapshot(p);
  v_sd := d1.snapshot(d);
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  PERFORM d1.ok(d1.snapshot(p) = v_sp AND d1.snapshot(d) = v_sd AND d1.d1_events(p) = 0 AND d1.d1_events(d) = 0
    AND d1.live(p_tag, '06/10/2026') = 1, 'V25 ' || p_label || ' : activation : provisoire et doublon intacts, aucun événement');
END $$;
-- W4 : second dépôt d'un AUTRE fichier de même contenu : doublon R1-provisional
-- sans copie conforme de son propre fichier (lignes jamais stockées, empreinte
-- de ligne sans solde courant) : fermé, il reste un doublon et une source.
CREATE FUNCTION d1.v25_w4(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; v_sd text; v_src jsonb;
BEGIN
  PERFORM d1.v25_window(p_tag);
  PERFORM d1.dep(p_tag || ':x', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':y', d1.late(p_tag, 'y'), d1.at('2026-10-10 10:05'));
  p := d1.unit(p_tag || ':x', '06/10/2026');
  d := d1.unit(p_tag || ':y', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.status(d) = 'duplicate'
    AND d1.ev(d, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1, 'V25 W4 : provisoire du fichier x, doublon du fichier y');
  v_sd := d1.snapshot(d);
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  v_src := d1.sources(d1.duid(p_tag, '06/10/2026'), d1.cvkey(d1.canon(p_tag, '06/10/2026')));
  PERFORM d1.ok(d1.status(p) = 'superseded' AND d1.snapshot(d) = v_sd AND d1.d1_events(d) = 0
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) x WHERE x ->> 'raw_text_hash' = d1.hex64('file|' || p_tag || '|y')
                AND (x ->> 'first_seen_at')::timestamptz = d1.at('2026-10-10 10:05')),
    'V25 W4 : provisoire retirée ; doublon d''un autre fichier intact (fermé), source reçue le 10/10');
END $$;
-- W5 (verdict CTO : retrait au dépôt avec les mêmes garanties qu'à
-- l'activation) : un doublon R1-provisional hérité (antérieur à D1), justifié
-- par la copie conforme de son fichier, est retiré au dépôt suivant d'une
-- livraison D1 de la journée, comme la provisoire héritée ; sans nouvelle ligne.
CREATE FUNCTION d1.v25_w5(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; z uuid; e public.daily_statement_import_events;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.legacy_deposits(true);
  PERFORM d1.dep(p_tag || ':x1', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':x2', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:05'));
  PERFORM d1.legacy_deposits(false);
  p := d1.unit(p_tag || ':x1', '06/10/2026');
  d := d1.unit(p_tag || ':x2', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.status(d) = 'duplicate' AND d1.nlines(d) = 0,
    'V25 W5 : état hérité : provisoire et doublon R1-provisional');
  PERFORM d1.dep(p_tag || ':z', d1.late(p_tag, 'z'), d1.at('2026-10-12 10:00'));
  z := d1.unit(p_tag || ':z', '06/10/2026');
  e := d1.d1_event(d);
  PERFORM d1.ok(d1.status(z) = 'superseded' AND d1.status(p) = 'superseded'
    AND (d1.d1_event(p)).safe_details ->> 'resolution' = 'retired_at_deposit',
    'V25 W5 : dépôt : livraison et provisoire héritée retirées');
  PERFORM d1.ok(d1.status(d) = 'superseded' AND d1.nlines(d) = 0 AND d1.d1_events(d) = 1
    AND e.previous_status = 'duplicate' AND e.new_status = 'superseded' AND e.safe_details ->> 'previous_status' = 'duplicate'
    AND e.safe_details ->> 'resolution' = 'provisional_duplicate_retired_at_deposit'
    AND e.canonical_unit_id = d1.canon(p_tag, '06/10/2026') AND e.attempt_id = d1.attempt(p_tag || ':z')
    AND d1.ev(d, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1,
    'V25 W5 : dépôt : doublon hérité retiré, sans lignes, audité (dépôt, canonical actif, tentative du dépôt)');
END $$;

-- W6 (contre-revue, constat 4) : la copie doit porter les MÊMES faits que le
-- doublon. Fichier x reçu pendant la fenêtre avec une ouverture différente
-- (provisoire V06', conforme), puis le même fichier en V06 (doublon
-- R1-provisional : même empreinte de journée) ; activation de V06 : la seule
-- copie du fichier est de faits différents, le doublon reste intact.
CREATE FUNCTION d1.v25_w6(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; v_sd text;
BEGIN
  PERFORM d1.v25_window(p_tag);
  PERFORM d1.dep(p_tag || ':x1', d1.late(p_tag, 'x', '{"o": 1001.00}'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':x2', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:05'));
  p := d1.unit(p_tag || ':x1', '06/10/2026');
  d := d1.unit(p_tag || ':x2', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND public.daily_stmt_staging_lines_conform(p) AND d1.status(d) = 'duplicate'
    AND d1.ev(d, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1 AND d1.vkey(d) = d1.vkey(d1.unit(p_tag || ':fc', '06/10/2026'))
    AND d1.vkey(p) <> d1.vkey(d), 'V25 W6 : provisoire conforme de V06'', doublon du même fichier en V06');
  v_sd := d1.snapshot(d);
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.snapshot(d) = v_sd AND d1.d1_events(d) = 0,
    'V25 W6 : copie de faits différents : doublon intact, provisoire divergente vivante');
END $$;
-- W7 (contre-revue, constat 4) : la copie doit appartenir au cycle provisoire.
-- BDK, fenêtre « déposée, non promue » : le fichier x (date de référence au 06)
-- dépose une provisoire non conforme puis un doublon R1-provisional ; une
-- livraison close de même empreinte brute (référence au 07) stocke une copie
-- conforme de mêmes faits, en attente (staged) ; activation de V06 : cette
-- copie hors du cycle provisoire ne justifie pas le doublon.
CREATE FUNCTION d1.v25_w7(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; d uuid; s uuid; v_sd text;
BEGIN
  PERFORM d1.account(p_tag, 'BDK');
  PERFORM d1.dep(p_tag || ':fa', d1.mk(p_tag, 'fa', d1.bdk56(1000.00), '07/10/2026'), d1.at('2026-10-07 17:00'));
  PERFORM d1.dep(p_tag || ':xp1', d1.mk(p_tag, 'x', jsonb_build_array(d1.day05(), d1.day06('{"run": "flat"}')), '06/10/2026'),
    d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':xp2', d1.mk(p_tag, 'x', jsonb_build_array(d1.day05(), d1.day06('{"run": "flat"}')), '06/10/2026'),
    d1.at('2026-10-10 10:05'));
  PERFORM d1.dep(p_tag || ':xc', d1.mk(p_tag, 'x', d1.bdk56(1000.00), '07/10/2026'), d1.at('2026-10-11 10:00'));
  p := d1.unit(p_tag || ':xp1', '06/10/2026');
  d := d1.unit(p_tag || ':xp2', '06/10/2026');
  s := d1.unit(p_tag || ':xc', '06/10/2026');
  PERFORM d1.ok(d1.status(p) = 'superseded' AND NOT public.daily_stmt_staging_lines_conform(p)
    AND d1.status(d) = 'duplicate' AND d1.ev(d, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1
    AND d1.status(s) = 'staged' AND public.daily_stmt_staging_lines_conform(s) AND d1.vkey(s) = d1.vkey(d),
    'V25 W7 : copie du cycle non conforme, copie conforme du même fichier hors du cycle (staged), doublon R1-provisional');
  v_sd := d1.snapshot(d);
  PERFORM d1.promote(p_tag || ':fa', '06/10/2026');
  PERFORM d1.ok(d1.snapshot(d) = v_sd AND d1.d1_events(d) = 0 AND d1.status(s) = 'staged',
    'V25 W7 : activation : copie hors du cycle provisoire non retenue, doublon intact');
END $$;

-- Version d'analyse d'une charge : remplacée, ou retirée si NULL.
CREATE FUNCTION d1.pv(p jsonb, p_version text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_version IS NULL THEN p #- '{attempt,parser_version}'
              ELSE jsonb_set(p, '{attempt,parser_version}', to_jsonb(p_version)) END $$;
-- W8 (verdict CTO : version d'analyse) : le doublon n'emprunte la copie de son
-- fichier que si les deux réceptions portent la même version d'analyse,
-- identifiée et non vide. Pendant la fenêtre : provisoire du fichier x (version
-- structured-csv-0b), puis doublons R1-provisional du même fichier analysés en
-- 0c, sans version, avec une version blanche, et en 0b (témoin) ; activation :
-- seul le témoin est retiré.
CREATE FUNCTION d1.v25_w8(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_k text; v_snap jsonb := '{}'::jsonb;
BEGIN
  PERFORM d1.v25_window(p_tag);
  PERFORM d1.dep(p_tag || ':x', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':c', d1.pv(d1.late(p_tag, 'x'), 'structured-csv-0c'), d1.at('2026-10-10 10:01'));
  PERFORM d1.dep(p_tag || ':n', d1.pv(d1.late(p_tag, 'x'), NULL), d1.at('2026-10-10 10:02'));
  PERFORM d1.dep(p_tag || ':w', d1.pv(d1.late(p_tag, 'x'), '   '), d1.at('2026-10-10 10:03'));
  PERFORM d1.dep(p_tag || ':b', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:04'));
  PERFORM d1.ok((SELECT bool_and(d1.status(d1.unit(p_tag || ':' || k, '06/10/2026')) = 'duplicate'
                   AND d1.ev(d1.unit(p_tag || ':' || k, '06/10/2026'), 'unit_duplicate', 'provisional_redeposit_duplicate') = 1)
                 FROM unnest(ARRAY['c', 'n', 'w', 'b']) k)
    AND (SELECT parser_version FROM public.daily_statement_export_attempts WHERE id = d1.attempt(p_tag || ':n')) IS NULL
    AND (SELECT parser_version FROM public.daily_statement_export_attempts WHERE id = d1.attempt(p_tag || ':w')) IS NULL,
    'V25 W8 : quatre doublons R1-provisional du même fichier (versions 0c, absente, blanche, 0b)');
  FOREACH v_k IN ARRAY ARRAY['c', 'n', 'w'] LOOP
    v_snap := v_snap || jsonb_build_object(v_k, d1.snapshot(d1.unit(p_tag || ':' || v_k, '06/10/2026')));
  END LOOP;
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':x', '06/10/2026')) = 'superseded'
    AND d1.status(d1.unit(p_tag || ':b', '06/10/2026')) = 'superseded'
    AND (d1.d1_event(d1.unit(p_tag || ':b', '06/10/2026'))).safe_details ->> 'resolution' = 'provisional_duplicate_retired_at_activation',
    'V25 W8 : provisoire et doublon de même version d''analyse retirés');
  PERFORM d1.ok((SELECT bool_and(d1.snapshot(d1.unit(p_tag || ':' || k, '06/10/2026')) = v_snap ->> k
                   AND d1.d1_events(d1.unit(p_tag || ':' || k, '06/10/2026')) = 0)
                 FROM unnest(ARRAY['c', 'n', 'w']) k),
    'V25 W8 : doublons de version d''analyse différente, absente ou blanche intacts');
END $$;
-- W9 : un doublon R1-provisional désigné comme preuve d'une réfutation n'est
-- jamais retiré (la preuve resterait sans livraison). Doublon du fichier y de
-- W4, désigné par une réfutation (ligne synthétique insérée en mode réplica,
-- seule façon d'obtenir l'état sans scénario de réfutation complet), puis
-- redépôt conforme de y : la nouvelle réception est retirée, le doublon reste.
CREATE FUNCTION d1.v25_w9(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid; r uuid; v_sd text;
BEGIN
  PERFORM d1.v25_window(p_tag);
  PERFORM d1.dep(p_tag || ':x', d1.late(p_tag, 'x'), d1.at('2026-10-10 10:00'));
  PERFORM d1.dep(p_tag || ':y', d1.late(p_tag, 'y'), d1.at('2026-10-10 10:05'));
  PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  d := d1.unit(p_tag || ':y', '06/10/2026');
  PERFORM d1.ok(d1.status(d) = 'duplicate', 'V25 W9 : doublon du fichier y conservé à l''activation (W4)');
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.daily_statement_version_refutations (action, day_unit_id, account_registry_id, accounting_date,
    refuted_version_key, retained_canonical_unit_id, retained_version_key, comparison, proof_kind, proof_staging_unit_id,
    proof_bound_day, reason, actor_id)
  VALUES ('REFUTE', d1.duid(p_tag, '06/10/2026'), (d1.acc(p_tag) ->> 'id')::uuid, DATE '2026-10-06', d1.hex64('refutee-' || p_tag),
    d1.canon(p_tag, '06/10/2026'), d1.cvkey(d1.canon(p_tag, '06/10/2026')), 'CONTRADICTION', 'FRESH_DELIVERY', d,
    DATE '2026-10-06', 'Refutation synthetique D1 (temoin)', tr_test.id('t_admin'))
  RETURNING id INTO r;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_sd := d1.snapshot(d);
  PERFORM d1.dep(p_tag || ':y2', d1.late(p_tag, 'y'), d1.at('2026-10-11 10:00'));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':y2', '06/10/2026')) = 'superseded' AND d1.nlines(d1.unit(p_tag || ':y2', '06/10/2026')) = 2
    AND d1.snapshot(d) = v_sd AND d1.d1_events(d) = 0,
    'V25 W9 : redépôt conforme de y retiré ; doublon désigné comme preuve de réfutation intact');
END $$;
-- V29 (verdict CTO : version d'analyse) : la dispense de stockage au dépôt
-- n'emprunte la copie du même fichier que si les deux réceptions portent la même
-- version d'analyse, identifiée et non vide ; sinon la nouvelle charge, vérifiée
-- sur ses propres lignes, est retirée et stocke sa copie.
CREATE FUNCTION d1.v29(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_k text; v_exp jsonb := '{"a": "retired_at_deposit_lines_stored", "c": "retired_at_deposit_lines_stored",
  "n": "retired_at_deposit_lines_stored", "w": "retired_at_deposit_lines_stored", "b": "retired_at_deposit_lines_not_restaged"}';
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':a', d1.late(p_tag, 'x'), d1.at('2026-10-12 10:00'));
  PERFORM d1.dep(p_tag || ':c', d1.pv(d1.late(p_tag, 'x'), 'structured-csv-0c'), d1.at('2026-10-12 10:01'));
  PERFORM d1.dep(p_tag || ':n', d1.pv(d1.late(p_tag, 'x'), NULL), d1.at('2026-10-12 10:02'));
  PERFORM d1.dep(p_tag || ':w', d1.pv(d1.late(p_tag, 'x'), '   '), d1.at('2026-10-12 10:03'));
  PERFORM d1.dep(p_tag || ':b', d1.late(p_tag, 'x'), d1.at('2026-10-12 10:04'));
  FOREACH v_k IN ARRAY ARRAY['a', 'c', 'n', 'w', 'b'] LOOP
    PERFORM d1.ok(d1.status(d1.unit(p_tag || ':' || v_k, '06/10/2026')) = 'superseded'
      AND (d1.d1_event(d1.unit(p_tag || ':' || v_k, '06/10/2026'))).safe_details ->> 'resolution' = v_exp ->> v_k
      AND d1.nlines(d1.unit(p_tag || ':' || v_k, '06/10/2026')) = CASE WHEN v_k = 'b' THEN 0 ELSE 2 END,
      'V29 réception ' || v_k || ' : retirée (' || (v_exp ->> v_k) || ')');
  END LOOP;
  PERFORM d1.ok(d1.day_lines(p_tag, '06/10/2026') = 10,
    'V29 : volume du 06 : 2 (retenue) + 2 (0b) + 2 (0c) + 2 (sans version) + 2 (version blanche) + 0 (0b redéposé)');
END $$;

-- V27 (contre-revue, constat 5) : la dispense de copie au dépôt exige, comme le
-- prédicat des livraisons stockées, un ordre de lignes non ambigu. Version sans
-- soldes (conformité indépendante de l'ordre) : le fichier x reçu d'abord avec
-- deux lignes au même index reste provisoire ; reçu ensuite numéroté sans
-- collision, il est retiré et stocke sa propre copie.
CREATE FUNCTION d1.v27(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; u uuid; v_x jsonb;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fu', d1.mk(p_tag, 'fu', '[{"d": "10/10/2026", "agg": "unavailable", "ops": [["e", 10], ["f", 5]]},
    {"d": "11/10/2026", "o": 0, "ops": [["g", 1]]}]'));
  PERFORM d1.promote(p_tag || ':fu', '10/10/2026', 'Approbation synthetique sans soldes D1');
  v_x := d1.mk(p_tag, 'x', '[{"d": "10/10/2026", "agg": "unavailable", "ops": [["e", 10], ["f", 5]]}]');
  PERFORM d1.dep(p_tag || ':tie', jsonb_set(v_x, '{lines,1,source_line_index}', v_x -> 'lines' -> 0 -> 'source_line_index'));
  p := d1.unit(p_tag || ':tie', '10/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.stored_pairs(p) = 1 AND public.daily_stmt_staging_lines_conform(p),
    'V27 : réception à ordre ambigu : provisoire, lignes conformes quel que soit l''ordre');
  PERFORM d1.dep(p_tag || ':x', v_x);
  u := d1.unit(p_tag || ':x', '10/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.nlines(u) = 2
    AND (d1.d1_event(u)).safe_details ->> 'resolution' = 'retired_at_deposit_lines_stored'
    AND d1.status(p) = 'provisional' AND d1.d1_events(p) = 0,
    'V27 : copie à ordre ambigu non retenue : livraison retirée avec ses lignes ; réception ambiguë vivante');
END $$;

-- V28 (contre-revue, constat 6) : un index de ligne hors du domaine entier ne
-- fait pas échouer la règle de la charge : D1 ne s'applique pas et le chemin
-- existant décide (ici, doublon R1-provisional sans lignes d'une provisoire de
-- même empreinte, comme avant D1).
CREATE FUNCTION d1.v28(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_p jsonb; u uuid;
BEGIN
  PERFORM d1.base(p_tag);
  PERFORM d1.dep(p_tag || ':div', d1.late(p_tag, 'div', '{"o": 1001.00}'));
  v_p := jsonb_set(d1.late(p_tag, 'big'), '{lines,2,source_line_index}', '99999999999');
  PERFORM d1.ok(NOT d1.payload_rule(v_p, d1.duid(p_tag, '06/10/2026')), 'V28 : règle de la charge : index hors domaine, faux sans erreur');
  PERFORM d1.dep(p_tag || ':big', v_p);
  u := d1.unit(p_tag || ':big', '06/10/2026');
  PERFORM d1.ok(d1.reply(p_tag || ':big', '06/10/2026') ->> 'unit_status' = 'duplicate' AND d1.nlines(u) = 0 AND d1.d1_events(u) = 0
    AND d1.status(d1.unit(p_tag || ':div', '06/10/2026')) = 'provisional',
    'V28 : dépôt accepté par le chemin existant (doublon R1-provisional), aucun retrait');
END $$;

-- --------------------------------------------------------------------------
-- V26 (C2, verdict CTO) : ordre ambigu détecté sur les valeurs numériques
-- d'index et d'ordinal (celles du tri et du stockage), y compris quand leurs
-- représentations diffèrent (« 1 » et « 01 »). Journée du 06 à trois lignes,
-- index 1 à 3. Variantes : index, ordinal, combinaison ; témoin sans collision
-- avec zéros initiaux. Attendus déterministes : la garde rend faux avant tout
-- tri dépendant d'un identifiant.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.day06x3() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"d": "06/10/2026", "o": 1000.00, "ops": [["a", 100.50], ["b", -30.25], ["e", 10]]}'::jsonb $$;
CREATE FUNCTION d1.renum(p jsonb, p_variant text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_variant
    WHEN 'idx'  THEN jsonb_set(p, '{lines,2,source_line_index}', '"01"')
    WHEN 'ord'  THEN jsonb_set(jsonb_set(p, '{lines,2,source_line_index}', '1'), '{lines,2,daily_occurrence_ordinal}', '"01"')
    WHEN 'both' THEN jsonb_set(jsonb_set(p, '{lines,2,source_line_index}', '"01"'), '{lines,2,daily_occurrence_ordinal}', '"01"')
    WHEN 'zeros' THEN jsonb_set(jsonb_set(jsonb_set(jsonb_set(p, '{lines,1,source_line_index}', '"01"'),
                        '{lines,2,source_line_index}', '"002"'), '{lines,3,source_line_index}', '"03"'),
                        '{lines,2,daily_occurrence_ordinal}', '"01"')
  END $$;
-- Règle de la charge (fonction de la migration) pour une journée d'une charge.
CREATE FUNCTION d1.payload_rule(p jsonb, p_duid text) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.daily_stmt_payload_lines_conform(p -> 'lines', p_duid, (u ->> 'line_count')::integer,
    (u ->> 'day_total_debits')::numeric, (u ->> 'day_total_credits')::numeric, u ->> 'aggregates_status',
    (u ->> 'opening_balance_derived')::numeric, (u ->> 'closing_balance_derived')::numeric)
  FROM jsonb_array_elements(p -> 'units') u WHERE u ->> 'day_unit_id' = p_duid $$;
CREATE FUNCTION d1.v26_late(p_tag text, p_variant text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.renum(d1.mk(p_tag, 'late', jsonb_build_array(d1.day05(), d1.day06x3())), p_variant) $$;
CREATE FUNCTION d1.v26_base(p_tag text, p_promote boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':fc', d1.mk(p_tag, 'fc', jsonb_build_array(d1.day05(), d1.day06x3(),
    '{"d": "07/10/2026", "o": 1080.25, "ops": [["c", 50]]}'::jsonb)), d1.at('2026-10-07 17:00'));
  IF p_promote THEN
    PERFORM d1.promote(p_tag || ':fc', '05/10/2026');
    PERFORM d1.promote(p_tag || ':fc', '06/10/2026');
  END IF;
END $$;
CREATE FUNCTION d1.stored_pairs(p_unit uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(DISTINCT (source_line_index, daily_occurrence_ordinal))::integer
  FROM public.daily_statement_lines_staging WHERE staging_unit_id = p_unit $$;
CREATE FUNCTION d1.v26(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_v text; v_acc text; v_p jsonb; u uuid;
BEGIN
  FOREACH v_v IN ARRAY ARRAY['idx', 'ord', 'both'] LOOP
    -- Au dépôt, canonical actif de même version.
    v_acc := p_tag || v_v || 'd';
    PERFORM d1.v26_base(v_acc, true);
    v_p := d1.v26_late(v_acc, v_v);
    PERFORM d1.ok(NOT d1.payload_rule(v_p, d1.duid(v_acc, '06/10/2026')),
      'V26 ' || v_v || ' : règle de la charge : collision numérique détectée (ordre ambigu)');
    PERFORM d1.dep(v_acc || ':late', v_p);
    u := d1.unit(v_acc || ':late', '06/10/2026');
    PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.nlines(u) = 3 AND d1.stored_pairs(u) = 2
      AND NOT public.daily_stmt_provisional_same_version(u, d1.canon(v_acc, '06/10/2026')),
      'V26 ' || v_v || ' : au dépôt, non retirée ; lignes stockées à deux couples, même verdict que la charge');
    -- À l'activation (fenêtre « déposée, non promue »).
    v_acc := p_tag || v_v || 'a';
    PERFORM d1.v26_base(v_acc, false);
    PERFORM d1.dep(v_acc || ':late', d1.v26_late(v_acc, v_v));
    PERFORM d1.promote(v_acc || ':fc', '06/10/2026');
    u := d1.unit(v_acc || ':late', '06/10/2026');
    PERFORM d1.ok(d1.status(u) = 'provisional' AND d1.d1_events(u) = 0 AND d1.live(v_acc, '06/10/2026') = 1
      AND d1.stored_pairs(u) = 2, 'V26 ' || v_v || ' : à l''activation, non retirée (garde des lignes stockées)');
  END LOOP;
  -- Témoin : zéros initiaux sans collision, trois couples distincts.
  v_acc := p_tag || 'zd';
  PERFORM d1.v26_base(v_acc, true);
  v_p := d1.v26_late(v_acc, 'zeros');
  PERFORM d1.ok(d1.payload_rule(v_p, d1.duid(v_acc, '06/10/2026')), 'V26 témoin : règle de la charge conforme');
  PERFORM d1.dep(v_acc || ':late', v_p);
  u := d1.unit(v_acc || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.d1_events(u) = 1 AND d1.nlines(u) = 3 AND d1.stored_pairs(u) = 3
    AND public.daily_stmt_staging_lines_conform(u)
    AND (SELECT array_agg(source_line_index ORDER BY source_line_index) FROM public.daily_statement_lines_staging
         WHERE staging_unit_id = u) = ARRAY[1, 2, 3],
    'V26 témoin : retirée au dépôt ; index stockés 1, 2, 3, lignes conformes');
  v_acc := p_tag || 'za';
  PERFORM d1.v26_base(v_acc, false);
  PERFORM d1.dep(v_acc || ':late', d1.v26_late(v_acc, 'zeros'));
  PERFORM d1.promote(v_acc || ':fc', '06/10/2026');
  u := d1.unit(v_acc || ':late', '06/10/2026');
  PERFORM d1.ok(d1.status(u) = 'superseded' AND (d1.d1_event(u)).safe_details ->> 'resolution' = 'retired_at_activation',
    'V26 témoin : retirée à l''activation');
END $$;

-- --------------------------------------------------------------------------
-- Exécution nominale
-- --------------------------------------------------------------------------
SELECT d1.v1('v1');
SELECT 'PASS 45b V1 fichier tardif identique retiré, audité, rattaché' AS marker;
SELECT d1.v2('v2');
SELECT 'PASS 45b V2 mêmes mouvements, soldes différents : vivante' AS marker;
SELECT d1.v3('v3');
SELECT 'PASS 45b V3 journée partielle : vivante' AS marker;
SELECT d1.v4('v4');
SELECT 'PASS 45b V4 unavailable identique retirée ; unavailable contre derived : vivante' AS marker;
SELECT d1.v5('v5');
SELECT 'PASS 45b V5 10.5 = 10.50 : retirée' AS marker;
SELECT d1.v6('v6');
SELECT 'PASS 45b V6 version identique incohérente : vivante' AS marker;
SELECT d1.v7('v7');
SELECT 'PASS 45b V7 lignes non conformes : vivante' AS marker;
SELECT d1.v8('v8');
SELECT 'PASS 45b V8 divergente préservée à l''identique, aucun événement' AS marker;
SELECT d1.v9('v9');
SELECT 'PASS 45b V9 héritée identique et tardive identique : retirées' AS marker;
SELECT d1.v10('v10');
SELECT 'PASS 45b V10 héritée identique et divergente tardive : chemin existant' AS marker;
SELECT d1.v11('v11');
SELECT 'PASS 45b V11 fenêtre déposée-non promue : retrait à la promotion, divergente intacte' AS marker;
SELECT d1.v12('v12');
SELECT 'PASS 45b V12 promotion groupée, remplacement, correction des soldes' AS marker;
SELECT d1.v13('v13');
SELECT 'PASS 45b V13 promotion sans activation : aucun retrait' AS marker;
SELECT d1.v14('v14');
SELECT 'PASS 45b V14 clôture : balayage 0Z inchangé' AS marker;
SELECT d1.v15('v15');
SELECT 'PASS 45b V15 BDK date de référence, journées provisoires multiples' AS marker;
SELECT d1.v16('v16');
SELECT 'PASS 45b V16 gardes : ni promue, ni écartée, ni remplaçante, ni preuve ; déclencheur intact' AS marker;
SELECT d1.v17('v17');
SELECT 'PASS 45b V17 portée fermée, rôles, cœur BIS' AS marker;
SELECT d1.v18('v18');
SELECT 'PASS 45b V18 redépôts : une copie par fichier, réception et sources inchangées' AS marker;
SELECT d1.v21('v21');
SELECT 'PASS 45b V21 ordre des lignes ambigu : non retirée (dépôt et activation)' AS marker;
SELECT d1.v22('v22');
SELECT 'PASS 45b V22 retrait refusé sans le verrou de la journée' AS marker;
SELECT d1.v23('v23');
SELECT 'PASS 45b V23 provisoire stockée non conforme : non retirée à l''activation' AS marker;
SELECT d1.v24('v24');
SELECT 'PASS 45b V24 activation : identique retirée, divergente intacte' AS marker;
SELECT d1.v25_w1('v25w1');
SELECT 'PASS 45b V25 W1 doublon canonique légitime de la version activée : intact, source et première réception inchangées' AS marker;
SELECT d1.v25_w23('v25w2', '{"run": "flat"}', 'W2 copie non conforme');
SELECT 'PASS 45b V25 W2 copie du même fichier non conforme : provisoire et doublon intacts' AS marker;
SELECT d1.v25_w23('v25w3', '{"o": 1001.00}', 'W3 version financière différente');
SELECT 'PASS 45b V25 W3 version financière différente : provisoire et doublon intacts' AS marker;
SELECT d1.v25_w4('v25w4');
SELECT 'PASS 45b V25 W4 doublon d''un autre fichier : fermé (conformité non établissable), reste source' AS marker;
SELECT d1.v25_w5('v25w5');
SELECT 'PASS 45b V25 W5 au dépôt : doublon hérité justifié retiré, sans lignes, audité' AS marker;
SELECT d1.v25_w8('v25w8');
SELECT 'PASS 45b V25 W8 version d''analyse différente, absente ou blanche : doublon intact ; même version : retiré' AS marker;
SELECT d1.v25_w9('v25w9');
SELECT 'PASS 45b V25 W9 doublon désigné comme preuve de réfutation : jamais retiré' AS marker;
SELECT d1.v29('v29');
SELECT 'PASS 45b V29 dispense de copie : même version d''analyse exigée ; sinon copie propre stockée' AS marker;
SELECT d1.v25_w6('v25w6');
SELECT 'PASS 45b V25 W6 copie du même fichier de faits différents : doublon intact' AS marker;
SELECT d1.v25_w7('v25w7');
SELECT 'PASS 45b V25 W7 copie conforme hors du cycle provisoire : doublon intact' AS marker;
SELECT d1.v26('v26');
SELECT 'PASS 45b V26 ordre ambigu après conversion numérique (index, ordinal, combinaison) : non retirée au dépôt ni à l''activation ; témoin à zéros initiaux retiré' AS marker;
SELECT d1.v27('v27');
SELECT 'PASS 45b V27 dispense de copie : copie à ordre ambigu non retenue, lignes stockées' AS marker;
SELECT d1.v28('v28');
SELECT 'PASS 45b V28 index hors du domaine entier : règle de la charge fausse sans erreur, chemin existant' AS marker;

-- --------------------------------------------------------------------------
-- V19 : privilèges, attributs et définitions.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.v19() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_f1 text := pg_get_functiondef(d1.f1()::regprocedure);
BEGIN
  PERFORM d1.ok(NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE p.oid IN (d1.f1()::regprocedure, d1.f2()::regprocedure, d1.f4()::regprocedure, d1.f5()::regprocedure,
                      'public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE')),
    'V19 : les cinq fonctions D1 inexécutables par anon, authenticated et service_role');
  PERFORM d1.ok(NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.proname IN ('daily_stmt_payload_lines_conform', 'daily_stmt_provisional_same_version',
                          'daily_stmt_retire_same_version_provisionals', 'daily_stmt_promote_unit_core',
                          'daily_stmt_pre_ingest_legacy_core_0u')
        AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)=X/')), 'V19 : aucun EXECUTE à PUBLIC');
  PERFORM d1.ok((SELECT prosecdef AND proconfig::text LIKE '%search_path=public, pg_temp%' FROM pg_proc WHERE oid = d1.f1()::regprocedure)
    AND (SELECT NOT prosecdef AND proconfig::text LIKE '%search_path=public, pg_temp%' AND provolatile = 'v'
         FROM pg_proc WHERE oid = d1.f2()::regprocedure), 'V19 : attributs des deux fonctions redéfinies conservés');
  PERFORM d1.ok((SELECT string_agg(p.proname || ':' || p.provolatile::text || ':' || p.prosecdef::text, ',' ORDER BY p.proname) FROM pg_proc p
      WHERE p.proname IN ('daily_stmt_payload_lines_conform', 'daily_stmt_provisional_same_version',
                          'daily_stmt_retire_same_version_provisionals'))
    = 'daily_stmt_payload_lines_conform:i:false,daily_stmt_provisional_same_version:s:false,daily_stmt_retire_same_version_provisionals:v:false',
    'V19 : nouvelles fonctions internes non SECURITY DEFINER, volatilité attendue');
  PERFORM d1.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'daily_statement_%'
    AND cmd <> 'SELECT') = 0, 'V19 : aucune politique d''écriture');
  -- Prédicat complet (garde structurelle) : version, cohérence, conformité ;
  -- cohérence exigée dans les deux branches de F4 (provisoire et doublon).
  PERFORM d1.ok(position('v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);' IN v_f1) > 0
    AND d1.occ(pg_get_functiondef(d1.f4()::regprocedure), 'AND public.daily_stmt_version_coherent(v_s.aggregates_status') = 2
    AND d1.occ(pg_get_functiondef(d1.f4()::regprocedure), 'daily_stmt_staging_lines_conform(v_s.id)') = 1
    AND d1.occ(pg_get_functiondef(d1.f4()::regprocedure), 'daily_stmt_staging_lines_conform(o.id)') = 1,
    'V19 : prédicat D1 complet au dépôt et sur les livraisons stockées (deux branches)');
END $$;
SELECT d1.v19();
SELECT 'PASS 45b V19 privilèges, attributs et prédicat' AS marker;

-- --------------------------------------------------------------------------
-- Mordants : chaque mutation fait échouer une assertion du scénario visé.
-- --------------------------------------------------------------------------
SELECT d1.bites('45b M1 sans retrait au dépôt',
  ARRAY[d1.m(d1.f1(), 'v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);', 'v_d1_retire := false;')],
  $$SELECT d1.v1('m1')$$);
SELECT d1.bites('45b M2a balayage général (postcondition active)',
  ARRAY[d1.m(d1.f5(), 'IF public.daily_stmt_provisional_same_version(v_row.id, p_canonical_unit_id) THEN', 'IF true THEN')],
  $$SELECT d1.v8('m2a')$$);
SELECT d1.bites('45b M2b balayage général (postcondition retirée)',
  ARRAY[d1.m(d1.f5(), 'IF public.daily_stmt_provisional_same_version(v_row.id, p_canonical_unit_id) THEN', 'IF true THEN'),
        d1.m(d1.f5(), 'IF v_after IS DISTINCT FROM v_before THEN', 'IF false THEN')],
  $$SELECT d1.v8('m2b')$$);
SELECT d1.bites('45b M3 sans condition de conformité',
  ARRAY[d1.m(d1.f1(), 'coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false)', 'coalesce(v_d1_same AND v_d1_coherent, false)'),
        d1.m(d1.f4(), 'AND public.daily_stmt_staging_lines_conform(v_s.id)', 'AND true')],
  $$SELECT d1.v7('m3')$$);
SELECT d1.bites('45b M4 sans retrait à l''activation',
  ARRAY[d1.m(d1.f2(), 'PERFORM public.daily_stmt_retire_same_version_provisionals(v_unit.day_unit_id, p_new_canonical_id, p_actor, v_unit.attempt_id, NULL, NULL);', 'NULL;')],
  $$SELECT d1.v11('m4')$$);
SELECT d1.bites('45b M5 clé textuelle au lieu de la comparaison numérique',
  ARRAY[d1.m(d1.f1(), 'v_d1_same := public.daily_stmt_version_compare(v_content_hashes[v_i], v_d1_agg, v_d1_open, v_d1_close, v_d1_debits, v_d1_credits, v_d1_canonical.active_day_content_hash, v_d1_canonical.aggregates_status, v_d1_canonical.opening_balance_derived, v_d1_canonical.closing_balance_derived, v_d1_canonical.day_total_debits, v_d1_canonical.day_total_credits) = ''SAME_VERSION'';',
    'v_d1_same := public.daily_stmt_version_key(v_content_hashes[v_i], v_d1_agg, v_d1_open, v_d1_close, v_d1_debits, v_d1_credits) = public.daily_stmt_version_key(v_d1_canonical.active_day_content_hash, v_d1_canonical.aggregates_status, v_d1_canonical.opening_balance_derived, v_d1_canonical.closing_balance_derived, v_d1_canonical.day_total_debits, v_d1_canonical.day_total_credits);')],
  $$SELECT d1.v5('m5')$$);
-- M6 : la cohérence est impliquée par la conformité des lignes (relation 6 =>
-- relations 1 à 4) ; mutant équivalent en comportement (V6 reste vivante par
-- la conformité), tué par la garde structurelle V19.
SELECT d1.bites('45b M6 sans condition de cohérence',
  ARRAY[d1.m(d1.f1(), 'coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false)', 'coalesce(v_d1_same AND v_d1_conform, false)'),
        d1.m(d1.f4(), 'AND public.daily_stmt_version_coherent(v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits)', 'AND true')],
  $$SELECT d1.v6('m6'), d1.v19()$$);
SELECT d1.bites('45b M7 nouvelle copie des lignes à chaque redépôt',
  ARRAY[d1.m(d1.f1(), 'IF (v_final <> ''duplicate'' OR v_keep_lines) AND NOT v_d1_copy_exists THEN', 'IF (v_final <> ''duplicate'' OR v_keep_lines) THEN')],
  $$SELECT d1.v18('m7')$$);
SELECT d1.bites('45b M3b sans condition de conformité des lignes stockées (activation)',
  ARRAY[d1.m(d1.f4(), 'AND public.daily_stmt_staging_lines_conform(v_s.id)', 'AND true')],
  $$SELECT d1.v23('m3b')$$);
SELECT d1.bites('45b M8 sans contrôle du verrou de journée',
  ARRAY[d1.m(d1.f5(), 'IF NOT EXISTS (', 'IF false AND NOT EXISTS (')],
  $$SELECT d1.v22('m8')$$);
SELECT d1.bites('45b M9 sans garde d''ordre ambigu',
  ARRAY[d1.m('public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)',
             'HAVING count(*) > 1) THEN', 'HAVING false) THEN'),
        d1.m(d1.f4(), 'HAVING count(*) > 1)', 'HAVING false)')],
  $$SELECT d1.v21('m9')$$);
-- C1 : chaque condition du retrait d'un doublon a son témoin fermé (V25).
SELECT d1.bites('45b M11 provenance R1-provisional non exigée (C1, W1)',
  ARRAY[d1.m(d1.f4(), 'AND e.canonical_unit_id IS NULL AND e.safe_details ->> ''reason_code'' = ''provisional_redeposit_duplicate''', '')],
  $$SELECT d1.v25_w1('m11')$$);
SELECT d1.bites('45b M12 copie du même fichier non conforme admise (C1, W2)',
  ARRAY[d1.m(d1.f4(), 'AND public.daily_stmt_staging_lines_conform(o.id)', 'AND true')],
  $$SELECT d1.v25_w23('m12', '{"run": "flat"}', 'W2 sous mutation')$$);
SELECT d1.bites('45b M13 version complète du doublon non exigée (C1, W3)',
  ARRAY[d1.m(d1.f4(), 'AND public.daily_stmt_version_compare(v_s.day_content_hash, v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits, v_c.active_day_content_hash, v_c.aggregates_status, v_c.opening_balance_derived, v_c.closing_balance_derived, v_c.day_total_debits, v_c.day_total_credits) = ''SAME_VERSION''', 'AND true')],
  $$SELECT d1.v25_w23('m13', '{"o": 1001.00}', 'W3 sous mutation')$$);
SELECT d1.bites('45b M15 copie d''un autre fichier admise (C1, W4)',
  ARRAY[d1.m(d1.f4(), 'AND ao.raw_text_hash = v_rth', 'AND true')],
  $$SELECT d1.v25_w4('m15')$$);
SELECT d1.bites('45b M16 exclusion des doublons au dépôt réintroduite (W5)',
  ARRAY[d1.m(d1.f5(), 's.status IN (''provisional'', ''duplicate'')', '(s.status = ''provisional'' OR (s.status = ''duplicate'' AND p_exclude_staging_unit_id IS NULL))')],
  $$SELECT d1.v25_w5('m16')$$);
SELECT d1.bites('45b M21 doublon désigné comme preuve de réfutation admis (W9)',
  ARRAY[d1.m(d1.f4(), 'AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations r WHERE r.proof_staging_unit_id = v_s.id)', 'AND true')],
  $$SELECT d1.v25_w9('m21')$$);
SELECT d1.bites('45b M22 dispense de copie sans version d''analyse identique (V29)',
  ARRAY[d1.m(d1.f1(), 'AND nullif(btrim(a.parser_version), '''') IS NOT NULL AND a.parser_version = nullif(btrim(coalesce(p_attempt ->> ''parser_version'', '''')), '''')', 'AND true')],
  $$SELECT d1.v29('m22')$$);
SELECT d1.bites('45b M23 copie du doublon sans version d''analyse identique (W8)',
  ARRAY[d1.m(d1.f4(), 'AND nullif(btrim(ao.parser_version), '''') IS NOT NULL AND ao.parser_version = v_pv', 'AND true')],
  $$SELECT d1.v25_w8('m23')$$);
-- C2 : la garde textuelle réintroduite laisse retirer une charge ambiguë (V26).
SELECT d1.bites('45b M14 garde d''ordre textuelle dans la règle de la charge (C2, V26)',
  ARRAY[d1.m('public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)',
             'GROUP BY (x.value ->> ''source_line_index'')::integer, (x.value ->> ''daily_occurrence_ordinal'')::integer',
             'GROUP BY x.value ->> ''source_line_index'', x.value ->> ''daily_occurrence_ordinal''')],
  $$SELECT d1.v26('m14')$$);
-- Contre-revue : conditions de la copie et de la règle de la charge.
SELECT d1.bites('45b M17 égalités d''empreinte et de faits de la copie supprimées (W6)',
  ARRAY[d1.m(d1.f4(), 'AND o.day_content_hash = v_s.day_content_hash', 'AND true'),
        d1.m(d1.f4(), 'AND o.aggregates_status = v_s.aggregates_status', 'AND true'),
        d1.m(d1.f4(), 'AND o.opening_balance_derived IS NOT DISTINCT FROM v_s.opening_balance_derived', 'AND true'),
        d1.m(d1.f4(), 'AND o.closing_balance_derived IS NOT DISTINCT FROM v_s.closing_balance_derived', 'AND true'),
        d1.m(d1.f4(), 'AND o.day_total_debits IS NOT DISTINCT FROM v_s.day_total_debits', 'AND true'),
        d1.m(d1.f4(), 'AND o.day_total_credits IS NOT DISTINCT FROM v_s.day_total_credits', 'AND true')],
  $$SELECT d1.v25_w6('m17')$$);
SELECT d1.bites('45b M18 copie hors du cycle provisoire admise (W7)',
  ARRAY[d1.m(d1.f4(), 'AND o.status IN (''provisional'', ''superseded'')', 'AND true')],
  $$SELECT d1.v25_w7('m18')$$);
SELECT d1.bites('45b M19 dispense de copie sans garde d''ordre ambigu (V27)',
  ARRAY[d1.m(d1.f1(), 'AND NOT EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id GROUP BY l.source_line_index, l.daily_occurrence_ordinal HAVING count(*) > 1)', 'AND true')],
  $$SELECT d1.v27('m19')$$);
SELECT d1.bites('45b M20 règle de la charge sans garde de domaine entier (V28)',
  ARRAY[d1.m('public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)',
             'greatest((x.value ->> ''source_line_index'')::numeric, (x.value ->> ''daily_occurrence_ordinal'')::numeric) > 2147483647', 'false')],
  $$SELECT d1.v28('m20')$$);

-- --------------------------------------------------------------------------
-- V20 : parité de la règle appliquée à la charge avec la règle des lignes
-- stockées, sur toutes les unités déposées dans cette suite (lignes stockées),
-- plus des journées à chaîne décroissante et non conformes. L'oracle d'ordre
-- ambigu compare les valeurs numériques d'index et d'ordinal (C2), jamais leurs
-- représentations textuelles. Fonction : rejouée sous mutation (M14).
-- --------------------------------------------------------------------------
SELECT d1.account('v20', 'ORA');
SELECT d1.dep('v20:mix', d1.mk('v20', 'mix', '[{"d": "01/10/2026", "o": 10, "ops": [["p1", 5], ["p2", -3], ["p3", 1]], "run": "desc"},
  {"d": "02/10/2026", "o": 13, "ops": [["p4", 2], ["p5", 2]], "run": "flat"},
  {"d": "03/10/2026", "o": 17, "ops": [["p6", 4], ["p7", -1]], "run": "desc", "fix": {"closing_balance_derived": 21}},
  {"d": "04/10/2026", "agg": "unavailable", "ops": [["p8", 3]]},
  {"d": "05/10/2026", "o": 0, "ops": [["p9", 1]]}]'));
CREATE FUNCTION d1.v20_rows()
RETURNS TABLE (key text, duid text, staging_id uuid, payload_rule boolean, stored_rule boolean, ambiguous boolean)
LANGUAGE sql AS $$
  SELECT d.key, u ->> 'day_unit_id', s.id,
         public.daily_stmt_payload_lines_conform(d.payload -> 'lines', u ->> 'day_unit_id', (u ->> 'line_count')::integer,
           (u ->> 'day_total_debits')::numeric, (u ->> 'day_total_credits')::numeric, u ->> 'aggregates_status',
           (u ->> 'opening_balance_derived')::numeric, (u ->> 'closing_balance_derived')::numeric),
         public.daily_stmt_staging_lines_conform(s.id),
         EXISTS (SELECT 1 FROM jsonb_array_elements(d.payload -> 'lines') x WHERE x ->> 'day_unit_id' = u ->> 'day_unit_id'
                 GROUP BY (x ->> 'source_line_index')::integer, (x ->> 'daily_occurrence_ordinal')::integer HAVING count(*) > 1)
  FROM d1.deposits d
  CROSS JOIN LATERAL jsonb_array_elements(d.payload -> 'units') u
  JOIN public.daily_statement_units_staging s ON s.attempt_id = (d.result ->> 'attempt_id')::uuid AND s.day_unit_id = u ->> 'day_unit_id'
  WHERE EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id) $$;
CREATE FUNCTION d1.v20() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.ok((SELECT count(*) FROM d1.v20_rows() r WHERE NOT r.ambiguous AND r.payload_rule IS DISTINCT FROM r.stored_rule) = 0,
    'V20 : règle de la charge = règle des lignes stockées (' || (SELECT count(*) FROM d1.v20_rows() r WHERE NOT r.ambiguous)
    || ' unités à ordre non ambigu)');
  -- Ordre ambigu (V21, V26) : l'ordre stocké dépend d'un identifiant aléatoire ;
  -- la règle de la charge refuse toujours (prudence).
  PERFORM d1.ok((SELECT count(*) >= 8 AND bool_and(NOT r.payload_rule) FROM d1.v20_rows() r WHERE r.ambiguous),
    'V20 : ordre ambigu : la règle de la charge refuse toujours');
  -- Les variantes numériques de V26 sont classées ambiguës, le témoin non.
  PERFORM d1.ok((SELECT count(*) = 6 AND bool_and(r.ambiguous) FROM d1.v20_rows() r
                 WHERE r.key ~ '^v26(idx|ord|both)[da]:late$' AND r.duid = d1.duid(split_part(r.key, ':', 1), '06/10/2026'))
    AND (SELECT count(*) = 2 AND bool_and(NOT r.ambiguous) FROM d1.v20_rows() r
         WHERE r.key ~ '^v26z[da]:late$' AND r.duid = d1.duid(split_part(r.key, ':', 1), '06/10/2026')),
    'V20 : oracle numérique : collisions « 1 » / « 01 » ambiguës, témoin à zéros initiaux non ambigu');
  PERFORM d1.ok((SELECT count(*) FILTER (WHERE r.stored_rule) >= 20 AND count(*) FILTER (WHERE NOT r.stored_rule) >= 3
                 FROM d1.v20_rows() r WHERE NOT r.ambiguous),
    'V20 : unités conformes et non conformes couvertes');
  PERFORM d1.ok((SELECT r.payload_rule FROM d1.v20_rows() r WHERE r.key = 'v20:mix' AND r.duid = d1.duid('v20', '01/10/2026'))
    AND NOT (SELECT r.payload_rule FROM d1.v20_rows() r WHERE r.key = 'v20:mix' AND r.duid = d1.duid('v20', '02/10/2026'))
    AND NOT (SELECT r.payload_rule FROM d1.v20_rows() r WHERE r.key = 'v20:mix' AND r.duid = d1.duid('v20', '03/10/2026'))
    AND (SELECT r.payload_rule FROM d1.v20_rows() r WHERE r.key = 'v20:mix' AND r.duid = d1.duid('v20', '04/10/2026')),
    'V20 : chaîne décroissante conforme ; chaîne plate et faits décalés non conformes ; sans soldes conforme');
END $$;
SELECT d1.v20();
SELECT 'PASS 45b V20 parité ' || (SELECT count(*) FROM d1.v20_rows() r WHERE NOT r.ambiguous) || ' unités ('
  || (SELECT count(*) FILTER (WHERE r.stored_rule) FROM d1.v20_rows() r WHERE NOT r.ambiguous) || ' conformes, '
  || (SELECT count(*) FILTER (WHERE NOT r.stored_rule) FROM d1.v20_rows() r WHERE NOT r.ambiguous) || ' non conformes) ; '
  || (SELECT count(*) FROM d1.v20_rows() r WHERE r.ambiguous) || ' unités à ordre ambigu refusées (oracle numérique)' AS marker;
SELECT d1.bites('45b M14 garde d''ordre textuelle dans la règle de la charge (C2, V20)',
  ARRAY[d1.m('public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)',
             'GROUP BY (x.value ->> ''source_line_index'')::integer, (x.value ->> ''daily_occurrence_ordinal'')::integer',
             'GROUP BY x.value ->> ''source_line_index'', x.value ->> ''daily_occurrence_ordinal''')],
  $$SELECT d1.v20()$$);

SELECT 'PASS 45b_d1_deposit_rules' AS marker;
ROLLBACK;
