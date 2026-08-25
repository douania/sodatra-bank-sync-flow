# Operational Import — Multi-Bank Qualification locale

## Statut

`IMPLEMENTED_LOCAL — INDEPENDENT_REVIEW_PASS_WITH_RESERVES` — 2026-08-25.

Ce lot qualifie localement le comportement fail-closed du parcours
opérationnel. Il ne publie rien, ne promeut aucune banque et ne touche ni à
Supabase live, ni à Lovable, ni au SQL, aux migrations, au schéma, à Auth/RLS,
aux dépendances ou au lockfile.

## Décisions CTO appliquées

- `Document Understanding` est strictement read-only ;
- `bankingUniversalService.saveReport` refuse avant tout accès Supabase ;
- BDK n'est plus candidat production : toutes les banques de `/upload` et
  Fund Position restent `STAGING_PILOT` ;
- Client Reconciliation reste `BLOCKED` ;
- une preuve synthétique locale ne vaut jamais promotion ;
- la qualification réelle exigera des fichiers anonymisés représentatifs et
  un GO staging séparé.

## Contrat bancaire fail-closed

Pour BDK, ATB, BICIS, ORA, SGBS et BIS :

1. le nom du fichier identifie exactement une banque ;
2. le contenu identifie exactement la même banque ;
3. le texte conserve au moins trois lignes structurées ;
4. la date de rapport est explicitement extraite et calendaire ;
5. les soldes d'ouverture daté et de clôture sont explicitement présents ;
6. tout montant extrait est un entier FCFA sûr ;
7. une section déclarée sans ligne exploitable invalide le rapport ;
8. un document refusé n'est jamais persisté ; les écritures déjà réalisées
   pour un autre document valide du même batch ne sont pas atomiquement annulées.

La reconstruction PDF groupe les tokens positionnés par coordonnées. Un flux
mixte sans coordonnées complètes est refusé. Deux tokens financiers adjacents
sont séparés en colonnes explicites ; si leur frontière est indéterminable, le
document est refusé au lieu de fusionner silencieusement les montants.
Limite de la bibliothèque amont : pdf.js peut fusionner lui-même deux zones
numériques proches dans un seul token avant de les exposer à l'application.
Cette frontière devenue invisible ne peut pas être reconstruite localement et
reste une réserve de qualification sur fichiers réels.

## Contrat Fund Position fail-closed

Un Fund Position est accepté uniquement si :

- sa date est explicitement extraite et valide ;
- `GRAND TOTAL` est explicitement présent et valide, zéro compris ;
- au moins un détail bancaire est exploitable ;
- tous les montants du détail sont des entiers sûrs.
- les six colonnes du détail bancaire sont explicitement délimitées.

Il n'existe plus de repli sur la date du jour, de `GRAND TOTAL` absent converti
en zéro, ni de succès avec tableau de détails vide.

## Preuves automatisées

La nouvelle commande `test:multi-bank-reports`, bloquante dans la CI, couvre :

- taxonomie et corroboration d'identité bancaire ;
- dates calendaires et montants FCFA ;
- reconstruction PDF, baselines proches, faible écart de colonne et refus du
  flux mixte ambigu ;
- cas nominal synthétique des six banques ;
- refus banque incohérente, texte aplati, date/solde invalide et section vide ;
- Fund Position nominal, grand total zéro et cas d'échec ;
- absence d'appel de persistance depuis `UniversalBankParser` et garde
  défensive de `saveReport` ;
- refus du faux succès BDK read-only lorsque le format est non supporté ou que
  l'extracteur historique traverse une ligne.

Résultats locaux après réconciliation des findings :

- `test:multi-bank-reports` : **38/38 PASS** ;
- `test:bdk-pdf` : **27/27 PASS** ;
- `test:import-preflight` : **50/50 PASS** ;
- matrice CI : **545 tests / 543 pass / 0 fail / 2 skip** ;
- TypeScript comparatif : **0 diagnostic sur `origin/main`, 0 sur le lot** ;
- ESLint comparatif : **207 erreurs + 11 warnings sur `origin/main`, 182 + 11
  sur le lot**, ratchet CI vert ;
- ESLint ciblé nouveaux contrats/chemins : **PASS** ;
- build Vite production : **PASS** ;
- hygiène du bundle : **4/4 PASS** ;
- `git diff --check` : **PASS**.

La première contre-review Claude Code a rendu `FAIL/NOT_READY` avec quatre P1.
Après leur réconciliation, la deuxième a isolé un dernier P1 de frontière
numérique. Le correctif ciblé refuse désormais les coordonnées incomplètes,
sépare toute frontière financière observable et refuse les lignes Fund
Position non délimitées. La revalidation indépendante finale rend
`PASS_WITH_RESERVES / READY` pour commit et draft PR uniquement, sans P0/P1.
Ses P2 corrigeables ont ensuite été réconciliés : index montant des dépôts
multi-banques, impayé à date unique, motif de refus PDF propagé et anciens
points d'entrée permissifs explicitement désactivés.

## Limites assumées

- les fixtures synthétiques prouvent le contrat logiciel, pas la compatibilité
  avec toutes les variantes de documents bancaires réels ;
- pdf.js peut agréger des colonnes très proches dans un token unique avant que
  l'application voie leurs coordonnées ; cette ambiguïté amont impose une
  qualification par fichiers réels et maintient le statut `STAGING_PILOT` ;
- le parser BDK spécialisé historique sait lire certains rapports que le
  chemin générique refuse encore lorsqu'une section est seulement partiellement
  comprise ; ce refus est volontaire et sûr ;
- la fixture BDK de forme réaliste du dépôt est ainsi refusée sur `/upload` par
  le contrat générique ; elle ne constitue pas une preuve de compatibilité
  opérationnelle de ce chemin ;
- la persistance du batch reste non atomique entre documents frères : un refus
  tardif n'annule pas une écriture antérieure réussie ;
- les champs métier « checks not persisted » et la gouvernance des noms
  Internal Book restent documentaires et hors de ce lot ;
- aucun refactoring Daily v2 ni suppression des services spécialisés legacy
  n'est inclus.

## Suite autorisable

Après commit, draft PR, contre-review du delta versionné et merge sous GO
distincts : qualification staging avec fichiers
anonymisés couvrant chaque banque, sans élargissement automatique de la cible
production. Toute promotion exigera un nouveau verdict CTO et un GO dédié.
