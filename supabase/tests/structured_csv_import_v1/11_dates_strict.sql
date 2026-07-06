-- ============================================================================
-- 0U — TESTS DATES STRICTES DD/MM/YYYY (T12 — décision CTO 10, draft 5B)
-- ============================================================================
-- Vérifie l'indépendance au DateStyle de session : 'ISO, MDY' PUIS 'ISO, DMY'.
-- Exécuté en superuser (le helper est volontairement inaccessible aux rôles
-- applicatifs — sa non-exécutabilité est couverte par 10_structure).
-- ============================================================================
\set ON_ERROR_STOP on

SET datestyle TO 'ISO, MDY';

SELECT poc_test.assert(
  public.structured_csv_parse_date_strict('03/07/2026') = DATE '2026-07-03',
  'T12/MDY 03/07/2026 -> 2026-07-03 (jamais 7 mars)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict('31/02/2026') $$,
  '%', 'T12/MDY 31/02/2026 rejete (date inexistante)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict('2026-07-03') $$,
  '%STRUCTURED_CSV_DATE_FORMAT%', 'T12/MDY format ISO rejete'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict('3/7/2026') $$,
  '%STRUCTURED_CSV_DATE_FORMAT%', 'T12/MDY 3/7/2026 rejete (2 chiffres exiges)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict(NULL) $$,
  '%STRUCTURED_CSV_DATE_NULL%', 'T12/MDY NULL rejete'
);

SET datestyle TO 'ISO, DMY';

SELECT poc_test.assert(
  public.structured_csv_parse_date_strict('03/07/2026') = DATE '2026-07-03',
  'T12/DMY 03/07/2026 -> 2026-07-03'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict('31/02/2026') $$,
  '%', 'T12/DMY 31/02/2026 rejete'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_date_strict('2026-07-03') $$,
  '%STRUCTURED_CSV_DATE_FORMAT%', 'T12/DMY format ISO rejete'
);

RESET datestyle;

-- Montants stricts : échelle max 2, pas d'arrondi silencieux.
SELECT poc_test.assert(
  public.structured_csv_parse_amount_strict('1234.50') = 1234.50::numeric,
  'montant 2 decimales accepte'
);
SELECT poc_test.assert(
  public.structured_csv_parse_amount_strict(NULL) IS NULL,
  'montant NULL (colonne optionnelle) accepte'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_amount_strict('10.123') $$,
  '%STRUCTURED_CSV_AMOUNT_SCALE%', 'montant 3 decimales rejete (pas d''arrondi silencieux)'
);
SELECT poc_test.expect_error(
  $$ SELECT public.structured_csv_parse_amount_strict('abc') $$,
  '%STRUCTURED_CSV_AMOUNT_FORMAT%', 'montant non numerique rejete'
);

SELECT 'dates & montants stricts: PASS' AS status;
