# 0Z1B — Rapport d'implémentation DB locale et replay PostgreSQL 17

Date de preuve : 2026-08-03

Branche locale : `feat/0z1b-collections-remittances-local`
Base de départ : `origin/main` = `c36c15eb2d1f13018162e31c6d7bba6098576f75`

## Verdict borné

`PASS_LOCAL_DB_DRAFT_AND_PG17_REPLAY_WITH_BASELINE`

Ce verdict signifie uniquement que le candidat DB additif et son harnais local
passent sur une base PostgreSQL 17 jetable. Il ne constitue ni un GO staging,
ni un GO production, ni une validation comptable définitive.

## Périmètre réellement livré

- schéma additif Collections et Remises, sans modification de
  `collection_report` ni de Daily v2 ;
- capture manuelle/Excel/API/migration avec origine Excel séparée et clé
  `(source_system, excel_filename, excel_source_row)` ;
- titres chèque/effet, allocations de factures, bordereaux, frais attendus et
  observés séparés ;
- prorogation avec créances sources, plusieurs effets de remplacement et
  plusieurs chèques SODATRA dont le total doit égaler le nominal ;
- rapprochement proposé puis confirmé par deux acteurs ;
- règlement partiel d'un même effet, solde restant, impayé post-crédit et
  recours sans effacement de l'historique ;
- reprise explicite d'une preuve Daily v2 supersédée par une ligne active de
  même hash ;
- capacités fines, idempotence des commandes, versions optimistes, événements
  et audit append-only ;
- mappings comptables limités à la préparation d'export : aucune écriture
  comptable n'est passée et aucun paiement n'est exécuté.

## Sécurité prouvée localement

- RLS activée sur les 21 nouvelles tables ;
- aucune policy INSERT/UPDATE/DELETE pour un rôle applicatif ;
- `anon` et `service_role` sans privilège direct sur les nouveaux objets ;
- `authenticated` limité à SELECT sur les tables/vues et EXECUTE sur la liste
  explicite des commandes publiques ;
- helpers internes fermés ;
- toutes les fonctions `SECURITY DEFINER` du lot ont un `search_path` fixe ;
- le préparateur ne peut confirmer ni son rapprochement ni son propre chèque ;
- le créateur ne peut approuver sa propre règle de frais ;
- événements métier et audit non modifiables et non supprimables.

## Replay PostgreSQL 17

Commande :

```text
C:\Program Files\Git\bin\bash.exe supabase/tests/collections_remittances_0z1b/run_pg17_replay.sh
```

Résultat :

```text
PostgreSQL 17.10
ALL_0Z1B_ASSERTIONS_PASS
ALL_COLLECTIONS_0Z1B_PG17_PASS
exit 0
```

Le runner applique le shim plateforme minimal, la baseline puis toute la
chaîne de migrations dans l'ordre sur `postgres:17-alpine`. Les scénarios
utilisent uniquement trois identités et des montants synthétiques. Le
conteneur `collections-0z1b-pg17` est détruit par le trap de fin, succès ou
échec. Sa disparition a été vérifiée après le replay.

Les 25 appels d'assertion couvrent notamment : refus anonyme, refus DML direct,
idempotence stricte, séparation des tâches, prorogation 1000 = 400 + 600,
rapprochement 1000 = 400 + 600, effet 1000 = 300 + 700, impayé après crédit,
supersession/rebond de preuve, agios attendus distincts de l'observé, ACL,
`search_path` et append-only.

## TypeScript — comparaison à la baseline

Commande canonique :

```text
npx tsc -p tsconfig.app.json --noEmit
```

Résultat réel : 19 erreurs, exactement la baseline 0Z corrigée. Le lot ne
modifie aucun fichier TypeScript et n'ajoute aucune erreur.

Statut : `PASS_WITH_BASELINE`, jamais `PASS`.

## Incidents utiles découverts par le replay

Le replay a trouvé puis fait corriger deux défauts dans le candidat avant sa
clôture locale :

1. une vue `security_invoker` masquait les preuves Daily devenues inactives ;
   elle est devenue une projection contrôlée filtrée par rôle, limitée aux
   métadonnées nécessaires à la reprise ;
2. les default privileges du shim donnaient encore des privilèges de vue à
   `authenticated` ; un `REVOKE ALL` explicite suivi d'un `GRANT SELECT` ferme
   désormais cette surface.

## Interdictions et suites

- aucun accès Supabase ;
- aucune donnée bancaire réelle ;
- aucun hotfix de `collection_report` ;
- aucun changement de migration historique ;
- aucun commit, push ou PR dans ce jalon ;
- contre-revue indépendante locale reçue : replay PG17, empreintes, couverture
  RLS et additivité confirmés sans réserve bloquante ;
- aucun déploiement avant nouveau GO environnement ;
- un second utilisateur réel reste obligatoire avant tout staging afin que la
  séparation des tâches testée avec deux identités synthétiques soit effective ;
- stop staging si un rôle applicatif détient `CREATE` sur `public` ;
- en staging, les lignes de preuve doivent être générées par les RPC Daily v2
  légitimes, gardes actives, jamais par le contournement réservé au replay.
