# 0Z1B Core — Phase B Daily v2 safe read — rapport d’implémentation locale

## 1. Métadonnées

- GO : `GO_0Z1B_CORE_PHASE_B_DAILY_V2_SAFE_READ_LOCAL_IMPLEMENTATION_AND_PG17_REPLAY_ON_CLEAN_BRANCH_APPROVED`
- Correction ciblée : `GO_FIX_0Z1B_CORE_PHASE_B_P2_1_FRONTEND_ACTION_GRANULARITY_LOCAL_ONLY`
- Contre-revue ciblée : `GO_0Z1B_CORE_PHASE_B_P2_1_FRONTEND_ACTION_GRANULARITY_TARGETED_INDEPENDENT_COUNTER_REVIEW_APPROVED`
- Branche : `feat/0z1b-core-phase-b-safe-read`
- Base vérifiée : `HEAD = origin/main = a4270079b57541c87d2b14b6f483881da71a734f`
- Mode : implémentation locale, migration additive non appliquée à Supabase
- Conception de référence : SHA-256 `B9FFA342DE4AFC47A5CB2329F84769BA31BF10F02DA903351A7720570DA32F45`, 570 lignes

## 2. Résultat

La Phase B remplace la lecture Core directe et globale des lignes Daily v2 par une
lecture `SECURITY DEFINER` bornée par :

- l’élément de remise autorisé ;
- le compte de dépôt SODATRA exact ;
- la devise exacte ;
- une fenêtre maximale de 120 jours ;
- une allowlist serveur versionnée et expirante ;
- la provenance canonical complète de la ligne.

Les policies RLS Daily v2 ne sont pas élargies. A conserve le rôle `manager` et
reçoit seulement `PROPOSE_MATCH` avec scope ; B conserve le rôle `user` et reçoit
seulement `CONFIRM_MATCH` avec le même scope, plus `AUDIT` si le pilote le prévoit.

Les moteurs historiques v1 de proposition et de confirmation restent internes pour
préserver leurs invariants financiers et de concurrence. Leur exécution directe est
révoquée ; les enveloppes v2 imposent scope, snapshot de provenance, formes
`EXACT_CREDIT`/`NET_OF_DISCOUNT`, idempotence et second acteur.

La correction P2-1 supprime l’action frontend générique `phase_b`. Les points
d’autorité et leurs consommateurs utilisent désormais deux actions distinctes :
`phase_b_propose`, réservée à A, et `phase_b_review`, réservée à B. G ne peut
exécuter aucune action Phase B. La séparation des acteurs est ainsi appliquée dans
l’interface, le service frontend et le serveur.

## 3. Sécurité et intégrité

- aucune policy Daily v2 ajoutée ou modifiée ;
- aucune écriture Daily v2 dans la migration ou l’application ;
- aucun `SELECT` applicatif direct sur les lignes canonical, les propositions, les
  allocations ou la vue d’exceptions ;
- `service_role`, `anon` et `PUBLIC` ne peuvent exécuter les nouvelles RPC ;
- la lecture de candidats est `STABLE`, ne produit ni événement ni ligne métier ;
- banque différente, débit, ligne inactive, ligne hors allowlist ou sans provenance
  ne sont pas retournés ;
- les zéros de tête des références sont préservés ; moins de quatre caractères ne
  peut jamais devenir un signal positif ;
- le navigateur transmet le snapshot complet, mais le serveur recharge et verrouille
  la preuve avant proposition et confirmation ;
- les débits de frais séparés ne sont ni recherchés ni rattachés ;
- aucune confirmation automatique ; A propose, B décide avec motif ;
- l’export `AUDIT` reste fonctionnel bien que sa vue interne ne soit plus lisible
  directement.

## 4. Fichiers du lot

- `supabase/migrations/20260806000000_collection_remittances_core_phase_b_safe_read.sql`
- `supabase/tests/collection_remittances_core_0z1b/00_platform_daily_v2_shim.sql`
- `supabase/tests/collection_remittances_core_0z1b/50_phase_b_safe_read.sql`
- `supabase/tests/collection_remittances_core_0z1b/run_pg17_replay.ps1`
- `supabase/tests/collection_remittances_core_0z1b/README.md`
- `src/features/collections-core/collectionsCoreTypes.ts`
- `src/features/collections-core/collectionsCorePayloads.ts`
- `src/features/collections-core/collectionsCoreService.ts`
- `src/features/collections-core/collectionsCorePilotAccess.ts`
- `src/pages/CollectionsCore.tsx`
- `src/features/collections-core/collectionsCoreApplicationContract.synthetic.test.ts`
- `src/features/collections-core/collectionsCorePayloads.synthetic.test.ts`
- `src/features/collections-core/collectionsCorePilotAccess.synthetic.test.ts`
- `src/features/collections-core/collectionsCorePhaseBSafeReadContract.synthetic.test.ts`
- `docs/COLLECTIONS_REMITTANCES_0Z1B_CORE_PHASE_B_DAILY_V2_SAFE_READ_LOCAL_IMPLEMENTATION_REPORT.md`
- `docs/COLLECTIONS_REMITTANCES_0Z1B_CORE_PHASE_B_DAILY_V2_SAFE_READ_LOCAL_MANIFEST.sha256`

## 5. Validations

| Contrôle | Résultat |
|---|---|
| Rejeu complet `postgres:17-alpine` | `PASS`, PostgreSQL 17.10, ancien socle + Phase B |
| Test de concurrence historique | `CONCURRENT_OVERRESERVATION_BLOCKED` |
| Phase B DB | `PHASE_B_SAFE_READ_PASS` |
| Tests Core | 32/32 `PASS` |
| Tests Daily v2 application | 99/99 `PASS` |
| Tests Daily v2 reporting | 70/70 `PASS` |
| `npx tsc -p tsconfig.app.json --noEmit` | 19 erreurs branche / 19 baseline, diff exact 0 — `PASS_WITH_BASELINE` |
| ESLint JSON item par item | 220 branche / 220 baseline, diff exact 0 — `PASS_WITH_BASELINE` |
| `npm run build` | `PASS` |
| `git diff --check` | `PASS` |
| Artefact `supabase/functions/mcp/index.ts` | intact |
| Conteneur jetable | détruit et vérifié absent |
| Contre-revue ciblée P2-1 | `PASS_TARGETED_INDEPENDENT_COUNTER_REVIEW`, P0/P1/P2 = 0 |

## 6. Périmètre respecté

Aucun accès Supabase, aucune donnée bancaire réelle, aucun secret, aucun `.env`,
aucun compte distant, aucune migration live, aucun commit, push, PR, staging ou
production. Les données du rejeu sont exclusivement synthétiques.

## 7. Risques résiduels et porte suivante

La syntaxe, la sécurité et les invariants ont été rejoués sur PostgreSQL 17.10, mais
le delta n’a pas été appliqué ni testé dans un navigateur contre un environnement
Supabase. La contre-revue indépendante ciblée de la granularité frontend est close
sans réserve. Toute validation ou application staging exige un GO distinct.

Verdict : `PASS_LOCAL_IMPLEMENTATION_PG17_REPLAY_AND_TARGETED_COUNTER_REVIEW`.
