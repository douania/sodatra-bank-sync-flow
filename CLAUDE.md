# CLAUDE.md — Règles projet pour Claude Code

Application bancaire sensible. Ces règles priment sur tout comportement par défaut.

## 1. Rôle de Claude Code

- Claude Code exécute : branches, patchs, tests, diffs, commits, PR.
- ChatGPT reste CTO / architecte / arbitre final.
- Claude Code ne décide pas seul du périmètre d'un lot.
- **Aucun merge.** Toute PR attend le verdict CTO.

## 2. Règles non négociables

- Une seule IA applique un patch à la fois.
- Tout ce qui n'est pas explicitement autorisé par le lot est interdit.
- Pas de secrets (clés API, tokens, credentials).
- Les fichiers bancaires réels fournis volontairement par le CTO peuvent être
  utilisés uniquement si le pack les autorise explicitement, pour diagnostic,
  parsing, validation fonctionnelle ou import dans un environnement SODATRA
  validé.
- Il est interdit de committer, pousser, publier ou intégrer ces fichiers — ou
  leurs données non anonymisées — dans GitHub, les fixtures, les tests, la
  documentation, les logs, les captures publiques ou les prompts réutilisables.
- Minimiser les données exposées : ne pas reproduire inutilement les numéros de
  compte complets, IBAN, opérations, soldes ou identités. Supprimer les copies
  temporaires après traitement.
- Toute transmission à Lovable ou à un autre service doit être nécessaire au
  pack et explicitement autorisée.
- Pas de Supabase live sans GO explicite. Les GO d'environnement sont
  distincts, nominatifs et non implicites : `GO_VALIDATE_STAGING_<PACK>`,
  `GO_APPLY_STAGING_<PACK>`, `GO_PRODUCTION_<PACK>_<ACTION>`
  (taxonomie : `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md` §4).
- Pas de SQL sans GO explicite.
- Pas de migration sans GO explicite.
- Pas de refactor global.
- Préserver : sécurité, RLS/Auth, idempotence, intégrité des données, auditabilité.

## 2bis. Règle anti-fragmentation des lots

Sauf bug critique isolé, un chantier doit être traité comme **un pack fonctionnel complet**, pas comme une succession de micro-PR.

Règles :

- 1 chantier = 1 pack fonctionnel complet.
- Un pack peut contenir des sous-sections internes, mais elles doivent rester coordonnées dans le même objectif métier.
- Ne pas créer une PR par micro-détail si les changements appartiennent au même chantier fonctionnel.
- Préférer une PR unique par pack, avec diagnostic, patchs coordonnés, tests, risques et clôture.
- Les micro-lots sont réservés aux cas suivants :
  - bug critique isolé ;
  - hotfix bloquant ;
  - correction de sécurité ;
  - rollback ;
  - micro-fix explicitement demandé par le CTO.
- Si un pack devient trop large ou risqué, proposer un découpage en sous-lots fonctionnels cohérents, pas en fragments techniques artificiels.

## 3. Préflight obligatoire (avant tout travail)

```
git status --short
git branch --show-current
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

Vérifier : bon repo, HEAD attendu, working tree propre. **Sur un checkout monté depuis un pont Linux (autocrlf), un `git status --short` massif peut être du bruit de fin de ligne pur : vérifier avec `git diff --ignore-cr-at-eol --stat` (dernière ligne = total réel) avant de conclure à un working tree non propre.**

## 4. Stop conditions permanentes

STOP immédiat + rapport BLOCKED si :

- mauvais repo ;
- mauvais HEAD / origin/main différent du HEAD attendu ;
- working tree non propre (après exclusion du bruit CRLF, voir §3) ;
- fichier nécessaire hors périmètre du lot ;
- fichier interdit nécessaire ;
- package.json / lockfile nécessaire sans GO ;
- migration nécessaire sans GO ;
- SQL nécessaire sans GO ;
- Supabase live nécessaire sans GO ;
- secrets nécessaires ;
- données bancaires réelles nécessaires mais non volontairement fournies ou non
  explicitement autorisées par le pack, destination non maîtrisée, ou risque de
  commit, journalisation ou publication ;
- Auth/RLS/sécurité touché hors niveau « très approfondi » ;
- refactor global requis ;
- ambiguïté métier non tranchée ;
- tests cassés hors périmètre ;
- runtime non vérifiable.

## 5. Matrice de tests par type de lot

| Type de lot | Checks minimum |
|---|---|
| Docs/OPS only | `git diff --check` |
| UI simple | `npm run lint` + `npm run build` |
| BDK PDF | `npm run lint` + `npm run build` + `npm run test:bdk-pdf` |
| Structured CSV | `npm run lint` + `npm run build` + `npm run test:structured-csv-all` |
| DB/RLS draft | pas de SQL live + review indépendante obligatoire |

La liste canonique des scripts `test:*` vit dans `package.json`. La
comparaison aux baselines (lint, typecheck, tests) suit `docs/BASELINES.md`.

## 6. Format du rapport final

Chaque lot se termine par un rapport court :

1. **Métadonnées** — repo, branche, HEAD attendu/vérifié, mode, niveau, GO reçus.
2. **Préflight** — résultats, divergences, stop conditions.
3. **Fichiers modifiés** — liste exhaustive.
4. **Sécurité** — secrets / données réelles / SQL / Supabase live / migration / Auth-RLS : oui-non.
5. **Tests** — tableau commande → PASS/FAIL.
6. **Diff summary** — fichiers, lignes ajoutées/supprimées.
7. **Risques** — risques résiduels.
8. **Recommandation** — PASS / PASS_WITH_RESERVES / FAIL / BLOCKED.

## 7. Lovable MCP / build Windows

- `supabase/functions/mcp/index.ts` est un **artefact généré** par le plugin Lovable MCP (`@lovable.dev/mcp-js`, sandbox Linux de Lovable).
- **Ne jamais committer une version régénérée depuis Windows** : le plugin y produit un bundle cassé (`import "npm:C:\..."`) qui fuite le chemin local et casse le déploiement.
- Si `npm run build` modifie ce fichier : **STOP**, puis `git restore supabase/functions/mcp/index.ts` avant toute PR.
- Interdiction de référencer `import.meta.env` dans `src/lib/mcp/**` (risque d'inlining de variables d'environnement locales dans l'artefact).
- Toute modification MCP (tools, manifest, auth) nécessite une revue CTO séparée.

## 7bis. Normalisation native Lovable

L'utilisation du connecteur Supabase ou du mode plan par Lovable peut créer une
nouvelle version interne Lovable et produire automatiquement les artefacts
suivants :

- normalisation de `.env`, limitée à `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY` et `VITE_SUPABASE_PROJECT_ID` ;
- création ou mise à jour de `.lovable/plan.md` avec le plan ou le rapport de
  l'audit demandé ;
- régénération de `src/integrations/supabase/types.ts` depuis les seules
  métadonnées de schéma exposées par le connecteur Supabase.

Ces effets sont attendus, non bloquants, compatibles avec un GO read-only et ne
nécessitent ni GO d'écriture ni rollback systématique, uniquement si toutes les
conditions suivantes sont réunies :

- le projet Lovable est un projet staging isolé et la cible est exactement
  `gbbsqcscryygqlmqncyv` ;
- seule une clé publique frontend est utilisée ;
- le diff de `types.ts` ne contient que des types de schéma générés (tables,
  vues, fonctions, enums ou relations), sans valeur métier, credential ni
  logique applicative ;
- les changements restent dans la version interne Lovable : aucun sync, commit,
  push ou PR GitHub n'est produit par le GO read-only ;
- aucune publication, aucun déploiement, aucune mutation DB et aucune lecture
  de donnée métier ne sont effectués ;
- aucun autre fichier ou secret n'est modifié, et le commit Lovable ainsi que le
  diff exact des artefacts attendus sont consignés dans le rapport.

Tout prompt Lovable read-only intègre cette exception sans nouvelle autorisation
du CTO. Le verdict applicable est
`PASS_WITH_EXPECTED_LOVABLE_NORMALIZATION`, pas `BLOCKED_SIDE_EFFECT`.

Un rollback de ces seuls artefacts n'est réalisé que sur demande explicite du
CTO ou si leur contenu dépasse cette liste blanche. STOP si la production est
référencée, si une clé privilégiée apparaît, si un autre fichier est modifié,
si un changement atteint GitHub, si une publication ou une mutation DB est
effectuée, si une donnée métier est lue, ou si le diff exact ne peut pas être
vérifié.

## 8. Références canoniques

Ce fichier porte les règles permanentes. Le reste vit ailleurs, sans copie :

| Sujet | Source |
|---|---|
| Workflow des lots, taxonomie des GO, politique de review | `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md` |
| Point d'entrée agents IA | `AGENTS.md` |
| Architecture, modules, FROZEN | `docs/MASTER_CONTEXT.md` |
| Baselines lint/typecheck/tests | `docs/BASELINES.md` |
| Seuil ESLint exécutable | `.github/workflows/ci.yml` |
| Templates de prompts, formats rapport/verdict | `docs/ops/OPS-CLAUDE-CODE-AUTOMATION-1.md` |
| File d'attente d'arbitrage CTO (mode autopilot) | `docs/CTO_GO_QUEUE.md` |

## 9. Escalade automatique (mode autopilot planifié)

En tâche planifiée (sans utilisateur présent), Claude Code peut exécuter un pack déjà couvert par
un GO existant, jusqu'à : diagnostic, patch, tests, commit local sur une branche dédiée. Comme en
session interactive, **jamais de merge**, et depuis l'environnement planifié, **jamais de push ni
d'ouverture de PR** (aucun identifiant Git n'y est disponible) — la branche reste locale et son
push est signalé dans le résumé de fin de passage pour que l'utilisateur ou une session Codex avec
accès natif l'ouvre en PR.

Si le travail restant nécessite un nouveau verdict CTO (nouveau périmètre, GO d'environnement,
ambiguïté métier, ou toute stop condition du §4) : ne pas rester bloqué en attente d'une réponse
synchrone. Consigner une entrée `PENDING` dans `docs/CTO_GO_QUEUE.md`, committer uniquement ce
fichier (jamais le code du pack), puis passer au pack sûr suivant s'il y en a un, ou terminer
proprement.

Garde-fous supplémentaires propres au mode autopilot :
- Ne jamais committer un fichier modifié dans les 15 dernières minutes (risque d'édition en cours
  par un autre agent ou par l'utilisateur).
- Un passage planifié qui ne trouve rien de sûr à faire et aucune entrée `GO` à traiter se termine
  sans rien committer — ce n'est pas un échec.
- Les garde-fous données bancaires réelles (§2) et Lovable/MCP (§7, §7bis) s'appliquent sans
  exception au mode autopilot.
