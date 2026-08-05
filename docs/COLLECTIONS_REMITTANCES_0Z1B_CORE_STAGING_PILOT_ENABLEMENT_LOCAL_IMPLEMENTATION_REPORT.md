# 0Z1B Core — rapport d’implémentation locale du pilote staging

## 1. Verdict

`PASS_LOCAL_IMPLEMENTATION_READY_FOR_INDEPENDENT_COUNTER_REVIEW`

L’implémentation locale autorisée par
`GO_0Z1B_CORE_APPLICATION_STAGING_PILOT_ENABLEMENT_LOCAL_IMPLEMENTATION_APPROVED`
est terminée dans le worktree isolé. Elle n’a pas été exécutée contre Supabase
staging ou production et n’autorise aucun déploiement.

Les trois réserves P2 de la contre-revue indépendante ont ensuite été corrigées
sous
`GO_0Z1B_CORE_APPLICATION_STAGING_PILOT_ENABLEMENT_LOCAL_P2_CORRECTIONS_ONLY_APPROVED`.

## 2. Périmètre réalisé

- garde fail-closed commune à la route, la navigation et les services ;
- cible locale historique conservée et origine staging exacte limitée au projet
  `gbbsqcscryygqlmqncyv` ;
- refus explicite du projet production `leakcdbbawzysfqyqsnr` ;
- manifeste fermé Base64 + SHA-256, vérifié sur les octets UTF-8 avant parsing ;
- trois identités distinctes G/A/B et liaison stricte session/action ;
- dataset synthétique exact, présenté en lecture seule et comparé avant RPC ;
- bandeau staging permanent indiquant données synthétiques, absence de paiement
  et absence d’écriture comptable ;
- préflight du compte de dépôt synthétique : existence dans le référentiel actif
  et devise exacte, avant affichage de la saisie puis à nouveau avant RPC ;
- panneau G borné à `Préparer le pilote` et `Fermer le pilote` ;
- bootstrap temporaire de `MANAGE_ACCESS`, inventaire des baselines et registre
  de campagne fondé sur `collection_domain_assignments` ;
- capacités A/B minimales : A=`ENTRY`, B=`VALIDATE_REMITTANCE` + `AUDIT` ;
- cleanup des seuls assignments de campagne, contrôle A/B avant révocation de G,
  puis preuve locale de restauration de G0 ;
- phase B/Daily v2 marquée `NOT_RUN` et bloquée avant tout appel réseau.

## 3. Non-actions garanties

Aucun accès Supabase, aucun SQL, aucune migration, aucune modification DB/RLS/Auth,
aucune donnée bancaire réelle, aucun secret, aucun `.env`, aucune dépendance ou
lockfile modifié, aucun commit, push ou PR. Le build n’a pas modifié
`supabase/functions/mcp/index.ts`.

## 4. Contrôles locaux

- `npm run test:collections-core` : `27/27 PASS` ;
- `npx tsc -p tsconfig.app.json --noEmit` : 19 erreurs connues, liste strictement
  identique à `origin/main` (`PASS_WITH_BASELINE`) ;
- `npm run lint` : 220 constats, liste strictement identique à `origin/main`
  (`PASS_WITH_BASELINE`) ;
- `npm run build` : `PASS` ;
- `git diff --check` : `PASS` ;
- artefact MCP : inchangé.

### Moyen d’exécution et nettoyage

Le worktree isolé ne contenait pas de `node_modules`. Aucun téléchargement ni
installation n’a été effectué. Les contrôles ont utilisé temporairement, via
des jonctions NTFS locales, le répertoire de dépendances déjà installé dans le
worktree frère `0z1b-core-app-integration`. La baseline propre au même head a
utilisé la même source de dépendances afin de rendre les comparaisons strictes.

Après les contrôles, les deux jonctions ont été supprimées comme objets de
jonction, sans supprimer ni modifier leur cible. Leur absence a été vérifiée et
le `node_modules` source est resté intact. Aucun manifeste de dépendances ni
lockfile n’a changé.

## 5. Limites et porte suivante

Les tests locaux valident la cible, le manifeste, les contrats d’action et la
structure du bootstrap/cleanup. Les rôles, comptes, assignments et RPC réels de
staging restent `NOT_VERIFIED_BY_THIS_LOCAL_IMPLEMENTATION`.

La prochaine porte est une contre-revue indépendante locale ciblée des trois
corrections P2. Toute
configuration ou exécution du pilote sur staging exige ensuite un GO distinct.
