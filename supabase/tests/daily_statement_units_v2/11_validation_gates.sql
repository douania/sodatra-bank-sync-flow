-- ============================================================================
-- 0H — TESTS VALIDATION : dates strictes, montants, hex64, masque, fichier,
--       blocklist profonde, day_content_hash / day_unit_id (ancres TS)
-- ============================================================================
-- Exécuté en superuser (les helpers sont volontairement inaccessibles aux
-- rôles applicatifs — leur non-exécutabilité est couverte par 10_structure).
-- ============================================================================
\set ON_ERROR_STOP on

-- --- Dates strictes DD/MM/YYYY, indépendantes du DateStyle -------------------
SET datestyle TO 'ISO, MDY';

SELECT poc_test.assert(
  public.daily_stmt_parse_date_strict('03/07/2026') = DATE '2026-07-03',
  'dates/MDY 03/07/2026 -> 2026-07-03 (jamais 7 mars)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_date_strict('31/02/2026') $$,
  '%', 'dates/MDY 31/02/2026 rejete (date inexistante)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_date_strict('2026-07-03') $$,
  '%DAILY_STMT_DATE_FORMAT%', 'dates/MDY format ISO rejete'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_date_strict('3/7/2026') $$,
  '%DAILY_STMT_DATE_FORMAT%', 'dates/MDY 3/7/2026 rejete (2 chiffres exiges)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_date_strict(NULL) $$,
  '%DAILY_STMT_DATE_NULL%', 'dates/MDY NULL rejete'
);

SET datestyle TO 'ISO, DMY';

SELECT poc_test.assert(
  public.daily_stmt_parse_date_strict('03/07/2026') = DATE '2026-07-03',
  'dates/DMY 03/07/2026 -> 2026-07-03 (DateStyle sans effet)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_date_strict('31/02/2026') $$,
  '%', 'dates/DMY 31/02/2026 rejete'
);

RESET datestyle;

-- --- Montants stricts --------------------------------------------------------
SELECT poc_test.assert(
  public.daily_stmt_parse_amount_strict('1234.50') = 1234.50::numeric,
  'montant 2 decimales accepte'
);
SELECT poc_test.assert(
  public.daily_stmt_parse_amount_strict(NULL) IS NULL,
  'montant NULL (champ optionnel) accepte'
);
SELECT poc_test.assert(
  public.daily_stmt_parse_amount_strict('-200.00') = (-200.00)::numeric,
  'montant negatif legitime accepte'
);
-- Depuis 0H-FIX-AMOUNT-STRICT-PARITY, la regex format limite elle-même à 2
-- décimales (parité TS) : 3 décimales échouent au FORMAT, le check d'échelle
-- restant en ceinture.
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('10.123') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'montant 3 decimales rejete (pas d''arrondi silencieux)'
);
-- Parité stricte regex TS 0G : 3 decimales terminees par zero ('10.120' =
-- numeric 10.12) doivent echouer au FORMAT, jamais etre acceptees.
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('10.120') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%',
  'montant 3 decimales avec zero final rejete'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('abc') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'montant non numerique rejete');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('NaN') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'NaN rejete');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('Infinity') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'Infinity rejete');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('-inf') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', '-inf rejete');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict('1e10') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'notation exponentielle rejetee');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_parse_amount_strict(' 10.00') $$,
  '%DAILY_STMT_AMOUNT_FORMAT%', 'espace parasite rejete');

-- --- hex64 / masque / nom de fichier ----------------------------------------
SELECT poc_test.assert(
  public.daily_stmt_assert_hex64(repeat('a', 64), 'test') = repeat('a', 64),
  'hex64 valide accepte'
);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_hex64(upper(repeat('a', 64)), 'test') $$,
  '%DAILY_STMT_HEX_REQUIRED%', 'hex64 majuscules rejete');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_hex64('not-a-hash', 'test') $$,
  '%DAILY_STMT_HEX_REQUIRED%', 'hex64 forme invalide rejetee');

SELECT public.daily_stmt_assert_masked_account('****1234');
SELECT public.daily_stmt_assert_masked_account(NULL);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_masked_account('***12345') $$,
  '%DAILY_STMT_MASKED_ACCOUNT%', 'masque a 5 chiffres finaux refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_masked_account('12345678') $$,
  '%DAILY_STMT_MASKED_ACCOUNT%', 'compte non masque refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_masked_account('123456789012*45') $$,
  '%DAILY_STMT_MASKED_ACCOUNT%', 'compte quasi-complet avec asterisque refuse');

SELECT public.daily_stmt_assert_safe_file_name('releve synthetique.csv');
SELECT public.daily_stmt_assert_safe_file_name(NULL);
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_safe_file_name('exports/releve.csv') $$,
  '%DAILY_STMT_FILE_NAME_SENSITIVE%', 'separateur de chemin refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_safe_file_name('releve 01234567890.csv') $$,
  '%DAILY_STMT_FILE_NAME_SENSITIVE%', 'longue suite de chiffres refusee');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_safe_file_name('SN08SN00001234567890.csv') $$,
  '%DAILY_STMT_FILE_NAME_SENSITIVE%', 'motif IBAN-like refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_safe_file_name(repeat('x', 201)) $$,
  '%DAILY_STMT_FILE_NAME_SENSITIVE%', 'longueur excessive refusee');

-- --- Blocklist profonde ------------------------------------------------------
SELECT public.daily_stmt_assert_no_forbidden_keys(
  '{"raw_text_hash": "ok", "account_number_masked": "****1"}'::jsonb);
SELECT poc_test.assert(true, 'raw_text_hash / account_number_masked ne sont pas des faux positifs');

SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"raw_csv": "x"}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'raw_csv top-level refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"meta": {"rawCsv": "x"}}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'rawCsv (camelCase) imbrique refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('[{"deep": [{"account_number": "x"}]}]'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'account_number imbrique dans tableaux refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"a": {"b": {"iban": "x"}}}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'iban profondement imbrique refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"decoded_text": "x"}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'decoded_text refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"full_iban": "x"}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'full_iban refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"raw_account": "x"}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'raw_account refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_assert_no_forbidden_keys('{"account_number_raw": "x"}'::jsonb) $$,
  '%DAILY_STMT_FORBIDDEN_KEY%', 'account_number_raw refuse');

-- --- day_content_hash v2 : ANCRES DE PARITÉ TS (cross-runtime) ---------------
-- Vecteurs calculés par le module TS 0G (buildStructuredBankStatementDayContentHash)
-- sur main@ce59e849 — toute divergence de préimage SQL casse ces asserts.
SELECT poc_test.assert(
  public.daily_stmt_day_content_hash(
    repeat('d', 64), ARRAY[repeat('b', 64), repeat('a', 64)])
  = '0c34b9f9ca8ee720d6956b0eb30944663be0162ec4ded47fb99a411710bddb79',
  'ANCRE TS: day_content_hash([b*64,a*64]) identique au module TS 0G'
);
SELECT poc_test.assert(
  public.daily_stmt_day_content_hash(repeat('e', 64), ARRAY[repeat('c', 64)])
  = 'db790afb8f2575afc35cbd26fc623723aa874ad23800c83be855553224e2d627',
  'ANCRE TS: day_content_hash mono-ligne identique au module TS 0G'
);

-- Indépendance à l'ordre physique (tri lexical interne).
SELECT poc_test.assert(
  public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[repeat('a', 64), repeat('b', 64)])
  = public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[repeat('b', 64), repeat('a', 64)]),
  'day_content_hash independant de l''ordre des lignes'
);

-- Implémentation de test INDÉPENDANTE = même résultat (anti-circularité).
SELECT poc_test.assert(
  public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[repeat('b', 64), repeat('a', 64)])
  = poc_test.day_content_hash(repeat('d', 64), ARRAY[repeat('b', 64), repeat('a', 64)]),
  'day_content_hash: implementation migration = implementation de test independante'
);

-- Refus fail-closed.
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_day_content_hash('  ', ARRAY[repeat('a', 64)]) $$,
  '%DAILY_STMT_CONTENT_HASH_UNIT_ID%', 'day_content_hash dayUnitId vide refuse');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[]::text[]) $$,
  '%DAILY_STMT_CONTENT_HASH_EMPTY%', 'day_content_hash liste vide refusee');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY['not-a-hash']) $$,
  '%DAILY_STMT_CONTENT_HASH_ENTRY%', 'day_content_hash entree non 64-hex refusee');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[upper(repeat('a', 64))]) $$,
  '%DAILY_STMT_CONTENT_HASH_ENTRY%', 'day_content_hash entree majuscules refusee');
SELECT poc_test.expect_error(
  $$ SELECT public.daily_stmt_day_content_hash(repeat('d', 64), ARRAY[repeat('a', 64), repeat('a', 64)]) $$,
  '%DAILY_STMT_CONTENT_HASH_DUPLICATE%', 'day_content_hash doublon refuse (bug ordinal)');

-- --- day_unit_id v2 : ANCRE DE PARITÉ TS -------------------------------------
-- Vecteur calculé par buildStructuredBankStatementDayUnitId (0E/0H TS).
SELECT poc_test.assert(
  public.daily_stmt_day_unit_id('ORA', 'SYNTHETIC-FINGERPRINT-0001', 'XOF', '29/06/2026')
  = '4e65e4f6936949c44766643dbe6bebbcb322a78cdd8b5080b1474a5400cc3497',
  'ANCRE TS: day_unit_id identique au module TS 0E/0H'
);
-- Implémentation de test indépendante = même résultat (contexte de test).
SELECT poc_test.assert(
  public.daily_stmt_day_unit_id('BKTEST', 'fp_synth_v2', 'XOF', '01/05/2026')
  = poc_test.day_unit_id('BKTEST', '01/05/2026'),
  'day_unit_id: implementation migration = implementation de test independante'
);

SELECT 'validation gates v2: PASS' AS status;
