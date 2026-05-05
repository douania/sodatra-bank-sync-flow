# DB_TRUTH — Vérité documentaire de l'état DB réel

> Source : DB-INVENTORY-1 (REPORT_ONLY, 2026-05-05) + DB-FREEZE-1 (PLAN_REVIEW, 2026-05-05).
> Statut : DB-FREEZE-1A CLOSED. Aucune migration créée. Aucun SQL exécuté.

---

## 1. Objet du document

- Source de vérité **documentaire** de l'état DB réel actuel (Supabase prod, projet `leakcdbbawzysfqyqsnr`).
- **Ne remplace pas** une migration : le repo `supabase/migrations/` reste partiellement divergent de la prod (voir §4).
- Sert à **éviter les erreurs** avant Lot 4, avant DB-FREEZE-1B, et avant toute future migration touchant `collection_report`.
- Lecture obligatoire avant tout chantier qui touche au schéma, aux index, ou aux contraintes de `collection_report`.

---

## 2. Vérité actuelle `collection_report`

### Colonne `unique_excel_traceability`

- Type : `text` simple.
- `is_generated = NEVER`.
- `generation_expression = NULL`.
- Alimentée **applicativement** par le moteur de sync (`intelligentSyncService` + `excelMappingService`), pas par PostgreSQL.
- 740 lignes historiques ont la valeur `NULL` (imports 2025 antérieurs aux Lots 3B). NULL multiples tolérés par la sémantique SQL standard de la contrainte UNIQUE.

### Contraintes

- `unique_excel_traceability` — `UNIQUE (unique_excel_traceability)`, contrainte classique, **non partielle**.
- `check_excel_traceability_not_null` — `CHECK ((excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) OR (excel_filename IS NULL AND excel_source_row IS NULL))`. 100 % conforme (0 violation).
- Pas de FK sur `collection_report`.
- PK : `id` UUID, `gen_random_uuid()`.

### Index pertinents

- `unique_excel_traceability` — btree UNIQUE non partiel, lié à la contrainte ci-dessus.
- `idx_collection_excel_source` — btree **UNIQUE partiel** sur `(excel_filename, excel_source_row) WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL`.
- Autres index : `idx_collection_excel_filename`, `idx_collection_report_facture`, `idx_collection_report_date_of_validity`, `idx_collection_report_status_date`, `idx_collection_report_matching`, `idx_collection_type`, `idx_cheque_number`, `idx_cheque_status`, `idx_effet_echeance_date`, `idx_effet_status`.

### Trigger actif

- `trg_detect_collection_type` — BEFORE INSERT/UPDATE, fonction `detect_collection_type()` (INVOKER). Classifie EFFET / CHEQUE.

### État data

| Mesure | Valeur (2026-05-05) |
|---|---:|
| Total lignes | **1 653** |
| Doublons par `(excel_filename, excel_source_row)` | **0** |
| `unique_excel_traceability` distinct (non null) | 913 |
| `unique_excel_traceability NULL` | 740 |
| `client_code = 'UNKNOWN'` | 125 (rattachés à **DEF-14**) |
| `report_date` min / max | 2024-09-19 / 2026-11-26 |

---

## 3. Règle canonique d'idempotence

**La source canonique d'idempotence métier est le couple `(excel_filename, excel_source_row)`**, matérialisée par l'index partiel UNIQUE `idx_collection_excel_source`.

- `unique_excel_traceability` est **legacy / auxiliaire**. La contrainte UNIQUE existe et est respectée, mais elle ne porte pas la garantie d'unicité métier (740 NULL admis).
- **Interdits runtime explicites** :
  - **Ne pas** réintroduire `upsert(..., { onConflict: 'unique_excel_traceability' })` dans le runtime. Le sync s'appuie sur `(excel_filename, excel_source_row)`.
  - **Ne pas** générer artificiellement `excel_filename` (`UNKNOWN_FILE`, `IMPORT_*`, `DAILY_IMPORT`) ou `excel_source_row` (≤ 0, NULL contournés). Le CHECK l'interdit déjà.
  - **Ne pas** désactiver `check_excel_traceability_not_null` ni le trigger `trg_detect_collection_type`.

---

## 4. Divergences repo ↔ DB

### Migrations historiques non reproductibles

| Migration | Déclare | DB réelle |
|---|---|---|
| `20250628121618_cold_shore.sql` | colonne `GENERATED ALWAYS AS (…)`, index UNIQUE partiel `WHERE … IS NOT NULL` | colonne text simple, index UNIQUE non partiel |
| `20250628121709_shiny_waterfall.sql` | idem (idempotent guards mais même forme cible) | idem |

9 migrations au total touchent `unique_excel_traceability` (`broad_reef`, `morning_bird`, `green_wind`, `sunny_trail`, `raspy_union`, `white_meadow`, `azure_forest`, `cold_shore`, `shiny_waterfall`). L'historique est itératif et l'état final n'a aucune migration source de vérité dans le repo.

### Règles permanentes

- **Ne pas supprimer** `cold_shore` ni `shiny_waterfall` (historique git, traçabilité).
- **Ne pas réécrire** ces migrations.
- **Ne pas réappliquer** ces migrations sur une base contenant les 740 NULL : la transformation `GENERATED ALWAYS` échouerait.
- Toute reproductibilité future passe par DB-FREEZE-1B (voir §5), pas par modification des migrations historiques.

---

## 5. Brouillon DB-FREEZE-1B (NON exécuté)

Brouillon SQL d'une future migration de vérité, **idempotente**, **NO-OP sur la prod actuelle**, reconstruisant l'état réel sur base neuve.
**À ne pas créer ni exécuter sans staging + validation CTO explicite.**

```sql
-- DB-FREEZE-1B — Migration de vérité collection_report.unique_excel_traceability
-- IDEMPOTENT. Sur prod actuelle : NO-OP. Sur base neuve : reconstruit l'état réel.
-- Ne PAS exécuter sans validation CTO + staging.

BEGIN;

-- 1. Colonne text simple (jamais GENERATED)
ALTER TABLE public.collection_report
  ADD COLUMN IF NOT EXISTS unique_excel_traceability text;

-- 2. Contrainte UNIQUE classique (NULL multiples autorisés en SQL standard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_excel_traceability'
      AND conrelid = 'public.collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report
      ADD CONSTRAINT unique_excel_traceability UNIQUE (unique_excel_traceability);
  END IF;
END$$;

-- 3. Index partiel UNIQUE — VRAIE source d'idempotence métier
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_source
  ON public.collection_report (excel_filename, excel_source_row)
  WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- 4. CHECK cohérence couple (filename, source_row)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_excel_traceability_not_null'
      AND conrelid = 'public.collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report
      ADD CONSTRAINT check_excel_traceability_not_null
      CHECK (
        (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL)
        OR (excel_filename IS NULL AND excel_source_row IS NULL)
      );
  END IF;
END$$;

COMMIT;

-- INTERDIT explicitement dans cette migration :
--   * pas d'ALTER COLUMN ... GENERATED
--   * pas de DROP COLUMN
--   * pas de DROP CONSTRAINT
--   * pas de DROP INDEX
--   * pas d'UPDATE des 740 lignes NULL
--   * pas de réécriture des migrations cold_shore / shiny_waterfall
```

---

## 6. Tests read-only à exécuter avant toute future migration

```sql
-- T-pré-1 : colonne existe, NEVER generated
SELECT data_type, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name='collection_report'
  AND column_name='unique_excel_traceability';
-- attendu : text / NEVER / NULL

-- T-pré-2 : contraintes
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.collection_report'::regclass
  AND conname IN ('unique_excel_traceability','check_excel_traceability_not_null');

-- T-pré-3 : index
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='collection_report'
  AND indexname IN ('unique_excel_traceability','idx_collection_excel_source');

-- T-pré-4 : intégrité métier
SELECT
  count(*) AS total,
  count(DISTINCT (excel_filename, excel_source_row)) AS distinct_pair,
  count(*) FILTER (WHERE unique_excel_traceability IS NULL) AS uet_null,
  sum(collection_amount)::bigint AS total_amount
FROM collection_report;
-- attendu : 1653 / 1653 / 740 / total inchangé
```

T-post = identiques + comparaison stricte. Tout écart → rollback obligatoire.

---

## 7. Interdits permanents

- Pas de `GENERATED ALWAYS` sur `unique_excel_traceability`.
- Pas de `DROP COLUMN unique_excel_traceability`.
- Pas de `DROP INDEX unique_excel_traceability` ni `DROP INDEX idx_collection_excel_source`.
- Pas de `DROP CONSTRAINT unique_excel_traceability` ni `check_excel_traceability_not_null`.
- Pas de réécriture / suppression de `cold_shore` / `shiny_waterfall`.
- Pas d'`UPDATE` massif des 740 lignes `unique_excel_traceability NULL` sans lot dédié validé CTO.
- Pas de nettoyage des 125 lignes `client_code='UNKNOWN'` (DEF-14) dans le périmètre DB-FREEZE.
- Pas de modification du trigger `trg_detect_collection_type` ni de la fonction `detect_collection_type()` dans le périmètre DB-FREEZE.