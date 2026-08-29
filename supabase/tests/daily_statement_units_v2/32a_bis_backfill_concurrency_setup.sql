-- =============================================================================
-- BIS BACKFILL SET-BASED CORE — CONCURRENCY SETUP (100 % SYNTHETIC)
-- =============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

CREATE TABLE poc_test.bis_concurrency_payload (
  label text PRIMARY KEY,
  p_attempt jsonb NOT NULL,
  p_units jsonb NOT NULL,
  p_lines jsonb NOT NULL,
  p_guard jsonb NOT NULL
);
GRANT SELECT ON poc_test.bis_concurrency_payload TO PUBLIC;

WITH source AS MATERIALIZED (
  SELECT
    p_attempt,
    p_units -> 0 AS unit,
    p_lines,
    p_guard,
    p_units -> 0 ->> 'day_unit_id' AS day_unit_id,
    p_units -> 0 ->> 'accounting_date' AS accounting_date
  FROM poc_test.bis_mass_payload
), shaped AS MATERIALIZED (
  SELECT
    jsonb_set(
      jsonb_set(p_attempt, '{export_period_start}', to_jsonb(accounting_date)),
      '{export_period_end}', to_jsonb(accounting_date)
    ) AS p_attempt,
    jsonb_build_array(unit) AS p_units,
    (
      SELECT jsonb_agg(l.value ORDER BY l.ord)
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,ord)
      WHERE l.value ->> 'day_unit_id'=source.day_unit_id
    ) AS p_lines,
    jsonb_set(p_guard, '{period_days}', '1'::jsonb) AS p_guard,
    accounting_date
  FROM source
)
INSERT INTO poc_test.bis_concurrency_payload(label,p_attempt,p_units,p_lines,p_guard)
SELECT label,p_attempt,p_units,p_lines,
       jsonb_set(p_guard,'{backfill_grant_id}',to_jsonb(grant_id))
FROM shaped
CROSS JOIN (VALUES
  ('a','00000000-0000-4000-8000-00000000c0a1'::text),
  ('b','00000000-0000-4000-8000-00000000c0b1'::text)
) grants(label,grant_id);

INSERT INTO public.daily_statement_account_registry (
  id,created_by,bank,currency,safe_alias,account_fingerprint,account_number_masked
) VALUES (
  '00000000-0000-4000-8000-0000000000f1',poc_test.uid_admin(),
  'BIS','XOF','SYNTHETIC BIS CONCURRENCY',repeat('f',64),NULL
);

INSERT INTO public.daily_statement_backfill_grants (
  id,account_registry_id,created_by,period_start,period_end,max_units,expires_at
)
SELECT
  grant_id,
  '00000000-0000-4000-8000-0000000000f1',
  poc_test.uid_admin(),
  public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start'),
  public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end'),
  1,
  TIMESTAMPTZ '2099-01-01 00:00:00+00'
FROM poc_test.bis_concurrency_payload
CROSS JOIN LATERAL (
  SELECT (p_guard ->> 'backfill_grant_id')::uuid AS grant_id
) ids;

CREATE OR REPLACE FUNCTION poc_test.bis_concurrency_deposit(
  p_label text,
  p_prefix text
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_payload poc_test.bis_concurrency_payload%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_payload
  FROM poc_test.bis_concurrency_payload
  WHERE label=p_label;

  PERFORM poc_test.ctx_set(p_prefix || '_call_at',clock_timestamp()::text);
  v_result := public.pre_ingest_daily_statement_units(
    v_payload.p_attempt,v_payload.p_units,v_payload.p_lines,v_payload.p_guard
  );
  PERFORM poc_test.ctx_set(p_prefix || '_done_at',clock_timestamp()::text);
  PERFORM poc_test.ctx_set(p_prefix || '_attempt',v_result ->> 'attempt_id');
  PERFORM poc_test.ctx_set(p_prefix || '_staging',v_result -> 'units' -> 0 ->> 'staging_unit_id');
  PERFORM poc_test.ctx_set(p_prefix || '_status',v_result -> 'units' -> 0 ->> 'unit_status');
  PERFORM poc_test.ctx_set(p_prefix || '_duid',v_result -> 'units' -> 0 ->> 'day_unit_id');
  PERFORM poc_test.ctx_set(
    p_prefix || '_active_canonical',
    coalesce(v_result -> 'units' -> 0 ->> 'active_canonical_unit_id','')
  );
  RETURN v_result;
END
$fn$;
GRANT EXECUTE ON FUNCTION poc_test.bis_concurrency_deposit(text,text) TO PUBLIC;

SELECT poc_test.assert(
  (SELECT count(*)=2 AND bool_and(jsonb_array_length(p_units)=1)
     AND bool_and(jsonb_array_length(p_lines)>0)
   FROM poc_test.bis_concurrency_payload),
  'BISC-setup: two one-day payloads with non-empty lines and distinct grants'
);

SELECT 'BIS set-based concurrency setup: READY' AS status;
