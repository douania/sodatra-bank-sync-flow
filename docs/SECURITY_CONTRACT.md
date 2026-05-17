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

## 5. Fonctions SECURITY DEFINER

Toute fonction `SECURITY DEFINER` doit être auditée.

Règles :
- pas d'EXECUTE accordé à `PUBLIC` ;
- pas d'EXECUTE à `anon` sauf justification explicite CTO ;
- `search_path` maîtrisé si applicable ;
- usage `service_role` strictement limité aux opérations nécessaires.

## 6. Clé Supabase anon / environnement

La clé anon est publishable côté frontend, mais ne doit pas être hardcodée dans le code source.

Règle :
- utiliser `VITE_SUPABASE_URL` ;
- utiliser `VITE_SUPABASE_PUBLISHABLE_KEY` ;
- ne jamais committer `.env` réel ;
- rotation manuelle requise si clé exposée dans historiques/zips/commits.

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
