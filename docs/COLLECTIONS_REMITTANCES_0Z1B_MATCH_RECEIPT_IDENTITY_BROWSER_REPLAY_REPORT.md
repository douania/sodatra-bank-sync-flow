# 0Z1B — Rejeu navigateur ciblé de l’identité des remises

Date de preuve : 2026-08-03

Branche locale : `feat/0z1b-collections-remittances-local`

Base : `c36c15eb2d1f13018162e31c6d7bba6098576f75`
Autorisation : `GO_0Z1B_MATCH_RECEIPT_IDENTITY_BROWSER_REPLAY_DOCKER_APPROVED`

## Verdict

`PASS_LOCAL_MATCH_RECEIPT_IDENTITY_BROWSER_REPLAY`

Le défaut `P1_MATCH_RECEIPT_IDENTITY_AMBIGUOUS` est fermé localement après
correctif, contre-revue indépendante `PASS` et rejeu navigateur à deux acteurs.
Cette preuve n’autorise ni staging ni production.

## Préflight et environnement

- `HEAD` = `origin/main` = SHA attendu ;
- candidat 0Z1B local non commité préservé ;
- pile issue du dépôt officiel Supabase au commit
  `94bc3f8d074307c90c1cf78c50ac5b2a1b48162f` ;
- PostgreSQL 17.6, GoTrue, PostgREST, Kong, Meta et Studio ;
- API liée uniquement à `127.0.0.1:18000` et application à
  `127.0.0.1:15173` ;
- 37 migrations du dépôt appliquées sur une base neuve ;
- deux utilisateurs, deux remises, deux titres et une proposition exclusivement
  synthétiques.

Le dossier bind-mount PostgreSQL de la preuve précédente contenait encore ses
données synthétiques alors que les conteneurs et volumes nommés avaient été
détruits. Ce résidu a été détecté et vidé avant le nouveau démarrage. La preuve
présente est donc partie d’une base réellement neuve.

## Périmètre exact du rejeu

Ce test revalide uniquement le correctif d’affichage. Les données ont été
préparées comme fixtures locales, avec une fenêtre Daily v2 auditée puis
refermée. Il ne prétend pas rejouer les RPC métier déjà couverts par la preuve
E2E complète précédente.

Scénario :

- même client : `CLIENT SYNTHETIQUE` ;
- même référence client : `CLIENT-E2E` ;
- même montant : 1 000 XOF ;
- remise 1 : chèque `CHQ-E2E-001`, date 03/08/2026, ID court `11111111` ;
- remise 2 : effet `EFFET-E2E-001`, date 04/08/2026, ID court `22222222` ;
- proposition `PROPOSED` rattachée à la remise effet.

## Preuve acteur A — proposition

Le sélecteur ouvert affiche simultanément deux options distinctes :

```text
CLIENT SYNTHETIQUE · Réf. client CLIENT-E2E · Chèque · Remise 03/08/2026 · Titre CHQ-E2E-001 · ID 11111111 · 1 000 F CFA
CLIENT SYNTHETIQUE · Réf. client CLIENT-E2E · Effet · Remise 04/08/2026 · Titre EFFET-E2E-001 · ID 22222222 · 1 000 F CFA
```

L’ambiguïté initiale est absente. La file de confirmation montre déjà la
seconde identité, mais le bouton `Confirmer` est désactivé pour A, auteur de la
proposition.

## Preuve acteur B — confirmation indépendante

Après déconnexion de A puis connexion de B, la file affiche :

```text
CLIENT SYNTHETIQUE · Réf. client CLIENT-E2E · Effet · Remise 04/08/2026 · Titre EFFET-E2E-001 · ID 22222222
Montant proposé 1 000 F CFA · score 100 · PROPOSED
```

Le bouton `Confirmer` est actif pour B. L’identité métier de la remise effet
est identique à celle présentée à A ; le montant reste séparé comme prévu. Le
bouton n’a pas été actionné, car le périmètre consistait à vérifier
l’identification avant décision, sans rejouer une mutation déjà couverte.

## État final et destruction

Avant arrêt :

- 2 remises et 2 titres synthétiques ;
- 1 proposition encore `PROPOSED`, reliée à l’UUID complet de la remise effet ;
- `daily_stmt_mutations_enabled() = false`.

Après arrêt :

- application locale arrêtée ;
- zéro conteneur, volume ou réseau Supabase résiduel ;
- dossier bind-mount PostgreSQL vidé, zéro entrée ;
- fixture SQL et fichier `.env` local supprimés ;
- aucun port d’application ou d’API encore en écoute.

## Conformité

- Supabase distant, staging ou production : aucun accès ;
- donnée bancaire réelle : aucune ;
- secret réel : aucun ;
- patch applicatif supplémentaire : aucun ;
- commit, push, PR ou déploiement : aucun.

## Conclusion

`P1_MATCH_RECEIPT_IDENTITY_AMBIGUOUS` devient
`P1_CLOSED_LOCAL_AFTER_COUNTER_REVIEW_AND_BROWSER_REPLAY`.

Le bloqueur d’identité n’interdit plus, à lui seul, la préparation du jalon
staging. Les autres portes de staging déjà documentées restent indépendantes et
aucun GO d’environnement n’est implicite.
