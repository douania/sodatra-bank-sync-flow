# Daily v2 — Pilote d'activation contrôlée en production

## Statut

`BLOCKED — SERVER_SCOPE_REQUIRED — PRODUCTION_LOCK_UNCHANGED`
— 2026-08-29.

Ce lot prépare côté client le premier pilote mutatif Daily v2 en production. Il ne publie
aucun runtime, n'accède à aucun environnement, n'exécute aucun SQL et ne change
pas le verrou PostgreSQL. La production reste donc effectivement en lecture
seule. La contre-review indépendante a établi que ce lot n'est pas merge-ready :
le verrou PostgreSQL actuel est global et ne sépare pas les capacités
journalières des capacités d'administration et de backfill.

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

Cette exclusion est actuellement portée uniquement par la politique statique de cible :
la production est éligible à `read`, `deposit` et `promote`, jamais à `admin`.
L'option backfill et les commandes de création/révocation de grant ne sont donc
pas rendues dans l'interface de ce pilote. Le staging conserve les quatre
capacités. Ce masquage client n'empêche pas un appel direct aux RPC et ne
constitue donc pas l'exclusion serveur requise.

## Barrières cumulatives

Une opération mutative exige simultanément :

1. l'identité exacte du projet Supabase production canonique ;
2. une capacité statique connue et explicitement autorisée ;
3. une session Auth valide ;
4. le rôle métier attendu ;
5. une réponse explicite `true` du verrou PostgreSQL privé ;
6. l'autorisation `EXECUTE` et les contrôles de rôle de la RPC ;
7. les invariants atomiques, d'idempotence, de concurrence et d'audit Daily v2.

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
  l'interface en production, même lorsque le verrou est ouvert ; cette propriété
  n'est pas encore garantie côté serveur.

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

## Séquence environnementale future — bloquée

La séquence ci-dessous ne peut commencer qu'après implémentation locale,
contre-review et merge d'un contrôle serveur borné. Chaque étape exigera ensuite
un GO distinct :

1. préflight staging read-only du SHA fusionné ;
2. synchronisation et publication du runtime sur staging ;
3. E2E staging avec données synthétiques, preuve d'audit et rollback ;
4. préflight production read-only : cible, SHA, rôles, registre, état du verrou
   et compteurs avant pilote ;
5. publication production avec verrou toujours fermé, puis smoke parse-only ;
6. ouverture temporaire du verrou par l'opérateur sous un GO production exact,
   avec une raison non sensible et auditée ;
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
- aucune migration, modification Auth/RLS/grants ou setter client du verrou.

## Validation requise avant merge

- suites Daily v2 application et reporting ;
- contrat de garde production : verrou `false`/absent/erreur ferme toutes les
  mutations, `true` n'ouvre que les capacités statiques ;
- tests des rôles et de l'absence des commandes d'administration/backfill ;
- build Vite production et hygiène du bundle ;
- comparaison lint/typecheck à `origin/main` ;
- review indépendante obligatoire, le lot touchant une garde d'intégrité.
- contrôle serveur par capacité/mode et tests négatifs directs prouvant qu'un
  verrou journalier ouvert ne permet ni backfill ni administration.

## Risques résiduels

- le contrôle de cible frontend n'est pas une frontière de sécurité ; les RPC et
  le verrou PostgreSQL restent indispensables ;
- l'ouverture du verrou est globale à Daily v2 côté serveur ; les rôles et
  invariants propres des RPC ne remplacent pas une séparation serveur des modes,
  ce qui bloque le pilote ;
- le premier export réel reste une opération financière : préflight, opérateur,
  période, compte, observations et critères d'arrêt doivent être nommés dans le
  GO d'exécution ;
- l'élargissement futur au backfill BIS ou à l'administration exigera un nouveau
  pack et un GO distinct après la mise en place de la barrière serveur.
