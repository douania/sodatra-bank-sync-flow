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
- Pas de données bancaires réelles.
- Pas de Supabase live sans GO explicite.
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

Vérifier : bon repo, HEAD attendu, working tree propre.

## 4. Stop conditions permanentes

STOP immédiat + rapport BLOCKED si :

- mauvais repo ;
- mauvais HEAD / origin/main différent du HEAD attendu ;
- working tree non propre ;
- fichier nécessaire hors périmètre du lot ;
- fichier interdit nécessaire ;
- package.json / lockfile nécessaire sans GO ;
- migration nécessaire sans GO ;
- SQL nécessaire sans GO ;
- Supabase live nécessaire sans GO ;
- secrets nécessaires ;
- données bancaires réelles nécessaires ;
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
