# 0Z1B Core — conception de l’activation du pilote staging

Statut : `DESIGN_ONLY_CLOSURE_CORRECTED_PENDING_COUNTER_REVIEW`

Autorisation : `GO_0Z1B_CORE_APPLICATION_STAGING_PILOT_ENABLEMENT_DESIGN_ONLY_APPROVED`

Correction résiduelle autorisée :
`GO_0Z1B_CORE_APPLICATION_STAGING_PILOT_ENABLEMENT_DESIGN_FINAL_RESIDUAL_CORRECTIONS_ONLY_APPROVED`

Correction de fermeture autorisée :
`GO_0Z1B_CORE_APPLICATION_STAGING_PILOT_ENABLEMENT_DESIGN_CLOSURE_CORRECTIONS_ONLY_APPROVED`

Ce document ne constitue ni une autorisation d’implémentation, ni une
autorisation de mutation staging, ni une autorisation de production.

## 1. Décision

Le pilote Collections Core sera exécuté depuis un **frontend local éphémère**
pointant exclusivement vers le projet staging Supabase
`gbbsqcscryygqlmqncyv`.

Il ne faut pas :

- retargeter le `.env` versionné, qui reste le canal du preview Lovable de
  production ;
- publier une seconde configuration Lovable pour ce pilote ;
- utiliser le lien CLI local actuel, qui pointe vers la production ;
- rendre la route Core disponible en production ;
- utiliser des données bancaires, clients, chèques, effets ou factures réels.

Cette interdiction vise les **données métier** du scénario. Les identités Auth
de G, A et B restent nominatives afin de produire une piste d’audit attribuable ;
elles ne sont jamais injectées dans les champs métier synthétiques.

Cette solution est volontairement petite : une garde de cible étendue au seul
staging autorisé, un marquage visuel du pilote, des tests de refus, puis un
rejeu contrôlé avec un grantor et deux acteurs métier autorisés.

## 2. Situation de départ

- `origin/main` : `3e4ffb395f59a7e03be965e3be845072292f18ee` ;
- migration staging appliquée et contre-revue :
  `20260805000000_collection_remittances_core_atomic_entry` ;
- verdict indépendant :
  `PASS_STAGING_POST_APPLY_INDEPENDENT_COUNTER_REVIEW` ;
- 11 tables Core présentes et vides au moment de la contre-revue ;
- 16 commandes Core exposées à `authenticated`, jamais à `anon`,
  `PUBLIC` ou `service_role` ;
- garde frontend actuelle : localhost uniquement avec
  `VITE_COLLECTIONS_CORE_LOCAL_ENABLED=true` ;
- sécurité réelle : Auth, capacités métier, RLS, ACL des RPC et invariants
  serveur. La garde frontend reste une barrière contre l’erreur de cible, pas
  une autorisation de sécurité.

## 3. Architecture minimale de la garde

### 3.1 Entrées publiques

La future garde recevra quatre valeurs :

- `localEnabled` : valeur de `VITE_COLLECTIONS_CORE_LOCAL_ENABLED` ;
- `stagingPilotEnabled` : valeur de
  `VITE_COLLECTIONS_CORE_STAGING_PILOT_ENABLED` ;
- `supabaseUrl` : valeur de `VITE_SUPABASE_URL` ;
- `projectId` : valeur de `VITE_SUPABASE_PROJECT_ID`.

Le manifeste éphémère du pilote ajoute :

- `campaignId` ;
- `grantorUserId` ;
- `operatorUserId` ;
- `controllerUserId` ;
- `datasetBase64` ;
- `datasetSha256`.

Ces six valeurs proviennent respectivement de
`VITE_COLLECTIONS_CORE_STAGING_PILOT_CAMPAIGN_ID`,
`VITE_COLLECTIONS_CORE_STAGING_PILOT_GRANTOR_ID`,
`VITE_COLLECTIONS_CORE_STAGING_PILOT_OPERATOR_ID` et
`VITE_COLLECTIONS_CORE_STAGING_PILOT_CONTROLLER_ID`, puis de
`VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_BASE64` et
`VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_SHA256`. Elles sont obligatoires
en staging et absentes du `.env` versionné. Les trois UUID G/A/B doivent être
valides et distincts deux à deux. `campaignId` respecte la forme exacte
`PILOT-0Z1B-YYYYMMDD-G<UUID G sans tirets>-N<32 caractères hexadécimaux>`.
La partie `G` doit correspondre exactement à `grantorUserId` normalisé.

`datasetBase64` est l’encodage Base64 exact des octets UTF-8 d’un objet JSON à
schéma fermé, sans propriété supplémentaire. Après décodage strict, les octets
bruts sont hachés **avant parsing** et doivent produire exactement
`datasetSha256`, empreinte de 64 caractères hexadécimaux également inscrite
dans le futur GO. Le texte UTF-8 est ensuite parsé ; il contient l’unique
saisie autorisée, le motif de validation et les clés de commande déterministes.
L’ordre des clés, la représentation des nombres et l’échappement Unicode ne
font donc l’objet d’aucune canonicalisation implicite : l’empreinte porte sur
les octets exacts approuvés.

Le Base64 accepté est la forme RFC 4648 standard avec alphabet `A-Z`, `a-z`,
`0-9`, `+`, `/`, padding `=` correct et aucun espace ou saut de ligne. Après
décodage, un réencodage doit reproduire la chaîne d’entrée au caractère près.
Le décodage UTF-8 utilise le mode fatal : toute séquence invalide est refusée.

Les deux drapeaux ne valent vrai que pour la chaîne exacte `true`.

### 3.2 Cibles

Constantes proposées :

- staging autorisé : `gbbsqcscryygqlmqncyv` ;
- production interdite : `leakcdbbawzysfqyqsnr` ;
- local autorisé : `localhost`, `127.0.0.1`, `::1`.

La validation synchrone de cible et de forme produit soit un refus, soit un
candidat local/staging. L’état final consommé par l’interface est :

```text
{ status: "checking" }
{ status: "allowed", environment: "local" }
{ status: "allowed", environment: "staging", pilotManifest: <manifeste validé> }
{ status: "blocked", reason: <message non sensible> }
```

### 3.3 Algorithme fail-closed

1. Rejeter une URL absente ou invalide.
2. Normaliser uniquement les crochets IPv6 englobants.
3. Si l’hôte est local :
   - exiger `localEnabled === "true"` ;
   - refuser si `projectId` prétend être le staging ou la production ;
   - retourner `environment="local"`.
4. Pour une URL distante :
   - parser l’URL puis exiger simultanément `protocol === "https:"`, un nom
     d’utilisateur et un mot de passe vides, un port vide, `pathname === "/"`,
     une query vide et un fragment vide ;
   - refuser explicitement si le hostname ou `projectId` désigne
     `leakcdbbawzysfqyqsnr`, avant de tester tout drapeau ;
   - exiger ensuite l’origine normalisée exacte
     `https://gbbsqcscryygqlmqncyv.supabase.co` ;
   - extraire le project ref depuis cet hôte exact ;
   - exiger un `projectId` non vide et strictement égal au project ref URL ;
   - refuser toute cible inconnue ;
   - pour le seul staging autorisé, exiger
     `stagingPilotEnabled === "true"` ;
   - valider synchroniquement la campagne, les UUID G/A/B distincts, le Base64
     strict, le JSON décodé et son schéma fermé ;
   - refuser si une valeur du manifeste est absente, mal formée ou
     contradictoire ;
   - produire un candidat staging immuable pour la vérification asynchrone.
5. Toute contradiction ou valeur non reconnue est refusée.

La valeur `VITE_COLLECTIONS_CORE_LOCAL_ENABLED=true` ne doit jamais ouvrir le
staging. Inversement, le drapeau staging ne doit jamais ouvrir localhost, une
cible inconnue ou la production.

Les variantes HTTP, port alternatif, credentials dans l’URL, sous-chemin,
query et fragment sont toutes refusées. La garde Daily v2 existante n’est pas
recopiée sur ce point : son contrôle d’hôte seul est insuffisant pour ce pilote.

Le calcul SHA-256 du dataset utilise `crypto.subtle.digest` dans un provider
partagé `CollectionsCorePilotGateProvider`. Pour un candidat staging, son état
initial est `checking`; il devient `allowed` uniquement si l’empreinte des
octets exacts correspond, sinon `blocked`. Pour local, il résout directement
le verdict synchrone existant.

`App.tsx` installe ce provider sous `AuthProvider` et au-dessus de `Layout` et
des routes. `CollectionsCoreRoute` affiche un écran neutre pendant `checking`,
le motif sûr pendant `blocked`, puis la page uniquement pendant `allowed`.
`Layout.tsx` consomme le même état : le lien
Collections est absent pendant `checking` et `blocked`. Une erreur, un
unmount/remount, un changement d’environnement, un manifeste différent ou une
API cryptographique indisponible réinitialise fail-closed. Aucun accès Core ne
part avant `allowed`.

Le provider délègue à un résolveur asynchrone mémorisé par signature de
manifeste dans `collectionsCorePilotAccess.ts`. `assertReady()` et chaque
service staging attendent ce **même résolveur**, puis la garde d’action, avant
leur première requête. Le contexte React n’est donc pas utilisé comme preuve
par la couche service et aucun appel direct au verdict synchrone ne contourne
le SHA-256.

### 3.4 Liaison obligatoire entre session et action

La garde de cible ne suffit pas. Après établissement de la session Auth et
**avant toute lecture ou RPC Core**, une garde d’action commune compare
`session.user.id` au manifeste validé :

| Action du pilote | UUID exclusivement autorisé |
|---|---|
| préparer/fermer le pilote, inventorier ou modifier les capacités | G (`grantorUserId`) |
| lire le référentiel des comptes et créer l’unique saisie | A (`operatorUserId`) |
| lire la remise créée, la valider et lire le registre/les événements | B (`controllerUserId`) |

La route n’est utilisable que par une session G, A ou B. Chaque fonction de
service autorisée reçoit une action typée et réexécute cette vérification ; le
contrôle de la page ne peut pas la remplacer. Toutes les autres fonctions Core,
notamment celles de rapprochement, refusent le staging avant tout accès réseau.

Un utilisateur tiers reste donc refusé par ce frontend même s’il possède une
capacité Core `BASELINE`. Cette liaison est une barrière procédurale du pilote ;
les RPC et RLS restent l’autorité serveur sur les capacités.

## 4. Canal de configuration du pilote

Le pilote utilisera des variables injectées uniquement dans le processus local
ou un `.env.local` temporaire et ignoré par Git :

```text
VITE_SUPABASE_URL=https://gbbsqcscryygqlmqncyv.supabase.co
VITE_SUPABASE_PROJECT_ID=gbbsqcscryygqlmqncyv
VITE_SUPABASE_PUBLISHABLE_KEY=<clé publique staging non journalisée>
VITE_COLLECTIONS_CORE_STAGING_PILOT_ENABLED=true
VITE_COLLECTIONS_CORE_STAGING_PILOT_CAMPAIGN_ID=PILOT-0Z1B-YYYYMMDD-G<UUID-G-32hex>-N<nonce-32hex>
VITE_COLLECTIONS_CORE_STAGING_PILOT_GRANTOR_ID=<UUID G autorisé par le GO>
VITE_COLLECTIONS_CORE_STAGING_PILOT_OPERATOR_ID=<UUID A autorisé par le GO>
VITE_COLLECTIONS_CORE_STAGING_PILOT_CONTROLLER_ID=<UUID B autorisé par le GO>
VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_BASE64=<Base64 exact autorisé par le GO>
VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_SHA256=<SHA-256 des octets UTF-8 autorisé par le GO>
```

Règles :

- ne jamais modifier le `.env` versionné ;
- ne jamais utiliser de JWT legacy, `service_role`, secret backend ou mot de
  passe de base ;
- ne jamais afficher ni committer la clé publishable ;
- vérifier avant démarrage que les **valeurs effectives** de
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, du client Supabase et du
  trafic réseau correspondent au staging exact ; aucune valeur effective ni
  requête réseau ne doit cibler la production. La constante de refus production
  reste volontairement présente dans le code ;
- supprimer le `.env.local` et arrêter le serveur à la fin du pilote ;
- ne pas utiliser la CLI Supabase ni `supabase/.temp/project-ref`.

Le pilote utilise `npm run dev`, jamais un build staging. Le build de
non-régression est exécuté avant la création du `.env.local`, avec la
configuration production canonique. Aucun `dist` contenant la configuration
staging ne doit donc être produit.

Le preview Lovable canonique continue donc à cibler la production et continue
à refuser Collections Core.

## 5. Interface du pilote

Quand `environment="staging"`, la page doit afficher en permanence un bandeau
visible :

> PILOTE STAGING — données synthétiques uniquement — aucun paiement ni écriture
> comptable.

Le bandeau ne remplace aucune sécurité. La navigation et la route restent
filtrées par la garde commune ; chaque lecture et chaque commande continue à
passer par `assertReady()`, la session Auth, les capacités et les RPC.

Un panneau étroit **Administration du pilote** est ajouté uniquement lorsque
`environment="staging"`. Il n’est pas une administration générale : son
manifeste complet est figé par les variables éphémères du §3.1, il ne permet
de saisir ni UUID, capacité ou donnée métier libres, et il ne propose que
`Préparer le pilote` puis `Fermer le pilote`.

Le panneau exige une session G possédant réellement le rôle applicatif `admin`
et appelle la RPC auditée existante avec le JWT de cette session. Il est absent
en local et en production. Le serveur reste autoritaire : le masquage du
panneau ne remplace pas le contrôle `admin` de la RPC.

## 6. Acteurs, rôles et séparation des tâches

Le pilote exige trois comptes staging nominatifs distincts et trois contextes
navigateur isolés G/A/B. A et B sont obligatoirement contrôlés par deux
personnes physiques distinctes. G est confié de préférence à une troisième
personne ; si la même personne assume G et l’une des deux fonctions métier,
ce cumul doit être nommé dans le GO, utiliser deux comptes et deux contextes
séparés, et la session G ne peut effectuer aucune action métier.

| Acteur | Rôle applicatif préexistant exigé | Capacités Core du pilote |
|---|---|---|
| Grantor G | `admin` | `MANAGE_ACCESS` temporaire `PILOT_CREATED`, accordée et révoquée par la RPC existante ; identité explicitement autorisée par le GO |
| Opérateur A | `manager` | `ENTRY` uniquement |
| Contrôleur B | `user` | `VALIDATE_REMITTANCE`, `AUDIT` |

Le rôle `manager` est le moindre rôle existant permettant à A de lire les
comptes actifs dans `daily_statement_account_registry`. Le rôle `user` suffit à
B pour lire les tables Core, tandis que `AUDIT` ouvre le registre et les
événements Core. Aucun rôle `admin` ou `auditor` n’est accordé à A ou B pour le
pilote.

Une même personne utilisant les comptes A et B ne démontre pas la séparation
des tâches et est interdite dans le verdict fonctionnel. Un éventuel rejeu
mono-opérateur est seulement un test technique et porte obligatoirement le
statut `NOT_EVIDENCE_OF_SEGREGATION_OF_DUTIES`.

Les identités Auth nominatives de G/A/B sont nécessaires à l’attribution de la
piste d’audit ; elles ne constituent pas des données métier réelles du jeu de
test. Les RPC doivent continuer à refuser qu’un UUID valide sa propre remise.
Le GO de pilote nomme G, A et B. Le panneau vérifie leurs rôles par la fonction
Security Definer `has_role(uuid, app_role)` déjà exposée à `authenticated` : G
doit avoir `admin`, A doit avoir `manager` sans `admin`/`auditor`, et B doit
avoir `user` sans `admin`/`auditor`/`manager`. Tout rôle plus large ou toute
identité absente arrête le pilote avant attribution.

### 6.1 Bootstrap et révocation bornés

L’état de départ documenté — onze tables Core vides — implique l’absence de
`MANAGE_ACCESS`. La RPC existante autorise néanmoins un acteur ayant le rôle
applicatif `admin` à attribuer une capacité sans posséder préalablement
`MANAGE_ACCESS`. Le pilote utilise ce chemin audité ; aucune migration ou
intervention SQL préalable n’est requise.

Avant la première mutation, G lit ses propres assignments actifs et inactifs,
ce que la RLS autorise avec `user_id=auth.uid()`. Cette **baseline G0** est
figée. En démarrage neuf, le pilote exige qu’aucun `MANAGE_ACCESS` ne soit
actif pour G. Après un rechargement, un unique assignment actif portant le
marqueur exact de la campagne courante est classé `RECOVERY_CURRENT_CAMPAIGN` :
il permet uniquement de reconstruire la campagne puis de la poursuivre ou de
la fermer. Tout autre `MANAGE_ACCESS` actif provoque un STOP et une
requalification, sans révocation automatique d’un droit préexistant.
En reprise, G0 est reconstruit en excluant exclusivement les assignments dont
le motif porte le `campaignId` courant ; aucun autre état historique n’est
réinterprété.

Le registre autoritaire des campagnes est la table existante
`collection_domain_assignments`, interrogée par le panneau via le service déjà
prévu. Chaque campagne conforme commence obligatoirement par une attribution
de `MANAGE_ACCESS` de G à G avec :

- motif exact `<campaignId>:BOOTSTRAP_MANAGE_ACCESS` ;
- clé exacte `<campaignId>:GRANT:G:MANAGE_ACCESS` ;
- `assignment_id` conservé comme marqueur de campagne, même après révocation.

Le `campaignId` embarque l’UUID complet de G sans tirets et un nonce de 128
bits. Le manifeste vérifie que l’UUID embarqué correspond à `grantorUserId`.
Deux G différents ne peuvent donc produire le même identifiant conforme ; pour
un même G, la lecture de son historique détecte toute réutilisation avant le
premier grant. Aucun registre de rapports externe n’est utilisé.

Le canal d’administration est le panneau staging du §5, utilisé par G après
authentification normale. Aucun JWT n’est extrait, simulé ou copié. Aucun SQL
Editor, `service_role` ou accès direct à `auth.users` n’est utilisé.

Le flux exact de `Préparer le pilote` est :

1. vérifier que l’utilisateur courant est G et porte le rôle `admin` ;
2. vérifier par `has_role` la matrice de moindre privilège de A et B ;
3. lire l’historique propre de G : un marqueur inactif de même `campaignId`
   signifie campagne déjà close et interdit sa réutilisation ; un marqueur
   actif exact ouvre le mode reprise ; tout autre `MANAGE_ACCESS` actif ou une
   lecture impossible provoque un STOP ;
4. en démarrage neuf, figer G0 puis attribuer à G `MANAGE_ACCESS` par la RPC
   avec le motif et la clé exacts ci-dessus ; en reprise, réutiliser uniquement
   l’`assignment_id` exact déjà classé `PILOT_CREATED` ;
5. grâce à cette capacité, relire l’historique complet des assignments : en
   démarrage neuf, seul le marqueur G peut déjà porter `campaignId`; en reprise,
   chaque ligne de campagne doit avoir `granted_by=G`, viser uniquement G/A/B
   et une capacité attendue. Toute ligne inattendue provoque la révocation des
   seuls assignments de campagne encore actifs puis un STOP ;
6. inventorier les assignments de A et B et figer leur baseline **avant toute
   mutation concernant A ou B** ;
7. classer chaque capacité attendue de A/B en `BASELINE` ou `TO_CREATE` ;
8. attribuer uniquement les `TO_CREATE` par la RPC, avec une clé de commande
   unique et un motif préfixé par `campaignId` ;
9. relire les assignments et n’ouvrir le parcours métier que si la matrice
   exacte est obtenue.

Si une étape échoue, le panneau passe immédiatement au flux de fermeture pour
les seuls assignments déjà créés par la campagne. Aucune insertion directe
dans `collection_domain_assignments` n’est autorisée.

Le résultat de chaque grant fournit l’`assignment_id`. La liste est
reconstructible après rechargement par `granted_by=G` et le préfixe de motif
`campaignId`, y compris le marqueur G. Le préflight de collision rend cette
sélection non ambiguë.
Seuls ces assignments sont révoqués. Le même GO autorise conditionnellement
leur révocation en fin de pilote ou sur erreur. Chaque révocation utilise la
RPC, une nouvelle clé de commande et un motif explicite.

Le flux `Fermer le pilote` révoque d’abord les capacités de A et B créées par
la campagne, les relit, puis révoque en dernier le `MANAGE_ACCESS` temporaire
de G avec la RPC. G peut encore relire son propre assignment révoqué grâce à
la RLS. Le post-contrôle exige :

- toutes les capacités `PILOT_CREATED` revenues inactives ;
- toutes les capacités `BASELINE` inchangées ;
- aucun assignment actif supplémentaire pour A ou B ;
- G revenu exactement à sa baseline G0, sans `MANAGE_ACCESS` actif ;
- événements grant/revoke et clés d’idempotence présents une seule fois.

Le panneau vérifie les assignments. Les événements et l’idempotence sont
vérifiés ensuite par B ou par une collecte staging read-only indépendante sous
son GO de validation ; G ne reçoit pas `AUDIT` uniquement pour inspecter sa
propre administration.

Une capacité déjà active au départ n’est jamais adoptée comme
`PILOT_CREATED`. Une double révocation doit être refusée sans modifier la
baseline.

## 7. Données de pilote

La campagne reçoit un identifiant unique à forte entropie, par exemple
`PILOT-0Z1B-20260805-G0123456789abcdef0123456789abcdef-Nfedcba9876543210fedcba9876543210`.
Le futur GO fournit
le Base64 exact du JSON synthétique et le SHA-256 de ses octets UTF-8 décodés.
Le préflight vérifie l’encodage, l’empreinte, le parsing et le schéma dans cet
ordre, avant toute lecture métier ou mutation. L’interface affiche ce jeu en
lecture seule : aucun champ libre et aucune sélection alternative ne sont
disponibles en staging.

Le schéma fermé du dataset couvre au minimum tous les champs de
`CollectionEntryInput`, l’UUID exact du compte de dépôt staging, le motif de
validation et les clés de commande déterministes. Le compte de dépôt doit
exister, être actif et avoir la devise attendue ; sinon le pilote s’arrête.
Toutes les valeurs métier doivent être manifestement synthétiques :

- client : préfixe `PILOT-0Z1B-` ;
- références : préfixe `PILOT-` ;
- aucune raison sociale réelle, aucun numéro de compte, aucun numéro de chèque
  réel et aucune facture réelle ;
- montants factices simples ;
- banques de dépôt sélectionnées uniquement depuis le référentiel staging ;
- jeu exact de champs et montants annexé au GO avant saisie.

En mode `environment="staging"`, la couche service construit la commande à
partir de l’objet parsé, sans saisie libre, puis exige une égalité profonde
avec cet objet avant RPC. Elle refuse toute valeur, propriété, montant, date,
compte, motif ou clé de commande différente. Les préfixes synthétiques restent
une validation supplémentaire, mais ne constituent plus la preuve principale.
Le rapport consigne le Base64 et le SHA-256 observés et les compare au GO.

Les lignes créées restent dans le staging comme preuve auditée sous le statut
`RETAINED_PENDING_EXPLICIT_CLEANUP_DECISION`. Aucun nettoyage par `DELETE`
n’est prévu. Le rapport final inventorie les UUID créés, l’ID de campagne, leur
état et la date du verdict. Toute suppression future exige un pack et un GO
distincts.

Le cleanup local ferme les trois contextes navigateur isolés G/A/B, supprime
leurs profils temporaires et leurs sessions Auth, arrête le serveur, supprime
`.env.local`, vérifie l’absence de build staging et libère le port local.

## 8. Scénarios du pilote

### Phase A — seul pilote autorisable par ce design

1. La production et une cible inconnue sont refusées malgré les deux drapeaux.
2. Le staging sans drapeau pilote est refusé.
3. Le staging exact sans manifeste complet ou avec une empreinte dataset
   divergente est refusé.
4. Le staging exact avec cible et manifeste concordants n’ouvre la route qu’à
   G, A ou B.
5. G fige G0, confirme l’absence de collision, obtient temporairement
   `MANAGE_ACCESS`, fige la baseline A/B puis prépare les seules capacités
   `TO_CREATE` de A/B.
6. Un tiers, même doté d’une capacité Core baseline, est refusé par la garde
   d’action.
7. L’opérateur A saisit l’unique remise synthétique du manifeste via la RPC
   atomique ; toute variation est refusée avant RPC.
8. Un rechargement ne duplique pas la saisie.
9. G et B ne peuvent pas saisir ; G et A ne peuvent pas valider.
10. Le contrôleur B valide la remise avec le motif exact du manifeste.
11. Le registre affiche l’attendu sans le présenter comme encaissé ou payé.
12. Les événements et clés d’idempotence sont présents et cohérents.
13. Un appel sans capacité est refusé côté RPC, indépendamment de l’interface.
14. Les capacités temporaires de A/B puis le `MANAGE_ACCESS` temporaire de G
    sont révoqués ; toutes les baselines sont inchangées et G revient à G0.

### Phase B — explicitement hors du pilote actuel

La phase de rapprochement est intégralement
`NOT_RUN_REQUIRES_SEPARATE_DAILY_V2_SAFE_READ_DESIGN`.

L’application actuelle charge jusqu’à 300 lignes canonical actives et ne sait
pas imposer une provenance synthétique ou une allowlist de campagne. De plus,
la RLS Daily v2 exigerait `admin` ou `auditor`, droits trop larges pour A. En
conséquence :

- A ne reçoit pas `PROPOSE_MATCH` ;
- B ne reçoit pas `CONFIRM_MATCH` ;
- aucune ligne canonical n’est lue depuis l’écran Core ;
- aucune proposition ou confirmation de rapprochement n’est exécutée ;
- aucune donnée Daily v2 n’est créée ou réutilisée.

Une conception ultérieure devra fournir une lecture au moindre privilège,
limitée mécaniquement à une allowlist d’UUID synthétiques autorisée par le GO,
et une preuve de provenance contrôlable côté serveur. Cela implique
potentiellement une projection/RPC ou un changement RLS et ne peut pas être
absorbé par le présent correctif de garde.

## 9. Tests exigés pour l’implémentation future

### Tests unitaires de cible

- local autorisé avec son seul drapeau ;
- local refusé sans drapeau ;
- staging autorisé avec URL, project ID et drapeau concordants ;
- staging refusé sans drapeau ou avec `projectId` absent/contradictoire ;
- production refusée avec chacun des drapeaux puis les deux ;
- cible inconnue et `localhost.evil.test` refusés ;
- autres IPv6 refusées ;
- URL non Supabase refusée ;
- staging en HTTP, avec port alternatif, credentials, sous-chemin, query ou
  fragment refusé ;
- origine canonique HTTPS avec simple slash final autorisée ;
- drapeaux autres que la chaîne exacte `true` refusés ;
- états `checking`, `allowed` et `blocked` couverts ;
- pendant `checking` et `blocked`, route, lien de navigation et tout accès Core
  absents ; changement de manifeste et unmount/remount reviennent à `checking` ;
- le résultat tardif d’un ancien calcul SHA ne peut pas autoriser un manifeste
  plus récent ni mettre à jour un provider démonté.

### Tests du manifeste et des données synthétiques

- campagne absente, mal formée ou sans préfixe `PILOT-0Z1B-` refusée ;
- UUID G embarqué dans la campagne différent de `grantorUserId` refusé ;
- UUID G/A/B absents, invalides ou non distincts deux à deux refusés ;
- Base64 absent, non canonique ou invalide, UTF-8/JSON invalide, propriété
  supplémentaire ou SHA-256 des octets bruts divergent refusé ;
- deux JSON sémantiquement équivalents mais encodés en octets différents ont
  des empreintes différentes ; seul le Base64 exact du GO est accepté ;
- collision de `campaignId` dans l’historique propre de G refusée avant le
  premier grant ; collision défensive dans l’historique complet après
  bootstrap provoquant révocation immédiate et STOP ;
- jeu exact préapprouvé accepté et affiché sans champ libre ;
- toute variation de texte, date, compte, montant, motif ou clé de commande
  refusée en staging avant RPC ;
- préfixe synthétique présent mais payload différent du manifeste refusé ;
- les mêmes contraintes de synthèse ne changent pas le rejeu local existant.

### Tests d’habilitation

- G doit correspondre à la session courante et posséder `admin` ;
- le panneau d’administration reste accessible à G même si G ne possède encore
  aucune capacité Core confirmée ; le retour « aucune habilitation » ne doit
  pas le masquer ;
- G0 est lisible sans `MANAGE_ACCESS`; un marqueur actif exact permet la
  reprise, tandis que tout autre droit actif provoque un STOP sans révocation ;
- attribution temporaire de `MANAGE_ACCESS` par G admin, refus si G n’est pas
  admin, relecture de l’`assignment_id`, révocation sur succès et sur échec ;
- A doit avoir `manager`, B doit avoir `user`, sans ajout d’`admin` ou
  d’`auditor` ;
- la baseline A/B est capturée après le bootstrap G mais avant toute mutation
  A/B ; la baseline G0 est capturée avant toute mutation ;
- une capacité `BASELINE` n’est ni recréée ni révoquée ;
- grant normal, capacité déjà active, échec au milieu du bootstrap, révocation,
  double révocation et reprise après rechargement ;
- `MANAGE_ACCESS` temporaire de G est révoqué en dernier et G revient à G0 ;
- un acteur sans capacité est refusé par appel direct du service/RPC ;
- refus croisés : G ne saisit ni ne valide, A ne valide pas, B ne saisit pas ;
- un utilisateur tiers muni d’une capacité baseline ne peut ni ouvrir le
  parcours ni appeler les services du pilote ;
- les trois contextes Auth G/A/B sont isolés et aucun changement de session ne
  conserve l’autorisation de l’acteur précédent.

### Contrat d’absence de phase B

- A n’obtient jamais `PROPOSE_MATCH` et B jamais `CONFIRM_MATCH` ;
- le panneau de rapprochement ne déclenche aucune lecture
  `daily_statement_lines_canonical` pendant le pilote ;
- aucune proposition ou confirmation de match n’est appelée ;
- le statut affiché est
  `NOT_RUN_REQUIRES_SEPARATE_DAILY_V2_SAFE_READ_DESIGN`.

### Contrats statiques

- `App.tsx`, `Layout.tsx`, la route et tous les services utilisent le même état
  partagé ; aucun appel direct au verdict synchrone ne rouvre la route staging ;
- chaque service staging autorisé applique la garde d’action G/A/B avant sa
  première lecture ou RPC Core ; aucune fonction Core générique ne la contourne ;
- le `.env` versionné reste strictement production et ne contient aucun
  drapeau pilote ;
- aucune clé, aucun project ref staging et aucun secret n’est ajouté au bundle
  par une source TypeScript autre que la constante publique de garde ;
- aucune migration, ACL, RLS ou fonction SQL n’est modifiée ;
- la production reste refusée dans le test de non-régression ;
- le cleanup ferme les trois sessions, supprime les profils navigateur et
  `.env.local`, libère le port et confirme l’absence de bundle staging ;
- le contrôle réseau observe zéro requête vers la production ;
- le rapport inventorie chaque mutation autorisée et compare la matrice de
  capacités finale à la baseline.

### Validation standard

- `npm run test:collections-core` ;
- `npm run lint` comparé à `origin/main` ;
- `npx tsc -p tsconfig.app.json --noEmit` comparé à la baseline ;
- `npm run build` ;
- `git diff --check` ;
- vérification que `supabase/functions/mcp/index.ts` n’a pas changé.

## 10. Périmètre proposé de l’implémentation

Liste blanche minimale :

- `src/features/collections-core/collectionsCoreRuntimeTarget.ts` ;
- `src/features/collections-core/collectionsCoreRuntimeTarget.synthetic.test.ts` ;
- `src/features/collections-core/CollectionsCorePilotGate.tsx` et son test,
  pour l’état partagé asynchrone `checking/allowed/blocked` ;
- `src/features/collections-core/collectionsCorePilotAccess.ts` et son test
  synthétique, pour le manifeste exact, le binding session/action, le
  bootstrap et le cleanup des capacités ;
- `src/features/collections-core/collectionsCoreService.ts`, uniquement pour
  les appels read-only d’inventaire, la RPC de grant/revoke, la garde d’action
  et l’égalité stricte avec le dataset synthétique ;
- `src/features/collections-core/collectionsCoreApplicationContract.synthetic.test.ts` ;
- `src/App.tsx`, uniquement pour installer le provider et rendre les trois
  états de `CollectionsCoreRoute` ;
- `src/components/Layout.tsx`, uniquement pour masquer le lien tant que l’état
  n’est pas `allowed` ;
- `src/pages/CollectionsCore.tsx` pour le bandeau, le statut de phase B et le
  panneau borné d’administration du pilote ;
- `src/vite-env.d.ts` pour les variables éphémères de manifeste énumérées au
  §3.1 ;
- un rapport local d’implémentation.

Sont hors périmètre : `.env`, `.env.example`, lockfile, dépendances, migrations,
tables, RPC, Auth/RLS, Daily v2, Lovable, production et données réelles.

## 11. Stop conditions

STOP immédiat si :

- le head n’est plus `origin/main` au démarrage du futur lot ;
- le `.env` versionné doit être modifié ;
- la cible ne peut pas être prouvée par URL et project ID ;
- le trafic atteint `leakcdbbawzysfqyqsnr` ;
- une clé autre que la publishable moderne est nécessaire ;
- moins de deux personnes, trois comptes staging distincts ou trois contextes
  navigateur isolés sont disponibles ;
- G, A ou B ne correspond pas à la matrice de rôles du §6 ;
- G possède déjà un `MANAGE_ACCESS` actif qui n’est pas l’unique marqueur exact
  de reprise de la campagne courante ;
- G admin ne peut pas créer, relire ou révoquer son `MANAGE_ACCESS` temporaire
  par la RPC auditée ;
- la session courante ne correspond pas à l’acteur exact de l’action demandée ;
- le manifeste est incomplet, son Base64 ou SHA-256 diverge du GO, ou une
  valeur libre serait nécessaire ;
- l’absence de collision de `campaignId` ne peut pas être prouvée dans
  l’historique propre de G avant le bootstrap ou dans l’historique complet
  avant la première mutation A/B ;
- une capacité ne peut pas être attribuée ou révoquée par la RPC auditée ;
- la baseline des assignments ne peut pas être inventoriée ou restaurée ;
- une donnée réelle est nécessaire ;
- la page Core tente de lire une ligne Daily v2 ou d’exécuter un rapprochement ;
- une modification DB/RLS/Auth ou une nouvelle migration devient nécessaire ;
- un bundle, profil navigateur ou `.env.local` staging subsiste après cleanup ;
- le build modifie l’artefact MCP.

## 12. Portes suivantes

1. Contre-revue indépendante finale ciblée de cette conception corrigée.
2. GO d’implémentation locale borné à la liste blanche du §10.
3. Contre-revue indépendante du delta et rejeu local.
4. Packaging, PR et merge sous GO distincts.
5. GO de validation staging read-only du head fusionné.
6. GO de pilote staging énumérant exactement : G/A/B, `campaignId`, Base64 et
   SHA-256 du dataset, baseline attendue, attributions `TO_CREATE`, scénarios et
   révocation finale.
7. Verdict CTO sur le pilote.

Aucune de ces portes n’implique un GO production.

## 13. Traçabilité des corrections de contre-revue

| Constat indépendant | Correction de conception |
|---|---|
| P1 — aucune garantie synthétique sur les lignes Daily | Phase B entièrement retirée ; aucune capacité, lecture ou commande de rapprochement |
| P1 — rôles Daily incompatibles avec le moindre privilège | A=`manager`/`ENTRY`, B=`user`/`VALIDATE_REMITTANCE`+`AUDIT`; aucun accès canonical |
| P1 — origine distante insuffisamment stricte | origine HTTPS exacte, sans credentials, port, chemin, query ni fragment |
| P1 — séparation limitée aux UUID | A/B portés par deux personnes distinctes ; trois comptes et trois contextes isolés G/A/B |
| P1 — bootstrap/révocation non opérationalisés | G admin s’auto-attribue temporairement `MANAGE_ACCESS` par la RPC auditée ; marker, grants A/B et cleanup reconstructibles |
| P2 — saisies synthétiques libres | manifeste éphémère fermé, dataset exact en lecture seule et égalité profonde avant RPC |
| P2 — cleanup/rétention incomplets | dev sans build staging, profils éphémères supprimés, inventaire de campagne et rétention explicitée |
| P2 — chaîne production « absente » ambiguë | contrôle des valeurs effectives et du trafic, constante de refus conservée |
| P2 — tests incomplets | matrices cible, manifeste, habilitations, échecs, cleanup, réseau et absence de Phase B ajoutées |
| P1 résiduel — manifeste non lié aux sessions/actions | manifeste complet dans le verdict, route limitée à G/A/B et garde d’action typée avant chaque accès Core |
| P2 résiduel — baseline après auto-grant | baseline G0 avant toute mutation, bootstrap G isolé, puis baseline A/B avant toute mutation A/B |
| P2 résiduel — seulement deux contextes | trois comptes et trois contextes isolés G/A/B, avec deux personnes minimum pour A/B |
| P2 résiduel — préfixe insuffisant | dataset Base64 fermé, empreinte des octets exacts, interface sans saisie libre et égalité profonde avant RPC |
| P2 résiduel — collision de campagne | UUID G incorporé, nonce 128 bits et préflight sur l’historique persistant des assignments |
| P2 résiduel — identités ambiguës | données métier entièrement synthétiques, identités Auth nominatives réservées à l’audit |
| P1 fermeture — garde async hors périmètre | provider à trois états défini ; `App.tsx` et `Layout.tsx` ajoutés explicitement à la liste blanche |
| P1 fermeture — `MANAGE_ACCESS` absent | bootstrap temporaire autorisé par le rôle admin et la RPC existante, révocation finale obligatoire |
| P2 fermeture — JSON « canonique » indéfini | hash des octets UTF-8 exacts décodés du Base64 avant parsing ; aucune canonicalisation |
| P2 fermeture — registre de campagnes sans source | `collection_domain_assignments` de G sert de registre persistant interrogeable via la RLS et le service existant |
