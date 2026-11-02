-- Identités synthétiques (.invalid) et habilitations par le mécanisme EXISTANT :
-- désignation de l'administrateur unique par le canal opérateur, puis
-- attribution individuelle de READ / AUDIT / BANK_READ par cet administrateur.
-- Le déclencheur on_auth_user_created attribue le profil global « user ».
\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email) VALUES
  ('71000000-0000-4000-8000-000000000001', 'tr.admin@synthetic.invalid'),
  ('71000000-0000-4000-8000-000000000002', 'tr.reader@synthetic.invalid'),
  ('71000000-0000-4000-8000-000000000003', 'tr.read-only@synthetic.invalid'),
  ('71000000-0000-4000-8000-000000000004', 'tr.plain@synthetic.invalid'),
  ('71000000-0000-4000-8000-000000000005', 'tr.auditor@synthetic.invalid');
SELECT tr_test.put('t_admin', '71000000-0000-4000-8000-000000000001');
SELECT tr_test.put('t_reader', '71000000-0000-4000-8000-000000000002');
SELECT tr_test.put('t_read_only', '71000000-0000-4000-8000-000000000003');
SELECT tr_test.put('t_plain', '71000000-0000-4000-8000-000000000004');
SELECT tr_test.put('t_auditor', '71000000-0000-4000-8000-000000000005');

SELECT tr_test.assert((SELECT count(*) FROM public.user_roles WHERE user_id = tr_test.id('t_plain') AND role = 'user') = 1,
  'profil global user attribué par le déclencheur existant');

SELECT payables_private.set_module_admin(NULL, tr_test.id('t_admin'), 'Désignation synthétique de l''administrateur unique');

SELECT tr_test.as_user('t_admin');
SELECT public.payables_admin_set_capability_v1(tr_test.key('grant-reader-read'), tr_test.id('t_reader'), 'READ', true, 'Lecture synthétique');
SELECT public.payables_admin_set_capability_v1(tr_test.key('grant-reader-bank'), tr_test.id('t_reader'), 'BANK_READ', true, 'Lecture bancaire synthétique');
SELECT public.payables_admin_set_capability_v1(tr_test.key('grant-ro-read'), tr_test.id('t_read_only'), 'READ', true, 'Lecture synthétique sans BANK_READ');
SELECT public.payables_admin_set_capability_v1(tr_test.key('grant-aud-audit'), tr_test.id('t_auditor'), 'AUDIT', true, 'Audit synthétique');
SELECT public.payables_admin_set_capability_v1(tr_test.key('grant-aud-bank'), tr_test.id('t_auditor'), 'BANK_READ', true, 'Lecture bancaire synthétique');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT tr_test.assert(payables_private.has_capability(tr_test.id('t_reader'), 'BANK_READ'), 'reader : BANK_READ');
SELECT tr_test.assert(NOT payables_private.has_capability(tr_test.id('t_read_only'), 'BANK_READ'), 'read_only : sans BANK_READ');
SELECT tr_test.assert(NOT payables_private.has_capability(tr_test.id('t_plain'), 'READ'), 'plain : aucune capacité');

SELECT 'PASS 05_users_governance' AS marker;
