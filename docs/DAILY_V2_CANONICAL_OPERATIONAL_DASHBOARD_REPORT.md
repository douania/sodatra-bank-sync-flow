# Daily v2 — Dashboard opérationnel canonical

## Qualification du pack

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

## Validations

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

## Sécurité et limites

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

## Contre-review indépendante

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

## Statut

`IN_PROGRESS — IMPLEMENTED_LOCAL — REVIEWED_WITH_RESERVES — NOT_DEPLOYED`.

Fusion soumise au GO de merge et au contrôle du SHA exact/CI ; validation
staging et publication restent des phases distinctes, non exécutées ici.
