# Collection Report — activation production contrôlée

## Qualification du lot

- GO : `GO_IMPLEMENT_COLLECTION_REPORT_CONTROLLED_PRODUCTION_ACTIVATION_ATOMIC_INGEST_SERVER_SCOPE_AND_FAIL_CLOSED_VALIDATION`.
- Base vérifiée : `8102e8ab40f03ee079bd45a33b3425d94db3e518` (`origin/main`).
- Branche : `codex/collection-report-controlled-production-activation`.
- Statut : implémentation locale prête pour contre-review indépendante.
- Autorisé dans ce lot : code, migration candidate, tests, documentation,
  commit/push et PR brouillon.
- Non autorisé et non effectué : merge, SQL live, application de migration,
  synchronisation Lovable, staging ou production.

Le pack ne déclare donc pas Collection Report actif en production. La route
reste sans capacité d'écriture tant que la migration et le runtime n'ont pas
été qualifiés sur staging, puis autorisés par des GO d'environnement distincts.

## Diagnostic initial

Le flux disposait d'un parsing et d'une review humaine, mais pas des garanties
requises pour une activation opérationnelle :

- promotion applicative découpée en lots, donc possibilité d'un succès partiel ;
- garde anti-décalage fondée sur une lecture cliente non paginée et fail-open en
  cas d'erreur ;
- absence de scope serveur Collection Report dédié ;
- cellule montant vide ou invalide susceptible de devenir silencieusement zéro,
  banque vide acceptée ;
- absence de borne stricte sur le nombre de fichiers et de lignes ;
- pas de ledger de commande ni de preuve avant/après liée à l'acteur.

## Contrat livré

### Validation locale fail-closed

- 10 fichiers maximum, 15 Mo par fichier, 5 000 lignes de données par unité.
- `DATE`, client, montant strictement positif, banque et traçabilité Excel sont
  obligatoires. Une valeur vide, illisible, non positive ou hors borne rejette
  la ligne ; aucune conversion financière vers zéro.
- Le lecteur XLSX borne la matérialisation mais contrôle aussi la plage physique
  d'origine : aucune troncature silencieuse d'un fichier trop long.
- En production, le préflight de `/upload` n'accepte que `COLLECTION_REPORT`.
  Internal Book, rapports bancaires, Fund Position et flux legacy restent
  fermés. La review Collection reste locale et sans écriture lorsque le scope
  serveur est fermé ou indisponible.

### Scope serveur

La migration candidate
`20260901000000_collection_report_controlled_production_activation.sql` crée un
état privé singleton, fermé par défaut, avec expiration obligatoire et durée
maximale de deux heures. Chaque ouverture/fermeture exige une nouvelle raison
sûre et produit un événement append-only.

L'interface ne présente la promotion que si la cible, le rôle et la lecture du
scope serveur sont tous conformes. Une réponse absente, en cours ou en erreur
vaut `false`. Cette lecture UI n'est pas une autorisation : le RPC revérifie le
scope dans la transaction d'écriture.

### Ingestion atomique

`public.import_collection_report_atomic_v1(uuid,jsonb)` est l'unique chemin de
promotion du pack :

- appel réservé aux rôles `admin` ou `manager` authentifiés ;
- unité complète validée dans une transaction PostgreSQL unique ;
- sérialisation par verrou advisory ;
- idempotence par acteur + UUID déterministe SHA-256 du payload exact et hash
  vérifié côté serveur, y compris après perte de réponse ou rechargement ;
- validation JSON stricte, champs inconnus interdits et bornes serveur répétées ;
- détection autoritative d'un décalage de lignes avant la première écriture ;
- upsert canonique sur `(excel_filename, excel_source_row)` ;
- audit privé avant/après pour chaque clé traitée ;
- rollback automatique de tout le lot en cas d'erreur.

Un trigger interdit tout `INSERT` direct et toute modification directe des
champs d'identité stable. L'autorisation interne n'est pas un paramètre de
session falsifiable : elle est matérialisée par une capacité privée liée au
numéro de transaction, à l'acteur et à la commande, créée puis supprimée par le
RPC. Le schéma privé est sans `USAGE` pour `authenticated`, `anon` et
`service_role`, avec RLS active et aucun policy d'accès.

La migration ne change ni les migrations historiques, ni les contraintes ou
index canoniques, ni `unique_excel_traceability`, ni
`trg_detect_collection_type`/`detect_collection_type()`.

## Validation locale

| Vérification | Résultat |
|---|---|
| Suites import ciblées | 68 tests : 66 PASS, 0 FAIL, 2 SKIP documentés pour le harness Supabase/Vite sous Node 24 ; CI Node 20 |
| Test réel de la borne XLSX | 5 001 lignes rejetées entièrement, 0 ligne acceptée |
| Replay PostgreSQL 17 jetable | PASS ; conteneur supprimé |
| Contrat SQL | scope fermé/ouvert/expirant, droits RPC, insert/update directs bloqués, GUC forgé bloqué, atomicité, idempotence, audit, décalage massif, relock |
| Build Vite production | PASS ; warnings de chunk/imports mixtes préexistants |
| Artefact MCP | SHA-256 inchangé avant/après build |
| ESLint | 180 erreurs / 11 warnings, multiensemble strictement identique à `origin/main` (même SHA-256 des 191 diagnostics) |
| TypeScript app | 17 diagnostics préexistants, multiensemble strictement identique à `origin/main` |
| `git diff --check` | PASS avant finalisation documentaire |

Les fixtures sont exclusivement synthétiques. Aucun fichier bancaire réel,
secret, JWT réel ou environnement Supabase n'a été lu pendant les tests du lot.

## Séquence d'activation ultérieure

1. Contre-review indépendante de la PR, obligatoire car le lot touche une
   migration, les rôles, la sécurité, l'idempotence et la concurrence.
2. Merge uniquement après verdict CTO et GO dédié.
3. Préflight staging read-only : identité de cible, ledger de migrations,
   contraintes/index/trigger et scope absent ou fermé.
4. Application de la migration candidate sur staging, toujours fermée par
   défaut, puis synchronisation du runtime.
5. E2E staging dans une transaction isolée avec fixtures synthétiques et
   `ROLLBACK`, incluant concurrence, expiration, rejeu et attaque directe.
6. Build staging publié et smoke authentifié read-only.
7. Toute phase production reste séparée : préflight, migration, publication,
   smoke, puis premier import pilote avec ouverture brève et reverrouillage
   immédiat.

## Réserves

- Aucun test live n'est revendiqué dans ce lot ; la migration reste candidate.
- Le replay couvre PostgreSQL 17 avec un schéma minimal fidèle aux objets
  utilisés, pas l'intégralité du ledger Supabase.
- Le rollback automatique couvre toute erreur avant commit. L'annulation d'une
  commande déjà commitée n'est pas exposée en libre-service ; l'audit privé
  avant/après fournit la preuve nécessaire à un futur lot de compensation
  contrôlée si le besoin opérationnel est confirmé.
- Le trigger laisse possibles les enrichissements opérationnels existants qui
  ne modifient pas les champs d'identité stable ; leurs contrôles RLS actuels
  restent autoritatifs et devront être requalifiés en staging.

Verdict CTO local : **`PASS_WITH_RESERVES — LOCAL_READY_FOR_INDEPENDENT_REVIEW`**.
