# Pull Request

> Rappels non négociables (`CLAUDE.md`, workflow : `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md`) :
> - **Aucun merge sans verdict CTO.**
> - **Tout fichier non explicitement autorisé par le lot est interdit.**
> - **Pas de données bancaires réelles.**
> - **Pas de secrets.**
> - **Pas de SQL / Supabase live / migration sans GO CTO explicite.**

## Objectif

<!-- Que fait cette PR et pourquoi ? -->

## Périmètre

<!-- Lot / chantier concerné, limites explicites du périmètre. -->

## GO reçus

<!-- Identifiants exacts des GO du lot (cycle et environnement). -->

- GO de cycle : <!-- ex. GO_IMPLEMENT_<PACK> ou GO_FIX_<PACK> -->
- GO d'environnement : <!-- aucun par défaut ; GO_VALIDATE_STAGING_<PACK> / GO_APPLY_STAGING_<PACK> / GO_PRODUCTION_<PACK>_<ACTION> si accordés -->
- Merge : <!-- uniquement via GO_MERGE_PR_<N> séparé, après vérification du head SHA -->


## Fichiers modifiés

<!-- Liste exhaustive des fichiers créés / modifiés / supprimés. -->

- ...

## Fichiers interdits touchés

- [ ] Non
- [ ] Oui (justification obligatoire + arbitrage CTO requis)

## Type de lot

- [ ] docs/ops
- [ ] UI simple
- [ ] parser
- [ ] ingestion/service
- [ ] DB/RLS/Auth
- [ ] CI/ops

## Niveau

- [ ] moyen
- [ ] élevé
- [ ] très approfondi

## Sécurité

| Question | Réponse |
|---|---|
| Secrets ajoutés | oui / non |
| Données bancaires réelles utilisées | oui / non |
| SQL exécuté | oui / non |
| Supabase live utilisé | oui / non |
| Migration créée/modifiée | oui / non |
| Auth/RLS touché | oui / non |

## Tests / checks exécutés

<!-- Commandes exécutées (ex : git diff --check, npm ci, npm run lint, npm run build, tests ciblés). -->

- ...

## Comparaison aux baselines

<!-- Procédure : docs/BASELINES.md. Seuil ESLint exécutable : .github/workflows/ci.yml. -->

| Contrôle | Baseline origin/main | Branche | Nouvelles erreurs |
|---|---|---|---|
| Typecheck (`npx tsc -p tsconfig.app.json --noEmit`) | | | |
| ESLint | | | |

## Résultats

<!-- PASS/FAIL par commande, extraits pertinents si FAIL. -->

- ...

## Review

- [ ] Review ChatGPT CTO demandée (obligatoire pour tout lot)
- [ ] Seconde IA indépendante requise — le lot touche : DB / migration / Auth-RLS / sécurité / concurrence / idempotence / calcul financier critique
- [ ] Seconde IA indépendante effectuée (joindre l'avis) ou explicitement omise par le CTO (lot à faible risque)

## Risques résiduels

- ...

## Stop conditions rencontrées

<!-- Aucune, ou liste des stop conditions rencontrées et comment elles ont été traitées. -->

- ...

## Verdict demandé au CTO

<!-- Ex : review + GO merge, review seule, arbitrage sur point X. -->
