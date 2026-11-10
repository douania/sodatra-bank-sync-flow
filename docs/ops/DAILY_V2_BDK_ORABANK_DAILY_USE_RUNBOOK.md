# Procédure quotidienne Daily v2 — BDK et ORABANK (opérateur unique)

Pack : `DAILY-V2-BDK-ORABANK-DAILY-USE-READINESS`. Document opérateur, sans effet sur l'application.

## 0. Portée

- **Qui** : un opérateur unique, qui dépose et valide lui-même. Pendant le pilote, il utilise le compte de recette
  staging « A ». Le passage à son compte nominatif est préparé au §9, mais n'est pas fait.
- **Où** :
  - pilote : le site staging hébergé `https://cash-sync-wiz.lovable.app`, adossé au staging Supabase
    `gbbsqcscryygqlmqncyv`, dans la version publiée et vérifiée `26a40d0` (sources `88ef056`) ;
  - production : non ouverte. Son ouverture exige des GO production dédiés (rapport du pack, §7).
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
   - si la date d'export est le dernier jour du fichier, ce jour est demandé **provisoire**. Il pourra être incomplet ;
     il sera remplacé par le fichier suivant.
4. Si l'écran affiche **« Date incohérente : dépôt bloqué »** (date antérieure au contenu, ou postérieure à la date lue
   dans le nom), corriger la date ou s'arrêter. Ne jamais contourner ce blocage.
5. Cocher la case de confirmation qui reprend la date, le nom du fichier et le compte. Toute nouvelle préparation la
   décoche.

## 5. Dépôt et contrôle des journées proposées

1. Cliquer **une seule fois** sur **Déposer via RPC**, puis attendre le message de fin.
2. La carte « Résultat du dépôt » donne la tentative et le statut de chaque journée :

| Statut | Signification | Action |
|---|---|---|
| `staged` | Journée complète en attente de validation | Valider (§6) après contrôle |
| `provisional` | Jour d'export, possiblement incomplet | Aucune ; jamais promouvable |
| `duplicate` | Identique à la journée déjà active | Aucune ; rien n'est compté deux fois |
| `conflict` | Contenu différent de la journée active | S'arrêter et signaler (§7) |
| `needs_review` ou motifs de revue | Contrôle humain nécessaire | Examiner ; motif obligatoire pour valider |

3. Un redépôt identique **avant** validation crée de nouvelles livraisons `staged` ; ce n'est pas une erreur. Valider
   une seule livraison par journée : la seconde sera classée `duplicate` par le serveur (§7).

## 6. Validation et consultation

1. Onglet **Staging** : filtrer sur le compte, puis sur le statut `staged`.
2. Pour une journée isolée : **Promouvoir**, vérifier l'encadré « Unité concernée » (compte, journée, tentative), puis
   **Confirmer** :
   - **un seul clic**, puis attendre le message ; un second clic pendant l'envoi n'envoie rien de plus ;
   - si un motif est demandé, saisir un motif clair et non vide ;
   - si le dialogue affiche « Décision suspendue » (relecture en cours ou en échec), attendre la relecture ou cliquer
     sur « Relire la revue et le registre », puis confirmer de nouveau ;
   - « Décision périmée » ferme le dialogue : rouvrir la journée depuis la liste à jour.
3. Pour toutes les journées d'un fichier : **Versions**, puis **Approuver le fichier en groupe**.
   - Vérifier le plan affiché par le serveur (journées admissibles et motifs d'exclusion).
   - Saisir un motif, puis confirmer **une seule fois**.
4. Après chaque envoi, s'il réussit, le dialogue se ferme et la liste est relue. S'il échoue, le dialogue reste ouvert
   et une nouvelle tentative explicite est possible, après lecture du message.
5. Onglets **Canonical** et **Reporting** : vérifier que les journées validées apparaissent, une seule version active
   par journée. Comparer les effectifs et totaux au relevé bancaire.

## 7. Cas particuliers

- **Doublon** (`duplicate`) : la journée est déjà active à l'identique. Rien à faire ; le serveur l'a écartée sans
  nouvelle version ni double comptage.
- **Provisoire** (`provisional`) :
  - ne pas tenter de la valider ;
  - le fichier du lendemain apporte la journée complète ;
  - une provisoire tardive identique à la version active est retirée automatiquement par le serveur (D1).
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
- statut inattendu (`conflict`, `promotion_failed`, `rejected`) ou nombre de journées différent du relevé ;
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
