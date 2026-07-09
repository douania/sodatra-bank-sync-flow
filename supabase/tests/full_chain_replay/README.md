# Tests — rejeu full-chain local (lot 0M-E)

Valide que la chaîne `supabase/migrations/` complète (baseline pré-chaîne +
bridge Plan B + chaîne historique + DB-FREEZE-1B + daily v2) s'applique sur
une base **vierge**, via le **vrai CLI Supabase**, avec un ledger local réel.

**Périmètre strict :**
- Postgres local **jetable** uniquement (Docker, port 54331). Jamais de
  Supabase live : la cible est exclusivement `--db-url` vers le conteneur.
- Aucune donnée bancaire réelle. La seule ligne insérée est la **fixture
  plateforme** `auth.users` (UUID admin `9539d4f5-…` déjà versionné dans la
  migration historique `20260430150428`, email fictif) : elle émule l'état
  prod au moment de l'apply historique — sans elle, l'étape 0 de `20260430`
  (INSERT user_roles avec FK auth.users) échoue sur base vierge.
- Le shim `00_platform_shim_minimal.sql` émule uniquement la plateforme
  (rôles, `auth.users`, `auth.uid()`). Il ne crée **ni** `app_role`, **ni**
  `user_roles`, **ni** `has_role` : ces objets sont créés par la chaîne
  (20251119120031) — les pré-créer masquerait un échec. **Ne jamais appliquer
  le shim sur un projet Supabase live.**
- **Non empilable** avec les suites v1/v2 (`structured_csv_import_v1`,
  `daily_statement_units_v2`) : leurs shims créent `app_role`/`user_roles`.
  Chaque suite exige sa propre base jetable.

## Lancement

```sh
bash supabase/tests/full_chain_replay/run_full_chain.sh
```

Étapes du script :
1. Conteneur jetable `postgres:15-alpine` + shim plateforme minimal.
2. Baseline : test rollback (`BEGIN; … ROLLBACK;` → zéro table résiduelle).
3. Baseline : idempotence (2 applications successives sans erreur).
4. Full-chain : `supabase db push --db-url postgresql://…@127.0.0.1:54331`
   (aucun projet lié, aucun staging/prod).
5. Ledger local : `supabase_migrations.schema_migrations` doit être
   **exactement** la liste des fichiers de `supabase/migrations/` (le script
   calcule la liste dynamiquement — 29 versions au moment du lot 0M-E).
6. DB-FREEZE-1B : ré-application → idempotence prouvée.
7. Post-checks : RLS partout, zéro policy `USING(true)/WITH CHECK(true)`,
   tables métier vides (`user_roles` = rôles du seul user fixture, posés par
   la chaîne elle-même), `unique_excel_traceability` = `text`/`NEVER`,
   contrainte UNIQUE + `idx_collection_excel_source` + CHECK présents,
   privilèges RPC v2 (3 RPC → `authenticated` seulement, helpers verrouillés).
8. Destruction du conteneur. Sortie `ALL_FULL_CHAIN_PASS` = PASS.

Tout `TEST_FAILED:` fait échouer le script (`ON_ERROR_STOP`).

## Rappel d'architecture (lot 0M-E)

- `20250625000000_baseline_prechain.sql` reconstruit l'état pré-chaîne
  (7 tables bootstrap Bolt) — voir son en-tête.
- `20250626101100_bridge_neutralize_unique_excel_upsert.sql` neutralise
  from-scratch la contrainte de `still_violet` pour que `yellow_valley`
  (présent au ledger prod, non modifiable) passe.
- `supabase/db-archive/replay-dead-not-in-prod-ledger/` contient les deux
  migrations mortes quarantinées (absentes du ledger prod).
- `20260707000000_db_freeze_1b_collection_report_truth.sql` fait converger
  l'état final vers la vérité prod (`docs/DB_TRUTH.md`).
