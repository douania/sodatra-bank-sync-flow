# 0Z1B — Rapport E2E navigateur Supabase local Docker

Date de preuve : 2026-08-03

Branche locale : `feat/0z1b-collections-remittances-local`

Base : `c36c15eb2d1f13018162e31c6d7bba6098576f75`
Autorisation : `GO_0Z1B_LOCAL_SUPABASE_BROWSER_E2E_DOCKER_APPROVED`

## Verdict

`PASS_LOCAL_BROWSER_E2E_WITH_STAGING_BLOCKER`

Le parcours technique complet fonctionne sur une pile locale représentative,
avec séparation effective de deux acteurs. Le candidat ne doit toutefois pas
passer en staging avant correction du défaut d'identification des remises dans
le rapprochement décrit ci-dessous.

## Périmètre et isolement

- pile Docker issue du dépôt officiel Supabase, commit
  `94bc3f8d074307c90c1cf78c50ac5b2a1b48162f` ;
- PostgreSQL 17.6, GoTrue, PostgREST, Kong et services officiels associés ;
- API locale sur `127.0.0.1:18000`, application locale sur
  `127.0.0.1:15173` ;
- 37 migrations du dépôt appliquées dans l'ordre ;
- aucun accès Supabase distant, staging ou production ;
- aucun fichier bancaire réel, aucune donnée réelle et aucun secret de
  production ;
- conteneurs, volumes et données synthétiques détruits après la preuve.

Les images Docker téléchargées et la copie de travail du dépôt officiel
Supabase peuvent rester en cache local ; elles ne contiennent aucune donnée du
test.

Erratum de nettoyage constaté lors du rejeu ciblé ultérieur : le dossier
bind-mount `volumes/db/data` contenait encore les données synthétiques de cette
preuve, malgré la destruction des conteneurs et volumes nommés. Il a été vidé
avant le rejeu suivant, puis de nouveau après celui-ci. Aucun résidu de données
réelles n’était concerné.

Une migration historique du dépôt suppose l'existence préalable de l'UUID
administrateur `9539d4f5-a600-4bf7-931f-315e597e4441`. Une identité locale
factice portant cet UUID a donc été créée uniquement pour permettre le replay
complet d'une base neuve. Ce prérequis est antérieur à 0Z1B.

## Préparation Daily v2

Une première tentative légitime de provisionnement a été refusée par
`DAILY_V2_SERVER_READ_ONLY`, ce qui confirme la garde active. Une fenêtre
locale synthétique et auditée a ensuite permis de créer, par les RPC Daily v2,
un compte BDK XOF et une ligne de crédit de 1 000 XOF datée du 2026-08-03. La
fenêtre a été refermée avant le parcours Collections.

État final vérifié : `daily_v2_private.runtime_control.mutations_enabled =
false`.

## Acteurs synthétiques

- acteur A : saisie, émission de chèque et proposition de rapprochement ;
- acteur B : approbation de prorogation, confirmation de remise et confirmation
  de rapprochement ;
- le profil auditeur a été ajouté à A pour rendre la preuve Daily v2 visible,
  conformément au filtrage RLS observé ;
- la capacité d'approbation a été ajoutée temporairement à A uniquement pour
  vérifier que le serveur refuse encore l'auto-approbation.

## Parcours navigateur exécuté

1. A crée une remise chèque de 1 000 XOF pour `CLIENT-E2E`, puis affecte la
   facture synthétique `FAC-E2E-001` pour 1 000 XOF.
2. A crée un effet de prorogation de 1 000 XOF, référence
   `EFFET-REMPL-E2E-001`, échéance 2026-09-30.
3. A propose le rapprochement de cet effet avec la ligne Daily v2 de
   1 000 XOF. Son bouton de confirmation est désactivé.
4. B confirme le rapprochement. L'effet passe à `CONFIRMED`.
5. B crée un dossier de prorogation de 1 000 XOF.
6. A rattache la créance `FAC-E2E-OLD`, l'effet de remplacement et prépare le
   chèque SODATRA `CHQ-SODATRA-E2E-001` de 1 000 XOF.
7. Le bouton d'auto-approbation de A est désactivé. Un appel serveur direct
   sous l'identité A, avec la capacité requise, retourne HTTP 400, SQLSTATE
   `P0001`, message `COLLECTION_TWO_ACTORS_REQUIRED`.
8. B approuve le chèque, puis confirme sa remise avec la preuve
   `PREUVE-REMISE-E2E-001` datée du 2026-08-03.

## État final vérifié en base

- 2 remises ;
- 1 affectation de facture ;
- 2 instruments ;
- 1 proposition de rapprochement et 1 allocation bancaire ;
- 1 prorogation, 1 créance source, 1 effet de remplacement et 1 chèque
  sortant ;
- rapprochement `CONFIRMED`, proposé par A et revu par B ;
- prorogation `FUNDING_COMPLETE`, version 5 ;
- chèque `DELIVERED`, version 3, avec date et référence de preuve ;
- 11 événements d'audit `ACCEPTED`, couvrant les 11 commandes métier réussies.

## Non-régression applicative

- `npm.cmd run test:collections-0z1b` : 10 tests réussis, 0 échec ;
- `npx.cmd tsc -p tsconfig.app.json --noEmit` : 19 erreurs, exactement la
  baseline historique documentée ; statut `PASS_WITH_BASELINE`.

## Bloqueur staging découvert

`P1_MATCH_RECEIPT_IDENTITY_AMBIGUOUS`

Lorsque deux remises partagent le même client et le même montant, le sélecteur
affiche deux options strictement identiques :
`CLIENT SYNTHETIQUE · 1 000 F CFA`. Il n'affiche ni la référence client, ni le
mode, ni la date, ni un identifiant court. Le test a dû s'appuyer sur l'ordre
technique `created_at DESC` pour choisir l'effet, information qu'un opérateur
ne possède pas.

La file de confirmation aggrave le défaut : elle n'affiche que
`RECEIPT · 1 000 F CFA · score 100`. Le second acteur ne peut donc pas vérifier
indépendamment quelle remise a été proposée. Dans une tour de contrôle
bancaire, ce manque peut conduire à confirmer la bonne preuve sur le mauvais
objet métier.

Correction minimale attendue avant staging : afficher dans les deux écrans une
identité stable et compréhensible comprenant au moins client, mode, date de
remise, référence instrument ou facture et identifiant court ; le second
acteur doit voir les mêmes éléments que le proposant.

### Statut ultérieur du bloqueur

Le défaut a été corrigé localement sous GO borné le 2026-08-03. Le sélecteur et
la file de confirmation utilisent maintenant le même libellé comprenant client,
référence client, mode, date de remise, référence de chèque ou d’effet lorsqu’elle
existe et identifiant court. Les tests synthétiques distinguent deux remises de
même client et même montant.

Statut final local :
`P1_CLOSED_LOCAL_AFTER_COUNTER_REVIEW_AND_BROWSER_REPLAY`. La contre-revue
indépendante a conclu `PASS` et le rejeu navigateur ciblé à deux acteurs a
confirmé les deux libellés distincts puis l’identité complète dans la file de
confirmation. Voir
`docs/COLLECTIONS_REMITTANCES_0Z1B_MATCH_RECEIPT_IDENTITY_BROWSER_REPLAY_REPORT.md`.

## Conclusion

La pile, les RPC, les contrôles de capacité, la séparation serveur des acteurs
et le parcours métier nominal sont opérationnels localement. La preuve ne vaut
ni GO staging ni GO production. Le candidat reste non commité et non déployé ;
le correctif local, sa contre-revue indépendante et son rejeu navigateur ciblé
sont désormais réalisés. Les autres portes staging restent indépendantes.
