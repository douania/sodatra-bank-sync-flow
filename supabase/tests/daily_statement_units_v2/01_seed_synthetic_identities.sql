-- ============================================================================
-- 0H — SEED IDENTITÉS 100 % SYNTHÉTIQUES (TESTS UNIQUEMENT)
-- ============================================================================
-- Un utilisateur par rôle. Doctrine SECURITY_CONTRACT §2 : on ne suppose pas
-- qu'un admin possède aussi le rôle user — chaque identité porte UN rôle.
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email) VALUES
  (poc_test.uid_admin(),   'synthetic-admin@test.invalid'),
  (poc_test.uid_manager(), 'synthetic-manager@test.invalid'),
  (poc_test.uid_auditor(), 'synthetic-auditor@test.invalid'),
  (poc_test.uid_user(),    'synthetic-user@test.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  (poc_test.uid_admin(),   'admin'),
  (poc_test.uid_manager(), 'manager'),
  (poc_test.uid_auditor(), 'auditor'),
  (poc_test.uid_user(),    'user')
ON CONFLICT (user_id, role) DO NOTHING;

SELECT poc_test.assert(
  (SELECT count(*) FROM public.user_roles) = 4,
  'seed: 4 identites synthetiques, un role chacune'
);
