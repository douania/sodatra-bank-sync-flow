-- Lot 1 opérationnel : verrou Daily v2 refermé (17b), les quatre tables de
-- décision refusent toute écriture, même du propriétaire, et les commandes
-- refusent avant tout effet.
\set ON_ERROR_STOP on

SELECT poc_test.expect_error(
  $$INSERT INTO public.daily_statement_correction_pieces (account_registry_id, piece_sha256, piece_reference,
      archive_reference, issued_on, archive_attested, actor_id)
    SELECT r.id, repeat('e', 64), 'Ref', 'Archive', DATE '2026-07-09', true, u.id
    FROM public.daily_statement_account_registry r CROSS JOIN auth.users u LIMIT 1$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'operational-post: pièces en lecture seule'
);
SELECT poc_test.expect_error(
  $$DELETE FROM public.daily_statement_attempt_attestations WHERE false$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'operational-post: attestations en lecture seule'
);
SELECT poc_test.expect_error(
  $$UPDATE public.daily_statement_version_refutations SET reason = reason WHERE false$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'operational-post: réfutations en lecture seule'
);
SELECT poc_test.expect_error(
  $$TRUNCATE public.daily_statement_refutation_sources$$,
  '%DAILY_STMT_APPEND_ONLY%',
  'operational-post: sources jamais tronquées'
);
SELECT poc_test.expect_error(
  $$SELECT public.reject_daily_statement_unit('operational-post-key', gen_random_uuid(), 'staged', NULL, NULL, 'Essai apres fermeture')$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'operational-post: commande refusée avant tout effet'
);

SELECT 'PASS 42b_operational_guard_post' AS marker;
