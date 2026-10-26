-- Session A : lecture de la liste des factures dans UNE instruction dont
-- l'instantané est pris avant une attente de 3 secondes ; la lecture elle-même
-- ne s'exécute qu'après l'attente (dépendance explicite).
SELECT pc_test.as_user('acc4');
INSERT INTO pc_test.read_capture (payload)
SELECT public.payables_read_v1('invoice_overview' || s.slept)
FROM (SELECT pg_sleep(3)::text || '' AS slept) s;
