# PAYABLES-CHEQUES-PRODUCTION-ADMIN-ACCESS — administration seule en production

**Statut : développé et testé localement, PR en brouillon. Aucun déploiement, aucune
activation : le drapeau de build n'est positionné nulle part, `.env` est inchangé.**

## 1. Lot

| Élément | Valeur |
|---|---|
| GO | `GO_IMPLEMENT_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ACCESS` (2026-10-29) |
| Base | `main` vérifié = `a9702cb5b5dffb62728d43796df2161e3c8bd704` (fusion de la PR #152) |
| Branche | `codex/payables-cheques-production-admin-access`, worktree isolé ; autres checkouts non touchés |
| Périmètre | garde de cible, service, contrôle d'accès, page du module ; tests ; ce document |
| Inchangé | migrations, Auth/RLS, dépendances, contrôles financiers, `.env`, routes et menu (`App.tsx`, `Layout.tsx`), artefact MCP |

## 2. Comportement

### 2.1 Garde de cible (`payablesRuntimeTarget.ts`)

| Cible | Verdict |
|---|---|
| Production, sans drapeau | refus « Le module chèques reste interdit en production. », quels que soient les autres drapeaux ; le drapeau ne vaut que s'il est exactement `true` |
| Production, `VITE_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY=true`, origine exacte `https://leakcdbbawzysfqyqsnr.supabase.co`, project ID exact `leakcdbbawzysfqyqsnr`, aucun drapeau local ou staging | **administration seule** (`environment: 'production'`, `mode: 'admin-only'`) |
| Production avec le drapeau, mais origine, chemin, port, protocole, identifiants ou project ID différents, ou drapeau local ou staging présent | refus « La cible de production du module chèques est contradictoire. » |
| Drapeau de production sur une autre cible (staging, local, inconnue) | refus « Le mode administration seule est réservé au projet de production. » |
| Local, staging | inchangés, module complet (`mode: 'full'`) |

La production n'est jamais ouverte en module complet. « Origine exacte » s'entend après
normalisation par l'analyseur d'URL : `HTTPS://LEAKCDBBAWZYSFQYQSNR.SUPABASE.CO` ou le
port 443 explicite désignent le même hôte et sont acceptés avec le drapeau.

### 2.2 Service (`payablesChequesService.ts`)

Ordre des contrôles avant chaque appel : cible, puis liste blanche, puis session, puis
appel serveur.

Hors module complet, la liste blanche est fermée :

- `payables_my_access_v1` ;
- `payables_read_v1`, seulement pour `persons`, `person_links`, `capability_grants` et
  `parameters`, avec `p_args` vide et aucune autre clé ;
- les cinq fonctions d'administration : `payables_admin_set_capability_v1`,
  `payables_admin_create_person_v1`, `payables_admin_set_person_link_v1`,
  `payables_admin_set_parameter_v1`, `payables_admin_reject_legacy_proposal_v1`.

Tout autre appel, métier ou bancaire, est refusé (`PAYABLES_ADMIN_ONLY_CALL_REFUSED`)
**avant la lecture de la session et avant tout envoi**.

Refus par défaut : seul un verdict explicitement `full`, hors production, ouvre le
module complet. Un verdict sans mode, d'un mode inconnu, ou un verdict de production
déclaré `full` reste sous liste blanche.

### 2.3 Contrôle d'accès (`PayablesChequesGate.tsx`, `payablesAdminModel.ts`)

En administration seule, le module ne s'ouvre qu'à l'administrateur reconnu par le
serveur : `admin_configured` et `is_admin`, renvoyés par `payables_my_access_v1`. Les
capacités sont ignorées : un comptable qui détient la lecture, l'audit ou des droits
opérationnels reste dehors. Le module complet garde sa règle : lecture ou audit.

Le menu et la route utilisent toujours la même garde (code inchangé).

### 2.4 Page (`src/pages/PayablesCheques.tsx`)

En administration seule, la page affiche un titre, un avertissement et le seul panneau
d'administration (`ParametersPanel`). Aucun onglet n'est rendu et aucun autre panneau
n'est monté. Aucune de leurs lectures n'est donc lancée.

### 2.5 Serveur

L'autorisation effective reste vérifiée par le serveur, sans changement :

- chaque fonction d'administration exige l'administrateur désigné ;
- chaque lecture applique ses capacités ;
- les opérations financières restent fermées par l'interrupteur.

La liste blanche réduit la surface d'appel du navigateur ; elle n'autorise rien.

**Limite : l'administration seule n'est pas appliquée par le serveur.** Le mode
restreint ce que l'interface envoie, pas ce que le serveur accepte :

- avec `20261028090000`, l'administrateur détient implicitement `READ`, `AUDIT`,
  `BANK_READ` et les autres capacités opérationnelles ;
- les lectures (`payables_read_v1`, contrôle de `BANK_READ`) ne dépendent pas de
  l'interrupteur des écritures métier ;
- en production, l'administrateur ou un compte auquel il attribue `READ` ou
  `BANK_READ` pourrait donc lire, par un appel direct à l'API, les listes métier, les
  positions et les lignes de suivi bancaire.

Fermer ces lectures côté serveur en production demanderait une migration, hors du
périmètre de ce lot : décision CTO requise avant toute activation (§ 3).

## 3. Prérequis non remplis : rien n'est activable en l'état

1. **Production** : la migration `20261028090000` n'y est pas installée. Sans elle,
   `payables_my_access_v1` ne renvoie ni `admin_configured` ni `is_admin`, et la garde
   reste fermée. Un GO de production distinct est requis.
2. **Administrateur de production** : désignation, établissement de son identité par
   l'opérateur et attribution des habilitations. GO distincts requis.
3. **Build et déploiement** avec le drapeau : GO distinct. Le canal de build Lovable
   cible la production sans ce drapeau ; il continue donc de refuser le module.
4. **Lectures serveur en production** (§ 2.5) : décision CTO à prendre. Soit les
   accepter pour l'administrateur et les comptes qu'il habilite, soit les fermer par
   une migration sous GO distinct.

## 4. Tests

| Fichier | Ce qui est prouvé |
|---|---|
| `payablesProductionAdminAccess.synthetic.test.tsx` (nouveau, 12 tests) | production refusée par défaut (six variantes du drapeau) ; administration seule sur la cible exacte, y compris ses écritures normalisées (majuscules, port 443) ; treize cibles contradictoires refusées (dont nom d'hôte suivi d'un point ou prolongé) ; drapeau refusé hors production ; non-régression local et staging ; **toute la surface du service** appelée en administration seule : seules les dix fonctions de la liste blanche atteignent le réseau, les autres sont refusées sans lecture de session ni envoi ; arguments de lecture contrôlés ; verdicts incomplets ou incohérents sous liste blanche ; module complet inchangé ; décision d'ouverture sur booléens stricts ; page rendue (administration seule sans onglet, module complet avec ses huit onglets, rien si garde fermée) |
| `payablesAdminPanelInteraction.synthetic.test.tsx` (+ 9 tests, rendu client réel) | page de production montée : seul le panneau d'administration, seules ses quatre listes lues, `p_args` vide ; même résultat **liste blanche coupée** (verdict `full` côté service), ce qui prouve que la page seule ne monte aucun autre panneau ; mode de garde inattendu traité en administration seule ; une décision part vers sa seule fonction ; garde fermée : rien monté, aucun appel ; **garde réelle** : administrateur reconnu ouvert, comptable habilité refusé, verdict incohérent traité en administration seule, non-régression locale, cible refusée sans appel |
| `payablesAdminPanel.synthetic.test.tsx` | contrôle de source mis à jour : la production reste refusée sans le drapeau dédié, ne s'ouvre qu'en administration seule, et le drapeau est lu sous son seul nom |
| Doubles existants | verdict `full` désormais explicite dans les doubles des tests du service et du panneau : sans lui, le refus par défaut s'applique |

Preuves de mordant :

- les nouveaux tests échouent sur `a9702cb` ;
- les mutants des fichiers modifiés sont tous tués (§ 5).

## 5. Validations exécutées (local)

| Contrôle | Résultat |
|---|---|
| ESLint comparé élément par élément à `a9702cb` | 178 erreurs / 11 avertissements, **aucun élément nouveau ni disparu** |
| `tsc -p tsconfig.app.json` | 16 erreurs, **liste identique** à `a9702cb` ; projet Node : 0 erreur |
| `npm run build` | succès ; artefact MCP inchangé ; build sans le drapeau |
| `npm run test:payables-cheques` | **88 / 88** (67 existants, 21 nouveaux) |
| Autres suites Node du CI | 20 commandes vertes ; hygiène des journaux 4 / 4 et provenance du build 7 / 7 après le build |
| Nouveaux tests rejoués sur `a9702cb` | **18 échecs**. Les tests qui passent sur la base sont des non-régressions ou des chemins autorisés. |
| Mutants des fichiers modifiés | **23 / 23 tués** : garde de cible (7), liste blanche du service (7), décision d'ouverture (3), garde (2), page (4) ; dépôt restauré à l'identique |
| Rejeu PostgreSQL 17 | non rejoué : aucun fichier SQL modifié ; exécuté par le CI |

## 6. Revue indépendante

Revue par un agent distinct, en lecture seule. Elle a balayé tout le graphe d'appel
atteignable et sondé la garde : 20 variantes d'URL, 3 project ID et 4 jeux de drapeaux.
Verdict : `PASS_WITH_RESERVES`, **aucun P1**.

| Constat | Traitement |
|---|---|
| P2-1 — le montage des seuls panneaux d'administration n'était prouvé qu'avec la liste blanche active ; un mutant ajoutant deux panneaux survivait | **corrigé** : test de page avec liste blanche coupée ; mutant ajouté et tué |
| P2-2 — limite serveur non documentée : lectures de l'administrateur et des comptes habilités indépendantes du mode | **documenté** (§ 2.5) et ajouté aux prérequis d'activation (§ 3) : décision CTO |
| P2-3 — sections de résultats et de revue non remplies, nombre de tests inexact | **corrigé** |
| P3 — condition de page non verrouillée | **corrigé** : mode inattendu traité en administration seule, testé |
| P3 — booléens d'autorité lus par simple véracité | **corrigé** : valeurs strictement booléennes, testé |
| P3 — origine « exacte » au sens normalisé ; cas du point final et des majuscules non testés | **précisé** (§ 2.1) et testé |
| P3 — nom du drapeau non vérifié | **corrigé** : contrôle de source |
| P3 — constats antérieurs (garde liée à l'identité de l'objet utilisateur, clés de cache sans compte) | **réserve** (§ 7), hors périmètre |
| P3 — dossier `dist/` ignoré présent | build local sans le drapeau, ignoré par Git |

Constats sains confirmés :

- seul le service touche Supabase, par la session et `rpc` ;
- la liste blanche est exacte et le refus intervient avant la session ;
- la production ne s'ouvre jamais en module complet ;
- la garde décide sur la seule réponse du serveur ;
- les doubles de test passent uniquement par le chargeur de modules ;
- le périmètre est respecté.

## 7. Risques et réserves

- **Drapeau de build** : c'est un choix de déploiement, pas une frontière de sécurité.
  Un build de production qui le porte n'expose que le panneau d'administration ; le
  serveur reste seul juge de l'autorité.
- **Code des autres panneaux** : il reste présent dans le paquet JavaScript (imports
  statiques). En administration seule, il n'est ni monté ni appelé, et le service
  refuse ses appels. Un découpage du code changerait le build de tous les environnements
  et n'a pas été fait.
- **Session** : pour un appel autorisé, la lecture de session peut rafraîchir le jeton
  auprès de l'authentification ; aucun appel refusé ne lit la session.
- **Constats antérieurs à ce lot**, relevés par la revue, non corrigés ici :
  - la garde se recalcule quand l'objet utilisateur de la session change, par exemple à
    un rafraîchissement du jeton ; la page est alors démontée et une saisie
    d'administration en cours est perdue ;
  - les clés de cache des listes d'administration ne portent pas l'identifiant du
    compte : après un changement de compte dans un autre onglet, les listes du compte
    précédent peuvent apparaître un instant. Le serveur décide toujours.
- **Documentation antérieure** : `docs/STATUS_REGISTRY.md` et `docs/MASTER_CONTEXT.md`
  décrivent encore la PR #152 comme un brouillon et sa migration comme appliquée à
  aucun environnement. Cette mise à jour sort du périmètre de ce lot.
