# Daily v2 — Pilote d'activation contrôlée en production

## Statut

`IMPLEMENTED_LOCAL — INDEPENDENT_REVIEW_REQUIRED — PRODUCTION_LOCK_UNCHANGED`
— 2026-08-30.

Ce lot prépare le premier pilote mutatif Daily v2 en production. Il ne publie
aucun runtime, n'accède à aucun environnement, n'exécute aucun SQL et ne change
pas le verrou PostgreSQL. La production reste donc effectivement en lecture
seule jusqu'aux GO d'environnement nominatifs.

## Périmètre du premier pilote

Le pilote est volontairement plus étroit que le parcours complet disponible en
staging :

- relevés structurés quotidiens uniquement, dans la limite existante de 45 jours ;
- CSV BDK/ORA et Excel ONLINE ATB/BICIS/BIS/BRIDGE déjà caractérisés ;
- compte actif déjà présent dans le registre Daily v2 ;
- préparation et dépôt : rôles `admin` ou `manager` ;
- promotion et supersede : rôle `admin` ;
- consultation canonical/audit/reporting : règles de rôles existantes ;
- administration du registre et backfill BIS exclus du pilote production.

L'exclusion de l'administration est portée par la politique statique de cible :
la production est éligible à `read`, `deposit` et `promote`, jamais à `admin`.
L'option backfill et les commandes de création/révocation de grant ne sont donc
pas rendues dans ce pilote. Le staging conserve les quatre capacités.

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
- les commandes d'administration et le backfill BIS restent absents en
  production, même lorsque le verrou est ouvert.

## Séquence environnementale future

Chaque étape exige un GO distinct :

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

## Validation attendue avant merge

- suites Daily v2 application et reporting ;
- contrat de garde production : verrou `false`/absent/erreur ferme toutes les
  mutations, `true` n'ouvre que les capacités statiques ;
- tests des rôles et de l'absence des commandes d'administration/backfill ;
- build Vite production et hygiène du bundle ;
- comparaison lint/typecheck à `origin/main` ;
- review indépendante obligatoire, le lot touchant une garde d'intégrité.

## Risques résiduels

- le contrôle de cible frontend n'est pas une frontière de sécurité ; les RPC et
  le verrou PostgreSQL restent indispensables ;
- l'ouverture du verrou est globale à Daily v2 côté serveur. Le périmètre
  restreint du pilote est renforcé dans le client, tandis que les RPC continuent
  d'appliquer leurs rôles et invariants propres ;
- le premier export réel reste une opération financière : préflight, opérateur,
  période, compte, observations et critères d'arrêt doivent être nommés dans le
  GO d'exécution ;
- l'élargissement au backfill BIS ou à l'administration exige un nouveau pack et
  un GO distinct.
