-- ============================================================================
-- 0M-E — DB-FREEZE-1B v2 : vérité collection_report.unique_excel_traceability
-- ============================================================================
-- Version robuste et FINALE du brouillon docs/DB_TRUTH.md §5 (jamais exécuté),
-- durcie pour couvrir aussi le rejeu from-scratch (lot 0M-E, 2026-07-09).
--
-- État final garanti, identique à la vérité prod (DB_TRUTH §2) :
--   * colonne unique_excel_traceability : text simple, is_generated = NEVER,
--     generation_expression = NULL ;
--   * contrainte UNIQUE classique `unique_excel_traceability` sur la colonne ;
--   * index canonique d'idempotence métier `idx_collection_excel_source` :
--     UNIQUE partiel (excel_filename, excel_source_row) WHERE ... NOT NULL
--     (azure_forest l'a droppé pendant le rejeu ; en prod il a été recréé
--     hors chaîne — cette migration matérialise cette recréation) ;
--   * contrainte check_excel_traceability_not_null présente.
--
-- Garanties de sûreté :
--   * idempotente, rejouable, aucune donnée lue/écrite, aucun UPDATE ;
--   * NO-OP sur une base déjà conforme (prod) : chaque étape est gardée ;
--   * jamais destructive en prod : l'unique DROP (étape 4) exige qu'un index
--     nommé unique_excel_traceability (a) existe, (b) ne soit PAS porté par
--     une contrainte, (c) porte sur (excel_filename, excel_source_row) — la
--     forme artefact du rejeu. Sur prod, ce nom désigne l'index PORTEUR de la
--     contrainte UNIQUE : condition (b) fausse → branche jamais exécutée.
--   * interdits DB_TRUTH §7 respectés : pas de GENERATED, pas de DROP de la
--     contrainte/index prod conformes, pas d'UPDATE massif.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonne présente (ceinture : couvre une base où ni la baseline ni
--    shiny_waterfall ne l'auraient créée).
-- ---------------------------------------------------------------------------
ALTER TABLE public.collection_report
  ADD COLUMN IF NOT EXISTS unique_excel_traceability text;

-- ---------------------------------------------------------------------------
-- 2. Anti-GENERATED : si un rejeu a laissé la forme GENERATED ALWAYS
--    (shiny_waterfall sur base sans baseline), convertir proprement en
--    colonne normale. DROP EXPRESSION conserve les valeurs stockées.
--    Sur prod : is_generated = NEVER → no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'collection_report'
      AND column_name  = 'unique_excel_traceability'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.collection_report
      ALTER COLUMN unique_excel_traceability DROP EXPRESSION;
    RAISE NOTICE 'db_freeze_1b: colonne GENERATED convertie en text simple';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. idx_collection_excel_source AVANT tout retrait d'artefact : l'unicité
--    métier (excel_filename, excel_source_row) reste protégée sans
--    interruption. No-op prod (index déjà présent).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_source
  ON public.collection_report (excel_filename, excel_source_row)
  WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Retrait de l'index-ARTEFACT du rejeu : index nommé
--    unique_excel_traceability, non porté par une contrainte, défini sur la
--    paire (excel_filename, excel_source_row). Guards stricts — voir en-tête.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_indexdef text;
BEGIN
  SELECT indexdef INTO v_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename  = 'collection_report'
    AND indexname  = 'unique_excel_traceability';

  IF v_indexdef IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname  = 'unique_excel_traceability'
         AND conrelid = 'public.collection_report'::regclass
     )
     AND v_indexdef LIKE '%excel_filename%'
     AND v_indexdef LIKE '%excel_source_row%'
  THEN
    DROP INDEX public.unique_excel_traceability;
    RAISE NOTICE 'db_freeze_1b: index artefact unique_excel_traceability (paire excel) droppé';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Contrainte UNIQUE classique sur la colonne (vérité prod).
--    Fail-open : si un index homonyme inattendu subsiste (état inconnu, non
--    prévu par le rejeu ni par la prod), on n'écrase rien — NOTICE et no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'unique_excel_traceability'
      AND conrelid = 'public.collection_report'::regclass
  ) THEN
    RAISE NOTICE 'db_freeze_1b: contrainte unique_excel_traceability déjà présente — no-op';
  ELSIF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'collection_report'
      AND indexname  = 'unique_excel_traceability'
  ) THEN
    RAISE NOTICE 'db_freeze_1b: index homonyme non-artefact présent — aucune action (fail-open, arbitrage CTO requis)';
  ELSE
    ALTER TABLE public.collection_report
      ADD CONSTRAINT unique_excel_traceability
      UNIQUE (unique_excel_traceability);
    RAISE NOTICE 'db_freeze_1b: contrainte UNIQUE unique_excel_traceability créée';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. CHECK de cohérence du couple (filename, source_row). No-op partout en
--    temps normal (posé par la baseline / broad_reef / white_meadow).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'check_excel_traceability_not_null'
      AND conrelid = 'public.collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report
      ADD CONSTRAINT check_excel_traceability_not_null
      CHECK (
        (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL)
        OR (excel_filename IS NULL AND excel_source_row IS NULL)
      );
  END IF;
END
$$;
