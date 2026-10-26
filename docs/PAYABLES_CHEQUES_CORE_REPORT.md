# PAYABLES-CHEQUES-CORE — Factures, engagements et chèques émis

> Rapport du lot `GO_IMPLEMENT_PAYABLES_CHEQUES_CORE` (P5). Statut :
> **implémenté localement, PR en brouillon, migrations non appliquées**. Aucune
> disponibilité staging ni production n'est revendiquée par ce document.

## 1. Métadonnées

| Élément | Valeur |
|---|---|
| Base | `origin/main` = `7c03b548213f129715685be8276c4ec3d7348408` (revérifiée en GET au préflight) |
| Branche | `codex/payables-cheques-core`, worktree isolé neuf |
| GO reçus | `GO_IMPLEMENT_PAYABLES_CHEQUES_CORE`, `GO_VALIDATE_LOCAL_PAYABLES_CHEQUES_CORE_SYNTHETIC`, `GO_VALIDATE_LOCAL_PAYABLES_CHEQUES_REAL_FILES_READ_ONLY` |
| Hors GO (non fait) | merge, déploiement, SQL distant, staging, production, impression physique |
| Référence fonctionnelle | conception canonique Pack 2B R2 (hors dépôt) et arbitrages CTO du 25 octobre 2026 |

## 2. Périmètre livré

Parcours couvert : facture → demande de paiement réservée → impression ORABANK →
signature hors application → confirmation de l'émission réelle → remise → suivi
bancaire → sortie de circulation.

- **Fournisseurs et factures** : référentiel commun (doublon de nom normalisé refusé
  par le serveur) ; facture identifiée par fournisseur canonique et référence exacte ;
  collision instruite en exception, jamais contournée (`AUTHORIZE_DISTINCT` crée une
  facture distincte avec un ordinal, référence inchangée) ; montant, échéance
  facultative (« non renseignée »), justificatif ; facture engagée non modifiable.
- **Paiements et allocations** : paiement unique du restant par défaut, partiel sur
  choix explicite ; allocation `RÉSERVÉ → ENGAGÉ → ANNULÉ` sur la même ligne ; plafond
  calculé hors la propre allocation ; protection serveur sous verrou de facture contre
  les dépassements concurrents ; virement déclaré en une écriture, sans ordre bancaire,
  dépassement conservé sans allocation et facture bloquée.
- **Chèques** : numéro préimprimé saisi en texte (zéros conservés, unicité par compte,
  jamais réaffecté) ; contenu signable produit par le serveur (montant en chiffres et en
  lettres, bénéficiaire, date et lieu imprimés, devise, compte, numéro), versionné et
  haché ; intention d'impression enregistrée avant l'impression, résultat confirmé par le
  comptable (imprimé, non imprimé, gâché, incertain) ; signatures enregistrées sur la
  version courante ; confirmation d'émission avec contrôle signataire ≠ préparateur
  (par personne rattachée), admissibilité aux deux dates, règle de signature en vigueur
  à la date d'émission ; émission déclarée en exception (montant inconnu admis,
  indisponible, jamais zéro ; compte bloqué) ; remise au bénéficiaire.
- **Sorties hors banque** : annulation, remplacement (transfert atomique de
  l'allocation, remplaçant `RÉSERVÉ` hors circulation), correction de la date réelle
  d'émission (nouvelle révision) ; toujours validées par un autre acteur.
- **Reprise initiale** : lot contrôlé (nombre et total), approbation par un autre
  comptable, attestation d'exhaustivité par compte, intégration unique, collision avec
  la saisie courante instruite.
- **Formules pré-signées** : inventaire du risque ; utilisation refusée dans le circuit
  approuvé ; perte = exception bloquante.
- **Travail en équipe** : file partagée (ancienneté, verrous visibles), verrous de
  traitement expirables et levables par un autre habilité (tracés), contrôle de version
  optimiste sur chaque agrégat modifiable (`PAYABLES_STALE_VERSION`).
- **Gouvernance** : personnes, rattachements vérifiés aux comptes, capacités
  nominatives, paramètres versionnés (signataires, règles de signature, catégories,
  profils d'impression) proposés par un habilité et validés par un autre ; aucune
  auto-attribution ; l'administration technique ne confère aucun droit métier.
- **Rapprochement multibanque** (arbitrage du 25 octobre 2026) : projection séparée des
  références, calculée côté serveur depuis les lignes Daily v2 canoniques ; grammaires
  fermées et versionnées pour BDK, ORA, ATB et BICIS ; frais, retraits et formes
  inconnues exclus ; propositions exactes et non ambiguës confirmées par un comptable ;
  recontrôle serveur à la confirmation ; remplacement de relevé signalé puis instruit
  (révocation ou rattachement revérifié), jamais réinterprété en silence.
- **Vue opérationnelle par compte** : dernier relevé et sa date, solde bancaire ou motif
  d'indisponibilité, chèques en circulation, engagements chèques non débités, virements
  déclarés en attente (à part), position indicative après chèques uniquement si toutes
  les conditions sont réunies, factures restant à engager regroupées par échéance.

Exclus : comptabilité, SAGE, P4, facilités, encaissements, Fund Position, exports
officiels de trésorerie, ordres bancaires, reproduction de signature, profils
d'impression autres qu'ORABANK, corrections ORAB/BIS/BRIDGE/NSIA de Daily v2.

## 3. Fichiers

| Type | Fichiers |
|---|---|
| Migrations (nouvelles) | `supabase/migrations/20261026090000_payables_cheques_core.sql`, `supabase/migrations/20261026090100_payables_cheques_bank_followup.sql` |
| Tests serveur | `supabase/tests/payables_cheques_core/**` (shim, 11 fichiers d'assertions, courses, runner PowerShell, README) |
| Front (nouveaux) | `src/features/payables-cheques/**`, `src/pages/PayablesCheques.tsx` |
| Modifiés | `src/App.tsx` (route protégée), `src/components/Layout.tsx` (entrée de menu contrôlée), `package.json` (script `test:payables-cheques` uniquement), `.github/workflows/ci.yml` (deux étapes ajoutées), `docs/STATUS_REGISTRY.md`, `docs/MASTER_CONTEXT.md` |
| Non touchés | migrations historiques, Daily v2, Collections Core, Auth/RLS existants, `src/integrations/supabase/types.ts`, `.env*`, lockfile, dépendances, artefact MCP, PR #149 |

## 4. Sécurité et serveur

- Schéma privé `payables_private` (aucun `USAGE` applicatif) : interrupteur
  `runtime_control` fermé par défaut, portée export figée fermée (`CHECK`), journal
  des bascules en ajout seul ; ouverture uniquement par l'opérateur sous GO
  d'environnement ; aucun setter RPC.
- Toutes les écritures passent par des fonctions `SECURITY DEFINER` au `search_path`
  épinglé ; `REVOKE` de toutes les fonctions du domaine (y compris le privilège
  `service_role` accordé par défaut par la plateforme) puis `GRANT` ciblé au rôle
  `authenticated`.
- RLS en lecture seule fondée sur `READ`/`AUDIT` ; journal du domaine lisible par
  `AUDIT` seulement ; registre de commandes non lisible.
- Aucune suppression (déclencheurs d'instruction sur toutes les tables) ; faits
  immuables (contenus, signatures, émissions, remises, références, déclarations) ;
  versions décidées immuables.
- Idempotence par registre de commandes dédié (SHA-256 du contenu, rejeu identique sans
  second effet, contenu différent refusé).
- Codes d'erreur fermés `PAYABLES_*` ; le client n'affiche jamais le texte serveur brut.
- Amorçage de la gouvernance : `payables_private.bootstrap_parameter_governance`
  (opérateur, deux utilisateurs distincts, une seule fois).

## 5. Validations exécutées

Environnement local : Node 22.23.1, npm 10.9.8, ESLint 9.13.0, TypeScript 5.6.3
(lockfile), Docker Desktop, image `postgres:17-alpine` (17.10). Le CI exécute Node 20.

| Commande | Résultat |
|---|---|
| `npx eslint . -f json` comparé item par item à la baseline du même worktree avant modification | baseline 178 erreurs / 11 avertissements ; branche 178 / 11 ; **0 nouvel item, 0 disparu** |
| `npx tsc -p tsconfig.app.json --noEmit` | baseline 16 diagnostics ; branche 16 ; **diff exact vide** |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `npm run build` | succès ; artefact `supabase/functions/mcp/index.ts` inchangé |
| `npm run test:payables-cheques` | 34 tests, 34 réussis, 0 ignoré |
| Toutes les suites Node du CI (19 scripts `test:*`, globs Daily v2 dashboard et session, hygiène des journaux) | 22 suites, 0 échec, 0 ignoré |
| `supabase/tests/payables_cheques_core/run_pg17_replay.ps1`, lancé dans un processus Windows PowerShell 5.1 neuf | 11 fichiers `PASS`, `CONCURRENT_RESERVATION_BLOCKED` et `CONCURRENT_CONFIRMATION_BLOCKED` (la session perdante attend environ 2,9 s puis échoue fermée), `SWITCH_CHANGE_WAITS_FOR_WRITES` (2,6 s), `PAYABLES_CHEQUES_CORE_PG17_REPLAY_PASS` |
| `supabase/tests/collection_report_controlled_activation/run_pg17_replay.ps1` (non modifié par ce lot) | non exécutable localement : sous Windows PowerShell 5.1, la sortie d'erreur de `docker logs` lève `NativeCommandError` (limite d'environnement antérieure au lot, PowerShell 7 absent du poste) ; le CI l'exécute sous `pwsh` Linux |
| `git diff --check` | aucune erreur |

Le runner du lot impose désormais l'encodage UTF-8 du tube vers `docker` (sous
Windows PowerShell 5.1, l'encodage par défaut est ASCII et remplaçait les accents par
« ? ») ; le fichier 10 vérifie en tête que le transport conserve l'UTF-8.

Preuves de mordant (mutations temporaires sur copies, migrations du dépôt non modifiées) :

| Mutation | Effet observé |
|---|---|
| Garde `assertReady` retirée du service | 2 tests du service échouent |
| Contrôle de second acteur retiré de `payables_validate_exit_v1` | le test 50 échoue ; la contrainte de table refuse encore l'auto-validation |
| Verrou `FOR UPDATE` de la facture retiré de `payables_create_cheque_request_v1` | la course réelle échoue (« loser did not fail closed ») |
| Ensemble des préparateurs ramené à demande + impressions réussies | 41 échoue (déclarant du résultat accepté comme signataire) |
| Libération autorisée avec une formule perdue | 41 échoue (abandon accepté) |
| Contrôle des catégories rendu permissif au NULL | 20 échoue (signataire sans catégories accepté) |
| Montant inconnu sans blocage de facture | 41 échoue |
| Contrôle de doublon de référence de virement retiré | 30 échoue |
| Recontrôle de la correction de date retiré | 50 échoue (date antérieure à la signature acceptée) |
| Alerte de débit d'une formule non émise retirée | 60 échoue |
| Borne « signature postérieure à l'impression » retirée | 41 échoue |

Parité SQL ↔ TypeScript : corpus communs du montant en lettres (40 montants, règles
traditionnelles) et des grammaires bancaires (25 libellés synthétiques, dont tabulations,
retours et espaces insécables jamais assimilées à un séparateur) lus par les deux suites.

### Rejeu agrégé sur fichiers réels (`GO_VALIDATE_LOCAL_PAYABLES_CHEQUES_REAL_FILES_READ_ONLY`)

Fonctions pures uniquement (lecteurs Daily v2 inchangés et grammaires du module), en
mémoire, sans copie, sans persistance, sans RPC, sur les six exports ONLINE et les sept
classeurs autorisés. Empreintes SHA-256 des 16 fichiers du dossier identiques avant et
après. Sortie agrégée :

| Banque | Débits | Références extraites | Corroborées (numéro exact et montant dans le classeur) | Exclues |
|---|---|---|---|---|
| BDK | 25 | 14 | 14/14 | 3 frais, 2 retraits ; 6 « famille reconnue, numéro absent » |
| ORA | 19 | 3 | 2/3 | 14 frais |
| ATB | 17 | 5 | 5/5 | 6 frais |
| BICIS | 44 | 15 | 13/15 | 26 frais |
| BIS | 4 304 | 0 (non qualifiée) | — | — |
| BRIDGE | 20 | 0 (non qualifiée) | — | — |
| NSIA | aucun export ONLINE | — | — | — |

Aucun frais ni retrait n'a produit de référence. Aucun exemple réel n'est versé dans
Git, les tests, les journaux ou la PR.

## 6. Décisions de conception à ratifier

1. **Préparateur** = auteur de la demande, auteur de l'assignation de la formule, auteurs
   de toute version du contenu signable (ajustements compris), demandeurs et déclarants
   de toute impression réussie ou incertaine ; chacun doit être rattaché à une personne
   vérifiée, sinon `PAYABLES_PREPARER_NOT_LINKED` (aucune comparaison sur un nom libre).
2. **Signature non admissible présente** sur la version courante : approbation refusée
   même si d'autres signatures suffiraient (lecture conservatrice).
3. **Collision de facture à la création** : exception ouverte non bloquante (la facture
   existante n'est pas bloquée).
4. **Fusion de fournisseurs sans engagement ni collision** : appliquée à la proposition ;
   avec engagements : validation par `SUPPLIER_MERGE_VALIDATE`. Une fusion n'agrège jamais
   des factures ; seule la collision de références est détectée.
5. **Instruction des dépassements** : `ALLOCATE_REMAINING` engage au plus le restant de la
   facture, l'excédent restant documenté ; `DOCUMENTED_NO_ALLOCATION` lève le blocage sans
   allocation.
6. **Grammaires v1** : uniquement les familles corroborées sur fichiers réels (BDK
   « CHEQUE RECU COMPENSE CHQ N », ORA « CHQ RECU COMPENSE … CHQ OCI N. », ATB « REGLMT
   CHEQUE COMPENSE CHEQUE REF », BICIS « REGLMT CHQ COMPENSE NO … FAVEUR ») ; numéros de
   sept chiffres ; un mot-clé de frais n'importe où dans le libellé exclut la ligne
   (sûreté : aucune sortie plutôt qu'une sortie fausse).
7. **Position indicative** : conditions = solde du dernier relevé disponible, registre
   `COMPLET` (reprise intégrée et attestée), banque qualifiée, aucune ligne de débit
   postérieure à la reprise sans référence calculée, ambiguë, à référence non consommée
   ou à forme inconnue, aucune exception bloquante, aucun montant inconnu, écart de
   couverture des relevés d'au plus 3 jours calendaires (règle provisoire tant que le
   calendrier ouvré n'est pas arrêté).
8. **Retraits par chèque** : exclus des propositions ; le chèque reste en circulation
   jusqu'à une sortie validée (position conservatrice).
9. **Gouvernance** : rattacher un gouverneur à une personne exige un troisième validateur
   (validateur ≠ proposant ≠ utilisateur rattaché).
10. **Durée des verrous** : 30 minutes par défaut, paramètre de l'interrupteur (5 à 480).
11. **Confirmation d'émission sur facture bloquée** : admise (contrat S19, « faits déjà
    réalisés enregistrables ») ; elle ne fait qu'engager la réservation existante du
    paiement et n'en crée aucune. Alternative possible : refus et passage obligé par
    l'émission déclarée en exception.
12. **Correction de facture** : refusée sur facture bloquée ou portant un engagement ;
    aucune validation par un second acteur dans cette version (à ratifier).
13. **Doublon de virement** : une même référence bancaire (casse et blancs de bord
    ignorés) n'est déclarée qu'une fois par compte ; le contrôle est limité au compte
    (une référence identique sur un autre compte n'est pas comparée).
14. **Date de signature** : jamais antérieure à l'intention d'impression de la version
    signable (le résultat peut être déclaré plus tard sans décaler la borne).
15. **Débit d'une formule non émise au registre** (assignée, imprimée non confirmée,
    incertaine, inutilisée, perdue, détenue pré-signée) : exception
    `UNISSUED_FORM_PRESENTED` bloquant le compte et, si un paiement est rattaché, sa
    facture ; aucune proposition.
16. **Lecture des relevés par le domaine** : les vues `SECURITY DEFINER` exposent aux
    détenteurs de `READ` des soldes et montants de lignes Daily v2 (jamais les libellés),
    indépendamment des rôles de lecture Daily v2. Alternative : exiger en plus le rôle
    de lecture Daily v2 (décision CTO).

## 6 bis. Revue indépendante interne

Revue indépendante (agent distinct, code, migrations et tests) menée avant la PR.

| Constat | Traitement |
|---|---|
| P1 — confirmation d'émission sur facture bloquée | conservée selon le contrat S19 ; décision 11 à ratifier |
| P1 — abandon de paiement possible avec une formule perdue | corrigé : libération seulement si toutes les formules sont assignées ou inutilisées ; test 41 |
| P1 — ensemble des préparateurs incomplet | corrigé (décision 1) ; tests 41 (déclarant du résultat, auteur d'ajustement) |
| P1 — signataire sans catégories admis (logique NULL) | corrigé : tous les contrôles de type JSON en `IS DISTINCT FROM`, admissibilité durcie, contenu exact affiché au valideur ; tests 20 |
| P2 — signature ou correction de date antidatées | corrigé : borne de signature (décision 14) ; la correction d'une émission normale recontrôle règle, signatures et habilitation à la date corrigée ; tests 41 et 50 |
| P2 — correction d'une facture bloquée | corrigé : refusée ; test 41 ; second acteur en décision 12 |
| P2 — émission en exception à montant inconnu sans blocage | corrigé : facture bloquée jusqu'à l'établissement du montant ; test 41 |
| P2 — doublon de virement non détecté | corrigé (décision 13) ; test 30 |
| P2 — débit d'une formule non émise ignoré | corrigé (décision 15) ; test 60 |
| P2 — lecture des relevés hors RLS Daily v2 | soumis au CTO (décision 16) |
| P3 — normalisation des blancs SQL/TS divergente sur l'espace insécable | corrigé : classe ASCII explicite des deux côtés ; corpus étendu |
| P3 — identifiant de compte exposé dans la file partagée (habilitations) | corrigé : plus d'identifiant de compte dans la file |
| P3 — cycle d'impression : pas de retour après « rien imprimé », écouteur non nettoyé | corrigé : retour à l'état initial après déclaration, écouteur retiré à la fermeture déclarée et au démontage ; contrat de rendu étendu |
| P3 — numéro de reprise absent accepté (logique NULL) | corrigé par le même durcissement JSON |
| P3 — autres points | consignés en limites (section 8) |

## 7. Conditions de mise en service (hors développement)

- `GO_APPLY_STAGING_PAYABLES_CHEQUES_CORE` : application des deux migrations sur
  `gbbsqcscryygqlmqncyv`, puis amorçage de la gouvernance et ouverture opérateur de
  l'interrupteur ; drapeau client `VITE_PAYABLES_CHEQUES_STAGING_ENABLED` (staging exact).
- Valeurs : personnes et habilitations nominatives, signataires et plafonds vérifiés
  contre les pouvoirs bancaires, catégories, règles de signature par compte.
- Profil ORABANK `VALIDÉ` après essai sur papier ordinaire superposé à une formule, sur
  l'imprimante cible (échelle 100 %), sans consommer de formule.
- Reprise initiale attestée compte par compte ; date de bascule.
- Daily v2 : qualification et ouverture des banques concernées (le rapprochement
  dépend des lignes canoniques) ; corrections ORAB, BIS, devise BRIDGE et profil NSIA
  sous GO distincts.
- Production : refusée par la garde client ; `GO_PRODUCTION_*` distinct requis.

## 8. Limites et risques résiduels

- La lecture de cohérence de la vue repose sur une seule instruction SQL (un instantané) ;
  aucun export n'existe dans ce lot (2B-E non couvert).
- Les débits « famille reconnue, numéro absent » (6 sur 25 chez BDK) restent en attente
  et rendent la position indicative indisponible tant qu'ils ne sont pas instruits ;
  aucune voie de sortie hors référence n'est prévue par l'arbitrage.
- L'impression passe par le navigateur (HTML/CSS) ; le pilote et ses réglages ne sont pas
  pilotés par le logiciel ; la qualification physique reste à faire.
- L'interface n'a pas été exercée sur une base réelle (aucun environnement autorisé) ;
  elle est couverte par des tests de modèles, de service et de rendu statique.
- Ordre des verrous non uniforme entre quelques fonctions (signature, décision de
  rapprochement, instruction d'exception) : un interblocage éventuel annule la
  transaction (`40P01`) sans atteinte à l'intégrité ; à homogénéiser.
- Quelques refus restent hors vocabulaire fermé (conversion JSON invalide, violation
  d'unicité de dernier recours) : l'interface affiche alors le message générique, jamais
  le texte serveur.
- Une proposition de rapprochement rejetée est reproposée au passage suivant (bruit
  visible, sans effet) ; une réservation reste `RÉSERVÉE` après un dépassement instruit
  sans allocation (la facture reste couverte, statut à arrêter avec le CTO) ; la fusion
  de fournisseurs ne verrouille pas les factures du fournisseur absorbé ; les verrous de
  traitement ne sont pas contrôlés par toutes les écritures (confort d'équipe, jamais
  l'intégrité, par conception).
- Lectures de l'interface limitées par le plafond de lignes PostgREST (1 000) : suffisant
  pour le pilote, à paginer avant un usage à volume.
- Revue indépendante obligatoire avant toute fusion ou application.
