# OPS-WORKFLOW-V2-BANK-SYNC — Workflow canonique des lots

## 1. Statut

- **Canonique** pour le workflow des lots et la taxonomie des GO.
- Documentation OPS, non applicatif, aucun impact runtime/DB/RLS/Auth.
- Remplace `OPS-CLAUDE-CODE-AUTOMATION-1.md` comme source du workflow ;
  le document V1 reste la bibliothèque de templates de prompts et de formats
  de rapport (sections 8 à 10 du V1).

## 2. Sources canoniques (répartition sans duplication)

| Sujet | Source canonique unique |
|---|---|
| Règles permanentes Claude Code (préflight, stop conditions, sécurité) | `CLAUDE.md` |
| Workflow des lots et taxonomie des GO | ce document |
| Pointeur d'entrée pour tout agent IA | `AGENTS.md` |
| Architecture, modules, FROZEN | `docs/MASTER_CONTEXT.md` |
| Seuil ESLint exécutable (ratchet) | `.github/workflows/ci.yml` |
| Méthodologie baselines (lint, typecheck, tests) | `docs/BASELINES.md` |
| Scripts de test `test:*` | `package.json` |
| Templates de prompts / formats de rapport et verdict | `docs/ops/OPS-CLAUDE-CODE-AUTOMATION-1.md` |

Règle : aucun de ces contenus n'est recopié intégralement dans un autre
document. Un document qui a besoin d'une règle la **référence**.

## 3. Cycle de vie d'un lot

1. **Qualification CTO** : objectif, périmètre en liste blanche, niveau,
   GO accordés, tests obligatoires, stop conditions spécifiques.
2. **Préflight Claude Code** : selon `CLAUDE.md` §3. STOP si divergence.
3. **Isolation** : branche dédiée depuis `origin/main` vérifié. Si le working
   tree principal porte un lot non commité à préserver, un **worktree Git
   isolé** est le mécanisme autorisé — le lot en cours n'est jamais stashé,
   commité ou nettoyé pour faire de la place.
4. **Exécution** : fichiers autorisés uniquement ; tout besoin hors périmètre
   est une stop condition (`CLAUDE.md` §4).
5. **Validations** : matrice du lot + comparaison aux baselines
   (`docs/BASELINES.md`). Résultats bruts, jamais résumés en intention.
6. **Rapport Claude Code** : format V1 §8.
7. **Review ChatGPT : obligatoire pour tout lot.** Le CTO relit rapport et
   diff avant tout verdict.
8. **Seconde IA indépendante : proportionnée au risque.** Elle est
   **obligatoire** dès que le lot touche : DB, migration, Auth/RLS, sécurité,
   concurrence, idempotence, ou calcul financier critique. Pour les lots
   docs/UI simples, elle est recommandée mais le CTO peut l'omettre.
9. **Verdict CTO** : format V1 §9. Seul le CTO déclenche un merge.

## 4. Taxonomie des GO

Chaque GO est nominatif : il porte l'identifiant du pack (`<PACK>`) ou de la
PR (`<N>`) qu'il autorise, et ne vaut pour rien d'autre.

### 4.1 GO de cycle (par pack)

- `GO_IMPLEMENT_<PACK>` — autorise, dans le périmètre approuvé du pack :
  branche dédiée, patch, corrections internes, tests, diff, commit, push vers
  `origin` et ouverture d'une **draft PR**.
- `GO_FIX_<PACK>` — autorise les corrections demandées par la review, dans le
  **même périmètre** et sur la **même branche** : tests, commit, push.
- `GO_MERGE_PR_<N>` — autorise **uniquement** le merge de la PR désignée,
  après vérification de son head SHA exact.

`GO_IMPLEMENT_<PACK>` et `GO_FIX_<PACK>` n'autorisent **jamais** : merge,
staging, DB, migration, déploiement, production, ni élargissement matériel du
périmètre.

### 4.2 GO d'environnement (distincts et nominatifs)

| GO | Autorise | N'autorise PAS |
|---|---|---|
| `GO_VALIDATE_STAGING_<PACK>` | Validation **read-only par défaut** sur le staging autorisé (`gbbsqcscryygqlmqncyv`) ; toute opération runtime au-delà de la lecture doit être **précisément énumérée** par le GO | mutation de données, SQL write, migration, `db push`, production |
| `GO_APPLY_STAGING_<PACK>` | Uniquement les **écritures staging précisément énumérées**, sur le `project_ref` exact | production |
| `GO_PRODUCTION_<PACK>_<ACTION>` | **Une action production exacte**, sur une cible exacte, dans un périmètre exact | toute autre action : aucune autorisation générale implicite |

Règles :

- ces GO sont **indépendants** : aucun n'implique un autre ;
- un GO d'environnement ne vaut que pour le pack qui le porte ;
- en l'absence explicite d'un GO d'environnement, l'environnement est
  interdit ;
- **aucun GO d'environnement n'est accordé par le présent chantier.**
- la normalisation technique native de Lovable définie dans `CLAUDE.md`
  §7bis ne constitue ni une mutation métier ni un `GO_APPLY_STAGING`
  lorsqu'elle reste dans sa liste blanche ; cette exception est incluse par
  défaut dans tout prompt Lovable read-only.

## 5. Baselines et non-régression

Tout lot qui exécute lint, typecheck ou tests compare ses résultats à la
baseline `origin/main` selon la procédure de `docs/BASELINES.md`.
Principes :

- zéro nouvelle erreur imputable au lot ;
- la dette préexistante n'est **pas** corrigée hors périmètre ;
- le seuil ESLint exécutable vit dans `.github/workflows/ci.yml` (ratchet) ;
- le typecheck n'a pas de gate CI : sa baseline se **mesure** sur
  `origin/main` au moment du lot.

## 6. Ce que ce document ne couvre pas

- Les stop conditions permanentes : `CLAUDE.md` §4.
- Les formats de rapport/verdict et les templates de prompts : V1 §8–10.
- L'état des lots : `docs/STATUS_REGISTRY.md`.
