# PAYABLES-CHEQUES-SINGLE-ADMIN — administrateur unique du module chèques

> Rapport des lots `GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN` puis
> `GO_FIX_PAYABLES_CHEQUES_SINGLE_ADMIN` (contre-revue CTO du 28 octobre 2026, `FAIL`
> ciblé sur `52b3dd0`), reconduit le 29 octobre pour le dernier blocage sur `fd860b1`
> (circuit comptable conservé). Statut : **développé et testé localement, PR en brouillon ;
> migration appliquée à aucun environnement**. Aucun accès Supabase, staging,
> production ni Lovable ; aucune désignation, aucune identité établie, aucune
> attribution réelle, aucune ouverture du module.

## 1. Métadonnées

| Élément | Valeur |
|---|---|
| Base | `origin/main` = `6c9f8ed411ff2551b7ec6a960c86093aa8cb521e` (revérifiée par `git fetch` aux deux préflights, inchangée) |
| Branche | `codex/payables-cheques-single-admin`, worktree isolé ; le checkout `C:\Users\DELL\Projects\sodatra-bank-sync-flow` n'a pas été touché |
| GO | `GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN` (niveau très approfondi), puis `GO_FIX_PAYABLES_CHEQUES_SINGLE_ADMIN` (même branche, même PR), reconduit le 29 octobre |
| Têtes contre-revues | `52b3dd0c6e9489162080f937dc6070c321b5257b` (verdict `FAIL` ciblé : F1 P1, F2 P2, F3 P2) ; `fd860b1447045a8745c8a3081ec8a7ef6b9f7c48` (dernier blocage : contrôle indépendant à retirer) |
| Hors GO (non fait) | merge, toute application distante, désignation ou identité réelle, attribution réelle, création ou invitation d'utilisateur, ouverture, publication, modification de la garde de production |

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
- Arbitrages CTO du 28 octobre : ni impression vouée à l'échec, ni retrait global du droit
  de préparer du dirigeant ; sa désignation comme signataire de son propre chef est
  admise, avec pouvoirs justifiés et décision tracée, sans lui permettre de
  s'auto-contrôler sur un chèque ni de créer une preuve bancaire ; correction de
  l'assertion datée du test 60 ratifiée. Depuis l'arbitrage du 29 octobre,
  « s'auto-contrôler » s'entend ainsi : le préparateur d'un chèque, administrateur
  compris, n'en est jamais le signataire accepté. Il peut en revanche, comme tout
  détenteur de `CHEQUE_CONFIRM_ISSUE`, enregistrer la signature d'un autre signataire
  admissible puis confirmer.
- Arbitrage CTO du 29 octobre, **circuit comptable conservé, sans validation comptable
  ajoutée** :
  1. le comptable prépare et imprime le chèque ;
  2. le signataire autorisé, distinct du préparateur, contrôle les pièces et signe
     physiquement ;
  3. le même comptable peut enregistrer cette signature puis confirmer l'émission réelle.

  Enregistrer une signature ne confère aucun pouvoir de signature. L'administrateur
  reste responsable des identités, habilitations et pouvoirs déclarés ; justificatifs et
  décisions sont tracés ; l'application en contrôle la cohérence sans prétendre
  certifier l'identité physique (§ 11).

Les contrôles financiers existants ne changent pas : paiements, annulations,
remplacements, rapprochements, signatures et leurs validations par un autre acteur
restent ceux des deux migrations précédentes. Les précontrôles (§ 3.3) s'y ajoutent sans
en retirer aucun.

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
- L'autorité ne dépend plus de l'identité personnelle : la désignation, le retrait et le
  remplacement ne lisent ni ne modifient aucun rattachement (§ 3.2).

### 3.2 Identité personnelle de l'administrateur (contre-revue F1)

- **Distincte de l'autorité.** L'identité est le rattachement en vigueur du compte à une
  personne, celui que la confirmation lit pour appliquer « signataire ≠ préparateur ».
- **Établie par un tiers, jamais choisie par l'administrateur.**
  - `payables_private.set_module_admin_identity(administrateur, personne, rattacher, motif)` :
    opérateur seul, sous GO d'environnement, pour l'administrateur en fonction uniquement
    (`PAYABLES_ADMIN_IDENTITY_TARGET_INVALID` sinon).
  - Le rattachement porte l'origine `OPERATOR`, sans auteur ni décideur applicatif ; il
    est journalisé (`ADMIN_IDENTITY_LINKED` / `ADMIN_IDENTITY_UNLINKED`, acteur nul,
    session de l'opérateur en métadonnée).
  - Un désigné déjà rattaché garde l'identité établie avant sa désignation, par un
    administrateur précédent ou par l'ancienne gouvernance à deux acteurs. La procédure
    (§ 10) fait vérifier cette identité par l'opérateur.
- **Non réassignable pour contourner la règle.**
  - L'administrateur ne se rattache ni ne se détache (`PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN`).
  - Personne d'autre ne reprend sa personne (`PAYABLES_LINK_CONFLICT`).
  - La ligne décidée est immuable.
  - Son retrait par l'opérateur est refusé tant qu'un chèque qu'il a préparé circule.
    Ce contrôle est sérialisé avec ses préparations en cours : course 95c–95d.
  - Les contraintes de table n'admettent un rattachement sans auteur qu'avec l'origine
    `OPERATOR`. La colonne `proposed_by` devient nullable pour cette seule origine ; les
    autres branches l'exigent explicitement.
- **Identité d'un préparateur figée tant que son chèque circule**, pour tout compte. Le
  seul assouplissement est l'établissement d'une **première** identité, à deux
  conditions : le compte n'a jamais été rattaché, et aucune signature n'est encore
  enregistrée sur ses chèques en cours. Aucune personne antérieure n'a donc pu servir à
  ses préparations, et l'identité n'est jamais choisie au vu des signataires. C'est la
  voie de sortie d'un préparateur hérité de l'ancienne gouvernance. Un compte qui a déjà
  eu une identité ne reçoit ni une autre ni l'ancienne tant que son chèque circule.
- Sans identité établie, l'administrateur administre normalement mais ne prépare aucun
  chèque : refus d'avance, § 3.3. L'interface le lui signale.

### 3.3 Précontrôles du circuit de préparation (contre-revue F1)

- La confirmation normale (`payables_confirm_issuance_v1`, inchangée) exige deux
  conditions :
  - chaque préparateur est rattaché ;
  - les signatures requises viennent de signataires admissibles autres que les
    préparateurs.
- Chaque étape de préparation vérifie d'avance que ces conditions restent réunissables
  une fois l'acteur compté parmi les préparateurs. La vérification
  (`payables_private.assert_cheque_confirmable`) utilise les paramètres en vigueur ce jour,
  par déclencheurs :

| Étape | Acteur compté |
|---|---|
| demande de chèque (`payables_payments`, chèque ouvert, hors remplaçant issu d'une sortie) | auteur de la demande |
| assignation, révision, ajustement d'une formule native (nouvelle version du contenu) | auteur de la version |
| intention d'impression | demandeur |
| résultat imprimé ou incertain | déclarant |

- Les préparateurs pris en compte sont ceux de la confirmation, plus l'acteur. Une
  impression encore en attente compte déjà : son résultat fera de son demandeur un
  préparateur.
- Refus d'avance, rien n'est écrit et aucune formule n'est assignée, imprimée ni gâchée :
  - `PAYABLES_PREPARER_NOT_LINKED` si un préparateur n'est pas rattaché ;
  - `PAYABLES_NO_INDEPENDENT_SIGNATORY` si les signataires admissibles distincts des
    préparateurs sont en nombre inférieur à la règle du compte, ou si aucune règle n'est
    en vigueur.
- Une restriction ne vaut que pour l'opération concernée. Le dirigeant, seul signataire
  du compte pilote, ne prépare pas un chèque de ce compte. Il prépare normalement sur un
  compte où un autre signataire est admissible : son droit de préparer reste entier.
- **Un résultat d'impression est un fait et s'enregistre** (revue indépendante P2-1, puis
  seconde vérification) :
  - un résultat imprimé ou incertain n'est refusé que si c'est le déclarant lui-même qui
    ferait défaut à l'une des conditions, alors qu'elle était réunie sans lui. La
    comparaison se fait condition par condition : une cause étrangère au déclarant, par
    exemple des pouvoirs suspendus entre l'intention et le résultat, ne masque pas la
    sienne, par exemple un déclarant non rattaché ;
  - le demandeur de l'impression, déjà compté, peut toujours déclarer. La formule reste
    en attente sans rien perdre, et aucune libération n'est possible d'ici là ;
  - le seul signataire ne devient donc pas déclarant d'une impression incertaine. Sinon,
    une formule retrouvée imprimée ne serait plus confirmable ;
  - un chèque devenu non confirmable pour une autre cause (paramètre changé entre
    l'intention et le résultat, préparateur hérité non rattaché) s'enregistre imprimé. La
    confirmation le refuse, la réservation reste attachée (aucune libération d'une
    formule imprimée) et la voie d'exception existante s'applique.
- La confirmation garde tous ses contrôles ; ils restent prouvés dans le scénario upgrade
  et par 41.

### 3.4 Circuit comptable conservé (arbitrage CTO du 29 octobre)

- L'enregistrement d'une signature et la confirmation de l'émission réelle restent
  ouverts à tout détenteur de `CHEQUE_CONFIRM_ISSUE`, préparateur compris. Le comptable qui
  a préparé et imprimé enregistre la signature du dirigeant puis confirme.
- Le contrôle porte sur la personne qui signe :
  - le signataire accepté est admissible ;
  - il est distinct de tous les préparateurs ;
  - la signature n'est pas antérieure à l'impression de la version signable ; ce
    contrôle est fait à l'enregistrement de la signature ;
  - la signature n'est pas postérieure à la date d'émission ; ce contrôle est fait à la
    confirmation.

  Ces contrôles sont ceux des deux migrations installées, inchangés.
- Enregistrer une signature ne confère aucun pouvoir de signature. Une signature
  enregistrée au nom du préparateur est refusée à la confirmation
  (`PAYABLES_SIGNATORY_IS_PREPARER`).
- L'impression seule ne vaut jamais émission : formule imprimée, réservation intacte,
  aucune émission tant que la confirmation n'a pas abouti.
- La règle d'indépendance du contrôleur, ajoutée après la première revue indépendante,
  est **retirée**, avec le précontrôle qui l'accompagnait, leurs fonctions, déclencheurs
  et messages. Elle ajoutait une validation comptable que le circuit retenu exclut.
- Les validations indépendantes déjà acquises restent inchangées : annulations,
  remplacements, corrections, exceptions.

### 3.5 Gouvernance héritée neutralisée

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

### 3.6 API d'administration

| Fonction | Rôle |
|---|---|
| `payables_admin_set_capability_v1(clé, utilisateur, capacité, attribuer, motif)` | attribuer ou retirer ; état inchangé refusé |
| `payables_admin_create_person_v1(clé, nom, motif)` | personne active ; doublon de nom normalisé refusé |
| `payables_admin_set_person_link_v1(clé, personne, utilisateur, rattacher, motif)` | rattacher ou détacher un autre compte ; conflit refusé ; identité figée tant que son chèque circule (première identité exceptée) |
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

### 3.7 Révocation et concurrence

- `require_capability` garde la même décision et prend en plus un verrou consultatif
  partagé propre au titulaire. Elle passe de `STABLE` à `VOLATILE` pour relire l'état
  validé après l'obtention du verrou.
- Une révocation (verrou exclusif sur le même titulaire) attend la fin des écritures en
  cours et s'applique dès l'appel suivant, session ouverte comprise. Une écriture lancée
  pendant une révocation attend la décision, puis échoue fermée.
- Le retrait ou le remplacement de l'administrateur attend ses décisions en cours (verrou
  partagé sur l'autorité) et ses écritures en cours (verrou du titulaire sortant).
- Tout changement de rattachement, administrateur comme opérateur, prend le verrou
  exclusif du titulaire : il attend ses préparations en cours, puis les voit.
- Deux décisions identiques concurrentes sont sérialisées : la seconde constate
  `PAYABLES_CAPABILITY_UNCHANGED`. Une version de paramètre concurrente est refusée
  (`PAYABLES_STALE_VERSION`), jamais écrasée.

### 3.8 Interface

- **Accès** : panneau Paramètres réservé à l'administrateur que le serveur reconnaît
  (`is_admin`) ; aucune capacité héritée ni aucun état d'interrupteur n'y donne accès.
- **Messages** : « administration fermée », « consultation seule », « écritures métier
  fermées : l'administration reste possible ». S'y ajoute l'alerte « identité
  personnelle non établie » pour un administrateur non rattaché.
- **F2 — version de référence attachée au brouillon** (`payablesAdminModel.ts`) :
  - elle est fixée la première fois que la saisie vise un paramètre, puis ne suit plus
    le cache, même si la saisie quitte ce paramètre et y revient (revue indépendante
    P2-2 : retaper la clé ne refonde jamais le brouillon) ;
  - une version enregistrée entre-temps affiche un conflit, montre la version
    concurrente et bloque l'enregistrement ;
  - la levée est explicite : « Recharger la saisie », qui reprend le contenu de la
    nouvelle version et demande un nouveau justificatif, ou « Conserver ma saisie sur la
    version N » ;
  - la version transmise au serveur est celle du brouillon, jamais une version lue
    après coup. Après sa propre décision, la version enregistrée devient la référence,
    sans faux conflit ;
  - si le serveur refuse une version périmée que le cache ignorait encore, les
    versions sont relues et le conflit s'affiche sur le brouillon conservé (revue
    indépendante P3-1).
- **F3 — lectures distinguées** :
  - chaque lecture d'administration (personnes, rattachements, habilitations,
    paramètres) est en chargement, en échec ou disponible ;
  - un échec affiche son message et « Réessayer », jamais « Aucune habilitation
    attribuée », qui ne s'affiche que pour une liste réellement vide ;
  - les décisions qui dépendent d'une lecture invalide sont suspendues ; les saisies
    sont conservées et la reprise les retrouve intactes.
- **Service** : les huit appels de l'ancienne gouvernance sont retirés ; cinq appels
  d'administration sans identité d'appelant. Le vocabulaire d'erreurs fermé est étendu
  (`PAYABLES_NO_INDEPENDENT_SIGNATORY`, `PAYABLES_ADMIN_IDENTITY_TARGET_INVALID`).
- **Garde de production** : `payablesRuntimeTarget.ts` **non modifié**.

## 4. Contre-revue CTO du 28 octobre : traitement

| Constat | Traitement | Preuves |
|---|---|---|
| F1 (P1) — impression d'un chèque ensuite non confirmable ; administrateur jamais rattachable ; comptable non rattaché bloqué de même | identité distincte de l'autorité, établie par l'opérateur et non réassignable (§ 3.2) ; précontrôles avant toute formule consommée (§ 3.3) ; première identité possible pour un préparateur hérité | 90 (identité, refus d'avance, droit de préparer conservé ailleurs, déclarant d'un résultat, compte sans règle, comptable non rattaché) ; 85 (désigné rattaché, préparateurs hérités) ; 41 (cas non rattaché refusé dès la demande) ; course 95c–95d ; 19 mutants tués (§ 6.2) |
| F2 (P2) — version attendue avancée en silence | version de référence du brouillon, conflit signalé, envoi bloqué, levée explicite (§ 3.8) | test d'interaction : saisie sur v1, cache passé à v2, enregistrement tenté, aucun appel ; confirmation explicite puis envoi avec la version 2 ; rechargement ; clé retapée ; refus serveur d'une version périmée ; test du modèle ; 7 mutants tués |
| F3 (P2) — lecture en échec présentée comme liste vide | états distincts, reprise, décisions suspendues, saisie conservée (§ 3.8) | rendu statique (échec, chargement, vide) ; test d'interaction : échec réel, « Réessayer », reprise réussie, saisie intacte ; rattachements indisponibles signalés ; 3 mutants tués |

Les tests d'interaction tournent en rendu client React réel (`react-dom/client`), dans un
DOM minimal écrit dans le fichier de test, sans dépendance ajoutée. Le client Supabase et
la cible d'exécution y sont remplacés au chargement des modules, jamais par une option
de production ; chaque appel serveur est enregistré.

## 5. Fichiers

| Type | Fichiers |
|---|---|
| Migration (nouvelle) | `supabase/migrations/20261028090000_payables_cheques_single_admin.sql` |
| Tests serveur (nouveaux) | `supabase/tests/payables_cheques_core/05_*`, `11_*`, `21_*`, `84_*`, `85_*`, `90_*`, `91_*` à `99c_*` (dont `93a`, `93b`, `95a` à `95d`) |
| Tests serveur (modifiés) | `run_pg17_replay.ps1` (deux scénarios) ; `README.md` ; `60_bank_followup_position.sql` (une assertion, § 7) ; `41_cheque_issuance.sql` (cas du préparateur non rattaché selon la présence des précontrôles) |
| Interface | `ParametersPanel.tsx`, `payablesChequesService.ts`, `payablesChequesTypes.ts`, `payablesErrors.ts`, `payablesAdminModel.ts` (nouveau) |
| Tests interface | `payablesAdminModel.synthetic.test.ts`, `payablesAdminPanel.synthetic.test.tsx`, `payablesAdminPanelInteraction.synthetic.test.tsx` (nouveaux), `payablesChequesService.synthetic.test.ts` (étendu) |
| Documentation | ce rapport ; `docs/STATUS_REGISTRY.md` ; `docs/MASTER_CONTEXT.md` |
| Non touchés | les deux migrations appliquées, Daily v2, Collections, rôles globaux, Auth/RLS hors domaine, `.env*`, `package.json`, lockfile, CI, `payablesRuntimeTarget.ts`, artefact MCP, PR #149 |

## 6. Validations exécutées (local uniquement)

Environnement : Node 22.23.1, npm 10.9.8, Docker Desktop, `postgres:17-alpine` (17.10),
Windows PowerShell 5.1.

| Commande | Résultat |
|---|---|
| `npx eslint . -f json` comparé item par item à la baseline du même worktree | baseline 178 / 11 ; branche 178 / 11 ; **0 nouvel item, 0 disparu** |
| `npx tsc -p tsconfig.app.json --noEmit` | 16 diagnostics, **diff exact vide** avec la baseline |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `npm run build` | succès ; `supabase/functions/mcp/index.ts` inchangé |
| `npm run test:payables-cheques` | 67 tests, 67 réussis, 0 ignoré (39 du module initial, 28 du modèle administrateur unique dont 5 d'interaction en rendu client) |
| `npm run test:payables-cheques-print` | `PRINT_ISOLATION_PAGES=1`, `PRINT_ISOLATION_PAGE_MM=170x95` |
| Autres suites Node du CI (21 commandes) | toutes réussies, 0 échec, 0 ignoré |
| `run_pg17_replay.ps1` dans un processus `powershell -NoProfile -File` neuf | voir § 6.1 |
| CI GitHub (Node 20) | premier passage en échec sur `9a37f2d` : le test d'interaction lisait un `navigator` global absent sous Node 20. Corrigé dans le DOM du test (`9e7dc41`), échec reproduit puis corrigé localement en retirant `navigator` ; aucun code de production touché |

### 6.1 Rejeu PostgreSQL 17 en deux scénarios

`PAYABLES_CHEQUES_CORE_PG17_REPLAY_PASS` : 40 marqueurs `PASS`, 13 courses par
scénario, attentes mesurées entre 2,55 et 2,69 s.

- **upgrade** : recette complète sous l'ancienne gouvernance (10 à 80 et ses cinq
  courses, dont 41 avec le contrôle « préparateur non rattaché » à la confirmation),
  relevé, migration, puis 85 :
  - toutes les lignes de toutes les tables du domaine sont identiques (hors nouvelle
    colonne `origin`) ;
  - toutes les définitions hors gouvernance sont identiques : fonctions, politiques,
    déclencheurs, contraintes ;
  - seuls apparaissent les objets du nouveau modèle, précontrôles compris ;
  - les `PARAM_*` sont sans effet et les propositions héritées sont closes ;
  - un ancien gouverneur rattaché, désigné puis retiré, garde son identité ;
  - le préparateur hérité jamais rattaché reçoit une première identité, et son chèque
    imprimé se confirme par la voie normale ;
  - le compte détaché sous l'ancienne gouvernance reste figé.
- **fresh** : les trois migrations sur une base neuve, puis les suites financières 30 à
  80 et leurs courses sous la nouvelle gouvernance. 21 reproduit l'état par
  l'administrateur. Seul le cas du préparateur non rattaché de 41 change : il est refusé
  dès la demande.
- Dans les deux scénarios, 90 couvre les exigences du GO et de la contre-revue (§ 8) et
  sept courses réelles à deux sessions :

| Marqueur | Preuve |
|---|---|
| `REVOCATION_WAITS_FOR_INFLIGHT_WRITE` | la révocation attend l'écriture en cours, puis l'appel suivant est refusé |
| `WRITE_WAITS_FOR_INFLIGHT_REVOCATION` | une écriture lancée pendant une révocation attend, puis échoue `PAYABLES_CAPABILITY_REQUIRED` |
| `CONCURRENT_ADMIN_DECISION_SERIALIZED` | deux décisions identiques : la seconde attend puis constate `PAYABLES_CAPABILITY_UNCHANGED` |
| `LINK_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION` | un détachement lancé pendant une préparation du titulaire attend, la voit et refuse |
| `IDENTITY_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION` | le retrait opérateur de l'identité de l'administrateur pendant une de ses préparations attend, la voit et refuse |
| `AUTHORITY_WITHDRAWAL_WAITS_FOR_ADMIN_WRITE` | le retrait de l'administrateur attend son écriture en cours ; ensuite plus aucun droit implicite, identité conservée |
| `AUTHORITY_REPLACEMENT_WAITS_FOR_ADMIN_DECISION` | le remplacement attend sa décision en cours ; le successeur administre module fermé |

### 6.2 Preuves de mordant (mutations, rejeu complet)

Chaque mutant est une copie de la migration altérée sur un seul point, ou une copie du
panneau ou du modèle d'interface. Il est rejoué avec les mêmes fichiers et, pour la
migration, les mêmes courses, sur une base jetable ; le dépôt n'est pas modifié. La
migration non mutée passe le même harnais dans les deux scénarios. **Les 36 mutants de
la migration et les 10 mutants d'interface sont tués**, chacun par le contrôle attendu.

| Mutant de la migration | Tué par |
|---|---|
| `PARAM_*` à nouveau effectifs | 90 « legacy governance grant has no effect » |
| garde d'administration supprimée | 11 : un non-désigné administre |
| administration soumise à l'interrupteur | 90 : `PAYABLES_DOMAIN_READ_ONLY` module fermé |
| décision de l'administrateur sur lui-même admise | 90 : seule la contrainte de table refuse encore |
| auto-rattachement de l'administrateur admis | 90 : seule la contrainte de table refuse encore |
| pas de verrou de titulaire dans `require_capability` | course 91–92 : la révocation n'attend pas (262 ms) |
| `require_capability` laissée `STABLE` | course 93a–93b : l'écriture attend puis passe sur un état périmé |
| retrait de l'administrateur sans attente | course 96–97 : le retrait n'attend pas (254 ms) |
| pas de sérialisation des décisions par titulaire | course 91–92 |
| droits implicites de l'administrateur supprimés | 90 : capacités de l'administrateur |
| version attendue de paramètre non contrôlée | 90 : `PAYABLES_STALE_VERSION` attendu |
| contrainte ADMIN admettant `PARAM_*` | 90 : insertion opérateur acceptée |
| ancien amorçage conservé | 11 : l'ancien amorçage aboutit |
| définition hors gouvernance modifiée (`today`) | 85 : définitions comparées |
| propositions héritées closes par la migration | 85 : lignes comparées |
| rattachement d'un préparateur en cours non figé | 90 : `PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE` attendu |
| figement sans verrou du titulaire | course 95a–95b : le détachement n'attend pas la préparation |
| précontrôle de la demande désactivé | 41 : préparateur non rattaché accepté |
| précontrôle du contenu désactivé | 90 : révision par le seul signataire acceptée |
| précontrôle de l'intention d'impression désactivé | 90 : impression par le seul signataire acceptée |
| précontrôle du résultat désactivé | 90 : déclaration par le seul signataire acceptée |
| préparateur non rattaché toléré | 41 : demande acceptée |
| préparateurs non exclus des signataires | 90 : demande du seul signataire acceptée |
| impression en attente non comptée | 90 : déclarant du second signataire accepté (compte à deux signataires) |
| déclarant du résultat non compté | 90 : déclaration par le seul signataire acceptée |
| compte sans règle de signature toléré | 90 : demande acceptée sur un compte non paramétré |
| première identité figée elle aussi | 85 : le préparateur hérité jamais rattaché reste bloqué |
| nouvelle identité admise après un détachement hérité | 85 : rattachement accepté pendant que le chèque circule |
| identité opérateur sur un autre compte que l'administrateur | 90 : `PAYABLES_ADMIN_IDENTITY_TARGET_INVALID` attendu |
| identité opérateur sans verrou du titulaire | course 95c–95d : le retrait n'attend pas (316 ms) |
| identité opérateur non figée | course 95c–95d : le retrait aboutit malgré la préparation |
| rattachement sans auteur admis hors origine opérateur | 90 : proposition sans auteur insérée |
| première identité admise après une signature | 85 : identité donnée au préparateur hérité dont le chèque est signé |
| résultat d'impression toujours filtré | 90 : fait réel refusé après un paramètre changé ; 85 : impression héritée |
| cause comparée globalement, non condition par condition | 90 : déclarant non rattaché accepté sur un chèque déjà non confirmable |
| résultat incertain jamais filtré | 90 : incertitude déclarée par le seul signataire acceptée |

| Mutant d'interface | Tué par |
|---|---|
| version attendue lue dans le cache | interaction : enregistrement avec la version 1 renouvelée |
| conflit jamais affiché | interaction (deux tests) |
| référence suivant le cache à chaque saisie | modèle : brouillon ; interaction (clé retapée) |
| référence refondée en revenant à un paramètre déjà visé | modèle ; interaction (clé retapée) |
| refus serveur d'une version périmée sans relecture | interaction : conflit jamais affiché |
| faux conflit sur sa propre décision | interaction : conflit après enregistrement |
| rechargement gardant le justificatif | modèle ; interaction (rechargement) |
| échec présenté comme liste vide | rendu statique (échec, chargement) ; interaction |
| décision non suspendue sur lecture en échec | interaction : « Attribuer » actif |
| « Réessayer » sans effet | interaction : reprise jamais obtenue |

## 7. Défaut préexistant corrigé dans le périmètre des tests (ratifié)

`60_bank_followup_position.sql` vérifiait qu'une position « du jour » n'est pas
historique, en la calculant à la date figée du 2026-10-26. Depuis le 2026-10-27, ce test
échouait sur `main` (`6c9f8ed`) lui-même. L'assertion calcule désormais la position à la
date du jour du serveur ; son intention est inchangée. Correction ratifiée par le CTO le
28 octobre.

## 8. Correspondance avec les tests exigés

| Exigence | Preuve |
|---|---|
| 1. administrateur sans second approbateur | 21 ; 90 § 1 (origine `ADMIN`, auteur = décideur) |
| 2. aucune auto-élévation, droits du dirigeant intouchables, aucune auto-désignation | 90 § 2 ; 11 ; 90 (identité : ni par l'API ni par la fonction opérateur) |
| 3. ancien `PARAM_*` sans autorité | 85 § 2 ; 90 § 3 |
| 4. identité, rôle, e-mail falsifiés | 90 § 4 (revendications, rôle global `admin`, identité inconnue, `service_role`, `anon`) |
| 5. révocation effective session ouverte | 90 § 5 ; courses 91–93b, 96–98 |
| 6. traces et immuabilité | 90 § 6 et identité (journal, ligne immuable) ; 11 ; 98 ; 99c |
| 7. aucune écriture financière module fermé | 90 § 1 ; 99c |
| 8. rejeu et concurrence | 90 § 8 ; courses 94–95, 95c–95d, 99a–99b |
| 9. conservation d'un domaine installé | 84–85 (scénario upgrade) |
| 10. contrôles financiers et garde de production inchangés | 85 (définitions identiques) ; scénario upgrade (41 complet avant migration) ; scénario fresh (30 à 80) ; test d'interface sur la garde |
| F1. aucun parcours non confirmable jusqu'à l'impression, identité fiable | § 4 |
| F2. aucune avance silencieuse de la version attendue | § 4 |
| F3. échec, chargement et vide distincts, reprise | § 4 |
| Circuit comptable (29 octobre) : le comptable prépare, imprime, enregistre la signature du dirigeant et confirme ; une seule émission, une seule allocation engagée | 90 « circuit » (échoue sur `fd860b1` à l'enregistrement de la signature, passe ici) |
| Le préparateur ne devient pas le signataire accepté ; l'impression seule ne vaut pas émission | 90 « circuit », « circuit_self » et « duo_self » (signataire admissible du compte, préparateur, refusé) ; 41 |
| Contrôles financiers et validations des sorties effectifs | 30 à 80 ; 90 (correction de date : auto-validation refusée, validation par un autre acteur) |

## 9. Revues indépendantes

### 9.1 Lot initial (`52b3dd0`)

Revue par un agent distinct, en lecture seule : aucun P1, deux P2, sept P3.

| Constat | Traitement |
|---|---|
| P2-1 — l'administrateur pourrait détacher puis rattacher autrement un préparateur après sa préparation | **corrigé** : rattachement figé tant que le chèque circule, sérialisé avec les préparations ; course 95a–95b |
| P2-2 — un administrateur rattaché contournerait « signataire ≠ préparateur » | traité alors par le refus de tout rattachement de l'administrateur ; **remplacé** par le correctif F1 : identité établie par l'opérateur, non réassignable par lui, et précontrôles |
| P3-1 — prises et levées forcées des verrous de traitement non sérialisées avec une révocation | **réserve** (§ 11) |
| P3-2 — mise à jour directe de l'autorité sans attente des écritures du sortant | **corrigé** (déclencheur) |
| P3-3 — commentaire inexact sur l'exposition de l'identité de l'administrateur | **corrigé** |
| P3-4 — propositions héritées de l'administrateur lui-même non closables | **réserve** (§ 11) |
| P3-5 — préparation par l'administrateur non confirmable | **remplacé** par le correctif F1 |
| P3-6 — couvertures manquantes | **ajoutées** |
| P3-7 — anciennes attributions explicites de l'administrateur figées pendant son mandat | **réserve** (§ 11) |

### 9.2 Correctif de contre-revue

Revue par un agent distinct, en lecture seule, reproduisant chaque P1 et P2 par
exécution, puis seconde vérification des corrections par le même agent.

| Constat | Traitement |
|---|---|
| P1-1 — l'administrateur rattaché mène seul un chèque jusqu'à l'émission avec une seconde personne qu'il déclare signataire | corrigé d'abord par un contrôle indépendant, puis **retiré sur arbitrage CTO du 29 octobre** : circuit comptable conservé, limite documentée (§ 11) |
| P1 résiduel — une même personne avec deux comptes, ou une personne alias contrôlée par un collègue de bonne foi | **arbitré par le CTO** : limite documentée (§ 11) |
| P2-1 — résultat réel d'une impression refusé après un paramètre changé, ou pour un préparateur hérité | **corrigé** : règle de cause (§ 3.3) ; 90 ; 85 |
| P2-2 — retaper la clé refondait le brouillon en silence | **corrigé** : référence propre à chaque paramètre visé ; modèle et interaction |
| P2-A (seconde vérification) — contrôle indépendant bloquant les corrections de date | **sans objet** depuis le retrait ; 90 garde la correction validée par un autre acteur |
| P2-B (seconde vérification) — incertain déclaré par le seul signataire, chèque perdu si retrouvé imprimé | **corrigé** : règle de cause appliquée à l'incertain ; 90 (incertain retrouvé imprimé puis confirmé) ; mutant tué |
| P3-1 — version périmée refusée par le serveur sans conflit affiché | **corrigé** : relecture et conflit ; interaction |
| P3-2 — précontrôle limité aux paramètres du jour | **réserve** (§ 11) |
| P3-3 — remplaçant demandé par le seul signataire non préparable | **réserve** (§ 11) ; message complété |
| P3-4 — première identité choisie au vu des signatures | **corrigé** : refusée dès qu'une signature est enregistrée ; 85 ; mutant tué |
| P3-5 — assertions de test vides, affichage des rattachements indisponibles | **corrigé** |
| N3 (seconde vérification) — règle de cause masquée par une cause passagère | **corrigé** : comparaison condition par condition ; 90 ; mutant tué |
| N4 (seconde vérification) — enregistreur d'une signature détaché avant la confirmation | **sans objet** depuis le retrait |

Constats sains confirmés : migrations appliquées identiques à `6c9f8ed` ; nouvelles
fonctions révoquées, chemin épinglé, aucun nouveau `SECURITY DEFINER` ; identité de
l'administrateur non réassignable ; précontrôles couvrant demande, assignation,
révision, ajustement, intention et résultat ; étape refusée sans aucune écriture ;
sérialisation des rattachements avec les préparations ; correctifs F2 et F3.

### 9.3 Retrait du contrôle indépendant (29 octobre)

Revue par un agent distinct, en lecture seule, sur le diff depuis `fd860b1`, avec un
rejeu complet et deux mutants qui lui sont propres. Verdict : **aucun P1 ni P2**,
cinq P3.

| Constat | Traitement |
|---|---|
| P3-1 — section 9.3 non rédigée | **corrigé** |
| P3-2 — § 2 promettant encore que l'administrateur ne s'auto-contrôle pas | **corrigé** : sens précisé (§ 2) |
| P3-3 — contrôle « signature postérieure à l'impression » attribué à la confirmation | **corrigé** (§ 3.4) |
| P3-4 — le précontrôle retiré vérifiait aussi qu'un confirmateur existe | **réserve** (§ 11) : conséquence du retrait ordonné |
| P3-5 — cas fort non couvert dans 90 : préparateur signataire admissible | **ajouté** : 90 « duo_self » |

Constats sains confirmés :
- retrait complet : aucune référence restante aux fonctions, déclencheurs et messages
  retirés ; liste blanche de 85 à jour ;
- rien d'autre retiré ni affaibli : règle de cause, précontrôles de rattachement et de
  signataire, première identité, figements, identité de l'administrateur, fonction de
  confirmation ;
- fichiers protégés sans diff par rapport à `6c9f8ed` ;
- tests nouveaux non vides ;
- preuve avant/après confirmée : la migration de `fd860b1` échoue sur le test
  « circuit », dans `check_cheque_controller`, à l'enregistrement de la signature.

## 10. Procédure future d'amorçage et de révocation (non exécutée)

Sous un GO d'environnement distinct, cible exacte vérifiée, module fermé :

1. **Identifier** le compte Auth existant du dirigeant par l'opérateur, sans créer de
   doublon ni déduire l'identité d'un nom ou d'une adresse. L'identifiant n'est jamais
   écrit dans le dépôt, un rapport public ou un prompt réutilisable. Vérifier qu'il ne
   détient aucune attribution explicite et relever son rattachement éventuel.
2. **Appliquer** la migration `20261028090000` par le canal ciblé validé, avec relevé
   avant/après.
3. **Désigner** : `SELECT payables_private.set_module_admin(NULL, '<uuid du dirigeant>', '<motif de 8 à 240 caractères>');`
4. **Identité** :
   - le dirigeant crée depuis l'interface la personne qui le représente ;
   - l'opérateur vérifie qu'elle le désigne bien, puis :
     `SELECT payables_private.set_module_admin_identity('<uuid du dirigeant>', '<uuid de la personne>', true, '<motif>');`
   - si le compte était déjà rattaché, l'opérateur vérifie cette identité ; si elle est
     erronée, il la retire avec la même fonction (`false`) avant d'établir la bonne.
5. **Vérifier** :
   - l'autorité est égale à l'identifiant attendu ;
   - `admin_authority_events` et le journal portent `ADMIN_AUTHORITY_CHANGED` et
     `ADMIN_IDENTITY_LINKED` ;
   - `payables_my_access_v1` rend `person_id` pour le dirigeant ;
   - l'interrupteur est toujours fermé.
6. **Administrer** depuis l'interface, module fermé : rattachements des comptables,
   habilitations, signataire (sa propre personne, justificatif de pouvoirs) et règle par
   compte, catégories, profil ORABANK.
7. **Retrait d'urgence** : `SELECT payables_private.set_module_admin('<uuid actuel>', NULL, '<motif>');`
   Effet au prochain appel ; l'identité reste en place.
8. **Remplacement** : `set_module_admin('<uuid actuel>', '<uuid successeur>', '<motif>')`,
   puis étape 4 pour le successeur.
9. **Révocation d'un comptable** : par l'administrateur, depuis l'interface ; effet
   serveur immédiat.

## 11. Réserves et étapes restantes

- **GO distincts** : désignation de l'administrateur, établissement de son identité,
  attribution des droits et paramétrage, après identification du compte existant du
  dirigeant. Les observations du 27 octobre 2026 transmises par le CTO n'ont **pas** été
  relues par ces lots : migrations installées en production, module fermé, aucun droit ni
  paramètre, aucun utilisateur sous les trois adresses communiquées, compte ORABANK
  courant actif en XOF au registre.
- **Limite documentée (arbitrage CTO du 29 octobre) — confiance dans les identités
  administrées.**
  - L'administrateur reste responsable des identités, habilitations et pouvoirs
    déclarés ; justificatifs et décisions sont tracés.
  - L'application en contrôle la cohérence sans prétendre certifier l'identité physique.
  - Ne sont donc pas traités par l'application :
    - un second compte d'une même personne, par exemple ouvert par l'inscription libre
      puis rattaché et habilité par l'administrateur ;
    - un signataire fictif ou alias déclaré par l'administrateur ;
    - une signature enregistrée au nom d'une autre personne que le signataire réel.
  - Aucun second valideur administratif, aucune attestation systématique par
    l'opérateur et aucune modification globale d'Auth ne sont introduits pour ces
    scénarios.
  - Contrôles qui demeurent : le journal et les paramètres tracés, les justificatifs de
    pouvoirs, et la vérification de la signature par la banque.
- **Précontrôles** :
  - ils utilisent les paramètres en vigueur le jour de l'étape. Un changement ultérieur
    de paramètre (signataire révoqué, plafond abaissé, règle durcie) peut encore rendre
    une formule déjà imprimée non confirmable : c'est une évolution métier, toujours
    refusée à la confirmation et traitée par la voie d'exception existante ;
  - le remplaçant créé par une sortie validée n'est contrôlé qu'à l'assignation de sa
    formule, pour ne pas toucher la validation de la sortie. Si la sortie a été demandée
    par le seul signataire du compte, le remplaçant ne pourra pas être préparé
    normalement : il s'abandonne et un comptable fait une nouvelle demande. C'est la
    définition existante du préparateur (auteur de la demande) ;
  - un signataire valable seulement à partir d'une date future ne permet pas de préparer
    avant cette date (précontrôle aux paramètres du jour) ;
  - un chèque hérité déjà signé et préparé par un compte jamais rattaché ne reçoit pas
    de première identité. Il sort par la formule déclarée inutilisée ou par la voie
    d'exception ;
  - les précontrôles ne vérifient plus qu'un compte habilité à confirmer existe. Ce
    contrôle faisait partie de la règle retirée sur ordre du CTO. Exemple : si
    l'autorité de l'administrateur est retirée, ses droits implicites cessent ; si
    l'interrupteur métier est ouvert et qu'aucun compte ne détient explicitement
    `CHEQUE_CONFIRM_ISSUE`, un chèque peut être préparé et imprimé, puis attendre qu'un
    administrateur attribue ce droit.
- **Ancienne gouvernance** :
  - ses fonctions restent exécutables et refusent toujours ; une suppression ultérieure
    demanderait une migration dédiée ;
  - les propositions héritées dont l'administrateur est l'auteur restent en attente,
    sans effet ;
  - les attributions explicites qu'il détenait avant sa désignation restent figées
    pendant son mandat.

  Ces cas n'existent qu'avec des données de l'ancienne gouvernance, pas en production
  vierge.
- **Verrous de traitement** : leurs prises et levées forcées ne sont pas sérialisées avec
  une révocation. C'est un confort d'équipe, sans effet sur l'intégrité.
- **GO distincts également** : garde de production, staging, production et ouverture du
  module.
