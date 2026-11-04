-- C7 (R6) : RÉFÉRENCE DE TEST FIGÉE. Copie exacte, non optimisée, de
-- treasury_private.balances_snapshot telle que validée avant toute optimisation
-- (73 mutants tués). Le test différentiel 82_differential.sql exige que la version
-- optimisée rende exactement la même réponse, instant de lecture excepté.
-- Ne jamais modifier ce fichier pour suivre une optimisation ; seules les CORRECTIONS
-- de règle y sont reportées (F2 de la revue indépendante : dernière journée livrée
-- absente = source non justifiée).
CREATE SCHEMA IF NOT EXISTS tr_ref;
CREATE OR REPLACE FUNCTION tr_ref.balances_snapshot(p_as_of date, p_today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
WITH
params AS (
  SELECT p_as_of AS d, p_today AS t, statement_timestamp() AS read_at,
         'attestation sur pièce archivée, contenu non vérifié automatiquement'::text AS piece_mention
),
qual AS (
  SELECT DISTINCT ON (q.bank, q.source_format) q.bank, q.source_format, q.status, q.evidence_ref, q.decided_at
  FROM treasury_private.bank_format_qualifications q
  ORDER BY q.bank, q.source_format, q.seq DESC
),
inv AS (
  SELECT e.id AS expected_id, e.bank, e.currency, e.registry_account_id AS rid, e.safe_alias,
         r.safe_alias AS registry_alias, r.status AS registry_status, r.bank AS registry_bank,
         r.currency AS registry_currency
  FROM treasury_private.expected_accounts e
  LEFT JOIN public.daily_statement_account_registry r ON r.id = e.registry_account_id
  WHERE e.status = 'ACTIVE'
),
acc AS (
  SELECT DISTINCT inv.rid FROM inv WHERE inv.rid IS NOT NULL
),
-- Attestations actives par tentative (C2, C3) : motifs résolus.
att_res AS (
  SELECT x.attempt_id,
         array_agg(DISTINCT CASE x.attestation_type WHEN 'ACCOUNT_IDENTITY' THEN 'ACCOUNT_IDENTITY_NOT_CORROBORATED'
                                                    ELSE 'TRUSTED_CURRENCY_UNCORROBORATED' END) AS resolved
  FROM public.daily_statement_attempt_attestations x
  WHERE x.action = 'ATTEST'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = x.id)
  GROUP BY x.attempt_id
),
-- Tentatives des comptes lus : version exacte listée (§ 4.2), motifs résiduels,
-- statut du fichier admis (exception devise BRIDGE seulement).
att AS (
  SELECT a.id AS export_id, a.account_registry_id AS rid, a.bank, a.source_format, a.parser_version,
         a.created_at AS export_ingested_at, a.export_period_start, a.export_period_end, a.raw_text_hash,
         a.parser_validation_status, coalesce(a.review_reason_codes, ARRAY[]::text[]) AS codes,
         coalesce(ar.resolved, ARRAY[]::text[]) AS resolved,
         (EXISTS (SELECT 1 FROM treasury_private.supported_formats f
                  WHERE f.bank = a.bank AND f.source_format = a.source_format AND a.parser_version IS NOT NULL
                    AND left(a.parser_version, char_length(f.parser_version_prefix)) = f.parser_version_prefix)
          AND pv.parser_version IS NOT NULL) AS supported,
         coalesce(pv.currency_cause, false) AS currency_cause
  FROM public.daily_statement_export_attempts a
  JOIN acc ON acc.rid = a.account_registry_id
  LEFT JOIN att_res ar ON ar.attempt_id = a.id
  LEFT JOIN treasury_private.parser_versions pv
    ON pv.bank = a.bank AND pv.source_format = a.source_format AND pv.parser_version = a.parser_version
),
att2 AS (
  SELECT x.*,
         ARRAY(SELECT c FROM unnest(x.codes) c WHERE NOT (c = ANY (x.resolved))) AS residual,
         (x.parser_validation_status = 'valid'
          OR (x.parser_validation_status = 'needs_review' AND x.currency_cause
              AND 'TRUSTED_CURRENCY_UNCORROBORATED' = ANY (x.codes)
              AND 'TRUSTED_CURRENCY_UNCORROBORATED' = ANY (x.resolved)
              AND NOT (x.codes && ARRAY['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING']))) AS file_status_ok
  FROM att x
),
-- Toutes les livraisons des comptes lus, avec leur version financière (C4 bis).
dlv AS (
  SELECT s.id AS staging_id, s.attempt_id AS export_id, s.account_registry_id AS rid, s.accounting_date AS day,
         s.day_unit_id, s.status, s.validation_status, s.aggregates_status, s.day_content_hash AS hash,
         s.opening_balance_derived AS opening, s.closing_balance_derived AS closing,
         s.day_total_debits AS debits, s.day_total_credits AS credits,
         public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
           s.closing_balance_derived, s.day_total_debits, s.day_total_credits) AS vkey,
         a.raw_text_hash, a.export_ingested_at, lo.lines_ok, lo.has_lines,
         -- Livraison propre (§ 4.1) : version listée, statut du fichier admis,
         -- motifs résiduels vides pour le fichier et la journée, validation
         -- admise, relations financières satisfaites (réserve CTO 4.1) et
         -- lignes stockées conformes (P1 de la contre-revue CTO, règle portée
         -- telle quelle : fonctions scalaires, sans optimisation).
         (a.supported AND a.file_status_ok AND cardinality(a.residual) = 0 AND lo.lines_ok
          AND coalesce(s.review_reason_codes, ARRAY[]::text[]) <@ a.resolved
          AND (s.validation_status = 'valid'
               OR (s.validation_status = 'needs_review' AND cardinality(s.review_reason_codes) > 0
                   AND s.aggregates_status = 'derived'))
          AND public.daily_stmt_version_coherent(s.aggregates_status, s.opening_balance_derived,
                s.closing_balance_derived, s.day_total_debits, s.day_total_credits)) AS clean
  FROM public.daily_statement_units_staging s
  JOIN att2 a ON a.export_id = s.attempt_id
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM public.daily_statement_units_canonical c WHERE c.promoted_from_staging_unit_id = s.id)
               THEN NOT EXISTS (SELECT 1 FROM public.daily_statement_units_canonical c
                                WHERE c.promoted_from_staging_unit_id = s.id
                                  AND NOT public.daily_stmt_canonical_lines_conform(c.id))
             WHEN EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id)
               THEN public.daily_stmt_staging_lines_conform(s.id)
             ELSE EXISTS (SELECT 1 FROM public.daily_statement_units_canonical o
                          WHERE o.day_unit_id = s.day_unit_id AND o.status = 'ingested'
                            AND public.daily_stmt_version_key(o.active_day_content_hash, o.aggregates_status,
                                  o.opening_balance_derived, o.closing_balance_derived, o.day_total_debits,
                                  o.day_total_credits)
                              = public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status,
                                  s.opening_balance_derived, s.closing_balance_derived, s.day_total_debits,
                                  s.day_total_credits)
                            AND public.daily_stmt_canonical_lines_conform(o.id))
           END AS lines_ok,
           (EXISTS (SELECT 1 FROM public.daily_statement_units_canonical c WHERE c.promoted_from_staging_unit_id = s.id)
            OR EXISTS (SELECT 1 FROM public.daily_statement_lines_staging l WHERE l.staging_unit_id = s.id)) AS has_lines) lo
),
units AS (
  SELECT u.id AS unit_id, u.account_registry_id AS rid, u.accounting_date AS day,
         u.opening_balance_derived AS opening, u.closing_balance_derived AS closing,
         u.aggregates_status, u.currency AS unit_currency, u.ingested_at, u.day_unit_id, u.active_day_content_hash,
         u.day_total_debits, u.day_total_credits, u.promoted_from_staging_unit_id AS promoted_staging_id,
         d.vkey, d.clean AS promoted_clean,
         (public.daily_stmt_version_coherent(u.aggregates_status, u.opening_balance_derived,
            u.closing_balance_derived, u.day_total_debits, u.day_total_credits)
          AND public.daily_stmt_canonical_lines_conform(u.id)) AS coherent,
         public.daily_stmt_canonical_lines_conform(u.id) AS lines_conform,
         a.export_id, a.export_ingested_at, a.source_format, a.supported AS format_supported,
         (SELECT p.id FROM public.daily_statement_units_canonical p WHERE p.superseded_by = u.id LIMIT 1) AS prev_unit_id
  FROM public.daily_statement_units_canonical u
  JOIN acc ON acc.rid = u.account_registry_id
  JOIN dlv d ON d.staging_id = u.promoted_from_staging_unit_id
  JOIN att2 a ON a.export_id = d.export_id
  WHERE u.status = 'ingested'
),
-- Unité propre : sa livraison promue, ou un doublon propre de MÊME version
-- (mouvements et version financière complète), est propre (point D).
units2 AS (
  SELECT u.*,
         (u.promoted_clean OR EXISTS (SELECT 1 FROM dlv d2
                                      WHERE d2.day_unit_id = u.day_unit_id AND d2.status = 'duplicate'
                                        AND d2.vkey = u.vkey AND d2.clean)) AS unit_clean
  FROM units u
),
-- Fichiers dignes de preuve : version listée, statut admis, motifs résiduels
-- vides, et chaque livraison propre portant la version retenue de sa journée
-- (livraison promue, doublon ou écartée de même version), ou provisoire et
-- remplacée par son cycle de vie. Seuls ils prouvent la clôture d'une journée
-- ou, si leur période est déclarée, l'absence de mouvement.
trusted_exports AS (
  SELECT a.export_id, a.rid, a.bank, a.source_format, a.export_ingested_at,
         a.export_period_start, a.export_period_end, eu.last_line_day
  FROM att2 a
  JOIN LATERAL (
    SELECT count(*) FILTER (WHERE NOT d.clean OR NOT (
             d.status IN ('provisional', 'superseded')
             OR (d.status IN ('promoted', 'duplicate', 'rejected')
                 AND EXISTS (SELECT 1 FROM units2 u WHERE u.day_unit_id = d.day_unit_id AND u.vkey = d.vkey)))) AS bad_n,
           max(d.day) FILTER (WHERE d.day <= (a.export_ingested_at AT TIME ZONE 'Africa/Dakar')::date) AS last_line_day
    FROM dlv d WHERE d.export_id = a.export_id
  ) eu ON true
  WHERE a.supported AND a.file_status_ok AND cardinality(a.residual) = 0 AND eu.bad_n = 0
),
-- Journée close, preuve (a) : même VERSION (mouvements et version financière),
-- livrée par un fichier digne de preuve qui porte une ligne datée APRÈS la
-- journée, au plus tard le jour de son dépôt. L'unité doit être cohérente.
closure_proofs AS (
  SELECT u.unit_id, te.export_id, s2.status AS delivery, te.export_ingested_at, max(s3.day) AS later_line_day
  FROM units2 u
  JOIN dlv s2 ON s2.day_unit_id = u.day_unit_id AND s2.vkey = u.vkey AND s2.status IN ('promoted', 'duplicate')
  JOIN trusted_exports te ON te.export_id = s2.export_id
  JOIN dlv s3 ON s3.export_id = s2.export_id AND s3.day > u.day
   AND s3.day <= (te.export_ingested_at AT TIME ZONE 'Africa/Dakar')::date
  WHERE u.coherent
  GROUP BY u.unit_id, te.export_id, s2.status, te.export_ingested_at
),
-- Sources d'une version : empreinte brute dans le contexte du compte et de la
-- journée ; première apparition = premier dépôt (un redépôt identique ne la
-- change pas).
src_first AS (
  SELECT d.day_unit_id, d.vkey, d.raw_text_hash, d.rid, min(d.export_ingested_at) AS first_seen_at
  FROM dlv d WHERE d.status NOT IN ('provisional', 'superseded')
  GROUP BY d.day_unit_id, d.vkey, d.raw_text_hash, d.rid
),
-- Réfutations explicites actives, et leur effectivité revérifiée à la lecture :
-- version retenue inchangée, preuve toujours valable, chaque source couverte
-- toujours justifiée avec sa première apparition recalculée.
ref_eff0 AS (
  SELECT r.id, r.account_registry_id AS rid, r.accounting_date AS day, r.day_unit_id, r.refuted_version_key,
         r.proof_kind, r.proof_bound_day, r.created_at, r.retained_version_key,
         EXISTS (SELECT 1 FROM units2 u WHERE u.unit_id = r.retained_canonical_unit_id) AS retained_present,
         EXISTS (SELECT 1 FROM units2 u WHERE u.unit_id = r.retained_canonical_unit_id AND u.coherent) AS retained_ok,
         (r.proof_kind = 'BANK_PIECE'
          OR EXISTS (SELECT 1 FROM dlv p JOIN trusted_exports te ON te.export_id = p.export_id
                     WHERE p.staging_id = r.proof_staging_unit_id AND p.status IN ('promoted', 'duplicate')
                       AND p.vkey = r.retained_version_key)) AS proof_ok,
         NOT EXISTS (
            SELECT 1 FROM public.daily_statement_refutation_sources rs
            LEFT JOIN src_first sf ON sf.day_unit_id = r.day_unit_id AND sf.vkey = r.refuted_version_key
             AND sf.raw_text_hash = rs.raw_text_hash AND sf.rid = rs.account_registry_id
            WHERE rs.refutation_id = r.id
              AND NOT (r.proof_bound_day > (coalesce(sf.first_seen_at, rs.first_seen_at) AT TIME ZONE 'Africa/Dakar')::date))
           AS sources_ok
  FROM public.daily_statement_version_refutations r
  JOIN acc ON acc.rid = r.account_registry_id
  WHERE r.action = 'REFUTE'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations x WHERE x.revokes_id = r.id)
),
ref_eff AS (
  SELECT x.*, (x.retained_ok AND x.proof_ok AND x.sources_ok) AS effective FROM ref_eff0 x
),
-- Réfutation automatique, évaluée à la lecture : la livraison adoptée par un
-- remplacement (supersede ou correction des seuls soldes), issue d'un fichier
-- digne de preuve, réfute la version remplacée si elle justifie CHACUNE de ses
-- sources ; sinon aucune.
auto_eff AS (
  SELECT u.unit_id, u.day_unit_id, u.rid, u.day,
         public.daily_stmt_version_key(p.active_day_content_hash, p.aggregates_status, p.opening_balance_derived,
           p.closing_balance_derived, p.day_total_debits, p.day_total_credits) AS refuted_vkey,
         u.coherent AND te.export_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM src_first sf
           WHERE sf.day_unit_id = u.day_unit_id
             AND sf.vkey = public.daily_stmt_version_key(p.active_day_content_hash, p.aggregates_status,
                   p.opening_balance_derived, p.closing_balance_derived, p.day_total_debits, p.day_total_credits)
             AND NOT coalesce(te.last_line_day > (sf.first_seen_at AT TIME ZONE 'Africa/Dakar')::date, false)) AS effective,
         te.last_line_day
  FROM units2 u
  JOIN public.daily_statement_units_canonical p ON p.id = u.prev_unit_id
  LEFT JOIN trusted_exports te ON te.export_id = u.export_id
),
-- Comparaison de chaque autre livraison non provisoire d'une journée retenue
-- avec la version retenue (trois issues), et couverture par une réfutation
-- effective (source par source pour une réfutation explicite).
cmp AS (
  SELECT d.*, u.unit_id, u.active_day_content_hash AS r_hash, u.day_total_debits AS r_debits,
         u.day_total_credits AS r_credits,
         public.daily_stmt_version_compare(d.hash, d.aggregates_status, d.opening, d.closing, d.debits, d.credits,
           u.active_day_content_hash, u.aggregates_status, u.opening, u.closing, u.day_total_debits,
           u.day_total_credits) AS outcome,
         -- Côté dont les faits manquent ou sont incohérents (données insuffisantes).
         CASE WHEN NOT public.daily_stmt_version_coherent(u.aggregates_status, u.opening, u.closing, u.day_total_debits,
                         u.day_total_credits) OR u.aggregates_status <> 'derived'
              THEN CASE WHEN NOT public.daily_stmt_version_coherent(d.aggregates_status, d.opening, d.closing, d.debits,
                                   d.credits) OR d.aggregates_status <> 'derived' THEN 'BOTH' ELSE 'RETAINED' END
              WHEN NOT public.daily_stmt_version_coherent(d.aggregates_status, d.opening, d.closing, d.debits, d.credits)
                   OR d.aggregates_status <> 'derived' THEN 'OTHER'
              ELSE 'BOTH' END AS insufficient_side,
         (EXISTS (SELECT 1 FROM ref_eff r
                  JOIN public.daily_statement_refutation_sources rs ON rs.refutation_id = r.id
                  WHERE r.effective AND r.day_unit_id = d.day_unit_id AND r.refuted_version_key = d.vkey
                    AND rs.raw_text_hash = d.raw_text_hash AND rs.account_registry_id = d.rid)
          OR EXISTS (SELECT 1 FROM auto_eff ae
                     WHERE ae.effective AND ae.day_unit_id = d.day_unit_id AND ae.refuted_vkey = d.vkey)) AS covered,
         (SELECT r.proof_kind FROM ref_eff r
           WHERE r.effective AND r.day_unit_id = d.day_unit_id AND r.refuted_version_key = d.vkey LIMIT 1) AS ref_kind,
         (SELECT r.proof_bound_day FROM ref_eff r
           WHERE r.effective AND r.day_unit_id = d.day_unit_id AND r.refuted_version_key = d.vkey LIMIT 1) AS ref_day
  FROM dlv d
  JOIN units2 u ON u.day_unit_id = d.day_unit_id
  WHERE d.status NOT IN ('provisional', 'superseded') AND d.staging_id <> u.promoted_staging_id
),
day_cmp AS (
  SELECT c.rid, c.day,
         bool_or(c.outcome = 'CONTRADICTION' AND NOT c.covered) AS conflict,
         bool_or(c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered) AS insufficient,
         CASE WHEN bool_or(c.outcome = 'INSUFFICIENT_INCOHERENT' AND NOT c.covered) THEN 'VERSION_FACTS_INCOHERENT'
              WHEN bool_or(c.outcome = 'INSUFFICIENT_UNAVAILABLE' AND NOT c.covered) THEN 'AGGREGATES_UNAVAILABLE'
         END AS insufficient_cause,
         CASE WHEN bool_or(c.insufficient_side IN ('RETAINED', 'BOTH')) FILTER (WHERE c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered)
                   AND bool_or(c.insufficient_side IN ('OTHER', 'BOTH')) FILTER (WHERE c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered)
                THEN 'BOTH'
              WHEN bool_or(c.insufficient_side = 'RETAINED') FILTER (WHERE c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered)
                THEN 'RETAINED'
              WHEN bool_or(c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered) THEN 'OTHER'
         END AS insufficient_side,
         bool_or(c.status IN ('staged', 'needs_review', 'promotion_failed') AND NOT c.covered) AS pending,
         count(DISTINCT (c.raw_text_hash, c.vkey)) FILTER (WHERE c.outcome = 'CONTRADICTION' AND NOT c.covered) AS conflict_sources,
         count(DISTINCT (c.raw_text_hash, c.vkey)) FILTER (WHERE c.outcome LIKE 'INSUFFICIENT%' AND NOT c.covered) AS insufficient_sources,
         count(*) FILTER (WHERE c.outcome = 'AGREEMENT_BREAKDOWN' AND NOT c.covered) AS breakdown_n,
         count(*) FILTER (WHERE c.outcome = 'AGREEMENT_DETAIL' AND NOT c.covered) AS detail_n,
         min(c.debits::text || '/' || c.credits::text) FILTER (WHERE c.outcome = 'AGREEMENT_BREAKDOWN' AND NOT c.covered)
           AS breakdown_other_totals,
         min(c.r_debits::text || '/' || c.r_credits::text) AS retained_totals
  FROM cmp c
  GROUP BY c.rid, c.day
),
-- Versions réfutées effectivement : nature de la preuve, sources, redépôts,
-- mouvements non résolus (une réfutation prouve des soldes, pas des mouvements).
refuted_info AS (
  SELECT c.rid, c.day, c.vkey,
         coalesce(max(c.ref_kind), 'FRESH_DELIVERY') AS nature,
         bool_and(c.ref_kind IS NULL) AS automatic,
         max(c.ref_day) AS proof_day,
         count(*) AS deliveries,
         count(DISTINCT c.raw_text_hash) AS sources,
         count(*) - count(DISTINCT c.raw_text_hash) AS redeposits,
         bool_or(c.hash <> c.r_hash) AS movements_unresolved
  FROM cmp c WHERE c.covered
  GROUP BY c.rid, c.day, c.vkey
),
ref_suspended AS (
  SELECT DISTINCT r.rid, r.day FROM ref_eff r WHERE NOT r.effective
),
-- Statut courant de chaque réfutation enregistrée (P2 de la contre-revue CTO),
-- calculé ici seulement : EFFECTIVE, PARTIAL (une source de la version réfutée
-- n'est pas couverte : nouvelle preuve nécessaire) ou SUSPENDED, avec ses causes.
ref_status AS (
  SELECT r.id, r.rid, r.day, r.proof_kind,
         CASE WHEN NOT r.effective THEN 'SUSPENDED'
              WHEN coalesce(un.uncovered_n, 0) > 0 THEN 'PARTIAL'
              ELSE 'EFFECTIVE' END AS state,
         array_remove(ARRAY[
           CASE WHEN NOT r.retained_present THEN 'RETAINED_VERSION_CHANGED' END,
           CASE WHEN r.retained_present AND NOT r.retained_ok THEN 'RETAINED_VERSION_UNUSABLE' END,
           CASE WHEN NOT r.proof_ok THEN 'PROOF_NO_LONGER_VALID' END,
           CASE WHEN NOT r.sources_ok THEN 'SOURCE_NOT_JUSTIFIED' END,
           CASE WHEN coalesce(un.uncovered_n, 0) > 0 THEN 'NEW_SOURCE_UNCOVERED' END], NULL) AS causes,
         coalesce(un.uncovered_n, 0) AS uncovered_sources
  FROM ref_eff r
  LEFT JOIN (
    SELECT r2.id, count(DISTINCT c.raw_text_hash) AS uncovered_n
    FROM ref_eff r2
    JOIN cmp c ON c.day_unit_id = r2.day_unit_id AND c.vkey = r2.refuted_version_key
    WHERE NOT c.covered
      AND NOT EXISTS (SELECT 1 FROM public.daily_statement_refutation_sources rs
                      WHERE rs.refutation_id = r2.id AND rs.raw_text_hash = c.raw_text_hash
                        AND rs.account_registry_id = c.rid)
    GROUP BY r2.id
  ) un ON un.id = r.id
),
-- Indicateurs de journée, toutes livraisons confondues.
day_flags AS (
  SELECT d.rid, d.day,
         bool_or(d.status = 'provisional') AS has_provisional,
         bool_or(d.status IN ('staged', 'needs_review', 'promotion_failed')) AS has_pending,
         bool_or(d.status NOT IN ('superseded', 'rejected')) AS has_live,
         count(*) FILTER (WHERE d.status = 'rejected') AS rejected_n
  FROM dlv d
  GROUP BY d.rid, d.day
),
-- Ouvertures connues, règle unique : unité retenue ; toute livraison non
-- provisoire de tout statut (doublon, écartée, unité remplacée, version
-- incohérente comprise), sauf source couverte par une réfutation effective ;
-- livraison provisoire vivante.
day_openings AS (
  SELECT u.rid, u.day, u.opening FROM units2 u WHERE u.opening IS NOT NULL
  UNION
  SELECT d.rid, d.day, d.opening
  FROM dlv d
  LEFT JOIN cmp c ON c.staging_id = d.staging_id
  WHERE d.opening IS NOT NULL AND d.status <> 'superseded' AND NOT coalesce(c.covered, false)
),
proof_exports AS (
  SELECT te.rid, te.export_id, te.export_ingested_at,
         te.export_period_start AS p_start, te.export_period_end AS p_end,
         least(te.export_period_end, coalesce(te.last_line_day, te.export_period_start) - 1) AS closed_until
  FROM trusted_exports te
  JOIN treasury_private.supported_formats f
    ON f.bank = te.bank AND f.source_format = te.source_format AND f.period_provenance = 'DECLARED'
),
-- Début de l'historique : première unité retenue, première période probante,
-- première livraison VIVANTE (une livraison écartée ne fixe pas ce début).
bounds AS (
  SELECT acc.rid,
         (SELECT min(u.day) FROM units2 u WHERE u.rid = acc.rid) AS first_unit,
         (SELECT max(u.day) FROM units2 u WHERE u.rid = acc.rid) AS last_unit,
         (SELECT min(pe.p_start) FROM proof_exports pe WHERE pe.rid = acc.rid AND pe.closed_until >= pe.p_start) AS first_proof,
         (SELECT max(pe.closed_until) FROM proof_exports pe WHERE pe.rid = acc.rid) AS last_proof,
         (SELECT min(f.day) FROM day_flags f WHERE f.rid = acc.rid AND f.has_live) AS first_live,
         (SELECT max(f.day) FROM day_flags f WHERE f.rid = acc.rid) AS last_staged
  FROM acc
),
series AS (
  SELECT b.rid, g::date AS day
  FROM bounds b
  CROSS JOIN params p
  CROSS JOIN LATERAL generate_series(
    least(b.first_unit, b.first_proof, b.first_live),
    least(p.t, greatest(p.d, b.last_unit, b.last_proof, b.last_staged)),
    interval '1 day') g
  WHERE coalesce(b.first_unit, b.first_proof, b.first_live) IS NOT NULL
),
-- Nature de chaque journée, avant la preuve de clôture des unités retenues.
base AS (
  SELECT s.rid, s.day, u.unit_id, u.export_id, u.opening, u.closing, u.unit_currency, u.ingested_at,
         u.export_ingested_at, u.source_format,
         EXISTS (SELECT 1 FROM closure_proofs cp WHERE cp.unit_id = u.unit_id) AS closed_by_later_line,
         dc.insufficient_cause,
         CASE
           -- Contradiction démontrée par une version non couverte (élément 2).
           WHEN u.unit_id IS NOT NULL AND coalesce(dc.conflict, false) THEN 'CONFLICT'
           -- Livraison en attente, provisoire, ou données insuffisantes : incertitude.
           WHEN u.unit_id IS NOT NULL AND (coalesce(dc.insufficient, false) OR coalesce(dc.pending, false)
                                           OR coalesce(sd.has_provisional, false)) THEN 'CONTESTED'
           WHEN u.unit_id IS NOT NULL AND NOT u.format_supported THEN 'UNIT_UNSUPPORTED'
           -- Réserve CTO 4.1 : une unité dérivée incohérente ne fournit aucun solde.
           -- Lignes stockées non conformes aux faits déclarés (P1 de la contre-revue
           -- CTO) : même issue, quel que soit l'état des agrégats.
           WHEN u.unit_id IS NOT NULL AND (NOT u.lines_conform OR (u.aggregates_status = 'derived' AND NOT u.coherent))
             THEN 'UNIT_INCOHERENT'
           WHEN u.unit_id IS NOT NULL AND NOT u.unit_clean THEN 'UNIT_REVIEW'
           WHEN u.unit_id IS NOT NULL AND u.aggregates_status = 'derived' THEN 'UNIT_OK'
           WHEN u.unit_id IS NOT NULL THEN 'UNIT_NO_BALANCE'
           -- Une journée encore provisoire n'est jamais déclarée sans mouvement.
           WHEN sd.has_provisional THEN 'PROVISIONAL'
           -- Livraisons en attente seulement (A6).
           WHEN sd.has_pending THEN 'PENDING'
           WHEN sd.has_live THEN 'CONTESTED'
           -- Une livraison écartée qui porte des lignes interdit l'absence de mouvement (arbitrage 11).
           WHEN coalesce(sd.rejected_n, 0) > 0 THEN 'UNPROVEN'
           WHEN EXISTS (SELECT 1 FROM proof_exports pe
                        WHERE pe.rid = s.rid AND s.day BETWEEN pe.p_start AND pe.closed_until) THEN 'NOMOV'
           ELSE 'UNPROVEN'
         END AS base_kind
  FROM series s
  LEFT JOIN units2 u ON u.rid = s.rid AND u.day = s.day
  LEFT JOIN day_flags sd ON sd.rid = s.rid AND sd.day = s.day
  LEFT JOIN day_cmp dc ON dc.rid = s.rid AND dc.day = s.day
),
-- Journée close, preuve (b) : la journée suivante qui n'est pas « sans
-- mouvement » est une unité retenue dont l'ouverture égale la clôture.
next_heads AS (
  SELECT b.rid, b.day,
         lead(b.base_kind) OVER w AS next_kind,
         lead(b.opening) OVER w AS next_opening,
         lead(b.day) OVER w AS next_day,
         lead(b.unit_id) OVER w AS next_unit_id
  FROM base b WHERE b.base_kind <> 'NOMOV'
  WINDOW w AS (PARTITION BY b.rid ORDER BY b.day)
),
days AS (
  SELECT b.rid, b.day, b.unit_id, b.export_id, b.opening, b.closing, b.unit_currency, b.ingested_at,
         b.export_ingested_at, b.source_format, b.closed_by_later_line, b.insufficient_cause, n.next_day, n.next_unit_id,
         CASE WHEN b.base_kind <> 'UNIT_OK' THEN b.base_kind
              WHEN b.closed_by_later_line THEN 'UNIT'
              WHEN n.next_kind = 'UNIT_OK' AND n.next_opening = b.closing THEN 'UNIT'
              ELSE 'NOT_CLOSED'
         END AS kind
  FROM base b
  LEFT JOIN next_heads n ON n.rid = b.rid AND n.day = b.day
),
grouped AS (
  SELECT d.*,
         CASE WHEN d.kind = 'UNIT' THEN CASE WHEN d.closed_by_later_line THEN 'LATER_LINE' ELSE 'NEXT_OPENING' END
         END AS closure_basis,
         count(*) FILTER (WHERE d.kind <> 'NOMOV')
           OVER (PARTITION BY d.rid ORDER BY d.day ROWS UNBOUNDED PRECEDING) AS grp_f,
         count(*) FILTER (WHERE d.kind <> 'NOMOV')
           OVER (PARTITION BY d.rid ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING) AS grp_b,
         count(*) FILTER (WHERE d.unit_id IS NOT NULL AND d.closing IS NOT NULL)
           OVER (PARTITION BY d.rid ORDER BY d.day ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS units_before
  FROM days d
),
heads AS (
  SELECT g.rid, g.grp_f, g.grp_b, g.kind, g.day, g.opening, g.closing, g.ingested_at, g.export_ingested_at,
         g.source_format
  FROM grouped g WHERE g.kind <> 'NOMOV'
),
unit_rank AS (
  SELECT g.rid, g.day, g.closing, row_number() OVER (PARTITION BY g.rid ORDER BY g.day) AS n
  FROM grouped g WHERE g.unit_id IS NOT NULL AND g.closing IS NOT NULL
),
bal AS (
  SELECT g.*,
         CASE WHEN g.kind = 'UNIT' THEN g.closing
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.closing
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.opening
         END AS balance_end,
         CASE WHEN g.kind = 'UNIT' THEN g.closing
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.closing
         END AS fwd_balance,
         CASE WHEN g.kind = 'UNIT' THEN 'CLOSING'
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN 'CLOSING'
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN 'OPENING'
         END AS source_role,
         CASE WHEN g.kind = 'UNIT' THEN g.day
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.day
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.day
         END AS source_day,
         CASE WHEN g.kind = 'UNIT' THEN g.source_format
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.source_format
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.source_format
         END AS source_format_used,
         CASE WHEN g.kind = 'UNIT' THEN g.ingested_at
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.ingested_at
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.ingested_at
         END AS source_unit_ingested_at,
         CASE WHEN g.kind = 'UNIT' THEN g.export_ingested_at
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.export_ingested_at
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.export_ingested_at
         END AS source_export_ingested_at
  FROM grouped g
  LEFT JOIN heads hf ON g.kind = 'NOMOV' AND hf.rid = g.rid AND hf.grp_f = g.grp_f
  LEFT JOIN heads hb ON g.kind = 'NOMOV' AND hb.rid = g.rid AND hb.grp_b = g.grp_b
),
chain AS (
  SELECT b.*,
         lag(b.day) OVER (PARTITION BY b.rid ORDER BY b.day) AS prev_day,
         lag(b.fwd_balance) OVER (PARTITION BY b.rid ORDER BY b.day) AS prev_balance,
         lag(b.source_day) OVER (PARTITION BY b.rid ORDER BY b.day) AS prev_source_day,
         ur.closing AS prev_unit_closing, ur.day AS prev_unit_day,
         -- Dernière journée antérieure non résolue (journée en attente comprise, A6).
         max(b.day) FILTER (WHERE b.kind IN ('CONFLICT', 'CONTESTED', 'PENDING', 'PROVISIONAL', 'UNIT_REVIEW',
                                             'UNIT_UNSUPPORTED', 'UNIT_INCOHERENT'))
           OVER (PARTITION BY b.rid ORDER BY b.day ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_unresolved_before
  FROM bal b
  LEFT JOIN unit_rank ur ON ur.rid = b.rid AND ur.n = b.units_before
),
transitions AS (
  SELECT c.*,
         CASE WHEN c.unit_id IS NULL OR c.opening IS NULL THEN NULL
              WHEN c.prev_day = c.day - 1 AND c.prev_balance IS NOT NULL
                THEN CASE WHEN c.opening = c.prev_balance THEN 'OK' ELSE 'BREAK' END
              WHEN c.last_unresolved_before >= coalesce(c.prev_unit_day, c.last_unresolved_before) THEN 'UNPROVEN'
              WHEN c.prev_unit_closing IS NULL THEN 'ANCHOR'
              WHEN c.opening = c.prev_unit_closing THEN 'CONTINUOUS_GAP'
              ELSE 'UNPROVEN'
         END AS transition
  FROM chain c
),
opening_days AS (
  SELECT o.rid, o.day, array_agg(o.opening) AS openings FROM day_openings o GROUP BY o.rid, o.day
),
late_openings AS (
  SELECT f.rid, min(f.day) AS day FROM opening_days f, params p WHERE f.day > p.t GROUP BY f.rid
),
ahead AS (
  SELECT t.*,
         t.unit_currency IS NOT NULL AND t.unit_currency <> r.currency AS currency_at_day,
         coalesce(min(t.day) FILTER (WHERE od.day IS NOT NULL) OVER fw, lo.day) AS next_open_day,
         min(t.day) FILTER (WHERE t.kind <> 'NOMOV') OVER fw AS next_non_nomov_day,
         min(t.day) FILTER (WHERE t.kind NOT IN ('NOMOV', 'UNPROVEN')) OVER fw AS next_line_day,
         coalesce(bool_or(t.transition = 'BREAK') OVER bw, false) AS break_through,
         coalesce(bool_or(t.transition = 'UNPROVEN') OVER bw, false) AS unproven_through,
         coalesce(bool_or(t.unit_currency <> r.currency) OVER bw, false) AS currency_through
  FROM transitions t
  JOIN public.daily_statement_account_registry r ON r.id = t.rid
  LEFT JOIN opening_days od ON od.rid = t.rid AND od.day = t.day
  LEFT JOIN late_openings lo ON lo.rid = t.rid
  WINDOW fw AS (PARTITION BY t.rid ORDER BY t.day ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING),
         bw AS (PARTITION BY t.rid ORDER BY t.day ROWS UNBOUNDED PRECEDING)
),
-- Évaluation par date SANS point de départ ; l'horizon de X est la plus
-- tardive de X et de la journée source de son solde.
day_status0 AS (
  SELECT a.*,
         a.balance_end IS NOT NULL AND coalesce(a.balance_end <> ANY (od.openings), false) AS next_mismatch,
         a.next_non_nomov_day IS NULL OR a.next_non_nomov_day >= a.next_open_day AS only_nomov_between,
         a.next_line_day IS NULL OR a.next_line_day >= a.next_open_day AS no_lines_between,
         coalesce(s.break_through, a.break_through) AS has_break,
         coalesce(s.unproven_through, a.unproven_through) AS has_unproven_base,
         coalesce(s.currency_through, a.currency_through) AS currency_contradiction,
         greatest(a.day, coalesce(a.source_day, a.day)) AS horizon
  FROM ahead a
  LEFT JOIN opening_days od ON od.rid = a.rid AND od.day = a.next_open_day
  LEFT JOIN ahead s ON s.rid = a.rid AND s.day = greatest(a.day, coalesce(a.source_day, a.day))
),
-- Ensemble des contradictions datées (§ 4.3), indépendant des points de départ.
contra AS (
  SELECT z.rid, min(z.day) AS first_day
  FROM (
    SELECT a.rid, a.day FROM ahead a WHERE a.transition = 'BREAK' OR a.kind = 'CONFLICT' OR a.currency_at_day
    UNION ALL
    SELECT v.rid, v.day FROM day_status0 v WHERE v.next_mismatch AND v.only_nomov_between
  ) z
  GROUP BY z.rid
),
-- Points de départ vérifiés (C5) : conditions de pose revérifiées.
vs_all AS (
  SELECT v.id, v.registry_account_id AS rid, v.day AS s_day, v.created_at, v.evidence_ref, v.canonical_unit_id,
         v.content_hash, v.verified_opening,
         EXISTS (SELECT 1 FROM treasury_private.verified_starts x WHERE x.revokes_id = v.id) AS revoked
  FROM treasury_private.verified_starts v
  JOIN acc ON acc.rid = v.registry_account_id
  WHERE v.action = 'SET'
),
vs_static AS (
  SELECT v.*,
         CASE WHEN NOT EXISTS (SELECT 1 FROM inv i WHERE i.rid = v.rid AND i.registry_status = 'active') THEN 'ACCOUNT_INACTIVE'
              WHEN u.unit_id IS NULL OR u.unit_id <> v.canonical_unit_id OR u.active_day_content_hash <> v.content_hash
                THEN 'UNIT_CHANGED'
              WHEN u.opening IS DISTINCT FROM v.verified_opening THEN 'OPENING_CHANGED'
              WHEN b.base_kind IS DISTINCT FROM 'UNIT_OK' THEN 'DAY_' || coalesce(b.base_kind, 'UNKNOWN')
         END AS static_failure
  FROM vs_all v
  LEFT JOIN units2 u ON u.rid = v.rid AND u.day = v.s_day
  LEFT JOIN base b ON b.rid = v.rid AND b.day = v.s_day
),
vs_ok AS (
  SELECT v.* FROM vs_static v WHERE NOT v.revoked AND v.static_failure IS NULL
),
-- Variante de chaîne par point : pour l'incertitude seulement, la chaîne ne
-- regarde pas en deçà de S. Les contradictions restent évaluées sur tout
-- l'historique (contra).
vj AS (
  SELECT p.id AS point_id, p.s_day, t.rid, t.day, t.kind, t.unit_id, t.opening, t.closing, t.prev_day,
         t.prev_balance, t.transition
  FROM vs_ok p JOIN transitions t ON t.rid = p.rid AND t.day >= p.s_day
),
vw AS (
  SELECT vj.*,
         max(vj.day) FILTER (WHERE vj.kind IN ('CONFLICT', 'CONTESTED', 'PENDING', 'PROVISIONAL', 'UNIT_REVIEW',
                                               'UNIT_UNSUPPORTED', 'UNIT_INCOHERENT')) OVER wpre AS last_unres_v,
         count(*) FILTER (WHERE vj.unit_id IS NOT NULL AND vj.closing IS NOT NULL) OVER wpre AS units_before_v
  FROM vj
  WINDOW wpre AS (PARTITION BY vj.point_id ORDER BY vj.day ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
),
vrank AS (
  SELECT vj.point_id, vj.day, vj.closing, row_number() OVER (PARTITION BY vj.point_id ORDER BY vj.day) AS n
  FROM vj WHERE vj.unit_id IS NOT NULL AND vj.closing IS NOT NULL
),
vt AS (
  SELECT w.point_id, w.s_day, w.rid, w.day, pr.day AS prev_unit_day_v,
         CASE WHEN w.unit_id IS NULL OR w.opening IS NULL THEN NULL
              WHEN w.day = w.s_day THEN CASE WHEN w.transition IN ('OK', 'BREAK') THEN w.transition ELSE 'VERIFIED_START' END
              WHEN w.prev_day = w.day - 1 AND w.prev_balance IS NOT NULL THEN w.transition
              WHEN w.last_unres_v >= coalesce(pr.day, w.last_unres_v) THEN 'UNPROVEN'
              WHEN pr.closing IS NULL THEN 'ANCHOR'
              WHEN w.opening = pr.closing THEN 'CONTINUOUS_GAP'
              ELSE 'UNPROVEN'
         END AS transition_v
  FROM vw w
  LEFT JOIN vrank pr ON pr.point_id = w.point_id AND pr.n = w.units_before_v
),
vflag AS (
  SELECT vt.*,
         coalesce(bool_or(vt.transition_v = 'UNPROVEN') OVER (PARTITION BY vt.point_id ORDER BY vt.day ROWS UNBOUNDED PRECEDING),
                  false) AS unproven_v
  FROM vt
),
-- Point applicable à X : le dernier point effectif de journée au plus X ;
-- effectif seulement si aucune contradiction n'est datée au plus tard à
-- l'horizon de X. Une seule chaîne par date, regards en avant compris.
day_status AS (
  SELECT v.*, ap.point_id AS vs_point_id, ap.s_day AS vs_day,
         CASE WHEN ap.point_id IS NOT NULL THEN coalesce(vf.unproven_v, v.has_unproven_base)
              ELSE v.has_unproven_base END AS has_unproven,
         c.first_day AS first_contradiction_day
  FROM day_status0 v
  LEFT JOIN contra c ON c.rid = v.rid
  LEFT JOIN LATERAL (
    SELECT p.id AS point_id, p.s_day FROM vs_ok p
    WHERE p.rid = v.rid AND p.s_day <= v.day AND (c.first_day IS NULL OR c.first_day > v.horizon)
    ORDER BY p.s_day DESC LIMIT 1) ap ON true
  LEFT JOIN vflag vf ON vf.point_id = ap.point_id AND vf.day = v.horizon
),
per_rid AS (
  SELECT acc.rid,
         v.kind AS kind_d, v.balance_end AS balance_d, v.source_day AS source_day_d, v.source_role AS source_role_d,
         v.source_format_used AS source_format_d, v.source_unit_ingested_at AS unit_ingested_d,
         v.source_export_ingested_at AS export_ingested_d, v.insufficient_cause AS insufficient_cause_d,
         v.vs_point_id AS vs_point_d, v.vs_day AS vs_day_d, v.next_open_day AS next_open_day_d,
         v.horizon AS horizon_d, v.first_contradiction_day,
         coalesce(v.has_break, false) AS has_break,
         coalesce(v.has_unproven, false) AS has_unproven,
         coalesce(v.currency_contradiction, false) AS currency_contradiction,
         v.day IS NOT NULL AS has_statement,
         sv.unit_id AS source_unit_id_d, sv.export_id AS source_export_id_d, sv.closure_basis AS closure_basis_d,
         sv.next_unit_id AS closure_next_unit_id_d, sv.next_day AS closure_next_day_d,
         CASE WHEN v.vs_point_id IS NOT NULL
              THEN coalesce((SELECT x.transition_v FROM vt x WHERE x.point_id = v.vs_point_id AND x.day = v.source_day),
                            sv.transition)
              ELSE sv.transition END AS source_link_d,
         CASE WHEN v.vs_point_id IS NOT NULL
                   AND (SELECT x.transition_v FROM vt x WHERE x.point_id = v.vs_point_id AND x.day = v.source_day)
                       IN ('CONTINUOUS_GAP', 'UNPROVEN')
                THEN (SELECT x.prev_unit_day_v FROM vt x WHERE x.point_id = v.vs_point_id AND x.day = v.source_day)
              WHEN sv.transition IN ('OK', 'BREAK') THEN sv.prev_source_day
              WHEN sv.transition IN ('CONTINUOUS_GAP', 'UNPROVEN') THEN sv.prev_unit_day END AS source_link_ref_d,
         coalesce((SELECT u.source_format FROM units2 u WHERE u.rid = acc.rid AND u.day <= p.d ORDER BY u.day DESC LIMIT 1),
                  (SELECT u.source_format FROM units2 u WHERE u.rid = acc.rid ORDER BY u.day LIMIT 1)) AS last_format,
         (SELECT max(o.day) FROM day_status o WHERE o.rid = acc.rid AND o.balance_end IS NOT NULL) AS observed_through,
         (SELECT jsonb_build_object('balance', t.balance_end::text, 'date', t.day)
            FROM day_status t
           WHERE t.rid = acc.rid AND t.day < p.d AND t.balance_end IS NOT NULL
           ORDER BY t.day DESC LIMIT 1) AS last_known_before
  FROM acc
  CROSS JOIN params p
  LEFT JOIN day_status v ON v.rid = acc.rid AND v.day = p.d
  LEFT JOIN day_status sv ON sv.rid = acc.rid AND sv.day = v.source_day
),
after_d AS (
  SELECT v.rid, v.next_mismatch, v.only_nomov_between, v.no_lines_between
  FROM day_status v, params p WHERE v.day = p.d
),
value_dates AS (
  SELECT u.rid, count(l.id) AS total_lines, count(l.id) FILTER (WHERE l.value_date IS NOT NULL) AS lines_with_value_date
  FROM units2 u
  CROSS JOIN params p
  JOIN public.daily_statement_lines_canonical l ON l.canonical_unit_id = u.unit_id AND l.is_active
  WHERE u.day BETWEEN p.d - 89 AND p.d
  GROUP BY u.rid
),
-- Constats rendus pour D, sa journée source et la première journée suivante
-- dont une ouverture est connue : écartements, réfutations, divergences,
-- comparaisons non couvertes, réfutations suspendues.
findings_day AS (
  SELECT z.rid, z.day, jsonb_agg(z.f ORDER BY z.k, z.f::text) AS findings
  FROM (
    SELECT f.rid, f.day, 1 AS k, jsonb_build_object('kind', 'REJECTED_DELIVERY', 'day', f.day, 'count', f.rejected_n) AS f
    FROM day_flags f WHERE f.rejected_n > 0
    UNION ALL
    SELECT ri.rid, ri.day, 2, jsonb_build_object(
             'kind', 'REFUTED_VERSION', 'day', ri.day, 'nature', ri.nature, 'automatic', ri.automatic,
             'proof_day', ri.proof_day, 'sources', ri.sources, 'covered_deliveries', ri.deliveries,
             'covered_redeposits', ri.redeposits, 'movements_unresolved', ri.movements_unresolved,
             'mention', CASE WHEN ri.nature = 'BANK_PIECE' THEN (SELECT p.piece_mention FROM params p) END)
    FROM refuted_info ri
    UNION ALL
    SELECT dc.rid, dc.day, 3, jsonb_build_object(
             'kind', 'VERSION_BREAKDOWN_DIVERGENCE', 'day', dc.day, 'count', dc.breakdown_n,
             'retained_totals', dc.retained_totals, 'other_totals', dc.breakdown_other_totals,
             'movements_unresolved', true)
    FROM day_cmp dc WHERE dc.breakdown_n > 0
    UNION ALL
    SELECT dc.rid, dc.day, 4, jsonb_build_object(
             'kind', 'VERSION_DETAIL_DIVERGENCE', 'day', dc.day, 'count', dc.detail_n, 'movements_unresolved', true)
    FROM day_cmp dc WHERE dc.detail_n > 0
    UNION ALL
    SELECT dc.rid, dc.day, 5, jsonb_build_object(
             'kind', 'VERSION_CONTRADICTION', 'day', dc.day, 'uncovered_sources', dc.conflict_sources)
    FROM day_cmp dc WHERE dc.conflict
    UNION ALL
    SELECT dc.rid, dc.day, 6, jsonb_build_object(
             'kind', 'VERSION_BALANCE_NOT_COMPARABLE', 'day', dc.day, 'cause', dc.insufficient_cause,
             'side', dc.insufficient_side, 'uncovered_sources', dc.insufficient_sources)
    FROM day_cmp dc WHERE dc.insufficient
    UNION ALL
    SELECT rs.rid, rs.day, 7, jsonb_build_object('kind', 'VERSION_REFUTATION_SUSPENDED', 'day', rs.day)
    FROM ref_suspended rs
    UNION ALL
    -- Livraisons dont les lignes stockées ne justifient pas les faits déclarés.
    SELECT d.rid, d.day, 8, jsonb_build_object(
             'kind', 'LINES_NOT_CONFORMING', 'day', d.day, 'deliveries', count(*),
             'retained_unit', bool_or(EXISTS (SELECT 1 FROM units2 u WHERE u.promoted_staging_id = d.staging_id)))
    FROM dlv d WHERE d.has_lines AND NOT d.lines_ok
    GROUP BY d.rid, d.day
    UNION ALL
    SELECT st.rid, st.day, 9, jsonb_build_object(
             'kind', 'REFUTATION_STATUS', 'day', st.day, 'refutation_id', st.id, 'proof_kind', st.proof_kind,
             'state', st.state, 'causes', to_jsonb(st.causes), 'uncovered_sources', st.uncovered_sources)
    FROM ref_status st
  ) z
  GROUP BY z.rid, z.day
),
-- Points de départ du compte, état pour la date lue.
vs_view AS (
  SELECT v.rid, jsonb_agg(jsonb_build_object(
           'verified_start_id', v.id, 'day', v.s_day, 'posed_at', v.created_at, 'evidence_ref', v.evidence_ref,
           'state', CASE WHEN v.revoked THEN 'REVOKED' ELSE 'ACTIVE' END,
           'for_date', CASE WHEN v.revoked THEN 'REVOKED'
                            WHEN v.s_day > p.d THEN 'NOT_YET_APPLICABLE'
                            WHEN v.static_failure IS NOT NULL THEN 'SUSPENDED'
                            WHEN pr.first_contradiction_day IS NOT NULL
                                 AND pr.first_contradiction_day <= coalesce(pr.horizon_d, p.d) THEN 'SUSPENDED'
                            ELSE 'EFFECTIVE' END,
           'suspension', CASE WHEN v.revoked OR v.s_day > p.d THEN NULL
                              WHEN v.static_failure IS NOT NULL THEN v.static_failure
                              WHEN pr.first_contradiction_day IS NOT NULL
                                   AND pr.first_contradiction_day <= coalesce(pr.horizon_d, p.d)
                                THEN 'CONTRADICTION_AT_HORIZON' END,
           'applied', coalesce(v.id = pr.vs_point_d, false),
           'history_before', jsonb_build_object(
             'unproven_days', (SELECT count(*) FROM base b WHERE b.rid = v.rid AND b.day < v.s_day AND b.base_kind = 'UNPROVEN'),
             'pending_days', (SELECT count(*) FROM base b WHERE b.rid = v.rid AND b.day < v.s_day
                                AND b.base_kind IN ('PENDING', 'CONTESTED', 'PROVISIONAL')),
             'conflict_days', (SELECT count(*) FROM base b WHERE b.rid = v.rid AND b.day < v.s_day AND b.base_kind = 'CONFLICT'),
             'rejected_deliveries', (SELECT coalesce(sum(f.rejected_n), 0) FROM day_flags f
                                      WHERE f.rid = v.rid AND f.day < v.s_day)))
           ORDER BY v.s_day, v.created_at) AS points,
         bool_or(NOT v.revoked AND v.s_day <= p.d
                 AND (v.static_failure IS NOT NULL
                      OR (pr.first_contradiction_day IS NOT NULL
                          AND pr.first_contradiction_day <= coalesce(pr.horizon_d, p.d)))) AS any_suspended
  FROM vs_static v
  CROSS JOIN params p
  LEFT JOIN per_rid pr ON pr.rid = v.rid
  GROUP BY v.rid
),
per_account AS (
  SELECT i.*,
         pr.kind_d, pr.balance_d, pr.source_day_d, pr.source_format_d, pr.unit_ingested_d, pr.export_ingested_d,
         pr.has_break, pr.has_unproven, pr.has_statement, pr.currency_contradiction, pr.last_format,
         pr.observed_through, pr.last_known_before, pr.source_role_d, pr.source_unit_id_d, pr.source_export_id_d,
         pr.closure_basis_d, pr.closure_next_unit_id_d, pr.closure_next_day_d, pr.source_link_d, pr.source_link_ref_d,
         pr.vs_point_d, pr.vs_day_d, pr.next_open_day_d, pr.insufficient_cause_d,
         vv.points AS verified_starts, coalesce(vv.any_suspended, false) AS vs_suspended,
         EXISTS (SELECT 1 FROM ref_suspended rs CROSS JOIN params p
                 WHERE rs.rid = i.rid AND rs.day IN (p.d, pr.source_day_d)) AS ref_suspended_d,
         CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND i.registry_status = 'active'
                   AND i.registry_currency = i.currency THEN
           (SELECT max(v.day) FROM day_status v
              JOIN qual vq ON vq.bank = i.bank AND vq.source_format = v.source_format_used AND vq.status = 'QUALIFIED'
             WHERE v.rid = i.rid AND v.balance_end IS NOT NULL AND NOT v.has_break AND NOT v.has_unproven
               AND NOT v.currency_contradiction AND NOT (v.next_mismatch AND (v.only_nomov_between OR v.no_lines_between)))
         END AS covered_through,
         q.status AS qualification_status, q.evidence_ref AS qualification_evidence,
         array_remove(ARRAY[
           CASE WHEN i.currency <> 'XOF' THEN 'CURRENCY_OUT_OF_SCOPE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NULL AND i.bank = 'NSIA' THEN 'BANK_WITHOUT_FORMAT' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NULL AND i.bank <> 'NSIA' THEN 'ACCOUNT_NOT_REGISTERED' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND i.registry_status <> 'active' THEN 'REGISTRY_ACCOUNT_INACTIVE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL
                 AND (i.registry_currency <> i.currency OR pr.currency_contradiction)
                THEN 'CURRENCY_CONTRADICTION' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND pr.has_break THEN 'CHAIN_BROKEN' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND ad.next_mismatch AND ad.only_nomov_between
                THEN 'CHAIN_BROKEN_AFTER_DATE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND ad.next_mismatch AND NOT ad.only_nomov_between
                     AND ad.no_lines_between
                THEN 'CHAIN_UNPROVEN_AFTER_DATE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND pr.has_unproven THEN 'CHAIN_UNPROVEN' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND NOT coalesce(pr.has_statement, false) THEN 'NO_STATEMENT' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND coalesce(pr.has_statement, false) THEN
             CASE pr.kind_d
               WHEN 'PROVISIONAL' THEN 'PROVISIONAL_DAY'
               WHEN 'UNPROVEN' THEN 'DAY_WITHOUT_PROOF'
               WHEN 'UNIT_NO_BALANCE' THEN 'BALANCE_NOT_DERIVED'
               WHEN 'UNIT_REVIEW' THEN 'UNIT_NEEDS_REVIEW'
               WHEN 'UNIT_INCOHERENT' THEN 'UNIT_FINANCIAL_FACTS_INCOHERENT'
               WHEN 'CONFLICT' THEN 'DAY_CONFLICT'
               WHEN 'CONTESTED' THEN 'DAY_CONTESTED'
               WHEN 'PENDING' THEN 'DAY_PENDING_VALIDATION'
               WHEN 'UNIT_UNSUPPORTED' THEN 'PARSER_VERSION_UNSUPPORTED'
               WHEN 'NOT_CLOSED' THEN 'DAY_NOT_CLOSED'
               WHEN 'NOMOV' THEN CASE WHEN pr.balance_d IS NULL THEN 'BALANCE_UNKNOWN_AT_DATE' END
               WHEN 'UNIT' THEN NULL
               ELSE 'DAY_WITHOUT_PROOF'
             END END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND pr.kind_d = 'CONTESTED' AND pr.insufficient_cause_d IS NOT NULL
                THEN 'VERSION_BALANCE_NOT_COMPARABLE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND coalesce(pr.has_statement, false) THEN
             CASE coalesce(q.status, 'NOT_QUALIFIED')
               WHEN 'QUALIFIED' THEN NULL
               WHEN 'PILOT' THEN 'FORMAT_PILOT'
               WHEN 'SUSPENDED' THEN 'FORMAT_SUSPENDED'
               ELSE 'FORMAT_NOT_QUALIFIED'
             END END
         ], NULL) AS reasons,
         vd.total_lines, vd.lines_with_value_date,
         coalesce((SELECT jsonb_agg(f ORDER BY f::text) FROM (
             SELECT DISTINCT jsonb_array_elements(fd.findings) AS f
             FROM findings_day fd CROSS JOIN params p
             WHERE fd.rid = i.rid AND fd.day IN (p.d, pr.source_day_d, pr.next_open_day_d)) x), '[]'::jsonb) AS findings,
         (SELECT coalesce(sum(f.rejected_n), 0) FROM day_flags f WHERE f.rid = i.rid) AS rejected_deliveries_n,
         (SELECT count(*) FROM refuted_info ri WHERE ri.rid = i.rid) AS refuted_versions_n
  FROM inv i
  LEFT JOIN per_rid pr ON pr.rid = i.rid
  LEFT JOIN after_d ad ON ad.rid = i.rid
  LEFT JOIN qual q ON q.bank = i.bank AND q.source_format = coalesce(pr.source_format_d, pr.last_format)
  LEFT JOIN value_dates vd ON vd.rid = i.rid
  LEFT JOIN vs_view vv ON vv.rid = i.rid
),
-- Motifs informatifs : rendus, sans changer le statut (ils expliquent une
-- suspension dont l'effet est déjà porté par les autres motifs).
classified AS (
  SELECT pa.*,
         pa.reasons
           || CASE WHEN pa.vs_suspended THEN ARRAY['VERIFIED_START_SUSPENDED'] ELSE ARRAY[]::text[] END
           || CASE WHEN pa.ref_suspended_d THEN ARRAY['VERSION_REFUTATION_SUSPENDED'] ELSE ARRAY[]::text[] END
           AS all_reasons,
         CASE WHEN 'CURRENCY_OUT_OF_SCOPE' = ANY (pa.reasons) THEN 'OUT_OF_SCOPE'
              WHEN pa.reasons && ARRAY['CURRENCY_CONTRADICTION', 'CHAIN_BROKEN', 'CHAIN_BROKEN_AFTER_DATE', 'DAY_CONFLICT']
                THEN 'BLOCKED'
              WHEN cardinality(pa.reasons) > 0 THEN 'NOT_COVERED'
              WHEN pa.balance_d IS NULL THEN 'NOT_COVERED'
              ELSE 'AVAILABLE'
         END AS status
  FROM per_account pa
),
attest AS (
  SELECT a.inventory_fingerprint, a.attested_at, a.accounts_count
  FROM treasury_private.inventory_attestations a ORDER BY a.seq DESC LIMIT 1
),
unlisted AS (
  SELECT r.id, r.bank, r.currency, r.safe_alias
  FROM public.daily_statement_account_registry r
  WHERE r.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
                    WHERE e.status = 'ACTIVE' AND e.registry_account_id = r.id)
),
cons AS (
  SELECT count(*) FILTER (WHERE c.currency = 'XOF') AS expected_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'AVAILABLE') AS available_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'NOT_COVERED') AS not_covered_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'BLOCKED') AS blocked_n,
         count(*) FILTER (WHERE c.status = 'OUT_OF_SCOPE') AS out_of_scope_n,
         sum(c.balance_d) FILTER (WHERE c.currency = 'XOF' AND c.status = 'AVAILABLE') AS subtotal
  FROM classified c
),
inventory_state AS (
  SELECT treasury_private.inventory_fingerprint() AS fingerprint,
         (SELECT count(*) FROM treasury_private.expected_accounts e WHERE e.status = 'ACTIVE') AS active_n,
         (SELECT a.inventory_fingerprint FROM attest a) AS attested_fingerprint,
         (SELECT a.attested_at FROM attest a) AS attested_at,
         (SELECT count(*) FROM unlisted u WHERE u.currency = 'XOF'
            AND u.bank IN ('BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE')) AS unlisted_xof_n
)
SELECT jsonb_build_object(
  'contract', 'treasury_balances_at_v1',
  'as_of', p.d,
  'today', p.t,
  'read_at', p.read_at,
  'timezone', 'Africa/Dakar',
  'basis', 'ACCOUNTING_DATE',
  'value_date_window_days', 90,
  'inventory', jsonb_build_object(
    'fingerprint', s.fingerprint,
    'active_accounts', s.active_n,
    'attested', s.attested_fingerprint IS NOT NULL AND s.attested_fingerprint = s.fingerprint AND s.active_n > 0,
    'attested_at', s.attested_at,
    'unlisted_registry_accounts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('registry_account_id', u.id, 'bank', u.bank, 'currency', u.currency,
                                          'alias', u.safe_alias) ORDER BY u.bank, u.safe_alias, u.id)
      FROM unlisted u), '[]'::jsonb)),
  'accounts', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'expected_account_id', c.expected_id,
      'registry_account_id', c.rid,
      'bank', c.bank,
      'currency', c.currency,
      'alias', coalesce(c.registry_alias, c.safe_alias),
      'status', c.status,
      'reasons', to_jsonb(c.all_reasons),
      'balance_at_date', CASE WHEN c.status = 'AVAILABLE' THEN c.balance_d::text END,
      'observed_balance', CASE WHEN c.status <> 'AVAILABLE' AND c.balance_d IS NOT NULL
                               THEN jsonb_build_object('balance', c.balance_d::text, 'date', p.d)
                               WHEN c.status <> 'AVAILABLE' THEN c.last_known_before END,
      'source_format', coalesce(c.source_format_d, c.last_format),
      'qualification', coalesce(c.qualification_status, CASE WHEN c.bank = 'NSIA' THEN 'NO_FORMAT' ELSE 'NOT_QUALIFIED' END),
      'qualification_evidence', c.qualification_evidence,
      'dates', jsonb_build_object(
        'bank_date_covered', c.covered_through,
        'age_days', CASE WHEN c.covered_through IS NOT NULL THEN p.t - c.covered_through END,
        'bank_date_observed', c.observed_through,
        'balance_source_day', c.source_day_d),
      'verified_starts', coalesce(c.verified_starts, '[]'::jsonb),
      -- Unité retenue de la journée D elle-même (liaison d'un point de départ),
      -- rendue même sans solde à D (journée non close, par exemple).
      'retained_unit_at_date', (SELECT CASE WHEN count(*) = 1 THEN jsonb_build_object('unit_id', min(u.unit_id::text)::uuid,
                                                   'content_hash', min(u.active_day_content_hash)) END
                                  FROM units2 u WHERE u.rid = c.rid AND u.day = p.d),
      'findings', c.findings,
      'counters', jsonb_build_object('rejected_deliveries', c.rejected_deliveries_n,
                                     'refuted_versions', c.refuted_versions_n),
      'sources', CASE WHEN c.balance_d IS NULL THEN '[]'::jsonb ELSE
        jsonb_build_array(jsonb_build_object(
          'kind', 'CANONICAL_UNIT', 'role', c.source_role_d, 'unit_id', c.source_unit_id_d,
          'export_id', c.source_export_id_d, 'day', c.source_day_d, 'ingested_at', c.unit_ingested_d,
          'export_ingested_at', c.export_ingested_d, 'source_format', c.source_format_d,
          -- Empreinte de contenu active : liaison d'un point de départ (C5).
          'content_hash', (SELECT u.active_day_content_hash FROM units2 u WHERE u.unit_id = c.source_unit_id_d)))
        || CASE WHEN c.source_role_d = 'CLOSING' AND c.closure_basis_d = 'LATER_LINE' THEN coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'kind', 'CLOSURE_LATER_LINE', 'export_id', cp.export_id, 'delivery', cp.delivery,
                      'later_line_day', cp.later_line_day, 'export_ingested_at', cp.export_ingested_at)
                    ORDER BY cp.export_ingested_at, cp.export_id)
             FROM closure_proofs cp WHERE cp.unit_id = c.source_unit_id_d), '[]'::jsonb)
           WHEN c.source_role_d = 'CLOSING' AND c.closure_basis_d = 'NEXT_OPENING' THEN coalesce((
             SELECT jsonb_build_array(jsonb_build_object(
                      'kind', 'CLOSURE_NEXT_OPENING', 'unit_id', nu.unit_id, 'export_id', nu.export_id, 'day', nu.day,
                      'ingested_at', nu.ingested_at, 'export_ingested_at', nu.export_ingested_at))
             FROM units2 nu WHERE nu.unit_id = c.closure_next_unit_id_d), '[]'::jsonb)
           ELSE '[]'::jsonb END
        || jsonb_build_array(jsonb_build_object(
             'kind', 'CHAIN_LINK', 'day', c.source_day_d, 'link', c.source_link_d, 'reference_day', c.source_link_ref_d))
        || CASE WHEN c.vs_point_d IS NULL THEN '[]'::jsonb ELSE coalesce((
             SELECT jsonb_build_array(jsonb_build_object(
                      'kind', 'VERIFIED_START', 'day', v.s_day, 'posed_at', v.created_at, 'evidence_ref', v.evidence_ref))
             FROM vs_static v WHERE v.id = c.vs_point_d), '[]'::jsonb) END
        || coalesce((SELECT jsonb_agg(f ORDER BY f::text) FROM jsonb_array_elements(c.findings) f
                     WHERE f ->> 'kind' IN ('REJECTED_DELIVERY', 'REFUTED_VERSION', 'VERSION_BREAKDOWN_DIVERGENCE',
                                            'VERSION_DETAIL_DIVERGENCE')), '[]'::jsonb)
        || coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'DECLARED_PERIOD', 'export_id', pe.export_id, 'period_start', pe.p_start,
                   'period_end', pe.p_end, 'closed_until', pe.closed_until, 'export_ingested_at', pe.export_ingested_at)
                 ORDER BY pe.p_start, pe.export_ingested_at, pe.export_id)
          FROM proof_exports pe
          WHERE pe.rid = c.rid AND pe.closed_until >= pe.p_start
            AND EXISTS (SELECT 1 FROM (VALUES
                  (least(c.source_day_d + 1, p.d), greatest(c.source_day_d - 1, p.d), c.source_day_d <> p.d),
                  (c.source_day_d + 1, c.closure_next_day_d - 1,
                   c.source_role_d = 'CLOSING' AND c.closure_basis_d = 'NEXT_OPENING'),
                  (c.source_link_ref_d + 1, c.source_day_d - 1, c.source_link_d IN ('OK', 'BREAK'))) r(lo, hi, used)
                WHERE r.used AND r.lo <= r.hi AND pe.p_start <= r.hi AND pe.closed_until >= r.lo)), '[]'::jsonb)
      END,
      'value_dates', jsonb_build_object('total_lines', coalesce(c.total_lines, 0),
                                        'lines_with_value_date', coalesce(c.lines_with_value_date, 0)))
      ORDER BY c.bank, coalesce(c.registry_alias, c.safe_alias), c.expected_id)
    FROM classified c), '[]'::jsonb),
  'consolidation', jsonb_build_object(
    'currency', 'XOF',
    'status', CASE WHEN k.blocked_n > 0 THEN 'BLOCKED'
                   WHEN k.expected_n > 0 AND k.available_n = k.expected_n AND s.unlisted_xof_n = 0
                        AND s.attested_fingerprint IS NOT NULL AND s.attested_fingerprint = s.fingerprint THEN 'COMPLETE'
                   ELSE 'PARTIAL' END,
    'amount', k.subtotal::text,
    'accounts_expected', k.expected_n,
    'accounts_available', k.available_n,
    'accounts_not_covered', k.not_covered_n,
    'accounts_blocked', k.blocked_n,
    'accounts_out_of_scope', k.out_of_scope_n,
    'registry_accounts_outside_inventory', s.unlisted_xof_n,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN s.active_n = 0 THEN 'INVENTORY_EMPTY' END,
      CASE WHEN s.attested_fingerprint IS NULL OR s.attested_fingerprint <> s.fingerprint THEN 'INVENTORY_NOT_ATTESTED' END,
      CASE WHEN s.unlisted_xof_n > 0 THEN 'REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY' END,
      CASE WHEN k.not_covered_n > 0 THEN 'ACCOUNTS_NOT_COVERED' END,
      CASE WHEN k.blocked_n > 0 THEN 'ACCOUNTS_BLOCKED' END], NULL)))
)
FROM params p CROSS JOIN inventory_state s CROSS JOIN cons k
$$;
