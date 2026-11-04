-- Lot 1 opérationnel : amorçage des suites 34 à 41 (chaîne complète, outils
-- tr_test et identités de supabase/tests/treasury_v1_lot1/00 et 05). Comptes
-- synthétiques du registre, autorisation de backfill, verrou Daily v2 ouvert
-- dans cette base jetable, rôle `admin` Daily v2 de l'administrateur unique de
-- test, outils de dépôt des charges produites par le pipeline réel.
\set ON_ERROR_STOP on

SET session_replication_role = replica;
INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint) VALUES
  ('00000000-0000-4000-8000-0000000000f1', tr_test.id('t_admin'), 'ATB', 'XOF', 'OPX ATB', repeat('1', 64)),
  ('00000000-0000-4000-8000-0000000000f2', tr_test.id('t_admin'), 'BIS', 'XOF', 'OPX BIS', repeat('2', 64)),
  ('00000000-0000-4000-8000-0000000000f3', tr_test.id('t_admin'), 'ATB', 'XOF', 'OPX ATB LOT', repeat('3', 64));
INSERT INTO public.daily_statement_backfill_grants (id, account_registry_id, created_by, period_start, period_end,
  max_units, expires_at)
VALUES ('00000000-0000-4000-8000-00000000f0f2', '00000000-0000-4000-8000-0000000000f2', tr_test.id('t_admin'),
        DATE '2026-01-01', DATE '2026-02-20', 10, now() + interval '2 days');
SET session_replication_role = origin;

INSERT INTO public.user_roles (user_id, role) VALUES (tr_test.id('t_admin'), 'admin') ON CONFLICT DO NOTHING;
UPDATE daily_v2_private.runtime_control
   SET mutations_enabled = true, daily_scope_enabled = true, admin_scope_enabled = true, backfill_scope_enabled = true,
       change_reason = 'Suites locales des décisions opérationnelles : ouverture'
 WHERE singleton = true;

CREATE TABLE opx.ctx (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION opx.put(p_key text, p_value jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO opx.ctx VALUES (p_key, p_value) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v $$;
CREATE FUNCTION opx.get(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT v FROM opx.ctx WHERE k = p_key $$;
-- Dépôt d'une charge du pipeline réel, sous l'identité courante.
CREATE FUNCTION opx.deposit(p_key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pre_ingest_daily_statement_units(p.attempt, p.units, p.lines, p.guard) FROM opx.payloads p WHERE p.key = p_key $$;
-- Unité de staging d'un dépôt mémorisé (par rang, ou par date comptable).
CREATE FUNCTION opx.uid(p_key text, p_index integer DEFAULT 0) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (opx.get(p_key) -> 'units' -> p_index ->> 'staging_unit_id')::uuid $$;
CREATE FUNCTION opx.uid_on(p_key text, p_day date) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.daily_statement_units_staging s
  WHERE s.attempt_id = (opx.get(p_key) ->> 'attempt_id')::uuid AND s.accounting_date = p_day $$;
CREATE FUNCTION opx.vkey(p_staging uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
    s.closing_balance_derived, s.day_total_debits, s.day_total_credits)
  FROM public.daily_statement_units_staging s WHERE s.id = p_staging $$;
CREATE FUNCTION opx.lines_of(p_staging uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.daily_statement_lines_staging WHERE staging_unit_id = p_staging $$;
CREATE FUNCTION opx.canonical(p_day_unit text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.daily_statement_units_canonical WHERE day_unit_id = p_day_unit AND status = 'ingested' $$;
CREATE FUNCTION opx.day_unit(p_staging uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT day_unit_id FROM public.daily_statement_units_staging WHERE id = p_staging $$;
CREATE FUNCTION opx.sources(p_staging uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_text_hash', x.raw_text_hash, 'account_registry_id', x.account_registry_id,
           'first_seen_at', x.first_seen_at) ORDER BY x.raw_text_hash), '[]'::jsonb)
  FROM public.daily_stmt_version_sources(opx.day_unit(p_staging), opx.vkey(p_staging)) x $$;
GRANT USAGE ON SCHEMA opx TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA opx TO authenticated;
GRANT INSERT, UPDATE ON opx.ctx TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA opx TO authenticated;

SELECT tr_test.assert((SELECT count(*) FROM opx.payloads) = 17, 'dix-sept charges produites par le pipeline réel');
SELECT 'PASS 33a_operational_setup' AS marker;
