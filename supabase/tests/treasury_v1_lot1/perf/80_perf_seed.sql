-- C7 (R6) : volume synthétique de mesure, sans aucune donnée réelle.
-- 10 comptes, 10 ans de journées (2016-11-01 à 2026-10-31), 30 lignes par jour,
-- plus : doublons de même version, livraisons en attente et écartées, doublons
-- à version financière différente, ventilations différentes, versions aux
-- données insuffisantes, réfutations (livraison fraîche et pièce, plusieurs
-- sources, redépôts), attestations et révocations, remplacements, corrections
-- des seuls soldes, plusieurs points de départ par compte (effectif, suspendu,
-- révoqué). Écriture directe en session postgres jetable (déclencheurs de garde
-- désactivés le temps du chargement) : l'objet mesuré est la LECTURE.
\set ON_ERROR_STOP on

SELECT treasury_private.set_module_open(true, 'tr-perf:ouverture-locale', 'Ouverture synthétique pour la mesure C7',
  'operateur-perf');
SELECT treasury_private.set_bank_format_qualification(b, f, 'QUALIFIED', 'tr-perf:preuve-synthetique',
  'Qualification synthétique de mesure, sans valeur réelle', 'operateur-perf')
FROM (VALUES ('ORA', 'structured_bank_statement_csv'), ('BDK', 'structured_bank_statement_csv'),
             ('ATB', 'structured_bank_statement_xls'), ('BICIS', 'structured_bank_statement_xls'),
             ('BIS', 'structured_bank_statement_xls'), ('BRIDGE', 'structured_bank_statement_xlsx')) AS q(b, f);

SET session_replication_role = replica;
CREATE TABLE tr_test.perf_accounts AS
SELECT k, bank,
       CASE WHEN bank IN ('ORA', 'BDK') THEN 'structured_bank_statement_csv'
            WHEN bank = 'BRIDGE' THEN 'structured_bank_statement_xlsx' ELSE 'structured_bank_statement_xls' END AS fmt,
       CASE bank WHEN 'ATB' THEN 'structured-excel-0q/atb-online-xls-v1'
                 WHEN 'BICIS' THEN 'structured-excel-0q/bicis-online-xls-v1'
                 WHEN 'BIS' THEN 'structured-excel-0q/bis-online-xls-v1'
                 WHEN 'BRIDGE' THEN 'structured-excel-0q/bridge-online-xlsx-v1'
                 ELSE 'structured-csv-0b' END AS parser,
       tr_test.seed_registry('perf_' || k, bank, 'XOF', 'TR PERF ' || k) AS rid
FROM unnest(ARRAY['ORA', 'BDK', 'ATB', 'BICIS', 'BIS', 'BRIDGE', 'ORA', 'BDK', 'ATB', 'BIS']) WITH ORDINALITY AS t(bank, k);
SET session_replication_role = origin;
GRANT SELECT ON tr_test.perf_accounts TO authenticated;

SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('perf-add-' || k), rid, NULL, NULL, NULL,
  'Compte attendu synthétique de mesure ' || k)
FROM tr_test.perf_accounts;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SET session_replication_role = replica;

-- Fichiers mensuels (120 par compte), déposés le lendemain de la fin de période.
CREATE TABLE tr_test.perf_files AS
SELECT a.k, a.rid, m, gen_random_uuid() AS attempt_id,
       (date '2016-11-01' + make_interval(months => m))::date AS p_start,
       least((date '2016-11-01' + make_interval(months => m + 1))::date - 1, date '2026-10-31') AS p_end
FROM tr_test.perf_accounts a CROSS JOIN generate_series(0, 119) m;

INSERT INTO public.daily_statement_export_attempts (
  id, created_at, created_by, requested_mode, source_format, bank, currency, account_fingerprint, raw_text_hash,
  export_period_start, export_period_end, export_reference_date, parser_validation_status, runtime_version,
  parser_version, ingestion_ready, bridge_guard_passed, period_days, units_total, account_registry_id, review_reason_codes)
SELECT f.attempt_id, (f.p_end + 1) + time '08:00', tr_test.id('t_admin'), 'daily', a.fmt, a.bank, 'XOF', r.account_fingerprint,
       encode(sha256(convert_to('perf-raw:' || f.k || ':' || f.m, 'UTF8')), 'hex'), f.p_start, f.p_end, f.p_end, 'valid',
       'tr-perf', a.parser, true, true, f.p_end - f.p_start + 1, f.p_end - f.p_start + 1, a.rid, '{}'
FROM tr_test.perf_files f
JOIN tr_test.perf_accounts a ON a.k = f.k
JOIN public.daily_statement_account_registry r ON r.id = a.rid;

-- Journées : 15 débits et 15 crédits déterministes par jour, chaîne cohérente.
CREATE TABLE tr_test.perf_days AS
WITH d AS (
  SELECT a.k, a.rid, a.bank, g::date AS day, (g::date - date '2016-11-01') AS idx,
         sum(((((g::date - date '2016-11-01') * 7 + j * 13 + a.k::int * 3) % 997) + 1) * 100) FILTER (WHERE j <= 15) AS debits,
         sum(((((g::date - date '2016-11-01') * 11 + j * 17 + a.k::int * 5) % 991) + 1) * 100) FILTER (WHERE j > 15) AS credits
  FROM tr_test.perf_accounts a
  CROSS JOIN generate_series(date '2016-11-01', date '2026-10-31', interval '1 day') g
  CROSS JOIN generate_series(1, 30) j
  GROUP BY a.k, a.rid, a.bank, g
)
SELECT d.*, f.attempt_id, f.p_end, gen_random_uuid() AS staging_id, gen_random_uuid() AS canonical_id,
       'tr-perf:' || d.rid || ':' || d.day AS day_unit_id,
       encode(sha256(convert_to('perf-content:' || d.rid || ':' || d.day, 'UTF8')), 'hex') AS content_hash,
       10000000 + coalesce(sum(d.credits - d.debits) OVER (PARTITION BY d.k ORDER BY d.day
         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS opening
FROM d
JOIN tr_test.perf_files f ON f.k = d.k AND d.day BETWEEN f.p_start AND f.p_end;
ALTER TABLE tr_test.perf_days ADD COLUMN closing numeric;
UPDATE tr_test.perf_days SET closing = opening + credits - debits;
CREATE INDEX ON tr_test.perf_days (k, day);

-- Les deux derniers jours restent en attente (staged), sans unité retenue.
INSERT INTO public.daily_statement_units_staging (
  id, attempt_id, day_unit_id, bank, account_fingerprint, currency, accounting_date, day_content_hash, line_count,
  day_total_debits, day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status,
  validation_status, status, created_by, account_registry_id)
SELECT p.staging_id, p.attempt_id, p.day_unit_id, p.bank, r.account_fingerprint, 'XOF', p.day, p.content_hash, 30,
       p.debits, p.credits, p.opening, p.closing, 'derived', 'valid',
       CASE WHEN p.day >= date '2026-10-30' THEN 'staged' ELSE 'promoted' END, tr_test.id('t_admin'), p.rid
FROM tr_test.perf_days p JOIN public.daily_statement_account_registry r ON r.id = p.rid;

INSERT INTO public.daily_statement_units_canonical (
  id, promoted_from_staging_unit_id, day_unit_id, bank, account_fingerprint, currency, accounting_date,
  active_day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
  closing_balance_derived, aggregates_status, validation_status, status, account_registry_id, ingested_at)
SELECT p.canonical_id, p.staging_id, p.day_unit_id, p.bank, r.account_fingerprint, 'XOF', p.day, p.content_hash, 30,
       p.debits, p.credits, p.opening, p.closing, 'derived', 'valid', 'ingested', p.rid, (p.p_end + 1) + time '09:00'
FROM tr_test.perf_days p JOIN public.daily_statement_account_registry r ON r.id = p.rid
WHERE p.day < date '2026-10-30';

-- Lignes canonical : 30 par jour, solde courant cohérent (environ 1,1 million de lignes).
INSERT INTO public.daily_statement_lines_canonical (
  canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal, source_line_index, is_active,
  accounting_date, value_date, description_sanitized, debit_amount, credit_amount, signed_amount,
  running_balance, direction, currency)
SELECT x.canonical_id, x.day_unit_id, encode(sha256(convert_to('perf-line:' || x.canonical_id || ':' || x.j, 'UTF8')), 'hex'),
       1, x.j - 1, true, x.day, CASE WHEN x.j % 3 = 0 THEN x.day END, 'Opération synthétique',
       CASE WHEN x.amount < 0 THEN -x.amount END, CASE WHEN x.amount > 0 THEN x.amount END, x.amount,
       x.opening + sum(x.amount) OVER (PARTITION BY x.canonical_id ORDER BY x.j), CASE WHEN x.amount < 0 THEN 'debit' ELSE 'credit' END,
       'XOF'
FROM (
  SELECT p.canonical_id, p.day_unit_id, p.day, p.opening, j,
         CASE WHEN j <= 15 THEN -(((p.idx * 7 + j * 13 + p.k::int * 3) % 997) + 1) * 100
              ELSE (((p.idx * 11 + j * 17 + p.k::int * 5) % 991) + 1) * 100 END::numeric AS amount
  FROM tr_test.perf_days p CROSS JOIN generate_series(1, 30) j
  WHERE p.day < date '2026-10-30'
) x;

-- Lignes staging : chaque livraison porte les siennes, comme le pipeline les
-- stocke (P1 de la contre-revue CTO : la lecture contrôle leur concordance), y
-- compris les deux journées en attente (environ 1,1 million de lignes de plus).
INSERT INTO public.daily_statement_lines_staging (
  staging_unit_id, attempt_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal, source_line_index,
  accounting_date, value_date, description_sanitized, debit_amount, credit_amount, signed_amount,
  running_balance, direction, currency)
SELECT x.staging_id, x.attempt_id, x.day_unit_id,
       encode(sha256(convert_to('perf-sline:' || x.staging_id || ':' || x.j, 'UTF8')), 'hex'),
       1, x.j - 1, x.day, CASE WHEN x.j % 3 = 0 THEN x.day END, 'Opération synthétique',
       CASE WHEN x.amount < 0 THEN -x.amount END, CASE WHEN x.amount > 0 THEN x.amount END, x.amount,
       x.opening + sum(x.amount) OVER (PARTITION BY x.staging_id ORDER BY x.j), CASE WHEN x.amount < 0 THEN 'debit' ELSE 'credit' END,
       'XOF'
FROM (
  SELECT p.staging_id, p.attempt_id, p.day_unit_id, p.day, p.opening, j,
         CASE WHEN j <= 15 THEN -(((p.idx * 7 + j * 13 + p.k::int * 3) % 997) + 1) * 100
              ELSE (((p.idx * 11 + j * 17 + p.k::int * 5) % 991) + 1) * 100 END::numeric AS amount
  FROM tr_test.perf_days p CROSS JOIN generate_series(1, 30) j
) x;

-- Anomalies, réparties de façon déterministe dans l'historique de chaque compte.
DO $$
DECLARE
  p record;
  v_att uuid;
  v_dup uuid;
  v_ref uuid;
  v_piece uuid;
  v_new uuid;
  v_n integer := 0;
BEGIN
  FOR p IN SELECT d.*, r.account_fingerprint FROM tr_test.perf_days d
           JOIN public.daily_statement_account_registry r ON r.id = d.rid
           WHERE d.day < date '2026-10-30' AND d.idx > 0 AND d.idx % 61 IN (5, 17, 29, 41, 53)
           ORDER BY d.k, d.day LOOP
    v_n := v_n + 1;
    v_att := gen_random_uuid();
    -- Fichier de relivraison (redépôt), déposé 20 jours après la journée.
    INSERT INTO public.daily_statement_export_attempts (
      id, created_at, created_by, requested_mode, source_format, bank, currency, account_fingerprint, raw_text_hash,
      export_period_start, export_period_end, export_reference_date, parser_validation_status, runtime_version,
      parser_version, ingestion_ready, bridge_guard_passed, period_days, units_total, account_registry_id, review_reason_codes)
    SELECT v_att, (p.day + 20) + time '10:00', tr_test.id('t_admin'), 'daily', a.fmt, a.bank, 'XOF', p.account_fingerprint,
           encode(sha256(convert_to('perf-redelivery:' || p.k || ':' || p.day, 'UTF8')), 'hex'), p.day, p.day, p.day,
           CASE WHEN a.bank IN ('ATB', 'BICIS') AND p.idx % 61 = 41 THEN 'needs_review' ELSE 'valid' END, 'tr-perf',
           a.parser, true, true, 1, 1, p.rid,
           CASE WHEN a.bank IN ('ATB', 'BICIS') AND p.idx % 61 = 41 THEN ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']
                ELSE '{}' END
    FROM tr_test.perf_accounts a WHERE a.k = p.k;

    v_dup := gen_random_uuid();
    IF p.idx % 61 = 5 THEN
      -- Doublon de même version (relivraison propre).
      INSERT INTO public.daily_statement_units_staging (id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
        accounting_date, day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
        closing_balance_derived, aggregates_status, validation_status, status, created_by, account_registry_id)
      VALUES (v_dup, v_att, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day, p.content_hash, 30, p.debits,
        p.credits, p.opening, p.closing, 'derived', 'valid', 'duplicate', tr_test.id('t_admin'), p.rid);
    ELSIF p.idx % 61 = 17 THEN
      -- Doublon à version financière différente (contradiction), réfuté une fois sur deux.
      INSERT INTO public.daily_statement_units_staging (id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
        accounting_date, day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
        closing_balance_derived, aggregates_status, validation_status, status, created_by, account_registry_id)
      VALUES (v_dup, v_att, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day, p.content_hash, 30, p.debits,
        p.credits, p.opening + 500, p.closing + 500, 'derived', 'valid', 'duplicate', tr_test.id('t_admin'), p.rid);
      IF v_n % 2 = 0 THEN
        v_ref := gen_random_uuid();
        IF v_n % 4 = 0 THEN
          v_piece := gen_random_uuid();
          INSERT INTO public.daily_statement_correction_pieces (id, account_registry_id, piece_sha256, piece_reference,
            archive_reference, issued_on, archive_attested, actor_id)
          VALUES (v_piece, p.rid, encode(sha256(convert_to('perf-piece:' || v_ref, 'UTF8')), 'hex'), 'PIECE-PERF-' || v_n,
            'ARCH-PERF-' || v_n, p.day + 30, true, tr_test.id('t_admin'));
        END IF;
        INSERT INTO public.daily_statement_version_refutations (id, action, day_unit_id, account_registry_id, accounting_date,
          refuted_version_key, retained_canonical_unit_id, retained_version_key, comparison, proof_kind,
          proof_staging_unit_id, proof_bound_day, piece_id, piece_opening, piece_closing, reason, actor_id)
        VALUES (v_ref, 'REFUTE', p.day_unit_id, p.rid, p.day,
          public.daily_stmt_version_key(p.content_hash, 'derived', p.opening + 500, p.closing + 500, p.debits, p.credits),
          p.canonical_id, public.daily_stmt_version_key(p.content_hash, 'derived', p.opening, p.closing, p.debits, p.credits),
          'CONTRADICTION', CASE WHEN v_n % 4 = 0 THEN 'BANK_PIECE' ELSE 'FRESH_DELIVERY' END,
          CASE WHEN v_n % 4 = 0 THEN NULL ELSE p.staging_id END, p.day + 30, CASE WHEN v_n % 4 = 0 THEN v_piece END,
          CASE WHEN v_n % 4 = 0 THEN p.opening END, CASE WHEN v_n % 4 = 0 THEN p.closing END,
          'Réfutation synthétique de mesure', tr_test.id('t_admin'));
        INSERT INTO public.daily_statement_refutation_sources (refutation_id, raw_text_hash, account_registry_id,
          first_seen_at, proof_bound_day, verdict)
        SELECT v_ref, a.raw_text_hash, p.rid, a.created_at, p.day + 30, 'JUSTIFIED'
        FROM public.daily_statement_export_attempts a WHERE a.id = v_att;
      END IF;
    ELSIF p.idx % 61 = 29 THEN
      -- Ventilation différente au même net (accord établi, non bloquant).
      INSERT INTO public.daily_statement_units_staging (id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
        accounting_date, day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
        closing_balance_derived, aggregates_status, validation_status, status, created_by, account_registry_id)
      VALUES (v_dup, v_att, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day,
        encode(sha256(convert_to('perf-breakdown:' || p.day_unit_id, 'UTF8')), 'hex'), 32, p.debits + 700, p.credits + 700,
        p.opening, p.closing, 'derived', 'valid', 'conflict', tr_test.id('t_admin'), p.rid);
    ELSIF p.idx % 61 = 41 THEN
      -- Livraison aux données insuffisantes, écartée une fois sur deux ; attestation (puis révocation) du fichier Excel.
      INSERT INTO public.daily_statement_units_staging (id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
        accounting_date, day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
        closing_balance_derived, aggregates_status, validation_status, status, created_by, account_registry_id)
      VALUES (v_dup, v_att, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day,
        encode(sha256(convert_to('perf-insufficient:' || p.day_unit_id, 'UTF8')), 'hex'), 30, p.debits, p.credits,
        NULL, NULL, 'unavailable', 'valid', CASE WHEN v_n % 2 = 0 THEN 'rejected' ELSE 'needs_review' END,
        tr_test.id('t_admin'), p.rid);
      IF p.bank IN ('ATB', 'BICIS') THEN
        INSERT INTO public.daily_statement_attempt_attestations (attempt_id, attestation_type, action, raw_text_hash,
          account_registry_id, currency, evidence_ref, reason, actor_id)
        SELECT v_att, 'ACCOUNT_IDENTITY', 'ATTEST', a.raw_text_hash, p.rid, 'XOF', 'PREUVE-PERF', 'Attestation de mesure',
               tr_test.id('t_admin')
        FROM public.daily_statement_export_attempts a WHERE a.id = v_att;
        IF v_n % 3 = 0 THEN
          INSERT INTO public.daily_statement_attempt_attestations (attempt_id, attestation_type, action, raw_text_hash,
            account_registry_id, currency, revokes_id, reason, actor_id)
          SELECT v_att, 'ACCOUNT_IDENTITY', 'REVOKE', a.raw_text_hash, p.rid, 'XOF', t.id, 'Révocation de mesure',
                 tr_test.id('t_admin')
          FROM public.daily_statement_export_attempts a
          JOIN public.daily_statement_attempt_attestations t ON t.attempt_id = a.id AND t.action = 'ATTEST'
          WHERE a.id = v_att;
        END IF;
      END IF;
    ELSE
      -- Remplacement : l'ancienne unité (supersede, ou correction des seuls soldes une fois sur deux) reste en historique.
      v_new := gen_random_uuid();
      INSERT INTO public.daily_statement_units_staging (id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
        accounting_date, day_content_hash, line_count, day_total_debits, day_total_credits, opening_balance_derived,
        closing_balance_derived, aggregates_status, validation_status, status, created_by, account_registry_id)
      VALUES (v_dup, v_att, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day,
        CASE WHEN v_n % 2 = 0 THEN p.content_hash ELSE encode(sha256(convert_to('perf-old:' || p.day_unit_id, 'UTF8')), 'hex') END,
        30, p.debits, p.credits, p.opening - 300, p.closing - 300, 'derived', 'valid', 'superseded', tr_test.id('t_admin'), p.rid);
      INSERT INTO public.daily_statement_units_canonical (id, promoted_from_staging_unit_id, day_unit_id, bank,
        account_fingerprint, currency, accounting_date, active_day_content_hash, line_count, day_total_debits,
        day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status, validation_status, status,
        account_registry_id, ingested_at, superseded_by, superseded_at)
      VALUES (v_new, v_dup, p.day_unit_id, p.bank, p.account_fingerprint, 'XOF', p.day,
        CASE WHEN v_n % 2 = 0 THEN p.content_hash ELSE encode(sha256(convert_to('perf-old:' || p.day_unit_id, 'UTF8')), 'hex') END,
        30, p.debits, p.credits, p.opening - 300, p.closing - 300, 'derived', 'valid', 'superseded', p.rid,
        (p.day + 1) + time '08:30', p.canonical_id, (p.day + 25) + time '09:00');
    END IF;
  END LOOP;
END $$;

-- Points de départ par compte : un effectif récent, un plus ancien (suspendu
-- s'il précède une contradiction), un révoqué.
INSERT INTO treasury_private.verified_starts (id, action, registry_account_id, day, canonical_unit_id, content_hash,
  verified_opening, evidence_ref, reason, actor_id)
SELECT gen_random_uuid(), 'SET', p.rid, p.day, p.canonical_id, p.content_hash, p.opening, 'PIECE-VS-PERF',
       'Point de départ synthétique de mesure', tr_test.id('t_admin')
FROM tr_test.perf_days p
WHERE p.day IN (date '2018-03-01', date '2022-06-01', date '2025-01-02');
INSERT INTO treasury_private.verified_starts (action, registry_account_id, day, canonical_unit_id, content_hash,
  verified_opening, evidence_ref, reason, revokes_id, actor_id)
SELECT 'REVOKE', v.registry_account_id, v.day, v.canonical_unit_id, v.content_hash, v.verified_opening, v.evidence_ref,
       'Révocation synthétique de mesure', v.id, tr_test.id('t_admin')
FROM treasury_private.verified_starts v WHERE v.action = 'SET' AND v.day = date '2018-03-01';

SET session_replication_role = origin;
ANALYZE;

SELECT 'PERF_SEED accounts=' || (SELECT count(*) FROM tr_test.perf_accounts)
    || ' files=' || (SELECT count(*) FROM public.daily_statement_export_attempts WHERE runtime_version = 'tr-perf')
    || ' staging=' || (SELECT count(*) FROM public.daily_statement_units_staging WHERE day_unit_id LIKE 'tr-perf:%')
    || ' canonical=' || (SELECT count(*) FROM public.daily_statement_units_canonical WHERE day_unit_id LIKE 'tr-perf:%')
    || ' lines=' || (SELECT count(*) FROM public.daily_statement_lines_canonical WHERE day_unit_id LIKE 'tr-perf:%')
    || ' staging_lines=' || (SELECT count(*) FROM public.daily_statement_lines_staging WHERE day_unit_id LIKE 'tr-perf:%')
    || ' refutations=' || (SELECT count(*) FROM public.daily_statement_version_refutations)
    || ' attestations=' || (SELECT count(*) FROM public.daily_statement_attempt_attestations)
    || ' verified_starts=' || (SELECT count(*) FROM treasury_private.verified_starts) AS marker;
SELECT 'PASS 80_perf_seed' AS marker;
