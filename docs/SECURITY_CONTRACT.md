# SECURITY CONTRACT — Bank Sync Flow

> Contrat sécurité stable du projet.
> Ce fichier définit les règles à respecter avant tout patch touchant Supabase, Auth, RLS, rôles, fonctions SQL ou données bancaires.

## 1. Modèle d'accès

Le modèle actuel est mono-société SODATRA, invite-only.

Il n'y a pas de modèle multi-tenant actif.
Ne pas introduire `organization_id`, `company_id` ou logique multi-société sans décision CTO séparée.

## 2. Rôles applicatifs

Rôles utilisés :
- `admin`
- `manager`
- `auditor`
- `user`

Règle :
- un utilisateur valide doit avoir au moins un rôle applicatif autorisé ;
- ne pas supposer qu'un admin possède automatiquement le rôle `user` ;
- toute logique RLS doit vérifier explicitement les rôles autorisés.

## 3. Sign-up public

Le sign-up public doit rester désactivé dans Supabase.

Le projet est invite-only.
Aucun écran UI ne doit réintroduire une inscription publique.

## 4. RLS — règles minimales

Interdits :
- policy `USING (true)` ;
- policy `WITH CHECK (true)` ;
- accès large à `authenticated` sans rôle applicatif ;
- accès `anon` aux données métier ;
- DELETE non admin.

Règles générales :
- SELECT : rôle valide selon périmètre métier ;
- INSERT : `admin` ou `manager`, sauf table explicitement append-only ;
- UPDATE : `admin` ou `manager`, avec `WITH CHECK` cohérent ;
- DELETE : `admin` uniquement ;
- audit logs : append-only, pas d'UPDATE/DELETE utilisateur.

## 4.1. Surfaces API et privilèges `anon`

La RLS et les grants sont deux barrières complémentaires : la RLS filtre les
lignes, tandis que les grants déterminent si une table, vue, séquence ou
fonction est atteignable par les API Supabase.

Règles :
- `anon` et `PUBLIC` ne reçoivent aucun privilège sur les objets métier ;
- les futurs objets du schéma `public` naissent fermés à `anon` ;
- toute ouverture anonyme exige une justification CTO explicite, une matrice
  grants/RLS et des tests dédiés ;
- `pg_graphql` reste désactivé tant qu'aucun consommateur versionné et approuvé
  ne le requiert ; sa réactivation exige un GO sécurité séparé ;
- le défaut PostgreSQL `EXECUTE` accordé à `PUBLIC` sur les nouvelles fonctions
  créées par `postgres` est révoqué globalement, tous schémas confondus ; chaque
  exposition future doit être un `GRANT` explicite au rôle nécessaire ;
- masquer l'introspection GraphQL ne constitue pas un contrôle d'accès et ne
  remplace ni la révocation des grants ni la RLS.

## 5. Fonctions SECURITY DEFINER

Toute fonction `SECURITY DEFINER` doit être auditée.

Règles :
- pas d'EXECUTE accordé à `PUBLIC` ;
- pas d'EXECUTE à `anon` sauf justification explicite CTO ;
- `search_path` maîtrisé si applicable ;
- usage `service_role` strictement limité aux opérations nécessaires.

## 6. Clé API Supabase publishable / environnement

La clé API publishable moderne (`sb_publishable_*`) est publique côté frontend,
mais ne doit pas être hardcodée dans le code TypeScript. Les anciennes clés JWT
`anon` ne doivent pas être réintroduites après leur retrait du build.

Règle :
- utiliser `VITE_SUPABASE_URL` ;
- utiliser `VITE_SUPABASE_PUBLISHABLE_KEY` ;
- ne jamais committer de surcharge locale : `.env.local` et `.env.*.local`
  restent ignorés ;
- migration ou rotation manuelle requise sur décision CTO lorsqu'une clé legacy
  doit être retirée, ou si une clé est compromise, **sauf** le cas explicitement
  prévu ci-dessous du versionnement intentionnel de la clé frontend publishable
  moderne dans `.env`.

Exception unique et bornée — `.env` :

`.env` est **versionné** parce que c'est le **seul canal supporté par Lovable**
pour transmettre les variables `VITE_*` au build : le fichier doit être au
dépôt, sous ce nom exact. Un `.env.production` versionné **n'est pas lu** par
ce build — constat vérifié le 29 juillet 2026 sur le preview reconstruit, où
les variables restaient compilées à `undefined`. Ce fichier ne contient que
les **trois** valeurs publiques frontend :

- `VITE_SUPABASE_URL` ;
- `VITE_SUPABASE_PUBLISHABLE_KEY` ;
- `VITE_SUPABASE_PROJECT_ID`.

Ce que cette clé est, exactement :

- elle porte le préfixe `sb_publishable_`, est **publique par conception** et
  embarquée dans tout bundle navigateur
  livré ; elle n'est pas un secret ;
- elle **permet d'émettre des appels API sous le rôle `anon`** vers le projet
  visé — la publier revient donc à publier cette capacité d'appel ;
- elle **ne contourne ni les grants ni la RLS** : elle n'élève aucun privilège
  et ne donne accès à rien qui ne soit déjà ouvert au rôle `anon` ;
- les droits effectifs dépendent **des grants, des policies RLS, d'Auth/JWT et
  des surfaces API exposées** (tables, vues, RPC, Storage, Edge Functions).

Constat d'exposition daté — **29 juillet 2026** : sur les surfaces
effectivement testées à cette date (tables métier héritées et tables Daily v2,
via requêtes REST anonymes et lecture des métadonnées de policies), aucune
donnée n'était lisible sans session autorisée : réponses vides sous RLS, ou
refus de privilège. Ce constat est **limité aux surfaces testées** et **daté** :
ce n'est pas une propriété universelle garantie par la clé elle-même, et il ne
couvre pas les surfaces non exercées ce jour-là.

En conséquence, toute modification de grants, de policies RLS, de RPC, de vues,
de Storage ou d'Edge Functions **impose une nouvelle validation de l'exposition
anonyme** avant d'être considérée comme sûre.

Interdits dans ce fichier, sans exception :
- `service_role`, `sb_secret_*` ou toute clé backend/privilégiée ;
- toute variable non `VITE_` ;
- toute valeur d'un projet autre que la production autorisée ;
- toute donnée bancaire.

Les rapports et les journaux **masquent toujours la valeur complète** de la clé
(préfixe et longueur uniquement). Toute autre clé, tout autre fichier
d'environnement (`.env.local`, `.env.*.local`, `.env.production`…) restent
interdits au dépôt : `.env` est le seul fichier d'environnement versionné.

Rotation — ce qui l'exige et ce qui ne l'exige pas :

- le **versionnement intentionnel**, dans `.env` et nulle part ailleurs, de la
  clé production `sb_publishable_*` sélectionnée dans le Dashboard du projet
  autorisé **n'est pas à lui seul un incident** et **n'exige aucune rotation** :
  c'est le régime normal d'une valeur publique de build, décidé et tracé par GO
  CTO. Les clés modernes sont opaques : la cible reste verrouillée séparément
  par `VITE_SUPABASE_URL` et `VITE_SUPABASE_PROJECT_ID` ;
- la rotation **reste obligatoire** en cas d'exposition d'une clé backend
  (`service_role`, `sb_secret_*`, toute clé privilégiée), d'exposition non
  autorisée d'une autre clé, de compromission avérée ou suspectée, ou sur
  décision de sécurité du CTO ;
- toute rotation de la clé **frontend** n'implique **aucune modification de la
  logique applicative**, mais impose de mettre à jour `.env`, de
  **reconstruire** le frontend, puis de **valider le runtime** sur la cible ;
- le versionnement historique de l'ancienne clé JWT `anon` sous le nom
  `.env.production` (PR #104), puis `.env`, n'était pas un incident de secret :
  cette clé était elle aussi publique. Elle reste néanmoins interdite dans le
  build après la migration SEC-ENV-1 vers `sb_publishable_*` ;
- la désactivation des clés JWT d'API historiques et la migration des clés de
  signature Auth sont deux opérations distinctes, chacune soumise à son GO
  d'environnement et à une validation runtime dédiée.

L'interdiction absolue des clés backend au dépôt demeure inchangée, sans
exception d'aucune sorte.

## 7. Données bancaires

Les données bancaires sont sensibles.

Interdits :
- logs contenant des données bancaires complètes ;
- mocks présentés comme données réelles ;
- fallback silencieux créant des dates, montants, clients ou lignes artificielles ;
- génération de traçabilité artificielle ;
- contournement de l'idempotence.

## 8. Idempotence import

Pour `collection_report`, la règle canonique est :
`(excel_filename, excel_source_row)`

Interdits :
- réintroduire `UNKNOWN_FILE`, `IMPORT_*`, `DAILY_IMPORT` ;
- utiliser `Math.random()` ou `Date.now()` pour contourner une contrainte ;
- réintroduire un upsert basé sur `unique_excel_traceability` comme source métier principale.

## 9. DB / migrations

Avant toute migration :
1. lire `docs/DB_TRUTH.md` ;
2. vérifier l'état réel Supabase ;
3. exécuter les requêtes read-only préalables ;
4. tester sur staging ;
5. obtenir GO CTO.

Interdits :
- réécrire les migrations historiques ;
- modifier `cold_shore` / `shiny_waterfall` ;
- exécuter DB-FREEZE-1B sans staging ;
- modifier trigger/contrainte/index critique sans plan CTO.

## 10. Lovable / runtime

Lovable doit être utilisé prioritairement pour :
- UI preview ;
- SELECT DB live ;
- tests runtime ;
- validation visuelle ;
- petits patchs UI après GO CTO.

Pour économiser les crédits :
- privilégier Plan mode ;
- interdire les modifications sans validation ;
- limiter strictement le périmètre ;
- ne pas combiner audit + patch + tests dans une seule demande.

## 11. GitHub / patch

Tout patch doit :
- avoir une branche dédiée ;
- avoir un objectif unique ;
- lister fichiers autorisés et interdits ;
- ne pas faire de refactor global ;
- préserver RLS, idempotence et intégrité ;
- expliquer pourquoi le problème existe ;
- expliquer comment le correctif le résout ;
- inclure tests attendus.

## 12. FROZEN sécurité

FROZEN sauf GO CTO explicite :
- RLS/Auth ;
- fonctions SECURITY DEFINER ;
- migrations historiques ;
- logique d'idempotence ;
- pipeline Excel stabilisé Lot 3 ;
- vérité DB `collection_report`.
