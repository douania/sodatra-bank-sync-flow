# 0Z1B Core — rapport E2E navigateur local

## Verdict

`BLOCKED_FOR_STAGING_P1_RELOAD_LOSES_WORKFLOW_IDEMPOTENCY`

Le parcours métier nominal fonctionne sur une pile Supabase locale PostgreSQL 17, mais le test d'interruption suivi d'un rechargement crée un second reçu et une seconde remise au lieu de reprendre le brouillon déjà amorcé. Une remise orpheline reste alors en base. Ce défaut est incompatible avec le rôle de registre de référence visé par le Core et doit être corrigé puis rejoué avant toute promotion applicative.

Une réserve P2 distincte est également ouverte : le registre affiche le nominal réglé et les agios, mais pas la liquidité nette pourtant calculée et conservée par le serveur.

## Référence et périmètre

- GO : `GO_0Z1B_CORE_LOCAL_APPLICATION_BROWSER_E2E_DOCKER_APPROVED` ;
- branche locale : `feat/0z1b-core-app-integration-local` ;
- base exacte : `3f514d86b0bc6757f7b6184d5d2af1961b2b3886` ;
- pile officielle Supabase auto-hébergée, PostgreSQL `17.6`, Docker local jetable ;
- 38 migrations du dépôt rejouées par ordre de nom ;
- deux utilisateurs et trois lignes bancaires entièrement synthétiques ;
- aucun accès Supabase distant, aucune donnée réelle, aucun commit, push, PR ou déploiement.

## Parcours conforme : crédit exact

1. L'acteur A saisit une remise chèque de `1 000 XOF` dans la banque de dépôt BDK.
2. A ne peut pas valider sa propre remise : l'interface indique que son compte ne possède pas cette capacité.
3. L'acteur B valide la remise.
4. B ne peut pas proposer de rapprochement.
5. A sélectionne la remise. À cet instant, la ligne de crédit de `1 000 XOF` placée dans ORA disparaît des choix ; seules les lignes BDK de même devise restent proposées.
6. A propose le crédit exact BDK et B confirme avec un motif.
7. Le registre affiche `EXACT_CREDIT`, nominal réglé `1 000`, agios `0`, reste `0` et état `CREDITED`.

Résultat : `PASS`.

## Parcours conforme : crédit net après agios

1. A saisit un effet de nominal `1 000 XOF`, référence `EFF-E2E-002`, remis dans BDK.
2. B valide ; A propose la ligne BDK réellement créditée de `950 XOF` avec la preuve `NET_OF_DISCOUNT` ; B confirme.
3. La base conserve séparément : nominal réglé `1 000`, agios observés `50`, liquidité nette `950`, reste `0`.
4. Le registre affiche `DISCOUNT_CREDITED`, nominal réglé `1 000`, agios `50`, reste `0` et état `CREDITED`.

Résultat métier serveur : `PASS`.

### Réserve P2 — liquidité nette absente du registre

La liquidité nette `950 XOF` n'est pas affichée dans le tableau, alors que le rapport d'intégration annonçait attendu, nominal, agios et liquidité nette comme informations séparées. L'utilisateur peut reconstituer `950` par soustraction, mais la cible exige de conserver et présenter le constat bancaire sans calcul manuel.

Statut : `P2_NET_LIQUIDITY_NOT_DISPLAYED_IN_REGISTER`.

## Défaut P1 — perte de la clé après rechargement

### Protocole

1. L'autorisation locale d'exécuter la deuxième RPC du workflow, `add_collection_remittance_item_v1`, est retirée temporairement au rôle `authenticated` afin de simuler une coupure entre deux étapes.
2. A saisit un chèque synthétique de `777 XOF`.
3. La première RPC crée le reçu et la remise ; la deuxième échoue. L'interface conserve les champs et demande de réessayer sans les modifier.
4. La base contient alors exactement : 1 reçu, 1 remise, 0 élément de remise, 1 remise orpheline.
5. La page est rechargée, ce qui efface les champs et la clé de workflow tenue uniquement en mémoire.
6. L'autorisation est restaurée, puis A ressaisit exactement les mêmes données.
7. La seconde tentative réussit, mais la base contient désormais : 2 reçus, 2 remises, 1 élément de remise et toujours 1 remise orpheline.

### Conclusion

L'idempotence annoncée ne couvre que les nouvelles tentatives effectuées sans recharger la page. Une interruption réelle suivie du geste normal de l'utilisateur — recharger puis ressaisir — perd la clé et duplique les objets de tête. L'enregistrement orphelin n'est ni visible ni récupérable dans cette tranche d'interface.

Statut : `P1_RELOAD_LOSES_WORKFLOW_IDEMPOTENCY_AND_ORPHANS_DRAFT`.

La correction doit rendre la création du reçu, de la remise et de son premier élément atomique côté serveur, ou fournir une reprise serveur déterministe du workflow incomplet. Persister seulement la clé dans le navigateur ne suffirait pas à garantir l'intégrité sur un autre poste ou après nettoyage du stockage local.

## Contrôles complémentaires

- acteur A : saisie et proposition seulement ;
- acteur B : validation et confirmation seulement ;
- séparation des acteurs imposée par l'interface et les RPC ;
- banque de dépôt réimposée après sélection de la remise ;
- privilège temporairement retiré restauré et vérifié avant destruction de la pile ;
- `npm run test:collections-core` : `14/14 PASS` après le rejeu navigateur.

## Prochaine porte

Autoriser uniquement un correctif local borné des deux constats :

1. P1 : atomicité ou reprise serveur du workflow initial de saisie ;
2. P2 : affichage explicite de la liquidité nette dans le registre.

Après correction : contre-revue indépendante locale, puis rejeu navigateur ciblé du scénario d'interruption et du cas net d'agios. Aucun staging applicatif ni déploiement production n'est autorisé par ce rapport.

## État après correction locale

Sous `GO_0Z1B_CORE_APPLICATION_E2E_P1_P2_FIXES_LOCAL_ONLY_APPROVED`, un candidat de correction a été ajouté sans modifier le verdict historique du rejeu ci-dessus :

- le workflow initial passe par une RPC PostgreSQL unique et atomique ;
- l'échec de la dernière étape annule désormais reçu, remise, élément, facture, événements et idempotence ;
- la clé opaque du workflow survit au rechargement dans la même session navigateur, sans persistance des données métier ;
- la liquidité nette possède une colonne dédiée dans le registre.

Preuves locales : `ATOMIC_ENTRY_PASS` sur PostgreSQL 17.10, tests Collections `16/16 PASS`, build `PASS`, TypeScript et ESLint sans nouvelle dette.

Statuts candidats :

- `P1_RELOAD_LOSES_WORKFLOW_IDEMPOTENCY_AND_ORPHANS_DRAFT` : `FIXED_LOCAL_PENDING_INDEPENDENT_COUNTER_REVIEW_AND_BROWSER_REPLAY` ;
- `P2_NET_LIQUIDITY_NOT_DISPLAYED_IN_REGISTER` : `FIXED_LOCAL_PENDING_INDEPENDENT_COUNTER_REVIEW_AND_BROWSER_REPLAY`.

Rapport détaillé : `COLLECTIONS_REMITTANCES_0Z1B_CORE_APPLICATION_E2E_P1_P2_FIXES_LOCAL_REPORT.md`.
