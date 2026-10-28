-- Identités synthétiques du modèle administrateur unique (domaines .invalid).
-- Aucune identité réelle : le dirigeant, les comptables et le successeur
-- sont fictifs ; aucun nom, e-mail ou UUID réel n'apparaît dans le dépôt.

INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-4000-8000-000000000051', 'dirigeant@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000052', 'comptable.a@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000053', 'comptable.b@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000054', 'successeur@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000055', 'comptable.c@synthetic.invalid');
INSERT INTO pc_test.ids (name, id) VALUES
  ('dg', '10000000-0000-4000-8000-000000000051'), ('cpt_a', '10000000-0000-4000-8000-000000000052'),
  ('cpt_b', '10000000-0000-4000-8000-000000000053'), ('dg_next', '10000000-0000-4000-8000-000000000054'),
  ('cpt_c', '10000000-0000-4000-8000-000000000055');

SELECT 'PASS 05_single_admin_users' AS marker;
