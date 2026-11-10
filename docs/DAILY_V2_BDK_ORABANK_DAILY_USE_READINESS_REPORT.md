# DAILY-V2-BDK-ORABANK-DAILY-USE-READINESS — rapport du pack

GO : `GO_IMPLEMENT_DAILY_V2_BDK_ORABANK_DAILY_USE_READINESS`, `GO_VALIDATE_STAGING_DAILY_V2_BDK_ORABANK_DAILY_USE_READINESS`,
`GO_APPLY_STAGING_DAILY_V2_BDK_ORABANK_DAILY_USE_READINESS`.

- Base : `main` `88ef056a90cc9c13259665c00a17148186da8cf9` (arbre `51e33e0`).
- Branche : `codex/daily-v2-bdk-orabank-daily-use-readiness`, dans un worktree isolé.
- Le worktree de référence `sbsf-daily-v2-operational-readiness` et les autres checkouts sont intacts : aucun stash,
  aucun nettoyage.

Objectif : mise en exploitation quotidienne BDK/ORABANK par un opérateur unique, l'utilisateur lui-même. Le pack
contient :

- le correctif du gestionnaire de confirmation (§1) ;
- la procédure opérateur (§2) ;
- le pilote sur le staging hébergé (§3) ;
- le dossier de mise en service (§5) et la matrice Trésorerie (§6).

Deux versions restent distinguées :

- **correctif nouveau** : cette branche et sa draft PR. Il n'est ni publié ni déployé ;
- **pilote hébergé** : la version déjà validée `26a40d0` (sources `88ef056`) sur `https://cash-sync-wiz.lovable.app`.

Aucun résultat du pilote n'est attribué au correctif.

## 1. Correctif du gestionnaire de confirmation

### 1.1 Diagnostic sur `88ef056`

Observation 3 du rapport operational readiness (§6), arbitrée par ce GO. Le gestionnaire `confirmDecision` de la revue
staging revérifiait le contexte, la session et le registre, mais pas le motif ni une décision déjà en cours :

1. **Motif obligatoire** : il était calculé sur l'unité capturée à l'ouverture du dialogue, et seul le bouton le
   contrôlait.
   - Une unité relue avec un motif désormais obligatoire passait la garde de fraîcheur, car celle-ci ne compare ni la
     validation, ni les agrégats, ni les codes de revue.
   - Elle était alors promue sans motif.
2. **Motif vide** : un appel direct promouvait une unité à motif obligatoire avec un motif vide.
   - Le supersede transmettait le motif brut, espaces compris, et lisait d'abord l'unité canonical active.
3. **Motif périmé** : un gestionnaire capturé avant une modification du motif décidait avec l'ancien texte.
4. **Concurrence** : `isPending` de TanStack n'est connu qu'au rendu suivant. Le notifieur de TanStack 5.59.16 diffère
   en outre la notification par `setTimeout(0)`.
   - Deux appels avant ce rendu envoyaient deux décisions.
   - Un gestionnaire capturé, ou une décision ouverte sur une autre unité pendant l'envoi, en ajoutait d'autres.

### 1.2 Modifications

| Fichier | Changement |
|---|---|
| `src/features/daily-v2/dailyV2Types.ts` | Aide `isDailyV2DecisionReasonRequired(kind, unit)` et message `DAILY_V2_DECISION_REASON_REQUIRED_MESSAGE` |
| `src/pages/DailyStatementV2.tsx` | Motif relu au dernier rendu validé et revérifié selon l'unité capturée ou relue ; verrou synchrone de décision ; fermeture synchrone du dialogue décidé ; relecture de la revue après un échec ; codes de revue relus affichés |
| `src/pages/DailyStatementV2.synthetic.test.tsx` | Harnais aligné sur TanStack 5.59.16, portée de session réelle exécutée ; 12 tests ajoutés |
| `src/features/daily-v2/dailyV2ApplicationContract.synthetic.test.ts` | Contrat de l'aide et du gestionnaire |

Inchangés : arbitrage serveur, D1, statuts, règles financières, parseur et version (`structured-csv-0b`), runtime
(`daily-v2-browser-0q`), gardes de contexte, de session et de registre. Aucune migration, aucune dépendance, aucun
changement d'Auth ou de RLS.

### 1.3 Comportement livré

- **Ordre des contrôles** :
  1. dialogue courant ;
  2. décision déjà en vol ;
  3. échec de relecture de la revue ;
  4. fraîcheur de l'unité ;
  5. registre ;
  6. compte identifiable ;
  7. motif ;
  8. pose du verrou, puis envoi.
- **Motif** :
  - le texte vient du dernier rendu validé (`reasonRef`, synchronisé au commit), sans espaces de bord ;
  - il est exigé, comme pour le bouton, si l'unité capturée à l'ouverture OU la même unité relue l'exige.
    Supersede : toujours. Promotion : validation `needs_review`, agrégats indisponibles ou au moins un code de revue ;
  - un refus est une suspension : le dialogue et le motif restent ouverts, sans aucun appel réseau ;
  - le motif de supersede est désormais transmis sans espaces de bord : c'est le seul changement des données envoyées.
- **Verrou** :
  - `decisionInFlightRef` est posé de façon synchrone juste avant `mutate` ;
  - il est levé par `onSettled` du hook, appelé après `onSuccess` ou `onError`, et par le rappel `onSettled` de l'appel.
    Ce rappel de l'observateur n'est pas filtré par la portée de session ;
  - un échec synchrone de lancement le lève aussi ;
  - toute confirmation pendant l'envoi est refusée avec un message, y compris par un gestionnaire capturé ou depuis un
    autre dialogue ;
  - `closeDecision` retire le dialogue de la référence sans attendre le commit : un gestionnaire appelé entre la fin
    de la décision et le rendu suivant ne retrouve plus le dialogue décidé.
- **Reprise** :
  - après un échec, le dialogue reste ouvert et la revue est relue ;
  - la suspension « relecture en cours » est posée dans la référence sans attendre le rendu : même un gestionnaire
    capturé attend la relecture ;
  - la nouvelle tentative passe ensuite par le contrôle de fraîcheur de l'unité : un échec ambigu (réponse perdue après
    enregistrement serveur) mène à « Décision périmée » ;
  - un résultat rejeté par la portée de session (rappels du hook filtrés, issue inconnue) déclenche la même relecture.
- **Affichage** :
  - le champ « Raison obligatoire » apparaît si l'unité capturée OU la même unité relue l'exige ;
  - les codes de revue affichés réunissent ceux des deux lectures ;
  - un motif saisi reste affiché (« Raison saisie (sera transmise) ») si une relecture lève l'obligation.

### 1.4 Tests

Les reproductions ont été écrites et exécutées sur la base `88ef056` avant le correctif : **6 échecs sur 7 nouveaux
tests**. Le septième, reprise après échec, passe déjà sur la base : c'est une garde de non-régression du verrou.

| Test ajouté | Base `88ef056` | Après correctif |
|---|---|---|
| Deux confirmations avant rendu : une seule promotion | FAIL (2 RPC) | PASS |
| Deux confirmations avant rendu : un seul supersede | FAIL (2 lectures, 2 RPC) | PASS |
| Décision en cours : gestionnaires capturé, courant et autre unité | FAIL (4 RPC) | PASS |
| Libération après échec et nouvelle tentative (promotion, supersede) | PASS | PASS |
| Motif obligatoire revérifié sur l'unité relue (3 causes) | FAIL (promotion sans motif) | PASS |
| Motif vide ou blanc refusé (promotion, supersede) | FAIL | PASS |
| Gestionnaire capturé avant modification du motif | FAIL (ancien motif transmis) | PASS |

Cinq tests ferment les constats de la contre-revue (§8) :

- F1 : gestionnaire appelé après la décision, avant le rendu ;
- F2 et R2 : portée de session qui filtre les rappels du hook, verrou levé et revue relue, sans seconde RPC ;
- F3 : même règle de motif que le bouton ;
- F4 : codes relus et motif saisi visible ;
- R1 : gestionnaire capturé après un échec, qui attend la relecture.

Le test de reprise vérifie aussi la relecture après échec (F8).

Mutants temporaires de la page, original restauré octet pour octet : **10 sur 10 tués**. Ils retirent tour à tour :

- la fermeture synchrone ;
- les rappels de l'appel ;
- l'union de la règle du motif ;
- les codes relus ;
- le motif visible ;
- la relecture après échec ;
- le verrou ;
- le refus du motif vide ;
- la suspension immédiate après échec ;
- la relecture après un résultat rejeté.

Harnais :

- `isPending` reste une valeur de rendu, figée dans les gestionnaires jusqu'au rendu suivant ;
- deux `mutate` lancent deux exécutions ;
- `onSuccess` puis `onSettled`, ou `onError` puis `onSettled`, sont attendus **avant** la fin de l'état « pending »,
  comme `Mutation.execute` de 5.59.16 ;
- les rappels passés à `mutate` sont ceux de l'observateur, appelés à la fin de l'état « pending », page montée ;
- la portée de session réelle (`dailyV2SessionScope.ts`) et la durée de vie réelle sont exécutées. Seuls son contexte
  React et la mutation TanStack sont fournis par le harnais ;
- aucun état n'est rendu instantané ;
- les 25 tests existants passent avec ce harnais.

### 1.5 Vérifications

| Commande | Résultat |
|---|---|
| `npx tsx --test src/pages/DailyStatementV2.synthetic.test.tsx src/features/daily-v2/dailyV2StagingAccountFilter.synthetic.test.ts` (ligne C3 de la CI) | 41/41 |
| `npm run test:daily-v2-application` (contrat inclus) | 117/117 |
| `npm run test:daily-v2-reporting` | 70/70 |
| Tableau de bord, session, décisions opérationnelles (TS) | 34/34, 11/11, 49/49 |
| `test:structured-csv-all`, `-e2b`, `test:structured-excel` | 135/135, 49/49, 21/21 |
| `test:collections-core`, `auth-signin`, `bdk-pdf`, `upload-guard` | 27/27, 3/3, 27/27, 14/14 |
| `test:financial-atomic`, `financial-write-lockdown`, `import-preflight`, `multi-bank-reports`, `treasury-balances` | 25/25, 2/2, 56/56, 49/49, 28/28 |
| `npm run lint` (ratchet CI : erreurs ≤ 180, total ≤ 191) | 178 erreurs, 11 avertissements, identique à la base ; aucun diagnostic dans les fichiers du pack |
| `npx tsc -p tsconfig.app.json --noEmit` (BASELINES §3) | 16 erreurs, identiques à la base ; 0 nouvelle |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `npm run build` | PASS ; `supabase/functions/mcp/index.ts` inchangé |
| `git diff --check` | PASS |

Les rejeux PostgreSQL 17 de la CI ne sont pas exécutés localement : ils ne dépendent d'aucun fichier modifié.

### 1.6 Contre-revue indépendante

Voir §8.

### 1.7 Hors périmètre identifié (non appliqué)

1. Les dialogues « Approbation groupée du fichier » et « Versions et décisions » ne gardent un envoi en cours que par
   `isPending`, donc au rendu suivant.
   - Ces fichiers ne sont pas autorisés par ce GO.
   - Le serveur reste juge : le plan attendu de l'approbation groupée est revérifié par la RPC.
   - La procédure demande un seul clic.
   - Correctif possible : le même verrou synchrone, sous GO distinct.
2. `src/services/bankIdentity.ts` ne reconnaît pas `ORAB` (suivi existant).
3. Une promotion qui réussit ferme le dialogue ouvert à ce moment, même s'il porte sur une autre unité. Le motif saisi
   y est perdu, sans décision. Comportement antérieur, sans effet de sécurité (contre-revue F7).
4. Écarts résiduels du harnais (contre-revue F6), non exploités par les tests :
   - le bouchon `invalidateQueries` n'attend pas la relecture ;
   - `mutate` garde les options du rendu capturé, là où TanStack applique les dernières.

## 2. Procédure opérateur

`docs/ops/DAILY_V2_BDK_ORABANK_DAILY_USE_RUNBOOK.md` couvre :

- la connexion ;
- le choix du compte et du fichier ;
- la confirmation de la date d'export ;
- le contrôle des journées proposées ;
- la validation et la consultation canonical/reporting ;
- les doublons, provisoires, arrivées hors ordre et conflits ;
- les erreurs et critères de suspension ;
- la fin de séance et la préparation du compte nominatif.

Comptes :

- le compte A reste le compte de recette staging ;
- le passage au compte nominatif est préparé sans adresse supposée, sans création de compte, sans changement de mot de
  passe et sans transfert d'autorité ;
- les profils manager et auditor restent à qualifier avant toute délégation ; ils ne conditionnent pas ce pilote
  individuel.

## 3. Pilote sur le staging hébergé

Statut : **EN_COURS**. Le détail, par version et par séance, figure dans le rapport privé de la campagne `dur-961120`,
hors dépôt. Aucun fichier bancaire, montant, IBAN ni numéro complet n'est versionné.

- **Version exercée** : `26a40d0` publiée (sources `88ef056`). Le correctif du §1 n'y est pas.
- **Dossier privé préalable aux écritures** : scénario, fichiers et empreintes (23 originaux scellés, lus en place),
  comptes, journées et effets attendus, référence indépendante, contrôles avant/après et compensation.
- **Plafonds autorisés** :
  - 3 nouveaux comptes de recette ;
  - 16 dépôts ;
  - 100 versions canonical nouvelles ;
  - 1 supersede, exclusivement synthétique ;
  - désactivation finale des comptes créés.
- **Séances** : 30 minutes au plus, verrous refermés à chaque fin. `backfill` et Trésorerie restent fermés.
- **Interdits** : aucun compte des campagnes closes, aucune journée ORA protégée (08/07, 29/09).
- **État hérité** (preflight en lecture du 10/11, 11:34 UTC) :
  - chaque compte du registre porte sa propre empreinte opaque ; les journées sont rattachées à cette empreinte ;
  - les journées retenues par les campagnes closes (`rd1-dceebe`, `opr-dcf057`) ne sont donc ni lues ni modifiées par
    les nouveaux comptes du pilote ;
  - les livraisons restées `staged` sur les comptes inactifs de `opr-dcf057` ne sont pas touchées ;
  - verrous fermés, module Trésorerie fermé, aucune activité concurrente.
- **Trois séances sur des journées ouvrées de réception réelle sont requises.** Un historique déposé en une fois ne
  les remplace pas. Le journal des séances est tenu dans le rapport privé.

Résultats par séance : voir §3.1, complété à chaque séance.

### 3.1 Journal des séances

| Séance | Date | Version | Résultat |
|---|---|---|---|
| 1 | à exécuter | `26a40d0` | — |
| 2 | journée ouvrée suivante, nouveaux fichiers | `26a40d0` | — |
| 3 | journée ouvrée suivante, nouveaux fichiers | `26a40d0` | — |

## 4. Contrôle ciblé du correctif après sa future publication (préparation)

À exécuter seulement après les GO de merge et de déploiement correspondants, sur le site staging publié, avec la
provenance du nouveau build vérifiée. Unités synthétiques uniquement.

1. Double clic sur « Confirmer » (promotion, puis supersede) : un seul appel RPC observé, et un message « Une décision
   est déjà en cours d'envoi ».
2. Unité relue avec un code de revue après l'ouverture du dialogue : refus sans appel, puis champ du motif affiché.
3. Motif vide ou blanc : refus sans appel, y compris sans lecture de l'unité canonical active pour le supersede.
4. Échec simulé (verrou serveur fermé pendant le dialogue) : message d'échec, dialogue conservé, puis succès d'une
   nouvelle tentative après réouverture du verrou.
5. Non-régression : registre en échec ou en relecture, décision périmée, filtre de compte.

## 5. Dossier de mise en service (production)

Aucun accès production n'a eu lieu, même en lecture. Tout état production ci-dessous provient des rapports versionnés
ou des clôtures antérieures. Il reste **NON VÉRIFIÉ** tant qu'un GO de lecture production ne l'a pas confirmé.

### 5.1 Acquis (staging et local)

- D1 (provisoire tardive identique) : installé au staging et recetté sur fichiers réels (`rd1-dceebe`,
  PASS_WITH_RESERVES).
- Pack operational readiness (#159) :
  - fusionné (`88ef056`) ;
  - recetté au staging (`opr-dcf057`) ;
  - frontend publié sur `cash-sync-wiz` et smoke authentifié (`lfs-98c2a0`).
- Correctif du gestionnaire de confirmation : prêt pour revue, non publié.

### 5.2 Critères encore manquants

1. Pilote : trois séances sur des journées ouvrées réelles, avec concordance à la référence indépendante (§3).
2. Correctif : verdict CTO, merge, publication staging et contrôle ciblé du §4.
3. Compte nominatif de l'utilisateur, en staging puis en production (§5.3).
4. État production confirmé par une lecture autorisée (§5.5).
5. Réserves 1 à 4 maintenues (§7), avec arbitrage CTO de leur portée pour la production.

### 5.3 Compte nominatif à établir

Adresse fournie par l'utilisateur lui-même. Sous GO dédiés et distincts :

1. création ou invitation du compte ;
2. attribution du seul rôle nécessaire, en ligne auditée ;
3. contrôle de connexion et d'identité côté application et côté serveur ;
4. retrait de l'usage du compte de recette.

Rien de cela n'est fait par ce pack. Le blocage Auth production déjà constaté (Site URL et SMTP intégré, invitations
du 31/10 BLOCKED) est à lever d'abord : **NON VÉRIFIÉ** depuis.

### 5.4 Périmètre et politique d'exploitation

- **Périmètre** :
  - BDK et ORABANK ;
  - CSV `structured_bank_statement_csv`, parseur `structured-csv-0b`, runtime `daily-v2-browser-0q` ;
  - noms `BDK`, `BANQUE DE DAKAR`, `ORA`, `ORAB`, `ORABANK` ;
  - mode `daily` (45 jours au plus) ;
  - exclus : Excel, NSIA, backfill, Trésorerie.
- **Exploitation** : une séance par jour ouvré, opérateur unique, procédure du §2. Verrou maître et scope `daily`
  ouverts pour la séance, puis refermés. Scope `admin` réservé au registre.
- **Surveillance** :
  - après chaque séance : statuts par journée, une seule version active par journée, concordance avec le relevé ;
  - chaque semaine : journal d'audit et événements du verrou.
- **Suspension** : critères du §8 de la procédure. Toute suspension laisse les verrous fermés jusqu'à décision CTO.

### 5.5 Prérequis production à vérifier (NON VÉRIFIÉ)

Dernier état documenté au registre des statuts (08/09) :

- ledger avec `20260829120000` et `20260901000000` ;
- Daily v2 : maître et scopes à `false` ;
- frontend publié depuis le projet Lovable de production.

Migrations du dépôt dont la présence en production n'est pas établie :

- `20261102090000_treasury_v1_lot1_bank_balances` ;
- `20261103120000_daily_v2_operational_decisions` (approbation groupée, décisions) ;
- `20261103130000_treasury_v1_lot1_operational_fix` ;
- `20261106120000_treasury_v1_lot1_stale_refusal_sqlstate` ;
- `20261108120000_daily_v2_d1_late_provisional_same_version` (D1).

Les clôtures antérieures indiquent leur application au staging seulement. Le frontend de production publié le 30/10
précède #156 à #159 : **NON VÉRIFIÉ**.

### 5.6 Actions à soumettre sous GO production dédiés

Une action par GO. Chacune avec préflight en lecture, contrôle avant/après et retour arrière prêt :

1. `GO_PRODUCTION_DAILY_V2_DAILY_USE_READ_ONLY_PREFLIGHT` :
   - ledger, signatures de fonctions (dont D1), droits, politiques ;
   - verrous Daily v2 ;
   - frontend servi, avec sa provenance ;
   - Auth (Site URL, URL de redirection).
2. `GO_PRODUCTION_DAILY_V2_DAILY_USE_MIGRATIONS` : migrations manquantes, dans l'ordre du dépôt, une soumission par
   migration.
   - Retour arrière : restauration ponctuelle (PITR) préparée et testée sur le staging. Sinon, retour applicatif par
     fermeture des verrous, les données restant conservées.
3. `GO_PRODUCTION_DAILY_V2_DAILY_USE_FRONTEND_PUBLISH` : publication du commit fusionné comprenant le correctif, après
   vérification d'empreinte du bundle et de sa cible unique.
   - Retour arrière : republication de la version précédente identifiée par sa provenance.
4. `GO_PRODUCTION_DAILY_V2_DAILY_USE_NOMINATIVE_ACCOUNT` (§5.3).
   - Retour arrière : retrait du rôle, puis désactivation du compte, sans suppression d'audit.
5. `GO_PRODUCTION_DAILY_V2_DAILY_USE_FIRST_SESSION` : ouverture bornée du maître et du scope `daily`, puis première
   séance selon la procédure, puis fermeture.
   - Retour arrière : fermeture immédiate des verrous ; données et audits conservés.

## 6. Trésorerie : matrice de qualification des formats (préparation)

Aucun statut n'est modifié. La disponibilité des soldes exige son GO dédié.

| Banque | Format / version | Statut au registre Trésorerie | Preuves disponibles | Manque |
|---|---|---|---|---|
| BDK | CSV `structured-csv-0b` | non qualifié (`NOT_COVERED`, `FORMAT_NOT_QUALIFIED`) | Revue pilote du 06/11 : prêt sous conditions ; `rd1-dceebe` : 21/21 journées concordantes avec le mensuel, provisoires puis clôturées ; `opr-dcf057` | Qualification sous GO dédié ; série quotidienne réelle du pilote ; contrôle d'absence de faux solde |
| ORABANK (`ORA`, `ORAB`, `ORABANK`) | CSV `structured-csv-0b` | non qualifié | Revue pilote du 06/11 : prêt sous conditions ; `rd1-dceebe` : 12/12, retraits D1 justifiés ; `ORAB` 21/10 non déposé en campagne | Idem, plus un dépôt réel `ORAB` (prévu au pilote) |
| ATB, BICIS | Excel | restreints (revue pilote du 06/11) | qualification locale | hors périmètre |
| BRIDGE, BIS, NSIA | — | pas prêts | — | hors périmètre |

## 7. Réserves et limites

Réserves maintenues intégralement :

1. W9/parcours complet, avec les acquis M2 et Auth dans leur portée démontrée.
2. États hérités.
3. Convergence bornée.
4. Discipline de version du parseur.

Restent aussi maintenus :

- la garde après révocation ;
- CRLF/m14 ;
- O2 ;
- la promotion non testée d'une livraison identique restée `staged`, exercée par le pilote (§3) ;
- ORAB dans `bankIdentity.ts`.

Limites :

- les gardes du §1 sont des gardes d'interface : le serveur reste seul juge ;
- les interactions sont prouvées par un harnais Node fidèle aux règles de TanStack, pas dans un navigateur réel ;
- le pilote exerce l'ancienne version publiée.

## 8. Contre-revue indépendante

Revue par un agent distinct, sur le diff non commité, ciblée sur la concurrence. Elle a lu TanStack 5.59.16
(`mutation.js`, `mutationObserver.js`) et la portée de session, et écrit des sondes dans une copie du harnais.

Premier verdict : **PASS_WITH_RESERVES**, aucun P1. Points vérifiés sans constat :

- aucun double envoi par un vrai utilisateur ;
- `reasonRef` correspond à l'affichage (événements discrets commités) ;
- motif vide refusé avant toute lecture ;
- gardes existantes inchangées.

| Constat | Gravité | Traitement |
|---|---|---|
| F1 — envoi possible entre la levée du verrou et le commit de `closeDecision` (gestionnaire capturé) | P2 | Corrigé : fermeture synchrone de la référence ; test F1 |
| F2 — verrou bloqué si la portée de session filtre `onSettled` du hook (page montée) | P3 | Corrigé : rappel `onSettled` de l'appel ; harnais avec portée réelle ; test F2 |
| F3 — règle du motif différente entre bouton et gestionnaire | P3 | Corrigé : union dans le gestionnaire ; test F3 |
| F4 — codes affichés de l'unité capturée ; motif saisi masqué mais transmis | P3 | Corrigé ; test F4 |
| F5 — comparaisons d'indices vacantes dans le contrat | P3 | Corrigé : indices vérifiés `>= 0` |
| F6 — écarts résiduels du harnais | P3 | Partiellement corrigé (portée réelle, rappels d'appel) ; reste au §1.7 |
| F7 — `onSuccess` ferme un autre dialogue ouvert | P3 | Non modifié : antérieur, §1.7 |
| F8 — reprise immédiate après un échec ambigu | P3 | Corrigé : relecture de la revue dans `onError` |
| F9 — en-tête de tests inexact | P3 | Corrigé |

Vérification des corrections par le même relecteur (sondes relancées, mutants relus) :

- **F1 à F5, F8 et F9 : fermés.** Aucune régression P1 ou P2.
- La modélisation des rappels d'appel et l'exécution de la portée réelle sont jugées fidèles à 5.59.16, à un écart
  prudent près : si le `onError` du hook lève, TanStack appelle quand même les rappels d'appel. Ce cas n'est pas
  exploité.
- Deux P3 résiduels, corrigés ensuite :

| Constat | Gravité | Traitement |
|---|---|---|
| R1 — après un échec, un gestionnaire capturé relançait avant que la vue commitée ne passe en relecture | P3 | Corrigé : suspension posée dans la référence de la vue ; test R1 |
| R2 — après un résultat rejeté par la portée, le test F2 validait une seconde RPC sur une vue non relue | P3 | Corrigé : relecture de la revue dans le rappel de l'appel ; test F2/R2 sans seconde RPC |

Verdict du relecteur avant R1 et R2 : **PASS_WITH_RESERVES**. Aucune réserve de code ouverte de son fait après R1 et
R2 ; seules restent F6 et F7, documentées au §1.7.
