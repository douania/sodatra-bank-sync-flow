-- ============================================================================
-- LOCAL-E2E-0U3 — ETAT HISTORIQUE SYNTHETIQUE AVANT MIGRATION 0U
-- ============================================================================
-- Ce seed s'exécute après la migration Daily v2 historique et AVANT 0U/0U3.
-- Il simule exclusivement l'état agrégé observé en staging : une identité,
-- trois journées canonical actives et un conflit R2 du même contexte.
-- Aucune valeur ne provient d'un relevé réel.
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO public.daily_statement_export_attempts (
  id, created_by, requested_mode, source_format, bank, currency,
  account_fingerprint, account_number_masked, source_file_name_redacted,
  raw_text_hash, export_period_start, export_period_end, statement_date,
  export_reference_date, parser_validation_status, errors_count,
  warnings_count, runtime_version, parser_version, ingestion_ready,
  bridge_guard_passed, period_days, backfill_grant_reference, units_total
) VALUES
  (
    '00000000-0000-4000-8000-00000000a900', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_xls', 'ATB', 'XOF', 'legacy_atb_identity_token_v1_01',
    '****9999', NULL, repeat('8',64), DATE '2035-01-01', DATE '2035-01-03',
    DATE '2035-01-03', DATE '2035-01-03', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 3, NULL, 3
  ),
  (
    '00000000-0000-4000-8000-00000000a910', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_xls', 'ATB', 'XOF', 'legacy_atb_identity_token_v1_01',
    '****9999', NULL, repeat('7',64), DATE '2035-01-01', DATE '2035-01-01',
    DATE '2035-01-01', DATE '2035-01-01', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 1, NULL, 1
  );

-- Deux fingerprints BICIS dans le même contexte : fixture d'ambiguïté.
INSERT INTO public.daily_statement_export_attempts (
  id, created_by, requested_mode, source_format, bank, currency,
  account_fingerprint, account_number_masked, source_file_name_redacted,
  raw_text_hash, export_period_start, export_period_end, statement_date,
  export_reference_date, parser_validation_status, errors_count,
  warnings_count, runtime_version, parser_version, ingestion_ready,
  bridge_guard_passed, period_days, backfill_grant_reference, units_total
) VALUES
  (
    '00000000-0000-4000-8000-00000000b900', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_xls', 'BICIS', 'XOF', repeat('6',64),
    '****6000', NULL, repeat('6',64), DATE '2035-02-01', DATE '2035-02-01',
    DATE '2035-02-01', DATE '2035-02-01', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 1, NULL, 1
  ),
  (
    '00000000-0000-4000-8000-00000000b910', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_xls', 'BICIS', 'XOF', repeat('5',64),
    '****5000', NULL, repeat('5',64), DATE '2035-02-02', DATE '2035-02-02',
    DATE '2035-02-02', DATE '2035-02-02', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 1, NULL, 1
  );

-- Une identité ORA avec deux masques divergents : fixture fail-closed.
INSERT INTO public.daily_statement_export_attempts (
  id, created_by, requested_mode, source_format, bank, currency,
  account_fingerprint, account_number_masked, source_file_name_redacted,
  raw_text_hash, export_period_start, export_period_end, statement_date,
  export_reference_date, parser_validation_status, errors_count,
  warnings_count, runtime_version, parser_version, ingestion_ready,
  bridge_guard_passed, period_days, backfill_grant_reference, units_total
) VALUES
  (
    '00000000-0000-4000-8000-00000000c900', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_csv', 'ORA', 'XOF', repeat('4',64),
    '****1111', NULL, repeat('4',64), DATE '2035-03-01', DATE '2035-03-01',
    DATE '2035-03-01', DATE '2035-03-01', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 1, NULL, 1
  ),
  (
    '00000000-0000-4000-8000-00000000c910', poc_test.uid_admin(),
    'daily', 'structured_bank_statement_csv', 'ORA', 'XOF', repeat('4',64),
    '****2222', NULL, repeat('3',64), DATE '2035-03-01', DATE '2035-03-01',
    DATE '2035-03-01', DATE '2035-03-01', 'valid', 0, 0,
    'synthetic-0u3', 'synthetic-0u3', true, true, 1, NULL, 1
  );

-- Une identité BRIDGE SHA-256 valide : fixture de non-régression du pont.
INSERT INTO public.daily_statement_export_attempts (
  id, created_by, requested_mode, source_format, bank, currency,
  account_fingerprint, account_number_masked, source_file_name_redacted,
  raw_text_hash, export_period_start, export_period_end, statement_date,
  export_reference_date, parser_validation_status, errors_count,
  warnings_count, runtime_version, parser_version, ingestion_ready,
  bridge_guard_passed, period_days, backfill_grant_reference, units_total
) VALUES (
  '00000000-0000-4000-8000-00000000d900', poc_test.uid_admin(),
  'daily', 'structured_bank_statement_xlsx', 'BRIDGE', 'XOF', repeat('2',64),
  NULL, NULL, repeat('2',64), DATE '2035-04-01', DATE '2035-04-01',
  DATE '2035-04-01', DATE '2035-04-01', 'valid', 0, 0,
  'synthetic-0u4', 'synthetic-0u4', true, true, 1, NULL, 1
);

INSERT INTO public.daily_statement_units_staging (
  id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
  accounting_date, day_content_hash, line_count, day_total_debits,
  day_total_credits, opening_balance_derived, closing_balance_derived,
  aggregates_status, validation_status, status, created_by
) VALUES
  (
    '00000000-0000-4000-8000-00000000a901',
    '00000000-0000-4000-8000-00000000a900', repeat('1',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-01', repeat('a',64),
    1, 10.00, 20.00, 100.00, 110.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000a902',
    '00000000-0000-4000-8000-00000000a900', repeat('2',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-02', repeat('b',64),
    1, 20.00, 30.00, 110.00, 120.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000a903',
    '00000000-0000-4000-8000-00000000a900', repeat('3',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-03', repeat('c',64),
    1, 30.00, 40.00, 120.00, 130.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000a911',
    '00000000-0000-4000-8000-00000000a910', repeat('1',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-01', repeat('d',64),
    1, 11.00, 21.00, 100.00, 110.00, 'derived', 'valid', 'conflict',
    poc_test.uid_admin()
  );

INSERT INTO public.daily_statement_units_staging (
  id, attempt_id, day_unit_id, bank, account_fingerprint, currency,
  accounting_date, day_content_hash, line_count, day_total_debits,
  day_total_credits, opening_balance_derived, closing_balance_derived,
  aggregates_status, validation_status, status, created_by
) VALUES
  (
    '00000000-0000-4000-8000-00000000b901',
    '00000000-0000-4000-8000-00000000b900', repeat('6',64),
    'BICIS', repeat('6',64), 'XOF', DATE '2035-02-01', repeat('6',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000b911',
    '00000000-0000-4000-8000-00000000b910', repeat('5',64),
    'BICIS', repeat('5',64), 'XOF', DATE '2035-02-02', repeat('5',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000c901',
    '00000000-0000-4000-8000-00000000c900', repeat('4',64),
    'ORA', repeat('4',64), 'XOF', DATE '2035-03-01', repeat('4',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000c911',
    '00000000-0000-4000-8000-00000000c910', repeat('4',64),
    'ORA', repeat('4',64), 'XOF', DATE '2035-03-01', repeat('e',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'duplicate',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000d901',
    '00000000-0000-4000-8000-00000000d900', repeat('f',64),
    'BRIDGE', repeat('2',64), 'XOF', DATE '2035-04-01', repeat('2',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'promoted',
    poc_test.uid_admin()
  );

-- Le trigger historique interdit justement les INSERT canonical directs.
-- Le seed de l'état PREEXISTANT le neutralise pour ces six lignes fixes
-- seulement ; il est réactivé immédiatement et les tests runtime l'exercent.
SET session_replication_role = replica;
INSERT INTO public.daily_statement_units_canonical (
  id, promoted_from_staging_unit_id, day_unit_id, bank,
  account_fingerprint, currency, accounting_date, active_day_content_hash,
  line_count, day_total_debits, day_total_credits, opening_balance_derived,
  closing_balance_derived, aggregates_status, validation_status, status,
  ingested_by
) VALUES
  (
    '00000000-0000-4000-8000-00000000a921',
    '00000000-0000-4000-8000-00000000a901', repeat('1',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-01', repeat('a',64),
    1, 10.00, 20.00, 100.00, 110.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000a922',
    '00000000-0000-4000-8000-00000000a902', repeat('2',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-02', repeat('b',64),
    1, 20.00, 30.00, 110.00, 120.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000a923',
    '00000000-0000-4000-8000-00000000a903', repeat('3',64),
    'ATB', 'legacy_atb_identity_token_v1_01', 'XOF', DATE '2035-01-03', repeat('c',64),
    1, 30.00, 40.00, 120.00, 130.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  );

INSERT INTO public.daily_statement_units_canonical (
  id, promoted_from_staging_unit_id, day_unit_id, bank,
  account_fingerprint, currency, accounting_date, active_day_content_hash,
  line_count, day_total_debits, day_total_credits, opening_balance_derived,
  closing_balance_derived, aggregates_status, validation_status, status,
  ingested_by
) VALUES
  (
    '00000000-0000-4000-8000-00000000b921',
    '00000000-0000-4000-8000-00000000b901', repeat('6',64),
    'BICIS', repeat('6',64), 'XOF', DATE '2035-02-01', repeat('6',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000b922',
    '00000000-0000-4000-8000-00000000b911', repeat('5',64),
    'BICIS', repeat('5',64), 'XOF', DATE '2035-02-02', repeat('5',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000c921',
    '00000000-0000-4000-8000-00000000c901', repeat('4',64),
    'ORA', repeat('4',64), 'XOF', DATE '2035-03-01', repeat('4',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  ),
  (
    '00000000-0000-4000-8000-00000000d921',
    '00000000-0000-4000-8000-00000000d901', repeat('f',64),
    'BRIDGE', repeat('2',64), 'XOF', DATE '2035-04-01', repeat('2',64),
    1, 1.00, 2.00, 10.00, 11.00, 'derived', 'valid', 'ingested',
    poc_test.uid_admin()
  );
SET session_replication_role = origin;

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE account_fingerprint = 'legacy_atb_identity_token_v1_01') = 3,
  '0U3-SEED-1: trois canonical historiques synthetiques');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE status = 'conflict'
     AND account_fingerprint = 'legacy_atb_identity_token_v1_01') = 1,
  '0U3-SEED-2: un conflit historique synthetique');
