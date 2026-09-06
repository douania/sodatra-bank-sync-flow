# BASELINES — mesure et non-régression

> Méthodologie canonique de comparaison d'un lot à `origin/main`.
> Workflow et GO : `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md`.

## 1. Principes

- Une baseline se **mesure** sur `origin/main` au moment du lot ; elle ne se
  présume pas depuis un ancien rapport.
- Baseline et branche se mesurent **avec les versions du lockfile** (`npm ci`)
  et **la même version Node/npm** ; le rapport cite ces versions.
- Critère d'acceptation d'un lot : **zéro nouvelle erreur** (lint, typecheck)
  et **zéro test cassé** imputables au lot.
- La dette préexistante est documentée, jamais corrigée hors périmètre.
- Les chiffres cités ici sont des **instantanés datés, non canoniques** : la
  vérité est la mesure du jour.

## 2. ESLint

- **Source canonique exécutable : le job « ESLint ratchet » de
  `.github/workflows/ci.yml`.** Le seuil chiffré vit là-bas et uniquement
  là-bas ; ce document ne le recopie pas.
- Localement : `npm run lint` reste indicatif (dette historique connue) ; la
  comparaison fine se fait item par item avec la procédure §5.
- Instantané Pack 0 (2026-09-06) : **180 erreurs / 11 warnings / 191 total**
  mesurés sur `origin/main` @ `3c69e7d` avec les versions du lockfile
  (`npm ci`, Node 20.20.2, npm 10.8.2, ESLint 9.13.0). Le ratchet CI a été
  aligné sur cette mesure (précédent plafond 212 / 11 / 223). La branche Pack 0
  mesure 178 / 11 (0 nouvel item, 2 disparus).

## 3. Typecheck

- Commande canonique : `npx tsc -p tsconfig.app.json --noEmit`
  (`tsconfig.app.json` est la configuration applicative ; `tsconfig.json` ne
  fait que la référencer).
- Aucun gate CI : la baseline est **mesurée sur `origin/main`** via la
  procédure §5 à chaque lot qui exécute le typecheck.
- Instantané indicatif : 19 erreurs historiques mesurées sur `origin/main`
  @ `710110e` (2026-07-11), aucune dans les fichiers Daily v2. À re-mesurer,
  ne pas citer comme seuil.
- Instantané Pack 0 (2026-09-06) : **16 diagnostics** sur `origin/main`
  @ `3c69e7d` avec TypeScript 5.6.3 (lockfile) ; branche Pack 0 : 16, diff
  exact vide. Une mesure faite avec des dépendances divergentes du lockfile
  (ex. TypeScript 5.9.x installé hors `npm ci`) n'est pas comparable.
- Piège connu de la configuration (strict désactivé) : le narrowing
  `!result.success` vers la variante d'échec d'une union discriminée ne
  fonctionne pas ; utiliser des type guards explicites dans le nouveau code.

## 4. Tests

- **La liste canonique des scripts `test:*` vit dans `package.json`.**
- Un lot exécute les suites imposées par sa qualification CTO et rapporte les
  compteurs bruts (`# tests / # pass / # fail`).
- Les fixtures sont exclusivement synthétiques et anonymes.

## 5. Procédure de comparaison à `origin/main`

Depuis la racine du repo (le worktree n'altère ni le repo principal ni un
lot local non commité) :

```bash
git fetch origin
git worktree add ../bank-sync-baseline origin/main
cd ../bank-sync-baseline
npm ci

# Typecheck baseline
npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-baseline.txt

# Lint baseline (JSON pour comparaison item par item)
npx eslint . -f json > /tmp/lint-baseline.json || true

cd -
```

Puis sur la branche du lot :

```bash
npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-branch.txt
comm -13 /tmp/tsc-baseline.txt /tmp/tsc-branch.txt   # nouvelles erreurs (doit être vide)
comm -23 /tmp/tsc-baseline.txt /tmp/tsc-branch.txt   # erreurs disparues (informatif)
```

Pour ESLint, comparer les rapports JSON item par item
(`fichier|règle|sévérité|ligne:colonne`) : l'ensemble branche doit être un
sous-ensemble de l'ensemble baseline.

Nettoyage :

```bash
git worktree remove ../bank-sync-baseline
```

## 6. Rapport

Chaque rapport de lot cite : la commande exacte, le compte baseline, le
compte branche, et le diff exact (nouvelles/disparues). Jamais « identique »
sans la comparaison item par item.
