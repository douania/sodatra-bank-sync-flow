# PAYABLES-CHEQUES-SINGLE-ADMIN — administrateur unique du module chèques

> Rapport du lot `GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN`. Statut : **développé et
> testé localement, PR en brouillon ; migration appliquée à aucun environnement**.
> Aucun accès Supabase, staging, production ni Lovable ; aucune désignation, aucune
> attribution réelle, aucune ouverture du module.

## 1. Métadonnées

| Élément | Valeur |
|---|---|
| Base | `origin/main` = `6c9f8ed411ff2551b7ec6a960c86093aa8cb521e` (revérifiée par `git fetch` au préflight, inchangée) |
| Branche | `codex/payables-cheques-single-admin`, worktree isolé neuf ; le checkout `C:\Users\DELL\Projects\sodatra-bank-sync-flow` n'a pas été touché |
| GO | `GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN` (niveau très approfondi) |
| Hors GO (non fait) | merge, toute application distante, désignation ou attribution réelle, création ou invitation d'utilisateur, ouverture, publication, modification de la garde de production |

## 2. Décision métier mise en œuvre

- Le dirigeant est l'administrateur unique du module : il attribue et retire lui-même les
  habilitations, gère les personnes, leurs rattachements et les paramètres versionnés
  (signataires, règles de signature, catégories, profils d'impression), sans second
  approbateur.
- Les deux comptables opérationnels ne proposent ni ne valident aucune décision de
  gouvernance et ne valident pas celles de l'administrateur.
- Le dirigeant reste seul signataire bancaire : c'est un paramètre `SIGNATORY` de sa
  personne, avec justificatif de pouvoirs. Un comptable qui enregistre une signature
  réelle n'acquiert aucun pouvoir de signature.
- La proposition « comptables gestionnaires initiaux, dirigeant troisième valideur » est
  retirée et n'a été exécutée nulle part.

Les contrôles financiers ne changent pas : paiements, annulations, remplacements,
rapprochements et leurs validations par un autre acteur restent ceux des deux
migrations précédentes.

## 3. Ce qui est développé

### 3.1 Autorité administrative (migration `20261028090000_payables_cheques_single_admin.sql`)

- `payables_private.admin_authority` : une seule ligne, `admin_user_id` nul par défaut
  (**administration fermée**). Schéma privé sans `USAGE` pour `anon`, `authenticated`,
  `service_role` ; RLS active ; aucun privilège de table.
- Désignation, remplacement et retrait uniquement par
  `payables_private.set_module_admin(attendu, nouveau, motif)` : opérateur base de
  données, comparaison à l'état attendu (`PAYABLES_ADMIN_AUTHORITY_STALE`), utilisateur
  existant, motif nouveau. Suppression, troncature, état inchangé et motif répété sont
  refusés par déclencheur. Chaque changement est journalisé deux fois :
  `payables_private.admin_authority_events` (ajout seul) et `payables_events`
  (`ADMIN_AUTHORITY_CHANGED`, lisible avec `AUDIT`).
- Aucune déduction d'un nom, d'un e-mail, de `user_metadata`, d'une revendication du
  jeton, du rôle global `admin` de l'application ou d'une capacité héritée : la seule
  source est la comparaison de `auth.uid()` à la ligne d'autorité
  (`payables_private.require_admin`, verrou partagé).
- L'administrateur détient **implicitement** les 13 capacités de travail, liées à
  l'autorité : les retirer, c'est retirer l'autorité. Il ne statue jamais sur lui-même
  (`PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN`, doublé par les contraintes de table).
- **L'administrateur n'est jamais rattaché à une personne.**
  - Il ne peut pas se rattacher lui-même.
  - Un utilisateur déjà rattaché ne peut pas être désigné (`PAYABLES_ADMIN_DESIGNEE_LINKED`),
    que ce soit par la fonction opérateur ou par une mise à jour directe : le contrôle est
    dans le déclencheur.
  - Tout chèque qu'il prépare bute donc sur `PAYABLES_PREPARER_NOT_LINKED` : ses droits
    implicites ne contournent jamais la règle « signataire ≠ préparateur ».
- **L'identité d'un préparateur est figée tant que son chèque circule.** La règle
  « signataire ≠ préparateur » se résout à la confirmation, sur les rattachements
  courants.
  - Un rattachement ou un détachement est donc refusé
    (`PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE`) tant que l'utilisateur a une demande de
    chèque ouverte, ou est intervenu sur une formule native non émise : assignation,
    version du contenu, demande ou résultat d'impression.
  - Le contrôle est sérialisé avec ses préparations en cours, par le même verrou que ses
    écritures.
  - Voie normale : terminer le chèque, ou déclarer la formule inutilisée et abandonner la
    demande, puis changer le rattachement.

### 3.2 Gouvernance héritée neutralisée

- `PARAM_PROPOSE` et `PARAM_VALIDATE` ne confèrent plus rien (`has_capability`), ne sont
  plus attribuables (`PAYABLES_CAPABILITY_RETIRED`) et ne sont plus exposés par
  `payables_my_access_v1`.
- Les huit fonctions de proposition et décision à deux acteurs et l'ancien amorçage
  `bootstrap_parameter_governance` gardent leur signature et refusent
  (`PAYABLES_LEGACY_GOVERNANCE_DISABLED`).
- Les décisions passées restent dans l'historique. Les capacités de travail déjà validées
  restent effectives ; l'administrateur peut les retirer. Les propositions restées en
  attente ne sont plus validables ; l'administrateur peut les clore
  (`payables_admin_reject_legacy_proposal_v1`), sauf celles dont il est l'auteur, qui
  restent en l'état, sans effet.

### 3.3 API d'administration

| Fonction | Rôle |
|---|---|
| `payables_admin_set_capability_v1(clé, utilisateur, capacité, attribuer, motif)` | attribuer ou retirer ; état inchangé refusé |
| `payables_admin_create_person_v1(clé, nom, motif)` | personne active ; doublon de nom normalisé refusé |
| `payables_admin_set_person_link_v1(clé, personne, utilisateur, rattacher, motif)` | rattacher ou détacher ; conflit refusé |
| `payables_admin_set_parameter_v1(clé, type, sujet, date d'effet, contenu, justificatif, version attendue, motif)` | nouvelle version validée ; mêmes règles de contenu qu'avant (ORABANK seul, champs signables complets, justificatif) ; version attendue obligatoire ; recouvrement de dates refusé |
| `payables_admin_reject_legacy_proposal_v1(clé, type, proposition, motif)` | clôture d'une proposition héritée |

Toutes sont `SECURITY DEFINER` au chemin épinglé, exécutables par `authenticated` seul
(révoquées pour `PUBLIC`, `anon` et `service_role`). Aucune ne reçoit d'identité, de
rôle ou d'horodatage de l'appelant. Elles sont idempotentes (registre de commandes),
journalisées et indépendantes de l'interrupteur métier : **l'administration se fait
module fermé, sans ouvrir l'interrupteur**.

Les décisions portent l'origine `ADMIN` : auteur = décideur = administrateur. Les
contraintes de cycle de vie des quatre tables de gouvernance sont redéfinies pour
l'admettre, sans assouplir les branches existantes. Une colonne `origin` (par défaut
`PROPOSAL`) est ajoutée aux personnes, rattachements et paramètres. Les versions
décidées restent immuables (déclencheurs inchangés).

### 3.4 Révocation et concurrence

- `require_capability` garde la même décision et prend en plus un verrou consultatif
  partagé propre au titulaire. Elle passe de `STABLE` à `VOLATILE` pour relire l'état
  validé après l'obtention du verrou.
- Une révocation (verrou exclusif sur le même titulaire) attend la fin des écritures en
  cours et s'applique dès l'appel suivant, session ouverte comprise. Une écriture lancée
  pendant une révocation attend la décision, puis échoue fermée.
- Le retrait ou le remplacement de l'administrateur attend ses décisions en cours (verrou
  partagé sur l'autorité) et ses écritures en cours (verrou du titulaire sortant).
- Deux décisions identiques concurrentes sont sérialisées : la seconde constate
  `PAYABLES_CAPABILITY_UNCHANGED`. Une version de paramètre concurrente est refusée
  (`PAYABLES_STALE_VERSION`), jamais écrasée.

### 3.5 Interface

- Panneau Paramètres réécrit : les formulaires ne s'affichent que si le serveur répond
  `is_admin` (aucune capacité héritée, aucun état d'interrupteur n'y donne accès).
  Messages explicites « administration fermée », « consultation seule » et « écritures
  métier fermées : l'administration reste possible ». Droits et rattachements en
  vigueur ; propositions héritées avec clôture ; version attendue affichée.
- Service : les huit appels de l'ancienne gouvernance sont retirés ; cinq appels
  d'administration sans identité d'appelant. Vocabulaire d'erreurs étendu (fermé).
- `payablesRuntimeTarget.ts` (garde refusant la production) **non modifié**.

## 4. Fichiers

| Type | Fichiers |
|---|---|
| Migration (nouvelle) | `supabase/migrations/20261028090000_payables_cheques_single_admin.sql` |
| Tests serveur (nouveaux) | `supabase/tests/payables_cheques_core/05_*`, `11_*`, `21_*`, `84_*`, `85_*`, `90_*`, `91_*` à `99c_*` (dont `93a`, `93b`, `95a`, `95b`) |
| Tests serveur (modifiés) | `run_pg17_replay.ps1` (deux scénarios) ; `README.md` ; `60_bank_followup_position.sql` (une assertion, § 6) |
| Interface | `ParametersPanel.tsx`, `payablesChequesService.ts`, `payablesChequesTypes.ts`, `payablesErrors.ts`, `payablesAdminModel.ts` (nouveau) |
| Tests interface | `payablesAdminModel.synthetic.test.ts`, `payablesAdminPanel.synthetic.test.tsx` (nouveaux), `payablesChequesService.synthetic.test.ts` (étendu) |
| Documentation | ce rapport ; `docs/STATUS_REGISTRY.md` ; `docs/MASTER_CONTEXT.md` |
| Non touchés | les deux migrations appliquées, Daily v2, Collections, rôles globaux, Auth/RLS hors domaine, `.env*`, `package.json`, lockfile, CI, `payablesRuntimeTarget.ts`, artefact MCP, PR #149 |

## 5. Validations exécutées (local uniquement)

Environnement : Node 22.23.1, npm 10.9.8 (`npm ci` sur le lockfile), Docker Desktop,
`postgres:17-alpine` (17.10), Windows PowerShell 5.1.

| Commande | Résultat |
|---|---|
| `npx eslint . -f json` comparé item par item à la baseline du même worktree | baseline 178 / 11 ; branche 178 / 11 ; **0 nouvel item, 0 disparu** |
| `npx tsc -p tsconfig.app.json --noEmit` | 16 diagnostics, **diff exact vide** avec la baseline |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `npm run build` | succès ; `supabase/functions/mcp/index.ts` inchangé |
| `npm run test:payables-cheques` | 55 tests, 55 réussis, 0 ignoré (39 existants + 16 nouveaux) |
| `npm run test:payables-cheques-print` | `PRINT_ISOLATION_PAGES=1`, `PRINT_ISOLATION_PAGE_MM=170x95` |
| Autres suites Node du CI (22 commandes) | toutes réussies, 0 échec, 0 ignoré |
| `run_pg17_replay.ps1` dans un processus `powershell -NoProfile -File` neuf | voir § 5.1 |

### 5.1 Rejeu PostgreSQL 17 en deux scénarios

- **upgrade** : recette complète sous l'ancienne gouvernance (10 à 80 et ses cinq
  courses), relevé, migration, puis 85 :
  - toutes les lignes de toutes les tables du domaine sont identiques (hors nouvelle
    colonne `origin`) ;
  - toutes les définitions hors gouvernance sont identiques : fonctions, politiques,
    déclencheurs, contraintes ;
  - seuls apparaissent les objets du nouveau modèle ;
  - les `PARAM_*` sont sans effet et les deux propositions héritées sont closes.
- **fresh** : les trois migrations sur une base neuve, puis les suites financières 30 à
  80 et leurs courses, **inchangées**, exécutées sous la nouvelle gouvernance (21 en
  reproduit l'état par l'administrateur).
- Dans les deux scénarios, 90 couvre les dix exigences du GO (§ 7) et six courses
  réelles à deux sessions :

| Marqueur | Preuve |
|---|---|
| `REVOCATION_WAITS_FOR_INFLIGHT_WRITE` | la révocation attend l'écriture en cours (environ 2,6 s), puis l'appel suivant est refusé |
| `WRITE_WAITS_FOR_INFLIGHT_REVOCATION` | une écriture lancée pendant une révocation attend, puis échoue `PAYABLES_CAPABILITY_REQUIRED` |
| `CONCURRENT_ADMIN_DECISION_SERIALIZED` | deux décisions identiques : la seconde attend puis constate `PAYABLES_CAPABILITY_UNCHANGED` ; une seule décision enregistrée |
| `LINK_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION` | un détachement lancé pendant une préparation du titulaire attend, la voit et refuse (`PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE`) |
| `AUTHORITY_WITHDRAWAL_WAITS_FOR_ADMIN_WRITE` | le retrait de l'administrateur attend son écriture en cours ; ensuite plus aucun droit implicite |
| `AUTHORITY_REPLACEMENT_WAITS_FOR_ADMIN_DECISION` | le remplacement attend sa décision en cours ; le successeur administre module fermé |

### 5.2 Preuves de mordant (mutations de la migration, rejeu complet)

Chaque mutant est une copie de la migration altérée sur un seul point. Il est rejoué sur
une base jetable avec les mêmes fichiers et les mêmes courses ; le dépôt n'est pas
modifié. La migration non mutée passe le même harnais. Les 18 mutants ont été tués
avant un renommage purement lexical des libellés de test (prénoms remplacés par des
libellés neutres). Trois d'entre eux ont été rejoués après ce renommage, tués de la même
façon : rattachement non figé, instantané périmé, désigné rattaché.

| Mutant | Tué par |
|---|---|
| `PARAM_*` à nouveau effectifs | 90 « legacy governance grant has no effect » ; 85 en mise à niveau |
| garde d'administration supprimée | 11 : un non-désigné administre |
| administration soumise à l'interrupteur | 90 : `PAYABLES_DOMAIN_READ_ONLY` module fermé |
| décision de l'administrateur sur lui-même admise | 90 : seule la contrainte de table refuse encore |
| auto-rattachement de l'administrateur admis | 90 : seule la contrainte de table refuse encore |
| pas de verrou de titulaire dans `require_capability` | course 91–92 : la révocation n'attend pas (280 ms) |
| `require_capability` laissée `STABLE` | course 93a–93b : l'écriture attend (2,75 s) puis passe sur un état périmé |
| retrait de l'administrateur sans attente | course 96–97 : le retrait n'attend pas (297 ms) |
| pas de sérialisation des décisions par titulaire | course 91–92 |
| droits implicites de l'administrateur supprimés | 90 : capacités de l'administrateur |
| version attendue de paramètre non contrôlée | 90 : `PAYABLES_STALE_VERSION` attendu |
| contrainte ADMIN admettant `PARAM_*` | 90 : insertion opérateur acceptée |
| ancien amorçage conservé | 11 : l'ancien amorçage aboutit |
| définition hors gouvernance modifiée (`today`) | 85 : définitions comparées |
| propositions héritées closes par la migration | 85 : lignes comparées |
| rattachement d'un préparateur en cours non figé | 90 : `PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE` attendu |
| figement sans verrou du titulaire | course 95a–95b : le détachement n'attend pas la préparation |
| désignation d'un utilisateur rattaché admise | 85 (ancien gouverneur rattaché) ; 98 (fonction et mise à jour directe) |

## 6. Défaut préexistant corrigé dans le périmètre des tests

`60_bank_followup_position.sql` vérifiait qu'une position « du jour » n'est pas
historique, en la calculant à la date figée du 2026-10-26. Depuis le 2026-10-27, ce test
échoue sur `main` (`6c9f8ed`) lui-même, quel que soit le lot : il a échoué dans le
scénario upgrade **avant** l'application de la nouvelle migration. L'assertion calcule
désormais la position à la date du jour du serveur (paramètre absent). Son intention est
inchangée et aucune autre assertion n'est touchée.

## 7. Correspondance avec les tests exigés

| Exigence | Preuve |
|---|---|
| 1. administrateur sans second approbateur | 21 ; 90 § 1 (origine `ADMIN`, auteur = décideur) |
| 2. aucune auto-élévation, droits du dirigeant intouchables, aucune auto-désignation | 90 § 2 ; 11 |
| 3. ancien `PARAM_*` sans autorité | 85 § 2 ; 90 § 3 |
| 4. identité, rôle, e-mail falsifiés | 90 § 4 (revendications, rôle global `admin`, identité inconnue, `service_role`, `anon`) |
| 5. révocation effective session ouverte | 90 § 5 ; courses 91–93b, 96–98 |
| 6. traces et immuabilité | 90 § 6 ; 11 ; 98 ; 99c |
| 7. aucune écriture financière module fermé | 90 § 1 ; 99c |
| 8. rejeu et concurrence | 90 § 8 ; courses 94–95, 99a–99b |
| 9. conservation d'un domaine installé | 84–85 (scénario upgrade) |
| 10. contrôles financiers et garde de production inchangés | 85 (définitions identiques) ; scénario fresh (30 à 80 inchangés) ; 90 (seul signataire, préparateur non rattaché) ; test d'interface sur la garde |

## 8. Revue indépendante

Revue obligatoire par un agent distinct, en lecture seule, sur le code, les migrations,
les tests et le diff d'interface, sans connaître les conclusions de ce rapport. Verdict :
**aucun P1**, deux P2, sept P3. Constats confirmés :
- aucune voie d'administration pour un non-désigné (revendications, rôle global, `PARAM_*`,
  `service_role`, `anon`) ;
- autorité vérifiée avant tout rejeu ;
- relecture de l'état après verrou démontrée par la course 93a–93b ;
- aucun cycle de verrous ;
- contraintes plus larges que les anciennes ;
- interface fondée sur la seule réponse serveur ;
- traitement des propositions héritées acceptable ;
- correction du test 60 légitime.

| Constat | Traitement |
|---|---|
| P2-1 — l'administrateur pourrait détacher puis rattacher autrement un préparateur après sa préparation et faire passer la signature de l'ancienne personne | **corrigé** : rattachement figé tant que le chèque circule, sérialisé avec les préparations ; 90 et course 95a–95b ; deux mutants tués |
| P2-2 — un administrateur rattaché (lien hérité ou désignation d'un rattaché) contournerait « signataire ≠ préparateur » par ses droits implicites | **corrigé** : désignation d'un rattaché refusée dans le déclencheur ; 85 (ancien gouverneur) et 98 ; mutant tué |
| P3-1 — prise et levée forcée des verrous de traitement non sérialisées avec une révocation | **non modifié** : verrous de confort d'équipe, sans effet sur l'intégrité (P5 § 8) ; réserve |
| P3-2 — une mise à jour directe de l'autorité contournait l'attente des écritures du sortant | **corrigé** : attente déplacée dans le déclencheur (tous chemins) |
| P3-3 — commentaire inexact sur l'exposition de l'identité de l'administrateur | **corrigé** : la fonction d'accès ne l'expose pas ; il figure comme auteur dans les décisions lisibles par leur bénéficiaire et dans le journal (`AUDIT`) |
| P3-4 — propositions héritées de l'administrateur lui-même non closables, libellées « à valider » dans la file | **réserve** (§ 10) |
| P3-5 — une préparation par l'administrateur rend le chèque non confirmable (formule gâchée) | **décision CTO** (§ 10) |
| P3-6 — couvertures manquantes | **ajoutées** : rejeu d'une clé après retrait (98), clôture des propositions PERSON et PERSON_LINK et refus sur la sienne (90), administrateur rattaché (85, 98), rattachement après préparation (90, 95a–95b), contrôles anonymes et module fermé de 10 repris en installation neuve (11) |
| P3-7 — anciennes attributions explicites de l'administrateur figées pendant son mandat | **réserve** documentée (§ 9, § 10) |

## 9. Procédure future d'amorçage et de révocation (non exécutée)

Sous un GO d'environnement distinct, cible exacte vérifiée, module fermé :

1. **Identifier** le compte Auth existant du dirigeant par l'opérateur, sans créer de
   doublon ni déduire l'identité d'un nom ou d'une adresse. L'identifiant n'est jamais
   écrit dans le dépôt, un rapport public ou un prompt réutilisable. Vérifier que ce
   compte n'est rattaché à aucune personne (sinon `PAYABLES_ADMIN_DESIGNEE_LINKED`) et
   ne détient aucune attribution explicite.
2. **Appliquer** la migration `20261028090000` par le canal ciblé validé, avec relevé
   avant/après.
3. **Désigner** : `SELECT payables_private.set_module_admin(NULL, '<uuid du dirigeant>', '<motif de 8 à 240 caractères>');`
4. **Vérifier** : autorité égale à l'identifiant attendu ; une ligne dans
   `payables_private.admin_authority_events` ; un événement `ADMIN_AUTHORITY_CHANGED` ;
   interrupteur toujours fermé.
5. Le dirigeant administre ensuite depuis l'interface : personnes, rattachements des
   comptables, habilitations, signataire et règle par compte, catégories, profil
   ORABANK. Module fermé.
6. **Retrait d'urgence** :
   `SELECT payables_private.set_module_admin('<uuid actuel>', NULL, '<motif>');` ;
   effet au prochain appel. **Remplacement** :
   `set_module_admin('<uuid actuel>', '<uuid successeur>', '<motif>')`.
7. **Révocation d'un comptable** : par l'administrateur, depuis l'interface ; effet
   serveur immédiat.

## 10. Réserves et étapes restantes

- Désignation de l'administrateur, attribution des droits et paramétrage : GO distincts,
  après identification du compte existant du dirigeant. Les observations du 27 octobre
  2026 transmises par le CTO (migrations installées en production, module fermé, aucun
  droit ni paramètre, aucun utilisateur sous les trois adresses communiquées, compte
  ORABANK courant actif en XOF au registre) n'ont **pas** été relues par ce lot.
- L'administrateur peut se désigner comme signataire (paramètre `SIGNATORY` de sa
  personne, justificatif exigé), sans validation tierce. C'est la décision métier, mais
  elle reste à ratifier.
- Les fonctions de l'ancienne gouvernance restent exécutables et refusent toujours ; une
  suppression ultérieure demanderait une migration dédiée.
- Les propositions héritées dont l'administrateur est l'auteur restent en attente, sans
  effet. La file de travail continue de lister les propositions héritées en attente sous
  leurs anciens libellés (« à valider ») jusqu'à leur clôture. Ce cas ne se présente
  qu'avec des données de l'ancienne gouvernance (staging fictif), pas en production
  vierge.
- **Décision CTO demandée.** L'administrateur n'étant jamais rattaché, tout chèque à la
  préparation duquel il participe ne peut pas être confirmé par la voie normale ; la
  formule est alors gâchée. Deux options :
  - conserver ses droits implicites complets (« tous les droits », lecture actuelle) et
    l'avertir dans l'interface ;
  - retirer `CHEQUE_PREPARE_PRINT` de ses droits implicites.
- Les prises et levées forcées des verrous de traitement ne sont pas sérialisées avec
  une révocation : confort d'équipe, sans effet sur l'intégrité.
- Les attributions explicites que l'administrateur détenait avant sa désignation restent
  en vigueur et ne sont pas révocables pendant son mandat. Elles sont à vérifier avant la
  désignation ; ce cas est sans objet en production vierge.
- Garde de production, staging, production et ouverture du module : GO distincts.
