-- ============================================================================
-- DAILY V2 — D1 : LIVRAISON PROVISOIRE TARDIVE DE VERSION IDENTIQUE
-- GO_IMPLEMENT_DAILY_V2_ORABANK_LATE_PROVISIONAL_D1_LOCAL_ONLY — cadrage R2,
-- variante R (retrait en « superseded »), arbitrages CTO Q1 à Q8.
-- ============================================================================
-- Constat D1 (simulation BDK/ORABANK, P2) : un fichier ancien reçu en retard,
-- dont la dernière journée est demandée provisoire alors qu'elle est déjà
-- retenue, déposait une provisoire vivante qui contestait la journée et la
-- suite de la couverture.
--
-- Règle ajoutée. Une livraison demandée provisoire est reçue puis retirée
-- (statut « superseded », motif late_provisional_same_version_superseded,
-- rattachée au canonical actif) si et seulement si :
--   - un canonical actif « ingested » existe pour la même journée ;
--   - daily_stmt_version_compare(...) = 'SAME_VERSION' : mouvements, état
--     d'agrégation, ouverture, clôture, débits et crédits, en égalité
--     numérique (10.5 = 10.50), une valeur absente n'égalant qu'une absence ;
--   - sa version est cohérente (daily_stmt_version_coherent, relations 1 à 4) ;
--   - ses lignes sont conformes à ses faits (relation 6, règle commune
--     daily_stmt_line_facts_conform), dans un ordre non ambigu (index de ligne
--     et ordinal d'occurrence uniques dans la journée, comparés sur leurs
--     valeurs entières : « 1 » et « 01 » se confondent, correction C2).
-- Seules les provisoires vivantes satisfaisant le même prédicat sont retirées ;
-- les provisoires divergentes, incohérentes ou non conformes restent vivantes.
-- Les doublons R1-provisional de la version active (redépôts pendant la
-- fenêtre « déposée, non promue », ou réceptions héritées), issus du cycle
-- provisoire d'un fichier dont une livraison du cycle détient une copie
-- conforme de même version d'analyse, sont retirés de même, à l'activation
-- comme au dépôt (corrections C1 et W5) ; un doublon du canonical, d'une autre
-- version, sans copie conforme de son fichier, d'une autre version d'analyse ou
-- désigné comme preuve de réfutation reste inchangé.
--
-- Points d'intervention (fonctions redéfinies, signatures et attributs
-- inchangés, révocations réappliquées) :
--   - dépôt : daily_stmt_pre_ingest_legacy_core_0u ;
--   - activation : daily_stmt_promote_unit_core, commun à la promotion
--     unitaire, à la promotion groupée, au remplacement et à la correction des
--     seuls soldes (Q5 : « déposée puis promue » et « promue puis déposée »
--     aboutissent au même statut).
-- Fonctions internes ajoutées, inexécutables par l'API :
--   daily_stmt_payload_lines_conform, daily_stmt_provisional_same_version,
--   daily_stmt_retire_same_version_provisionals.
--
-- Minimisation (réserve CTO R1). La livraison retirée au dépôt conserve ses
-- lignes, sauf si une livraison provisoire ou retirée du même fichier (même
-- empreinte brute) pour la même journée détient déjà une copie conforme de la
-- même version, dans un ordre de lignes non ambigu, reçue sous la même version
-- d'analyse identifiée : un redépôt identique ne recrée pas de copie. Un
-- doublon du cycle provisoire retiré reste sans lignes. Aucune ligne existante
-- n'est effacée. L'empreinte brute et la version d'analyse sont déclarées par
-- le client : elles relient deux réceptions, elles n'authentifient pas un
-- fichier.
--
-- Inchangés : enveloppes et contrôles de portée, cœurs 0w, cœur BIS 0v,
-- arbitrage R1/R2/R3 du chemin « staged » (une journée close balaie toujours
-- toutes les provisoires), comparaison R1-provisional hors D1, H1,
-- non-promotion des provisoires (garde 0H et déclencheur anti-promotion),
-- réfutation, écartement, lecteur Trésorerie, domaine des événements et liste
-- blanche des détails. La migration ne modifie aucune donnée existante et ne
-- crée ni table, ni contrainte, ni politique, ni déclencheur.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Relation 6 appliquée à la charge d'un dépôt, avant tout stockage
-- --------------------------------------------------------------------------
-- Même décision que daily_stmt_staging_lines_conform, sur les lignes de la
-- charge d'une journée : mêmes agrégats, même règle commune, même ordre de
-- chaînage (index de la ligne dans le fichier, puis ordinal d'occurrence).
-- Prudence : si deux lignes partagent ce couple, l'ordre stocké dépendrait d'un
-- identifiant aléatoire ; la livraison est alors réputée non conforme (rien
-- n'est retiré). Le couple est comparé sur ses valeurs entières, celles du tri
-- et du stockage (« 1 » et « 01 » sont le même index), jamais sur leur texte.
-- Une valeur hors du domaine entier stocké rend faux, sans erreur : le chemin
-- existant reste seul juge de la charge.
CREATE FUNCTION public.daily_stmt_payload_lines_conform(
  p_lines jsonb, p_day_unit_id text, p_line_count integer, p_debits numeric, p_credits numeric,
  p_aggregates text, p_opening numeric, p_closing numeric)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conform boolean;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
             WHERE x.value ->> 'day_unit_id' = p_day_unit_id
               AND greatest((x.value ->> 'source_line_index')::numeric, (x.value ->> 'daily_occurrence_ordinal')::numeric) > 2147483647) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
             WHERE x.value ->> 'day_unit_id' = p_day_unit_id
             GROUP BY (x.value ->> 'source_line_index')::integer, (x.value ->> 'daily_occurrence_ordinal')::integer HAVING count(*) > 1) THEN
    RETURN false;
  END IF;
  WITH l AS (
    SELECT public.daily_stmt_parse_amount_strict(x.value ->> 'signed_amount') AS signed,
           x.value ->> 'direction' AS direction,
           public.daily_stmt_parse_amount_strict(x.value ->> 'running_balance') AS running,
           row_number() OVER w AS rn, count(*) OVER () AS n_all,
           lag(public.daily_stmt_parse_amount_strict(x.value ->> 'running_balance')) OVER w AS prev_r,
           lead(public.daily_stmt_parse_amount_strict(x.value ->> 'running_balance')) OVER w AS next_r
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(value, ord)
    WHERE x.value ->> 'day_unit_id' = p_day_unit_id
    WINDOW w AS (ORDER BY (x.value ->> 'source_line_index')::integer,
                          (x.value ->> 'daily_occurrence_ordinal')::integer, x.ord)
  ), agg AS (
    SELECT count(*) AS n,
           sum(-l.signed) FILTER (WHERE l.direction = 'debit') AS debits,
           sum(l.signed) FILTER (WHERE l.direction = 'credit') AS credits,
           bool_and(l.running IS NOT NULL) AS all_balances,
           bool_and(l.rn = 1 OR l.running = l.prev_r + l.signed) AS chain_asc,
           bool_and(l.rn = l.n_all OR l.running = l.next_r + l.signed) AS chain_desc,
           max(l.running - l.signed) FILTER (WHERE l.rn = 1) AS open_asc,
           max(l.running) FILTER (WHERE l.rn = l.n_all) AS close_asc,
           max(l.running - l.signed) FILTER (WHERE l.rn = l.n_all) AS open_desc,
           max(l.running) FILTER (WHERE l.rn = 1) AS close_desc
    FROM l
  )
  SELECT public.daily_stmt_line_facts_conform(p_line_count, p_debits, p_credits, p_aggregates, p_opening, p_closing,
           agg.n, agg.debits, agg.credits, agg.all_balances, agg.chain_asc, agg.chain_desc,
           agg.open_asc, agg.close_asc, agg.open_desc, agg.close_desc)
    INTO v_conform
  FROM agg;
  RETURN coalesce(v_conform, false);
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Prédicat D1 sur une livraison stockée
-- --------------------------------------------------------------------------
-- Provisoire vivante de la journée du canonical actif désigné, de même version
-- complète, cohérente et aux lignes stockées conformes (règle commune), dans un
-- ordre de lignes non ambigu (même prudence que la règle de la charge ; les
-- colonnes stockées sont entières).
-- Doublon du cycle provisoire (C1, W5) : doublon R1-provisional d'une
-- provisoire, seul autre statut admis, mêmes garanties au dépôt et à
-- l'activation. Il n'a jamais de lignes (0Z). Exigés tous ensemble :
--   - provenance : son événement de réception unit_duplicate écrit par le chemin
--     R1-provisional (motif provisional_redeposit_duplicate, aucun canonical
--     désigné, même tentative, même empreinte de journée) ; un doublon du
--     canonical (R1, H1) n'en a jamais ;
--   - version complète du canonical (SAME_VERSION) et cohérence ;
--   - conformité : une livraison du cycle provisoire du MÊME fichier (même
--     empreinte brute), provisoire ou retirée, de mêmes faits et aux lignes
--     stockées conformes dans un ordre non ambigu, détient la copie de ses
--     lignes (l'empreinte de ligne ne couvre ni le solde courant ni l'index :
--     seul le même fichier garantit les mêmes lignes), reçue sous la même
--     version d'analyse, identifiée et non vide ;
--   - aucune réfutation ne le désigne comme preuve (la preuve resterait sans
--     livraison).
-- Toute autre situation rend faux : rien n'est retiré.
CREATE FUNCTION public.daily_stmt_provisional_same_version(p_staging_unit_id uuid, p_canonical_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s   public.daily_statement_units_staging%ROWTYPE;
  v_c   public.daily_statement_units_canonical%ROWTYPE;
  v_rth text;
  v_pv  text;
BEGIN
  SELECT * INTO v_s FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;
  IF NOT FOUND OR v_s.status NOT IN ('provisional', 'duplicate') THEN
    RETURN false;
  END IF;
  SELECT * INTO v_c FROM public.daily_statement_units_canonical WHERE id = p_canonical_unit_id;
  IF NOT FOUND OR v_c.status <> 'ingested' OR v_c.day_unit_id <> v_s.day_unit_id THEN
    RETURN false;
  END IF;
  IF v_s.status = 'provisional' THEN
    RETURN coalesce(
      public.daily_stmt_version_compare(v_s.day_content_hash, v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits, v_c.active_day_content_hash, v_c.aggregates_status, v_c.opening_balance_derived, v_c.closing_balance_derived, v_c.day_total_debits, v_c.day_total_credits) = 'SAME_VERSION'
      AND public.daily_stmt_version_coherent(v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits)
      AND public.daily_stmt_staging_lines_conform(v_s.id)
      AND NOT EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = v_s.id GROUP BY l.source_line_index, l.daily_occurrence_ordinal HAVING count(*) > 1)
      , false);
  END IF;
  -- C1 : doublon R1-provisional (voir l'en-tête de la section).
  SELECT a.raw_text_hash, a.parser_version INTO v_rth, v_pv FROM public.daily_statement_export_attempts a WHERE a.id = v_s.attempt_id;
  RETURN coalesce(
    v_s.status = 'duplicate'
    AND EXISTS (SELECT 1 FROM public.daily_statement_import_events e WHERE e.staging_unit_id = v_s.id AND e.attempt_id = v_s.attempt_id AND e.event_type = 'unit_duplicate' AND e.new_status = 'duplicate' AND e.canonical_unit_id IS NULL AND e.safe_details ->> 'reason_code' = 'provisional_redeposit_duplicate' AND e.safe_details ->> 'day_content_hash' = v_s.day_content_hash)
    AND public.daily_stmt_version_compare(v_s.day_content_hash, v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits, v_c.active_day_content_hash, v_c.aggregates_status, v_c.opening_balance_derived, v_c.closing_balance_derived, v_c.day_total_debits, v_c.day_total_credits) = 'SAME_VERSION'
    AND public.daily_stmt_version_coherent(v_s.aggregates_status, v_s.opening_balance_derived, v_s.closing_balance_derived, v_s.day_total_debits, v_s.day_total_credits)
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations r WHERE r.proof_staging_unit_id = v_s.id)
    AND EXISTS (
      SELECT 1
      FROM public.daily_statement_units_staging o
      JOIN public.daily_statement_export_attempts ao ON ao.id = o.attempt_id
      WHERE o.day_unit_id = v_s.day_unit_id AND o.id <> v_s.id
        AND o.status IN ('provisional', 'superseded')
        AND ao.raw_text_hash = v_rth
        AND nullif(btrim(ao.parser_version), '') IS NOT NULL AND ao.parser_version = v_pv
        AND o.day_content_hash = v_s.day_content_hash
        AND o.aggregates_status = v_s.aggregates_status
        AND o.opening_balance_derived IS NOT DISTINCT FROM v_s.opening_balance_derived
        AND o.closing_balance_derived IS NOT DISTINCT FROM v_s.closing_balance_derived
        AND o.day_total_debits IS NOT DISTINCT FROM v_s.day_total_debits
        AND o.day_total_credits IS NOT DISTINCT FROM v_s.day_total_credits
        AND public.daily_stmt_staging_lines_conform(o.id)
        AND NOT EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = o.id GROUP BY l.source_line_index, l.daily_occurrence_ordinal HAVING count(*) > 1))
    , false);
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Retrait des seules provisoires vivantes de version identique
-- --------------------------------------------------------------------------
-- Appelée par le dépôt et par le cœur de promotion, sous le verrou de journée
-- (vérifié ici). Changement de statut et événement d'audit, jamais de DELETE ;
-- lignes, faits et identifiants inchangés. Postcondition conditionnelle (Q4) :
-- les livraisons candidates restantes sont exactement celles qui ne satisfont
-- pas le prédicat avant le retrait, donc aucune livraison admissible ne reste.
-- Candidates : les provisoires vivantes et les doublons de la journée, au dépôt
-- comme à l'activation ; seuls ceux qui satisfont le prédicat
-- daily_stmt_provisional_same_version sont retirés (un doublon du canonical ne
-- l'est jamais). Détail « resolution » : retired_at_activation ou
-- retired_at_deposit pour une provisoire,
-- provisional_duplicate_retired_at_activation ou
-- provisional_duplicate_retired_at_deposit pour un doublon.
CREATE FUNCTION public.daily_stmt_retire_same_version_provisionals(
  p_day_unit_id text, p_canonical_unit_id uuid, p_actor uuid, p_attempt_id uuid, p_raw_text_hash text,
  p_exclude_staging_unit_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key     bigint;
  v_before  uuid[];
  v_after   uuid[];
  v_row     record;
  v_rows    integer;
  v_retired integer := 0;
BEGIN
  IF p_day_unit_id IS NULL OR p_canonical_unit_id IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_D1_ARGUMENTS: day unit and canonical unit required (fail-closed)';
  END IF;
  -- Verrou de journée de daily_stmt_acquire_day_lock tenu par cette session.
  v_key := hashtextextended(p_day_unit_id, 0);
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid() AND l.granted
      AND l.classid = ((v_key >> 32) & 4294967295)::oid
      AND l.objid = (v_key & 4294967295)::oid
      AND l.objsubid = 1) THEN
    RAISE EXCEPTION 'DAILY_STMT_D1_DAY_LOCK_REQUIRED: the day lock must be held (fail-closed)';
  END IF;

  SELECT coalesce(array_agg(s.id ORDER BY s.id), ARRAY[]::uuid[]) INTO v_before
  FROM public.daily_statement_units_staging s
  WHERE s.day_unit_id = p_day_unit_id AND s.status IN ('provisional', 'duplicate')
    AND s.id IS DISTINCT FROM p_exclude_staging_unit_id
    AND NOT public.daily_stmt_provisional_same_version(s.id, p_canonical_unit_id);

  FOR v_row IN
    SELECT s.id, s.status FROM public.daily_statement_units_staging s
    WHERE s.day_unit_id = p_day_unit_id AND s.status IN ('provisional', 'duplicate')
      AND s.id IS DISTINCT FROM p_exclude_staging_unit_id
    ORDER BY s.created_at, s.id
  LOOP
    IF public.daily_stmt_provisional_same_version(v_row.id, p_canonical_unit_id) THEN
      UPDATE public.daily_statement_units_staging
        SET status = 'superseded'
        WHERE id = v_row.id AND status = v_row.status;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'DAILY_STMT_D1_POSTCONDITION: each retirement changes exactly one candidate unit (rollback)';
      END IF;
      PERFORM public.daily_stmt_append_audit_event(
        p_actor, p_attempt_id, v_row.id, p_canonical_unit_id, p_day_unit_id, p_raw_text_hash,
        'status_changed', v_row.status, 'superseded',
        CASE WHEN v_row.status = 'duplicate'
             THEN 'provisional-cycle duplicate retired: same full version as the active canonical day (D1)'
             ELSE 'live provisional unit retired: same full version as the active canonical day (D1)' END,
        jsonb_build_object(
          'reason_code', 'late_provisional_same_version_superseded',
          'day_unit_id', p_day_unit_id,
          'previous_status', v_row.status,
          'new_status', 'superseded',
          'resolution', CASE WHEN v_row.status = 'duplicate' AND p_exclude_staging_unit_id IS NULL
                               THEN 'provisional_duplicate_retired_at_activation'
                             WHEN v_row.status = 'duplicate' THEN 'provisional_duplicate_retired_at_deposit'
                             WHEN p_exclude_staging_unit_id IS NULL THEN 'retired_at_activation'
                             ELSE 'retired_at_deposit' END));
      v_retired := v_retired + 1;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(s.id ORDER BY s.id), ARRAY[]::uuid[]) INTO v_after
  FROM public.daily_statement_units_staging s
  WHERE s.day_unit_id = p_day_unit_id AND s.status IN ('provisional', 'duplicate')
    AND s.id IS DISTINCT FROM p_exclude_staging_unit_id;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'DAILY_STMT_D1_POSTCONDITION: remaining candidate units must be exactly the non-admissible ones (rollback)';
  END IF;
  RETURN v_retired;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Dépôt : cœur quotidien et provisoire (source vivante 20261103120000)
-- --------------------------------------------------------------------------
-- Redéfinition à signature et attributs identiques ; seuls s'ajoutent le
-- prédicat D1 pour une unité demandée provisoire, le retrait de la livraison
-- reçue et des provisoires identiques, et la postcondition conditionnelle.
-- Hors prédicat D1, le chemin existant est inchangé.

CREATE OR REPLACE FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(
  p_attempt       jsonb,
  p_units         jsonb,
  p_lines         jsonb,
  p_guard_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor            uuid;
  v_attempt_id       uuid;

  -- attempt
  v_mode             text;
  v_source_format    text;
  v_bank             text;
  v_currency         text;
  v_fp               text;
  v_masked           text;
  v_file_name        text;
  v_rth              text;
  v_period_start     date;
  v_period_end       date;
  v_stmt_date        date;
  v_ref_date         date;
  v_parser_status    text;
  v_errors_count     integer;
  v_warnings_count   integer;

  -- guard
  v_ingestion_ready  boolean;
  v_bridge           boolean;
  v_period_days      integer;
  v_grant            text;

  -- units (tableaux parallèles indexés par position dans p_units)
  v_n                integer;
  v_unit             jsonb;
  v_line             jsonb;
  v_i                integer;
  v_lidx             integer;
  v_day_unit_ids     text[] := '{}';
  v_acc_raw          text[] := '{}';
  v_acc_dates        date[] := '{}';
  v_content_hashes   text[] := '{}';
  v_line_counts      integer[] := '{}';
  v_req_status       text[] := '{}';
  v_expected         text;
  v_max_acc          date;
  v_unit_hashes      text[];
  v_keep_lines       boolean;
  v_new_unit         public.daily_statement_units_staging%ROWTYPE;

  -- lignes
  v_direction        text;
  v_signed           numeric;
  v_debit            numeric;
  v_credit           numeric;
  v_seen_pairs       text[] := '{}';
  v_pair             text;

  -- arbitrage
  v_lock_id          text;
  v_active           public.daily_statement_units_canonical%ROWTYPE;
  v_final            text;
  v_overlap          boolean;
  v_staging_unit_id  uuid;
  v_result_units     jsonb := '[]'::jsonb;
  v_active_id        uuid;

  -- cycle de vie provisional (0Z)
  v_prev_provisional   public.daily_statement_units_staging%ROWTYPE;
  v_keep_provisional   uuid;
  v_dup_of_provisional boolean;
  v_swept              record;
  v_live_provisional   integer;
  v_unit_event_type    text;
  v_unit_event_message text;

  -- D1 : livraison demandée provisoire de version complète identique au
  -- canonical actif de la journée, cohérente et aux lignes conformes.
  v_d1_canonical       public.daily_statement_units_canonical%ROWTYPE;
  v_d1_agg             text;
  v_d1_open            numeric;
  v_d1_close           numeric;
  v_d1_debits          numeric;
  v_d1_credits         numeric;
  v_d1_same            boolean;
  v_d1_coherent        boolean;
  v_d1_conform         boolean;
  v_d1_retire          boolean;
  v_d1_copy_exists     boolean;
  v_d1_rows            integer;

  -- Miroirs EXACTS des whitelists TS 0G (DAILY_STATEMENT_RPC_*_ALLOWED_KEYS).
  c_attempt_allowed constant text[] := ARRAY[
    'requested_mode', 'source_format', 'bank', 'currency', 'account_fingerprint',
    'account_number_masked', 'source_file_name_redacted', 'raw_text_hash',
    'export_period_start', 'export_period_end', 'statement_date',
    'export_reference_date', 'parser_validation_status', 'errors_count',
    'warnings_count', 'runtime_version', 'parser_version'
  ];
  c_unit_allowed constant text[] := ARRAY[
    'day_unit_id', 'accounting_date', 'day_content_hash', 'line_count',
    'day_total_debits', 'day_total_credits', 'opening_balance_derived',
    'closing_balance_derived', 'aggregates_status', 'validation_status',
    'requested_unit_status'
  ];
  c_line_allowed constant text[] := ARRAY[
    'day_unit_id', 'daily_line_hash', 'daily_occurrence_ordinal',
    'source_line_index', 'accounting_date', 'value_date',
    'description_sanitized', 'debit_amount', 'credit_amount', 'signed_amount',
    'running_balance', 'direction', 'currency'
  ];
  c_guard_allowed constant text[] := ARRAY[
    'ingestion_ready', 'period_days', 'bridge_guard_passed',
    'backfill_grant_reference'
  ];
  -- Miroir de MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS (0C).
  c_max_period_days constant integer := 45;
  -- Plafonds STRUCTURELS du backfill (0K) : un dépôt BIS reste massif mais
  -- borné — jamais de payload illimité, même sous grant admin.
  c_max_backfill_period_days constant integer := 4000;
  c_max_backfill_units       constant integer := 4000;
BEGIN
  -- Rôle : admin ou manager (dépôt) ; backfill = admin seul (doctrine 0F).
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
          OR public.has_role(v_actor, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin or manager role required (fail-closed)';
  END IF;

  -- Anti-smuggling AVANT tout : scan profond des 4 paramètres.
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_attempt, '$.p_attempt');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_units, '$.p_units');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_lines, '$.p_lines');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_guard_context, '$.p_guard_context');

  -- Whitelists structurelles.
  PERFORM public.daily_stmt_assert_object_keys(p_attempt, c_attempt_allowed, 'p_attempt');
  PERFORM public.daily_stmt_assert_object_keys(p_guard_context, c_guard_allowed, 'p_guard_context');
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_UNITS_REQUIRED: p_units must be a non-empty json array (fail-closed)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_LINES_REQUIRED: p_lines must be a non-empty json array (fail-closed)';
  END IF;

  -- ------------------------------------------------------------------
  -- p_attempt
  -- ------------------------------------------------------------------
  v_mode := p_attempt ->> 'requested_mode';
  IF v_mode IS NULL OR v_mode NOT IN ('daily', 'backfill') THEN
    RAISE EXCEPTION 'DAILY_STMT_MODE_UNSUPPORTED: requested_mode must be daily or backfill (fail-closed)';
  END IF;
  IF v_mode = 'backfill'
     AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: backfill deposits require the admin role (fail-closed)';
  END IF;

  v_source_format := nullif(btrim(coalesce(p_attempt ->> 'source_format', '')), '');
  v_bank          := nullif(btrim(coalesce(p_attempt ->> 'bank', '')), '');
  v_currency      := nullif(btrim(coalesce(p_attempt ->> 'currency', '')), '');
  v_fp            := nullif(btrim(coalesce(p_attempt ->> 'account_fingerprint', '')), '');
  IF v_source_format IS NULL OR v_bank IS NULL OR v_currency IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_SOURCE_REQUIRED: source_format, bank and currency are required (fail-closed)';
  END IF;
  IF v_fp IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_FINGERPRINT_REQUIRED: account_fingerprint is mandatory; no fallback on the masked account number (fail-closed)';
  END IF;

  v_masked := nullif(btrim(coalesce(p_attempt ->> 'account_number_masked', '')), '');
  PERFORM public.daily_stmt_assert_masked_account(v_masked);
  v_file_name := nullif(btrim(coalesce(p_attempt ->> 'source_file_name_redacted', '')), '');
  PERFORM public.daily_stmt_assert_safe_file_name(v_file_name);

  v_rth := public.daily_stmt_assert_hex64(p_attempt ->> 'raw_text_hash', 'raw_text_hash');

  v_period_start := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start');
  v_period_end   := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end');
  IF v_period_end < v_period_start THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_INCOHERENT: export_period_end earlier than export_period_start (fail-closed)';
  END IF;
  v_stmt_date := CASE WHEN p_attempt ->> 'statement_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'statement_date') END;
  v_ref_date  := CASE WHEN p_attempt ->> 'export_reference_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'export_reference_date') END;

  v_parser_status := p_attempt ->> 'parser_validation_status';
  IF v_parser_status IS NULL OR v_parser_status NOT IN ('valid', 'needs_review') THEN
    RAISE EXCEPTION 'DAILY_STMT_PARSER_STATUS: parser_validation_status must be valid or needs_review (fail-closed)';
  END IF;

  IF coalesce(p_attempt ->> 'errors_count', '0') !~ '^[0-9]+$'
     OR coalesce(p_attempt ->> 'warnings_count', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_COUNT_INVALID: errors_count/warnings_count must be integers >= 0 (fail-closed)';
  END IF;
  v_errors_count   := coalesce(p_attempt ->> 'errors_count', '0')::integer;
  v_warnings_count := coalesce(p_attempt ->> 'warnings_count', '0')::integer;

  -- ------------------------------------------------------------------
  -- p_guard_context
  -- ------------------------------------------------------------------
  IF jsonb_typeof(p_guard_context -> 'ingestion_ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_guard_context -> 'bridge_guard_passed') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'DAILY_STMT_GUARD_TYPE: ingestion_ready and bridge_guard_passed must be json booleans (fail-closed)';
  END IF;
  v_ingestion_ready := (p_guard_context ->> 'ingestion_ready')::boolean;
  v_bridge          := (p_guard_context ->> 'bridge_guard_passed')::boolean;
  IF coalesce(p_guard_context ->> 'period_days', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_period_days := (p_guard_context ->> 'period_days')::integer;
  IF v_period_days < 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_grant := nullif(btrim(coalesce(p_guard_context ->> 'backfill_grant_reference', '')), '');

  IF NOT v_bridge THEN
    RAISE EXCEPTION 'DAILY_STMT_BRIDGE_GUARD_FAILED: a guard-rejected export never becomes a deposit (fail-closed)';
  END IF;
  -- Recomptage serveur : la fenêtre déclarée ne peut pas être sous-évaluée.
  IF v_period_days <> (v_period_end - v_period_start + 1) THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_MISMATCH: period_days does not match the inclusive export window (fail-closed)';
  END IF;

  IF v_mode = 'daily' THEN
    IF NOT v_ingestion_ready THEN
      RAISE EXCEPTION 'DAILY_STMT_INGESTION_READY_REQUIRED: a daily deposit requires an ingestion-ready export (fail-closed)';
    END IF;
    IF v_period_days > c_max_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_PERIOD_CAP: export window above the %-day ingestion limit; use the dedicated backfill mode (fail-closed)', c_max_period_days;
    END IF;
    IF v_grant IS NOT NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_FORBIDDEN: backfill_grant_reference must not ride a daily deposit (fail-closed)';
    END IF;
  ELSE
    IF v_grant IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_REQUIRED: backfill_grant_reference is mandatory in backfill mode (fail-closed)';
    END IF;
    -- Plafonds structurels 0K. Le cap d'unités est contrôlé ICI, AVANT la
    -- boucle de validation de p_units : un payload massif accidentel est
    -- rejeté sans être parsé unité par unité.
    IF v_period_days > c_max_backfill_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_PERIOD_CAP: backfill window above the structural %-day cap (fail-closed)', c_max_backfill_period_days;
    END IF;
    IF jsonb_array_length(p_units) > c_max_backfill_units THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_UNITS_CAP: backfill deposit above the structural %-unit cap (fail-closed)', c_max_backfill_units;
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- p_units : validation + recalculs serveur (day_unit_id, agrégats domaine)
  -- ------------------------------------------------------------------
  v_n := jsonb_array_length(p_units);
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_unit := p_units -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_unit, c_unit_allowed, 'p_units[' || v_i || ']');

    -- accounting_date stricte, puis recalcul du day_unit_id depuis le contexte
    -- attempt (D-0H-1) : divergence bank/fingerprint/currency/date impossible.
    v_acc_raw := v_acc_raw || btrim(v_unit ->> 'accounting_date');
    v_acc_dates := v_acc_dates || public.daily_stmt_parse_date_strict(v_unit ->> 'accounting_date');
    PERFORM public.daily_stmt_assert_hex64(v_unit ->> 'day_unit_id', 'p_units[' || v_i || '].day_unit_id');
    IF (v_unit ->> 'day_unit_id')
       <> public.daily_stmt_day_unit_id(v_bank, v_fp, v_currency, v_acc_raw[v_i + 1]) THEN
      RAISE EXCEPTION 'DAILY_STMT_DAY_UNIT_ID_MISMATCH: p_units[%].day_unit_id does not match the attempt context (bank/fingerprint/currency/accounting_date divergence, fail-closed)', v_i;
    END IF;
    IF (v_unit ->> 'day_unit_id') = ANY (v_day_unit_ids) THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_DUPLICATE: duplicate day_unit_id in p_units (one unit per accounting day, fail-closed)';
    END IF;
    v_day_unit_ids := v_day_unit_ids || (v_unit ->> 'day_unit_id');

    v_content_hashes := v_content_hashes
      || public.daily_stmt_assert_hex64(v_unit ->> 'day_content_hash', 'p_units[' || v_i || '].day_content_hash');

    IF coalesce(v_unit ->> 'line_count', '') !~ '^[0-9]+$' OR (v_unit ->> 'line_count')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_LINE_COUNT_INVALID: p_units[%].line_count must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    v_line_counts := v_line_counts || (v_unit ->> 'line_count')::integer;

    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits');
    IF v_unit ->> 'day_total_debits' IS NULL OR v_unit ->> 'day_total_credits' IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_TOTALS_REQUIRED: p_units[%] day totals are required (fail-closed)', v_i;
    END IF;
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived');

    IF coalesce(v_unit ->> 'aggregates_status', '') NOT IN ('derived', 'unavailable')
       OR coalesce(v_unit ->> 'validation_status', '') NOT IN ('valid', 'needs_review') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%] aggregates/validation status outside domain (fail-closed)', v_i;
    END IF;
    -- Miroir TS : derived => soldes présents ; unavailable => rien de fabriqué.
    IF (v_unit ->> 'aggregates_status' = 'derived'
          AND (v_unit ->> 'opening_balance_derived' IS NULL OR v_unit ->> 'closing_balance_derived' IS NULL))
       OR (v_unit ->> 'aggregates_status' = 'unavailable'
          AND (v_unit ->> 'opening_balance_derived' IS NOT NULL OR v_unit ->> 'closing_balance_derived' IS NOT NULL)) THEN
      RAISE EXCEPTION 'DAILY_STMT_AGGREGATES_INCOHERENT: p_units[%] derived balances incoherent with aggregates_status (fail-closed)', v_i;
    END IF;

    IF coalesce(v_unit ->> 'requested_unit_status', '') NOT IN ('staged', 'provisional') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%].requested_unit_status must be staged or provisional (fail-closed)', v_i;
    END IF;
    v_req_status := v_req_status || (v_unit ->> 'requested_unit_status');
  END LOOP;

  -- Re-dérivation serveur de la règle journée non close (doctrine 9) : le
  -- statut déclaré doit être EXACTEMENT celui que la règle impose.
  SELECT max(d) INTO v_max_acc FROM unnest(v_acc_dates) d;
  FOR v_i IN 1 .. v_n LOOP
    IF v_ref_date IS NOT NULL THEN
      v_expected := CASE WHEN v_acc_dates[v_i] >= v_ref_date THEN 'provisional' ELSE 'staged' END;
    ELSIF v_bank = 'ORA' THEN
      -- ORA sans export_reference_date : dernier jour provisional (fail-closed).
      v_expected := CASE WHEN v_acc_dates[v_i] = v_max_acc THEN 'provisional' ELSE 'staged' END;
    ELSE
      v_expected := 'staged';
    END IF;
    IF v_req_status[v_i] <> v_expected THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_MISMATCH: p_units[%].requested_unit_status "%" contradicts the server-derived non-closed-day rule ("%") (fail-closed)', v_i - 1, v_req_status[v_i], v_expected;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- p_lines : validation par ligne (formats stricts + one_amount + jointure)
  -- ------------------------------------------------------------------
  FOR v_i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_line := p_lines -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_line, c_line_allowed, 'p_lines[' || v_i || ']');

    v_lidx := array_position(v_day_unit_ids, v_line ->> 'day_unit_id');
    IF v_lidx IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORPHAN: p_lines[%].day_unit_id does not reference any p_units entry (orphan line, fail-closed)', v_i;
    END IF;

    PERFORM public.daily_stmt_assert_hex64(v_line ->> 'daily_line_hash', 'p_lines[' || v_i || '].daily_line_hash');
    v_pair := v_lidx || '|' || (v_line ->> 'daily_line_hash');
    IF v_pair = ANY (v_seen_pairs) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_HASH_DUPLICATE: p_lines[%].daily_line_hash duplicated within its unit (ordinal bug upstream, fail-closed)', v_i;
    END IF;
    v_seen_pairs := v_seen_pairs || v_pair;

    IF coalesce(v_line ->> 'daily_occurrence_ordinal', '') !~ '^[0-9]+$'
       OR (v_line ->> 'daily_occurrence_ordinal')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORDINAL: p_lines[%].daily_occurrence_ordinal must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    IF coalesce(v_line ->> 'source_line_index', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SOURCE_INDEX: p_lines[%].source_line_index must be an integer >= 0 (fail-closed)', v_i;
    END IF;

    IF public.daily_stmt_parse_date_strict(v_line ->> 'accounting_date') <> v_acc_dates[v_lidx] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DATE_MISMATCH: p_lines[%].accounting_date does not equal its unit''s accounting_date (fail-closed)', v_i;
    END IF;
    IF v_line ->> 'value_date' IS NOT NULL THEN
      PERFORM public.daily_stmt_parse_date_strict(v_line ->> 'value_date');
    END IF;

    IF nullif(btrim(coalesce(v_line ->> 'description_sanitized', '')), '') IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DESCRIPTION_REQUIRED: p_lines[%].description_sanitized is required (fail-closed)', v_i;
    END IF;

    v_direction := v_line ->> 'direction';
    IF v_direction IS NULL OR v_direction NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DIRECTION: p_lines[%].direction must be debit or credit (fail-closed)', v_i;
    END IF;

    v_signed := public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount');
    IF v_signed IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SIGNED_REQUIRED: p_lines[%].signed_amount is required (fail-closed)', v_i;
    END IF;
    v_debit  := public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount');
    v_credit := public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount');
    PERFORM public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance');

    -- Miroir lines_staging_v2_one_amount (message stable pour les tests).
    IF NOT (
      (v_direction = 'debit'  AND v_debit  IS NOT NULL AND v_credit IS NULL
        AND v_signed < 0 AND abs(v_signed) = v_debit) OR
      (v_direction = 'credit' AND v_credit IS NOT NULL AND v_debit  IS NULL
        AND v_signed > 0 AND v_signed = v_credit)
    ) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ONE_AMOUNT: p_lines[%] violates the direction/amount/sign coherence (lines_staging_v2_one_amount mirror, fail-closed)', v_i;
    END IF;

    IF btrim(coalesce(v_line ->> 'currency', '')) <> v_currency THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_CURRENCY_MISMATCH: p_lines[%].currency does not equal p_attempt.currency (fail-closed)', v_i;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Croisements unité <-> lignes : comptes + day_content_hash recalculé.
  -- ------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    SELECT array_agg(l.value ->> 'daily_line_hash')
    INTO v_unit_hashes
    FROM jsonb_array_elements(p_lines) l
    WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i];

    IF coalesce(array_length(v_unit_hashes, 1), 0) <> v_line_counts[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_COUNT: p_units[%] declares line_count % but received % p_lines (fail-closed)',
        v_i - 1, v_line_counts[v_i], coalesce(array_length(v_unit_hashes, 1), 0);
    END IF;
    IF public.daily_stmt_day_content_hash(v_day_unit_ids[v_i], v_unit_hashes)
       <> v_content_hashes[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_MISMATCH: p_units[%].day_content_hash does not match the SQL recomputation over its own lines (fail-closed)', v_i - 1;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Écritures : attempt, puis arbitrage R1/R2/R3 par unité SOUS VERROU.
  -- ------------------------------------------------------------------
  INSERT INTO public.daily_statement_export_attempts (
    created_by, requested_mode, source_format, bank, currency,
    account_fingerprint, account_number_masked, source_file_name_redacted,
    raw_text_hash, export_period_start, export_period_end, statement_date,
    export_reference_date, parser_validation_status, errors_count,
    warnings_count, runtime_version, parser_version, ingestion_ready,
    bridge_guard_passed, period_days, backfill_grant_reference, units_total
  ) VALUES (
    v_actor, v_mode, v_source_format, v_bank, v_currency,
    v_fp, v_masked, v_file_name,
    v_rth, v_period_start, v_period_end, v_stmt_date,
    v_ref_date, v_parser_status, v_errors_count,
    v_warnings_count, nullif(btrim(coalesce(p_attempt ->> 'runtime_version', '')), ''),
    nullif(btrim(coalesce(p_attempt ->> 'parser_version', '')), ''), v_ingestion_ready,
    v_bridge, v_period_days, v_grant, v_n
  )
  RETURNING id INTO v_attempt_id;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
    'attempt_received', NULL, NULL,
    'daily statement export deposit received',
    jsonb_build_object('requested_mode', v_mode, 'units_total', v_n,
                       'period_days', v_period_days)
  );
  IF v_mode = 'backfill' THEN
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
      'backfill_deposit', NULL, NULL,
      'backfill deposit under explicit grant',
      jsonb_build_object('backfill_grant_reference', v_grant,
                         'period_days', v_period_days, 'units_total', v_n)
    );
  END IF;

  -- Verrous PAR JOURNÉE en ordre trié (anti-deadlock entre dépôts recouvrants).
  FOR v_lock_id IN SELECT h FROM unnest(v_day_unit_ids) h ORDER BY h COLLATE "C" LOOP
    PERFORM public.daily_stmt_acquire_day_lock(v_lock_id);
  END LOOP;

  FOR v_i IN 1 .. v_n LOOP
    v_active_id := NULL;
    v_keep_provisional := NULL;
    v_dup_of_provisional := false;
    v_d1_retire := false;
    v_d1_copy_exists := false;

    -- D1 (arbitrages CTO Q1 à Q4, variante R) : une unité demandée provisoire
    -- est comparée au canonical actif de sa journée, sans jamais devenir
    -- promouvable (D-0H-4 conservé : elle est retirée, jamais promue). Version
    -- complète (SAME_VERSION, égalité numérique, absences comprises), cohérence
    -- (relations 1 à 4) et lignes de la charge conformes (relation 6, règle
    -- commune) sont exigées toutes les trois.
    IF v_req_status[v_i] = 'provisional' THEN
      v_unit := p_units -> (v_i - 1);
      SELECT * INTO v_d1_canonical
      FROM public.daily_statement_units_canonical
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'ingested';
      IF FOUND THEN
        v_d1_agg     := v_unit ->> 'aggregates_status';
        v_d1_open    := public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived');
        v_d1_close   := public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived');
        v_d1_debits  := public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits');
        v_d1_credits := public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits');
        v_d1_same := public.daily_stmt_version_compare(v_content_hashes[v_i], v_d1_agg, v_d1_open, v_d1_close, v_d1_debits, v_d1_credits, v_d1_canonical.active_day_content_hash, v_d1_canonical.aggregates_status, v_d1_canonical.opening_balance_derived, v_d1_canonical.closing_balance_derived, v_d1_canonical.day_total_debits, v_d1_canonical.day_total_credits) = 'SAME_VERSION';
        v_d1_coherent := public.daily_stmt_version_coherent(v_d1_agg, v_d1_open, v_d1_close, v_d1_debits, v_d1_credits);
        v_d1_conform := public.daily_stmt_payload_lines_conform(p_lines, v_day_unit_ids[v_i], v_line_counts[v_i], v_d1_debits, v_d1_credits, v_d1_agg, v_d1_open, v_d1_close);
        v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);
      END IF;
    END IF;

    IF v_d1_retire THEN
      -- D1 : reçue provisoire puis retirée après insertion, sans comparaison
      -- R1-provisional ni balayage de redépôt : aucune provisoire divergente
      -- n'est écartée ici (Q4).
      v_final := 'provisional';
      v_active_id := v_d1_canonical.id;
      -- Réserve CTO R1 : une copie conforme de la même version, détenue par une
      -- livraison provisoire ou retirée du même fichier (même empreinte brute et
      -- même version d'analyse identifiée), dispense de stocker une nouvelle copie.
      SELECT EXISTS (
        SELECT 1
        FROM public.daily_statement_units_staging s
        JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
        WHERE s.day_unit_id = v_day_unit_ids[v_i]
          AND s.status IN ('provisional', 'superseded')
          AND a.raw_text_hash = v_rth
          AND nullif(btrim(a.parser_version), '') IS NOT NULL AND a.parser_version = nullif(btrim(coalesce(p_attempt ->> 'parser_version', '')), '')
          AND s.day_content_hash = v_content_hashes[v_i]
          AND s.aggregates_status = v_d1_agg
          AND s.opening_balance_derived IS NOT DISTINCT FROM v_d1_open
          AND s.closing_balance_derived IS NOT DISTINCT FROM v_d1_close
          AND s.day_total_debits = v_d1_debits
          AND s.day_total_credits = v_d1_credits
          AND public.daily_stmt_staging_lines_conform(s.id)
          AND NOT EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id GROUP BY l.source_line_index, l.daily_occurrence_ordinal HAVING count(*) > 1)
      ) INTO v_d1_copy_exists;
    ELSIF v_req_status[v_i] = 'provisional' THEN
      -- D-0H-4 conservé : jamais promouvable, hors arbitrage canonical.
      -- 0Z (D-0Z-1/D-0Z-2) : arbitrage R1-provisional contre la provisional
      -- VIVANTE la plus récente du même day_unit_id, sous le verrou journée.
      SELECT * INTO v_prev_provisional
      FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional'
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF FOUND AND v_prev_provisional.day_content_hash = v_content_hashes[v_i] THEN
        -- Redépôt strictement identique : duplicate contrôlé, AUCUNE ligne
        -- sensible re-stagée ; la provisional d'origine reste la version
        -- vivante unique de la journée.
        v_final := 'duplicate';
        v_dup_of_provisional := true;
        v_keep_provisional := v_prev_provisional.id;
      ELSE
        v_final := 'provisional';
      END IF;
    ELSE
      SELECT * INTO v_active
      FROM public.daily_statement_units_canonical
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'ingested';

      IF FOUND AND v_active.active_day_content_hash = v_content_hashes[v_i] THEN
        v_final := 'duplicate';                 -- R1 : journée identique.
        v_active_id := v_active.id;
      ELSIF FOUND THEN
        v_final := 'conflict';                  -- R2 : contenu divergent.
        v_active_id := v_active.id;
      ELSE
        -- R3 : un daily_line_hash encore ACTIF sous une AUTRE journée.
        SELECT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_lines) l
          JOIN public.daily_statement_lines_canonical lc
            ON lc.daily_line_hash = l.value ->> 'daily_line_hash' AND lc.is_active
          WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
            AND lc.day_unit_id <> v_day_unit_ids[v_i]
        ) INTO v_overlap;
        v_final := CASE WHEN v_overlap THEN 'needs_review' ELSE 'staged' END;
      END IF;
    END IF;

    -- 0Z (D-0Z-2/D-0Z-3/D-0Z-4) : balayage des provisional vivantes périmées
    -- du même day_unit_id, sous le même verrou journée. Journée non close :
    -- seule la version courante survit (la plus récente identique, ou la
    -- nouvelle unité insérée ci-dessous). Journée close (chemin 'staged',
    -- quel que soit le verdict R1/R2/R3) : plus aucune provisional vivante.
    -- Append-only préservé : UPDATE de statut + événement, jamais de DELETE.
    FOR v_swept IN
      SELECT id FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i]
        AND status = 'provisional'
        AND (v_keep_provisional IS NULL OR id <> v_keep_provisional)
        AND NOT v_d1_retire
      ORDER BY created_at, id
    LOOP
      UPDATE public.daily_statement_units_staging
        SET status = 'superseded'
        WHERE id = v_swept.id;
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_attempt_id, v_swept.id, NULL,
        v_day_unit_ids[v_i], v_rth,
        'status_changed', 'provisional', 'superseded',
        CASE WHEN v_req_status[v_i] = 'provisional'
             THEN 'stale provisional unit superseded by redeposit of the same non-closed day'
             ELSE 'stale provisional unit superseded: the day is now closed'
        END,
        jsonb_build_object(
          'reason_code', CASE WHEN v_req_status[v_i] = 'provisional'
                              THEN 'provisional_superseded_by_redeposit'
                              ELSE 'provisional_superseded_by_day_closure' END,
          'day_unit_id', v_day_unit_ids[v_i],
          'previous_status', 'provisional',
          'new_status', 'superseded')
      );
    END LOOP;

    v_unit := p_units -> (v_i - 1);
    INSERT INTO public.daily_statement_units_staging (
      attempt_id, day_unit_id, bank, account_fingerprint, currency,
      accounting_date, day_content_hash, line_count, day_total_debits,
      day_total_credits, opening_balance_derived, closing_balance_derived,
      aggregates_status, validation_status, status, created_by
    ) VALUES (
      v_attempt_id, v_day_unit_ids[v_i], v_bank, v_fp, v_currency,
      v_acc_dates[v_i], v_content_hashes[v_i], v_line_counts[v_i],
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived'),
      v_unit ->> 'aggregates_status', v_unit ->> 'validation_status',
      v_final, v_actor
    )
    RETURNING id INTO v_staging_unit_id;

    -- R1 duplicate (canonical OU provisional) : AUCUNE ligne stagée — le
    -- contenu identique vit déjà en canonical ou dans la provisional vivante
    -- (ne pas dupliquer des libellés sensibles). Tous les autres statuts
    -- conservent leurs lignes (conflict = matière du futur supersede).
    -- Exception H1 : un doublon R1 de l'unité canonique active dont la version
    -- financière diffère, dérivée et cohérente, conserve ses lignes (matière de
    -- la correction des seuls soldes), sauf si un autre doublon de même version
    -- en détient déjà une copie conforme. Jamais pour un doublon R1-provisional.
    v_keep_lines := false;
    IF v_final = 'duplicate' AND NOT v_dup_of_provisional AND v_active_id IS NOT NULL THEN
      SELECT * INTO v_new_unit FROM public.daily_statement_units_staging WHERE id = v_staging_unit_id;
      v_keep_lines := public.daily_stmt_h1_keep_lines(
        v_new_unit.day_unit_id, v_new_unit.day_content_hash, v_new_unit.aggregates_status,
        v_new_unit.opening_balance_derived, v_new_unit.closing_balance_derived,
        v_new_unit.day_total_debits, v_new_unit.day_total_credits, v_active_id, v_new_unit.id);
    END IF;
    -- D1 : la livraison retirée garde ses lignes, sauf copie conforme du même
    -- fichier déjà détenue (réserve CTO R1).
    IF (v_final <> 'duplicate' OR v_keep_lines) AND NOT v_d1_copy_exists THEN
      FOR v_line IN
        SELECT l.value FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(value, ord)
        WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
        ORDER BY l.ord
      LOOP
        INSERT INTO public.daily_statement_lines_staging (
          staging_unit_id, attempt_id, day_unit_id, daily_line_hash,
          daily_occurrence_ordinal, source_line_index, accounting_date,
          value_date, description_sanitized, debit_amount, credit_amount,
          signed_amount, running_balance, direction, currency
        ) VALUES (
          v_staging_unit_id, v_attempt_id, v_day_unit_ids[v_i],
          v_line ->> 'daily_line_hash',
          (v_line ->> 'daily_occurrence_ordinal')::integer,
          (v_line ->> 'source_line_index')::integer,
          v_acc_dates[v_i],
          CASE WHEN v_line ->> 'value_date' IS NULL THEN NULL
               ELSE public.daily_stmt_parse_date_strict(v_line ->> 'value_date') END,
          v_line ->> 'description_sanitized',
          public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance'),
          v_line ->> 'direction', btrim(v_line ->> 'currency')
        );
      END LOOP;
    END IF;

    v_unit_event_type := CASE v_final
      WHEN 'staged'       THEN 'unit_staged'
      WHEN 'provisional'  THEN 'unit_provisional_held'
      WHEN 'duplicate'    THEN 'unit_duplicate'
      WHEN 'conflict'     THEN 'unit_conflict'
      ELSE 'unit_needs_review'
    END;
    v_unit_event_message := CASE
      WHEN v_final = 'duplicate' AND v_dup_of_provisional
        THEN 'exact duplicate of the live provisional day unit (R1-provisional, 0Z)'
      WHEN v_final = 'staged'      THEN 'daily unit staged'
      WHEN v_final = 'provisional' THEN 'non-closed day held provisional (never promotable)'
      WHEN v_final = 'duplicate'   THEN 'exact duplicate of the active canonical day (R1)'
      WHEN v_final = 'conflict'    THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
      ELSE 'active daily_line_hash overlap with another day unit (R3)'
    END;

    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, v_staging_unit_id, v_active_id,
      v_day_unit_ids[v_i], v_rth,
      v_unit_event_type,
      NULL, v_final,
      v_unit_event_message,
      jsonb_build_object('day_unit_id', v_day_unit_ids[v_i],
                         'day_content_hash', v_content_hashes[v_i],
                         'line_count', v_line_counts[v_i])
      || CASE WHEN v_dup_of_provisional
              THEN jsonb_build_object('reason_code', 'provisional_redeposit_duplicate')
              WHEN v_keep_lines
              THEN jsonb_build_object('reason_code', 'duplicate_financial_version_differs')
              ELSE '{}'::jsonb END
    );

    -- D1 : retrait de la livraison reçue (audit append-only), puis des seules
    -- provisoires vivantes de même version complète, cohérentes et aux lignes
    -- stockées conformes. Postcondition conditionnelle (Q4), vérifiée par
    -- daily_stmt_retire_same_version_provisionals : les provisoires vivantes
    -- restantes sont exactement les divergentes d'avant.
    IF v_d1_retire THEN
      UPDATE public.daily_statement_units_staging
        SET status = 'superseded'
        WHERE id = v_staging_unit_id AND status = 'provisional';
      GET DIAGNOSTICS v_d1_rows = ROW_COUNT;
      IF v_d1_rows <> 1 THEN
        RAISE EXCEPTION 'DAILY_STMT_D1_POSTCONDITION: the late delivery must be retired exactly once (rollback)';
      END IF;
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_attempt_id, v_staging_unit_id, v_active_id,
        v_day_unit_ids[v_i], v_rth,
        'status_changed', 'provisional', 'superseded',
        'late provisional delivery retired: same full version as the active canonical day (D1)',
        jsonb_build_object(
          'reason_code', 'late_provisional_same_version_superseded',
          'day_unit_id', v_day_unit_ids[v_i],
          'previous_status', 'provisional',
          'new_status', 'superseded',
          'resolution', CASE WHEN v_d1_copy_exists THEN 'retired_at_deposit_lines_not_restaged'
                             ELSE 'retired_at_deposit_lines_stored' END)
      );
      v_final := 'superseded';
      PERFORM public.daily_stmt_retire_same_version_provisionals(v_day_unit_ids[v_i], v_active_id, v_actor, v_attempt_id, v_rth, v_staging_unit_id);
    END IF;

    -- 0Z (D-0Z-5) postcondition : nombre de provisional vivantes déterministe
    -- par journée après traitement (toute violation => rollback intégral).
    SELECT count(*) INTO v_live_provisional
    FROM public.daily_statement_units_staging
    WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional';
    IF v_req_status[v_i] = 'provisional' AND NOT v_d1_retire AND v_live_provisional <> 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: exactly one live provisional unit expected for a non-closed day (rollback)';
    ELSIF v_req_status[v_i] <> 'provisional' AND v_live_provisional <> 0 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: no live provisional unit may survive a closed-day deposit (rollback)';
    END IF;

    v_result_units := v_result_units || jsonb_build_object(
      'day_unit_id', v_day_unit_ids[v_i],
      'unit_status', v_final,
      'staging_unit_id', v_staging_unit_id,
      'active_canonical_unit_id', v_active_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'requested_mode', v_mode,
    'units', v_result_units
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Activation : cœur de promotion (source vivante 20260708130000)
-- --------------------------------------------------------------------------
-- Redéfinition à signature et attributs identiques ; seul s'ajoute, après la
-- postcondition existante, le retrait des provisoires de la version activée.
-- Appelants inchangés, tous sous le verrou de journée : promotion unitaire et
-- groupée (via daily_stmt_promote_scoped_core_0w), remplacement
-- (daily_stmt_supersede_scoped_core_0w), correction des seuls soldes.
CREATE OR REPLACE FUNCTION public.daily_stmt_promote_unit_core(
  p_staging_unit_id  uuid,
  p_new_canonical_id uuid,
  p_actor            uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit         public.daily_statement_units_staging%ROWTYPE;
  v_inserted     integer;
  v_active_count integer;
BEGIN
  SELECT * INTO v_unit
  FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_STAGING_NOT_FOUND (fail-closed)';
  END IF;
  IF v_unit.status NOT IN ('staged', 'conflict') THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_STAGING_STATE: staging unit not promotable (fail-closed)';
  END IF;

  INSERT INTO public.daily_statement_units_canonical (
    id, promoted_from_staging_unit_id, day_unit_id,
    bank, account_fingerprint, currency, accounting_date,
    active_day_content_hash, line_count, day_total_debits, day_total_credits,
    opening_balance_derived, closing_balance_derived,
    aggregates_status, validation_status, status, ingested_by
  ) VALUES (
    p_new_canonical_id, v_unit.id, v_unit.day_unit_id,
    v_unit.bank, v_unit.account_fingerprint, v_unit.currency, v_unit.accounting_date,
    v_unit.day_content_hash, v_unit.line_count, v_unit.day_total_debits, v_unit.day_total_credits,
    v_unit.opening_balance_derived, v_unit.closing_balance_derived,
    v_unit.aggregates_status, v_unit.validation_status, 'ingested', p_actor
  );

  INSERT INTO public.daily_statement_lines_canonical (
    canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal,
    source_line_index, is_active, accounting_date, value_date,
    description_sanitized, debit_amount, credit_amount, signed_amount,
    running_balance, direction, currency
  )
  SELECT
    p_new_canonical_id, ls.day_unit_id, ls.daily_line_hash, ls.daily_occurrence_ordinal,
    ls.source_line_index, true, ls.accounting_date, ls.value_date,
    ls.description_sanitized, ls.debit_amount, ls.credit_amount, ls.signed_amount,
    ls.running_balance, ls.direction, ls.currency
  FROM public.daily_statement_lines_staging ls
  WHERE ls.staging_unit_id = v_unit.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_unit.line_count THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_LINE_COUNT: staged/promoted mismatch (fail-closed)';
  END IF;

  UPDATE public.daily_statement_units_staging
    SET status = 'promoted'
    WHERE id = v_unit.id;

  PERFORM public.daily_stmt_append_audit_event(
    p_actor, v_unit.attempt_id, v_unit.id, p_new_canonical_id,
    v_unit.day_unit_id, NULL,
    'unit_promoted', v_unit.status, 'promoted',
    'daily unit promoted to canonical',
    jsonb_build_object('day_unit_id', v_unit.day_unit_id,
                       'day_content_hash', v_unit.day_content_hash,
                       'line_count', v_unit.line_count)
  );

  -- Postcondition : exactement UNE unité canonical active pour ce day_unit_id.
  SELECT count(*) INTO v_active_count
  FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_unit.day_unit_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;

  -- D1 (arbitrage CTO Q5) : toute activation d'une version retire les seules
  -- provisoires vivantes de la journée de même version complète, cohérentes et
  -- aux lignes stockées conformes ; les divergentes restent vivantes
  -- (postcondition vérifiée par la fonction appelée, sous le verrou de journée
  -- pris par l'appelant).
  PERFORM public.daily_stmt_retire_same_version_provisionals(v_unit.day_unit_id, p_new_canonical_id, p_actor, v_unit.attempt_id, NULL, NULL);

  RETURN p_new_canonical_id;
END;
$$;

COMMENT ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb) IS
  'Cœur interne du dépôt Daily v2 (0H, renommé par 0U, cycle de vie provisional fermé par 0Z, exception H1 du Lot 1 opérationnel, retrait D1 d''une livraison provisoire tardive de version identique au canonical actif). Jamais exposé : seule l''enveloppe pre_ingest_daily_statement_units l''appelle.';
COMMENT ON FUNCTION public.daily_stmt_payload_lines_conform(jsonb, text, integer, numeric, numeric, text, numeric, numeric) IS
  'D1 : relation 6 (règle commune daily_stmt_line_facts_conform) appliquée aux lignes de la charge d''une journée, avant stockage. Interne.';
COMMENT ON FUNCTION public.daily_stmt_provisional_same_version(uuid, uuid) IS
  'D1 : provisoire vivante, ou doublon R1-provisional à copie conforme du même fichier et de même version d''analyse, de même version complète que le canonical actif désigné, cohérente et aux lignes conformes. Interne.';
COMMENT ON FUNCTION public.daily_stmt_retire_same_version_provisionals(text, uuid, uuid, uuid, text, uuid) IS
  'D1 : retrait audité des seules provisoires vivantes et des seuls doublons du cycle provisoire satisfaisant le prédicat D1, au dépôt et à l''activation, sous verrou de journée ; les divergentes restent vivantes. Interne.';

-- --------------------------------------------------------------------------
-- 6. Privilèges : aucune fonction exécutable par l'API
-- --------------------------------------------------------------------------
-- CREATE OR REPLACE conserve les droits des deux fonctions redéfinies ; les
-- révocations sont réappliquées en ceinture, comme 0Z et le Lot 1 opérationnel.
REVOKE ALL ON FUNCTION public.daily_stmt_payload_lines_conform(jsonb, text, integer, numeric, numeric, text, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_provisional_same_version(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_retire_same_version_provisionals(text, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_promote_unit_core(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
