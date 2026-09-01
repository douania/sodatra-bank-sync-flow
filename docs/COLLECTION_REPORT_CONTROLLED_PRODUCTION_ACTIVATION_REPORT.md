# Collection Report — activation production contrôlée

## Qualification du lot

- GO : `GO_IMPLEMENT_COLLECTION_REPORT_CONTROLLED_PRODUCTION_ACTIVATION_ATOMIC_INGEST_SERVER_SCOPE_AND_FAIL_CLOSED_VALIDATION`.
- Base vérifiée : `8102e8ab40f03ee079bd45a33b3425d94db3e518` (`origin/main`).
- Branche : `codex/collection-report-controlled-production-activation`.
- Statut : findings de la première revalidation corrigés, nouveau SHA à
  publier puis à revalider indépendamment.
- Autorisé dans ce lot : code, migration candidate, tests, documentation,
  commit/push et PR brouillon.
- Non autorisé et non effectué : merge, SQL live, application de migration,
  synchronisation Lovable, staging ou production.

Le pack ne déclare donc pas Collection Report actif en production. La route
reste sans capacité d'écriture tant que la migration et le runtime n'ont pas
été qualifiés sur staging, puis autorisés par des GO d'environnement distincts.

## Hotfix PG17 CI readiness

GO reçus pour ce pack :
`GO_IMPLEMENT_COLLECTION_REPORT_PG17_CI_READINESS_HARDENING`, puis
`GO_FIX_COLLECTION_REPORT_PG17_CI_READINESS_HARDENING_REVIEW_FINDINGS`.

La PR #143 a été fusionnée dans `main` au commit `22f7cf9`. Son préflight
staging read-only a confirmé la cible `gbbsqcscryygqlmqncyv`, le ledger exact
des 43 migrations antérieures, l'absence du candidat `20260901000000`, les
objets privés absents, le scope fermé par absence et une table
`collection_report` vide et conforme. Aucune migration ni mutation staging n'a
été exécutée.

La CI du merge `33535208111` a ensuite échoué avant le premier SQL : `pg_isready` avait pu
observer le serveur PostgreSQL temporaire utilisé par l'image officielle pour
l'initialisation, puis `psql` avait rencontré le redémarrage vers le serveur
final. Ce défaut de synchronisation du runner ne modifie pas le contrat SQL,
mais bloque volontairement l'application staging tant que `main` n'est pas de
nouveau vert.

Le premier SHA du hotfix, `09c0139`, attendait le marqueur de fin du bootstrap
Docker, vérifiait que le conteneur restait actif, puis exigeait un vrai
`SELECT 1` sur le serveur final. Quatre replays locaux complets et consécutifs
ont réussi sur ce SHA. Sa CI `33536836132` a néanmoins échoué avant le replay :
sous pwsh Linux, `docker logs` pouvait ne produire encore aucune ligne et
`[string]::Join` refusait alors la valeur `null`.

Le SHA `b999a83` traite cette absence de logs comme un état d'attente normal via
`@($containerLogs) -join "`n"`. Un replay local complet post-correction a réussi,
puis la CI finale `33537123541`, job `99954049972`, a validé le même SHA :
contrat Collection PASS, concurrence scope PASS à 2 727 ms, préimage d'audit
PASS à 2 708 ms, teardown PASS et build PASS en 11,87 s. La boucle reste bornée
à 60 tentatives et 30 secondes de sommeil cumulé ; les appels Docker ajoutent
leur propre durée, donc ce chiffre n'est pas un plafond mural. Le teardown
fail-closed existant est conservé. Après correction des findings de review, un
replay local complet supplémentaire a validé le delta final : contrat PASS,
concurrence scope PASS à 2 766 ms, préimage d'audit PASS à 2 407 ms et teardown
PASS.

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

- Pour Collection Report uniquement : 10 fichiers maximum, 15 Mo par fichier
  et 5 000 lignes de données sur l'unité atomique complète. Ces plafonds ne
  modifient pas les contrats des autres familles `/upload`.
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
scope serveur sont tous conformes. La lecture du scope retourne aussi `false`
aux rôles non opérateurs. Une réponse absente, en cours ou en erreur vaut
`false`. Cette lecture UI n'est pas une autorisation : le RPC verrouille le
singleton, puis revérifie son expiration avec l'horloge réelle immédiatement
avant l'écriture.

### Ingestion atomique

`public.import_collection_report_atomic_v1(uuid,jsonb)` est l'unique chemin de
promotion du pack :

- appel réservé aux rôles `admin` ou `manager` authentifiés ;
- unité complète validée dans une transaction PostgreSQL unique ;
- sérialisation par verrou advisory ;
- idempotence par acteur + UUID déterministe SHA-256 du payload exact et hash
  SHA-256 vérifié côté serveur, y compris après perte de réponse ou rechargement ;
- validation JSON stricte, champs inconnus interdits et bornes serveur répétées ;
- normalisation unique des champs texte et de la clé Excel avant comparaison,
  préimage, upsert et audit ;
- refus autoritatif de toute divergence d'identité stable sur une clé Excel
  existante, même une seule ligne ;
- upsert canonique sur `(excel_filename, excel_source_row)` ;
- rejeu conservateur : les états opérationnels acquis sont préservés et seules
  les lacunes d'enrichissement peuvent être complétées ;
- la fonction historique `detect_collection_type()` est redéfinie sans changer
  le câblage du trigger : elle dérive seulement les informations effet/chèque
  encore absentes et ne remplace aucun enrichissement existant ;
- audit privé avant/après pour chaque clé traitée, avec verrou déterministe des
  lignes existantes avant préimage, comptage SQL réel et rollback si le nombre
  d'audits diffère du nombre de lignes ;
- rollback automatique de tout le lot en cas d'erreur.

Un trigger interdit tout `INSERT` direct et toute modification directe des
champs d'identité stable. L'autorisation interne n'est pas un paramètre de
session falsifiable : elle est matérialisée par une capacité privée liée au
numéro de transaction, à l'acteur et à la commande, créée puis supprimée par le
RPC. Le schéma privé est sans `USAGE` pour `authenticated`, `anon` et
`service_role`, avec RLS active et aucun policy d'accès.

La migration ne change ni les migrations historiques, ni les contraintes ou
index canoniques, ni `unique_excel_traceability`, ni le trigger
`trg_detect_collection_type`. Elle remplace uniquement le corps de
`detect_collection_type()` par sa variante conservatrice forward-only.

## Contre-review indépendante et réconciliation

La première contre-review du SHA `631ce3f` a rendu un verdict `NON CONFORME`
avec un P0 et deux P1 bloquants. Ils sont tous réconciliés dans ce correctif :

- P0 rejeu destructif : suppression des remises à zéro de `status`,
  `processing_status`, `processed_at` et des états d'impayé/effet/chèque ;
- P1 clé Excel brute : trim appliqué une seule fois avant tous les usages et
  audit vérifié par `ROW_COUNT` ;
- P1 course du scope : verrou `FOR SHARE` conservé jusqu'à la fin de la
  transaction, relecture tardive et test concurrent réel de reverrouillage.

Les durcissements P2 directement dans le périmètre sont également intégrés :
SHA-256 serveur, refus de toute divergence (plus de seuil permissif), visibilité
du scope limitée à admin/manager, plafond agrégé de 5 000 lignes, plafonds UI
réservés à Collection, et schéma de test enrichi avec RLS, contrainte de
traçabilité et trigger de détection. Les anciens points d'écriture directe
Collection restent volontairement refusés pour les nouveaux inserts après
application de la migration ; `/upload` utilise l'unique RPC atomique. Leur
éventuelle migration UX hors `/upload` relève d'un lot dédié et ne justifie pas
de rouvrir une voie d'écriture non atomique.

La revalidation indépendante du SHA `7cc5a8e` a confirmé la fermeture du P0 et
des deux P1, puis identifié deux P2 matériels. Ils sont corrigés dans le présent
delta :

- le shim démarre avec le corps historique exact du trigger, puis vérifie que
  la migration le remplace par une dérivation conservatrice ; deux lignes
  synthétiques historiques `NULL/UNKNOWN` prouvent la conservation d'un numéro
  de chèque et d'une échéance déjà enrichis ;
- le RPC verrouille désormais les lignes existantes par ordre déterministe
  avant leur préimage. Un test PostgreSQL à deux sessions prouve qu'un
  enrichissement concurrent est attendu puis capturé exactement dans
  `before_row` et `after_row`.

Le finding proposé sur le runner PowerShell a été retiré après confrontation à
la CI réelle du SHA : la borne de 1 500 ms est minimale et l'étape PostgreSQL 17
avait effectivement réussi à 2 740 ms sur `ubuntu-latest`.

## Validation locale

| Vérification | Résultat |
|---|---|
| Suites import ciblées | 70 tests : 68 PASS, 0 FAIL, 2 SKIP documentés pour le harness Supabase/Vite sous Node 24 ; CI Node 20 |
| Test réel de la borne XLSX | 5 001 lignes rejetées entièrement, 0 ligne acceptée |
| Replay PostgreSQL 17 jetable | PASS ; fonction historique fidèle remplacée, cas chèque/effet `NULL/UNKNOWN` conservateurs, conteneur supprimé |
| Contrat SQL | scope fermé/ouvert/expirant, rôle de lecture, insert/update directs bloqués, GUC forgé bloqué, atomicité, SHA-256, rejeu conservateur, trigger conservateur, clé trim, audit réel, divergence unitaire, relock |
| Concurrence scope | PASS ; un relock concurrent a attendu 2 675 ms sur fenêtre synthétique de 3 s |
| Concurrence préimage audit | PASS ; l'import a attendu 2 780 ms puis l'audit a capturé exactement l'enrichissement concurrent commité |
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
- Le replay couvre PostgreSQL 17 avec un schéma minimal enrichi des objets
  critiques utilisés (RLS, policies, contrainte de traçabilité et trigger), pas
  l'intégralité du ledger Supabase. Le rejeu full-chain et la mesure de timeout
  sur la cible réelle restent obligatoires au préflight staging.
- Le rollback automatique couvre toute erreur avant commit. L'annulation d'une
  commande déjà commitée n'est pas exposée en libre-service ; l'audit privé
  avant/après fournit la preuve nécessaire à un futur lot de compensation
  contrôlée si le besoin opérationnel est confirmé.
- Le trigger de garde laisse possibles les enrichissements opérationnels existants qui
  ne modifient pas les champs d'identité stable ; leurs contrôles RLS actuels
  restent autoritatifs. Le verrou de préimage les sérialise désormais avec
  l'import atomique ; cette interaction devra être requalifiée en staging. Les INSERT
  Collection des surfaces legacy sont intentionnellement fail-closed et doivent
  être redirigés vers `/upload` plutôt que réautorisés.
- `DELETE`/`TRUNCATE`, politique de rétention de l'audit et compensation après
  commit ne font pas partie de cet ingest atomique ; ils exigent des lots de
  gouvernance distincts.

Verdict local du hotfix : **`PASS — REVIEW_FINDINGS_FIXED — NEW_SHA_PENDING_REVALIDATION`**.
