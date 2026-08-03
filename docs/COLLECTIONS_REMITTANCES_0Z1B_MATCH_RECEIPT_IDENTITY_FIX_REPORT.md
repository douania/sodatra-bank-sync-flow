# Rapport Claude Code — 0Z1B correction d’identité des remises

## 1. Métadonnées

- Repo : `douania/sodatra-bank-sync-flow`
- Branche de base : `origin/main`
- HEAD attendu et vérifié : `c36c15eb2d1f13018162e31c6d7bba6098576f75`
- Branche de travail : `feat/0z1b-collections-remittances-local`
- Mode : correctif UI local borné
- Niveau : moyen
- Autorisation : GO explicite `go`, en réponse au périmètre annoncé du correctif
- Commit, push, PR, staging et production : non autorisés, non effectués

## 2. Objectif

Lever `P1_MATCH_RECEIPT_IDENTITY_AMBIGUOUS` sans modifier le domaine, la base
ou les règles de rapprochement. Le proposant et le second acteur doivent voir
la même identité stable de remise lorsque plusieurs remises partagent client
et montant.

## 3. Préflight

- `git fetch origin` : réussi ;
- `HEAD` = `origin/main` = SHA attendu ;
- les modifications préexistantes correspondent au candidat 0Z1B local déjà
  gelé et documenté par son manifeste ;
- aucune divergence de base et aucune stop condition déclenchée.

## 4. Correctif réalisé

L’identité affichée contient désormais :

- nom et référence client ;
- mode de remise en français ;
- date de remise en banque ;
- numéro de chèque ou référence d’effet lorsqu’il existe ;
- identifiant technique court et stable.

Cette identité unique est utilisée à l’identique dans le sélecteur de
proposition et dans la file de confirmation. Le montant proposé, le score et
le statut restent affichés séparément. Si une remise liée n’est plus visible,
la file l’indique explicitement avec son identifiant court au lieu de présenter
un libellé générique trompeur.

## 5. Fichiers du correctif

- `src/features/collections-remittances/collectionReceiptIdentity.ts` :
  construction déterministe du libellé ;
- `src/features/collections-remittances/collectionReceiptIdentity.synthetic.test.ts` :
  scénario synthétique de deux remises de même client et même montant ;
- `src/features/collections-remittances/collectionsApplicationContract.synthetic.test.ts` :
  preuve que les deux écrans utilisent la même identité ;
- `src/pages/CollectionsRemittances.tsx` : affichage dans la proposition et la
  confirmation ;
- rapports et manifeste 0Z1B : mise à jour de traçabilité.

## 6. Sécurité et périmètre

- secret ajouté : non ;
- donnée bancaire réelle : non ;
- SQL exécuté : non ;
- migration modifiée ou exécutée : non ;
- Supabase local, distant, staging ou production : non ;
- Auth, RLS, capacités ou RPC : inchangés ;
- règles financières, montants et transitions : inchangés.

## 7. Tests

| Contrôle | Résultat |
|---|---:|
| `npm run test:collections-0z1b` | PASS — 14/14 |
| lint ciblé des fichiers applicatifs 0Z1B | PASS — 0 constat |
| `npm run build` | PASS |
| `npx tsc -p tsconfig.app.json --noEmit` | `PASS_WITH_BASELINE` — 19/19, diff 0 |
| ESLint complet comparé item par item à `origin/main` | `PASS_WITH_BASELINE` — 220/220, diff 0 |
| `git diff --check` | PASS |

Le rejeu ciblé déterministe couvre trois cas : identité complète avec chèque,
distinction de deux remises de même client et même montant, et remise liée non
visible. Les 14 tests comprennent aussi le contrat d’affichage identique entre
proposition et confirmation.

## 8. Rejeu navigateur et verdict final local

La contre-revue indépendante locale a confirmé le delta `PASS`, puis le rejeu
navigateur Docker autorisé par
`GO_0Z1B_MATCH_RECEIPT_IDENTITY_BROWSER_REPLAY_DOCKER_APPROVED` a vérifié les
deux identités sous l’acteur A et la file de confirmation sous l’acteur B.
Rapport détaillé :
`docs/COLLECTIONS_REMITTANCES_0Z1B_MATCH_RECEIPT_IDENTITY_BROWSER_REPLAY_REPORT.md`.

`PASS_LOCAL_FIX_AFTER_COUNTER_REVIEW_AND_BROWSER_REPLAY`

Le défaut `P1_MATCH_RECEIPT_IDENTITY_AMBIGUOUS` est fermé localement. Le
candidat reste non commité et non déployé. Aucun passage en staging n’est
autorisé par ce verdict.
