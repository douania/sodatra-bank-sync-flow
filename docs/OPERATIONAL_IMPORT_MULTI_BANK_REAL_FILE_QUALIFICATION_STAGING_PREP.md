# Operational Import — Préparation de la qualification sur fichiers réels anonymisés

**Date :** 2026-08-28
**Statut :** `PREPARED_LOCAL — REAL_FILES_NOT_PROVIDED — STAGING_NOT_EXECUTED`

## Objectif

Préparer une campagne reproductible permettant d'évaluer les formats réels de
BDK, ATB, BICIS, ORA, SGBS, BIS et Fund Position avant toute promotion. Ce pack
ne traite aucun fichier bancaire, n'accède à aucun environnement et ne modifie
aucune qualification.

Les décisions restent inchangées :

- les six banques et Fund Position restent `STAGING_PILOT` ;
- Client Reconciliation reste `BLOCKED` ;
- un succès local ne vaut ni preuve staging, ni autorisation de production ;
- la production reste en lecture seule.

## Livrables techniques

- `operationalImportRealFileQualification.ts` exécute les contrats fail-closed
  existants sur du texte extrait et ne retourne que des compteurs, booléens et
  codes d'erreur ;
- `qualifyOperationalImportRealFile.ts` lit un unique PDF/XLSX/XLS depuis un
  chemin absolu extérieur au dépôt, sans copie temporaire ni accès réseau ;
- la suite CI `test:multi-bank-reports`, déjà bloquante, couvre le résultat
  agrégé, les refus, l'absence de données brutes et les protections de la CLI.

La CLI n'importe aucun client Supabase, ne contient aucun appel réseau et
n'appelle aucun service de persistance. Elle refuse :

- l'absence d'attestation `--anonymized` ;
- un chemin relatif ou situé dans le dépôt, y compris après résolution des
  liens ;
- un fichier vide, supérieur à 25 Mio ou dans un autre format ;
- une identité bancaire non corroborée ;
- tout document qui échoue aux contrats financiers fail-closed existants.

## Données requises pour la campagne

Le propriétaire des données doit fournir volontairement, hors du dépôt :

| Famille | Minimum requis | Formats |
|---|---:|---|
| BDK | 1 rapport représentatif anonymisé | PDF |
| ATB | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |
| BICIS | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |
| ORA | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |
| SGBS | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |
| BIS | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |
| Fund Position | 1 rapport représentatif anonymisé | PDF, XLSX ou XLS |

Une seconde période ou variante par famille est recommandée avant toute
promotion, mais ne doit pas être fabriquée à partir de données réelles dans le
dépôt.

## Exigences d'anonymisation

Avant remise au chantier, chaque fichier doit supprimer ou remplacer de manière
irréversible les noms de clients, numéros de compte et IBAN, références de
paiement, factures, chèques, coordonnées, emails et téléphones. Les marqueurs de
banque, la structure des lignes/colonnes, les intitulés de sections et des
valeurs financières représentatives doivent rester cohérents pour que le test
soit utile.

L'option `--anonymized` est une attestation opérateur, pas un anonymiseur. Le
harness ne doit jamais être utilisé pour transformer ou nettoyer un document
source.

## Exécution locale préalable

Exemple PowerShell, avec un fichier conservé dans un répertoire sécurisé hors
du dépôt :

```powershell
npx tsx scripts/qualifyOperationalImportRealFile.ts `
  --family BDK `
  --case-id BDK-R1 `
  --file "C:\SODATRA-QUALIFICATION-SECURE\BDK-R1.pdf" `
  --anonymized
```

Familles acceptées par `--family` : `BDK`, `ATB`, `BICIS`, `ORA`, `SGBS`,
`BIS`, `FUND_POSITION`.

La sortie JSON autorisée contient uniquement :

- identifiant de cas non sensible ;
- famille et format ;
- SHA-256, taille et nombre de caractères extraits ;
- compteurs de sections et indicateurs de présence ;
- décision `FAIL_CLOSED` ou
  `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` ;
- codes d'erreur fermés ;
- invariants `persistenceAttempted=false`, `environmentAccessed=false` et
  `promotionAuthorized=false`.

Elle ne contient ni chemin, ni nom de fichier, ni texte extrait, ni date, ni
montant, ni banque de détail, ni client, ni référence. Ne pas rediriger la
sortie vers un fichier situé dans le dépôt.

## Matrice de décision locale

Pour chaque famille :

1. calculer et conserver hors dépôt l'empreinte du fichier reçu ;
2. exécuter la CLI une seule fois sous un identifiant de cas non sensible ;
3. classer le résultat :
   - `FAIL_CLOSED` : aucune tentative staging ; diagnostic parser dans un lot
     correctif séparé, sans publier le fichier ni sa donnée brute ;
   - `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` : cas éligible à une revue
     humaine, puis à une validation staging sous GO distinct ;
4. obtenir la confirmation humaine que banque, date, soldes, sections et
   compteurs agrégés correspondent au document anonymisé ;
5. ne jamais déduire une promotion d'un résultat local.

La campagne ne peut être déclarée complète que si les sept familles possèdent
au moins un cas nominal revu humainement. Un seul échec maintient la famille
concernée en `STAGING_PILOT` et interdit toute promotion groupée.

## Phase staging future — non autorisée par ce pack

Après réception et PASS local des fichiers, un nouveau préflight devra :

1. verrouiller Lovable staging
   `8c508b94-d03f-4165-ab2b-7a3cd52d2d2b` et Supabase staging
   `gbbsqcscryygqlmqncyv` ;
2. vérifier que le build testé correspond au SHA approuvé ;
3. inventorier les tables/RPC susceptibles d'être écrites et définir avant
   l'essai la stratégie de rollback ou de nettoyage ;
4. nommer précisément les fichiers anonymisés autorisés, les opérateurs et les
   familles testées ;
5. obtenir un `GO_VALIDATE_STAGING_<PACK>` pour les lectures, puis un
   `GO_APPLY_STAGING_<PACK>_<ACTION>` séparé pour tout upload, traitement,
   persistance ou nettoyage ;
6. vérifier après chaque cas les écritures, doublons, erreurs, audit et état
   final ;
7. supprimer les copies temporaires et confirmer l'absence de données de test
   résiduelles.

Aucun accès staging, upload, traitement, SQL, migration, nettoyage ou rollback
n'est exécuté dans le présent pack.

## Stop conditions

STOP immédiat si :

- le fichier n'a pas été fourni volontairement ou son anonymisation n'est pas
  attestée ;
- un secret, une identité, un compte, une référence ou une donnée non
  anonymisée est visible ;
- le fichier ou une sortie est situé dans le dépôt ;
- la famille attendue n'est pas corroborée par le contenu ;
- le parseur produit une donnée inventée, un fallback ou une ambiguïté ;
- une donnée brute apparaît dans stdout, les logs, une capture ou un rapport ;
- une persistance, un accès réseau ou une promotion est tenté ;
- le staging exact, le SHA, le rollback ou le GO ne sont pas verrouillés.

## Critère de fin de préparation

La préparation est terminée lorsque le harness et ses contrats sont fusionnés.
La qualification réelle restera `NOT_STARTED` jusqu'à réception des sept
fichiers anonymisés et émission des GO staging dédiés.
