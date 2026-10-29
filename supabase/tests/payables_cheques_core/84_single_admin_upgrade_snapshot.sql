-- Mise à niveau (scénario « domaine déjà installé ») : relevé AVANT la
-- migration administrateur unique, après toute la recette sous l'ancienne
-- gouvernance. Le même relevé est refait par 85 après la migration.

-- États hérités que l'ancienne gouvernance permettait (85) :
--   - un compte rattaché prépare un chèque jusqu'à l'intention d'impression, puis
--     est détaché alors que ce chèque circule : son identité reste figée et le
--     résultat de l'impression reste enregistrable par un autre préparateur ;
--   - un compte jamais rattaché imprime un chèque, sans signature enregistrée :
--     une première identité peut lui être donnée.
INSERT INTO auth.users (id, email) VALUES ('10000000-0000-4000-8000-000000000056', 'comptable.d@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000057', 'comptable.e@synthetic.invalid');
INSERT INTO pc_test.ids (name, id) VALUES ('cpt_d', '10000000-0000-4000-8000-000000000056'),
  ('cpt_e', '10000000-0000-4000-8000-000000000057');
UPDATE payables_private.runtime_control
   SET business_writes_enabled = true, change_reason = 'Open synthetic window for the legacy identity fixture';
SELECT pc_test.grant_cap('gov_a', 'gov_b', u, c) FROM unnest(ARRAY['cpt_d','cpt_e']) u, unnest(ARRAY['READ','CHEQUE_PREPARE_PRINT']) c;
SELECT pc_test.make_person('p_cpt_d', 'Comptable D synthétique');
SELECT pc_test.link_person('p_cpt_d', 'cpt_d', 'gov_a', 'gov_b');
SELECT pc_test.new_payment('cpt_d', 'pay_legacy_d', 'sup_delta', 9000, 'acct_ora');
SELECT pc_test.as_user('cpt_d');
SELECT pc_test.put('form_legacy_d', (public.payables_assign_cheque_form_v1(pc_test.key('assign-legacy-d'), pc_test.id('pay_legacy_d'),
  pc_test.payment_version(pc_test.id('pay_legacy_d')), '0005101', 'ORA_CHQ_170X95', DATE '2026-10-27') ->> 'form_id')::uuid);
SELECT pc_test.put('pe_legacy_d', (public.payables_record_print_intent_v1(pc_test.key('intent-legacy-d'), pc_test.id('form_legacy_d'),
  pc_test.form_version(pc_test.id('form_legacy_d')), pc_test.content_of(pc_test.id('form_legacy_d')), 'Impression héritée')
  ->> 'print_event_id')::uuid);
SELECT pc_test.new_payment('cpt_e', 'pay_legacy_e', 'sup_delta', 8000, 'acct_ora');
SELECT pc_test.print_cheque('cpt_e', 'pay_legacy_e', '0005102', DATE '2026-10-27');
SELECT pc_test.as_user('gov_a');
SELECT pc_test.put('unlink_cpt_d', (public.payables_propose_person_link_v1(pc_test.key('unlink:p_cpt_d'), pc_test.id('p_cpt_d'),
  pc_test.id('cpt_d'), 'UNLINK', 'Retrait hérité') ->> 'link_id')::uuid);
SELECT pc_test.as_user('gov_b');
SELECT public.payables_decide_person_link_v1(pc_test.key('unlink-ok:p_cpt_d'), pc_test.id('unlink_cpt_d'), true, 'Validation héritée');
RESET ROLE;
UPDATE payables_private.runtime_control
   SET business_writes_enabled = false, change_reason = 'Close synthetic window after the legacy identity fixture';
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_d')) IS NULL
  AND (SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_legacy_d')) = 'PRINT_PENDING',
  'legacy fixture: unlinked while its print is pending');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_e')) IS NULL
  AND (SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_pay_legacy_e')) = 'PRINTED'
  AND NOT EXISTS (SELECT 1 FROM public.payables_signatures WHERE form_id = pc_test.id('form_pay_legacy_e')),
  'legacy fixture: never-linked preparer with a printed, unsigned cheque');

-- Contenu de chaque table du domaine (empreinte de toutes les lignes, colonne
-- « origin » ajoutée par la migration exclue des trois tables qui la reçoivent)
-- et définition de chaque objet hors gouvernance.
CREATE FUNCTION pc_test.upgrade_digest()
RETURNS TABLE (item text, rows bigint, digest text)
LANGUAGE plpgsql AS $$
DECLARE v record; v_rows bigint; v_digest text; v_strip text;
BEGIN
  FOR v IN
    SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND ((n.nspname = 'public' AND c.relname LIKE 'payables\_%' ESCAPE '\')
      OR (n.nspname = 'payables_private' AND c.relname IN ('runtime_control','runtime_control_events')))
    ORDER BY 1, 2
  LOOP
    v_strip := CASE WHEN v.relname IN ('payables_persons','payables_person_links','payables_parameter_versions')
                    THEN 'origin' ELSE '-' END;
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg((to_jsonb(t) - %L)::text, E''\n'' ORDER BY (to_jsonb(t) - %L)::text), ''''))
      FROM %I.%I t', v_strip, v_strip, v.nspname, v.relname) INTO v_rows, v_digest;
    item := 'table:' || v.nspname || '.' || v.relname; rows := v_rows; digest := v_digest;
    RETURN NEXT;
  END LOOP;
  -- Fonctions : toutes celles du domaine sauf les onze que la migration remplace.
  RETURN QUERY
  SELECT 'function:' || p.oid::regprocedure::text, 1::bigint,
         md5(concat_ws('|', p.prosrc, p.prosecdef::text, p.provolatile::text, p.proconfig::text, p.proacl::text,
           pg_get_function_result(p.oid)))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE ((n.nspname = 'public' AND p.proname LIKE 'payables\_%' ESCAPE '\') OR n.nspname = 'payables_private')
    AND NOT (n.nspname = 'payables_private' AND p.proname IN ('has_capability','require_capability','bootstrap_parameter_governance'))
    AND NOT (n.nspname = 'public' AND p.proname IN ('payables_propose_capability_v1','payables_decide_capability_v1',
      'payables_propose_person_v1','payables_decide_person_v1','payables_propose_person_link_v1',
      'payables_decide_person_link_v1','payables_propose_parameter_v1','payables_decide_parameter_v1',
      'payables_my_access_v1'));
  -- Politiques, déclencheurs et contraintes du domaine (sauf les cinq contraintes redéfinies).
  RETURN QUERY
  SELECT 'policy:' || pol.tablename || '.' || pol.policyname, 1::bigint,
         md5(concat_ws('|', pol.cmd, pol.roles::text, pol.qual, pol.with_check))
  FROM pg_policies pol WHERE pol.tablename LIKE 'payables\_%' ESCAPE '\';
  RETURN QUERY
  SELECT 'trigger:' || c.relname || '.' || t.tgname, 1::bigint, md5(pg_get_triggerdef(t.oid) || t.tgenabled::text)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND ((n.nspname = 'public' AND c.relname LIKE 'payables\_%' ESCAPE '\') OR n.nspname = 'payables_private');
  RETURN QUERY
  SELECT 'constraint:' || c.relname || '.' || k.conname, 1::bigint, md5(pg_get_constraintdef(k.oid))
  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE ((n.nspname = 'public' AND c.relname LIKE 'payables\_%' ESCAPE '\') OR n.nspname = 'payables_private')
    AND k.conname NOT IN ('payables_capability_grants_origin_check','payables_capability_grants_lifecycle',
      'payables_persons_lifecycle','payables_person_links_lifecycle','payables_parameter_versions_lifecycle');
END $$;

CREATE TABLE pc_test.upgrade_snapshot AS SELECT * FROM pc_test.upgrade_digest();
SELECT pc_test.assert((SELECT count(*) FROM pc_test.upgrade_snapshot WHERE item LIKE 'table:%' AND rows > 0) >= 20,
  'legacy domain holds data before the upgrade');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_capability_grants WHERE status = 'PROPOSED') >= 1
  AND (SELECT count(*) FROM public.payables_parameter_versions WHERE status = 'PROPOSED') >= 1,
  'legacy pending proposals exist before the upgrade');

SELECT 'PASS 84_single_admin_upgrade_snapshot' AS marker;
