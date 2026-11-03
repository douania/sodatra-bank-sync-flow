-- C7 (R6) : historiques synthétiques aléatoires, graine fixe et rejouable, pour
-- le test différentiel. Douze comptes, quarante journées chacun ; chaque
-- journée tire une nature : absence, unité cohérente, rupture, attente,
-- provisoire, doublon de même version, doublon contradictoire (réfuté une fois
-- sur deux, par livraison fraîche ou par pièce, plusieurs sources), ventilation
-- différente, données insuffisantes, livraison écartée, unité incohérente,
-- remplacement passé ; attestations et points de départ (effectifs, révoqués).
-- Écriture directe en base jetable (mode réplica), dans une transaction annulée.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
SELECT setseed(0.20261103);
INSERT INTO public.user_roles (user_id, role) VALUES (tr_test.id('t_admin'), 'admin') ON CONFLICT DO NOTHING;

CREATE FUNCTION tr_test.rnd_clone(p_staging uuid, p_attempt uuid, p_status text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid(); s public.daily_statement_units_staging%ROWTYPE;
        a public.daily_statement_export_attempts%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.daily_statement_units_staging WHERE id = p_staging;
  SELECT * INTO a FROM public.daily_statement_export_attempts WHERE id = p_attempt;
  INSERT INTO public.daily_statement_units_staging (
    id, attempt_id, day_unit_id, bank, account_fingerprint, currency, accounting_date, day_content_hash, line_count,
    day_total_debits, day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status,
    validation_status, status, created_by, account_registry_id, review_reason_codes)
  VALUES (v, a.id, s.day_unit_id, s.bank, s.account_fingerprint, s.currency, s.accounting_date, s.day_content_hash,
    s.line_count, s.day_total_debits, s.day_total_credits, s.opening_balance_derived, s.closing_balance_derived,
    s.aggregates_status, s.validation_status, p_status, tr_test.id('t_admin'), a.account_registry_id, s.review_reason_codes);
  RETURN v;
END $$;

DO $$
DECLARE
  k       integer;
  v_day   integer;
  d       date;
  r       double precision;
  v_bank  text;
  v_fmt   text;
  v_par   text;
  v_acc   text;
  v_exp   text;
  v_open  numeric;
  v_close numeric;
  v_can   uuid;
  v_stg   uuid;
  v_dup   uuid;
  v_ref   uuid;
  v_piece uuid;
  v_rid   uuid;
  v_attb  uuid;
  v_attc  uuid;
BEGIN
  FOR k IN 1..12 LOOP
    v_bank := (ARRAY['ORA', 'BDK', 'ATB', 'BIS'])[1 + k % 4];
    v_fmt := CASE WHEN v_bank IN ('ORA', 'BDK') THEN 'structured_bank_statement_csv' ELSE 'structured_bank_statement_xls' END;
    v_par := CASE v_bank WHEN 'ATB' THEN 'structured-excel-0q/atb-online-xls-v1' WHEN 'BIS' THEN 'structured-excel-0q/bis-online-xls-v1'
                         ELSE 'structured-csv-0b' END;
    v_acc := 'rnd_' || k;
    v_rid := tr_test.seed_registry(v_acc, v_bank, 'XOF', 'TR RND ' || k);
    v_open := 1000;
    FOR v_day IN 0..39 LOOP
      d := date '2026-09-01' + v_day;
      r := random();
      CONTINUE WHEN r < 0.08;
      v_exp := 'e_rnd_' || k || '_' || v_day;
      PERFORM tr_test.seed_export(v_exp, v_acc, v_fmt, v_par, d, d + (random() * 2)::integer, NULL, 'valid',
        (d + 1 + (random() * 3)::integer) + time '08:00');
      v_close := v_open + (1 + floor(random() * 90))::numeric * CASE WHEN random() < 0.5 THEN -1 ELSE 1 END;
      IF r < 0.55 THEN
        PERFORM tr_test.seed_unit(v_exp, d, v_open, v_close);
      ELSIF r < 0.60 THEN
        v_close := v_close + 7;
        PERFORM tr_test.seed_unit(v_exp, d, v_open + 7, v_close);
      ELSIF r < 0.65 THEN
        PERFORM tr_test.seed_unit(v_exp, d, v_open, v_close, p_staging_status => 'staged', p_canonical => false);
      ELSIF r < 0.68 THEN
        PERFORM tr_test.seed_unit(v_exp, d, v_open, v_close, p_staging_status => 'provisional', p_canonical => false);
      ELSE
        v_can := tr_test.seed_unit(v_exp, d, v_open, v_close);
        SELECT promoted_from_staging_unit_id INTO v_stg FROM public.daily_statement_units_canonical WHERE id = v_can;
        v_attb := tr_test.seed_export(v_exp || 'b', v_acc, v_fmt, v_par, d, d, NULL, 'valid',
          (d + 2 + (random() * 6)::integer) + time '09:00');
        IF r < 0.74 THEN
          -- Doublon contradictoire (ouverture et clôture décalées), deux sources parfois.
          v_dup := tr_test.rnd_clone(v_stg, v_attb, 'duplicate');
          UPDATE public.daily_statement_units_staging SET opening_balance_derived = opening_balance_derived + 5,
            closing_balance_derived = closing_balance_derived + 5 WHERE id = v_dup;
          IF random() < 0.4 THEN
            v_attc := tr_test.seed_export(v_exp || 'c', v_acc, v_fmt, v_par, d, d, NULL, 'valid', (d + 9) + time '10:00');
            PERFORM tr_test.rnd_clone(v_dup, v_attc, 'conflict');
          END IF;
          IF random() < 0.5 THEN
            v_ref := gen_random_uuid();
            IF random() < 0.5 THEN
              v_piece := gen_random_uuid();
              INSERT INTO public.daily_statement_correction_pieces (id, account_registry_id, piece_sha256, piece_reference,
                archive_reference, issued_on, archive_attested, actor_id)
              VALUES (v_piece, v_rid, encode(sha256(convert_to('rnd-piece:' || v_ref, 'UTF8')), 'hex'),
                'Piece RND', 'Archive RND', d + 12, true, tr_test.id('t_admin'));
            ELSE
              v_piece := NULL;
            END IF;
            INSERT INTO public.daily_statement_version_refutations (id, action, day_unit_id, account_registry_id,
              accounting_date, refuted_version_key, retained_canonical_unit_id, retained_version_key, comparison, proof_kind,
              proof_staging_unit_id, proof_bound_day, piece_id, piece_opening, piece_closing, reason, actor_id)
            SELECT v_ref, 'REFUTE', s.day_unit_id, s.account_registry_id, d,
                   public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
                     s.closing_balance_derived, s.day_total_debits, s.day_total_credits),
                   v_can, public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived - 5,
                     s.closing_balance_derived - 5, s.day_total_debits, s.day_total_credits),
                   'CONTRADICTION', CASE WHEN v_piece IS NULL THEN 'FRESH_DELIVERY' ELSE 'BANK_PIECE' END,
                   CASE WHEN v_piece IS NULL THEN v_stg END, d + 12, v_piece,
                   CASE WHEN v_piece IS NOT NULL THEN s.opening_balance_derived - 5 END,
                   CASE WHEN v_piece IS NOT NULL THEN s.closing_balance_derived - 5 END,
                   'Refutation RND', tr_test.id('t_admin')
            FROM public.daily_statement_units_staging s WHERE s.id = v_dup;
            INSERT INTO public.daily_statement_refutation_sources (refutation_id, raw_text_hash, account_registry_id,
              first_seen_at, proof_bound_day, verdict)
            SELECT v_ref, a.raw_text_hash, a.account_registry_id, min(a.created_at), d + 12, 'JUSTIFIED'
            FROM public.daily_statement_units_staging s JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
            WHERE s.day_unit_id = (SELECT day_unit_id FROM public.daily_statement_units_staging WHERE id = v_dup)
              AND s.id <> v_stg AND s.status IN ('duplicate', 'conflict')
              AND (d + 12) > (a.created_at AT TIME ZONE 'Africa/Dakar')::date
            GROUP BY a.raw_text_hash, a.account_registry_id;
          END IF;
        ELSIF r < 0.78 THEN
          -- Ventilation différente au même net (accord établi).
          v_dup := tr_test.rnd_clone(v_stg, v_attb, 'conflict');
          UPDATE public.daily_statement_units_staging SET day_total_debits = day_total_debits + 3,
            day_total_credits = day_total_credits + 3,
            day_content_hash = encode(sha256(convert_to('rnd-breakdown:' || v_dup, 'UTF8')), 'hex') WHERE id = v_dup;
        ELSIF r < 0.82 THEN
          -- Données insuffisantes : agrégats indisponibles, même net.
          v_dup := tr_test.rnd_clone(v_stg, v_attb, CASE WHEN random() < 0.5 THEN 'conflict' ELSE 'staged' END);
          UPDATE public.daily_statement_units_staging SET aggregates_status = 'unavailable', opening_balance_derived = NULL,
            closing_balance_derived = NULL,
            day_content_hash = encode(sha256(convert_to('rnd-insufficient:' || v_dup, 'UTF8')), 'hex') WHERE id = v_dup;
        ELSIF r < 0.86 THEN
          -- Livraison écartée d'une autre version.
          v_dup := tr_test.rnd_clone(v_stg, v_attb, 'rejected');
          UPDATE public.daily_statement_units_staging SET opening_balance_derived = opening_balance_derived - 3,
            closing_balance_derived = closing_balance_derived - 3 WHERE id = v_dup;
        ELSIF r < 0.89 THEN
          -- Unité retenue incohérente (réserve 4.1).
          UPDATE public.daily_statement_units_canonical SET closing_balance_derived = closing_balance_derived + 1 WHERE id = v_can;
          UPDATE public.daily_statement_units_staging SET closing_balance_derived = closing_balance_derived + 1 WHERE id = v_stg;
          v_close := v_close + 1;
        ELSIF r < 0.93 THEN
          -- Remplacement passé : l'ancienne version (autre ouverture) reste en historique.
          v_dup := tr_test.rnd_clone(v_stg, v_attb, 'superseded');
          UPDATE public.daily_statement_units_staging SET opening_balance_derived = opening_balance_derived - 4,
            closing_balance_derived = closing_balance_derived - 4 WHERE id = v_dup;
          INSERT INTO public.daily_statement_units_canonical (id, promoted_from_staging_unit_id, day_unit_id, bank,
            account_fingerprint, currency, accounting_date, active_day_content_hash, line_count, day_total_debits,
            day_total_credits, opening_balance_derived, closing_balance_derived, aggregates_status, validation_status,
            status, account_registry_id, ingested_at, superseded_by, superseded_at)
          SELECT gen_random_uuid(), s.id, s.day_unit_id, s.bank, s.account_fingerprint, s.currency, s.accounting_date,
                 s.day_content_hash, s.line_count, s.day_total_debits, s.day_total_credits, s.opening_balance_derived,
                 s.closing_balance_derived, s.aggregates_status, s.validation_status, 'superseded', s.account_registry_id,
                 now() - interval '30 days', v_can, now() - interval '20 days'
          FROM public.daily_statement_units_staging s WHERE s.id = v_dup;
        ELSE
          -- Doublon de même version, attestation d'identité (puis révocation) sur l'export Excel.
          PERFORM tr_test.rnd_clone(v_stg, v_attb, 'duplicate');
          IF v_fmt <> 'structured_bank_statement_csv' THEN
            UPDATE public.daily_statement_export_attempts SET review_reason_codes = ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']
             WHERE id = v_attb;
            INSERT INTO public.daily_statement_attempt_attestations (attempt_id, attestation_type, action, raw_text_hash,
              account_registry_id, currency, evidence_ref, reason, actor_id)
            SELECT a.id, 'ACCOUNT_IDENTITY', 'ATTEST', a.raw_text_hash, a.account_registry_id, 'XOF', 'Preuve RND', 'Attestation RND',
                   tr_test.id('t_admin')
            FROM public.daily_statement_export_attempts a WHERE a.id = v_attb AND random() < 0.7;
          END IF;
        END IF;
      END IF;
      v_open := v_close;
    END LOOP;
    -- Points de départ : sur une journée retenue tirée au hasard, parfois révoqués.
    INSERT INTO treasury_private.verified_starts (action, registry_account_id, day, canonical_unit_id, content_hash,
      verified_opening, evidence_ref, reason, actor_id)
    SELECT 'SET', u.account_registry_id, u.accounting_date, u.id, u.active_day_content_hash, trunc(u.opening_balance_derived),
           'Releve RND', 'Point de depart RND', tr_test.id('t_admin')
    FROM public.daily_statement_units_canonical u
    WHERE u.account_registry_id = v_rid AND u.status = 'ingested' AND u.opening_balance_derived IS NOT NULL
      AND random() < 0.08;
  END LOOP;
  INSERT INTO treasury_private.verified_starts (action, registry_account_id, day, canonical_unit_id, content_hash,
    verified_opening, evidence_ref, reason, revokes_id, actor_id)
  SELECT 'REVOKE', v.registry_account_id, v.day, v.canonical_unit_id, v.content_hash, v.verified_opening, v.evidence_ref,
         'Revocation RND', v.id, tr_test.id('t_admin')
  FROM treasury_private.verified_starts v
  WHERE v.action = 'SET' AND v.evidence_ref = 'Releve RND' AND random() < 0.3;
END $$;
SET session_replication_role = origin;

SELECT tr_test.as_user('t_admin');
SELECT public.treasury_admin_add_expected_account_v1(tr_test.key('rnd-add-' || k), tr_test.id('rnd_' || k), NULL, NULL, NULL,
  'Compte attendu aleatoire ' || k)
FROM generate_series(1, 12) k;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT 'PASS 83_random_histories (' || (SELECT count(*) FROM public.daily_statement_units_staging s
  JOIN public.daily_statement_account_registry r ON r.id = s.account_registry_id WHERE r.safe_alias LIKE 'TR RND %')
  || ' livraisons, ' || (SELECT count(*) FROM treasury_private.verified_starts WHERE evidence_ref = 'Releve RND') || ' points)' AS marker;
