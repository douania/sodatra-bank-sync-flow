# Archive — migrations mortes au rejeu, absentes du ledger prod

> Lot 0M-E (2026-07-09) — quarantine par `git mv` depuis `supabase/migrations/`.
> Aucune donnée réelle. Contenu SQL strictement inchangé (historique préservé).

## Pourquoi ces fichiers sont archivés

Ces migrations ont **échoué à leur exécution historique** (transaction annulée)
et ont été immédiatement suivies d'un retry corrigé resté, lui, dans la chaîne
active. Elles n'ont donc **jamais été appliquées nulle part** et font échouer
tout rejeu from-scratch de la chaîne :

| Fichier | Défaut fatal au rejeu | Retry corrigé (actif) |
|---|---|---|
| `20250626101725_emerald_summit.sql` | `CREATE UNIQUE INDEX unique_excel_upsert_fixed` non gardé — l'index existe déjà (créé par `yellow_valley` 3 min avant) → `42P07` | `20250627093705_raspy_union.sql` |
| `20250628121618_cold_shore.sql` | `ADD CONSTRAINT check_excel_traceability_not_null` non gardé — la contrainte existe depuis le bootstrap → `42710` | `20250628121709_shiny_waterfall.sql` |

## Preuve opérateur (ledger prod)

Vérification Dashboard Supabase prod `leakcdbbawzysfqyqsnr` du 2026-07-09
(lecture seule, opérateur humain) :

| Version | Statut ledger prod | Décision |
|---|---|---|
| `20250626100949` (still_violet) | **présent** | reste actif |
| `20250626101422` (yellow_valley) | **présent** | reste actif |
| `20250626101725` (emerald_summit) | **absent** | archivé ici |
| `20250628121618` (cold_shore) | **absent** | archivé ici |
| `20250628121709` (shiny_waterfall) | **présent** | reste actif |

`still_violet`, `yellow_valley` et `shiny_waterfall` restent dans
`supabase/migrations/` : ils sont **présents au ledger prod**, les retirer
casserait la correspondance repo ↔ prod. Le rejeu from-scratch de
`yellow_valley` est rendu possible par la migration bridge
`20250626101100_bridge_neutralize_unique_excel_upsert.sql` (lot 0M-E), sans
modification des fichiers historiques.

## Règles

- **Ne pas réintroduire** ces fichiers dans `supabase/migrations/` sans
  décision CTO explicite.
- **Ne pas modifier** leur contenu (traçabilité git).
- Leur fonctionnalité utile est intégralement portée par leurs retries actifs
  (`raspy_union`, `shiny_waterfall`) — rien n'est perdu.
