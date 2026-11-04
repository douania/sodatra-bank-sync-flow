-- TREASURY V1 — LOT 1 : outils de test (base PostgreSQL 17 jetable uniquement).
-- Données strictement synthétiques : comptes, montants et identités inventés
-- (domaines .invalid). Ne jamais appliquer sur un projet Supabase réel.
\set ON_ERROR_STOP on

CREATE SCHEMA tr_test;
GRANT USAGE ON SCHEMA tr_test TO anon, authenticated, service_role;

CREATE TABLE tr_test.ids (name text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION tr_test.assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %', p_message; END IF;
END $$;

CREATE FUNCTION tr_test.assert_eq(p_actual text, p_expected text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'TEST_FAILED: % (attendu [%], obtenu [%])', p_message, p_expected, p_actual;
  END IF;
END $$;

CREATE FUNCTION tr_test.put(p_name text, p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = tr_test, pg_temp AS $$
BEGIN
  INSERT INTO tr_test.ids (name, id) VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = excluded.id;
  RETURN p_id;
END $$;

CREATE FUNCTION tr_test.id(p_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = tr_test, pg_temp AS $$
DECLARE v uuid;
BEGIN
  SELECT i.id INTO v FROM tr_test.ids i WHERE i.name = p_name;
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: identifiant inconnu %', p_name; END IF;
  RETURN v;
END $$;

CREATE FUNCTION tr_test.key(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'tr-test:' || p_label $$;

CREATE FUNCTION tr_test.as_user(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', tr_test.id(p_name)::text, false);
  PERFORM set_config('role', 'authenticated', false);
END $$;

CREATE FUNCTION tr_test.as_anonymous()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('role', 'anon', false);
END $$;

CREATE FUNCTION tr_test.expect_error(p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'TEST_FAILED: attendu [%] obtenu [%]', p_fragment, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'TEST_FAILED: erreur [%] attendue, instruction réussie : %', p_fragment, p_sql;
END $$;

-- Lecture d'un compte (par nom de test du registre ou du compte attendu) à la date D.
CREATE FUNCTION tr_test.read_as(p_user text, p_as_of date)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM tr_test.as_user(p_user);
  v := public.treasury_balances_at_v1(p_as_of);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN v;
END $$;

CREATE FUNCTION tr_test.account(p_result jsonb, p_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v jsonb; v_id text := tr_test.id(p_name)::text;
BEGIN
  SELECT a INTO v FROM jsonb_array_elements(p_result -> 'accounts') a
   WHERE a ->> 'registry_account_id' = v_id OR a ->> 'expected_account_id' = v_id;
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: compte % absent du résultat', p_name; END IF;
  RETURN v;
END $$;

CREATE FUNCTION tr_test.reasons(p_account jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(r, ',' ORDER BY r), '') FROM jsonb_array_elements_text(p_account -> 'reasons') r
$$;

-- Statut, solde à D (NULL = JSON null attendu) et motifs triés d'un compte à D.
CREATE FUNCTION tr_test.check(p_as_of date, p_name text, p_status text, p_balance text, p_reasons text, p_label text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_result jsonb; v_account jsonb;
BEGIN
  v_result := tr_test.read_as('t_reader', p_as_of);
  v_account := tr_test.account(v_result, p_name);
  PERFORM tr_test.assert_eq(v_account ->> 'status', p_status, p_label || ' : statut');
  PERFORM tr_test.assert_eq(v_account ->> 'balance_at_date', p_balance, p_label || ' : solde à D');
  PERFORM tr_test.assert_eq(tr_test.reasons(v_account), p_reasons, p_label || ' : motifs');
  RETURN v_account;
END $$;

-- --------------------------------------------------------------------------
-- Données Daily v2 synthétiques. Appelées UNIQUEMENT en mode réplica
-- (session_replication_role = replica) : les gardes d'écriture Daily v2 ne
-- concernent pas un jeu d'essai local ; la cohérence des clés est vérifiée
-- après coup par tr_test.assert_seed_consistent().
-- --------------------------------------------------------------------------
CREATE FUNCTION tr_test.seed_registry(p_name text, p_bank text, p_currency text, p_alias text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint)
  VALUES (v, tr_test.id('t_admin'), p_bank, p_currency, p_alias, encode(sha256(convert_to('fp:' || p_name, 'UTF8')), 'hex'));
  RETURN tr_test.put(p_name, v);
END $$;

-- Export : instant de création réel par défaut, ou fixé (export intrajournalier).
CREATE FUNCTION tr_test.seed_export(
  p_name text, p_account text, p_format text, p_parser text, p_start date, p_end date, p_ref date,
  p_validation text DEFAULT 'valid', p_created_at timestamptz DEFAULT NULL, p_codes text[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid(); r public.daily_statement_account_registry%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.daily_statement_account_registry WHERE id = tr_test.id(p_account);
  INSERT INTO public.daily_statement_export_attempts (
    id, created_at, created_by, requested_mode, source_format, bank, currency, account_fingerprint, raw_text_hash,
    export_period_start, export_period_end, export_reference_date, parser_validation_status, runtime_version,
    parser_version, ingestion_ready, bridge_guard_passed, period_days, units_total, account_registry_id,
    review_reason_codes)
  VALUES (v, coalesce(p_created_at, now()), tr_test.id('t_admin'), 'daily', p_format, r.bank, r.currency,
    r.account_fingerprint, encode(sha256(convert_to('raw:' || p_name, 'UTF8')), 'hex'), p_start, p_end, p_ref,
    p_validation, 'tr-test', p_parser, true, true, p_end - p_start + 1, 1, r.id, p_codes);
  RETURN tr_test.put(p_name, v);
END $$;

-- Nouvelle livraison d'une journée canonical par un autre export, même contenu
-- (doublon R1) ; validation et motifs de revue au choix.
CREATE FUNCTION tr_test.seed_redelivery(
  p_export text, p_canonical text, p_validation text DEFAULT 'valid', p_codes text[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v uuid := gen_random_uuid();
  c public.daily_statement_units_canonical%ROWTYPE;
  a public.daily_statement_export_attempts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.daily_statement_units_canonical WHERE id = tr_test.id(p_canonical);
  SELECT * INTO a FROM public.daily_statement_export_attempts WHERE id = tr_test.id(p_export);
  INSERT INTO public.daily_statement_units_staging (
    id, attempt_id, day_unit_id, bank, account_fingerprint, currency, accounting_date, day_content_hash, line_count,
    day_total_debits, day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status,
    validation_status, status, created_by, account_registry_id, review_reason_codes)
  VALUES (v, a.id, c.day_unit_id, c.bank, c.account_fingerprint, c.currency, c.accounting_date, c.active_day_content_hash,
    c.line_count, c.day_total_debits, c.day_total_credits, c.opening_balance_derived, c.closing_balance_derived,
    c.aggregates_status, p_validation, 'duplicate', tr_test.id('t_admin'), a.account_registry_id, p_codes);
  RETURN v;
END $$;

-- Unité de journée : staging (statut donné) et, si demandé, canonical active
-- avec ses lignes. Mouvement net = clôture - ouverture ; p_pairs ajoute des
-- couples +1/-1 ; les p_value_dated premières lignes portent une date de valeur.
CREATE FUNCTION tr_test.seed_unit(
  p_export text, p_day date, p_opening numeric, p_closing numeric,
  p_staging_status text DEFAULT 'promoted', p_canonical boolean DEFAULT true,
  p_aggregates text DEFAULT 'derived', p_validation text DEFAULT 'valid', p_unit_currency text DEFAULT NULL,
  p_pairs integer DEFAULT 0, p_value_dated integer DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  a public.daily_statement_export_attempts%ROWTYPE;
  v_currency text;
  v_day_unit text;
  v_staging uuid := gen_random_uuid();
  v_canonical uuid := gen_random_uuid();
  v_amounts numeric[] := ARRAY[]::numeric[];
  v_delta numeric;
  v_running numeric;
  v_open numeric := CASE WHEN p_aggregates = 'derived' THEN p_opening END;
  v_close numeric := CASE WHEN p_aggregates = 'derived' THEN p_closing END;
  i integer;
BEGIN
  SELECT * INTO a FROM public.daily_statement_export_attempts WHERE id = tr_test.id(p_export);
  v_currency := coalesce(p_unit_currency, a.currency);
  v_day_unit := 'tr-test:' || a.account_registry_id::text || ':' || p_day::text;
  v_delta := coalesce(p_closing, 1) - coalesce(p_opening, 0);
  IF v_delta = 0 THEN v_amounts := ARRAY[1, -1]; ELSE v_amounts := ARRAY[v_delta]; END IF;
  FOR i IN 1..p_pairs LOOP v_amounts := v_amounts || ARRAY[1::numeric, -1::numeric]; END LOOP;

  INSERT INTO public.daily_statement_units_staging (
    id, attempt_id, day_unit_id, bank, account_fingerprint, currency, accounting_date, day_content_hash, line_count,
    day_total_debits, day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status,
    validation_status, status, created_by, account_registry_id)
  VALUES (v_staging, a.id, v_day_unit, a.bank, a.account_fingerprint, v_currency, p_day,
    encode(sha256(convert_to('content:' || v_staging::text, 'UTF8')), 'hex'), cardinality(v_amounts),
    (SELECT coalesce(sum(-x), 0) FROM unnest(v_amounts) x WHERE x < 0), (SELECT coalesce(sum(x), 0) FROM unnest(v_amounts) x WHERE x > 0),
    v_open, v_close, p_aggregates, p_validation, p_staging_status, tr_test.id('t_admin'), a.account_registry_id);

  -- Lignes de la livraison, comme le pipeline les stocke (P1 de la contre-revue
  -- CTO : la lecture vérifie leur concordance avec les faits déclarés).
  v_running := coalesce(p_opening, 0);
  FOR i IN 1..cardinality(v_amounts) LOOP
    v_running := v_running + v_amounts[i];
    INSERT INTO public.daily_statement_lines_staging (
      staging_unit_id, attempt_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal, source_line_index,
      accounting_date, value_date, description_sanitized, debit_amount, credit_amount, signed_amount,
      running_balance, direction, currency)
    VALUES (v_staging, a.id, v_day_unit, encode(sha256(convert_to('sline:' || v_staging::text || ':' || i, 'UTF8')), 'hex'),
      1, i - 1, p_day, CASE WHEN i <= p_value_dated THEN p_day END, 'Opération synthétique',
      CASE WHEN v_amounts[i] < 0 THEN -v_amounts[i] END, CASE WHEN v_amounts[i] > 0 THEN v_amounts[i] END,
      v_amounts[i], CASE WHEN p_aggregates = 'derived' THEN v_running END,
      CASE WHEN v_amounts[i] < 0 THEN 'debit' ELSE 'credit' END, v_currency);
  END LOOP;

  IF NOT p_canonical THEN RETURN v_staging; END IF;

  INSERT INTO public.daily_statement_units_canonical (
    id, promoted_from_staging_unit_id, day_unit_id, bank, account_fingerprint, currency, accounting_date,
    active_day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
    closing_balance_derived, aggregates_status, validation_status, status, account_registry_id)
  VALUES (v_canonical, v_staging, v_day_unit, a.bank, a.account_fingerprint, v_currency, p_day,
    encode(sha256(convert_to('content:' || v_staging::text, 'UTF8')), 'hex'), cardinality(v_amounts),
    (SELECT coalesce(sum(-x), 0) FROM unnest(v_amounts) x WHERE x < 0), (SELECT coalesce(sum(x), 0) FROM unnest(v_amounts) x WHERE x > 0),
    v_open, v_close, p_aggregates, p_validation, 'ingested', a.account_registry_id);

  v_running := coalesce(p_opening, 0);
  FOR i IN 1..cardinality(v_amounts) LOOP
    v_running := v_running + v_amounts[i];
    INSERT INTO public.daily_statement_lines_canonical (
      canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal, source_line_index, is_active,
      accounting_date, value_date, description_sanitized, debit_amount, credit_amount, signed_amount,
      running_balance, direction, currency)
    VALUES (v_canonical, v_day_unit, encode(sha256(convert_to('line:' || v_canonical::text || ':' || i, 'UTF8')), 'hex'),
      1, i - 1, true, p_day, CASE WHEN i <= p_value_dated THEN p_day END, 'Opération synthétique',
      CASE WHEN v_amounts[i] < 0 THEN -v_amounts[i] END, CASE WHEN v_amounts[i] > 0 THEN v_amounts[i] END,
      v_amounts[i], CASE WHEN p_aggregates = 'derived' THEN v_running END,
      CASE WHEN v_amounts[i] < 0 THEN 'debit' ELSE 'credit' END, v_currency);
  END LOOP;
  RETURN v_canonical;
END $$;

-- Aucun orphelin malgré le mode réplica : clés de rattachement cohérentes.
CREATE FUNCTION tr_test.assert_seed_consistent()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tr_test.assert(NOT EXISTS (
    SELECT 1 FROM public.daily_statement_units_canonical u
    LEFT JOIN public.daily_statement_units_staging s ON s.id = u.promoted_from_staging_unit_id
    WHERE s.id IS NULL OR s.day_unit_id <> u.day_unit_id OR s.account_registry_id IS DISTINCT FROM u.account_registry_id),
    'canonical rattachées à leur staging');
  PERFORM tr_test.assert(NOT EXISTS (
    SELECT 1 FROM public.daily_statement_units_staging s
    LEFT JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
    WHERE a.id IS NULL OR a.account_registry_id IS DISTINCT FROM s.account_registry_id),
    'staging rattachées à leur export');
  PERFORM tr_test.assert(NOT EXISTS (
    SELECT 1 FROM public.daily_statement_lines_canonical l
    LEFT JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
    WHERE u.id IS NULL OR u.day_unit_id <> l.day_unit_id), 'lignes rattachées à leur unité');
  PERFORM tr_test.assert(NOT EXISTS (
    SELECT u.day_unit_id FROM public.daily_statement_units_canonical u WHERE u.status = 'ingested'
    GROUP BY u.day_unit_id HAVING count(*) > 1), 'une seule canonical active par journée');
  PERFORM tr_test.assert(NOT EXISTS (
    SELECT 1 FROM public.daily_statement_units_staging s
    WHERE s.validation_status = 'valid' AND cardinality(s.review_reason_codes) > 0), 'motif de revue => à revoir');
END $$;

-- Mutant : remplace un fragment EXACT d'une définition (dans une transaction
-- annulée par le runner). Fragment introuvable = erreur distincte d'un échec de test.
CREATE FUNCTION tr_test.mutate(p_function regprocedure, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_def text := pg_get_functiondef(p_function);
BEGIN
  IF position(p_old IN v_def) = 0 THEN RAISE EXCEPTION 'MUTANT_TARGET_NOT_FOUND: %', p_function; END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $$;
REVOKE ALL ON FUNCTION tr_test.mutate(regprocedure, text, text) FROM PUBLIC;
-- Mutant à cibles alternatives (C7) : la version optimisée et la référence figée
-- portent la même règle sous deux écritures ; la première trouvée est mutée.
CREATE FUNCTION tr_test.mutate_first(p_function regprocedure, p_olds text[], p_news text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_def text := pg_get_functiondef(p_function); v_i integer;
BEGIN
  FOR v_i IN 1..cardinality(p_olds) LOOP
    IF position(p_olds[v_i] IN v_def) > 0 THEN
      EXECUTE replace(v_def, p_olds[v_i], p_news[v_i]);
      RETURN;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'MUTANT_TARGET_NOT_FOUND: %', p_function;
END $$;
REVOKE ALL ON FUNCTION tr_test.mutate_first(regprocedure, text[], text[]) FROM PUBLIC;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tr_test TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tr_test.mutate(regprocedure, text, text) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION tr_test.mutate_first(regprocedure, text[], text[]) FROM anon, authenticated, service_role;
GRANT SELECT ON tr_test.ids TO anon, authenticated, service_role;

SELECT 'PASS 00_tools' AS marker;
