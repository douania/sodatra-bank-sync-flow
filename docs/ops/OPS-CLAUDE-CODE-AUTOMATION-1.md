# OPS-CLAUDE-CODE-AUTOMATION-1 — Workflow ChatGPT CTO ↔ Claude Code

> **Remplacé pour le workflow et les GO** par
> `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md` (canonique). Ce document reste la
> **bibliothèque canonique** des formats de rapport (§8), de verdict (§9) et
> des templates de prompts (§10). En cas de divergence sur le workflow ou les
> GO, le V2 prime.
>
> **Nomenclature des GO — sans ambiguïté** : `GO_PATCH` / `GO_COMMIT` /
> `GO_PR` / `GO_MERGE`, utilisés dans le tableau §4 et les templates §10
> ci-dessous, sont une **nomenclature historique**. Pour tout nouveau pack,
> elle est remplacée par `GO_IMPLEMENT_<PACK>`, `GO_FIX_<PACK>` et
> `GO_MERGE_PR_<N>` (V2 §4.1). À la réutilisation d'un template §10,
> substituer les GO historiques par la nomenclature V2.

## 1. Statut

- **PASS DESIGN** — supplanté partiellement par OPS-WORKFLOW-V2 (voir bandeau)
- Documentation OPS
- Non applicatif
- Aucun impact runtime
- Aucun impact DB/RLS/Auth

## 2. Objectif

- Accélérer l'exécution des lots Claude Code sans perdre le contrôle CTO.
- Standardiser le cycle complet : audit, patch, tests, commit, PR, review indépendante et verdict CTO.
- Rendre chaque lot reproductible, auditable et vérifiable a posteriori.

## 3. Principes non négociables

1. **ChatGPT reste CTO / architecte / arbitre final.** Toute décision de merge, de périmètre ou d'arbitrage technique lui revient.
2. **Claude Code exécute** : branches, patchs, tests, diffs, commits, PR. Il ne décide pas du périmètre, il l'applique.
3. **Une seule IA applique un patch à la fois.** Jamais deux exécutants simultanés sur la même branche ou le même périmètre.
4. **Aucun merge sans verdict CTO explicite.**
5. **Tout ce qui n'est pas explicitement autorisé est interdit.** Le périmètre d'un lot est une liste blanche, pas une liste noire.
6. **Pas de données bancaires réelles.** Uniquement des fixtures anonymisées ou synthétiques.
7. **Pas de secrets** : aucune clé API, credential ou token dans le code, les docs, les commits ou les PR.
8. **Pas de Supabase live sans GO explicite.**
9. **Pas de SQL sans GO explicite.**
10. **Pas de migration sans GO explicite.**
11. **Pas de refactor global.** Un lot = un périmètre chirurgical.
12. **Préserver en toutes circonstances** : sécurité, RLS/Auth, idempotence des imports, intégrité des données, auditabilité.

## 4. Workflow standard « Lot Claude Code »

| Étape | Responsable | Contenu |
|---|---|---|
| 1. Qualification CTO du lot | ChatGPT CTO | Définit objectif, périmètre (fichiers autorisés/interdits), niveau, GO_PATCH / GO_COMMIT / GO_PR / GO_MERGE, tests obligatoires, stop conditions spécifiques. |
| 2. Préflight Claude Code | Claude Code | Vérifie repo, branche, HEAD attendu, working tree propre. STOP immédiat en cas de divergence. |
| 3. Création branche | Claude Code | Branche dédiée depuis `origin/main` (ou base spécifiée), nommage explicite par lot. |
| 4. Exécution contrôlée | Claude Code | Modifie uniquement les fichiers autorisés. Toute nécessité hors périmètre = STOP + rapport BLOCKED. |
| 5. Tests obligatoires | Claude Code | Exécute la matrice de tests correspondant au type de lot (section 7). Résultats bruts reportés sans embellissement. |
| 6. Commit | Claude Code | Uniquement si GO_COMMIT et si le diff est conforme au périmètre. Message de commit imposé ou conventionnel. |
| 7. PR | Claude Code | Uniquement si GO_PR et si le commit est conforme. Titre et corps au format imposé par le lot. Jamais de merge. |
| 8. Review indépendante | Une IA distincte de l'exécutant | Relit le diff de la PR sans contexte d'exécution, vérifie périmètre, sécurité, cohérence. Produit un avis séparé. |
| 9. Verdict CTO final | ChatGPT CTO | PASS / PASS_WITH_RESERVES / FAIL / BLOCKED. Seul le CTO déclenche le merge (ou le demande à l'humain). |

## 5. Niveaux de lot

| Niveau | Usage | Exigences |
|---|---|---|
| **Moyen** | Docs, OPS, UI simple, correctifs localisés sans impact données. | Préflight complet, tests de la matrice, rapport standard, review indépendante recommandée. |
| **Élevé** | Logique métier, parsers, pipelines d'import, comportements observables. | Préflight complet, tests de la matrice + tests ciblés du domaine, rapport standard détaillé, review indépendante obligatoire. |
| **Très approfondi** | DB, RLS, Auth, sécurité, migrations (draft), tout ce qui touche l'intégrité ou l'accès aux données. | Tout ce qui précède + analyse de risques explicite, aucun SQL live, review indépendante obligatoire, GO CTO séparé pour toute application réelle. |

Un lot qualifié « moyen » qui révèle en cours d'exécution un besoin de niveau supérieur doit s'arrêter (stop condition) et être requalifié par le CTO.

## 6. Stop conditions permanentes

Claude Code s'arrête immédiatement et rend un rapport **BLOCKED** si l'une des conditions suivantes survient :

1. Mauvais repo.
2. Mauvaise branche de base.
3. HEAD différent du SHA attendu.
4. `git status` non propre au préflight.
5. Un fichier nécessaire au lot est hors périmètre autorisé.
6. Un fichier explicitement interdit devient nécessaire.
7. Modification de package/lockfile nécessaire sans GO.
8. Migration nécessaire sans GO.
9. SQL nécessaire sans GO.
10. Accès Supabase live nécessaire sans GO.
11. Auth/RLS/sécurité touché alors que le lot n'est pas de niveau très approfondi.
12. Secrets nécessaires (clé, token, credential).
13. Données bancaires réelles nécessaires.
14. Le lot dérive vers un refactor global.
15. Tests cassés hors du périmètre du lot (régression préexistante ou induite ailleurs).
16. Runtime non vérifiable (impossible de valider le comportement attendu par les moyens autorisés).
17. Ambiguïté métier non tranchée par le prompt du lot.
18. Diff opportuniste : toute modification « en passant » non demandée.
19. Incapacité à expliquer chaque modification ligne par ligne.

Un STOP n'est pas un échec : c'est le comportement attendu. Le rapport BLOCKED doit préciser la condition déclenchée et l'état exact du dépôt.

## 7. Tests obligatoires (matrice par type de lot)

| Type de lot | Commandes obligatoires |
|---|---|
| Docs / OPS only | `git diff --check` |
| UI simple | `npm run lint` + `npm run build` |
| BDK PDF | `npm run lint` + `npm run build` + `npm run test:bdk-pdf` |
| Structured CSV | `npm run lint` + `npm run build` + `npm run test:structured-csv-all` |
| DB/RLS draft | Pas de SQL live. Review indépendante obligatoire. |
| DB/RLS migration future | GO CTO séparé, hors de tout lot standard. |

Règles :

- Les résultats de tests sont reportés bruts (PASS/FAIL + sortie pertinente), jamais résumés en « ça devrait passer ».
- Un test FAIL dans le périmètre = correction dans le lot ou rapport FAIL.
- Un test FAIL hors périmètre = stop condition 15.

## 8. Format standard du rapport Claude Code

Chaque lot se termine par un rapport au format suivant :

```markdown
# Rapport Claude Code — <ID-DU-LOT>

## 1. Métadonnées
- Repo :
- Branche de base :
- HEAD attendu :
- HEAD vérifié :
- Branche de travail :
- Mode : (AUDIT / PATCH / DOCS-ONLY / …)
- Niveau : (moyen / élevé / très approfondi)
- GO_COMMIT : oui/non
- GO_PR : oui/non

## 2. Objectif
- Rappel en une ou deux phrases de l'objectif du lot.

## 3. Préflight
- git status initial :
- origin/main :
- divergence : oui/non
- stop condition déclenchée : aucune / n° + description

## 4. Périmètre
- Fichiers autorisés :
- Fichiers effectivement touchés :
- Écart : aucun / description

## 5. Résumé exécutif
- 3 à 5 phrases maximum : ce qui a été fait, ce qui a été vérifié, ce qui reste au CTO.

## 6. Diagnostic
- Constats factuels faits pendant le lot (état du code, causes, contexte).

## 7. Changements réalisés
- Liste fichier par fichier, avec justification de chaque modification.

## 8. Sécurité / données sensibles
- Secret ajouté : oui/non
- Données bancaires réelles utilisées : oui/non
- SQL exécuté : oui/non
- Supabase live : oui/non
- Migration : oui/non
- Auth/RLS touché : oui/non

## 9. Tests exécutés
| Commande | Résultat | Notes |
|---|---:|---|
| … | PASS/FAIL | |

## 10. Résultats
- Interprétation factuelle des tests (pas de promesse).

## 11. Diff summary
- Fichiers modifiés :
- Lignes ajoutées :
- Lignes supprimées :

## 12. Risques résiduels
- Liste explicite, même si « aucun identifié ».

## 13. Recommandation Claude Code
- PASS / PASS_WITH_RESERVES / FAIL / BLOCKED + justification courte.

## 14. Actions demandées au CTO
- Review, verdict, GO suivant, requalification, etc.
```

## 9. Format standard du verdict CTO ChatGPT

Le CTO répond à chaque rapport avec le format suivant :

```markdown
# Verdict CTO — <ID-DU-LOT>

## 1. Décision
- PASS / PASS_WITH_RESERVES / FAIL / BLOCKED

## 2. Base vérifiée
- Rapport Claude Code lu : oui/non
- Diff PR relu : oui/non
- Review indépendante reçue : oui/non
- SHA / PR vérifiés :

## 3. Résumé CTO
- Lecture indépendante du lot en 2 à 4 phrases.

## 4. Conformité au périmètre
- Fichiers touchés vs autorisés : conforme / non conforme + détail.

## 5. Tests
- Matrice exigée : respectée / non respectée.
- Résultats acceptés : oui/non.

## 6. Analyse des risques
- Risques identifiés par le CTO (sécurité, données, régression, dette).

## 7. Points bloquants
- Liste (vide si aucun). Tout point bloquant ⇒ décision ≠ PASS.

## 8. Réserves non bloquantes
- Liste des points à traiter dans un lot futur (avec renvoi backlog si pertinent).

## 9. Décision finale
- Merge autorisé : oui/non
- Conditions éventuelles :

## 10. Prochaine action
- Qui fait quoi (merge, nouveau lot, requalification, clôture).
```

## 10. Templates de prompts Claude Code

> Rappel : les mentions `GO_PATCH` / `GO_COMMIT` / `GO_PR` / `GO_MERGE` des
> templates ci-dessous sont historiques — substituer la nomenclature V2
> (`GO_IMPLEMENT_<PACK>`, `GO_FIX_<PACK>`, `GO_MERGE_PR_<N>`) à l'usage.

### 10.1 Audit read-only

```text
Repo : douania/sodatra-bank-sync-flow
Branche : main
HEAD attendu : <SHA>

CHANTIER : <ID-AUDIT>
MODE : AUDIT READ-ONLY
NIVEAU : <moyen | élevé | très approfondi>
GO_PATCH : NON
GO_COMMIT : NON
GO_PR : NON
GO_MERGE : NON

Objectif :
<question précise à laquelle l'audit doit répondre>

Périmètre de lecture :
<fichiers / dossiers à examiner>

Interdits :
- Aucune modification de fichier.
- Aucun commit, aucune branche.
- Aucune commande d'écriture.
- Aucun accès Supabase live, aucun SQL.

Préflight : git status --short, git branch --show-current, git fetch origin,
git rev-parse HEAD, git rev-parse origin/main. STOP si divergence.

Livrable :
Rapport d'audit factuel (constats, références fichier:ligne, risques,
recommandations), sans aucun patch.
```

### 10.2 Patch chirurgical

```text
Repo : douania/sodatra-bank-sync-flow
Branche canonique : main
HEAD attendu : <SHA>

CHANTIER : <ID-PATCH>
MODE : PATCH CHIRURGICAL
NIVEAU : <moyen | élevé>
GO_PATCH : OUI
GO_COMMIT : OUI, uniquement si diff conforme
GO_PR : OUI, uniquement si commit conforme
GO_MERGE : NON

Objectif :
<défaut précis à corriger, comportement attendu>

Fichiers autorisés :
- <liste exhaustive>

Fichiers interdits :
- Tout fichier non listé comme autorisé.
- package/lockfiles, .env*, migrations, supabase/*, sauf GO explicite.

Stop conditions : voir OPS-CLAUDE-CODE-AUTOMATION-1 section 6.

Branche à créer : <type>/<id-lot>

Tests obligatoires : <ligne correspondante de la matrice section 7>

Commit attendu : "<message imposé>"
PR attendue : titre + corps au format du lot. Ne pas merger.

Rapport final : format OPS-CLAUDE-CODE-AUTOMATION-1 section 8.
```

### 10.3 Lot fonctionnel moyen

```text
Repo : douania/sodatra-bank-sync-flow
Branche canonique : main
HEAD attendu : <SHA>

CHANTIER : <ID-LOT>
MODE : PATCH FONCTIONNEL
NIVEAU : MOYEN
GO_PATCH : OUI
GO_COMMIT : OUI, uniquement si diff conforme
GO_PR : OUI, uniquement si commit conforme
GO_MERGE : NON

Objectif :
<fonctionnalité ou correctif, critères d'acceptation vérifiables>

Fichiers autorisés :
- <liste exhaustive, périmètre fermé>

Interdits absolus :
- DB, RLS, Auth, migrations, SQL, Supabase live.
- Secrets, données bancaires réelles.
- Refactor global, diff opportuniste.
- package/lockfiles.

Stop conditions : OPS-CLAUDE-CODE-AUTOMATION-1 section 6.
Tests obligatoires : <matrice section 7 selon le domaine>.
Branche : <type>/<id-lot>
Commit + PR : formats imposés par le lot. Ne pas merger.
Rapport final : format section 8. Attendre verdict CTO.
```

### 10.4 Lot DB/RLS très approfondi

```text
Repo : douania/sodatra-bank-sync-flow
Branche canonique : main
HEAD attendu : <SHA>

CHANTIER : <ID-LOT-DB>
MODE : DRAFT DB/RLS (aucune exécution)
NIVEAU : TRÈS APPROFONDI
GO_PATCH : OUI (fichiers draft uniquement)
GO_COMMIT : OUI, uniquement si diff conforme
GO_PR : OUI, uniquement si commit conforme
GO_MERGE : NON
GO_SQL_LIVE : NON
GO_MIGRATION : NON

Objectif :
<schéma / policy / contrainte à concevoir, invariants à préserver>

Fichiers autorisés :
- <fichiers draft explicites, ex : docs ou drafts de migration NON exécutés>

Interdits absolus :
- Toute exécution SQL, toute commande Supabase, tout accès DB live.
- Toute migration appliquée.
- Données bancaires réelles, secrets.

Exigences spécifiques :
- Analyse de risques explicite : RLS, Auth, intégrité, idempotence, rollback.
- Chaque décision de conception justifiée dans le rapport.
- Review indépendante obligatoire avant tout verdict.
- L'application réelle (migration/SQL) fera l'objet d'un GO CTO séparé.

Stop conditions : section 6, en particulier n° 8, 9, 10, 11.
Rapport final : format section 8, avec section risques développée.
```

### 10.5 Review indépendante

```text
Repo : douania/sodatra-bank-sync-flow
PR à reviewer : <URL ou numéro>
HEAD de la PR : <SHA>

CHANTIER : <ID-LOT>-REVIEW
MODE : REVIEW INDÉPENDANTE READ-ONLY
GO_PATCH : NON
GO_COMMIT : NON
GO_MERGE : NON

Contexte :
Tu n'es PAS l'exécutant du lot. Tu relis le diff sans présumer de sa validité.

À vérifier :
1. Périmètre : chaque fichier touché est-il dans la liste autorisée du lot ?
2. Diff opportuniste : y a-t-il des modifications non demandées ?
3. Sécurité : secrets, données sensibles, RLS/Auth, surfaces d'attaque.
4. Cohérence : le diff fait-il ce que le rapport Claude Code affirme ?
5. Tests : la matrice exigée a-t-elle été exécutée, les résultats sont-ils
   plausibles au vu du diff ?

Interdits :
- Aucune modification, aucun commit, aucun merge.
- Aucune exécution de code au-delà des commandes de lecture git.

Livrable :
Avis de review : CONFORME / NON CONFORME / RÉSERVES, avec justification
point par point. Cet avis alimente le verdict CTO, il ne le remplace pas.
```

## 11. Plan d'automatisation prudent

| Phase | Contenu | Statut |
|---|---|---|
| Phase 1 | Utiliser les templates de la section 10 pour tous les lots, sans patch applicatif lié à l'automatisation elle-même. | Active |
| Phase 2 | Documentation OPS dans le repo (ce document). | Livrée |
| Phase 3 | PR template (`.github/PULL_REQUEST_TEMPLATE.md`). | Livrée |
| Phase 4 (future) | Labels GitHub par type/niveau de lot. Chantier séparé ou action manuelle. | Non lancée |
| Phase 5 | CI minimale (`.github/workflows/ci.yml` : lint advisory + ratchet ESLint + build). | Livrée |
| Phase 6 | Workflow V2 : `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md` (canonique workflow/GO). | Livrée |

**Note de périmètre historique** : à sa création, ce lot ne modifiait que le
présent document ; les phases livrées depuis ont chacune fait l'objet de leur
propre lot CTO.

## 12. Critères PASS/FAIL de ce lot

### PASS si

- Un seul fichier créé/modifié : `docs/ops/OPS-CLAUDE-CODE-AUTOMATION-1.md`.
- Aucun autre fichier modifié.
- Aucun contenu sensible.
- Aucun secret.
- `git diff --check` : PASS.
- Commit créé si conforme.
- PR créée vers `main` si conforme.

### FAIL / BLOCKED si

- Besoin d'un autre fichier que celui autorisé.
- `origin/main` différent du SHA attendu.
- Working tree non propre.
- Ambiguïté sur le périmètre.
- Commande destructive requise.
- Secret ou donnée bancaire réelle nécessaire.
