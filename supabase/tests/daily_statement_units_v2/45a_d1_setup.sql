-- D1 (GO_IMPLEMENT_DAILY_V2_ORABANK_LATE_PROVISIONAL_D1_LOCAL_ONLY) : amorçage
-- des suites 45b, 45c et 46. Validé (commit) dans la base jetable seulement.
--   - constructeurs SQL autonomes à préimage INDÉPENDANTE : identifiants de
--     journée et empreintes de contenu recalculés ici, sans appeler les
--     fonctions de la migration (anti-circularité, comme 02 et 16) ;
--   - comptes ORABANK et BDK provisionnés par la RPC registre, ajoutés à
--     l'inventaire Trésorerie par l'administrateur unique ;
--   - module Trésorerie ouvert et formats CSV ORABANK et BDK qualifiés par le
--     canal opérateur (fixtures de la base jetable, sans valeur réelle) ;
--   - utilisateur manager synthétique (domaine .invalid) ;
--   - outils de mutation et de comparaison « avec ou sans D1 ».
-- Données 100 % synthétiques ; horodatages de réception simulés (Dakar = UTC).
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, DMY';

CREATE SCHEMA d1;
GRANT USAGE ON SCHEMA d1 TO authenticated;
CREATE TABLE d1.ctx (k text PRIMARY KEY, v jsonb NOT NULL);
-- Charges déposées et réponses, pour la parité de la règle des lignes (V20).
CREATE TABLE d1.deposits (key text PRIMARY KEY, payload jsonb NOT NULL, result jsonb NOT NULL);

CREATE FUNCTION d1.put(p_k text, p_v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO d1.ctx VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v $$;
CREATE FUNCTION d1.get(p_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM d1.ctx WHERE k = p_k $$;

-- --------------------------------------------------------------------------
-- Préimages indépendantes (assemblage manuel, entrées ASCII sans échappement)
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.hex64(p_seed text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('synthetic-d1:' || p_seed, 'UTF8')), 'hex') $$;
CREATE FUNCTION d1.day_unit_id(p_bank text, p_fp text, p_date text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('["sodatra:structured_bank_statement_csv:day_unit_id:v2","' || p_bank
    || '","' || p_fp || '","XOF","' || p_date || '"]', 'UTF8')), 'hex') $$;
CREATE FUNCTION d1.content_hash(p_day_unit_id text, p_hashes text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('["sodatra:structured_bank_statement_csv:day_content_hash:v2","' || p_day_unit_id
    || '",["' || (SELECT string_agg(h, '","' ORDER BY h COLLATE "C") FROM unnest(p_hashes) h) || '"]]', 'UTF8')), 'hex') $$;
CREATE FUNCTION d1.dmy(p_d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(p_d, 'DD/MM/YYYY') $$;
CREATE FUNCTION d1.at(p_text text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_text || ' +00')::timestamptz $$;

-- --------------------------------------------------------------------------
-- Comptes : RPC registre (administrateur Daily v2), inventaire Trésorerie.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.account(p_name text, p_bank text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
  v_n integer;
BEGIN
  SELECT count(*) + 1 INTO v_n FROM d1.ctx WHERE k LIKE 'acc:%';
  PERFORM tr_test.as_user('t_admin');
  v := public.provision_daily_statement_account(p_bank, 'XOF', 'D1 ' || p_name, '****' || lpad((v_n % 10000)::text, 4, '0'));
  PERFORM public.treasury_admin_add_expected_account_v1('d1-add-' || p_name, (v ->> 'id')::uuid, NULL, NULL, NULL,
    'Compte attendu synthetique D1');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN d1.put('acc:' || p_name, jsonb_build_object('id', v ->> 'id', 'fp', v ->> 'account_fingerprint',
    'bank', p_bank, 'masked', v ->> 'account_number_masked'));
END $$;
CREATE FUNCTION d1.acc(p_name text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb := d1.get('acc:' || p_name);
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: compte d1 inconnu %', p_name; END IF;
  RETURN v;
END $$;
CREATE FUNCTION d1.duid(p_account text, p_date text) RETURNS text LANGUAGE sql AS $$
  SELECT d1.day_unit_id(d1.acc(p_account) ->> 'bank', d1.acc(p_account) ->> 'fp', p_date) $$;

-- --------------------------------------------------------------------------
-- Constructeur de charge (contrat RPC du dépôt Daily v2, CSV structuré).
-- p_days : tableau ordonné de journées
--   {"d": "JJ/MM/AAAA", "o": ouverture, "ops": [[graine, montant signé] ...],
--    "agg": "derived" | "unavailable", "run": "chain" | "flat" | "desc" | "none",
--    "fix": {faits d'unité imposés}}
-- Lignes : ordinal d'occurrence 1 (contenus distincts), index de ligne global
-- dans le fichier, solde courant cumulé depuis l'ouverture (« chain ») ; « flat »
-- produit une chaîne délibérément non conforme ; « desc » liste les lignes en
-- ordre inverse (profil décroissant) avec la même chaîne.
-- Statut demandé, recalculé ici selon la règle serveur : date de référence
-- (journée >= référence => provisoire), sinon ORABANK : dernière journée
-- provisoire ; sinon journée close.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.mk(p_account text, p_file text, p_days jsonb, p_ref text DEFAULT NULL,
  p_period_start text DEFAULT NULL, p_period_end text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  a        jsonb := d1.acc(p_account);
  v_bank   text := a ->> 'bank';
  v_fp     text := a ->> 'fp';
  v_day    jsonb;
  v_op     jsonb;
  v_units  jsonb := '[]'::jsonb;
  v_lines  jsonb := '[]'::jsonb;
  v_dl     jsonb;
  v_idx    integer := 0;
  v_date   text;
  v_duid   text;
  v_open   numeric;
  v_run    numeric;
  v_signed numeric;
  v_deb    numeric;
  v_cred   numeric;
  v_hashes text[];
  v_hash   text;
  v_agg    text;
  v_mode   text;
  v_max    date;
  v_min    date;
  v_ref    date := CASE WHEN p_ref IS NULL THEN NULL ELSE to_date(p_ref, 'DD/MM/YYYY') END;
  v_status text;
  v_unit   jsonb;
  v_k      integer;
  v_start  text;
  v_end    text;
BEGIN
  SELECT max(to_date(x ->> 'd', 'DD/MM/YYYY')), min(to_date(x ->> 'd', 'DD/MM/YYYY'))
    INTO v_max, v_min FROM jsonb_array_elements(p_days) x;
  FOR v_day IN SELECT x FROM jsonb_array_elements(p_days) WITH ORDINALITY AS t(x, o) ORDER BY o LOOP
    v_date := v_day ->> 'd';
    v_duid := d1.day_unit_id(v_bank, v_fp, v_date);
    v_open := (v_day ->> 'o')::numeric;
    v_agg := coalesce(v_day ->> 'agg', 'derived');
    v_mode := coalesce(v_day ->> 'run', 'chain');
    v_deb := 0; v_cred := 0; v_hashes := ARRAY[]::text[]; v_dl := '[]'::jsonb; v_run := v_open;
    FOR v_k IN 0 .. jsonb_array_length(v_day -> 'ops') - 1 LOOP
      v_op := v_day -> 'ops' -> v_k;
      v_signed := (v_op ->> 1)::numeric;
      v_hash := coalesce(v_op ->> 2, d1.hex64(p_account || '|' || v_date || '|' || (v_op ->> 0)));
      v_hashes := v_hashes || v_hash;
      IF v_signed < 0 THEN v_deb := v_deb - v_signed; ELSE v_cred := v_cred + v_signed; END IF;
      v_run := v_run + v_signed;
      v_dl := v_dl || jsonb_build_array(jsonb_build_object(
        'day_unit_id', v_duid, 'daily_line_hash', v_hash, 'daily_occurrence_ordinal', 1,
        'source_line_index', 0, 'accounting_date', v_date, 'value_date', v_date,
        'description_sanitized', 'SYNTHETIC D1 ' || left(v_hash, 10),
        'debit_amount', CASE WHEN v_signed < 0 THEN -v_signed END,
        'credit_amount', CASE WHEN v_signed > 0 THEN v_signed END,
        'signed_amount', v_signed,
        'running_balance', CASE WHEN v_agg = 'unavailable' OR v_mode = 'none' THEN NULL
                                WHEN v_mode = 'flat' THEN v_open + v_signed
                                ELSE v_run END,
        'direction', CASE WHEN v_signed < 0 THEN 'debit' ELSE 'credit' END,
        'currency', 'XOF'));
    END LOOP;
    IF v_mode = 'desc' THEN
      SELECT jsonb_agg(e ORDER BY o DESC) INTO v_dl FROM jsonb_array_elements(v_dl) WITH ORDINALITY AS t(e, o);
    END IF;
    SELECT coalesce(jsonb_agg(e || jsonb_build_object('source_line_index', v_idx + o - 1) ORDER BY o), '[]'::jsonb)
      INTO v_dl FROM jsonb_array_elements(v_dl) WITH ORDINALITY AS t(e, o);
    v_idx := v_idx + jsonb_array_length(v_dl);
    v_lines := v_lines || v_dl;
    v_status := CASE WHEN v_ref IS NOT NULL THEN CASE WHEN to_date(v_date, 'DD/MM/YYYY') >= v_ref THEN 'provisional' ELSE 'staged' END
                     WHEN v_bank = 'ORA' THEN CASE WHEN to_date(v_date, 'DD/MM/YYYY') = v_max THEN 'provisional' ELSE 'staged' END
                     ELSE 'staged' END;
    v_unit := jsonb_build_object(
      'day_unit_id', v_duid, 'accounting_date', v_date,
      'day_content_hash', d1.content_hash(v_duid, v_hashes),
      'line_count', array_length(v_hashes, 1),
      'day_total_debits', v_deb, 'day_total_credits', v_cred,
      'opening_balance_derived', CASE WHEN v_agg = 'derived' THEN v_open END,
      'closing_balance_derived', CASE WHEN v_agg = 'derived' THEN v_open + v_cred - v_deb END,
      'aggregates_status', v_agg, 'validation_status', 'valid', 'requested_unit_status', v_status)
      || coalesce(v_day -> 'fix', '{}'::jsonb);
    v_units := v_units || jsonb_build_array(v_unit);
  END LOOP;
  v_start := coalesce(p_period_start, d1.dmy(v_min));
  v_end := coalesce(p_period_end, d1.dmy(v_max));
  RETURN jsonb_build_object(
    'attempt', jsonb_build_object(
      'requested_mode', 'daily', 'source_format', 'structured_bank_statement_csv', 'bank', v_bank, 'currency', 'XOF',
      'account_fingerprint', v_fp, 'account_registry_id', a ->> 'id', 'account_number_masked', a ->> 'masked',
      'source_file_name_redacted', 'releve synthetique d1.csv',
      'raw_text_hash', d1.hex64('file|' || p_account || '|' || p_file),
      'export_period_start', v_start, 'export_period_end', v_end, 'statement_date', v_end,
      'export_reference_date', p_ref, 'parser_validation_status', 'valid', 'errors_count', 0, 'warnings_count', 0,
      'runtime_version', 'synthetic-runtime-d1', 'parser_version', 'structured-csv-0b'),
    'units', v_units,
    'lines', v_lines,
    'guard', jsonb_build_object('ingestion_ready', true, 'bridge_guard_passed', true,
      'period_days', to_date(v_end, 'DD/MM/YYYY') - to_date(v_start, 'DD/MM/YYYY') + 1));
END $$;

-- Même charge, montants réécrits à leur plus petite échelle (10.50 -> 10.5).
CREATE FUNCTION d1.trimmed(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT p || jsonb_build_object(
    'units', (SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'number'
                AND k IN ('day_total_debits', 'day_total_credits', 'opening_balance_derived', 'closing_balance_derived')
                THEN to_jsonb(trim_scale(v::text::numeric)) ELSE v END), '{}'::jsonb) FROM jsonb_each(u) x(k, v)) ORDER BY o)
              FROM jsonb_array_elements(p -> 'units') WITH ORDINALITY t(u, o)),
    'lines', (SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'number'
                AND k IN ('debit_amount', 'credit_amount', 'signed_amount', 'running_balance')
                THEN to_jsonb(trim_scale(v::text::numeric)) ELSE v END), '{}'::jsonb) FROM jsonb_each(l) x(k, v)) ORDER BY o)
              FROM jsonb_array_elements(p -> 'lines') WITH ORDINALITY t(l, o))) $$;

-- Journées d'un calendrier d'opérations, ouvertures cumulées depuis le solde de
-- départ, bornées à [p_from, p_to] :
-- p_cal = {"start": solde, "days": {"AAAA-MM-JJ": [[graine, montant] ...], ...}}
CREATE FUNCTION d1.days(p_cal jsonb, p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_bal numeric := (p_cal ->> 'start')::numeric;
  v_out jsonb := '[]'::jsonb;
  v_d   text;
  v_ops jsonb;
  v_net numeric;
BEGIN
  FOR v_d, v_ops IN SELECT k, v FROM jsonb_each(p_cal -> 'days') x(k, v) ORDER BY k LOOP
    SELECT coalesce(sum((o ->> 1)::numeric), 0) INTO v_net FROM jsonb_array_elements(v_ops) o;
    IF v_d::date BETWEEN p_from AND p_to THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('d', d1.dmy(v_d::date), 'o', v_bal, 'ops', v_ops));
    END IF;
    v_bal := v_bal + v_net;
  END LOOP;
  RETURN v_out;
END $$;

-- --------------------------------------------------------------------------
-- Dépôt par l'enveloppe réelle, sous une identité de test ; instant de
-- réception simulé (mode réplica, comme la suite 36).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.dep(p_key text, p_payload jsonb, p_at timestamptz DEFAULT NULL, p_user text DEFAULT 't_admin')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM tr_test.as_user(p_user);
  v := public.pre_ingest_daily_statement_units(p_payload -> 'attempt', p_payload -> 'units', p_payload -> 'lines',
         p_payload -> 'guard');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  INSERT INTO d1.deposits (key, payload, result) VALUES (p_key, p_payload, v)
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, result = EXCLUDED.result;
  IF p_at IS NOT NULL THEN
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE public.daily_statement_export_attempts SET created_at = p_at WHERE id = (v ->> 'attempt_id')::uuid;
    PERFORM set_config('session_replication_role', 'origin', true);
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION d1.attempt(p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT (result ->> 'attempt_id')::uuid FROM d1.deposits WHERE key = p_key $$;
CREATE FUNCTION d1.unit(p_key text, p_date text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  SELECT s.id INTO v FROM public.daily_statement_units_staging s
  WHERE s.attempt_id = d1.attempt(p_key) AND s.accounting_date = to_date(p_date, 'DD/MM/YYYY');
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: unité % % introuvable', p_key, p_date; END IF;
  RETURN v;
END $$;
CREATE FUNCTION d1.reply(p_key text, p_date text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT u FROM d1.deposits d, jsonb_array_elements(d.result -> 'units') u
  WHERE d.key = p_key AND (u ->> 'staging_unit_id')::uuid = d1.unit(p_key, p_date) $$;
CREATE FUNCTION d1.ev(p_unit uuid, p_type text, p_reason text DEFAULT NULL) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_import_events
  WHERE staging_unit_id = p_unit AND event_type = p_type
    AND (p_reason IS NULL OR safe_details ->> 'reason_code' = p_reason) $$;
-- Événement de retrait D1 d'une livraison (au plus un).
CREATE FUNCTION d1.d1_event(p_unit uuid) RETURNS public.daily_statement_import_events LANGUAGE sql AS $$
  SELECT * FROM public.daily_statement_import_events
  WHERE staging_unit_id = p_unit AND safe_details ->> 'reason_code' = 'late_provisional_same_version_superseded' $$;
CREATE FUNCTION d1.status(p_unit uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.daily_statement_units_staging WHERE id = p_unit $$;
CREATE FUNCTION d1.nlines(p_unit uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_lines_staging WHERE staging_unit_id = p_unit $$;
CREATE FUNCTION d1.canon(p_account text, p_date text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.daily_statement_units_canonical WHERE day_unit_id = d1.duid(p_account, p_date) AND status = 'ingested' $$;
CREATE FUNCTION d1.live(p_account text, p_date text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_units_staging
  WHERE day_unit_id = d1.duid(p_account, p_date) AND status = 'provisional' $$;
CREATE FUNCTION d1.day_lines(p_account text, p_date text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_lines_staging WHERE day_unit_id = d1.duid(p_account, p_date) $$;
CREATE FUNCTION d1.vkey(p_unit uuid) RETURNS text LANGUAGE sql AS $$
  SELECT public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
    s.closing_balance_derived, s.day_total_debits, s.day_total_credits)
  FROM public.daily_statement_units_staging s WHERE s.id = p_unit $$;
CREATE FUNCTION d1.cvkey(p_canonical uuid) RETURNS text LANGUAGE sql AS $$
  SELECT public.daily_stmt_version_key(c.active_day_content_hash, c.aggregates_status, c.opening_balance_derived,
    c.closing_balance_derived, c.day_total_debits, c.day_total_credits)
  FROM public.daily_statement_units_canonical c WHERE c.id = p_canonical $$;
CREATE FUNCTION d1.sources(p_duid text, p_vkey text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_text_hash', x.raw_text_hash, 'account_registry_id', x.account_registry_id,
           'first_seen_at', x.first_seen_at) ORDER BY x.raw_text_hash), '[]'::jsonb)
  FROM public.daily_stmt_version_sources(p_duid, p_vkey) x $$;
-- Événements D1 (motif late_provisional_same_version_superseded).
CREATE FUNCTION d1.d1_events(p_unit uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_import_events
  WHERE staging_unit_id = p_unit AND safe_details ->> 'reason_code' = 'late_provisional_same_version_superseded' $$;
CREATE FUNCTION d1.d1_events_account(p_account text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.daily_statement_import_events e
  JOIN public.daily_statement_units_staging s ON s.id = e.staging_unit_id
  JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
  WHERE a.account_registry_id = (d1.acc(p_account) ->> 'id')::uuid
    AND e.safe_details ->> 'reason_code' = 'late_provisional_same_version_superseded' $$;
-- Empreinte complète d'une livraison (identifiant, statut, faits, lignes) : R3.
CREATE FUNCTION d1.snapshot(p_unit uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(row_to_json(s)::text || '|' || coalesce((SELECT string_agg(row_to_json(l)::text, ';' ORDER BY l.id)
           FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id), '-'))
  FROM public.daily_statement_units_staging s WHERE s.id = p_unit $$;

-- --------------------------------------------------------------------------
-- Décisions de l'administrateur (commandes réelles).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.as_admin() RETURNS void LANGUAGE sql AS $$ SELECT tr_test.as_user('t_admin') $$;
CREATE FUNCTION d1.reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;
CREATE FUNCTION d1.promote(p_key text, p_date text, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_unit uuid := d1.unit(p_key, p_date); v jsonb;
BEGIN
  PERFORM d1.as_admin();
  v := public.promote_daily_statement_unit(v_unit, p_reason);
  PERFORM d1.reset();
  RETURN v;
END $$;
CREATE FUNCTION d1.batch(p_key text, p_command text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_attempt uuid := d1.attempt(p_key); v_plan jsonb; v jsonb;
BEGIN
  PERFORM d1.as_admin();
  v_plan := public.daily_v2_attempt_batch_plan_v1(v_attempt);
  v := public.promote_daily_statement_attempt_units(p_command, v_attempt, v_plan -> 'expected',
         'Approbation groupee synthetique D1');
  PERFORM d1.reset();
  RETURN v;
END $$;
CREATE FUNCTION d1.supersede(p_account text, p_date text, p_key text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_old uuid := d1.canon(p_account, p_date); v_new uuid := d1.unit(p_key, p_date); v jsonb;
BEGIN
  PERFORM d1.as_admin();
  v := public.supersede_daily_statement_unit(v_old, v_new, 'Remplacement synthetique D1');
  PERFORM d1.reset();
  RETURN v;
END $$;
CREATE FUNCTION d1.balances(p_command text, p_account text, p_date text, p_key text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_old uuid := d1.canon(p_account, p_date); v_new uuid := d1.unit(p_key, p_date); v_vk text := d1.vkey(d1.unit(p_key, p_date)); v jsonb;
BEGIN
  PERFORM d1.as_admin();
  v := public.supersede_daily_statement_unit_balances(p_command, v_old, v_new, v_vk, 'Correction des soldes synthetique D1');
  PERFORM d1.reset();
  RETURN v;
END $$;
-- Réfutation par livraison fraîche : rend 'refuted' ou le code d'erreur.
CREATE FUNCTION d1.refute(p_command text, p_account text, p_date text, p_refuted_vkey text, p_proof uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_duid text := d1.duid(p_account, p_date);
  v_retained text := d1.cvkey(d1.canon(p_account, p_date));
  v_src jsonb := d1.sources(d1.duid(p_account, p_date), p_refuted_vkey);
  v jsonb;
  v_err text;
BEGIN
  BEGIN
    PERFORM d1.as_admin();
    v := public.refute_daily_statement_version(p_command, v_duid, p_refuted_vkey, v_retained, v_src,
           jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', p_proof), 'Preuve bancaire synthetique D1');
    PERFORM d1.reset();
    RETURN v ->> 'outcome';
  EXCEPTION WHEN OTHERS THEN
    v_err := split_part(SQLERRM, ':', 1);
  END;
  PERFORM d1.reset();
  RETURN v_err;
END $$;

-- --------------------------------------------------------------------------
-- Lecture « Soldes à date » (lecteur réel, utilisateur BANK_READ).
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.read(p_account text, p_as_of text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  SELECT x INTO v FROM jsonb_array_elements(tr_test.read_as('t_reader', to_date(p_as_of, 'DD/MM/YYYY')) -> 'accounts') x
  WHERE x ->> 'registry_account_id' = d1.acc(p_account) ->> 'id';
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: compte % absent de la lecture', p_account; END IF;
  RETURN v;
END $$;
CREATE FUNCTION d1.reasons(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(r, ',' ORDER BY r), '') FROM jsonb_array_elements_text(p -> 'reasons') r $$;
-- Projection sans identifiants techniques, tableaux triés : comparaison entre
-- comptes ou entre exécutions.
CREATE FUNCTION d1.strip(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; k text; v jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) = 'object' THEN
    r := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
      IF k NOT IN ('unit_id', 'export_id', 'expected_account_id', 'registry_account_id', 'alias', 'content_hash',
                   'refutation_id', 'ingested_at', 'next_unit_id', 'verified_start_id', 'retained_unit_at_date') THEN
        r := r || jsonb_build_object(k, d1.strip(v));
      END IF;
    END LOOP;
    RETURN r;
  ELSIF jsonb_typeof(p) = 'array' THEN
    SELECT coalesce(jsonb_agg(d1.strip(e) ORDER BY d1.strip(e)::text), '[]'::jsonb) INTO r FROM jsonb_array_elements(p) e;
    RETURN r;
  END IF;
  RETURN p;
END $$;
CREATE FUNCTION d1.check(p_account text, p_as_of text, p_status text, p_reason text, p_label text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb := d1.read(p_account, p_as_of);
BEGIN
  PERFORM tr_test.assert_eq(v ->> 'status', p_status, p_label || ' : statut le ' || p_as_of);
  IF p_reason IS NOT NULL THEN
    PERFORM tr_test.assert(v -> 'reasons' ? p_reason, p_label || ' : motif ' || p_reason || ' le ' || p_as_of
      || ' (motifs : ' || d1.reasons(v) || ')');
  END IF;
  RETURN v;
END $$;

-- --------------------------------------------------------------------------
-- Mutations (mordants) et exécution « sans D1 ». Les mutations remplacent un
-- fragment d'une seule ligne de la définition vivante, dans une
-- sous-transaction toujours annulée.
-- --------------------------------------------------------------------------
CREATE FUNCTION d1.m(p_function text, p_old text, p_new text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('SELECT tr_test.mutate(%L::regprocedure, %L, %L)', p_function, p_old, p_new) $$;
CREATE FUNCTION d1.f1() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb)' $$;
CREATE FUNCTION d1.f2() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'public.daily_stmt_promote_unit_core(uuid,uuid,uuid)' $$;
CREATE FUNCTION d1.f4() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'public.daily_stmt_provisional_same_version(uuid,uuid)' $$;
CREATE FUNCTION d1.f5() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'public.daily_stmt_retire_same_version_provisionals(text,uuid,uuid,uuid,text,uuid)' $$;
-- Les deux interventions D1 neutralisées : comportement d'avant D1.
CREATE FUNCTION d1.no_d1() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    d1.m(d1.f1(), 'v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);', 'v_d1_retire := false;'),
    d1.m(d1.f2(), 'PERFORM public.daily_stmt_retire_same_version_provisionals(v_unit.day_unit_id, p_new_canonical_id, p_actor, v_unit.attempt_id, NULL, NULL);', 'NULL;')] $$;

-- Le scénario doit échouer sous la mutation (assertion TEST_FAILED ou refus).
CREATE FUNCTION d1.bites(p_label text, p_mutations text[], p_check text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_m text; v_err text; v_stage text := 'mutation';
BEGIN
  BEGIN
    FOREACH v_m IN ARRAY p_mutations LOOP EXECUTE v_m; END LOOP;
    v_stage := 'check';
    EXECUTE p_check;
    v_stage := 'survived';
    RAISE EXCEPTION 'D1_MUTANT_SURVIVED';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM d1.reset();
  IF v_stage = 'mutation' THEN RAISE EXCEPTION 'TEST_FAILED: mutant % non appliqué (%)', p_label, v_err; END IF;
  IF v_stage = 'survived' THEN RAISE EXCEPTION 'TEST_FAILED: mutant % a survécu', p_label; END IF;
  RETURN 'PASS ' || p_label || ' KILLED -> ' || left(regexp_replace(v_err, '\s+', ' ', 'g'), 220);
END $$;
-- Le scénario doit réussir sans D1 (mêmes assertions), puis tout est annulé.
CREATE FUNCTION d1.without_d1(p_label text, p_check text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_m text; v_err text;
BEGIN
  BEGIN
    FOREACH v_m IN ARRAY d1.no_d1() LOOP EXECUTE v_m; END LOOP;
    EXECUTE p_check;
    RAISE EXCEPTION 'D1_WITHOUT_D1_DONE';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM d1.reset();
  IF v_err <> 'D1_WITHOUT_D1_DONE' THEN
    RAISE EXCEPTION 'TEST_FAILED: % sans D1 : %', p_label, v_err;
  END IF;
  RETURN 'PASS ' || p_label || ' (sans D1 : mêmes résultats)';
END $$;
-- Applique ou rétablit durablement (dans la transaction) le comportement d'avant
-- D1 au dépôt, pour fabriquer un état hérité par le vrai dépôt.
CREATE FUNCTION d1.legacy_deposits(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_on THEN
    PERFORM d1.put('def:f1', to_jsonb(pg_get_functiondef(d1.f1()::regprocedure)));
    PERFORM tr_test.mutate(d1.f1()::regprocedure,
      'v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);', 'v_d1_retire := false;');
  ELSE
    EXECUTE d1.get('def:f1') #>> '{}';
  END IF;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA d1 TO authenticated;
GRANT SELECT ON d1.ctx, d1.deposits TO authenticated;

-- --------------------------------------------------------------------------
-- Habilitations et fixtures Trésorerie de la base jetable.
-- --------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES ('71000000-0000-4000-8000-0000000000d1', 'd1.manager@synthetic.invalid');
SELECT tr_test.put('d1_manager', '71000000-0000-4000-8000-0000000000d1');
INSERT INTO public.user_roles (user_id, role) VALUES (tr_test.id('d1_manager'), 'manager') ON CONFLICT DO NOTHING;

SELECT treasury_private.set_module_open(true, 'tr-test:ouverture-d1', 'Ouverture synthetique des suites D1', 'operateur-test');
SELECT treasury_private.set_bank_format_qualification(b, 'structured_bank_statement_csv', 'QUALIFIED', 'tr-test:preuve-synthetique-d1-' || lower(b),
  'Qualification synthetique de test, sans valeur reelle', 'operateur-test')
FROM unnest(ARRAY['ORA', 'BDK']) b;

-- Contrôle des préimages indépendantes contre le serveur (anti-circularité).
SELECT d1.account('setup', 'ORA');
SELECT tr_test.assert_eq(d1.duid('setup', '15/10/2026'),
  public.daily_stmt_day_unit_id('ORA', d1.acc('setup') ->> 'fp', 'XOF', '15/10/2026'), '45a : préimage day_unit_id');
SELECT tr_test.assert_eq(d1.content_hash(d1.duid('setup', '15/10/2026'), ARRAY[d1.hex64('b'), d1.hex64('a')]),
  public.daily_stmt_day_content_hash(d1.duid('setup', '15/10/2026'), ARRAY[d1.hex64('a'), d1.hex64('b')]),
  '45a : préimage day_content_hash');
SELECT tr_test.assert((SELECT bool_and(status = 'QUALIFIED') AND count(*) = 2 FROM (
  SELECT DISTINCT ON (bank) bank, status FROM treasury_private.bank_format_qualifications
  WHERE bank IN ('ORA', 'BDK') AND source_format = 'structured_bank_statement_csv' ORDER BY bank, seq DESC) q),
  '45a : formats CSV ORABANK et BDK qualifiés (fixtures)');
SELECT 'PASS 45a_d1_setup' AS marker;
