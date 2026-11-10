# Procédure quotidienne Daily v2 — BDK et ORABANK (opérateur unique)

Pack : `DAILY-V2-BDK-ORABANK-DAILY-USE-READINESS`. Document opérateur, sans effet sur l'application.

## 0. Portée

- **Qui** : un opérateur unique, qui dépose et valide lui-même. Pendant le pilote, il utilise le compte de recette
  staging « A ». Le passage à son compte nominatif est préparé au §9, mais n'est pas fait.
- **Où** :
  - pilote : le site staging hébergé `https://cash-sync-wiz.lovable.app`, adossé au staging Supabase
    `gbbsqcscryygqlmqncyv`, dans la version publiée et vérifiée `26a40d0` (sources `88ef056`) ;
  - production : non ouverte. Son ouverture exige des GO production dédiés (rapport du pack, §5).
- **Version et gardes d'interface** :
  - cette procédure vaut pour la version hébergée actuelle `26a40d0`. Celle-ci n'empêche pas un second envoi d'une
    décision pendant qu'une première est en cours : la discipline « un seul clic, puis attendre » est donc la seule
    protection côté interface ; le serveur reste seul juge ;
  - le correctif du gestionnaire de confirmation (draft PR #160) n'est pas publié. Sa garde ne s'appliquera aux
    promotions et supersedes unitaires qu'après son merge, sa publication et son contrôle ciblé, chacun sous GO ;
  - les dialogues « Approbation groupée du fichier » et « Versions et décisions » restent hors de ce correctif.
- **Quoi** :
  - relevés quotidiens CSV structurés BDK et ORABANK, au format `structured_bank_statement_csv`, lus par le parseur
    `structured-csv-0b` et le runtime `daily-v2-browser-0q` ;
  - noms de fichiers reconnus : `BDK`, `BANQUE DE DAKAR`, `ORA`, `ORAB`, `ORABANK`.
  - Hors périmètre : les autres banques et formats (Excel ATB, BICIS, BIS, BRIDGE ; NSIA), le backfill et la
    Trésorerie (soldes).
- **Ce que la procédure ne fait pas** :
  - elle n'atteste aucun solde et ne corrige aucune donnée ;
  - elle ne déclare aucune journée « close » au sens bancaire : le serveur reste seul juge des statuts.

## 1. Avant la séance (administrateur technique)

Ces actions ne relèvent pas de l'opérateur ; elles encadrent chaque séance pendant le pilote.

1. Ouvrir le verrou maître et le scope `daily` pour **30 minutes au plus**, à l'aide des bascules éprouvées.
   - Le scope `admin` ne s'ouvre que pour créer ou désactiver un compte de recette.
   - `backfill` et la Trésorerie restent fermés.
2. Annoncer à l'opérateur l'heure de fermeture prévue.
3. Fermer les verrous en fin de séance, y compris en cas d'échec, puis vérifier leur fermeture.

## 2. Connexion

1. Ouvrir le site dans le navigateur habituel.
   - Si une session valide est ouverte, le bandeau indique le rôle et la cible « staging ».
   - Sinon, l'administrateur émet un lien de connexion à usage unique vers `/auth` : une émission réussie au plus par
     séance. L'opérateur clique lui-même sur le lien.
2. Vérifier, dans le bandeau de la page Daily v2 :
   - la cible : staging, jamais « Pilote production » ;
   - la version publiée attendue ;
   - le verrou serveur « ouvert » : sinon, rien n'est déposable, et c'est normal hors séance.
3. Si une alerte de session ou d'accès apparaît, recharger la page.
   - Si l'alerte persiste, s'arrêter et prévenir l'administrateur (§8).

## 3. Choix du compte et du fichier (onglet « Import »)

1. Choisir la **Banque** (BDK ou ORABANK), puis le **Compte pré-provisionné**.
   - Le compte s'identifie par son alias et son numéro masqué.
   - Si le compte n'existe pas encore, seul l'administrateur le crée (§1).
2. Déposer **un seul fichier**, exactement tel que reçu de la banque. Ne jamais ouvrir le fichier dans un tableur pour
   l'enregistrer de nouveau.
3. Lire la règle affichée sous le fichier :
   - la banque déduite du nom doit être celle choisie ; sinon, la préparation sera refusée ;
   - si le nom porte une date d'export, elle est affichée.

## 4. Confirmation de la date d'export

1. **Après** avoir déposé le fichier, saisir la **Date de référence export** (JJ/MM/AAAA) : le jour où le fichier a été
   extrait de la banque.
   - Le dépôt d'un nouveau fichier vide la date ; c'est voulu.
   - Pour ORABANK, la date est recommandée. Pour BDK, elle est facultative ; sans date, aucune journée n'est demandée
     provisoire.
2. Cliquer sur **Préparer**. La carte « Payload prêt » affiche :
   - la banque, le compte masqué lu dans le fichier, la période, le nombre de journées et de lignes ;
   - les journées demandées provisoires et le nombre de journées non provisoires.
3. Contrôler :
   - le compte masqué du fichier correspond au compte choisi. En cas d'écart, la préparation est refusée : ne pas
     forcer ;
   - la période correspond au fichier attendu ;
   - si la date d'export est le dernier jour du fichier, ce jour est demandé **provisoire**. Il peut être incomplet et
     n'est jamais promouvable tel quel.
     - La journée est traitée par un fichier ultérieur qui la contient, déposé et arbitré normalement par le serveur
       (§7).
     - Ni le fichier du lendemain ni une clôture automatique ne sont garantis.
4. Si l'écran affiche **« Date incohérente : dépôt bloqué »** (date antérieure au contenu, ou postérieure à la date lue
   dans le nom), corriger la date ou s'arrêter. Ne jamais contourner ce blocage.
5. Cocher la case de confirmation qui reprend la date, le nom du fichier et le compte. Toute nouvelle préparation la
   décoche.

## 5. Dépôt et contrôle des journées proposées

1. Cliquer **une seule fois** sur **Déposer via RPC**, puis attendre le message de fin.
   - Si le résultat est ambigu (aucun message, erreur réseau, page rechargée), ouvrir d'abord l'onglet **Staging**,
     filtré sur le compte, pour relire les livraisons avant tout nouveau dépôt.
2. La carte « Résultat du dépôt » donne la tentative et le statut de chaque livraison :

| Statut de livraison | Signification | Action |
|---|---|---|
| `staged` | Livraison en attente de décision. Ce statut ne prouve ni une journée bancaire complète ni sa disponibilité en Trésorerie | Examiner la validation et les motifs de revue, puis valider (§6) ou laisser en attente |
| `provisional` | Journée demandée provisoire (en général le jour d'export), possiblement incomplète | Aucune ; jamais promouvable ; traitée par un fichier ultérieur (§7) |
| `duplicate` | Classée identique à la journée active par l'arbitrage serveur, au dépôt ou lors d'une tentative de promotion | Aucune ; rien n'est compté deux fois |
| `conflict` | Contenu différent de la journée active | S'arrêter et signaler (§7) |
| `needs_review` | Livraison placée en revue par le serveur ; la liste ne propose pas « Promouvoir » pour ce statut | Examiner ; signaler si inattendu |

   Indicateurs à ne pas confondre avec le statut `needs_review` :
   - sur une livraison `staged`, la colonne « Validation » (`needs_review`, agrégats `unavailable`) et la colonne
     « Motifs de revue » signalent des contrôles à examiner ;
   - la promotion reste alors proposée, mais exige un motif ;
   - examiner les motifs avant toute décision. Une livraison peut être laissée volontairement en attente.

3. Un redépôt identique **avant** validation crée de nouvelles livraisons `staged` ; ce n'est pas une erreur.
   - Après la promotion de la première livraison, la seconde livraison identique peut rester `staged` : elle n'est pas
     normalisée automatiquement.
   - Son classement `duplicate` intervient lors d'un nouvel arbitrage serveur, notamment si sa promotion est tentée
     (§7).
   - Valider une seule livraison par journée.

## 6. Validation et consultation

1. Onglet **Staging** : filtrer sur le compte, puis sur le statut `staged`.
2. Pour une journée isolée : **Promouvoir**, vérifier l'encadré « Unité concernée » (compte, journée, tentative), puis
   **Confirmer** :
   - **un seul clic**, puis attendre le message. Ne pas recliquer pendant l'envoi : la version actuelle n'empêche pas
     un second envoi (§0) ;
   - si un motif est demandé, saisir un motif clair et non vide ;
   - si le dialogue affiche « Décision suspendue » (relecture en cours ou en échec), attendre la relecture ou cliquer
     sur « Relire la revue et le registre », puis confirmer de nouveau ;
   - « Décision périmée » ferme le dialogue : rouvrir la journée depuis la liste à jour.
3. Pour toutes les journées d'un fichier : **Versions**, puis **Approuver le fichier en groupe**.
   - Vérifier le plan affiché par le serveur (journées admissibles et motifs d'exclusion).
   - Saisir un motif, puis confirmer **une seule fois** et attendre le résultat. Ce dialogue ne protège pas d'un second
     envoi ; un résultat ambigu se traite comme au point 4.
4. Après chaque envoi, s'il réussit, le dialogue se ferme et la liste est relue.
   - S'il échoue, ou si le résultat est ambigu (aucun message, erreur réseau, page rechargée), ne pas renvoyer
     aussitôt.
   - D'abord relire les statuts : « Relire la revue et le registre », ou onglet **Staging** filtré sur le compte et la
     journée.
   - Si la journée est déjà `promoted` ou `duplicate`, ou si une version est active dans **Canonical**, ne rien
     renvoyer.
   - Sinon, une seule nouvelle tentative explicite, après lecture du message. Un second échec relève du §8.
5. Onglets **Canonical** et **Reporting** : vérifier que les journées validées apparaissent, une seule version active
   par journée. Comparer les effectifs et totaux au relevé bancaire.

## 7. Cas particuliers

- **Doublon** (`duplicate`) : la journée est déjà active à l'identique.
  - Ce classement est fait par le serveur, au dépôt, ou lors d'une tentative de promotion d'une livraison identique
    restée `staged`.
  - Rien à faire : aucune nouvelle version, aucun double comptage.
  - Une livraison identique restée `staged` n'est pas reclassée tant qu'aucun nouvel arbitrage n'a lieu.
- **Provisoire** (`provisional`) :
  - ne pas tenter de la valider ;
  - la journée est traitée par un fichier ultérieur qui la contient. Ce fichier est déposé et arbitré normalement :
    `staged`, `duplicate` ou `conflict` selon ce qui est actif ;
  - aucune complétude ni clôture n'est garantie à J+1 ;
  - une provisoire identique à la version active peut être retirée par le serveur (règle D1), si ses contrôles le
    permettent ;
  - une provisoire différente reste vivante et visible : la noter, et la signaler si elle persiste.
- **Arrivée hors ordre** : déposer normalement. Le serveur classe chaque journée selon ce qui est déjà actif.
- **Conflit** (`conflict`) : une version différente est déjà active.
  - Ne pas faire de « Supersede » en exploitation courante.
  - Noter la journée et le compte, puis prévenir l'administrateur.
  - Un remplacement exige une analyse et une décision motivée ; pendant le pilote, il est réservé aux données
    synthétiques.

## 8. Erreurs et critères de suspension

Arrêter la séance, sans réessayer en boucle, et prévenir l'administrateur avec l'heure, le compte et le message, dans
les cas suivants :

- cible affichée différente du staging attendu, ou mention « Pilote production » ;
- message d'erreur portant un code, échec répété d'une même action, ou session expirée qui revient ;
- compte masqué, banque ou période différents de ceux attendus ;
- statut inattendu (`conflict`, `needs_review`, `promotion_failed`, `rejected`) ou nombre de journées différent du
  relevé ;
- résultat d'une décision resté ambigu après relecture des statuts ;
- deux versions actives pour une même journée, ou totaux différents du relevé ;
- verrou fermé en cours de séance, ou fin du créneau de 30 minutes ;
- fichier modifié, renommé à la main ou d'origine incertaine.

En cas d'erreur, ne supprimer aucune donnée et ne modifier aucun fichier bancaire. La suite est décidée par
l'administrateur sous GO.

## 9. Fin de séance et compte nominatif

Fin de séance :

1. Vérifier qu'aucune décision n'est en cours, puis fermer les dialogues.
2. L'administrateur ferme les verrous et consigne la séance : fichiers, journées, statuts, contrôles.
3. Les fichiers bancaires restent dans leur dossier d'origine. Aucune copie dans un chat, un dépôt Git ou une capture
   partagée.

Compte nominatif (préparation seulement) :

- L'opérateur utilise aujourd'hui le compte de recette A.
- Le passage à son compte personnel exige, sous GO dédiés :
  - la création ou l'invitation du compte, à son adresse réelle fournie par lui ;
  - l'attribution du rôle nécessaire ;
  - un contrôle de connexion ;
  - le retrait de l'usage du compte A.
- Aucune de ces étapes n'est faite par ce pack. Aucune adresse n'est supposée.
- Les profils manager et auditor restent à qualifier avant toute délégation à d'autres personnes.
