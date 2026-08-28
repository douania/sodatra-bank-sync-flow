# Operational Import — Multi-Bank Qualification locale

## Statut

`CLOSED — PRODUCTION_RUNTIME_VALIDATED_READ_ONLY` — 2026-08-26.

La phase d'implémentation qualifie localement le comportement fail-closed du
parcours opérationnel. Les phases environnementales, autorisées ensuite par
des GO nominatifs distincts, ont synchronisé et validé le runtime sur staging,
puis publié et validé le même code en production avec la garde de lecture seule.
Aucune banque n'est promue et aucun SQL, migration, changement de schéma,
Auth/RLS, dépendance ou lockfile n'est inclus.

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
8. une cellule ou ligne financière contenant un suffixe OCR invalide est
   refusée intégralement, sans accepter son préfixe numérique ;
9. un document refusé n'est jamais persisté ; les écritures déjà réalisées
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
- toute section `HOLD` annoncée possède un total explicite et chaque ligne
  non vide, hors en-tête reconnu, doit être exploitable.

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

- `test:multi-bank-reports` : **41/41 PASS** ;
- `test:bdk-pdf` : **27/27 PASS** ;
- `test:import-preflight` : **51/51 PASS** ;
- matrice CI applicative : **549 tests / 547 pass / 0 fail / 2 skip** ;
- TypeScript comparatif : **18 diagnostics sur `origin/main`, 16 sur le lot,
  0 nouveau par rapport au SHA revu `4cf39eb`** ;
- ESLint comparatif : **207 erreurs + 11 warnings sur `origin/main`, 180 + 11
  sur le lot** ; le correctif réduit le SHA revu de 182 à 180 erreurs, sans
  nouveau finding ESLint ; ratchet CI vert ;
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

La contre-review read-only de la draft PR #131 au SHA `4cf39eb` a ensuite
identifié deux P1 et trois P2. Le correctif `GO_FIX` :

- capture la cellule financière complète pour les soldes et totaux, et exige
  une correspondance de ligne complète dans les sections bancaires ;
- invalide une section `HOLD` annoncée sans total et contrôle chaque ligne,
  même lorsqu'elle ne commence pas par une date reconnue ;
- bloque les contenus qui portent plusieurs marqueurs de familles, y compris
  les combinaisons avec `BRIDGE` ;
- remplace la promesse UI « BDK complet » par le statut pilote staging ;
- supprime la confiance statique `95`, faute de mesure calculée.

La revalidation indépendante a été poursuivie sur chaque delta versionné avant
le verdict final.

Une première revalidation du commit `2ec9a61` a encore trouvé un P1 mixte :
une section contenant une ligne valide suivie d'une ligne OCR invalide pouvait
conserver la première et ignorer la seconde. Les extracteurs de sections
refusent désormais toute ligne non exploitable qui n'est pas une frontière de
section explicite. Les tests couvrent à la fois « ligne invalide seule » et
« ligne valide + ligne invalide » pour dépôts, chèques, facilités et impayés.
Deux derniers libellés UI promettant une extraction BDK complète ont également
été remplacés par le statut exact de pilote staging. Une nouvelle revalidation
du delta versionné reste requise.

La revalidation du commit `3bea883` a identifié un chevauchement supplémentaire
entre le type de dépôt `REGUL IMPAYE` et l'en-tête de section `IMPAYE`. La
détection des sections exige désormais que leur marqueur commence la ligne,
pour l'entrée de section, les frontières et le contrôle final. Le scénario
nominal et sa variante OCR mixte sont couverts explicitement. Le verdict final
du SHA `a21b693` ne trouve aucun P0, P1 ou P2 ouvert et rend
`PASS_WITH_RESERVES / MERGE_READY`. Les réserves portent uniquement sur la
qualification par fichiers réels anonymisés, la limite amont pdf.js et
l'atomicité inter-documents déjà documentée. Claude Code n'a pas pu exécuter
cette dernière session à cause de son quota local ; le reviewer indépendant
déjà affecté au lot a réalisé la revalidation read-only.

## Merge et CI

La PR #131, `feat(import): qualify multi-bank reports fail-closed`, a été
fusionnée le 2026-08-26. Son head `fb6c24167ed3cf6355848c63cb68adc5c33fa9df`
est intégré dans `main` par le commit
`08a792a9142b40929898edf4853b710d07da9d25`. Le check GitHub Actions
`Lint and build` est terminé avec la conclusion `SUCCESS`.

## Validation staging

Les phases staging ont été exécutées sur le projet Lovable exact
`8c508b94-d03f-4165-ab2b-7a3cd52d2d2b`, relié au projet Supabase staging
canonique `gbbsqcscryygqlmqncyv`, sous les GO nominatifs suivants :

- `GO_VALIDATE_STAGING_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION` :
  préflight en lecture seule ;
- `GO_APPLY_STAGING_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_RUNTIME_SYNC` :
  synchronisation du runtime ;
- `GO_VALIDATE_STAGING_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_RUNTIME_E2E_READ_ONLY` :
  validation E2E en lecture seule ;
- `GO_APPLY_STAGING_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_PRODUCTION_BUILD_PUBLISH` :
  publication du build de production sur staging ;
- `GO_VALIDATE_STAGING_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_PRODUCTION_RUNTIME_E2E_READ_ONLY` :
  validation E2E du runtime de production en lecture seule.

Ces contrôles ont confirmé le routage unique `/upload`, la redirection de
`/upload-bulk`, l'affichage de la matrice de qualification et le maintien de
BDK, ATB, BICIS, ORA, SGBS, BIS et Fund Position au statut `STAGING_PILOT`.
Aucun fichier bancaire, traitement, promotion ou changement de qualification
n'a été déclenché par ces validations.

## Publication et validation production

Les phases production ont été séparées par les GO nominatifs suivants :

- `GO_PRODUCTION_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_PREFLIGHT_READ_ONLY` ;
- `GO_PRODUCTION_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_PUBLISH_RUNTIME` ;
- `GO_PRODUCTION_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_POST_PUBLISH_SMOKE_READ_ONLY` ;
- `GO_PRODUCTION_OPERATIONAL_IMPORT_MULTI_BANK_QUALIFICATION_AUTHENTICATED_SMOKE_READ_ONLY`.

Le préflight a verrouillé les cibles exactes : projet Lovable
`e52d9fce-f1b4-46f8-900c-c559a6eb2115`, URL
`https://sodatra-bank-sync-flow.lovable.app` et projet Supabase canonique
`leakcdbbawzysfqyqsnr`. Le runtime issu de `main` au commit `08a792a` a été
publié sous le déploiement `721a9a80-a067-4186-91f6-a6377afe7edc`. Le bundle
actif est `index-D258g98r.js`.

Le contrôle statique post-publication confirme :

- réponse HTTP `200` pour l'application et le bundle ;
- quatre références à la cible Supabase production et aucune référence à la
  cible staging ;
- présence des libellés `Production en lecture seule` et `Pilote staging` ;
- aucun appel direct `console.*`, aucun `debugger` et aucune source map exposée.

Le smoke anonyme a vérifié `/dashboard`, `/upload`, `/upload-bulk` et
`/document-understanding` : les quatre routes redirigent vers `/auth`, sans
exposer d'écran d'import ni de contenu protégé. Aucun appel Supabase n'a été
émis ; seuls les événements de télémétrie Lovable ont utilisé `POST`.

Le smoke authentifié a ensuite confirmé :

- `/upload` affiche `Production en lecture seule` et ne rend aucun sélecteur de
  fichier ni bouton d'import, de traitement ou de promotion ;
- `/upload-bulk` redirige vers `/upload` et conserve la même garde ;
- BDK, ATB, BICIS, ORA, SGBS, BIS et Fund Position restent visibles comme
  `Pilote staging` ; Client Reconciliation reste `Bloqué` ;
- l'unique requête Supabase observée est un `GET /rest/v1/user_roles` en `200`
  vers `leakcdbbawzysfqyqsnr` ;
- aucun appel staging, aucune écriture Supabase ou métier, aucun échec réseau
  et aucune erreur ou alerte console ne sont observés.

## Sécurité et portée de la clôture

La publication ne modifie ni la base, ni les migrations, ni le schéma, ni
Auth/RLS, ni les grants. Aucun fichier bancaire réel ou synthétique n'a été
chargé pendant les smokes production. L'interface production n'expose aucune
capacité d'import ou de promotion, y compris pour les familles marquées
`PRODUCTION_CANDIDATE`.

La garde `Production en lecture seule` est une barrière d'interface, jamais une
barrière de sécurité. La sécurité réelle reste assurée côté serveur par Auth,
les rôles, RLS et les grants. Les smokes établissent l'absence de capacité UI et
de mutation observée dans leurs scénarios ; ils ne prétendent pas démontrer une
impossibilité générale de mutation côté serveur.

Cette clôture valide le déploiement du contrat fail-closed et son comportement
read-only en production. Elle ne constitue pas une qualification opérationnelle
des formats bancaires, n'autorise aucune mutation et ne réduit aucune des
limites ci-dessous.

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

## Clôture et suite autorisable

Le pack de code et de déploiement read-only est clos. La prochaine phase métier
reste une qualification staging avec des fichiers réels anonymisés couvrant
chaque banque et Fund Position, sous un nouveau pack et des GO environnementaux
distincts. Elle n'élargira pas automatiquement la production. Toute promotion
exigera un verdict CTO spécifique, une preuve banque par banque et un GO dédié.
