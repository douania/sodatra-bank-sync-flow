# 0Z1B — Rapport d'intégration applicative locale

Date de preuve : 2026-08-03

Branche locale : `feat/0z1b-collections-remittances-local`

Base de départ : `origin/main` = `c36c15eb2d1f13018162e31c6d7bba6098576f75`
Autorisation : `GO_0Z1B_LOCAL_APPLICATION_INTEGRATION_APPROVED`

## Verdict borné

`PASS_LOCAL_APPLICATION_INTEGRATION_WITH_BASELINE`

Ce verdict couvre uniquement l'intégration du candidat 0Z1B dans l'application
locale. Il ne constitue ni un GO staging, ni un GO production, ni une
validation sur des données bancaires réelles.

## Intégration livrée

- route protégée `/collections-remittances`, sans remplacement de la route
  historique `/reconciliation` ;
- navigation visible uniquement lorsque le candidat est explicitement activé
  sur une URL Supabase locale ;
- lecture des remises, titres, prorogations, chèques sortants, propositions de
  rapprochement, comptes SODATRA et preuves Daily v2 ;
- saisie structurée distinguant la banque du client du compte SODATRA de
  dépôt ;
- capture chèque, effet, virement ou espèces et suivi séparé des trois axes
  acheminement, règlement et recours ;
- affectation d'une ou plusieurs remises/effets à une facture, avec montant de
  facture optionnel et contrôle serveur des sur-affectations ;
- parcours de prorogation : créances sources, effets de remplacement et
  préparation de plusieurs chèques SODATRA ;
- approbation et confirmation de remise des chèques par un second acteur ;
- proposition puis confirmation indépendante des rapprochements Daily v2 ;
- visibilité des preuves devenues supersédées, sans effacement de l'historique.

L'écran rappelle explicitement la finalité du produit : préparer, contrôler et
justifier les données, sans passer d'écriture comptable et sans exécuter de
paiement.

## Fermeture des cibles distantes

La fonctionnalité exige simultanément :

1. `VITE_COLLECTIONS_0Z1B_LOCAL_ENABLED=true` ;
2. une URL Supabase dont l'hôte est strictement `localhost`, `127.0.0.1` ou
   `::1`.

Toute cible staging, production ou distante échoue fermée pour la lecture et
la mutation. Le lien de navigation est alors absent et l'accès direct à la
route ne déclenche aucun appel. Cette protection est additionnelle aux rôles,
capacités et RLS de la base.

## Discipline d'écriture

L'application ne contient aucun `insert`, `update`, `delete` ou `upsert` sur
les tables 0Z1B. Toutes les mutations passent par les RPC métier versionnées :

- création de remise et affectation de facture ;
- création et constitution d'une prorogation ;
- préparation, approbation et confirmation de remise d'un chèque ;
- proposition et confirmation d'un rapprochement.

Chaque commande transporte une clé d'idempotence. Les opérations sensibles
utilisent la version attendue de l'agrégat. Les refus serveur sont présentés à
l'utilisateur sans exposer les détails internes de la base.

## Vérifications locales

### Tests ciblés

Commande :

```text
npm run test:collections-0z1b
```

Résultat : 10 tests réussis, 0 échec. Ils couvrent les cibles autorisées et
refusées, le raccordement des routes, l'absence de mutation directe, la liste
des RPC et les contrôles visibles de séparation des acteurs.

Erratum après contre-revue indépendante : la forme WHATWG `[::1]` est
normalisée en `::1` avant comparaison. Le défaut était fail-closed et n'a
jamais permis l'accès à une cible distante.

### Analyse statique ciblée

Commande :

```text
npx eslint src/pages/CollectionsRemittances.tsx src/features/collections-remittances/*.ts src/App.tsx src/components/Layout.tsx
```

Résultat : sortie 0, aucune erreur ni alerte.

### Build applicatif

Commande :

```text
npm run build
```

Résultat : sortie 0. Les avertissements existants concernent la taille du
bundle et des imports mixtes dynamiques/statiques ; ils ne sont pas introduits
comme erreurs par 0Z1B.

### TypeScript — comparaison exacte à la baseline

Commande canonique :

```text
npx tsc -p tsconfig.app.json --noEmit
```

Résultat réel : 19 erreurs, exactement les 19 erreurs historiques de la
baseline 0Z. Aucun fichier 0Z1B, `App.tsx` ou `Layout.tsx` n'apparaît dans les
erreurs. Statut : `PASS_WITH_BASELINE`, jamais `PASS`.

### Test navigateur local sur pile Supabase Docker

Autorisation : `GO_0Z1B_LOCAL_SUPABASE_BROWSER_E2E_DOCKER_APPROVED`.

La pile Docker officielle Supabase a été démarrée sans exécuter la CLI bloquée,
avec PostgreSQL 17.6, GoTrue, PostgREST et Kong. Les 37 migrations du dépôt ont
été appliquées. Deux utilisateurs, un compte bancaire, une ligne Daily v2 et
toutes les données métier utilisées étaient exclusivement synthétiques.

Le parcours navigateur a couvert : création de deux remises, affectation de
facture, proposition puis confirmation indépendante d'un rapprochement,
constitution d'une prorogation, préparation d'un chèque SODATRA, approbation
par un second acteur et confirmation de sa remise. Le dossier termine en
`FUNDING_COMPLETE`, le chèque en `DELIVERED` et le rapprochement en
`CONFIRMED`.

La tentative d'approbation de son propre chèque par le préparateur a été
refusée par le serveur avec `COLLECTION_TWO_ACTORS_REQUIRED`. La garde Daily v2
était refermée en fin de preuve. Rapport détaillé :
`docs/COLLECTIONS_REMITTANCES_0Z1B_LOCAL_BROWSER_E2E_REPORT.md`.

Statut technique : `PASS_LOCAL_SUPABASE_BROWSER_E2E_DOCKER`.

## Limites et prochaine porte

- aucun accès Supabase distant, staging ou production n'a été effectué ;
- le test navigateur a utilisé uniquement une pile Docker locale jetable et
  des données synthétiques ;
- la contre-revue indépendante locale est clôturée `PASS`, sans P0, P1 ou P2 ;
- son unique observation mineure sur l'adresse IPv6 locale a été corrigée et
  couverte par un test de non-régression ;
- le replay DB PostgreSQL 17 déjà clôturé reste inchangé ;
- le candidat reste non commité et non déployé ;
- le test navigateur a découvert un nouveau bloqueur staging : deux remises de
  même client et même montant sont indiscernables dans le sélecteur de
  rapprochement, puis la file de confirmation n'affiche pas assez d'identité
  métier pour permettre une contre-vérification indépendante fiable ;
- ce bloqueur est désormais corrigé, contre-revu `PASS` et rejoué dans le
  navigateur avec deux acteurs ; statut
  `P1_CLOSED_LOCAL_AFTER_COUNTER_REVIEW_AND_BROWSER_REPLAY` ;
- avant staging restent requis : correction et contre-revue de ce bloqueur,
  second utilisateur réel, capacités nominatives, absence de `CREATE` pour les
  rôles applicatifs sur `public`, et preuves Daily v2 créées par les RPC
  légitimes avec gardes actives.

La porte d'identité est close localement. Les prochaines décisions concernent
les autres prérequis staging déjà listés et exigent un GO d'environnement
distinct ; aucun déploiement n'est autorisé par le présent rapport.
