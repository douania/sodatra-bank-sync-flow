-- ============================================================================
-- 0H — BUILDERS DE PAYLOADS v2 100 % SYNTHÉTIQUES (TESTS UNIQUEMENT)
-- ============================================================================
-- poc_test.day_unit_id / poc_test.day_content_hash sont des implémentations
-- INDÉPENDANTES des préimages v2 (assemblage manuel, entrées de test ASCII
-- sans échappement) : elles vérifient les helpers de la migration au lieu de
-- les rappeler (anti-circularité), en plus des ancres TS figées dans 11_*.
-- Contexte de test fixe : fingerprint 'fp_synth_v2', devise 'XOF'.
-- ============================================================================
\set ON_ERROR_STOP on

-- Hash synthétique déterministe 64-hex (jamais une vraie identité bancaire).
CREATE OR REPLACE FUNCTION poc_test.hex64(p_seed text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('synthetic:' || p_seed, 'UTF8')), 'hex')
$$;

-- Implémentation indépendante de la préimage day_unit_id v2.
CREATE OR REPLACE FUNCTION poc_test.day_unit_id(p_bank text, p_date text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    '["sodatra:structured_bank_statement_csv:day_unit_id:v2","' || p_bank
    || '","fp_synth_v2","XOF","' || p_date || '"]', 'UTF8')), 'hex')
$$;

-- Implémentation indépendante de la préimage day_content_hash v2
-- (tri lexical en ordre d'octets, tableau JSON imbriqué).
CREATE OR REPLACE FUNCTION poc_test.day_content_hash(p_day_unit_id text, p_hashes text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    '["sodatra:structured_bank_statement_csv:day_content_hash:v2","' || p_day_unit_id
    || '",["'
    || (SELECT string_agg(h, '","' ORDER BY h COLLATE "C") FROM unnest(p_hashes) h)
    || '"]]', 'UTF8')), 'hex')
$$;

-- p_attempt synthétique (clés = whitelist TS/SQL exacte).
CREATE OR REPLACE FUNCTION poc_test.mk_attempt(
  p_mode  text,
  p_bank  text,
  p_start text,
  p_end   text,
  p_ref   text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'requested_mode', p_mode,
    'source_format', 'structured_bank_statement_csv',
    'bank', p_bank,
    'currency', 'XOF',
    'account_fingerprint', 'fp_synth_v2',
    'account_number_masked', '****1234',
    'source_file_name_redacted', 'releve synthetique.csv',
    'raw_text_hash', poc_test.hex64('rth_' || p_bank || '_' || p_start || '_' || p_end),
    'export_period_start', p_start,
    'export_period_end', p_end,
    'statement_date', p_end,
    'export_reference_date', p_ref,
    'parser_validation_status', 'valid',
    'errors_count', 0,
    'warnings_count', 0,
    'runtime_version', 'synthetic-runtime',
    'parser_version', 'synthetic-parser')
$$;

-- Une unité journalière : N lignes crédit de 10.00 chacune, agrégats dérivés.
CREATE OR REPLACE FUNCTION poc_test.mk_unit(
  p_bank   text,
  p_date   text,
  p_hashes text[],
  p_status text
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'day_unit_id', poc_test.day_unit_id(p_bank, p_date),
    'accounting_date', p_date,
    'day_content_hash', poc_test.day_content_hash(poc_test.day_unit_id(p_bank, p_date), p_hashes),
    'line_count', array_length(p_hashes, 1),
    'day_total_debits', 0.00,
    'day_total_credits', (10.00 * array_length(p_hashes, 1))::numeric(18, 2),
    'opening_balance_derived', 0.00,
    'closing_balance_derived', (10.00 * array_length(p_hashes, 1))::numeric(18, 2),
    'aggregates_status', 'derived',
    'validation_status', 'valid',
    'requested_unit_status', p_status)
$$;

-- Une ligne crédit synthétique de 10.00 rattachée à sa journée.
CREATE OR REPLACE FUNCTION poc_test.mk_line(
  p_bank    text,
  p_date    text,
  p_hash    text,
  p_ordinal integer,
  p_idx     integer
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'day_unit_id', poc_test.day_unit_id(p_bank, p_date),
    'daily_line_hash', p_hash,
    'daily_occurrence_ordinal', p_ordinal,
    'source_line_index', p_idx,
    'accounting_date', p_date,
    'value_date', p_date,
    'description_sanitized', 'SYNTHETIC DAILY LINE ' || left(p_hash, 12),
    'debit_amount', NULL,
    'credit_amount', 10.00,
    'signed_amount', 10.00,
    'running_balance', (10.00 * p_ordinal)::numeric(18, 2),
    'direction', 'credit',
    'currency', 'XOF')
$$;

-- p_guard_context synthétique (bridge_guard_passed = true par défaut :
-- une source refusée par la garde ne devient jamais un dépôt).
CREATE OR REPLACE FUNCTION poc_test.mk_guard(
  p_ready boolean,
  p_days  integer,
  p_grant text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'ingestion_ready', p_ready,
    'period_days', p_days,
    'bridge_guard_passed', true,
    'backfill_grant_reference', p_grant)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

SELECT 'payload helpers ready' AS status;
