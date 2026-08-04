# 0Z1B Core — rapport local de simplification du périmètre des retenues

## Verdict

`PASS_LOCAL_SCOPE_SIMPLIFICATION_READY_FOR_INDEPENDENT_COUNTER_REVIEW`

La tranche applicative reste centrée sur la preuve d'encaissement. Elle ne rattache pas les débits de frais bancaires séparés aux remises et ne reconstitue pas leur traitement comptable.

## Métadonnées

- autorisation : GO utilisateur consécutif à la décision de simplification ;
- branche : `feat/0z1b-core-app-integration-local` ;
- HEAD vérifié : `3f514d86b0bc6757f7b6184d5d2af1961b2b3886` ;
- `origin/main` vérifié : `3f514d86b0bc6757f7b6184d5d2af1961b2b3886` ;
- mode : préparation locale uniquement ;
- le worktree contient le candidat 0Z1B Core non commité déjà connu ; aucune modification étrangère détectée.

## Delta appliqué

- `Crédit exact` devient `Crédit au nominal` ;
- `Crédit net après agios` devient `Crédit net après retenue bancaire` ;
- `Agios observés` devient `Retenue bancaire observée` ;
- l'écran précise que les débits de frais séparés restent dans le relevé bancaire ;
- un test de contrat interdit l'exposition de `FEES_SEPARATE` dans ce parcours ;
- la décision de périmètre est consignée sans reprendre de donnée bancaire réelle.

## Fichiers du delta

- `src/pages/CollectionsCore.tsx` ;
- `src/features/collections-core/collectionsCoreApplicationContract.synthetic.test.ts` ;
- `src/features/collections-core/collectionsCorePayloads.synthetic.test.ts` ;
- `docs/COLLECTIONS_REMITTANCES_0Z1B_CORE_SCOPE_DECISION_DISCOUNT_FEES.md` ;
- le présent rapport.

Aucun fichier SQL, aucune migration, aucun contrat serveur, aucune RLS et aucune politique d'authentification n'ont été modifiés par ce delta.

### Empreintes du delta soumis à contre-revue

| Fichier | Lignes | SHA-256 |
|---|---:|---|
| `src/pages/CollectionsCore.tsx` | 175 | `8F6B30DE23A4E56D56409494A9ED15F6325BA0AEB4C696943468E9BD71E38D5D` |
| `src/features/collections-core/collectionsCoreApplicationContract.synthetic.test.ts` | 53 | `85A3F63B272C7A5A4A0615F66B04F153A844BECB5B1FCCDE22A60D4F88C06A75` |
| `src/features/collections-core/collectionsCorePayloads.synthetic.test.ts` | 48 | `E456EC2DCA2218BFB40DEC3A8D1185A55A51558E217E584A269DBC574631BE25` |
| `docs/COLLECTIONS_REMITTANCES_0Z1B_CORE_SCOPE_DECISION_DISCOUNT_FEES.md` | 30 | `E25FAB1D741E970FC726F780EFF719FBC841C9F6591F3C3C7BF3DCA98C20DCF4` |

## Contrôles

| Contrôle | Résultat |
|---|---|
| Tests Collections Core | `17/17 PASS` |
| ESLint ciblé sur les trois fichiers TypeScript touchés | `PASS`, zéro constat |
| Build Vite | `PASS` |
| Artefact MCP après build | SHA-256 inchangé `D6F5490BE80413010C5278DD23A59C578EA1007C55E193CA5B87B9B7894A6F65` |
| TypeScript canonique | `19 erreurs`, baseline antérieure documentée `19` : `PASS_WITH_BASELINE` sous réserve de recomparaison indépendante |
| ESLint complet | `209 erreurs / 11 warnings`, baseline antérieure documentée identique : `PASS_WITH_BASELINE` sous réserve de recomparaison indépendante |
| `git diff --check` | `PASS` |

## Sécurité et données

- secret : non ;
- donnée bancaire réelle reproduite dans le candidat : non ;
- Supabase distant : non ;
- SQL exécuté : non ;
- migration exécutée ou modifiée : non ;
- commit, push, PR, staging ou production : non.

## Risques résiduels et prochaine porte

La capacité serveur `FEES_SEPARATE` reste présente pour compatibilité, mais elle n'est pas exposée par l'interface Core. Une contre-revue indépendante ciblée doit confirmer que ce delta ne réintroduit aucun rattachement de débits séparés et que les baselines restent identiques avant toute autorisation de commit/push.
