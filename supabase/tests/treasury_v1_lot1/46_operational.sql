-- Lot 1 opérationnel (R6) : comparaison à trois issues, écartement, cohérence
-- financière (réserve CTO 4.1), attestations, journée en attente, réfutation
-- justifiée source par source (F1 -> C -> F2 -> redépôt de F2) et points de
-- départ vérifiés ; P1 et P2 de la contre-revue CTO de la PR #156 : lignes
-- stockées conformes aux faits déclarés, statut courant des réfutations.
-- Données synthétiques ; rejouable dans une transaction annulée (mutants). Les
-- commandes Daily v2 sont appelées pour de vrai.
\set ON_ERROR_STOP on

CREATE SCHEMA tr_op;
GRANT USAGE ON SCHEMA tr_op TO authenticated;
CREATE TABLE tr_op.ctx (k text PRIMARY KEY, v jsonb);
GRANT SELECT ON tr_op.ctx TO authenticated;

-- Copie d'une livraison (mêmes mouvements et même version financière) dans un
-- autre export : redépôt ou nouvelle source d'une même version.
CREATE FUNCTION tr_op.clone_delivery(p_source uuid, p_export text, p_status text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid(); s public.daily_statement_units_staging%ROWTYPE;
        a public.daily_statement_export_attempts%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.daily_statement_units_staging WHERE id = p_source;
  SELECT * INTO a FROM public.daily_statement_export_attempts WHERE id = tr_test.id(p_export);
  INSERT INTO public.daily_statement_units_staging (
    id, attempt_id, day_unit_id, bank, account_fingerprint, currency, accounting_date, day_content_hash, line_count,
    day_total_debits, day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status,
    validation_status, status, created_by, account_registry_id, review_reason_codes)
  VALUES (v, a.id, s.day_unit_id, s.bank, s.account_fingerprint, s.currency, s.accounting_date, s.day_content_hash,
    s.line_count, s.day_total_debits, s.day_total_credits, s.opening_balance_derived, s.closing_balance_derived,
    s.aggregates_status, s.validation_status, p_status, tr_test.id('t_admin'), a.account_registry_id, s.review_reason_codes);
  RETURN v;
END $$;

CREATE FUNCTION tr_op.staging_of(p_canonical text)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT u.promoted_from_staging_unit_id FROM public.daily_statement_units_canonical u WHERE u.id = tr_test.id(p_canonical)
$$;

CREATE FUNCTION tr_op.vkey_staging(p_staging uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
    s.closing_balance_derived, s.day_total_debits, s.day_total_credits)
  FROM public.daily_statement_units_staging s WHERE s.id = p_staging
$$;

CREATE FUNCTION tr_op.sources(p_staging uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_text_hash', x.raw_text_hash, 'account_registry_id', x.account_registry_id,
           'first_seen_at', x.first_seen_at) ORDER BY x.raw_text_hash), '[]'::jsonb)
  FROM public.daily_statement_units_staging s,
       public.daily_stmt_version_sources(s.day_unit_id, tr_op.vkey_staging(s.id)) x
  WHERE s.id = p_staging
$$;

-- Lecture d'un constat d'un compte à D.
CREATE FUNCTION tr_op.finding(p_as_of date, p_name text, p_kind text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  SELECT f INTO v FROM jsonb_array_elements(tr_test.account(tr_test.read_as('t_reader', p_as_of), p_name) -> 'findings') f
  WHERE f ->> 'kind' = p_kind LIMIT 1;
  RETURN v;
END $$;
-- Statut courant d'une réfutation enregistrée, rendu par la lecture à D (P2).
CREATE FUNCTION tr_op.ref_status(p_as_of date, p_name text, p_ref uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  SELECT f INTO v FROM jsonb_array_elements(tr_test.account(tr_test.read_as('t_reader', p_as_of), p_name) -> 'findings') f
  WHERE f ->> 'kind' = 'REFUTATION_STATUS' AND (f ->> 'refutation_id')::uuid = p_ref;
  RETURN v;
END $$;
-- Lignes d'une unité retenue et de sa livraison promue, modifiées ensemble
-- (mode réplica) : décalage des soldes courants, ordre de stockage inversé.
CREATE FUNCTION tr_op.shift_running(p_canonical text, p_delta numeric)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.daily_statement_lines_canonical SET running_balance = running_balance + p_delta
   WHERE canonical_unit_id = tr_test.id(p_canonical);
  UPDATE public.daily_statement_lines_staging SET running_balance = running_balance + p_delta
   WHERE staging_unit_id = tr_op.staging_of(p_canonical);
$$;
CREATE FUNCTION tr_op.reverse_storage(p_canonical text)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.daily_statement_lines_canonical
     SET source_line_index = (SELECT max(x.source_line_index) FROM public.daily_statement_lines_canonical x
                               WHERE x.canonical_unit_id = tr_test.id(p_canonical)) - source_line_index
   WHERE canonical_unit_id = tr_test.id(p_canonical);
  UPDATE public.daily_statement_lines_staging
     SET source_line_index = (SELECT max(x.source_line_index) FROM public.daily_statement_lines_staging x
                               WHERE x.staging_unit_id = tr_op.staging_of(p_canonical)) - source_line_index
   WHERE staging_unit_id = tr_op.staging_of(p_canonical);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tr_op TO authenticated;

-- --------------------------------------------------------------------------
-- Données (mode réplica le temps de l'amorçage)
-- --------------------------------------------------------------------------
SET session_replication_role = replica;

-- A. Livraison en attente en accord établi (divergence de détail) : la journée
-- reste disputée, comme aujourd'hui.
SELECT tr_test.seed_registry('op_same', 'ORA', 'XOF', 'TR OP accord en attente');
SELECT tr_test.seed_export('e_op_same', 'op_same', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-04', '2026-10-05');
SELECT tr_test.seed_unit('e_op_same', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_same', '2026-10-02', 200, 300);
SELECT tr_test.seed_unit('e_op_same', '2026-10-03', 300, 400);
SELECT tr_test.seed_unit('e_op_same', '2026-10-04', 400, 410);
SELECT tr_test.seed_export('e_op_same2', 'op_same', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_op_same2', '2026-10-02', 200, 300, p_staging_status => 'staged', p_canonical => false);

-- B. Livraison en conflit, en accord établi avec ventilation différente (même
-- net, totaux différents) : non bloquante pour le seul Lot 1 (point I).
SELECT tr_test.seed_registry('op_breakdown', 'ORA', 'XOF', 'TR OP ventilation');
SELECT tr_test.seed_export('e_op_bd', 'op_breakdown', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_op_bd', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_bd', '2026-10-02', 200, 300);
SELECT tr_test.seed_unit('e_op_bd', '2026-10-03', 300, 400);
SELECT tr_test.seed_export('e_op_bd2', 'op_breakdown', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_op_bd2', '2026-10-02', 200, 300, p_staging_status => 'conflict', p_canonical => false, p_pairs => 1);

-- C. Livraison en conflit sans solde dérivé, même net : données insuffisantes.
SELECT tr_test.seed_registry('op_insuff', 'ORA', 'XOF', 'TR OP données insuffisantes');
SELECT tr_test.seed_export('e_op_in', 'op_insuff', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_op_in', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_in', '2026-10-02', 200, 300);
SELECT tr_test.seed_unit('e_op_in', '2026-10-03', 300, 400);
SELECT tr_test.seed_export('e_op_in2', 'op_insuff', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_op_in2', '2026-10-02', 200, 300, p_staging_status => 'conflict', p_canonical => false,
  p_aggregates => 'unavailable');

-- D. Livraison écartée avec lignes dans une période déclarée : jamais NOMOV.
SELECT tr_test.seed_registry('op_reject', 'ORA', 'XOF', 'TR OP écartée');
SELECT tr_test.seed_export('e_op_rj', 'op_reject', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-04', '2026-10-05');
SELECT tr_test.seed_unit('e_op_rj', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_rj', '2026-10-04', 200, 210);
SELECT tr_test.seed_export('e_op_rj2', 'op_reject', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_op_rj2', '2026-10-02', 200, 250, p_staging_status => 'rejected', p_canonical => false);

-- E. Réserve CTO 4.1 : ouverture 100, crédit 10, clôture 120, seule pour sa journée.
SELECT tr_test.seed_registry('op_incoh', 'BDK', 'XOF', 'TR OP incohérente');
SELECT tr_test.seed_export('e_op_ic', 'op_incoh', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-02', '2026-10-03');
SELECT tr_test.put('u_op_ic_01', tr_test.seed_unit('e_op_ic', '2026-10-01', 100, 110));
SELECT tr_test.seed_unit('e_op_ic', '2026-10-02', 120, 130);
UPDATE public.daily_statement_units_canonical SET closing_balance_derived = 120 WHERE id = tr_test.id('u_op_ic_01');
UPDATE public.daily_statement_units_staging SET closing_balance_derived = 120 WHERE id = tr_op.staging_of('u_op_ic_01');

-- F. Attestation d'identité d'un export Excel sans libellé (ATB).
SELECT tr_test.seed_registry('op_attest', 'ATB', 'XOF', 'TR OP attestation');
SELECT tr_test.seed_export('e_op_at', 'op_attest', 'structured_bank_statement_xls', 'structured-excel-0q/atb-online-xls-v1',
  '2026-10-01', '2026-10-03', NULL, 'valid', NULL, ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']);
SELECT tr_test.seed_unit('e_op_at', '2026-10-01', 100, 200, p_validation => 'needs_review');
SELECT tr_test.seed_unit('e_op_at', '2026-10-02', 200, 300, p_validation => 'needs_review');
SELECT tr_test.seed_unit('e_op_at', '2026-10-03', 300, 400, p_validation => 'needs_review');
UPDATE public.daily_statement_units_staging SET review_reason_codes = ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']
 WHERE attempt_id = tr_test.id('e_op_at');
UPDATE public.daily_statement_units_canonical c SET review_reason_codes = ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']
  FROM public.daily_statement_units_staging s WHERE s.id = c.promoted_from_staging_unit_id AND s.attempt_id = tr_test.id('e_op_at');

-- G. Compte dont toutes les livraisons sont en attente (A6).
SELECT tr_test.seed_registry('op_pending', 'ATB', 'XOF', 'TR OP attente seule');
SELECT tr_test.seed_export('e_op_pd', 'op_pending', 'structured_bank_statement_xls', 'structured-excel-0q/atb-online-xls-v1',
  '2026-10-02', '2026-10-03', NULL);
SELECT tr_test.seed_unit('e_op_pd', '2026-10-02', 100, 200, p_staging_status => 'staged', p_canonical => false);
SELECT tr_test.seed_unit('e_op_pd', '2026-10-03', 200, 300, p_staging_status => 'staged', p_canonical => false);

-- H. F1 -> C -> F2 -> redépôt de F2 (P1 de la R5). Journée J = le 10.
SELECT tr_test.seed_registry('op_ref', 'ORA', 'XOF', 'TR OP réfutation');
SELECT tr_test.seed_export('e_op_c', 'op_ref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-08', '2026-10-13', '2026-10-14', 'valid', '2026-10-14 08:00:00+00');
SELECT tr_test.seed_unit('e_op_c', '2026-10-09', 100, 200);
SELECT tr_test.put('u_op_ref_10', tr_test.seed_unit('e_op_c', '2026-10-10', 200, 300));
SELECT tr_test.seed_unit('e_op_c', '2026-10-13', 300, 310);
SELECT tr_test.seed_export('e_op_f1', 'op_ref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-10', '2026-10-10', NULL, 'valid', '2026-10-11 08:00:00+00');
SELECT tr_test.put('s_op_f1', tr_test.seed_unit('e_op_f1', '2026-10-10', 190, 290, p_staging_status => 'conflict',
  p_canonical => false));

-- I. Points de départ vérifiés : le 02 n'est livré qu'en attente ; le 03 repart.
SELECT tr_test.seed_registry('op_vs', 'ORA', 'XOF', 'TR OP point de départ');
SELECT tr_test.seed_export('e_op_vs1', 'op_vs', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', NULL);
SELECT tr_test.seed_unit('e_op_vs1', '2026-10-01', 100, 200);
SELECT tr_test.seed_export('e_op_vs2', 'op_vs', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', NULL);
SELECT tr_test.seed_unit('e_op_vs2', '2026-10-02', 200, 250, p_staging_status => 'staged', p_canonical => false);
SELECT tr_test.seed_export('e_op_vs3', 'op_vs', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-03', '2026-10-06', '2026-10-07');
SELECT tr_test.put('u_op_vs_03', tr_test.seed_unit('e_op_vs3', '2026-10-03', 250, 300));
SELECT tr_test.seed_unit('e_op_vs3', '2026-10-04', 300, 310);
SELECT tr_test.seed_unit('e_op_vs3', '2026-10-06', 400, 410);

-- J. Livraison écartée dont l'ouverture contredit la clôture de la veille.
SELECT tr_test.seed_registry('op_rejopen', 'ORA', 'XOF', 'TR OP écartée contradictoire');
SELECT tr_test.seed_export('e_op_ro', 'op_rejopen', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_op_ro', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_ro', '2026-10-03', 200, 210);
SELECT tr_test.seed_export('e_op_ro2', 'op_rejopen', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_op_ro2', '2026-10-02', 150, 160, p_staging_status => 'rejected', p_canonical => false);

-- K. Remplacement passé (supersede) : la livraison adoptée réfute automatiquement
-- la version remplacée si elle justifie chacune de ses sources (lecture).
SELECT tr_test.seed_registry('op_auto', 'ORA', 'XOF', 'TR OP adoption fraîche');
SELECT tr_test.seed_export('e_op_au0', 'op_auto', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', NULL);
SELECT tr_test.seed_unit('e_op_au0', '2026-10-01', 100, 200);
SELECT tr_test.seed_export('e_op_aua', 'op_auto', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', NULL, 'valid', '2026-10-03 08:00:00+00');
SELECT tr_test.put('u_op_au_old', tr_test.seed_unit('e_op_aua', '2026-10-02', 190, 290));
SELECT tr_test.seed_export('e_op_aus', 'op_auto', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-05', '2026-10-06', 'valid', '2026-10-08 08:00:00+00');
UPDATE public.daily_statement_units_canonical SET status = 'superseded', superseded_by = id, superseded_at = now()
 WHERE id = tr_test.id('u_op_au_old');
UPDATE public.daily_statement_lines_canonical SET is_active = false WHERE canonical_unit_id = tr_test.id('u_op_au_old');
SELECT tr_test.put('u_op_au_new', tr_test.seed_unit('e_op_aus', '2026-10-02', 200, 300));
SELECT tr_test.seed_unit('e_op_aus', '2026-10-05', 300, 310);
UPDATE public.daily_statement_units_canonical SET superseded_by = tr_test.id('u_op_au_new') WHERE id = tr_test.id('u_op_au_old');
-- Même remplacement, mais l'export adopté ne porte aucune journée postérieure au
-- premier dépôt de la version remplacée : aucune réfutation automatique.
SELECT tr_test.seed_registry('op_auto2', 'ORA', 'XOF', 'TR OP adoption non fraîche');
SELECT tr_test.seed_export('e_op_bu0', 'op_auto2', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', NULL);
SELECT tr_test.seed_unit('e_op_bu0', '2026-10-01', 100, 200);
SELECT tr_test.seed_export('e_op_bua', 'op_auto2', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', NULL, 'valid', '2026-10-06 08:00:00+00');
SELECT tr_test.put('u_op_bu_old', tr_test.seed_unit('e_op_bua', '2026-10-02', 190, 290));
SELECT tr_test.seed_export('e_op_bus', 'op_auto2', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-05', '2026-10-06', 'valid', '2026-10-08 08:00:00+00');
UPDATE public.daily_statement_units_canonical SET status = 'superseded', superseded_by = id, superseded_at = now()
 WHERE id = tr_test.id('u_op_bu_old');
UPDATE public.daily_statement_lines_canonical SET is_active = false WHERE canonical_unit_id = tr_test.id('u_op_bu_old');
SELECT tr_test.put('u_op_bu_new', tr_test.seed_unit('e_op_bus', '2026-10-02', 200, 300));
SELECT tr_test.seed_unit('e_op_bus', '2026-10-05', 300, 310);
UPDATE public.daily_statement_units_canonical SET superseded_by = tr_test.id('u_op_bu_new') WHERE id = tr_test.id('u_op_bu_old');

-- L. Scénario 2 de la R6 : correction obtenue 60 jours après J (journée du 2 août),
-- dans un export de la période passée, sans journée postérieure au premier dépôt de
-- la version erronée. La veille close à 100 ; J retenue ouvrant à 90 ; le 3 ouvre à 200.
SELECT tr_test.seed_registry('op_late', 'ORA', 'XOF', 'TR OP correction tardive');
SELECT tr_test.seed_export('e_op_lt0', 'op_late', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-08-01', '2026-08-01', NULL, 'valid', '2026-08-02 08:00:00+00');
SELECT tr_test.seed_unit('e_op_lt0', '2026-08-01', 0, 100);
SELECT tr_test.seed_export('e_op_lta', 'op_late', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-08-02', '2026-08-02', NULL, 'valid', '2026-08-03 08:00:00+00');
SELECT tr_test.put('u_op_lt_j', tr_test.seed_unit('e_op_lta', '2026-08-02', 90, 190, p_pairs => 2));
SELECT tr_test.seed_export('e_op_lt3', 'op_late', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-08-03', '2026-08-04', NULL, 'valid', '2026-08-05 08:00:00+00');
SELECT tr_test.seed_unit('e_op_lt3', '2026-08-03', 200, 250);
SELECT tr_test.seed_unit('e_op_lt3', '2026-08-04', 250, 260);
-- Export de la période passée déposé le 1er octobre (60 jours après J) : doublon R1 de J
-- aux soldes corrigés, lignes conservées (H1) et conformes.
SELECT tr_test.seed_export('e_op_ltc', 'op_late', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-08-02', '2026-08-02', NULL, 'valid', '2026-10-01 08:00:00+00');
SELECT tr_test.put('s_op_lt_corr', tr_op.clone_delivery(tr_op.staging_of('u_op_lt_j'), 'e_op_ltc', 'duplicate'));
UPDATE public.daily_statement_units_staging SET opening_balance_derived = 100, closing_balance_derived = 200
 WHERE id = tr_test.id('s_op_lt_corr');
INSERT INTO public.daily_statement_lines_staging (staging_unit_id, attempt_id, day_unit_id, daily_line_hash,
  daily_occurrence_ordinal, source_line_index, accounting_date, value_date, description_sanitized, debit_amount,
  credit_amount, signed_amount, running_balance, direction, currency)
SELECT tr_test.id('s_op_lt_corr'), tr_test.id('e_op_ltc'), l.day_unit_id, l.daily_line_hash, l.daily_occurrence_ordinal,
       l.source_line_index, l.accounting_date, l.value_date, l.description_sanitized, l.debit_amount, l.credit_amount,
       l.signed_amount, l.running_balance + 10, l.direction, l.currency
FROM public.daily_statement_lines_canonical l WHERE l.canonical_unit_id = tr_test.id('u_op_lt_j');

-- N. Réserve CTO 4.1 appliquée aux fichiers probants (F1 de la revue) : un fichier
-- qui porte une livraison provisoire incohérente n'est pas digne de preuve ; il ne
-- clôt pas la veille par sa ligne ultérieure.
SELECT tr_test.seed_registry('op_pvinc', 'ORA', 'XOF', 'TR OP fichier incohérent');
SELECT tr_test.seed_export('e_op_pv', 'op_pvinc', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', NULL, 'valid', '2026-10-04 08:00:00+00');
SELECT tr_test.seed_unit('e_op_pv', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_op_pv', '2026-10-02', 200, 300);
SELECT tr_test.put('s_op_pv_3', tr_test.seed_unit('e_op_pv', '2026-10-03', 300, 999, p_staging_status => 'provisional',
  p_canonical => false));
UPDATE public.daily_statement_units_staging SET closing_balance_derived = 400 WHERE id = tr_test.id('s_op_pv_3');
-- Même règle pour une livraison promue dont seuls les faits de staging sont
-- incohérents (unité et lignes intactes) : son fichier ne prouve rien.
SELECT tr_test.seed_registry('op_stgfacts', 'ORA', 'XOF', 'TR OP faits de livraison incohérents');
SELECT tr_test.seed_export('e_op_sf', 'op_stgfacts', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-02', NULL, 'valid', '2026-10-03 08:00:00+00');
SELECT tr_test.seed_unit('e_op_sf', '2026-10-01', 100, 200);
SELECT tr_test.put('u_op_sf_02', tr_test.seed_unit('e_op_sf', '2026-10-02', 200, 300));
UPDATE public.daily_statement_units_staging SET closing_balance_derived = 400 WHERE id = tr_op.staging_of('u_op_sf_02');

-- M. Scénario 3 de la R6 : compte dormant. Contradiction de solde sur la dernière
-- journée mouvementée (le 2 septembre), aucune journée mouvementée ensuite.
SELECT tr_test.seed_registry('op_dormant', 'ORA', 'XOF', 'TR OP compte dormant');
SELECT tr_test.seed_export('e_op_dm0', 'op_dormant', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-09-01', '2026-09-01', NULL, 'valid', '2026-09-02 08:00:00+00');
SELECT tr_test.seed_unit('e_op_dm0', '2026-09-01', 100, 200);
SELECT tr_test.seed_export('e_op_dm1', 'op_dormant', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-09-02', '2026-09-02', NULL, 'valid', '2026-09-03 08:00:00+00');
SELECT tr_test.put('u_op_dm_j', tr_test.seed_unit('e_op_dm1', '2026-09-02', 200, 300));
SELECT tr_test.seed_export('e_op_dm2', 'op_dormant', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-09-02', '2026-09-02', NULL, 'valid', '2026-09-10 08:00:00+00');
SELECT tr_test.put('s_op_dm_w', tr_op.clone_delivery(tr_op.staging_of('u_op_dm_j'), 'e_op_dm2', 'duplicate'));
UPDATE public.daily_statement_units_staging SET opening_balance_derived = 190, closing_balance_derived = 290
 WHERE id = tr_test.id('s_op_dm_w');

-- O. P1 de la contre-revue CTO de la PR #156 : la journée du 02 déclare des faits
-- exacts (200 -> 300, équation respectée) mais ses lignes stockées ne les
-- justifient pas (soldes courants décalés de 1 000 000). Unité et fichier non
-- conformes : aucun solde, aucune preuve de clôture pour la veille.
SELECT tr_test.seed_registry('op_lines', 'ORA', 'XOF', 'TR OP lignes non conformes');
SELECT tr_test.seed_export('e_op_ln', 'op_lines', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', NULL, 'valid', '2026-10-04 08:00:00+00');
SELECT tr_test.put('u_op_ln_01', tr_test.seed_unit('e_op_ln', '2026-10-01', 100, 200));
SELECT tr_test.put('u_op_ln_02', tr_test.seed_unit('e_op_ln', '2026-10-02', 200, 300, p_pairs => 1));
SELECT tr_test.seed_unit('e_op_ln', '2026-10-03', 300, 310);
SELECT tr_op.shift_running('u_op_ln_02', 1000000);
-- Doublon ordinaire sans lignes de la version non conforme, dans un autre fichier :
-- il ne la justifie pas (aucune donnée inventée pour lui).
SELECT tr_test.seed_export('e_op_ln2', 'op_lines', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', NULL, 'valid', '2026-10-05 08:00:00+00');
SELECT tr_test.put('s_op_ln_dup', tr_op.clone_delivery(tr_op.staging_of('u_op_ln_02'), 'e_op_ln2', 'duplicate'));

-- P. Profil décroissant (relevé du plus récent au plus ancien) : lignes stockées
-- dans l'ordre inverse de la chaîne, conformes ; témoin de non-régression.
SELECT tr_test.seed_registry('op_desc', 'ORA', 'XOF', 'TR OP profil décroissant');
SELECT tr_test.seed_export('e_op_ds', 'op_desc', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-02', NULL, 'valid', '2026-10-03 08:00:00+00');
SELECT tr_test.put('u_op_ds_01', tr_test.seed_unit('e_op_ds', '2026-10-01', 100, 200, p_pairs => 2));
SELECT tr_test.put('u_op_ds_02', tr_test.seed_unit('e_op_ds', '2026-10-02', 200, 210));
SELECT tr_op.reverse_storage('u_op_ds_01');

SET session_replication_role = origin;

-- Habilitations et verrous de cette transaction : rôle `admin` Daily v2 pour
-- l'administrateur unique de test, verrou Daily v2 ouvert, comptes attendus.
INSERT INTO public.user_roles (user_id, role) VALUES (tr_test.id('t_admin'), 'admin') ON CONFLICT DO NOTHING;
UPDATE daily_v2_private.runtime_control
   SET mutations_enabled = true, daily_scope_enabled = true, admin_scope_enabled = true,
       change_reason = 'Suite locale du Lot 1 opérationnel : ouverture'
 WHERE singleton = true;
SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('op-add-' || n), tr_test.id(n), NULL, NULL, NULL,
  'Compte attendu synthétique ' || n)
FROM unnest(ARRAY['op_same', 'op_breakdown', 'op_insuff', 'op_reject', 'op_incoh', 'op_attest', 'op_pending',
                  'op_ref', 'op_vs', 'op_rejopen', 'op_auto', 'op_auto2', 'op_late', 'op_dormant', 'op_pvinc',
                  'op_lines', 'op_desc', 'op_stgfacts']) n;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- --------------------------------------------------------------------------
-- Comparaison à trois issues (C4 bis)
-- --------------------------------------------------------------------------
SELECT tr_test.check('2026-10-02', 'op_same', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'OP accord établi, livraison en attente : disputée');
SELECT tr_test.check('2026-10-02', 'op_breakdown', 'AVAILABLE', '300.00', '', 'OP ventilation différente non bloquante');
SELECT tr_test.assert((tr_op.finding('2026-10-02', 'op_breakdown', 'VERSION_BREAKDOWN_DIVERGENCE') ->> 'movements_unresolved')::boolean,
  'OP ventilation rendue, mouvements non résolus');
SELECT tr_test.check('2026-10-02', 'op_insuff', 'NOT_COVERED', NULL, 'DAY_CONTESTED,VERSION_BALANCE_NOT_COMPARABLE',
  'OP agrégats indisponibles au même net : incertitude, non divergence de détail');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-02', 'op_insuff', 'VERSION_BALANCE_NOT_COMPARABLE') ->> 'cause',
  'AGGREGATES_UNAVAILABLE', 'OP cause de l''incertitude');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-02', 'op_insuff', 'VERSION_BALANCE_NOT_COMPARABLE') ->> 'side',
  'OTHER', 'OP côté concerné : la livraison non retenue');
SELECT tr_test.assert(public.daily_stmt_version_compare('h1', 'unavailable', NULL, NULL, 10, 20, 'h2', 'unavailable', NULL, NULL, 0, 10)
  = 'INSUFFICIENT_UNAVAILABLE', 'OP deux agrégats indisponibles, même net : données insuffisantes');
SELECT tr_test.assert(public.daily_stmt_version_compare('h1', 'unavailable', NULL, NULL, 10, 30, 'h2', 'derived', 0, 10, 0, 10)
  = 'CONTRADICTION', 'OP nets différents : contradiction');
SELECT tr_test.assert(public.daily_stmt_version_compare('h1', 'derived', 0, 10, 0, 10, 'h1', 'derived', 0, 10, 5, 15)
  = 'INSUFFICIENT_INCOHERENT', 'OP mêmes mouvements, totaux différents : incohérentes entre elles');
SELECT tr_test.assert(public.daily_stmt_version_compare('h1', 'derived', 100, 120, 0, 10, 'h2', 'derived', 100, 110, 0, 10)
  = 'INSUFFICIENT_INCOHERENT', 'OP clôture différente de l''ouverture plus le net : incohérente');

SELECT tr_test.check('2026-10-01', 'op_insuff', 'AVAILABLE', '200.00', '', 'OP ouverture absente jamais remplacée par zéro');

-- Ouvertures connues : une livraison écartée garde son ouverture.
SELECT tr_test.check('2026-10-01', 'op_rejopen', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'OP ouverture écartée contradictoire');

-- Réfutation automatique à la lecture (point F) : adoption fraîche ou non.
SELECT tr_test.check('2026-10-02', 'op_auto', 'AVAILABLE', '300.00', '', 'OP adoption fraîche : version remplacée réfutée');
SELECT tr_test.check('2026-10-01', 'op_auto', 'AVAILABLE', '200.00', '', 'OP adoption fraîche : ouverture remplacée sortie');
SELECT tr_test.assert((tr_op.finding('2026-10-02', 'op_auto', 'REFUTED_VERSION') ->> 'automatic')::boolean,
  'OP réfutation automatique rendue');
SELECT tr_test.check('2026-10-02', 'op_auto2', 'BLOCKED', NULL, 'DAY_CONFLICT', 'OP adoption non fraîche : contradiction maintenue');
SELECT tr_test.check('2026-10-01', 'op_auto2', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'OP adoption non fraîche : la veille reste non close');

-- Écartement et absence de mouvement (arbitrage 11).
SELECT tr_test.check('2026-10-02', 'op_reject', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'OP livraison écartée avec lignes : jamais sans mouvement');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-02', 'op_reject', 'REJECTED_DELIVERY') ->> 'count', '1', 'OP écartement visible');

-- Réserve CTO 4.1 : aucune unité incohérente ne fournit de solde, même seule.
SELECT tr_test.check('2026-10-01', 'op_incoh', 'NOT_COVERED', NULL, 'UNIT_FINANCIAL_FACTS_INCOHERENT', 'OP 100 + 10 = 120 refusé');
SELECT tr_test.check('2026-10-02', 'op_incoh', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN,DAY_NOT_CLOSED', 'OP après une unité incohérente');

-- A6 : journées seulement en attente.
SELECT tr_test.check('2026-10-02', 'op_pending', 'NOT_COVERED', NULL, 'DAY_PENDING_VALIDATION,FORMAT_NOT_QUALIFIED',
  'OP journée en attente de validation');
SELECT tr_test.check('2026-10-01', 'op_pending', 'NOT_COVERED', NULL, 'NO_STATEMENT', 'OP avant la première livraison');

-- --------------------------------------------------------------------------
-- Attestation d'identité (C2), par la commande réelle
-- --------------------------------------------------------------------------
SELECT tr_test.check('2026-10-02', 'op_attest', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN,UNIT_NEEDS_REVIEW', 'OP Excel sans attestation');
SELECT tr_test.as_user('t_admin');
SELECT tr_test.put('att_op', (public.attest_daily_statement_attempt(tr_test.key('op-attest'), tr_test.id('e_op_at'),
  'ACCOUNT_IDENTITY', (SELECT raw_text_hash FROM public.daily_statement_export_attempts WHERE id = tr_test.id('e_op_at')),
  tr_test.id('op_attest'), 'XOF', 'Piece de rattachement synthetique', 'Rattachement synthetique de test')
  ->> 'attestation_id')::uuid);
SELECT tr_test.expect_error(format('SELECT public.attest_daily_statement_attempt(%L, %L::uuid, %L, %L, %L::uuid, %L, %L, %L)',
  tr_test.key('op-attest-2'), tr_test.id('e_op_at'), 'ACCOUNT_IDENTITY',
  (SELECT raw_text_hash FROM public.daily_statement_export_attempts WHERE id = tr_test.id('e_op_at')),
  tr_test.id('op_attest'), 'XOF', 'Seconde piece', 'Seconde attestation refusee'), 'DAILY_STMT_ALREADY_ATTESTED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-02', 'op_attest', 'AVAILABLE', '300.00', '', 'OP Excel attesté');
SELECT tr_test.as_user('t_admin');
SELECT public.revoke_daily_statement_attempt_attestation(tr_test.key('op-revoke'), tr_test.id('att_op'), 'Revocation synthetique');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-02', 'op_attest', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN,UNIT_NEEDS_REVIEW', 'OP attestation révoquée');

-- --------------------------------------------------------------------------
-- F1 -> C -> F2 -> redépôt de F2, par les commandes réelles
-- --------------------------------------------------------------------------
INSERT INTO tr_op.ctx VALUES
  ('vr', to_jsonb(tr_op.vkey_staging(tr_op.staging_of('u_op_ref_10')))),
  ('v', to_jsonb(tr_op.vkey_staging(tr_test.id('s_op_f1')))),
  ('src1', tr_op.sources(tr_test.id('s_op_f1')));
SELECT tr_test.check('2026-10-10', 'op_ref', 'BLOCKED', NULL, 'DAY_CONFLICT', 'OP F1 : J en conflit');
SELECT tr_test.check('2026-10-09', 'op_ref', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'OP F1 : la veille contredite');

-- Une livraison fraîche dont les lignes stockées ne justifient pas ses faits ne
-- prouve rien (P1) : refus, état annulé.
SAVEPOINT op_proof_lines;
SET session_replication_role = replica;
UPDATE public.daily_statement_lines_staging SET running_balance = running_balance + 1
 WHERE staging_unit_id = tr_op.staging_of('u_op_ref_10');
SET session_replication_role = origin;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-c-badlines'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src1'),
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', tr_op.staging_of('u_op_ref_10')), 'Preuve non conforme'),
  'fresh delivery file carries stored lines that do not match their declared balances');
RESET ROLE;
ROLLBACK TO SAVEPOINT op_proof_lines;
-- Autre journée du même fichier aux lignes non conformes : le fichier ne prouve
-- rien (la lecture ne le tiendrait pas pour digne de preuve).
SET session_replication_role = replica;
UPDATE public.daily_statement_lines_canonical SET running_balance = running_balance + 1
 WHERE canonical_unit_id = (SELECT u.id FROM public.daily_statement_units_canonical u
                             WHERE u.account_registry_id = tr_test.id('op_ref') AND u.accounting_date = '2026-10-09');
SET session_replication_role = origin;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-c-badfile'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src1'),
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', tr_op.staging_of('u_op_ref_10')), 'Fichier non conforme'),
  'fresh delivery file carries stored lines that do not match their declared balances');
RESET ROLE;
ROLLBACK TO SAVEPOINT op_proof_lines;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Réfutation par la livraison fraîche C (journée livrée du 13 > premier dépôt de F1, le 11).
SELECT tr_test.as_user('t_admin');
SELECT tr_test.put('ref_c', (public.refute_daily_statement_version(tr_test.key('op-refute-c'),
  (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src1'),
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', tr_op.staging_of('u_op_ref_10')),
  'Releve correctif posterieur') ->> 'refutation_id')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-10', 'op_ref', 'AVAILABLE', '300.00', '', 'OP C : J couverte');
SELECT tr_test.check('2026-10-09', 'op_ref', 'AVAILABLE', '200.00', '', 'OP C : la veille couverte');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-10', 'op_ref', 'REFUTED_VERSION') ->> 'nature', 'FRESH_DELIVERY',
  'OP C : nature de la preuve');
SELECT tr_test.assert_eq(tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_c')) ->> 'state', 'EFFECTIVE',
  'OP C : réfutation enregistrée et effective');

-- F2 : autre empreinte portant V, première apparition le 20 : la journée se rouvre.
SET session_replication_role = replica;
SELECT tr_test.seed_export('e_op_f2', 'op_ref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-10', '2026-10-10', NULL, 'valid', '2026-10-20 08:00:00+00');
SELECT tr_test.put('s_op_f2', tr_op.clone_delivery(tr_test.id('s_op_f1'), 'e_op_f2', 'conflict'));
SET session_replication_role = origin;
INSERT INTO tr_op.ctx VALUES ('src2', tr_op.sources(tr_test.id('s_op_f1')));
SELECT tr_test.check('2026-10-10', 'op_ref', 'BLOCKED', NULL, 'DAY_CONFLICT', 'OP F2 : nouvelle source non couverte');
SELECT tr_test.check('2026-10-09', 'op_ref', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'OP F2 : la veille de nouveau contredite');
-- P2 : la décision reste enregistrée mais ne couvre plus toute la version ; une
-- nouvelle preuve est nécessaire pour la source F2.
SELECT tr_test.assert_eq(tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_c'))::text,
  jsonb_build_object('kind', 'REFUTATION_STATUS', 'day', '2026-10-10', 'refutation_id', tr_test.id('ref_c'),
    'proof_kind', 'FRESH_DELIVERY', 'state', 'PARTIAL', 'causes', jsonb_build_array('NEW_SOURCE_UNCOVERED'),
    'uncovered_sources', 1)::text, 'OP F2 : réfutation partielle, nouvelle source non couverte');
-- Justificatif invalidé : le fichier de la livraison fraîche cesse d'être digne de
-- preuve (journée en attente ajoutée) ; la réfutation est suspendue.
SAVEPOINT op_proof_invalid;
SET session_replication_role = replica;
SELECT tr_test.seed_unit('e_op_c', '2026-10-12', 300, 300, p_staging_status => 'staged', p_canonical => false);
SET session_replication_role = origin;
SELECT tr_test.assert((tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_c')) ->> 'state') = 'SUSPENDED'
  AND tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_c')) -> 'causes' ? 'PROOF_NO_LONGER_VALID',
  'OP justificatif invalidé : réfutation suspendue');
ROLLBACK TO SAVEPOINT op_proof_invalid;

-- C ne justifie pas F2 (13 <= 20) ; une pièce du jour même non plus ; une pièce
-- sans attestation d'archivage ou aux valeurs différentes est refusée.
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-c2'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src2'),
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', tr_op.staging_of('u_op_ref_10')), 'Meme preuve'),
  'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-same-day'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src2'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('a', 64), 'piece_reference', 'Lettre corrective A',
    'archive_reference', 'Archive tresorerie dossier A', 'issued_on', '2026-10-20', 'archive_attested', true,
    'opening', '200', 'closing', '300'), 'Piece du jour meme'),
  'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-noarchive'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src2'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('b', 64), 'piece_reference', 'Lettre corrective B',
    'archive_reference', 'Archive tresorerie dossier B', 'issued_on', '2026-10-24', 'archive_attested', false,
    'opening', '200', 'closing', '300'), 'Piece non archivee'),
  'DAILY_STMT_PIECE_ARCHIVE_ATTESTATION_REQUIRED');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-refute-mismatch'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src2'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('c', 64), 'piece_reference', 'Lettre corrective C',
    'archive_reference', 'Archive tresorerie dossier C', 'issued_on', '2026-10-24', 'archive_attested', true,
    'opening', '201', 'closing', '300'), 'Valeur differente d un franc'),
  'DAILY_STMT_PIECE_VALUES_MISMATCH');
-- Pièce émise le 24, archivée, valeurs égales à la version retenue : F1 et F2 justifiées.
SELECT tr_test.put('ref_piece', (public.refute_daily_statement_version(tr_test.key('op-refute-piece'),
  (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'src2'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('d', 64), 'piece_reference', 'Lettre corrective D',
    'archive_reference', 'Archive tresorerie dossier D', 'issued_on', '2026-10-24', 'archive_attested', true,
    'opening', '200', 'closing', '300'), 'Piece corrective archivee') ->> 'refutation_id')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-10', 'op_ref', 'AVAILABLE', '300.00', '', 'OP pièce : J couverte');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-10', 'op_ref', 'REFUTED_VERSION') ->> 'mention',
  'attestation sur pièce archivée, contenu non vérifié automatiquement', 'OP pièce : mention déclarative');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-10', 'op_ref', 'REFUTED_VERSION') ->> 'sources', '2', 'OP pièce : deux sources');
SELECT tr_test.assert_eq(tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_piece')) ->> 'state', 'EFFECTIVE',
  'OP pièce : réfutation effective');
SELECT tr_test.assert(tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_c')) IS NULL,
  'OP pièce : la réfutation remplacée n''est plus une décision active');

-- Redépôt identique de F2 le 30 : même source, première apparition inchangée.
SET session_replication_role = replica;
SELECT tr_test.seed_export('e_op_f2b', 'op_ref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-10', '2026-10-10', NULL, 'valid', '2026-10-30 08:00:00+00');
UPDATE public.daily_statement_export_attempts
   SET raw_text_hash = (SELECT raw_text_hash FROM public.daily_statement_export_attempts WHERE id = tr_test.id('e_op_f2'))
 WHERE id = tr_test.id('e_op_f2b');
SELECT tr_op.clone_delivery(tr_test.id('s_op_f1'), 'e_op_f2b', 'conflict');
SET session_replication_role = origin;
SELECT tr_test.check('2026-10-10', 'op_ref', 'AVAILABLE', '300.00', '', 'OP redépôt identique de F2 : toujours couverte');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-10', 'op_ref', 'REFUTED_VERSION') ->> 'covered_redeposits', '1',
  'OP redépôt couvert compté');

-- --------------------------------------------------------------------------
-- Points de départ vérifiés (C5), par les commandes réelles
-- --------------------------------------------------------------------------
SELECT tr_test.check('2026-10-03', 'op_vs', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'OP sans point : incertitude après le 02');
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.treasury_admin_set_verified_start_v1(%L, %L::uuid, %L::date, %L::uuid, %L, %L, %L, %L)',
  tr_test.key('op-vs-bad'), tr_test.id('op_vs'), '2026-10-03', tr_test.id('u_op_vs_03'),
  (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_vs_03')),
  '251', 'Releve de solde synthetique', 'Point de depart synthetique'), 'TREASURY_OPENING_MISMATCH');
SELECT tr_test.expect_error(format('SELECT public.treasury_admin_set_verified_start_v1(%L, %L::uuid, %L::date, %L::uuid, %L, %L, %L, %L)',
  tr_test.key('op-vs-contradicted'), tr_test.id('op_vs'), '2026-10-04',
  (SELECT id FROM public.daily_statement_units_canonical WHERE account_registry_id = tr_test.id('op_vs')
     AND accounting_date = '2026-10-04' AND status = 'ingested'),
  (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE account_registry_id = tr_test.id('op_vs')
     AND accounting_date = '2026-10-04' AND status = 'ingested'),
  '300', 'Releve de solde synthetique', 'Point sur une journee contredite'), 'TREASURY_VERIFIED_START_NOT_EFFECTIVE');
SELECT tr_test.put('vs_op', (public.treasury_admin_set_verified_start_v1(tr_test.key('op-vs'), tr_test.id('op_vs'), '2026-10-03',
  tr_test.id('u_op_vs_03'), (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_vs_03')),
  '250', 'Releve de solde synthetique', 'Point de depart synthetique') ->> 'verified_start_id')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-03', 'op_vs', 'AVAILABLE', '300.00', '', 'OP point du 03 : la chaîne repart');
SELECT tr_test.check('2026-10-02', 'op_vs', 'NOT_COVERED', NULL, 'DAY_PENDING_VALIDATION', 'OP date antérieure au point inchangée');
SELECT tr_test.check('2026-10-01', 'op_vs', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'OP avant le point inchangée');
-- Contradiction datée du 04 (clôture 310 contredite par l'ouverture 400 du 06 à travers
-- le 05 prouvé sans mouvement) : le point est suspendu pour les dates d'horizon >= 04,
-- jamais pour le 03.
SELECT tr_test.check('2026-10-04', 'op_vs', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE,CHAIN_UNPROVEN,VERIFIED_START_SUSPENDED',
  'OP point suspendu par une contradiction à l''horizon');
SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_revoke_verified_start_v1(tr_test.key('op-vs-revoke'), tr_test.id('vs_op'), 'Revocation synthetique du point');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-10-03', 'op_vs', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'OP point révoqué');

-- --------------------------------------------------------------------------
-- Scénario 2 de la R6 : correction des seuls soldes 60 jours après J, puis pièce
-- --------------------------------------------------------------------------
SELECT tr_test.check('2026-08-02', 'op_late', 'BLOCKED', NULL, 'CHAIN_UNPROVEN,DAY_CONFLICT',
  'OP 60 jours : J retenue erronée, doublon corrigé contradictoire');
INSERT INTO tr_op.ctx VALUES
  ('lt_v', to_jsonb(tr_op.vkey_staging(tr_op.staging_of('u_op_lt_j')))),
  ('lt_src', tr_op.sources(tr_op.staging_of('u_op_lt_j'))),
  ('lt_corr_v', to_jsonb(tr_op.vkey_staging(tr_test.id('s_op_lt_corr')))),
  ('lt_lines_before', to_jsonb((SELECT array_agg(daily_line_hash ORDER BY daily_line_hash)
     FROM public.daily_statement_lines_canonical WHERE canonical_unit_id = tr_test.id('u_op_lt_j'))));
SELECT tr_test.as_user('t_admin');
SELECT public.supersede_daily_statement_unit_balances(tr_test.key('op-late-balances'), tr_test.id('u_op_lt_j'),
  tr_test.id('s_op_lt_corr'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'lt_corr_v'), 'Correction des soldes 60 jours apres');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- Pas de réfutation automatique : l'export correctif ne porte aucune journée
-- postérieure au premier dépôt de la version erronée (le 3 août).
SELECT tr_test.check('2026-08-02', 'op_late', 'BLOCKED', NULL, 'DAY_CONFLICT', 'OP 60 jours : version erronée non réfutée');
SELECT tr_test.assert_eq((SELECT array_agg(l.daily_line_hash ORDER BY l.daily_line_hash)::text
    FROM public.daily_statement_lines_canonical l JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
   WHERE u.account_registry_id = tr_test.id('op_late') AND u.accounting_date = '2026-08-02' AND u.status = 'ingested'
     AND l.is_active),
  (SELECT array_agg(x ORDER BY x)::text FROM jsonb_array_elements_text((SELECT v FROM tr_op.ctx WHERE k = 'lt_lines_before')) x),
  'OP 60 jours : aucun mouvement créé, mêmes lignes');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_lines_canonical
   WHERE canonical_unit_id = tr_test.id('u_op_lt_j') AND NOT is_active) > 0, 'OP 60 jours : lignes erronées conservées en historique');
-- Pièce émise après le premier dépôt de la version erronée, valeurs égales à la version retenue.
INSERT INTO tr_op.ctx VALUES ('lt_vr', to_jsonb((SELECT public.daily_stmt_version_key(u.active_day_content_hash,
  u.aggregates_status, u.opening_balance_derived, u.closing_balance_derived, u.day_total_debits, u.day_total_credits)
  FROM public.daily_statement_units_canonical u
  WHERE u.account_registry_id = tr_test.id('op_late') AND u.accounting_date = '2026-08-02' AND u.status = 'ingested')));
SELECT tr_test.as_user('t_admin');
SELECT public.refute_daily_statement_version(tr_test.key('op-late-piece'),
  (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_lt_j')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'lt_v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'lt_vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'lt_src'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('e', 64), 'piece_reference', 'Releve correctif E',
    'archive_reference', 'Archive tresorerie dossier E', 'issued_on', '2026-10-05', 'archive_attested', true,
    'opening', '100', 'closing', '200'), 'Piece corrective archivee apres 60 jours');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-08-02', 'op_late', 'AVAILABLE', '200.00', '', 'OP 60 jours : J couverte après la pièce');
SELECT tr_test.check('2026-08-01', 'op_late', 'AVAILABLE', '100.00', '', 'OP 60 jours : la veille couverte');

-- --------------------------------------------------------------------------
-- Réserve CTO 4.1 : fichier probant (F1 de la revue)
-- --------------------------------------------------------------------------
SELECT tr_test.assert(NOT public.daily_stmt_version_coherent('derived', 300, 400, 0, 699), 'OP 4.1 : livraison provisoire incohérente');
SELECT tr_test.check('2026-10-02', 'op_pvinc', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED',
  'OP 4.1 : un fichier portant une livraison incohérente ne clôt pas la journée');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tr_test.account(tr_test.read_as('t_reader', '2026-10-02'),
  'op_pvinc') -> 'sources') s WHERE s ->> 'kind' = 'CLOSURE_LATER_LINE'), 'OP 4.1 : aucune preuve de clôture par ce fichier');
SELECT tr_test.check('2026-10-01', 'op_stgfacts', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED',
  'OP 4.1 : faits de livraison incohérents, le fichier ne clôt pas la veille');

-- --------------------------------------------------------------------------
-- Scénario 3 de la R6 : compte dormant
-- --------------------------------------------------------------------------
SELECT tr_test.check('2026-09-02', 'op_dormant', 'BLOCKED', NULL, 'DAY_CONFLICT', 'OP dormant : dernière journée en conflit');
SELECT tr_test.check('2026-09-01', 'op_dormant', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED',
  'OP dormant : la veille non close tant que le lendemain est en conflit');
INSERT INTO tr_op.ctx VALUES
  ('dm_v', to_jsonb(tr_op.vkey_staging(tr_test.id('s_op_dm_w')))),
  ('dm_vr', to_jsonb(tr_op.vkey_staging(tr_op.staging_of('u_op_dm_j')))),
  ('dm_src', tr_op.sources(tr_test.id('s_op_dm_w')));
SELECT tr_test.as_user('t_admin');
-- Aucune livraison fraîche possible : la seule livraison retenue précède la source.
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  tr_test.key('op-dormant-fresh'), (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_dm_j')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'dm_v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'dm_vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'dm_src'),
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', tr_op.staging_of('u_op_dm_j')), 'Livraison non fraiche'),
  'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED');
SELECT public.refute_daily_statement_version(tr_test.key('op-dormant-piece'),
  (SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_dm_j')),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'dm_v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'dm_vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'dm_src'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('f', 64), 'piece_reference', 'Attestation de solde F',
    'archive_reference', 'Archive tresorerie dossier F', 'issued_on', '2026-09-15', 'archive_attested', true,
    'opening', '200', 'closing', '300'), 'Piece corrective compte dormant');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.check('2026-09-01', 'op_dormant', 'AVAILABLE', '200.00', '', 'OP dormant : la veille couverte après la pièce');
-- Règles normales ensuite : la dernière journée n'est pas close, aucune journée sans
-- mouvement n'est inventée après elle.
SELECT tr_test.check('2026-09-02', 'op_dormant', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'OP dormant : dernière journée non close');
SELECT tr_test.assert((tr_test.account(tr_test.read_as('t_reader', '2026-09-20'), 'op_dormant') ->> 'status') = 'NOT_COVERED'
  AND (tr_test.account(tr_test.read_as('t_reader', '2026-09-20'), 'op_dormant') ->> 'balance_at_date') IS NULL,
  'OP dormant : aucune journée sans mouvement inventée');

-- --------------------------------------------------------------------------
-- P1 de la contre-revue CTO : lignes stockées et faits déclarés
-- --------------------------------------------------------------------------
SELECT tr_test.assert(public.daily_stmt_version_coherent('derived', 200, 300, 1, 101)
  AND NOT public.daily_stmt_canonical_lines_conform(tr_test.id('u_op_ln_02')),
  'OP lignes : équation respectée, lignes non conformes');
SELECT tr_test.check('2026-10-02', 'op_lines', 'NOT_COVERED', NULL, 'UNIT_FINANCIAL_FACTS_INCOHERENT',
  'OP lignes : aucune unité non conforme ne fournit de solde');
SELECT tr_test.assert_eq(tr_op.finding('2026-10-02', 'op_lines', 'LINES_NOT_CONFORMING')::text,
  '{"day": "2026-10-02", "kind": "LINES_NOT_CONFORMING", "deliveries": 1, "retained_unit": true}',
  'OP lignes : unité retenue signalée, le doublon sans lignes n''est pas dit non conforme');
-- Fichier non conforme : il ne clôt pas la veille par sa ligne ultérieure.
SELECT tr_test.check('2026-10-01', 'op_lines', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED',
  'OP lignes : un fichier non conforme ne prouve pas la clôture');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tr_test.account(tr_test.read_as('t_reader', '2026-10-01'),
  'op_lines') -> 'sources') s WHERE s ->> 'kind' = 'CLOSURE_LATER_LINE'), 'OP lignes : aucune preuve de clôture par ce fichier');
-- Profil décroissant : ordre de stockage inverse de la chaîne, conforme.
SELECT tr_test.assert(public.daily_stmt_canonical_lines_conform(tr_test.id('u_op_ds_01'))
  AND public.daily_stmt_staging_lines_conform(tr_op.staging_of('u_op_ds_01')), 'OP décroissant : lignes conformes');
SELECT tr_test.check('2026-10-01', 'op_desc', 'AVAILABLE', '200.00', '', 'OP décroissant : solde disponible');
-- Variantes, chacune annulée : nombre de lignes, totaux à net égal, chaîne interne.
SAVEPOINT op_lines_variant;
SET session_replication_role = replica;
UPDATE public.daily_statement_units_canonical SET line_count = line_count + 1 WHERE id = tr_test.id('u_op_ds_01');
SET session_replication_role = origin;
SELECT tr_test.assert(NOT public.daily_stmt_canonical_lines_conform(tr_test.id('u_op_ds_01')), 'OP variante : nombre de lignes');
SELECT tr_test.assert((tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'op_desc') ->> 'balance_at_date') IS NULL,
  'OP variante : nombre de lignes, aucun solde');
ROLLBACK TO SAVEPOINT op_lines_variant;
SET session_replication_role = replica;
UPDATE public.daily_statement_units_canonical SET day_total_debits = day_total_debits + 5,
       day_total_credits = day_total_credits + 5 WHERE id = tr_test.id('u_op_ds_01');
SET session_replication_role = origin;
SELECT tr_test.assert(NOT public.daily_stmt_canonical_lines_conform(tr_test.id('u_op_ds_01')), 'OP variante : totaux à net égal');
ROLLBACK TO SAVEPOINT op_lines_variant;
SET session_replication_role = replica;
UPDATE public.daily_statement_lines_canonical SET running_balance = running_balance + 1
 WHERE canonical_unit_id = tr_test.id('u_op_ds_01') AND source_line_index = 2;
SET session_replication_role = origin;
SELECT tr_test.assert(NOT public.daily_stmt_canonical_lines_conform(tr_test.id('u_op_ds_01')), 'OP variante : chaîne interne');
ROLLBACK TO SAVEPOINT op_lines_variant;

-- --------------------------------------------------------------------------
-- P2 : effectivité d'une réfutation après changement de la version retenue
-- (cas reproduit par le CTO), lue par le serveur seul
-- --------------------------------------------------------------------------
SET session_replication_role = replica;
SELECT tr_test.seed_export('e_op_rc', 'op_ref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-10', '2026-10-10', NULL, 'valid', '2026-10-31 08:00:00+00');
SELECT tr_test.put('s_op_rc', tr_op.clone_delivery(tr_op.staging_of('u_op_ref_10'), 'e_op_rc', 'duplicate'));
UPDATE public.daily_statement_units_staging SET opening_balance_derived = 210, closing_balance_derived = 310
 WHERE id = tr_test.id('s_op_rc');
INSERT INTO public.daily_statement_lines_staging (staging_unit_id, attempt_id, day_unit_id, daily_line_hash,
  daily_occurrence_ordinal, source_line_index, accounting_date, value_date, description_sanitized, debit_amount,
  credit_amount, signed_amount, running_balance, direction, currency)
SELECT tr_test.id('s_op_rc'), tr_test.id('e_op_rc'), l.day_unit_id, l.daily_line_hash, l.daily_occurrence_ordinal,
       l.source_line_index, l.accounting_date, l.value_date, l.description_sanitized, l.debit_amount, l.credit_amount,
       l.signed_amount, l.running_balance + 10, l.direction, l.currency
FROM public.daily_statement_lines_canonical l WHERE l.canonical_unit_id = tr_test.id('u_op_ref_10');
SET session_replication_role = origin;
INSERT INTO tr_op.ctx VALUES
  ('rc_v', to_jsonb(tr_op.vkey_staging(tr_test.id('s_op_rc')))),
  ('ref_day', to_jsonb((SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_ref_10'))));
CREATE TABLE tr_op.rs (k text PRIMARY KEY, v jsonb);
GRANT SELECT, INSERT ON tr_op.rs TO authenticated;
SELECT tr_test.as_user('t_admin');
INSERT INTO tr_op.rs VALUES ('before', public.daily_v2_refutation_status_v1((SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'ref_day')));
SELECT public.supersede_daily_statement_unit_balances(tr_test.key('op-ref-balances'), tr_test.id('u_op_ref_10'),
  tr_test.id('s_op_rc'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'rc_v'), 'Correction des soldes apres refutation');
INSERT INTO tr_op.rs VALUES ('after', public.daily_v2_refutation_status_v1((SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'ref_day')));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- Avant : décision effective. Après : la décision enregistrée subsiste, son
-- effectivité ne l'est plus (version retenue changée) ; jamais affichée acquise.
SELECT tr_test.assert_eq((SELECT v FROM tr_op.rs WHERE k = 'before') -> 'refutations' -> 0 ->> 'state', 'EFFECTIVE',
  'OP P2 : lecture serveur avant changement');
SELECT tr_test.assert(((SELECT v FROM tr_op.rs WHERE k = 'after') ->> 'verifiable')::boolean
  AND (SELECT v FROM tr_op.rs WHERE k = 'after') -> 'refutations' -> 0 ->> 'state' = 'SUSPENDED'
  AND (SELECT v FROM tr_op.rs WHERE k = 'after') -> 'refutations' -> 0 -> 'causes' ? 'RETAINED_VERSION_CHANGED'
  AND (SELECT v FROM tr_op.rs WHERE k = 'after') -> 'refutations' -> 0 ->> 'refutation_id' = tr_test.id('ref_piece')::text,
  'OP P2 : réfutation suspendue après changement de la version retenue');
SELECT tr_test.assert_eq(tr_op.ref_status('2026-10-10', 'op_ref', tr_test.id('ref_piece')) ->> 'state', 'SUSPENDED',
  'OP P2 : même statut dans « Soldes à date »');
-- Accès et cas non vérifiables : rôle admin requis, journée inconnue, module fermé.
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error(format('SELECT public.daily_v2_refutation_status_v1(%L)',
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'ref_day')), 'DAILY_STMT_ROLE_DENIED');
RESET ROLE;
SELECT tr_test.as_user('t_admin');
SELECT tr_test.assert_eq(public.daily_v2_refutation_status_v1('tr-test:journee-inconnue') ->> 'cause', 'DAY_UNKNOWN',
  'OP P2 : journée inconnue non vérifiable');
RESET ROLE;
SELECT treasury_private.set_module_open(false, 'tr-test:fermeture-46', 'Fermeture synthétique de controle', 'operateur-test');
SELECT tr_test.as_user('t_admin');
SELECT tr_test.assert(NOT (public.daily_v2_refutation_status_v1((SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'ref_day')) ->> 'verifiable')::boolean
  AND public.daily_v2_refutation_status_v1((SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'ref_day')) ->> 'cause' = 'TREASURY_MODULE_CLOSED',
  'OP P2 : module fermé, effectivité non vérifiable');
RESET ROLE;
SELECT treasury_private.set_module_open(true, 'tr-test:reouverture-46', 'Reouverture synthetique de controle', 'operateur-test');
SELECT set_config('request.jwt.claim.sub', '', false);

-- Réfutation explicite d'une version déjà couverte par l'adoption (scénario K) :
-- une nouvelle source couverte par l'adoption ne la rend pas partielle.
INSERT INTO tr_op.ctx VALUES
  ('au_v', to_jsonb(tr_op.vkey_staging(tr_op.staging_of('u_op_au_old')))),
  ('au_vr', to_jsonb(tr_op.vkey_staging(tr_op.staging_of('u_op_au_new')))),
  ('au_src', tr_op.sources(tr_op.staging_of('u_op_au_old'))),
  ('au_day', to_jsonb((SELECT day_unit_id FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_op_au_new'))));
SELECT tr_test.as_user('t_admin');
SELECT tr_test.put('ref_au', (public.refute_daily_statement_version(tr_test.key('op-auto-piece'),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'au_day'),
  (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'au_v'), (SELECT v #>> '{}' FROM tr_op.ctx WHERE k = 'au_vr'),
  (SELECT v FROM tr_op.ctx WHERE k = 'au_src'),
  jsonb_build_object('kind', 'BANK_PIECE', 'piece_sha256', repeat('7', 64), 'piece_reference', 'Releve correctif G',
    'archive_reference', 'Archive tresorerie dossier G', 'issued_on', '2026-10-09', 'archive_attested', true,
    'opening', '200', 'closing', '300'), 'Piece corrective deja adoptee') ->> 'refutation_id')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
SELECT tr_test.seed_export('e_op_au2', 'op_auto', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-02', NULL, 'valid', '2026-10-04 08:00:00+00');
SELECT tr_op.clone_delivery(tr_op.staging_of('u_op_au_old'), 'e_op_au2', 'duplicate');
SET session_replication_role = origin;
SELECT tr_test.assert_eq(tr_op.ref_status('2026-10-02', 'op_auto', tr_test.id('ref_au')) ->> 'state', 'EFFECTIVE',
  'OP P2 : source couverte par l''adoption, réfutation non partielle');

SELECT 'PASS 46_operational' AS marker;
