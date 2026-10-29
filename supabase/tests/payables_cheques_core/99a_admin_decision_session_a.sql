-- Session A : décision administrative gardée 4 secondes (verrou partagé sur l'autorité).
SELECT pc_test.as_user('dg');
BEGIN;
SELECT public.payables_admin_create_person_v1(pc_test.key('race-person-a'), 'Personne course remplacement', 'Décision en cours');
SELECT pg_sleep(4);
COMMIT;
