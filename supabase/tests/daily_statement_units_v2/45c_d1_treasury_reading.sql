-- D1 : lecture « Soldes à date » (lecteur réel treasury_balances_at_v1, inchangé)
-- après des dépôts et décisions réels (matrice T1 à T7 du cadrage R2, oracle Q6
-- fixé avant exécution, équivalents synthétiques CD et CF de la simulation R2).
-- Réceptions simulées : fichier du jour D déposé le D à 17:00, revue le
-- lendemain à 08:00 (Dakar = UTC) ; l'ordre des décisions suit l'ordre des
-- revues. Aucun relevé réel : calendriers d'opérations inventés.
-- Transaction annulée en fin de suite.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION d1.ok(p_condition boolean, p_label text) RETURNS void LANGUAGE sql AS $$
  SELECT tr_test.assert(p_condition, '45c ' || p_label) $$;
-- Lecture réduite à l'état du compte (statut, solde, motifs, dates, constats,
-- compteurs), sans la liste des preuves.
CREATE FUNCTION d1.core(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p -> 'status', 'balance', p -> 'balance_at_date', 'reasons', p -> 'reasons',
    'dates', p -> 'dates', 'findings', p -> 'findings', 'counters', p -> 'counters') $$;
CREATE FUNCTION d1.eq(p_actual jsonb, p_expected jsonb, p_label text) RETURNS void LANGUAGE sql AS $$
  SELECT tr_test.assert_eq(d1.strip(p_actual)::text, d1.strip(p_expected)::text, '45c ' || p_label) $$;
-- Fichier construit sur un calendrier : journées de p_from à p_to.
CREATE FUNCTION d1.f(p_account text, p_file text, p_cal jsonb, p_from text, p_to text, p_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.mk(p_account, p_file, d1.days(p_cal, p_from::date, p_to::date), p_ref) $$;
CREATE FUNCTION d1.cal_with(p_cal jsonb, p_day text, p_ops jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p_cal, ARRAY['days', p_day], p_ops) $$;

-- --------------------------------------------------------------------------
-- T3 : oracle Q6 (fixé avant exécution ; variante R et, sans D1, la colonne
-- « avant D1 »). ORABANK, une opération par jour.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.q6_cal() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"start": 1000, "days": {"2026-10-06": [["a", 100]], "2026-10-07": [["b", 10]], "2026-10-08": [["c", 20]],
    "2026-10-09": [["d", 5]], "2026-10-10": [["e", 3]], "2026-10-11": [["f", 2]], "2026-10-12": [["g", 1]]}}'::jsonb $$;
-- E1 à E4 : F08, approbation du 06 et du 07, F09, approbation du 08.
CREATE FUNCTION d1.q6_e1_e4(p_tag text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':f08', d1.f(p_tag, 'f08', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_tag || ':f08', '06/10/2026');
  PERFORM d1.promote(p_tag || ':f08', '07/10/2026');
  PERFORM d1.dep(p_tag || ':f09', d1.f(p_tag, 'f09', d1.q6_cal(), '2026-10-06', '2026-10-09'), d1.at('2026-10-09 17:00'));
  PERFORM d1.promote(p_tag || ':f09', '08/10/2026');
  v := d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'Q6 E4');
  PERFORM d1.ok(v ->> 'balance_at_date' = '1130.00', 'Q6 E4 : solde du 08 = 1130.00');
  RETURN v;
END $$;
CREATE FUNCTION d1.t3(p_tag text, p_with_d1 boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_e4 jsonb; v_e5 jsonb; v_src_e4 jsonb; v_e7 jsonb; v_vk08 text;
BEGIN
  v_e4 := d1.q6_e1_e4(p_tag);
  v_vk08 := d1.cvkey(d1.canon(p_tag, '08/10/2026'));
  v_src_e4 := d1.sources(d1.duid(p_tag, '08/10/2026'), v_vk08);
  PERFORM d1.ok(jsonb_array_length(v_src_e4) = 1
    AND (v_src_e4 -> 0 ->> 'first_seen_at')::timestamptz = d1.at('2026-10-09 17:00'), 'Q6 E4 : une source de V08, reçue le 09/10');
  -- E5 : F08bis, nouvelle empreinte brute, première arrivée le 20/10.
  PERFORM d1.dep(p_tag || ':f08bis', d1.f(p_tag, 'f08bis', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-20 17:00'));
  IF p_with_d1 THEN
    v_e5 := d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'Q6 E5 (R)');
    PERFORM d1.eq(v_e5, v_e4, 'Q6 E5 (R) : lecture du 08 identique à E4');
    PERFORM d1.ok(d1.status(d1.unit(p_tag || ':f08bis', '08/10/2026')) = 'superseded', 'Q6 E5 (R) : F08bis retirée');
  ELSE
    PERFORM d1.check(p_tag, '08/10/2026', 'NOT_COVERED', 'DAY_CONTESTED', 'Q6 E5 (avant D1)');
  END IF;
  PERFORM d1.ok(d1.sources(d1.duid(p_tag, '08/10/2026'), v_vk08) = v_src_e4,
    'Q6 E5 : première réception des sources de V08 inchangée (09/10)');
  -- E6 : F_c (06-12), le 08 en V08'' (opération x) : contradiction.
  PERFORM d1.dep(p_tag || ':fc', d1.f(p_tag, 'fc', d1.cal_with(d1.q6_cal(), '2026-10-08', '[["c", 20], ["x", 7]]'),
    '2026-10-06', '2026-10-12'), d1.at('2026-10-22 17:00'));
  PERFORM d1.check(p_tag, '08/10/2026', 'BLOCKED', 'DAY_CONFLICT', 'Q6 E6');
  -- E7 : le 23/10 à 08:00, approbation groupée de F_c puis remplacement du 08.
  PERFORM d1.batch(p_tag || ':fc', 'd1-q6-batch-' || p_tag);
  PERFORM d1.supersede(p_tag, '08/10/2026', p_tag || ':fc');
  v_e7 := d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'Q6 E7');
  PERFORM d1.ok(v_e7 ->> 'balance_at_date' = '1137.00', 'Q6 E7 : solde corrigé du 08 = 1137.00');
  PERFORM d1.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_e7 -> 'findings') f
    WHERE f ->> 'kind' = 'REFUTED_VERSION' AND (f ->> 'automatic')::boolean), 'Q6 E7 : réfutation automatique effective (12 > 09)');
  PERFORM d1.ok(d1.d1_events_account(p_tag) = CASE WHEN p_with_d1 THEN 1 ELSE 0 END, 'Q6 : événements D1 attendus');
END $$;

-- Variante R1 du CTO : F08bis déposé trois fois, puis correction ultérieure.
-- Attendus calculés depuis les règles : avec D1, une copie de lignes, aucune
-- nouvelle source, E7 disponible ; sans D1, les deux redépôts deviennent des
-- doublons R1-provisional, donc une source reçue le 20/10 : E7 en conflit.
CREATE FUNCTION d1.t3r(p_tag text, p_with_d1 boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_vk08 text; v_t text;
BEGIN
  PERFORM d1.q6_e1_e4(p_tag);
  v_vk08 := d1.cvkey(d1.canon(p_tag, '08/10/2026'));
  FOREACH v_t IN ARRAY ARRAY['17:00', '17:10', '17:20'] LOOP
    PERFORM d1.dep(p_tag || ':f08bis-' || v_t, d1.f(p_tag, 'f08bis', d1.q6_cal(), '2026-10-06', '2026-10-08'),
      d1.at('2026-10-20 ' || v_t));
  END LOOP;
  PERFORM d1.ok((SELECT sum(d1.nlines(d1.unit(p_tag || ':f08bis-' || t, '08/10/2026'))) FROM unnest(ARRAY['17:00', '17:10', '17:20']) t) = 1,
    'Q6 redépôts : une seule copie des lignes du 08 pour trois réceptions');
  IF p_with_d1 THEN
    PERFORM d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'Q6 redépôts E5 (R)');
    PERFORM d1.ok(jsonb_array_length(d1.sources(d1.duid(p_tag, '08/10/2026'), v_vk08)) = 1,
      'Q6 redépôts (R) : aucune nouvelle source de V08');
  ELSE
    PERFORM d1.check(p_tag, '08/10/2026', 'NOT_COVERED', 'DAY_CONTESTED', 'Q6 redépôts E5 (avant D1)');
    PERFORM d1.ok(jsonb_array_length(d1.sources(d1.duid(p_tag, '08/10/2026'), v_vk08)) = 2,
      'Q6 redépôts (avant D1) : le fichier tardif devient une source de V08');
  END IF;
  PERFORM d1.dep(p_tag || ':fc', d1.f(p_tag, 'fc', d1.cal_with(d1.q6_cal(), '2026-10-08', '[["c", 20], ["x", 7]]'),
    '2026-10-06', '2026-10-12'), d1.at('2026-10-22 17:00'));
  PERFORM d1.batch(p_tag || ':fc', 'd1-q6r-batch-' || p_tag);
  PERFORM d1.supersede(p_tag, '08/10/2026', p_tag || ':fc');
  IF p_with_d1 THEN
    PERFORM d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'Q6 redépôts E7 (R)');
  ELSE
    PERFORM d1.check(p_tag, '08/10/2026', 'BLOCKED', 'DAY_CONFLICT', 'Q6 redépôts E7 (avant D1)');
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- T1 : équivalent synthétique de B-17 : fichiers quotidiens du 06 au 11,
-- approbations chaque matin, puis l'ancien fichier du 08 reçu le 15/10.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.t1(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cal jsonb := d1.q6_cal(); v_day integer; v_before jsonb := '{}'::jsonb; v_d text;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  FOR v_day IN 6 .. 11 LOOP
    PERFORM d1.dep(p_tag || ':f' || v_day, d1.f(p_tag, 'f' || v_day, v_cal, '2026-10-06', '2026-10-' || lpad(v_day::text, 2, '0')),
      d1.at('2026-10-' || lpad(v_day::text, 2, '0') || ' 17:00'));
    IF v_day > 6 THEN
      PERFORM d1.promote(p_tag || ':f' || v_day, lpad((v_day - 1)::text, 2, '0') || '/10/2026');
    END IF;
  END LOOP;
  FOREACH v_d IN ARRAY ARRAY['08/10/2026', '09/10/2026', '10/10/2026'] LOOP
    v_before := v_before || jsonb_build_object(v_d, d1.check(p_tag, v_d, 'AVAILABLE', NULL, 'T1 avant'));
  END LOOP;
  PERFORM d1.dep(p_tag || ':old08', d1.f(p_tag, 'old08', v_cal, '2026-10-06', '2026-10-08'), d1.at('2026-10-15 17:00'));
  FOREACH v_d IN ARRAY ARRAY['08/10/2026', '09/10/2026', '10/10/2026'] LOOP
    PERFORM d1.eq(d1.read(p_tag, v_d), v_before -> v_d, 'T1 : lecture du ' || v_d || ' identique avant et après le fichier tardif');
  END LOOP;
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':old08', '08/10/2026')) = 'superseded' AND d1.d1_events_account(p_tag) = 1,
    'T1 : la livraison tardive du 08 est retirée');
END $$;

-- --------------------------------------------------------------------------
-- T2 : ordres de Q5. Fold (08, provisoire) et Fclose (08 clos, 09).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.t2_cal() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"start": 1000, "days": {"2026-10-08": [["c", 20]], "2026-10-09": [["d", 5]]}}'::jsonb $$;
CREATE FUNCTION d1.t2_run(p_account text, p_order text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.account(p_account, 'ORA');
  IF p_order = 'O1' THEN
    PERFORM d1.dep(p_account || ':old', d1.f(p_account, 'old', d1.t2_cal(), '2026-10-08', '2026-10-08'), d1.at('2026-10-08 17:00'));
    PERFORM d1.dep(p_account || ':close', d1.f(p_account, 'close', d1.t2_cal(), '2026-10-08', '2026-10-09'), d1.at('2026-10-09 17:00'));
    PERFORM d1.promote(p_account || ':close', '08/10/2026');
  ELSIF p_order = 'O2' THEN
    PERFORM d1.dep(p_account || ':close', d1.f(p_account, 'close', d1.t2_cal(), '2026-10-08', '2026-10-09'), d1.at('2026-10-09 17:00'));
    PERFORM d1.dep(p_account || ':old', d1.f(p_account, 'old', d1.t2_cal(), '2026-10-08', '2026-10-08'), d1.at('2026-10-09 18:00'));
    PERFORM d1.promote(p_account || ':close', '08/10/2026');
  ELSE
    PERFORM d1.dep(p_account || ':close', d1.f(p_account, 'close', d1.t2_cal(), '2026-10-08', '2026-10-09'), d1.at('2026-10-09 17:00'));
    PERFORM d1.promote(p_account || ':close', '08/10/2026');
    PERFORM d1.dep(p_account || ':old', d1.f(p_account, 'old', d1.t2_cal(), '2026-10-08', '2026-10-08'), d1.at('2026-10-10 17:00'));
  END IF;
END $$;
CREATE FUNCTION d1.t2(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_o text; v_ref8 jsonb; v_ref9 jsonb; v_old uuid;
BEGIN
  FOREACH v_o IN ARRAY ARRAY['O1', 'O2', 'O3'] LOOP
    PERFORM d1.t2_run(p_tag || lower(v_o), v_o);
  END LOOP;
  v_ref8 := d1.check(p_tag || 'o3', '08/10/2026', 'AVAILABLE', NULL, 'T2 O3');
  v_ref9 := d1.read(p_tag || 'o3', '09/10/2026');
  FOREACH v_o IN ARRAY ARRAY['O1', 'O2', 'O3'] LOOP
    v_old := d1.unit(p_tag || lower(v_o) || ':old', '08/10/2026');
    PERFORM d1.ok(d1.status(v_old) = 'superseded' AND d1.nlines(v_old) = 1 AND d1.live(p_tag || lower(v_o), '08/10/2026') = 0
      AND d1.day_lines(p_tag || lower(v_o), '08/10/2026') = 2, 'T2 ' || v_o || ' : livraison tardive retirée, lignes et volume identiques');
    PERFORM d1.ok((SELECT jsonb_agg(x - 'raw_text_hash' - 'account_registry_id') FROM jsonb_array_elements(
        d1.sources(d1.duid(p_tag || lower(v_o), '08/10/2026'), d1.cvkey(d1.canon(p_tag || lower(v_o), '08/10/2026')))) x)
      = jsonb_build_array(jsonb_build_object('first_seen_at', d1.at('2026-10-09 17:00'))), 'T2 ' || v_o || ' : mêmes sources');
    PERFORM d1.eq(d1.read(p_tag || lower(v_o), '08/10/2026'), v_ref8, 'T2 ' || v_o || ' : lecture du 08 identique aux autres ordres');
    PERFORM d1.eq(d1.read(p_tag || lower(v_o), '09/10/2026'), v_ref9, 'T2 ' || v_o || ' : lecture du 09 identique aux autres ordres');
  END LOOP;
  PERFORM d1.ok((SELECT (d1.d1_event(d1.unit(p_tag || 'o2:old', '08/10/2026'))).safe_details ->> 'resolution') = 'retired_at_activation'
    AND (SELECT (d1.d1_event(d1.unit(p_tag || 'o3:old', '08/10/2026'))).safe_details ->> 'resolution') = 'retired_at_deposit_lines_stored'
    AND d1.d1_events_account(p_tag || 'o1') = 0, 'T2 : O1 balayée par la clôture, O2 retirée à la promotion, O3 au dépôt');
END $$;

-- --------------------------------------------------------------------------
-- T4 : canonical présent n'est pas journée prouvée close (BDK, référence).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.t4(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cal jsonb := '{"start": 100, "days": {"2026-10-07": [["k", 10]], "2026-10-08": [["m", 5]], "2026-10-09": [["n", 1]]}}';
        v_nc jsonb; v_nw jsonb;
BEGIN
  -- Compte sans preuve de clôture du 08.
  PERFORM d1.account(p_tag || 'nc', 'BDK');
  PERFORM d1.dep(p_tag || 'nc:f', d1.f(p_tag || 'nc', 'f', v_cal, '2026-10-07', '2026-10-08', '09/10/2026'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_tag || 'nc:f', '07/10/2026');
  PERFORM d1.promote(p_tag || 'nc:f', '08/10/2026');
  v_nc := d1.check(p_tag || 'nc', '08/10/2026', 'NOT_COVERED', 'DAY_NOT_CLOSED', 'T4 sans preuve');
  PERFORM d1.ok(v_nc -> 'retained_unit_at_date' IS NOT NULL AND v_nc -> 'retained_unit_at_date' <> 'null'::jsonb,
    'T4 : canonical présent pour le 08');
  PERFORM d1.dep(p_tag || 'nc:late', d1.f(p_tag || 'nc', 'late', v_cal, '2026-10-08', '2026-10-08', '08/10/2026'), d1.at('2026-10-12 17:00'));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || 'nc:late', '08/10/2026')) = 'superseded', 'T4 : livraison tardive identique retirée');
  PERFORM d1.eq(d1.check(p_tag || 'nc', '08/10/2026', 'NOT_COVERED', 'DAY_NOT_CLOSED', 'T4 sans preuve après'), v_nc,
    'T4 : aucune preuve ni disponibilité ajoutée par la livraison retirée');
  -- Compte témoin, prouvé clos par une ligne ultérieure.
  PERFORM d1.account(p_tag || 'nw', 'BDK');
  PERFORM d1.dep(p_tag || 'nw:f', d1.f(p_tag || 'nw', 'f', v_cal, '2026-10-07', '2026-10-08', '09/10/2026'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_tag || 'nw:f', '07/10/2026');
  PERFORM d1.promote(p_tag || 'nw:f', '08/10/2026');
  PERFORM d1.dep(p_tag || 'nw:g', d1.f(p_tag || 'nw', 'g', v_cal, '2026-10-07', '2026-10-09', '10/10/2026'), d1.at('2026-10-09 17:00'));
  PERFORM d1.promote(p_tag || 'nw:g', '09/10/2026');
  v_nw := d1.check(p_tag || 'nw', '08/10/2026', 'AVAILABLE', NULL, 'T4 témoin');
  PERFORM d1.dep(p_tag || 'nw:late', d1.f(p_tag || 'nw', 'late', v_cal, '2026-10-08', '2026-10-08', '08/10/2026'), d1.at('2026-10-12 17:00'));
  PERFORM d1.eq(d1.read(p_tag || 'nw', '08/10/2026'), v_nw, 'T4 témoin : lecture inchangée');
END $$;

-- --------------------------------------------------------------------------
-- T5 : divergente préservée : la journée reste contestée.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.t5(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cal jsonb := d1.cal_with(d1.q6_cal(), '2026-10-08', '[["c", 20], ["c2", 4]]'); v_div uuid; v_snap text;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':f08', d1.f(p_tag, 'f08', v_cal, '2026-10-06', '2026-10-08'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_tag || ':f08', '06/10/2026');
  PERFORM d1.promote(p_tag || ':f08', '07/10/2026');
  PERFORM d1.dep(p_tag || ':f09', d1.f(p_tag, 'f09', v_cal, '2026-10-06', '2026-10-09'), d1.at('2026-10-09 17:00'));
  PERFORM d1.promote(p_tag || ':f09', '08/10/2026');
  PERFORM d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'T5 avant');
  PERFORM d1.dep(p_tag || ':div', d1.f(p_tag, 'div', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-14 17:00'));
  v_div := d1.unit(p_tag || ':div', '08/10/2026');
  v_snap := d1.snapshot(v_div);
  PERFORM d1.check(p_tag, '08/10/2026', 'NOT_COVERED', 'DAY_CONTESTED', 'T5 divergente');
  PERFORM d1.dep(p_tag || ':same', d1.f(p_tag, 'same', v_cal, '2026-10-06', '2026-10-08'), d1.at('2026-10-15 17:00'));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':same', '08/10/2026')) = 'superseded' AND d1.snapshot(v_div) = v_snap
    AND d1.d1_events(v_div) = 0, 'T5 : identique retirée, divergente intacte');
  PERFORM d1.check(p_tag, '08/10/2026', 'NOT_COVERED', 'DAY_CONTESTED', 'T5 après l''identique');
END $$;

-- --------------------------------------------------------------------------
-- T6 : équivalents synthétiques CD et CF (structures de la simulation R2,
-- aucune donnée réelle). Réfutation refusée tant que la dernière journée livrée
-- par la preuve ne dépasse pas la plus tardive des premières réceptions.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.bdk_cal(p_retained boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('start', 8000, 'days', jsonb_build_object(
    '2026-10-14', '[["k", 40]]'::jsonb,
    '2026-10-15', CASE WHEN p_retained THEN '[["m", 25]]'::jsonb ELSE '[["m", 25], ["y", 15]]'::jsonb END,
    '2026-10-16', '[["n", -10]]'::jsonb, '2026-10-19', '[["o", 5]]'::jsonb, '2026-10-20', '[["p", 3]]'::jsonb,
    '2026-10-30', '[["q", 2]]'::jsonb)) $$;
-- Fichier BDK du jour D, déposé le D à 17:00, référence D+1 (journées closes).
CREATE FUNCTION d1.bdk(p_tag text, p_day integer, p_retained boolean, p_key text DEFAULT NULL, p_at text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.dep(p_tag || ':' || coalesce(p_key, 'f' || p_day),
    d1.f(p_tag, 'f' || p_day, d1.bdk_cal(p_retained), '2026-10-14', to_char(DATE '2026-10-01' + p_day - 1, 'YYYY-MM-DD'),
         d1.dmy(DATE '2026-10-01' + p_day)),
    coalesce(d1.at(p_at), d1.at(to_char(DATE '2026-10-01' + p_day - 1, 'YYYY-MM-DD') || ' 17:00'))) $$;
CREATE FUNCTION d1.ora_cal(p_retained boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('start', 5000, 'days', jsonb_build_object(
    '2026-10-19', '[["p", 100]]'::jsonb,
    '2026-10-20', CASE WHEN p_retained THEN '[["q", 50]]'::jsonb ELSE '[["q", 50], ["x", 30]]'::jsonb END,
    '2026-10-21', '[["r", -20]]'::jsonb, '2026-10-22', '[["s", 10]]'::jsonb, '2026-10-26', '[["t", 5]]'::jsonb,
    '2026-10-27', '[["u", 7]]'::jsonb, '2026-10-30', '[["w", 1]]'::jsonb)) $$;
-- Fichier ORABANK du jour D, déposé le D à 17:00 (dernière journée provisoire).
CREATE FUNCTION d1.ora(p_tag text, p_day integer, p_retained boolean, p_key text DEFAULT NULL, p_at text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT d1.dep(p_tag || ':' || coalesce(p_key, 'f' || p_day),
    d1.f(p_tag, 'f' || p_day, d1.ora_cal(p_retained), '2026-10-19', to_char(DATE '2026-10-01' + p_day - 1, 'YYYY-MM-DD')),
    coalesce(d1.at(p_at), d1.at(to_char(DATE '2026-10-01' + p_day - 1, 'YYYY-MM-DD') || ' 17:00'))) $$;
CREATE FUNCTION d1.dd(p_day integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(p_day::text, 2, '0') || '/10/2026' $$;
CREATE FUNCTION d1.wrong_vkey(p_tag text, p_key text, p_day integer) RETURNS text LANGUAGE sql AS $$
  SELECT d1.vkey(d1.unit(p_tag || ':' || p_key, d1.dd(p_day))) $$;

CREATE FUNCTION d1.t6_bdk_cd(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v15w text; v16w text; v_day text;
BEGIN
  PERFORM d1.account(p_tag, 'BDK');
  PERFORM d1.bdk(p_tag, 15, true);                                     -- rétention : 15 sans l'opération y
  PERFORM d1.promote(p_tag || ':f15', d1.dd(14));                       -- 16/10 08:00
  PERFORM d1.promote(p_tag || ':f15', d1.dd(15));
  PERFORM d1.bdk(p_tag, 16, true);
  PERFORM d1.promote(p_tag || ':f16', d1.dd(16));                       -- 17/10 08:00
  PERFORM d1.check(p_tag, d1.dd(15), 'AVAILABLE', NULL, 'BDK CD rétention : 15 disponible');
  v15w := d1.wrong_vkey(p_tag, 'f15', 15);
  v16w := d1.wrong_vkey(p_tag, 'f16', 16);
  PERFORM d1.bdk(p_tag, 17, false);                                    -- réintégration
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':f17', d1.dd(15))) = 'conflict', 'BDK CD : 15 en conflit au fichier du 17');
  PERFORM d1.check(p_tag, d1.dd(15), 'BLOCKED', 'DAY_CONFLICT', 'BDK CD réintégration : 15 bloquée');
  -- 18/10 08:00 : remplacement, correction des soldes, réfutation refusée.
  PERFORM d1.supersede(p_tag, d1.dd(15), p_tag || ':f17');
  PERFORM d1.balances('d1-bdkcd-bal-' || p_tag, p_tag, d1.dd(16), p_tag || ':f17');
  PERFORM d1.ok(d1.refute('d1-bdkcd-r15-18-' || p_tag, p_tag, d1.dd(15), v15w, d1.unit(p_tag || ':f17', d1.dd(15)))
    = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'BDK CD : 18/10 refus pour le 15 (preuve jusqu''au 16)');
  PERFORM d1.ok(d1.refute('d1-bdkcd-r16-18-' || p_tag, p_tag, d1.dd(16), v16w, d1.unit(p_tag || ':f17', d1.dd(16)))
    = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'BDK CD : 18/10 refus pour le 16');
  PERFORM d1.check(p_tag, d1.dd(15), 'BLOCKED', 'DAY_CONFLICT', 'BDK CD 18/10 : 15 bloquée');
  PERFORM d1.bdk(p_tag, 18, false);
  PERFORM d1.ok(d1.refute('d1-bdkcd-r15-19-' || p_tag, p_tag, d1.dd(15), v15w, d1.unit(p_tag || ':f18', d1.dd(15)))
    = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'BDK CD : 19/10 refus pour le 15');
  PERFORM d1.ok(d1.refute('d1-bdkcd-r16-19-' || p_tag, p_tag, d1.dd(16), v16w, d1.unit(p_tag || ':f18', d1.dd(16)))
    = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'BDK CD : 19/10 refus pour le 16');
  PERFORM d1.bdk(p_tag, 19, false);
  PERFORM d1.promote(p_tag || ':f19', d1.dd(19));                       -- 20/10 08:00
  PERFORM d1.ok(d1.refute('d1-bdkcd-r15-20-' || p_tag, p_tag, d1.dd(15), v15w, d1.unit(p_tag || ':f19', d1.dd(15))) = 'refuted',
    'BDK CD : 20/10 acceptation pour le 15 (fichier du 19)');
  PERFORM d1.ok(d1.refute('d1-bdkcd-r16-20-' || p_tag, p_tag, d1.dd(16), v16w, d1.unit(p_tag || ':f19', d1.dd(16))) = 'refuted',
    'BDK CD : 20/10 acceptation pour le 16');
  FOREACH v_day IN ARRAY ARRAY[d1.dd(15), d1.dd(16)] LOOP
    PERFORM d1.check(p_tag, v_day, 'AVAILABLE', NULL, 'BDK CD corrigée');
  END LOOP;
  PERFORM d1.ok(d1.d1_events_account(p_tag) = 0, 'BDK CD : aucun événement D1');
END $$;

CREATE FUNCTION d1.t6_ora_cd(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v20w text; v21w text; v_d integer; v_proof text;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.ora(p_tag, 20, true);
  PERFORM d1.promote(p_tag || ':f20', d1.dd(19));                       -- 21/10 08:00
  PERFORM d1.ora(p_tag, 21, true);
  PERFORM d1.promote(p_tag || ':f21', d1.dd(20));                       -- 22/10 08:00
  PERFORM d1.ora(p_tag, 22, true);
  PERFORM d1.promote(p_tag || ':f22', d1.dd(21));                       -- 23/10 08:00
  PERFORM d1.check(p_tag, d1.dd(20), 'AVAILABLE', NULL, 'ORA CD rétention : 20 disponible');
  v20w := d1.wrong_vkey(p_tag, 'f21', 20);
  v21w := d1.wrong_vkey(p_tag, 'f22', 21);
  PERFORM d1.ora(p_tag, 23, false);                                    -- réintégration (aucune opération le 23)
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':f23', d1.dd(20))) = 'conflict', 'ORA CD : 20 en conflit au fichier du 23');
  PERFORM d1.check(p_tag, d1.dd(20), 'BLOCKED', 'DAY_CONFLICT', 'ORA CD réintégration : 20 bloquée');
  PERFORM d1.supersede(p_tag, d1.dd(20), p_tag || ':f23');             -- 24/10 08:00
  PERFORM d1.balances('d1-oracd-bal-' || p_tag, p_tag, d1.dd(21), p_tag || ':f23');
  FOREACH v_d IN ARRAY ARRAY[24, 25, 26] LOOP
    v_proof := 'f' || (v_d - 1);
    PERFORM d1.ok(d1.refute('d1-oracd-r20-' || v_d || '-' || p_tag, p_tag, d1.dd(20), v20w, d1.unit(p_tag || ':' || v_proof, d1.dd(20)))
      = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'ORA CD : ' || v_d || '/10 refus pour le 20 (preuve jusqu''au 22)');
    PERFORM d1.ok(d1.refute('d1-oracd-r21-' || v_d || '-' || p_tag, p_tag, d1.dd(21), v21w, d1.unit(p_tag || ':' || v_proof, d1.dd(21)))
      = 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED', 'ORA CD : ' || v_d || '/10 refus pour le 21');
    IF v_d < 26 THEN PERFORM d1.ora(p_tag, v_d, false); END IF;
  END LOOP;
  PERFORM d1.check(p_tag, d1.dd(20), 'BLOCKED', 'DAY_CONFLICT', 'ORA CD 26/10 : 20 bloquée');
  PERFORM d1.ora(p_tag, 26, false);                                    -- le 26 porte une opération (provisoire)
  PERFORM d1.promote(p_tag || ':f26', d1.dd(22));                       -- 27/10 08:00
  PERFORM d1.ok(d1.refute('d1-oracd-r20-27-' || p_tag, p_tag, d1.dd(20), v20w, d1.unit(p_tag || ':f26', d1.dd(20))) = 'refuted',
    'ORA CD : 27/10 acceptation pour le 20 (fichier du 26, journée provisoire comptée)');
  PERFORM d1.ok(d1.refute('d1-oracd-r21-27-' || p_tag, p_tag, d1.dd(21), v21w, d1.unit(p_tag || ':f26', d1.dd(21))) = 'refuted',
    'ORA CD : 27/10 acceptation pour le 21');
  PERFORM d1.check(p_tag, d1.dd(20), 'AVAILABLE', NULL, 'ORA CD corrigée : 20');
  PERFORM d1.check(p_tag, d1.dd(21), 'AVAILABLE', NULL, 'ORA CD corrigée : 21');
  PERFORM d1.ok(d1.d1_events_account(p_tag) = 0, 'ORA CD : aucun événement D1');
END $$;

CREATE FUNCTION d1.t6_bdk_cf(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v15w text; v16w text; v_before15 jsonb; v_before16 jsonb;
BEGIN
  PERFORM d1.account(p_tag, 'BDK');
  PERFORM d1.bdk(p_tag, 15, true);
  PERFORM d1.promote(p_tag || ':f15', d1.dd(14));
  PERFORM d1.promote(p_tag || ':f15', d1.dd(15));
  PERFORM d1.bdk(p_tag, 16, true);
  PERFORM d1.promote(p_tag || ':f16', d1.dd(16));
  v15w := d1.wrong_vkey(p_tag, 'f15', 15);
  v16w := d1.wrong_vkey(p_tag, 'f16', 16);
  PERFORM d1.bdk(p_tag, 17, false);
  PERFORM d1.bdk(p_tag, 19, false);
  PERFORM d1.promote(p_tag || ':f19', d1.dd(19));
  PERFORM d1.bdk(p_tag, 31, false);
  PERFORM d1.check(p_tag, d1.dd(15), 'BLOCKED', 'DAY_CONFLICT', 'BDK CF 31/10 : 15 bloquée, sans correction');
  -- 01/11 08:00 : approbation courante des journées nouvelles du fichier du 31
  -- (20 et 30 : un fichier dont une livraison reste en attente n'est pas digne
  -- de preuve), remplacement par la livraison en conflit la plus récente,
  -- correction des soldes par la première copie conservée (H1), réfutation avec
  -- la preuve du fichier du 31 (dernière journée livrée : 30).
  PERFORM d1.promote(p_tag || ':f31', d1.dd(20));
  PERFORM d1.promote(p_tag || ':f31', d1.dd(30));
  PERFORM d1.supersede(p_tag, d1.dd(15), p_tag || ':f31');
  PERFORM d1.balances('d1-bdkcf-bal-' || p_tag, p_tag, d1.dd(16), p_tag || ':f17');
  PERFORM d1.ok(d1.refute('d1-bdkcf-r15-' || p_tag, p_tag, d1.dd(15), v15w, d1.unit(p_tag || ':f31', d1.dd(15))) = 'refuted',
    'BDK CF : 01/11 acceptation pour le 15 (fichier du 31)');
  PERFORM d1.ok(d1.refute('d1-bdkcf-r16-' || p_tag, p_tag, d1.dd(16), v16w, d1.unit(p_tag || ':f31', d1.dd(16))) = 'refuted',
    'BDK CF : 01/11 acceptation pour le 16');
  v_before15 := d1.check(p_tag, d1.dd(15), 'AVAILABLE', NULL, 'BDK CF corrigée : 15');
  v_before16 := d1.check(p_tag, d1.dd(16), 'AVAILABLE', NULL, 'BDK CF corrigée : 16');
  PERFORM d1.bdk(p_tag, 31, false, 'f31-redepot', '2026-11-01 09:00');  -- redépôt du fichier du 31
  PERFORM d1.eq(d1.core(d1.read(p_tag, d1.dd(15))), d1.core(v_before15), 'BDK CF : redépôt du 31 sans effet sur l''état du 15');
  PERFORM d1.eq(d1.core(d1.read(p_tag, d1.dd(16))), d1.core(v_before16), 'BDK CF : redépôt du 31 sans effet sur l''état du 16');
  PERFORM d1.ok((SELECT count(*) FROM public.daily_statement_units_staging WHERE day_unit_id = d1.duid(p_tag, d1.dd(15))
    AND status = 'conflict') = 2, 'BDK CF : deux livraisons en conflit résiduelles (O2, fichiers du 17 et du 19)');
  PERFORM d1.ok(d1.d1_events_account(p_tag) = 0, 'BDK CF : aucun événement D1');
END $$;

CREATE FUNCTION d1.t6_ora_cf(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v20w text; v21w text; v_before20 jsonb; v_before21 jsonb;
BEGIN
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.ora(p_tag, 20, true);
  PERFORM d1.promote(p_tag || ':f20', d1.dd(19));
  PERFORM d1.ora(p_tag, 21, true);
  PERFORM d1.promote(p_tag || ':f21', d1.dd(20));
  PERFORM d1.ora(p_tag, 22, true);
  PERFORM d1.promote(p_tag || ':f22', d1.dd(21));
  v20w := d1.wrong_vkey(p_tag, 'f21', 20);
  v21w := d1.wrong_vkey(p_tag, 'f22', 21);
  PERFORM d1.ora(p_tag, 23, false);
  PERFORM d1.ora(p_tag, 26, false);
  PERFORM d1.promote(p_tag || ':f26', d1.dd(22));                       -- 27/10 08:00, approbation courante
  PERFORM d1.ora(p_tag, 31, false);
  PERFORM d1.check(p_tag, d1.dd(20), 'BLOCKED', 'DAY_CONFLICT', 'ORA CF 31/10 : 20 bloquée, sans correction');
  PERFORM d1.promote(p_tag || ':f31', d1.dd(26));                       -- 01/11 08:00
  PERFORM d1.promote(p_tag || ':f31', d1.dd(27));
  PERFORM d1.supersede(p_tag, d1.dd(20), p_tag || ':f31');
  PERFORM d1.balances('d1-oracf-bal-' || p_tag, p_tag, d1.dd(21), p_tag || ':f23');
  PERFORM d1.ok(d1.refute('d1-oracf-r20-' || p_tag, p_tag, d1.dd(20), v20w, d1.unit(p_tag || ':f31', d1.dd(20))) = 'refuted',
    'ORA CF : 01/11 acceptation pour le 20 (fichier du 31)');
  PERFORM d1.ok(d1.refute('d1-oracf-r21-' || p_tag, p_tag, d1.dd(21), v21w, d1.unit(p_tag || ':f31', d1.dd(21))) = 'refuted',
    'ORA CF : 01/11 acceptation pour le 21');
  v_before20 := d1.check(p_tag, d1.dd(20), 'AVAILABLE', NULL, 'ORA CF corrigée : 20');
  v_before21 := d1.check(p_tag, d1.dd(21), 'AVAILABLE', NULL, 'ORA CF corrigée : 21');
  PERFORM d1.ora(p_tag, 31, false, 'f31-redepot', '2026-11-01 09:00');
  PERFORM d1.eq(d1.core(d1.read(p_tag, d1.dd(20))), d1.core(v_before20), 'ORA CF : redépôt du 31 sans effet sur l''état du 20');
  PERFORM d1.eq(d1.core(d1.read(p_tag, d1.dd(21))), d1.core(v_before21), 'ORA CF : redépôt du 31 sans effet sur l''état du 21');
  PERFORM d1.ok(d1.d1_events_account(p_tag) = 0, 'ORA CF : aucun événement D1');
END $$;

-- T7 : non-régression BDK ; une réexportation BDK tardive identique (référence
-- au 16) est retirée sans changer la lecture.
CREATE FUNCTION d1.t7(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v16 jsonb;
BEGIN
  PERFORM d1.t6_bdk_cd(p_tag);
  v16 := d1.check(p_tag, d1.dd(16), 'AVAILABLE', NULL, 'T7 avant');
  PERFORM d1.dep(p_tag || ':reexport', d1.f(p_tag, 'reexport', d1.bdk_cal(false), '2026-10-14', '2026-10-16', '16/10/2026'),
    d1.at('2026-10-21 17:00'));
  PERFORM d1.ok(d1.status(d1.unit(p_tag || ':reexport', d1.dd(16))) = 'superseded'
    AND d1.status(d1.unit(p_tag || ':reexport', d1.dd(15))) = 'duplicate', 'T7 : 16 provisoire identique retirée, 15 doublon');
  PERFORM d1.eq(d1.read(p_tag, d1.dd(16)), v16, 'T7 : lecture du 16 inchangée');
END $$;

-- --------------------------------------------------------------------------
-- C1 (verdict CTO sur l'ancien constat P1-1) : réceptions répétées du fichier
-- tardif autour de l'activation. Critère d'acceptation, attendus fixés avant
-- la correction et identiques dans tous les ordres :
--   - chaque réception du fichier tardif est retirée (un événement D1 chacune,
--     rattaché au canonical de V08) ; aucune provisoire vivante ;
--   - une seule copie de ses lignes (la première réception) : volume du 08 = 3 ;
--   - une seule source de V08 : F09, reçue le 09/10 ;
--   - même lecture du 08 avant la correction (disponible), et après la
--     correction ultérieure du 22/10 (disponible, réfutation automatique).
-- Ordres : A = deux redépôts puis promotion ; B = promotion puis deux
-- redépôts ; C = trois redépôts puis promotion ; D = un redépôt, promotion,
-- un redépôt. Résolution attendue de chaque réception, dans l'ordre de dépôt.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.p11_expected(p_order text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_order
    WHEN 'a' THEN ARRAY['retired_at_activation', 'provisional_duplicate_retired_at_activation']
    WHEN 'b' THEN ARRAY['retired_at_deposit_lines_stored', 'retired_at_deposit_lines_not_restaged']
    WHEN 'c' THEN ARRAY['retired_at_activation', 'provisional_duplicate_retired_at_activation',
                        'provisional_duplicate_retired_at_activation']
    ELSE ARRAY['retired_at_activation', 'retired_at_deposit_lines_not_restaged'] END $$;
CREATE FUNCTION d1.p11_run(p_acc text, p_order text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_before integer := CASE p_order WHEN 'a' THEN 2 WHEN 'b' THEN 0 WHEN 'c' THEN 3 ELSE 1 END;
        v_total integer := cardinality(d1.p11_expected(p_order)); v_k integer;
BEGIN
  PERFORM d1.account(p_acc, 'ORA');
  PERFORM d1.dep(p_acc || ':f08', d1.f(p_acc, 'f08', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_acc || ':f08', '06/10/2026');
  PERFORM d1.promote(p_acc || ':f08', '07/10/2026');
  PERFORM d1.dep(p_acc || ':f09', d1.f(p_acc, 'f09', d1.q6_cal(), '2026-10-06', '2026-10-09'), d1.at('2026-10-09 17:00'));
  FOR v_k IN 1 .. v_total LOOP
    IF v_k = v_before + 1 THEN PERFORM d1.promote(p_acc || ':f09', '08/10/2026'); END IF;
    PERFORM d1.dep(p_acc || ':bis' || v_k, d1.f(p_acc, 'f08bis', d1.q6_cal(), '2026-10-06', '2026-10-08'),
      d1.at('2026-10-20 17:0' || v_k));
  END LOOP;
  IF v_before = v_total THEN PERFORM d1.promote(p_acc || ':f09', '08/10/2026'); END IF;
END $$;
CREATE FUNCTION d1.p11(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_o text; v_acc text; v_exp text[]; v_k integer; u uuid; e public.daily_statement_import_events; v_c08 uuid;
        v_src jsonb; v_read jsonb; v_after jsonb; v_ref_src jsonb; v_ref_read jsonb; v_ref_after jsonb; v_dup boolean;
BEGIN
  FOREACH v_o IN ARRAY ARRAY['a', 'b', 'c', 'd'] LOOP
    v_acc := p_tag || v_o;
    v_exp := d1.p11_expected(v_o);
    PERFORM d1.p11_run(v_acc, v_o);
    v_c08 := d1.canon(v_acc, '08/10/2026');
    FOR v_k IN 1 .. cardinality(v_exp) LOOP
      u := d1.unit(v_acc || ':bis' || v_k, '08/10/2026');
      e := d1.d1_event(u);
      v_dup := v_exp[v_k] LIKE 'provisional_duplicate%';
      PERFORM d1.ok(d1.status(u) = 'superseded' AND d1.d1_events(u) = 1 AND e.event_type = 'status_changed'
        AND e.previous_status = CASE WHEN v_dup THEN 'duplicate' ELSE 'provisional' END AND e.new_status = 'superseded'
        AND e.safe_details ->> 'previous_status' = e.previous_status AND e.canonical_unit_id = v_c08
        AND e.safe_details ->> 'resolution' = v_exp[v_k],
        'C1 ordre ' || upper(v_o) || ' : réception ' || v_k || ' retirée (' || v_exp[v_k] || '), auditée, rattachée à V08');
      PERFORM d1.ok(d1.nlines(u) = CASE WHEN v_k = 1 THEN 1 ELSE 0 END
        AND d1.ev(u, 'unit_duplicate', 'provisional_redeposit_duplicate') = CASE WHEN v_dup THEN 1 ELSE 0 END,
        'C1 ordre ' || upper(v_o) || ' : réception ' || v_k || ' : lignes et événement de réception inchangés');
    END LOOP;
    PERFORM d1.ok(d1.live(v_acc, '08/10/2026') = 0 AND d1.day_lines(v_acc, '08/10/2026') = 3
      AND d1.d1_events_account(v_acc) = cardinality(v_exp),
      'C1 ordre ' || upper(v_o) || ' : aucune provisoire vivante, volume du 08 = 3, un événement D1 par réception');
    v_src := d1.sources(d1.duid(v_acc, '08/10/2026'), d1.cvkey(v_c08));
    PERFORM d1.ok(jsonb_array_length(v_src) = 1 AND v_src -> 0 ->> 'raw_text_hash' = d1.hex64('file|' || v_acc || '|f09')
      AND (v_src -> 0 ->> 'first_seen_at')::timestamptz = d1.at('2026-10-09 17:00'),
      'C1 ordre ' || upper(v_o) || ' : une seule source de V08 (F09, reçue le 09/10)');
    v_read := d1.check(v_acc, '08/10/2026', 'AVAILABLE', NULL, 'C1 ordre ' || upper(v_o) || ' avant correction');
    PERFORM d1.dep(v_acc || ':fc', d1.f(v_acc, 'fc', d1.cal_with(d1.q6_cal(), '2026-10-08', '[["c", 20], ["x", 7]]'),
      '2026-10-06', '2026-10-12'), d1.at('2026-10-22 17:00'));
    PERFORM d1.batch(v_acc || ':fc', 'd1-p11-batch-' || v_acc);
    PERFORM d1.supersede(v_acc, '08/10/2026', v_acc || ':fc');
    v_after := d1.check(v_acc, '08/10/2026', 'AVAILABLE', NULL, 'C1 ordre ' || upper(v_o) || ' après correction');
    PERFORM d1.ok(v_after ->> 'balance_at_date' = '1137.00' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_after -> 'findings') f
      WHERE f ->> 'kind' = 'REFUTED_VERSION' AND (f ->> 'automatic')::boolean),
      'C1 ordre ' || upper(v_o) || ' : correction ultérieure acceptée (réfutation automatique, 12 > 09)');
    v_src := (SELECT jsonb_agg(x - 'raw_text_hash' - 'account_registry_id') FROM jsonb_array_elements(v_src) x);
    IF v_o = 'a' THEN
      v_ref_src := v_src; v_ref_read := v_read; v_ref_after := v_after;
    ELSE
      PERFORM d1.ok(v_src = v_ref_src, 'C1 ordre ' || upper(v_o) || ' : mêmes sources que l''ordre A');
      PERFORM d1.eq(v_read, v_ref_read, 'C1 ordre ' || upper(v_o) || ' : même lecture que l''ordre A avant correction');
      PERFORM d1.eq(v_after, v_ref_after, 'C1 ordre ' || upper(v_o) || ' : même lecture que l''ordre A après correction');
    END IF;
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- W4 puis redépôt conforme de Y (verdict CTO sur W5). Attendus fixés avant la
-- correction :
--   - pendant la fenêtre, X (fichier x) dépose la provisoire du 08 et Y (autre
--     fichier, même contenu) un doublon R1-provisional sans lignes ;
--   - la promotion retire X ; Y reste doublon et source (limite W4 acceptée :
--     aucune copie conforme de y) ;
--   - Y redéposé (même fichier, même version d'analyse) : la réception est
--     retirée et stocke sa copie ; l'ancien doublon Y, désormais justifié, est
--     retiré au dépôt (motif D1, provisional_duplicate_retired_at_deposit) ;
--   - une seule source de V08 (F09, 09/10) ; volume du 08 = 4 ; trois
--     événements D1 ; lecture du 08 disponible ;
--   - correction ultérieure du 22/10 : disponible, 1137.00, réfutation
--     automatique, lecture identique à celle d'un compte sans fichier tardif.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.q6_corrected(p_acc text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM d1.dep(p_acc || ':fc', d1.f(p_acc, 'fc', d1.cal_with(d1.q6_cal(), '2026-10-08', '[["c", 20], ["x", 7]]'),
    '2026-10-06', '2026-10-12'), d1.at('2026-10-22 17:00'));
  PERFORM d1.batch(p_acc || ':fc', 'd1-q6c-batch-' || p_acc);
  PERFORM d1.supersede(p_acc, '08/10/2026', p_acc || ':fc');
  RETURN d1.read(p_acc, '08/10/2026');
END $$;
CREATE FUNCTION d1.w4y(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; y uuid; ry uuid; c08 uuid; e public.daily_statement_import_events; v_src jsonb; v_after jsonb; v_ref jsonb;
BEGIN
  -- Témoin : même calendrier, sans fichier tardif, puis même correction.
  PERFORM d1.q6_e1_e4(p_tag || 'ref');
  v_ref := d1.q6_corrected(p_tag || 'ref');
  -- Compte observé.
  PERFORM d1.account(p_tag, 'ORA');
  PERFORM d1.dep(p_tag || ':f08', d1.f(p_tag, 'f08', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-08 17:00'));
  PERFORM d1.promote(p_tag || ':f08', '06/10/2026');
  PERFORM d1.promote(p_tag || ':f08', '07/10/2026');
  PERFORM d1.dep(p_tag || ':f09', d1.f(p_tag, 'f09', d1.q6_cal(), '2026-10-06', '2026-10-09'), d1.at('2026-10-09 17:00'));
  PERFORM d1.dep(p_tag || ':x', d1.f(p_tag, 'x', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-20 17:01'));
  PERFORM d1.dep(p_tag || ':y', d1.f(p_tag, 'y', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-20 17:02'));
  p := d1.unit(p_tag || ':x', '08/10/2026');
  y := d1.unit(p_tag || ':y', '08/10/2026');
  PERFORM d1.ok(d1.status(p) = 'provisional' AND d1.status(y) = 'duplicate' AND d1.nlines(y) = 0
    AND d1.ev(y, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1, 'W4→Y : provisoire de x, doublon R1-provisional de y');
  PERFORM d1.promote(p_tag || ':f09', '08/10/2026');
  c08 := d1.canon(p_tag, '08/10/2026');
  v_src := d1.sources(d1.duid(p_tag, '08/10/2026'), d1.cvkey(c08));
  PERFORM d1.ok(d1.status(p) = 'superseded' AND d1.status(y) = 'duplicate' AND d1.d1_events(y) = 0
    AND jsonb_array_length(v_src) = 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) s WHERE s ->> 'raw_text_hash' = d1.hex64('file|' || p_tag || '|y')
                AND (s ->> 'first_seen_at')::timestamptz = d1.at('2026-10-20 17:02')),
    'W4→Y : activation : x retirée, y conservé (limite W4), deux sources dont y reçu le 20/10');
  PERFORM d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'W4→Y avant redépôt');
  -- Redépôt conforme de y.
  PERFORM d1.dep(p_tag || ':y2', d1.f(p_tag, 'y', d1.q6_cal(), '2026-10-06', '2026-10-08'), d1.at('2026-10-21 10:00'));
  ry := d1.unit(p_tag || ':y2', '08/10/2026');
  e := d1.d1_event(y);
  PERFORM d1.ok(d1.status(ry) = 'superseded' AND d1.nlines(ry) = 1
    AND (d1.d1_event(ry)).safe_details ->> 'resolution' = 'retired_at_deposit_lines_stored',
    'W4→Y : redépôt de y retiré, copie de ses lignes stockée');
  PERFORM d1.ok(d1.status(y) = 'superseded' AND d1.nlines(y) = 0 AND d1.d1_events(y) = 1
    AND e.previous_status = 'duplicate' AND e.new_status = 'superseded'
    AND e.safe_details ->> 'resolution' = 'provisional_duplicate_retired_at_deposit'
    AND e.canonical_unit_id = c08 AND e.attempt_id = d1.attempt(p_tag || ':y2')
    AND d1.ev(y, 'unit_duplicate', 'provisional_redeposit_duplicate') = 1,
    'W4→Y : ancien doublon de y retiré au dépôt, audité (canonical V08, tentative du redépôt), réception tracée');
  v_src := d1.sources(d1.duid(p_tag, '08/10/2026'), d1.cvkey(c08));
  PERFORM d1.ok(jsonb_array_length(v_src) = 1 AND v_src -> 0 ->> 'raw_text_hash' = d1.hex64('file|' || p_tag || '|f09')
    AND (v_src -> 0 ->> 'first_seen_at')::timestamptz = d1.at('2026-10-09 17:00'),
    'W4→Y : une seule source de V08 (F09, reçue le 09/10)');
  PERFORM d1.ok(d1.live(p_tag, '08/10/2026') = 0 AND d1.day_lines(p_tag, '08/10/2026') = 4 AND d1.d1_events_account(p_tag) = 3,
    'W4→Y : aucune provisoire vivante, volume du 08 = 4, trois événements D1 (x, redépôt, doublon)');
  PERFORM d1.check(p_tag, '08/10/2026', 'AVAILABLE', NULL, 'W4→Y après redépôt');
  -- Correction ultérieure.
  v_after := d1.q6_corrected(p_tag);
  PERFORM d1.ok(v_after ->> 'status' = 'AVAILABLE' AND v_after ->> 'balance_at_date' = '1137.00'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_after -> 'findings') f
                WHERE f ->> 'kind' = 'REFUTED_VERSION' AND (f ->> 'automatic')::boolean),
    'W4→Y : correction ultérieure acceptée (disponible, 1137.00, réfutation automatique)');
  PERFORM d1.eq(v_after, v_ref, 'W4→Y : lecture après correction identique à celle du compte sans fichier tardif');
END $$;

-- P2-1 (arbitrage CTO : coexistence acceptée ; caractérisation, pas critère de
-- convergence) : une divergente puis une identique pendant la fenêtre. Avant
-- l'activation, le cycle provisoire garde sa règle de remplacement (le
-- balayage 0Z de redépôt écarte la divergente), la promotion retire
-- l'identique : la journée est disponible. Après l'activation, la protection
-- des divergentes s'applique (Q4) : la divergente déposée après la promotion
-- est préservée et la journée reste contestée.
CREATE FUNCTION d1.c_p21(p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_d06 jsonb := '{"d": "06/10/2026", "o": 1000.00, "ops": [["a", 100.50], ["b", -30.25]]}';
        v_div jsonb := '{"d": "06/10/2026", "o": 1000.00, "ops": [["a", 100.50]]}';
        v_o text;
BEGIN
  FOREACH v_o IN ARRAY ARRAY['a', 'b'] LOOP
    PERFORM d1.account(p_tag || v_o, 'ORA');
    PERFORM d1.dep(p_tag || v_o || ':fc', d1.mk(p_tag || v_o, 'fc', jsonb_build_array(
      '{"d": "05/10/2026", "o": 900, "ops": [["z", 100]]}'::jsonb, v_d06, '{"d": "07/10/2026", "o": 1070.25, "ops": [["c", 50]]}'::jsonb)),
      d1.at('2026-10-07 17:00'));
    PERFORM d1.promote(p_tag || v_o || ':fc', '05/10/2026');
    IF v_o = 'b' THEN PERFORM d1.promote(p_tag || v_o || ':fc', '06/10/2026'); END IF;
    PERFORM d1.dep(p_tag || v_o || ':div', d1.mk(p_tag || v_o, 'div', jsonb_build_array(v_div)), d1.at('2026-10-09 17:00'));
    PERFORM d1.dep(p_tag || v_o || ':same', d1.mk(p_tag || v_o, 'same', jsonb_build_array(v_d06)), d1.at('2026-10-10 17:00'));
    IF v_o = 'a' THEN PERFORM d1.promote(p_tag || v_o || ':fc', '06/10/2026'); END IF;
  END LOOP;
  PERFORM d1.ok(d1.live(p_tag || 'a', '06/10/2026') = 0
    AND d1.ev(d1.unit(p_tag || 'a:div', '06/10/2026'), 'status_changed', 'provisional_superseded_by_redeposit') = 1
    AND d1.status(d1.unit(p_tag || 'a:same', '06/10/2026')) = 'superseded', 'constat P2-1, ordre A : divergente balayée (0Z), identique retirée');
  PERFORM d1.check(p_tag || 'a', '06/10/2026', 'AVAILABLE', NULL, 'constat P2-1, ordre A');
  PERFORM d1.ok(d1.live(p_tag || 'b', '06/10/2026') = 1 AND d1.status(d1.unit(p_tag || 'b:div', '06/10/2026')) = 'provisional'
    AND d1.status(d1.unit(p_tag || 'b:same', '06/10/2026')) = 'superseded', 'constat P2-1, ordre B : divergente préservée, identique retirée');
  PERFORM d1.check(p_tag || 'b', '06/10/2026', 'NOT_COVERED', 'DAY_CONTESTED', 'constat P2-1, ordre B');
END $$;

-- --------------------------------------------------------------------------
-- Exécution nominale, sans D1 (comportement d'avant D1) et mordants.
-- --------------------------------------------------------------------------
SELECT d1.t3('q6', true);
SELECT 'PASS 45c T3 oracle Q6 (R) : E4 disponible, E5 disponible, E6 conflit, E7 disponible (12 > 09)' AS marker;
SELECT d1.without_d1('45c T3 oracle Q6 colonne avant D1 : E5 contestée, E6 conflit, E7 disponible', $$SELECT d1.t3('q6n', false)$$);
SELECT d1.t3r('q6r', true);
SELECT 'PASS 45c T3 redépôts (R) : une copie, aucune nouvelle source, E7 disponible après correction' AS marker;
SELECT d1.without_d1('45c T3 redépôts avant D1 : source tardive, E7 en conflit', $$SELECT d1.t3r('q6rn', false)$$);
SELECT d1.t1('b17');
SELECT 'PASS 45c T1 B-17 synthétique : lectures du 08 au 10 identiques avant et après' AS marker;
SELECT d1.t2('t2');
SELECT 'PASS 45c T2 ordres O1, O2, O3 : même statut, mêmes lignes, mêmes sources, mêmes lectures' AS marker;
SELECT d1.t4('t4');
SELECT 'PASS 45c T4 canonical présent sans preuve : non clos, aucune disponibilité ajoutée ; témoin disponible' AS marker;
SELECT d1.t5('t5');
SELECT 'PASS 45c T5 divergente préservée : journée contestée' AS marker;
SELECT d1.t6_bdk_cd('bdkcd');
SELECT 'PASS 45c T6 BDK CD : refus 18 et 19/10, acceptation 20/10' AS marker;
SELECT d1.without_d1('45c T6 BDK CD', $$SELECT d1.t6_bdk_cd('bdkcdn')$$);
SELECT d1.t6_ora_cd('oracd');
SELECT 'PASS 45c T6 ORABANK CD : refus 24 à 26/10, acceptation 27/10' AS marker;
SELECT d1.without_d1('45c T6 ORABANK CD', $$SELECT d1.t6_ora_cd('oracdn')$$);
SELECT d1.t6_bdk_cf('bdkcf');
SELECT 'PASS 45c T6 BDK CF : correction du 01/11 avec la preuve du fichier du 31' AS marker;
SELECT d1.without_d1('45c T6 BDK CF', $$SELECT d1.t6_bdk_cf('bdkcfn')$$);
SELECT d1.t6_ora_cf('oracf');
SELECT 'PASS 45c T6 ORABANK CF : correction du 01/11 avec la preuve du fichier du 31' AS marker;
SELECT d1.without_d1('45c T6 ORABANK CF', $$SELECT d1.t6_ora_cf('oracfn')$$);
SELECT d1.t7('t7');
SELECT 'PASS 45c T7 non-régression BDK, réexportation tardive identique retirée' AS marker;
SELECT d1.p11('p11');
SELECT 'PASS 45c C1 réceptions répétées du fichier tardif : ordres A, B, C, D convergents (statuts, lignes, une source, lecture avant et après correction)' AS marker;
SELECT d1.w4y('w4y');
SELECT 'PASS 45c W4 puis redépôt conforme de Y : doublon justifié retiré au dépôt, une source, volume 4, correction ultérieure disponible' AS marker;
SELECT d1.c_p21('p21');
SELECT 'PASS 45c caractérisation P2-1 (coexistence acceptée) : divergente puis identique pendant la fenêtre : ordre A disponible, ordre B contesté' AS marker;

SELECT d1.bites('45c M1 sans retrait au dépôt (T1)',
  ARRAY[d1.m(d1.f1(), 'v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);', 'v_d1_retire := false;')],
  $$SELECT d1.t1('m1')$$);
SELECT d1.bites('45c M4 sans retrait à l''activation (T2)',
  ARRAY[d1.m(d1.f2(), 'PERFORM public.daily_stmt_retire_same_version_provisionals(v_unit.day_unit_id, p_new_canonical_id, p_actor, v_unit.attempt_id, NULL, NULL);', 'NULL;')],
  $$SELECT d1.t2('m4')$$);
SELECT d1.bites('45c M2b balayage général sans postcondition (T5)',
  ARRAY[d1.m(d1.f5(), 'IF public.daily_stmt_provisional_same_version(v_row.id, p_canonical_unit_id) THEN', 'IF true THEN'),
        d1.m(d1.f5(), 'IF v_after IS DISTINCT FROM v_before THEN', 'IF false THEN')],
  $$SELECT d1.t5('m2b')$$);
SELECT d1.bites('45c M10 doublons du cycle provisoire ignorés (C1)',
  ARRAY[d1.m(d1.f5(), 's.status IN (''provisional'', ''duplicate'')', 's.status = ''provisional''')],
  $$SELECT d1.p11('m10')$$);
SELECT d1.bites('45c M16 exclusion des doublons au dépôt réintroduite (W4 puis redépôt de Y)',
  ARRAY[d1.m(d1.f5(), 's.status IN (''provisional'', ''duplicate'')', '(s.status = ''provisional'' OR (s.status = ''duplicate'' AND p_exclude_staging_unit_id IS NULL))')],
  $$SELECT d1.w4y('m16')$$);

SELECT 'PASS 45c_d1_treasury_reading' AS marker;
ROLLBACK;
