# Daily v2 — Dashboard opérationnel canonical

> Statut opérationnel au 2026-08-31 (Europe/Paris) :
> `CLOSED_WITH_RESERVE — PRODUCTION_DASHBOARD_READ_ONLY_VALIDATED — ORA_PILOT_SCOPE`.
> PR #139 fusionnée, runtime publié et contrôlé sous GO distincts. La clôture
> documentaire reste soumise à sa propre review/PR ; ce statut ne vaut pas merge
> de cette clôture ni qualification production générale de l'application.
>
> Les sections jusqu'au « Statut historique » conservent le dossier local
> antérieur au merge. Leurs mentions « non publié », « aucun SQL/live » et leurs
> verdicts locaux décrivent cette phase uniquement. Les preuves ultérieures et
> les réserves actuelles figurent dans « Clôture production » ci-dessous.

## Qualification du pack local — historique

- GO : `GO_IMPLEMENT_DAILY_V2_CANONICAL_OPERATIONAL_DASHBOARD`.
- Base vérifiée : `2d700ed76dc6fe15c742f76951446768f7b5032d` (PR #138 fusionnée).
- Branche : `codex/daily-v2-canonical-operational-dashboard` ; préflight propre.
- Niveau : très approfondi pour calculs financiers/read gate, sans modification
  Auth/RLS, schéma, SQL, migrations, imports ou commandes d'écriture.
- Périmètre : `src/pages/Dashboard.tsx`, nouveaux modules/tests sous
  `src/features/daily-v2/dashboard/`, ajout du test à `.github/workflows/ci.yml`,
  ce rapport, `docs/MASTER_CONTEXT.md`, `docs/STATUS_REGISTRY.md`.
- Package/lockfiles, services legacy, services de reporting existants et toute
  autre surface de sécurité restent inchangés. Aucun accès staging/production,
  aucun fichier bancaire réel, aucun déploiement ni merge autorisé.

## Contrat métier retenu

Le dashboard affiche par défaut une vue Daily v2 distincte des indicateurs
historiques, qui restent consultables sur sélection explicite sans addition
avec le canonical. Les rôles de reporting existants sont conservés : admin ou
auditor ; aucune ouverture pour manager/user, aucune modification de RLS.

Une lecture canonical bornée unique réutilise le service snapshot/epoch :
400 jours inclusifs jusqu'à la date de situation, plafond 5 000 unités,
filtres banque/devise facultatifs. Les comptes absents de cette fenêtre ne
peuvent pas être recensés : la couverture est celle des comptes observés, pas
l'exhaustivité SODATRA. La date de calcul est distincte de la date du relevé.

Le dernier relevé de chaque compte/devise détermine la position, jamais la
somme de ses soldes historiques. Un dernier solde absent/à revoir/non dérivé
est indisponible, sans repli silencieux sur un ancien solde. La fraîcheur est
l'écart calendaire exact à la date de situation, pas une promesse temps réel.
Les alias représentent des identités canonical : deux empreintes peuvent
désigner un même compte physique. Aucun total de soldes par devise n'est donc
calculé. Les flux ne concernent que les journées canonical observées de la période sélectionnée,
sans dédoublonnage entre identités physiques non réconciliées ; cette limite
figure également dans la vue. La couverture par devise est exprimée en
journées-compte observées/possibles, pas en exhaustivité bancaire.
Une période sans relevé n'est pas assimilée à zéro mouvement ; aucune devise
n'est convertie ou fusionnée avec une autre. Les sommes restent en bigint.

Les données brutes restent dans l'orchestration ; seul un résultat agrégé par
alias du reporting atteint React, en mémoire uniquement. Aucun cache financier persistant, log, export ou RPC
mutative. Erreur, filtre modifié, perte d'accès et réponse obsolète effacent
ou refusent le résultat précédent.

## Validations locales — historique

Baselines mesurées avant patch au commit de base exact avec les dépendances
locales existantes, sans installation, suppression ou déplacement de caches.
Le working tree était propre et sa tree identique à la base avant création
de branche ; aucun worktree baseline jetable n'a été nécessaire.

| Contrôle local | Résultat |
|---|---|
| ESLint, API `ESLint.lintFiles(['.'])` (même configuration que `eslint .`) | 180 erreurs / 11 warnings avant et après ; zéro diagnostic ajouté ou supprimé, décalage d'une ligne du diagnostic historique de `Dashboard.tsx` normalisé |
| `tsc -p tsconfig.app.json --noEmit --pretty false` | 17 erreurs préexistantes ; sortie après patch strictement identique à la baseline, aucune nouvelle erreur |
| Suites `test:daily-v2-application` + `test:daily-v2-reporting` | 176 PASS sur la base et après patch |
| `tsx --test src/features/daily-v2/dashboard/*.synthetic.test.ts src/features/daily-v2/dashboard/*.synthetic.test.tsx` | 33 PASS après corrections, zéro FAIL/SKIP ; commande ajoutée à la CI sans toucher package/lockfiles |
| Suites ci-dessus + `src/config/productionLogHygiene.synthetic.test.ts` | 213 PASS après corrections (176 + 33 + 4), zéro FAIL/SKIP, y compris absence de console/debugger dans les assets générés |
| `node node_modules/vite/bin/vite.js build` (commande du script build) | PASS ; warnings de taille de bundle et imports statiques/dynamiques, aucune affirmation de baseline build sur ces warnings |
| `git diff --check` et `git diff --cached --check` | PASS après corrections |

Les CLI locaux utilisent le Node fourni par l'environnement : `npm` n'est
pas disponible dans le PATH de cette session. Les tests et le build ont été
exécutés directement avec les mêmes exécutables locaux, sans installation.

### Vérification interactive locale

Harness Vite temporaire sur loopback uniquement, sans fichier d'environnement,
sans import du client Auth/Supabase ; fixtures entièrement synthétiques et
CSP limitée au serveur local. Il monte les vrais Panel/View/controller/modèle
du pack, avec lecteur et accès simulés. Vérifiés : positions et devises
distinctes, compte sans solde exploitable, relevés anciens, effacement immédiat
après filtre banque, résultat vide, erreur générique, réponse retardée après
changement de filtre, perte/restauration d'accès et rendu visuel desktop.
Après corrections : rendu filtré BDK, absence du total de soldes par devise,
couverture par devise et refus interactif explicite du filtre `BDK-1` vérifiés.
Le serveur de test a été arrêté après ces contrôles ; aucun processus auxiliaire
de ce pack n'est laissé en service. Aucun cache déplacé ou supprimé.

La saisie native des dates n'a pas pu être validée de façon concluante par
l'automatisation navigateur ; les dates invalides/inversées et bornes sont
couvertes par les tests automatisés du modèle. Ce harness n'est ni un test
Auth/JWT réel, ni une preuve staging/production, ni un E2E des sources legacy.

## Fichiers du pack

- `src/pages/Dashboard.tsx` : sélection exclusive Daily v2/historique ; aucune
  exécution des lectures legacy dans la vue canonical, aucun fallback. Le titre
  legacy devient « Indicateurs historiques » et sa date est libellée date de
  consultation, pas date des relevés ; les calculs legacy sont inchangés.
- `src/features/daily-v2/dashboard/dailyV2DashboardModel.ts` : validation,
  calculs exacts, couverture, derniers relevés et DTO sans identifiants bruts.
- `src/features/daily-v2/dashboard/dailyV2DashboardRead.ts` : orchestration
  pure, vérification de rôles fraîche avant la lecture.
- `src/features/daily-v2/dashboard/dailyV2DashboardService.ts` : adaptation
  des services de lecture existants, inchangés.
- `src/features/daily-v2/dashboard/dailyV2DashboardController.ts` : effacement
  des résultats et rejet des réponses obsolètes.
- `src/features/daily-v2/dashboard/DailyV2OperationalDashboard.tsx` : gate
  session/cible/rôles, démontage pendant refus et clé utilisateur.
- `src/features/daily-v2/dashboard/DailyV2DashboardPanel.tsx` : formulaire et
  cycle de vie du contrôleur, consultation sans commande d'écriture.
- `src/features/daily-v2/dashboard/DailyV2DashboardView.tsx` : synthèses par
  devise, tableau par compte, dates et avertissements de couverture.
- `src/features/daily-v2/dashboard/dailyV2Dashboard.synthetic.test.ts` et
  `DailyV2DashboardView.synthetic.test.tsx` : modèle, lecture, concurrence,
  gates, rendu SSR et contrats de raccordement.
- `.github/workflows/ci.yml` : exécution des nouveaux tests.
- Ce rapport, `docs/MASTER_CONTEXT.md`, `docs/STATUS_REGISTRY.md` : état local
  distinct de l'état actuellement publié.

Diff du pack : 14 fichiers, dont 10 créés et 4 modifiés ; aucune suppression
de fichier. Les seuls changements du legacy sont son enveloppe de sélection,
son nom local et les libellés annoncés, pas ses calculs.

## Sécurité et limites du pack local — historique

Secrets, fichiers/données bancaires réels, SQL, Supabase live, migration,
modification Auth/RLS, écriture métier, publication et merge : **NON**.
Le rôle manager/user ne reçoit pas de droit de reporting supplémentaire.
Le dashboard ne débloque aucun verrou ; les lectures restent possibles avec
les écritures fermées. L'artefact MCP et les fichiers d'environnement restent
hors diff. Aucun fichier bancaire temporaire créé pendant ce pack.

Limites assumées : identités observées sur 400 jours et 5 000 unités maximum
(12 comptes à 400 jours complets tiennent, 13 dépassent le plafond) ;
pas d'inventaire exhaustif, pas de garantie de solde à date commune, pas de
conversion de devises, pas de rapprochement transactionnel supplémentaire.
La fenêtre de positions est fixe : raccourcir les flux ne réduit pas le volume
lu. Il faut filtrer banque/devise ; si une seule partition dépasse le plafond,
la vue reste refusée, sans pagination partielle ni contournement de la limite.
Les paramètres soumis seuls sont conservés par utilisateur pendant un refetch de
rôles ; le résultat financier est démonté puis recalculé avec les droits frais.
Le serveur et le reader existants restent responsables de la sélection des
unités canonical actives et du snapshot cohérent. Un refus du reader bloque
toute la vue. Dette lint/typecheck et taille du bundle restent hors périmètre.

## Contre-review indépendante du pack local — historique

Premier avis Claude Code (Opus, read-only) : `RESERVES`, avec 2 P1 et 11 P2.
Les P1 n'ont pas été acceptés comme état de livraison. Aucun patch par Claude.
Limite de sa première session : les commandes `git -C ...` ont été refusées
par l'allowlist (seules les formes sans `-C` étaient admises). La review portait
sur les contenus locaux, pas sur le diff Git. Cette limite doit être levée par
la revalidation ; ce premier avis seul ne certifie pas le périmètre.

### Réconciliation CTO dans le pack

| Finding | Traitement |
|---|---|
| P1-A, somme de positions d'identités potentiellement identiques physiquement | Retrait du total de soldes par devise, du DTO et du rendu ; positions individuelles conservées, distinction identité/compte physique explicite ; test des deux identités historiques |
| P1-B, plafond 400 jours × 5 000 unités | Refus `volume` dédié, consigne banque/devise exacte, absence d'effet du filtre flux explicitée ; limites chiffrées ci-dessus, test exactement 5 000 et refus 5 001 |
| P2-1, backlog MASTER contradictoire | Alignement de la ligne backlog sur l'implémentation locale non déployée |
| P2-2, refus génériques | Classification fermée filters/volume/access/concurrent/generic ; aucun message serveur ni code arbitraire exposé |
| P2-3, couverture par devise | Numérateur/dénominateur en journées-compte dans DTO et cartes ; tests calcul et rendu |
| P2-4, filtres perdus sur refetch rôles | Sauvegarde des seuls paramètres soumis dans le parent, liée à user.id ; le démontage financier fail-closed est conservé. Les brouillons non soumis ne déclenchent pas de lecture après refetch |
| P2-5, composants testés seulement statiquement | Résolution composite d'accès exécutée en matrice ; vrai Panel monté en SSR, avec générateur injecté et preuve zéro lecture en SSR. Limite conservée : pas de test automatisé DOM du hook Auth réel/refetch, pas d'E2E réseau |
| P2-6, regex fragiles | Retrait des assertions dépendant de la mise en forme du ternaire/useState. Quelques contrats statiques de raccordement et absence de mutation restent intentionnels, en complément des tests comportementaux ; aucun export hors scope ajouté pour les contourner |
| P2-7, commande CI sans script package | Non retenu comme violation : ajout explicitement autorisé dans la CI, package/lockfiles explicitement exclus ; précédent identique pour productionLogHygiene dans cette CI. Pas de nouveau script test:* hors package ; aucune modification package autorisée |
| P2-8, constante de fenêtre couplée | Constante locale dédiée 400 jours, refus si elle dépasse la capacité du reader ; pas de réduction silencieuse de couverture |
| P2-9, libellé ambigu de somme de soldes | Supprimé avec le total de soldes par devise |
| P2-10, date par défaut UTC non annoncée | Libellé de formulaire « UTC par défaut » ; date de consultation toujours distincte des dates comptables |
| P2-11, canonical par défaut pour manager/user | Choix du contrat maintenu, aucune ouverture de droit ; message de refus indique le bouton de consultation historique distincte. Pas de fallback automatique |

Correctif défensif supplémentaire : refus des dates source avec espaces ou
retour final (reproduction avant patch : ancienneté `NaN`). Les dates source
doivent faire exactement dix caractères ; tests ajoutés. Trous de test alias
invalide, débit négatif, volume exact 5 000 et date de situation future couverts.
Une date future n'invente aucune prévision : les derniers relevés et leur âge
réel restent affichés.

Deuxième avis Claude : `PASS_WITH_RESERVES`, 0 P0/0 P1, 4 P2 (A/B nouveaux,
C/D résiduels). Préflight et périmètre désormais certifiés par ses lectures
Git : base exacte, 14 fichiers stagés seulement, CI +1 ligne, legacy sans
changement de calcul. Les deux P1 sont explicitement levés.

- P2-A : mise à jour fonctionnelle de l'input rétablie ; aucun callback parent
  dans un updater React.
- P2-B : seul `onSubmit` transmet les paramètres au parent ; une frappe non
  soumise ne peut plus être relue automatiquement après refetch. L'UI annonce
  le rétablissement possible des derniers filtres soumis.
- P2-C : réserve de couverture Auth/hooks réels maintenue, déjà documentée ;
  matrice pure/SSR/harness synthétique ne remplacent pas un futur E2E staging.
- P2-D : suppression du test regex de formatage sur le service Supabase hors
  scope ; son contrat reste couvert par les suites reporting existantes.

Dernière revalidation Claude Code : **`PASS_WITH_RESERVES — 0 P0 / 0 P1 /
1 P2`**. P2-A, P2-B et P2-D explicitement levés ; reste uniquement P2-C,
couverture Auth/hooks/DB réels, acceptée par le CTO pour la livraison locale
en draft, non pour valider un environnement.

La revalidation a comparé les trees index immuables
`4c00012e35ffe9a6f32df4b6865a664d2dd3072f` et
`96e81c999b61c7686392e4697ed78234b5d121cc`, confirmé HEAD/origin/main,
14 fichiers stagés et zéro autre changement. Le domaine financier est resté
bit-à-bit inchangé entre ces deux revues. Après ce verdict, seuls les trois
documents de suivi ont été actualisés pour consigner la clôture de review.

Verdict CTO : **PASS_WITH_RESERVES pour commit/push/draft PR uniquement**.
Les 213 tests, le build et les comparaisons lint/typecheck ont été rejoués après
le dernier correctif ; aucune nouvelle erreur. Le reviewer n'a pas exécuté
ces commandes, conformément à son mandat strictement read-only.

## Statut historique avant merge

`IN_PROGRESS — IMPLEMENTED_LOCAL — REVIEWED_WITH_RESERVES — NOT_DEPLOYED`.

Fusion soumise au GO de merge et au contrôle du SHA exact/CI ; validation
staging et publication restent des phases distinctes, non exécutées ici.

## Clôture production — 2026-08-31 Europe/Paris

### Mandat documentaire et provenance

GO : `GO_IMPLEMENT_DAILY_V2_CANONICAL_OPERATIONAL_DASHBOARD_PRODUCTION_CLOSURE_DOCUMENTATION`.
Base de cette clôture : `c85e715b59be76fbcffb57c07b32de453e4cb63b` ; branche
`codex/daily-v2-canonical-dashboard-production-closure`. Au préflight, la
branche d'implémentation était propre à `1c60a820782dfef6112ab370c644b2203b5eab56`,
avec une tree identique à `origin/main`, puis la branche documentaire a été
créée depuis ce `origin/main` vérifié.

Périmètre fermé : ce rapport, `docs/MASTER_CONTEXT.md`, `docs/STATUS_REGISTRY.md`.
Niveau moyen, docs-only. Aucun changement applicatif, package/lockfile, `.env`,
artefact MCP, migration ou configuration de sécurité. Aucun accès Lovable,
Supabase, navigateur ou SQL n'est réalisé par cette clôture. Les résultats
ci-dessous proviennent des retours GitHub, Lovable, HTTP, navigateur et SELECT
des GO antérieurs de cette conversation (2026-08-30 UTC, nuit du 30 au 31 à Paris),
pas d'une nouvelle campagne ni d'une nouvelle contre-review indépendante.

Les identifiants et empreintes ci-dessous permettent de rattacher les constats
à leurs versions. Ce compte rendu ne remplace pas une capture réseau exhaustive :
aucun HAR, dump, capture bancaire ou journal brut n'est ajouté au dépôt. Les
valeurs financières ont été comparées en mémoire pendant le smoke, sans être
reproduites ici. Aucun fichier bancaire source n'a été relu pour cette clôture.

### Références de livraison

- [PR #139](https://github.com/douania/sodatra-bank-sync-flow/pull/139), head
  `1c60a820782dfef6112ab370c644b2203b5eab56`, fusionnée le
  `2026-08-30T21:24:19Z` ; merge/source production
  `c85e715b59be76fbcffb57c07b32de453e4cb63b`.
- [CI post-merge 33336340850](https://github.com/douania/sodatra-bank-sync-flow/actions/runs/33336340850) :
  `completed/success` sur ce merge. Les 213 tests et baselines décrits plus haut
  appartiennent au pack d'implémentation ; ils ne sont pas annoncés comme rejoués
  par cette clôture documentaire.
- Staging : Lovable `8c508b94-d03f-4165-ab2b-7a3cd52d2d2b`, Supabase
  `gbbsqcscryygqlmqncyv`, [build publié](https://cash-sync-wiz.lovable.app),
  source synchronisée `46478b65be8c42dbe181360d0c0448fd696b2b4c`.
- Production : Lovable `e52d9fce-f1b4-46f8-900c-c559a6eb2115`, Supabase
  `leakcdbbawzysfqyqsnr`, [dashboard publié](https://sodatra-bank-sync-flow.lovable.app/dashboard).
  Les dix fichiers runtime/tests du dashboard ont été comparés, avec
  normalisation LF, entre le candidat production et la source validée staging :
  dix correspondances exactes. Aucun delta de migration, Auth/RLS ou reader
  snapshot existant dans cette livraison.

| Publication | Déploiement accepté | Bundle observé | SHA-256 du contenu JS réencodé UTF-8 |
|---|---|---|---|
| Staging, build production | `2fde9c3b-8935-44b5-979f-f723204ac676` | `index-D0x4DovO.js` | `1f9fbbddfa8c4120273bf9141d37b4318b7e93a68cb47a8f0f34ed04668d2b59` |
| Production | `8612d3f7-c62e-4e99-a6eb-e30815dd511c` | `index-agrhGBVY.js` | `d4e09f1edd8cf3b6d34ea8421c87079fd8cc198fd8790c7dc30c6519e65451c4` |

Le connecteur a répondu `pending` aux publications : ce statut n'est pas
présenté comme un retour final `succeeded`. La disponibilité a été constatée
par HTTP 200 sur le HTML et le nouveau JS, leurs références/empreintes et les
marqueurs du dashboard, puis par les smokes UI. La production servait auparavant
`index-C4s2fvfW.js`, sans le dashboard canonical. Le nouveau bundle contient
l'URL Supabase production, pas l'URL staging, et la clé frontend publique
moderne attendue ; aucune valeur de clé n'est reproduite. La source et `.env`
sont restés inchangés lors de la publication. Les recherches statiques ont
trouvé zéro appel direct `console.*(...)` et zéro `debugger` ; ce n'est pas une
preuve générale de l'absence de toute télémétrie.

### Phases autorisées et résultats

Les suffixes ci-dessous complètent les GO du pack
`DAILY_V2_CANONICAL_OPERATIONAL_DASHBOARD` ; chaque phase a reçu son GO propre.

| GO / phase | Résultat établi |
|---|---|
| `GO_VALIDATE_STAGING_<PACK>_PREFLIGHT_READ_ONLY` | Préflight staging préalable à la synchronisation ; aucune autorisation production implicite. |
| `GO_APPLY_STAGING_<PACK>_RUNTIME_SYNC` | Dix fichiers runtime/tests synchronisés sur `46478b6`, sans modification de configuration, DB ou services existants. |
| `GO_VALIDATE_STAGING_<PACK>_RUNTIME_E2E_READ_ONLY` | Preview authentifié : vue canonical, filtres, refus sûrs, legacy séparé et verrous contrôlés ; ne prouve pas le build publié. |
| `GO_APPLY_STAGING_<PACK>_PRODUCTION_BUILD_PUBLISH` | Build production publié sur le staging uniquement, référence ci-dessus. |
| `GO_VALIDATE_STAGING_<PACK>_PRODUCTION_RUNTIME_E2E_READ_ONLY` | `PASS_WITH_RESERVES` : 7 identités, 50 journées actives dans la fenêtre, 3 positions exploitables ; filtre BDK/XOF à 2 lignes ; vide/invalide et séparation legacy validés ; compteurs inchangés. Dates non qualifiées à cette étape, legacy vide. |
| `GO_PRODUCTION_<PACK>_PREFLIGHT_READ_ONLY` | Source/CI/cible vérifiées ; contrat de lecture canonical présent (15 colonnes requises), RLS active, SELECT anonyme fermé, policy SELECT authenticated limitée à admin/auditor ; quatre verrous fermés. Aucune migration nécessaire. |
| `GO_PRODUCTION_<PACK>_PUBLISH_RUNTIME` | Nouveau bundle effectivement servi ; aucune action DB ni modification des droits ou verrous pendant cette phase. |
| `GO_PRODUCTION_<PACK>_POST_PUBLISH_SMOKE_READ_ONLY` | `PASS_PUBLIC_SMOKE` : `/dashboard` et `/daily-statements` redirigent vers `/auth` sans session ; aucune donnée affichée. GET sans JWT utilisateur sur unités canonical, lignes canonical et `user_roles` : HTTP 401, code `42501` dans les trois cas ; clé publique conforme au bundle. |
| `GO_PRODUCTION_<PACK>_AUTHENTICATED_SMOKE_READ_ONLY` | `PASS_WITH_RESERVES` dans Chrome avec une session existante ; détail des assertions et réserves ci-dessous. Aucune saisie/récupération de credentials. |

Le connecteur de requêtes DB Lovable a refusé la base externe
(`database_not_managed`). Les SELECT ont été exécutés dans la console Supabase
du projet exact, sans provisionnement ni modification de connexion. Les droits
SQL de cette console ne constituent pas à eux seuls une preuve du transport
Auth utilisateur : les smokes navigateur et les refus REST sont des preuves
distinctes. La divergence de ledger staging/production n'a pas été « réparée »
par ce pack, qui n'ajoute aucune migration.

### Smoke authentifié : assertions réellement exercées

- Vue canonical par défaut : une identité ORABANK/XOF, trois journées, quatre
  lignes. Date du dernier relevé, dernier solde, débits, crédits et flux net
  correspondent aux agrégats SELECT indépendants ; la synthèse XOF correspond
  au tableau. Aucun montant, empreinte de compte ou identifiant de ligne ici.
- Filtre ORA/XOF : une ligne. BDK : résultat vide malgré les unités BDK en
  staging métier, sans inclusion des journées non promues. USD : résultat vide,
  sans conversion ni substitution. Le vide n'est pas présenté comme un solde nul.
- Modification d'un filtre : résultat précédent effacé ; banque invalide
  `ORA-1` refusée sans ancien tableau ni total partiel.
- Dates : période du 13 au 20 août, 2/8 journées observées, les trois journées
  source restant dans la fenêtre de positions. Période inversée et période
  dépassant 400 jours refusées sans ancien résultat. La saisie automatisée seule
  modifiait le champ visible sans invalider React ; les événements clavier
  natifs ont ensuite déclenché l'invalidation et les résultats attendus.
  Cette vérification production lève la réserve de saisie pour ces scénarios
  dans Chrome, sans transformer rétroactivement les essais staging en PASS.
- Vue historique peuplée, explicitement séparée ; retour canonical avec les
  mêmes cellules financières. Ceci ne valide pas tous les calculs legacy.
- Navigation vers Daily v2 : « Pilote production verrouillé » et « Verrou serveur :
  lecture seule », aucune commande de dépôt/promotion/supersede/activation.
  Le sélecteur parse-only peut rester disponible ; aucun fichier n'a été chargé.
- Aucun UUID brut ou champ `account_fingerprint` dans le tableau contrôlé ;
  aucun total de soldes par devise. Aucun log console remonté aux points
  contrôlés, sans prétendre disposer d'une capture réseau exhaustive.
- Vue par défaut et session restaurées en fin de test ; cellules financières,
  compteurs et contrat de lecture inchangés.

### Conservation constatée avant/après

En production, préflight, smoke public et smoke authentifié retrouvent les
quatre verrous `master/daily/admin/backfill = false`, RLS canonical active,
SELECT anonyme fermé et policy de lecture admin/auditor inchangée.

| Compteur production | Avant/après |
|---|---:|
| Ledger migrations | 40 (dernière `20260829120000`) |
| Événements runtime control | 12 |
| Tentatives d'import | 2 |
| Unités / lignes staging métier | 5 / 45 |
| Unités / lignes canonical | 3 / 4 |
| Événements d'import / de comptes | 10 / 6 |
| Registre de comptes / grants backfill | 6 / 0 |

En staging, les compteurs mesurés avant/après l'E2E du build publié étaient
également inchangés : ledger 43, audit runtime 20, tentatives 15, unités staging
65, unités canonical 51, événements d'import 227 ; les 50 journées actives de
la fenêtre ne sont pas le total de 51 unités canonical tous statuts.

Ces contrôles portent sur les compteurs et métadonnées énumérés, pas sur une
empreinte intégrale de toutes les lignes de la DB. Leur stabilité ne prouve
pas à elle seule l'absence de toute requête réseau ou modification compensée.
Les actions effectuées dans ces smokes étaient des lectures ; aucun import,
promotion, export, supersede, déverrouillage, migration ou changement Auth/RLS.

### Réserves et suivi après clôture

Verdict opérationnel : **PASS_WITH_RESERVES**, limité au dashboard read-only
et au pilote ORABANK. La réserve locale Auth/DB est partiellement levée par les
lectures authentifiées et leur corroboration SQL, pas intégralement fermée.

1. Badge Daily v2 « Session requise » encore visible malgré la session et les
   lectures réussies : défaut d'affichage connu, non corrigé ici ; futur GO UI.
2. Matrice réelle multi-rôles, révocation, refetch des droits avec brouillon et
   lectures concurrentes non exercés. Les tests synthétiques ne les remplacent
   pas ; futur lot de validation dédié, sans ouverture implicite des écritures.
3. Une identité ORABANK/XOF seulement qualifiée financièrement en production ;
   autres banques, plusieurs devises renseignées et volumes limites non qualifiés
   par ce smoke. Aucun feu vert pour de nouveaux imports ni pour `/upload`.
4. Affichage/séparation legacy vérifiés, pas audit exhaustif Collection Report,
   Fund Position ou autres calculs historiques ; pas de capture réseau exhaustive.

Le produit reste un prototype avancé, pas une certification globale du dashboard
Direction, de l'exhaustivité SODATRA ou de l'application. Le traitement de ces
réserves exige son propre périmètre/GO ; aucun rollback de données n'est demandé.

### Validation et livraison de cette clôture

Validation docs-only : périmètre exact de trois fichiers confirmé,
`git diff --check` et `git diff --cached --check` PASS, références de livraison
contrôlées et diff relu avant commit. Recherche de motifs de clés/JWT/chemins
locaux/alias de compte dans les ajouts : aucun résultat ; ce contrôle textuel
ne remplace pas la relecture. Aucun test applicatif, build, installation ou
mesure de baseline exécuté localement dans cette clôture. La CI automatique de
sa draft PR est distincte des preuves locales et CI du pack d'implémentation.
Aucun secret, fichier bancaire, montant ni donnée de compte
ajouté. Commit/push/draft PR autorisés par le GO ; aucun merge ni déploiement.
La contre-review documentaire de cette clôture reste à effectuer avant le GO
de merge ; le verdict Claude historique ne constitue pas cette review.
