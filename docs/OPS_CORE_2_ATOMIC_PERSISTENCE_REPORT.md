# Rapport Claude Code — OPS-CORE-2-ATOMIC-PERSISTENCE

## 1. Métadonnées

- Repo : `douania/sodatra-bank-sync-flow`
- Branche de base : `origin/main`
- HEAD attendu : `a4270079b57541c87d2b14b6f483881da71a734f`
- HEAD vérifié : `a4270079b57541c87d2b14b6f483881da71a734f`
- Branche de travail : `codex/ops-core-2-atomic-persistence`
- Worktree : `C:\Users\LENOVO\Documents\Codex\sodatra-bank-sync-flow-ops-core-2`
- Mode : PATCH local, sans environnement
- Niveau : très approfondi (DB / sécurité)
- GO_COMMIT : oui via `GO_IMPLEMENT_OPS_CORE_2_ATOMIC_PERSISTENCE` ; identité ponctuelle reprise de l'historique récent du dépôt, sans modifier la configuration Git
- GO_PR : oui pour une draft PR via le GO de cycle, non exécuté car validations obligatoires incomplètes

## 2. Objectif

- Supprimer les écritures partielles de `saveBankReport` et `saveFundPosition`.
- Rendre leurs retries idempotents sans élargir les droits DB ni toucher un environnement Supabase.

## 3. Préflight

- `git status` initial : worktree isolé propre.
- `origin/main` : `a4270079b57541c87d2b14b6f483881da71a734f`.
- Divergence : non au démarrage.
- Stop condition initiale levée le 2026-08-12 : Docker Desktop/WSL 2 opérationnels et replay PostgreSQL 17 PASS. La première contre-review distante reste à relancer, car elle avait été bloquée avant publication de la branche.

## 4. Périmètre

- Autorisé : service de persistance financière, payloads associés, types Supabase, nouvelle migration additive, tests locaux/CI et documentation du lot.
- Touché : `databaseService`, module pur de payload, types générés, migration/RPC, replay PG17, tests, CI et registres documentaires.
- Écart : aucun. Aucun pipeline d'import, aucune collection, aucune migration historique et aucun environnement n'ont été modifiés.

## 5. Résumé exécutif

Les deux sauvegardes multi-tables séquentielles sont remplacées par deux RPC
atomiques. Une clé UUID est créée avant le mécanisme de retry et enregistrée
dans un ledger privé, ce qui empêche la duplication après une réponse réseau
perdue. Les payloads sont validés et bornés avant écriture ; les RPC sont
fail-closed pour tout rôle autre qu'admin/manager. Le code applicatif est vert,
mais le lot ne peut pas recevoir PASS avant replay PostgreSQL et contre-review.

## 6. Diagnostic

- `saveBankReport` réalisait jusqu'à quatre écritures indépendantes.
- `saveFundPosition` réalisait jusqu'à trois écritures indépendantes.
- Le retry était appliqué séparément aux écritures : un échec tardif pouvait laisser un parent ou des enfants partiels.
- Aucun identifiant stable ne permettait de reconnaître le rejeu du même ordre après une réponse perdue.
- Les montants Fund Position étaient déjà validés côté client ; la logique a été isolée dans un module sans dépendance Supabase et étendue au rapport bancaire.

## 7. Changements réalisés

- `src/services/financialAtomicPersistence.ts` : validation bigint-safe, canonicalisation des payloads et UUID sécurisé.
- `src/services/databaseService.ts` : une seule RPC par sauvegarde, avec la même clé pendant tous les retries ; suppression des logs de montants.
- `src/integrations/supabase/types.ts` : contrat des deux RPC et du ledger.
- `supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql` : ledger privé et deux fonctions `SECURITY DEFINER` atomiques/idempotentes.
- `supabase/tests/ops_core_2_atomic_financial_writes/` : schéma synthétique, contrôles grants/RLS/rollback/idempotence et runner PostgreSQL 17 jetable.
- Tests TypeScript : contrats de payload, signe, bornes, RPC unique, sécurité statique et idempotence.
- `.github/workflows/ci.yml` / `package.json` : suite financière ajoutée à la CI.
- Registres : statut local explicite, sans clôture prématurée de DEF-10.

## 8. Sécurité / données sensibles

- Secret ajouté : non.
- Données bancaires réelles utilisées : non ; fixtures synthétiques uniquement.
- SQL exécuté : non.
- Supabase live : non.
- Migration : fichier ajouté localement, non appliqué.
- Auth/RLS touché : nouvelle table sous RLS et nouveaux grants/fonctions seulement ; aucune policy ni objet historique modifié.

## 9. Tests exécutés

| Commande | Résultat | Notes |
|---|---:|---|
| `tsx --test src/services/databaseService.synthetic.test.ts src/services/financialAtomicPersistence.synthetic.test.ts` | PASS | 20/20 |
| `tsc --noEmit --pretty false` | PASS | 0 erreur |
| ESLint nouveaux fichiers | PASS | 0 erreur, 0 warning |
| ESLint global JSON + ratchet CI | PASS | 209 erreurs, 11 warnings, total 220 ; baseline 212/11/223 |
| `vite build` | PASS | Build production ; warnings de chunking préexistants |
| 7 suites CI voisines (CSV, Excel, Daily v2, auth, BDK) | PASS | 395/395 |
| `uploadRuntimeGuard.synthetic.test.ts` sous Node 24 | FAIL préexistant | 11/12 ; même erreur `import.meta.env` reproduite sur le HEAD de base ; CI sous Node 20 |
| `run_pg17_replay.ps1` | PASS | PostgreSQL 17 jetable : sécurité, rollbacks tardifs, idempotence séquentielle et concurrence deux sessions ; conteneur supprimé |

## 10. Résultats

- Les payloads non finis/hors entier sûr sont refusés avant RPC.
- Les clés inattendues, formes JSON invalides et tableaux de plus de 1000 enfants sont refusés côté DB.
- Les RPC exigent un utilisateur authentifié possédant `admin` ou `manager`.
- `PUBLIC`, `anon` et `service_role` n'ont aucun droit d'exécution ; le ledger n'a aucun grant client et aucune policy RLS.
- Les scénarios de rollback réel et de concurrence sur deux sessions sont confirmés par le replay PostgreSQL 17 fourni.

## 11. Diff summary

- Fichiers modifiés/ajoutés : 15.
- Lignes ajoutées : 1 350.
- Lignes supprimées : 287.
- Churn principal : suppression des sept écritures séquentielles au profit de deux RPC ; l'essentiel des ajouts correspond à la migration, aux tests de rollback/sécurité et au rapport de lot.

## 12. Risques résiduels

- Une suite périphérique reste non exécutable sous le runtime local Node 24 ; l'échec identique sur le HEAD de base confirme l'absence de régression OPS-CORE-2, mais la CI Node 20 devra le rejouer.
- La première tentative de contre-review indépendante a rendu `BLOCKED_REMOTE_DIFF_UNAVAILABLE` sans finding sur le code, car le reviewer distant ne disposait que de `origin/main`.
- Migration non appliquée : le frontend modifié ne doit pas être déployé avant la migration dans le même release train.
- La contre-review complète doit être relancée sur la branche publiée avant toute draft PR ou décision d'intégration.

## 13. Recommandation Claude Code

`PASS_WITH_RESERVES` au niveau implémentation locale : validations applicatives
et replay PostgreSQL 17 réussis, y compris la concurrence. Le verdict
d'intégration reste suspendu à la contre-review indépendante et à la CI Node 20.

## 14. Actions demandées au CTO

- Relancer la contre-review indépendante sur la branche distante publiée.
- Ouvrir une draft PR uniquement après retour exploitable de cette contre-review.
- Ne donner aucun GO staging/DB/déploiement avant ces validations.
