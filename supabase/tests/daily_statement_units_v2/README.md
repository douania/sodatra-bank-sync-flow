# Tests DB — DAILY-RPC-V2-MIGRATION-DRAFT-0H (migration candidate v2)

Suite de tests SQL pour la migration historique
`supabase/migrations/20260708130000_daily_statement_units_v2.sql` et le wrapper
additif 0U `20260715000000_daily_v2_account_registry_review_visibility.sql`,
puis le pont d'adoption historique 0U3
`20260715010000_daily_v2_historical_identity_adoption_bridge.sql`, puis le
correctif forward-only 0U4
`20260716000000_daily_v2_legacy_fingerprint_compatibility.sql`, puis le cycle
de vie provisional 0Z
`20260728000000_daily_v2_provisional_lifecycle_0z.sql`, puis la garde serveur
fail-closed
`20260730170000_daily_v2_server_readonly_guard.sql`, puis son API booléenne
read-only
`20260730180000_daily_v2_runtime_lock_read_api.sql`, le hardening BIS 0V
`20260829000000_daily_v2_bis_backfill_atomic_ingest_timeout_hardening.sql`,
puis les scopes serveur du pilote contrôlé
`20260829120000_daily_v2_controlled_production_pilot_server_scope.sql`.

**Périmètre strict :**
- Postgres local **jetable** uniquement (Docker). Jamais Supabase live, jamais
  `db push`, jamais `db reset` sur un projet lié.
- Données 100 % **synthétiques** — aucune donnée bancaire réelle.
- Le shim `00_*` émule la plateforme (rôles `anon`/`authenticated`/`service_role`,
  default privileges larges, `auth.uid()` piloté par GUC, `app_role`/`user_roles`/
  `has_role` copiés des migrations prod). **Ne jamais appliquer le shim en prod.**
- **Non empilable avec la suite v1** : les shims v1 et v2 créent tous deux
  `public.app_role` et `public.user_roles` sans `IF NOT EXISTS`. Chaque suite
  exige sa propre base jetable vierge (conteneur distinct ou base recréée).

## Lancement (base jetable Docker)

```sh
docker run -d --name poc0h-pg -e POSTGRES_PASSWORD=poc0h -p 54330:5432 postgres:15-alpine
PSQL="psql -h localhost -p 54330 -U postgres -d postgres -v ON_ERROR_STOP=1"
export PGPASSWORD=poc0h

# 1. Shim + seed + helpers de payload
$PSQL -f 00_supabase_local_shim.sql
$PSQL -f 01_seed_synthetic_identities.sql
$PSQL -f 02_payload_helpers.sql

# 2. Test de rollback : la migration s'annule proprement
$PSQL -c "BEGIN;" -f ../../migrations/20260708130000_daily_statement_units_v2.sql -c "ROLLBACK;"
#    (vérifier ensuite qu'aucune table daily_statement_% n'existe)

# 3. Application réelle (une transaction, comme le CLI supabase)
$PSQL --single-transaction -f ../../migrations/20260708130000_daily_statement_units_v2.sql

# 4. Suites séquentielles
$PSQL -f 10_structure_and_privileges.sql
$PSQL -f 11_validation_gates.sql
$PSQL -f 12_pipeline_rules.sql
$PSQL -f 13_ora_backfill.sql
$PSQL -f 14_supersede.sql
$PSQL -f 15_rls_read_matrix.sql

# 5. Concurrence (deux sessions réelles)
$PSQL -f 19_concurrency_setup.sql
$PSQL -f 20_concurrency_promote_session_a.sql &   # tient le verrou quelques secondes
sleep 2 && $PSQL -f 21_concurrency_promote_session_b.sql
wait
$PSQL -f 24_concurrency_asserts.sql

# 6. Cycle de vie provisional 0Z : la suite 16 exige la chaîne additive
#    complète (0U/0U3/0U4/0Z, puis jusqu'aux décisions opérationnelles et à D1)
#    par-dessus le socle 0H. Elle s'exécute APRÈS les suites 10-15 et la
#    concurrence, qui déposent en style 0H (sans registre) et seraient refusées
#    par le wrapper 0U.
$PSQL --single-transaction -f ../../migrations/20260715000000_daily_v2_account_registry_review_visibility.sql
$PSQL --single-transaction -f ../../migrations/20260715010000_daily_v2_historical_identity_adoption_bridge.sql
$PSQL --single-transaction -f ../../migrations/20260716000000_daily_v2_legacy_fingerprint_compatibility.sql
$PSQL --single-transaction -f ../../migrations/20260728000000_daily_v2_provisional_lifecycle_0z.sql
$PSQL --single-transaction -f ../../migrations/20260730170000_daily_v2_server_readonly_guard.sql
$PSQL --single-transaction -f ../../migrations/20260730180000_daily_v2_runtime_lock_read_api.sql
$PSQL -f 18_runtime_lock_read_api.sql
$PSQL -f 17a_server_readonly_guard_pre.sql
$PSQL -f 18a_runtime_lock_read_api_enabled.sql
$PSQL --single-transaction -f ../../migrations/20260829000000_daily_v2_bis_backfill_atomic_ingest_timeout_hardening.sql
$PSQL --single-transaction -f ../../migrations/20260829120000_daily_v2_controlled_production_pilot_server_scope.sql
$PSQL -f 33_controlled_production_server_scope.sql
$PSQL --single-transaction -f ../../migrations/20261103120000_daily_v2_operational_decisions.sql
$PSQL --single-transaction -f ../../migrations/20261108120000_daily_v2_d1_late_provisional_same_version.sql
$PSQL -f 16_provisional_lifecycle_0z.sql
$PSQL -f 17b_server_readonly_guard_post.sql
$PSQL -f 18_runtime_lock_read_api.sql

docker rm -f poc0h-pg   # destruction de la base jetable
```

Tout `TEST_FAILED:` fait échouer psql (`ON_ERROR_STOP`). Une exécution
intégralement verte = PASS local.

## E2E local multi-banques 0R (chaîne Excel réel -> RPC -> canonical -> reporting)

```sh
bash supabase/tests/daily_statement_units_v2/run_e2e_0r.sh
```

Runner autonome (même doctrine : Postgres Docker **jetable**, jamais Supabase
live). Il enchaîne : génération des classeurs synthétiques ATB `.xls`,
BICIS `.xls`, BIS `.xls` et BRIDGE `.xlsx` **en mémoire** → traversée du **vrai
pipeline TypeScript** `prepareDailyV2BrowserDeposit` → émission d'un artefact SQL
portant les **payloads RPC réels** → conteneur jetable + shim + seed + migration
v2 historique → fixture historique synthétique (3 canonical + 1 conflit) →
migrations additives 0U/0U3/0U4 → adoption admin d'un token legacy opaque
de 31 caractères sans transformation, non-régression SHA-256, refus des formes
sensibles, puis teardown ciblé →
`30_e2e0r_pipeline.sql` (registre de
comptes, grants one-use, motifs de revue, dépôt, duplicate R1, conflict R2, promotion,
gate 0K BRIDGE, supersede, R3, provisional, matrice des rôles, audit
append-only) → cycle de vie provisional 0Z (`16_provisional_lifecycle_0z.sql`,
payloads synthétiques dédiés) → concurrence provisional 0Z en **deux sessions
psql réelles** (`27`/`28a`/`28b`/`29` : la session A tient le verrou journée
~6 s, la session B bloque puis finit duplicate sans lignes ; blocage
chronométré, unicité de la provisional vivante et audit vérifiés) →
extraction des lignes canonical → reporting 0O via les fonctions
pures réelles → **destruction du conteneur** (trap, y compris en cas d'échec).

La garde serveur est appliquée avant les scénarios mutateurs :
`17a_server_readonly_guard_pre.sql` vérifie l'état initial fail-closed puis
active uniquement la base Docker jetable avec une raison auditée. Après les
suites E2E et concurrence, `17b_server_readonly_guard_post.sql` restaure
`mutations_enabled = false`, vérifie le refus RPC, l'absence d'écriture
partielle, l'append-only du journal et le comportement fail-closed si le
singleton manque. Cette activation locale ne vaut jamais autorisation staging
ou production.

L'API read-only est vérifiée avant activation, pendant l'activation locale
jetable, puis après le retour à `false`. Les tests prouvent qu'elle reflète
dynamiquement le singleton sans accorder au frontend un accès direct au schéma
privé ni exposer de setter.

`33_controlled_production_server_scope.sql` simule dans une transaction
rollbackée le tuple production `master=true`, `daily=true`, `admin=false`,
`backfill=false`. Il appelle directement les huit RPC mutatives, prouve le refus
des six chemins admin/backfill, l'accès des trois opérations daily à leurs
invariants métier, l'absence d'écriture partielle et les ACL fermées des cœurs.

Fichiers : `e2e0r_generate_payloads.ts`,
`25_e2e0r_historical_adoption_seed.sql`,
`26_e2e0r_historical_adoption_assert.sql`,
`16_provisional_lifecycle_0z.sql`,
`17a_server_readonly_guard_pre.sql`,
`17b_server_readonly_guard_post.sql`,
`18_runtime_lock_read_api.sql`,
`18a_runtime_lock_read_api_enabled.sql`,
`27_provisional_concurrency_setup_0z.sql`,
`28a_provisional_concurrency_session_a_0z.sql`,
`28b_provisional_concurrency_session_b_0z.sql`,
`29_provisional_concurrency_asserts_0z.sql`, `30_e2e0r_pipeline.sql`,
`33_controlled_production_server_scope.sql`,
`e2e0r_reporting_assert.ts`, `run_e2e_0r.sh`.

Deux points de contrat :

- **Anti-faux-E2E** : il n'existe **aucun** payload écrit à la main côté SQL.
  `30_e2e0r_pipeline.sql` consomme exclusivement `poc_test.e2e0r_payload`,
  alimentée par l'artefact généré depuis les classeurs Excel.
- **Frontière assumée** : la lecture du reporting est faite en **SQL direct**
  (projection et filtre identiques à la requête page réelle), pas via PostgREST.
  La couche PostgREST/JWT n'est pas exercée par ce harnais.

Sorties de succès : `ALL_E2E_0R_SQL_PASS`, `ALL_E2E_0R_REPORTING_PASS`, puis
`ALL_LOCAL_E2E_0R_PASS`.

Prérequis : Docker + image `postgres:15-alpine` déjà présente (le runner n'en
télécharge aucune), `psql` dans le PATH, `node_modules/` installé.

## Lot 1 opérationnel — décisions Daily v2 (PostgreSQL 17)

Migration `20261103120000_daily_v2_operational_decisions.sql` : statut `rejected`,
attestations de fichier, écartement, correction des seuls soldes, réfutation de
version justifiée source par source (livraison fraîche ou pièce archivée hors
application, mention déclarative), approbation groupée par fichier, clés de
commande, verrou de tentative, et exception H1 dans les deux cœurs vivants du
dépôt (doublon à version financière différente, dérivée et cohérente : lignes
conservées, sauf copie conforme déjà détenue). Enveloppes du dépôt, promotion
unitaire, cœur de promotion et `supersede` inchangés.

```powershell
pwsh -File supabase/tests/daily_statement_units_v2/run_operational_pg17.ps1
```

Conteneur `postgres:17-alpine` jetable au nom aléatoire, chaîne complète des
migrations, outils et identités de la suite trésorerie ; charges produites par le
**vrai** pipeline (`opfix_generate_payloads.ts`, classeurs synthétiques de
`src/features/daily-v2/dailyV2OperationalFixtures.synthetic.ts`), aucune empreinte
écrite à la main. Sortie : `DAILY_V2_OPERATIONAL_DECISIONS_PG17_PASS`.

| Fichier | Couverture |
|---|---|
| `33a_operational_setup.sql` | registre synthétique, autorisation de backfill, rôle admin, verrou ouvert, outils `opx` ; 17 charges synthétiques issues du vrai pipeline présentes |
| `44_lines_conformity.sql` | contre-revue CTO de la PR #156 : charge synthétique issue du vrai pipeline, aux agrégats décalés (contre-exemple CTO ; faux solde non observé sur les relevés réels), totaux décalés, soldes courants modifiés ; aucune journée admissible, motif rendu par le plan serveur ; promotion unitaire historique puis lecture « Soldes à date » sans solde ; réfutation contre une retenue non conforme refusée ; correction des seuls soldes ; mordants (sans la condition, la charge serait admissible et le solde décalé disponible) |
| `43_version_parity.sql` | test différentiel : 2 000 cas générés, règles de version de l'interface (`dailyV2Types`) = fonctions du serveur ; six issues couvertes |
| `40_duplicate_financial_version_lines.sql` | H1 : lignes conservées pour un doublon à version différente ; jamais pour même version, provisoire, `unavailable` ou incohérent ; réserve 4.2 (première copie inutilisable, copie valide conservée) |
| `41_version_comparison.sql` | comparaison à trois issues sur les charges synthétiques issues du vrai pipeline |
| `39_balance_only_correction.sql` | correction des seuls soldes : refus (mouvements différents, même version, version inutilisable, lignes non conformes, état périmé), adoption, rejeu |
| `36_version_refutation.sql` | F1 → C → F2 → redépôt identique de F2 ; pièce ; refus ; révocation ; unicité structurelle |
| `35_unit_rejection.sql` | écartement : statuts d'origine, contradiction refusée, R1 rejouée, état périmé |
| `34_attempt_attestations.sql` | attestations d'identité et de devise (Excel seul, fichier resélectionné), révocation |
| `37_batch_approval.sql` | approbation groupée : liste exacte, fichier entier, attestations, tout ou rien |
| `38a`–`38f` | deux courses à sessions réelles : écartement contre promotion ; rejeu après réponse perdue |

Le runner LOCAL-E2E-0R (`run_e2e_0r.sh`) applique aussi cette migration après les
scopes serveur, rejoue toutes ses suites (« doublon sans lignes » et cardinalité du
backfill inchangées) et vérifie les gardes des quatre nouvelles tables publiques
et de la lecture du plan d'approbation groupée (`42_operational_guard.sql`,
`42b_operational_guard_post.sql`).

## D1 — livraison provisoire tardive de version identique

Suites 45 et 46 : PostgreSQL 17 seulement (`run_operational_pg17.ps1`). Sous
PostgreSQL 15 (`run_e2e_0r.sh`), la migration D1 est appliquée et exercée par la
suite 16 et par les suites rejouées après elle.

Migration `20261108120000_daily_v2_d1_late_provisional_same_version.sql` : une
livraison demandée provisoire dont la version complète est celle du canonical
actif de la journée (relation `SAME_VERSION`, égalité numérique, absences
comprises), cohérente et aux lignes conformes (règle commune
`daily_stmt_line_facts_conform`) est reçue puis retirée (`superseded`, motif
`late_provisional_same_version_superseded`). L'activation d'une version
(promotion unitaire ou groupée, remplacement, correction des seuls soldes)
retire de même les seules provisoires vivantes identiques ; les divergentes,
incohérentes ou non conformes restent vivantes. Une livraison retirée garde ses
lignes, sauf copie conforme déjà détenue par le même fichier (redépôt). Elle
n'est ni promouvable, ni source de réfutation, ni preuve de clôture. Un ordre de
lignes ambigu (index de ligne et ordinal de même valeur entière, « 1 » et « 01 »
compris) n'est jamais retiré. Au dépôt comme à l'activation, les doublons
R1-provisional de la version active (redépôts du fichier tardif pendant la
fenêtre « déposée, non promue », réceptions héritées) sont retirés de même, si
leur réception R1-provisional est auditée, qu'une livraison du cycle provisoire
du même fichier, reçue sous la même version d'analyse identifiée, détient une
copie conforme de leurs lignes, et qu'aucune réfutation ne les désigne comme
preuve ; un doublon du canonical, d'une autre version, sans copie conforme de
son fichier ou d'une autre version d'analyse reste inchangé. La dispense de
copie au dépôt exige aussi la même version d'analyse identifiée.

`run_operational_pg17.ps1` rejoue les suites D1 après les suites 34 à 41 ;
`run_e2e_0r.sh` applique la migration D1 après les décisions opérationnelles,
avant `42_operational_guard.sql`, de sorte que `16_provisional_lifecycle_0z.sql`
(Z6a, Z6b, Z6c) et les suites suivantes s'exécutent sur les cœurs D1. La suite 16
exige donc, en plus de la chaîne de la section « Lancement », les migrations
jusqu'à `20261103120000` et la migration D1.

| Fichier | Couverture |
|---|---|
| `45a_d1_setup.sql` | outils `d1` : constructeurs à préimage indépendante, comptes provisionnés par la RPC registre et inscrits à l'inventaire Trésorerie, module ouvert et formats CSV ORABANK et BDK qualifiés (fixtures), manager synthétique, mutations et exécution « sans D1 » |
| `45b_d1_deposit_rules.sql` | V1 à V24 : retrait de la version identique, versions divergentes, `unavailable`, 10.5 = 10.50, incohérente, non conforme, divergente préservée à l'identique, héritées, fenêtre déposée-non promue, promotion groupée, remplacement, correction des soldes, promotion sans activation, clôture, BDK multi-journées, gardes, portée et rôles, redépôts (une copie de lignes par fichier), privilèges, parité de la règle de la charge, ordre de lignes ambigu, verrou de journée exigé, conformité des lignes stockées à l'activation, activation avec identique et divergente vivantes ; V25 (corrections C1 et W5) : retrait des doublons du cycle provisoire et témoins fermés (doublon canonique légitime, copie non conforme, version financière différente, autre fichier, doublon hérité retiré au dépôt, copie de faits différents, copie hors du cycle provisoire, version d'analyse différente, absente ou blanche, doublon désigné comme preuve de réfutation) ; V26 (correction C2) : collisions numériques d'index et d'ordinal (« 1 » / « 01 ») au dépôt et à l'activation, témoin à zéros initiaux ; oracle numérique de V20 ; V27 : dispense de copie refusée à une copie à ordre ambigu ; V28 : index hors du domaine entier sans erreur ; V29 : dispense de copie exigeant la même version d'analyse ; mordants M1 à M23 (M2a, M2b, M3b) |
| `45c_d1_treasury_reading.sql` | T1 à T7 par le vrai dépôt : B-17 synthétique, ordres de Q5, oracle Q6 et redépôts avec correction ultérieure, canonical présent sans preuve de clôture, divergente préservée, équivalents synthétiques CD et CF (BDK et ORABANK, avec et sans D1), non-régression BDK ; C1 : réceptions répétées du fichier tardif, ordres A à D convergents (statuts, audit, lignes, une source, lecture avant et après correction) ; W4 puis redépôt conforme de Y : doublon justifié retiré au dépôt, une source, lecture après correction identique à un compte sans fichier tardif ; caractérisation P2-1 (coexistence acceptée) ; mordants M1, M4, M2b, M10, M16 |
| `46a`–`46h` | cinq courses à sessions réelles : dépôt tardif contre promotion, promotion contre dépôt tardif (même état final), deux redépôts identiques à côté d'une divergente vivante, deux redépôts du fichier tardif pendant que la promotion attend (C4) et redépôt pendant une promotion (C5) : même état final, même lecture avant et après correction |

## Rappel d'arbitrage (lot 0J)

La candidate v1 (`structured_csv_import_v1`) est archivée hors du chemin live
dans `supabase/db-archive/structured_csv_import_v1/` ; la v2 est la seule
candidate présente dans `supabase/migrations/`. Aucune des deux n'est appliquée
en prod sans GO CTO explicite.
