# 0Z1B Core — corrections locales P1/P2 issues du rejeu E2E

## Verdict

`PASS_LOCAL_FIXES_READY_FOR_INDEPENDENT_DB_APPLICATION_COUNTER_REVIEW`

Les deux constats du rejeu navigateur sont corrigés localement :

- P1 `P1_RELOAD_LOSES_WORKFLOW_IDEMPOTENCY_AND_ORPHANS_DRAFT` : `FIXED_LOCAL` par une RPC atomique unique ;
- P2 `P2_NET_LIQUIDITY_NOT_DISPLAYED_IN_REGISTER` : `FIXED_LOCAL` par une colonne dédiée alimentée par la valeur serveur.

Le rejeu navigateur après correction reste `NOT_REPLAYED_AFTER_FIX`. Aucun staging n'est autorisé.

## Métadonnées et préflight

- GO : `GO_0Z1B_CORE_APPLICATION_E2E_P1_P2_FIXES_LOCAL_ONLY_APPROVED` ;
- branche : `feat/0z1b-core-app-integration-local` ;
- HEAD et `origin/main` vérifiés : `3f514d86b0bc6757f7b6184d5d2af1961b2b3886` ;
- le worktree contenait uniquement le candidat d'intégration et ses rapports locaux attendus ;
- aucun accès Supabase distant, aucune donnée réelle, aucun secret ;
- aucun commit, push, PR, staging ou production.

## Correction P1 — saisie atomique

La migration additive `20260805000000_collection_remittances_core_atomic_entry.sql` expose `create_collection_entry_v1` à `authenticated` uniquement. Cette RPC :

1. contrôle l'acteur et la capacité `ENTRY` ;
2. ouvre une idempotence portant sur le payload complet ;
3. crée le reçu et la remise ;
4. ajoute le premier élément ;
5. affecte éventuellement la facture ;
6. termine la commande seulement lorsque toutes les étapes ont réussi.

Les trois fonctions Core historiques restent réutilisées à l'intérieur de la même transaction PostgreSQL. Une exception à n'importe quelle étape annule donc les objets métier, les événements et toutes les lignes d'idempotence intermédiaires.

L'application appelle désormais une seule fois `create_collection_entry_v1`. La clé opaque reste stable pour les nouvelles tentatives et dans `sessionStorage` jusqu'au succès. Un rechargement de la page conserve donc la clé sans persister le client, le montant, la référence du titre ou une autre donnée métier.

### Preuve PostgreSQL 17

Le test synthétique provoque volontairement une surallocation de facture à la dernière étape, après la création logique du reçu, de la remise et de l'élément. Après l'échec, les compteurs sont strictement inchangés pour :

- `collection_receipts` ;
- `collection_bank_remittances` ;
- `collection_bank_remittance_items` ;
- `collection_invoice_allocations` ;
- `collection_command_idempotency`.

La même clé est ensuite réutilisée avec un payload valide : un seul ensemble lié est créé. Un troisième appel identique restitue la remise existante et ne crée aucun doublon. Zéro remise orpheline porte la référence synthétique du test.

Résultat : `ATOMIC_ENTRY_PASS` sur PostgreSQL `17.10`.

## Correction P2 — liquidité nette visible

Le registre sépare maintenant les colonnes :

- `Attendu` ;
- `Nominal réglé` ;
- `Agios observés` ;
- `Liquidité nette`.

La liquidité nette affichée provient directement de `net_liquidity_amount` renvoyé par `export_collection_register_v1`. Elle n'est pas recalculée dans l'interface.

## Fichiers du correctif

- `supabase/migrations/20260805000000_collection_remittances_core_atomic_entry.sql` ;
- `supabase/tests/collection_remittances_core_0z1b/15_atomic_entry.sql` ;
- `supabase/tests/collection_remittances_core_0z1b/10_structure_security.sql` ;
- `supabase/tests/collection_remittances_core_0z1b/run_pg17_replay.ps1` ;
- `src/features/collections-core/collectionsCoreService.ts` ;
- `src/features/collections-core/collectionsCoreApplicationContract.synthetic.test.ts` ;
- `src/pages/CollectionsCore.tsx` ;
- le présent rapport.

## Sécurité

- la nouvelle fonction est `SECURITY DEFINER` avec `search_path = public, auth, pg_temp` ;
- `PUBLIC`, `anon`, `service_role` et `authenticated` sont d'abord révoqués explicitement ; seul `authenticated` reçoit ensuite `EXECUTE` ;
- la capacité `ENTRY` reste imposée côté serveur ;
- aucun DML direct n'est accordé aux rôles applicatifs ;
- la matrice confirme 16 commandes Core pour `authenticated`, aucune commande d'écriture pour `service_role`, et l'absence d'exécution pour `PUBLIC`/`anon`.

## Contrôles

| Contrôle | Résultat |
|---|---|
| Tests Collections Core | `16/16 PASS` |
| Daily v2 application | `99/99 PASS` |
| Rejeu Core PostgreSQL 17 | `PASS` : structure, sécurité, atomicité, scénarios, contre-régressions, concurrence et négatifs |
| Test ciblé atomicité | `ATOMIC_ENTRY_PASS` |
| Test de concurrence | `CONCURRENCY_PASS` ; la session perdante est refusée par `COLLECTION_CREDIT_LINE_OVERRESERVED` |
| ESLint ciblé | `PASS`, zéro constat |
| Build Vite | `PASS` |
| Artefact MCP après build | empreinte inchangée `D6F5490BE80413010C5278DD23A59C578EA1007C55E193CA5B87B9B7894A6F65` |
| TypeScript canonique | branche `19`, baseline `19`, zéro nouvelle et zéro disparue : `PASS_WITH_BASELINE` |
| ESLint complet | branche `209 erreurs / 11 warnings`, baseline identique, zéro nouvelle et zéro disparue : `PASS_WITH_BASELINE` |
| `git diff --check` | `PASS` |

Le script PowerShell de rejeu n'a pas été exécuté directement, car la politique Windows interdit les scripts. Les mêmes fichiers ont été rejoués explicitement dans le même ordre sur le conteneur jetable, sans contourner cette politique. Le conteneur et le worktree temporaire de baseline ont été supprimés et leur absence vérifiée.

## Risques résiduels et prochaine porte

- une réponse réseau perdue après un commit serveur réussi reste protégée lors d'une nouvelle tentative ou d'un rechargement dans la même session navigateur, grâce à la même clé opaque ; le nettoyage du stockage navigateur ou la reprise depuis un autre poste après un résultat incertain restent des cas à examiner par la contre-revue ;
- la migration et l'interface modifiées exigent une contre-revue indépendante DB/sécurité et applicative ;
- aucun staging avant cette contre-revue et le rejeu navigateur des deux scénarios corrigés.

Prochaine porte recommandée : contre-revue indépendante locale du delta, puis GO distinct pour le rejeu navigateur Docker après correction.
