# Daily v2 — Pilote d'activation contrôlée en production

## Statut

`IMPLEMENTED_LOCAL — INDEPENDENT_REVIEW_PASS — MERGE_READY — MIGRATION_NOT_APPLIED — PRODUCTION_LOCK_UNCHANGED`
— 2026-08-30.

Ce lot prépare le premier pilote mutatif Daily v2 en production, côté client et
côté serveur. La migration candidate ajoute trois scopes privés audités
(`daily`, `admin`, `backfill`) sous le kill switch maître existant et protège les
huit RPC mutatives publiques. Elle n'a été appliquée à aucun environnement :
aucun runtime n'est publié, aucun Supabase live n'est accédé et le verrou
production reste inchangé. La production reste donc effectivement en lecture
seule.

## Périmètre du premier pilote

Le pilote est volontairement plus étroit que le parcours complet disponible en
staging :

- relevés structurés quotidiens uniquement, dans la limite existante de 45 jours ;
- CSV BDK/ORA et Excel ONLINE ATB/BICIS/BIS/BRIDGE déjà caractérisés ;
- compte actif déjà présent dans le registre Daily v2 ;
- préparation et dépôt : rôles `admin` ou `manager` ;
- promotion et supersede : rôle `admin` ;
- consultation canonical/audit/reporting : règles de rôles existantes ;
- administration du registre et backfill BIS destinés à rester hors du pilote
  production.

La politique statique de cible rend la production éligible à `read`, `deposit`
et `promote`, jamais à `admin`. L'option backfill et les commandes de gestion du
registre/grant ne sont pas rendues dans l'interface. La migration candidate
porte désormais la même frontière côté serveur :

- `daily` : dépôt `requested_mode=daily`, promotion et supersede ;
- `admin` : provisionnement, désactivation et adoption historique ;
- `backfill` : émission/révocation de grant et dépôt
  `requested_mode=backfill`.

Les huit implémentations existantes deviennent des cœurs sans `EXECUTE` pour
`PUBLIC`, `anon`, `authenticated` et `service_role`. Seuls leurs wrappers
publics restent exécutables par `authenticated` et vérifient leur scope avant
toute délégation métier.

## Barrières cumulatives

Une opération mutative exige simultanément :

1. l'identité exacte du projet Supabase production canonique ;
2. une capacité statique connue et explicitement autorisée ;
3. une session Auth valide ;
4. le rôle métier attendu ;
5. une réponse explicite `true` du kill switch PostgreSQL privé ;
6. une réponse explicite `true` du scope serveur de la RPC ;
7. l'autorisation `EXECUTE` du wrapper et les contrôles de rôle métier ;
8. les invariants atomiques, d'idempotence, de concurrence et d'audit Daily v2.

Une cible inconnue, une contradiction URL/project ref, une capacité inconnue,
une erreur de lecture du verrou, une réponse absente/invalide ou toute valeur
autre que `true` ferme toutes les mutations. Le verrou serveur reste
l'autorité finale : la politique frontend ne constitue jamais une barrière de
sécurité suffisante.

## Comportement d'interface

- verrou fermé : la production affiche `Pilote production verrouillé`, autorise
  le parsing local et interdit tout dépôt/promotion ;
- verrou indisponible : même comportement fail-closed ;
- verrou ouvert : l'interface affiche `Pilote production actif`, puis combine
  chaque action avec le rôle et la capacité applicables ;
- la cible exacte et l'état du verrou restent visibles à l'opérateur ;
- les commandes d'administration et le backfill BIS restent absents de
  l'interface en production ; après application de la migration candidate, les
  appels directs correspondants restent refusés tant que leurs scopes privés
  sont `false`.

## Verdict de contre-review indépendante

Verdict sur le SHA `b997dfdebd9b58e061b43dff1e029f93b9fbd339` : **FAIL —
MERGE_READY: NO**.

- P0 : 0 ;
- P1 : 1 — l'ouverture du verrou global autorise encore les chemins RPC
  d'administration/backfill à un administrateur authentifié ;
- P2 lors de la review : 3 — preuves UI majoritairement statiques, absence de
  test serveur négatif verrou ouvert/backfill, commentaire de test obsolète et
  date documentaire incorrecte. Le commentaire et la date sont corrigés dans le
  présent suivi ; la preuve serveur reste liée au P1 bloquant ;
- décision CTO : aucun merge ni enchaînement d'environnement tant qu'un contrôle
  serveur borné ne sépare pas le journalier de l'administration/backfill et que
  les tests directs correspondants ne sont pas verts.

## Réconciliation locale du finding P1

Le correctif serveur est matérialisé par
`20260829120000_daily_v2_controlled_production_pilot_server_scope.sql`.
La chaîne PostgreSQL 0R complète a été rejouée dans un conteneur jetable :

- `master=true`, `daily=true`, `admin=false`, `backfill=false` ;
- six appels directs admin/backfill refusés avant toute logique métier ;
- trois chemins daily autorisés à atteindre leurs invariants métier ;
- zéro écriture partielle après les refus ;
- huit cœurs mutatifs inaccessibles aux rôles API et `PUBLIC` ;
- état antérieur préservé et initialisation des scopes auditée ;
- charges BIS 857 unités/4 798 lignes et plafond 4 000/4 000 verts ;
- concurrences, retour du kill switch à `false` et reporting verts ;
- conteneur et fichiers temporaires détruits.

Le P1 est donc corrigé **localement**, sous réserve d'une nouvelle contre-review
indépendante du SHA final. Cela ne vaut ni merge ni validation staging.

La contre-review indépendante du SHA
`d0e3abf9176018b8b844e61f67bf6936c569a9f7` a ensuite rendu
**PASS_WITH_RESERVES — MERGE_READY: YES**, avec `0 P0`, `0 P1` et deux P2 non
bloquants : un commentaire runtime devenu obsolète et une preuve UI encore
principalement textuelle. Les deux réserves sont réconciliées localement :

- le commentaire nomme désormais staging et pilote production autorisé ;
- `DailyV2AdminControlsGate` constitue une frontière de rendu explicite ;
- un test React rendu couvre production × verrou `true`/`false`/absent/erreur ×
  rôles `admin`/`manager`/`auditor`/`user`, vérifie l'absence de markup
  admin/backfill et prouve que le sous-arbre adossé aux services n'est jamais
  évalué ;
- un contrôle positif staging/admin/verrou `true` empêche une preuve vacuement
  verte.

La revalidation indépendante du SHA
`e7634696d8a34a0b208d9f5d858bd921ed734ac1` a confirmé le comportement et
rendu **PASS — MERGE_READY: YES**, avec un dernier P2 limité à la précision du
compteur de test. Le delta ciblé
`e7634696d8a34a0b208d9f5d858bd921ed734ac1..39af326897125ef38b6d70ff6c61af16ad653676`
sépare désormais l'invocation du render prop du rendu de l'enfant. Sa dernière
revalidation a rendu **PASS — MERGE_READY: YES**, avec `0 P0`, `0 P1` et
`0 P2`. Aucun environnement n'a été touché.

## Séquence environnementale future — conditionnelle

La séquence ci-dessous ne peut commencer qu'après contre-review conforme et
merge du contrôle serveur borné. Chaque étape exigera ensuite un GO distinct :

1. préflight staging read-only du SHA fusionné ;
2. synchronisation et publication du runtime sur staging ;
3. E2E staging avec données synthétiques, preuve d'audit et rollback ;
4. préflight production read-only : cible, SHA, rôles, registre, état du verrou
   et compteurs avant pilote ;
5. publication production avec verrou toujours fermé, puis smoke parse-only ;
6. activation atomique exacte par l'opérateur sous un GO production dédié :
   `mutations_enabled=true`, `daily_scope_enabled=true`,
   `admin_scope_enabled=false`, `backfill_scope_enabled=false`, avec une raison
   non sensible et auditée ;
7. dépôt d'un seul petit export journalier autorisé, revue, promotion et
   vérifications canonical/audit/idempotence ;
8. fermeture immédiate du verrou au moindre écart, puis réconciliation ;
9. décision CTO séparée sur la poursuite, l'extension ou la fermeture du pilote.

Le kill switch consiste à remettre le verrou privé à `false`. Il bloque les
nouvelles mutations sans supprimer de donnée. Une donnée déjà validée ne doit
jamais être effacée pour simuler un rollback : toute correction métier passe par
les mécanismes auditables de supersede/réconciliation et un GO dédié.

## Interdits conservés

- aucune activation de `/upload` ou de Collection Report ;
- aucun Client Reconciliation ;
- aucun backfill BIS ou provisionnement/désactivation de compte en production ;
- aucune mutation automatique au chargement de la page ;
- aucun secret, fichier bancaire ou payload réel dans Git, les tests ou ce rapport ;
- aucune application de migration sur un environnement SODATRA, modification
  Auth/RLS ou setter client du verrou ; les changements de grants restent
  bornés aux cœurs/wrappers de la migration candidate.

## Validation requise avant merge

- suites Daily v2 application et reporting ;
- contrat de garde production : verrou `false`/absent/erreur ferme toutes les
  mutations, `true` n'ouvre que les capacités statiques ;
- tests des rôles et de l'absence des commandes d'administration/backfill ;
- build Vite production et hygiène du bundle ;
- comparaison lint/typecheck à `origin/main` ;
- review indépendante obligatoire, le lot touchant une garde d'intégrité.
- contre-review indépendante du contrôle serveur par capacité/mode et de ses
  tests négatifs directs.

## Risques résiduels

- le contrôle de cible frontend n'est pas une frontière de sécurité ; les RPC et
  le verrou PostgreSQL restent indispensables ;
- tant que la migration candidate n'est pas appliquée, les environnements
  conservent le verrou global historique et le pilote reste inexécutable ;
- l'activation production devra modifier le kill switch et les trois scopes
  dans une seule transaction auditée afin d'éviter tout état intermédiaire ;
- le premier export réel reste une opération financière : préflight, opérateur,
  période, compte, observations et critères d'arrêt doivent être nommés dans le
  GO d'exécution ;
- l'élargissement futur au backfill BIS ou à l'administration exigera un nouveau
  pack et un GO distinct ; il ne doit jamais réutiliser implicitement le GO du
  pilote journalier.
