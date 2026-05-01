# SECURITY BACKLOG — Bank Sync Flow

> Suivi des sujets sécurité ouverts. Ne contient aucune correction runtime.

## Résumé

Le linter Supabase détecte **60 warnings** :
- 27 policies RLS avec `USING(true)` / `WITH CHECK(true)`
- 13 tables exposées via GraphQL à anon
- 13 tables exposées via GraphQL à authenticated
- 2 fonctions SECURITY DEFINER appelables par anon
- 2 fonctions SECURITY DEFINER appelables par authenticated
- OTP expiry trop long
- Leaked password protection désactivée
- Postgres avec patches sécurité disponibles

---

## P0 — Critique

### SEC-01 : Sign-up public toujours actif côté Supabase

**État** : `MANUAL_PENDING` — action manuelle utilisateur requise dans le Dashboard Supabase.
**Risque** : N'importe qui peut créer un compte et accéder à toutes les données bancaires (combiné avec RLS permissives).
**Action** : Désactiver "Enable sign ups" dans Authentication → Providers → Email dans le dashboard Supabase.
**Lien** : https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/auth/providers

### SEC-02 : RLS permissives sur 10 tables

**État** : `CLOSED_PENDING_FUNCTIONAL_TESTS` — corrigé par la migration Lot 2B (`supabase/migrations/20260430150428_04e86234-f4a5-447b-8638-8f85518fa4ef.sql`). Vérification post-migration : 0 policy `USING(true)` / `WITH CHECK(true)` restante en schéma `public`. Clôture définitive après tests applicatifs.
**Risque** : Tout utilisateur authentifié peut lire, écrire, modifier et supprimer toutes les données de toutes les tables (sauf `user_roles`, `bank_audit_log`, `universal_bank_reports` qui ont des policies correctes).

**Tables concernées** :
| Table | Policies `true` | Operations exposées |
|---|---|---|
| `bank_reports` | 7 | SELECT, INSERT, UPDATE, ALL |
| `bank_facilities` | 5 | SELECT, INSERT, ALL |
| `deposits_not_cleared` | 5 | SELECT, INSERT, ALL |
| `fund_position` | 5 | SELECT, INSERT, ALL |
| `fund_position_detail` | 5 | SELECT, INSERT, ALL |
| `fund_position_hold` | 5 | SELECT, INSERT, ALL |
| `impayes` | 5 | SELECT, INSERT, ALL |
| `client_reconciliation` | 3 | SELECT, INSERT, ALL |
| `bank_evolution_tracking` | 2 | ALL |
| `collection_report` | 1 | INSERT |

**Problème additionnel** : la plupart des tables ont des policies dupliquées (2-3 policies pour la même opération). À nettoyer.

### SEC-03 : Décision mono-société vs multi-tenant

**État** : `CLOSED` — modèle mono-société SODATRA invite-only acté et appliqué par les policies de la migration Lot 2B (vérification de rôle valide parmi `admin`, `manager`, `auditor`, `user`).
**Contexte** : Aucune table (sauf `universal_bank_reports`) n'a de `user_id`. L'architecture actuelle est de facto mono-société.
**Décision préliminaire CTO** : mono-société / invite-only.
**Impact** : Si mono-société, les policies doivent vérifier un rôle valide parmi admin, manager, auditor ou user. Ne pas supposer qu'un admin possède aussi le rôle user. Si multi-tenant, il faut ajouter `organization_id` partout.

### SEC-04 : Auditer les utilisateurs existants

**État** : `IN_PROGRESS` — promotion admin additive faite pour `sodatrasn@gmail.com` via Lot 2B. Reste à confirmer la liste complète de `auth.users` et supprimer d'éventuels comptes non autorisés.
**Action** : Vérifier quels comptes existent dans `auth.users`, supprimer les comptes non autorisés, s'assurer que les rôles sont correctement assignés.
**Lien** : https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/auth/users

---

## P1 — Important / Lot 2 ou 2B

### SEC-05 : GraphQL schema exposé à anon

**État** : À corriger
**Risque** : Toutes les tables sont découvrables via l'API GraphQL sans authentification.
**Action** : Révoquer `SELECT` sur `anon` pour toutes les tables, ou désactiver pg_graphql si non utilisé.

### SEC-06 : Fonctions SECURITY DEFINER callable par anon

**État** : `CLOSED` — corrigé par la migration Lot 2B : `REVOKE EXECUTE ... FROM PUBLIC` sur `has_role` et `handle_new_user`, `GRANT EXECUTE` sur `has_role` à `authenticated` et `service_role` uniquement.
**Fonctions** : `has_role`, `handle_new_user`
**Action** : `REVOKE EXECUTE ON FUNCTION has_role FROM anon;` et idem pour `handle_new_user`.

### SEC-07 : Policies insert collection_report trop ouvertes

**État** : `CLOSED` — policies `collection_report` refaites en Lot 2B avec `WITH CHECK` basé sur `has_role` (admin/manager pour INSERT/UPDATE, admin pour DELETE).
**Détail** : `authenticated_insert_collections` a `WITH CHECK (true)` alors que les autres policies de `collection_report` utilisent `has_role`. Incohérence.

---

## P2 — Souhaitable / Différé

### SEC-08 : Supabase URL et anon key hardcodées

**État** : Différé
**Fichier** : `src/integrations/supabase/client.ts`
**Contexte** : L'anon key est une clé publique, acceptable côté frontend. Le vrai risque vient de la combinaison avec les RLS permissives (P0). Passer en `import.meta.env` serait plus propre mais non urgent.

### SEC-09 : OTP expiry trop long

**État** : Différé
**Action** : Réduire dans Supabase Dashboard → Authentication → Settings.

### SEC-10 : Leaked password protection désactivée

**État** : Différé
**Action** : Activer dans Supabase Dashboard → Authentication → Settings.

### SEC-11 : Postgres version avec patches sécurité

**État** : Différé
**Action** : Upgrader Postgres via Supabase Dashboard.

---

## Tables correctement protégées (référence)

| Table | Protection |
|---|---|
| `user_roles` | Admin-only INSERT/UPDATE/DELETE, user voit ses propres rôles |
| `bank_audit_log` | Admin-only SELECT, no UPDATE/DELETE, INSERT scoped à user_id |
| `universal_bank_reports` | Policies basées sur user_id et has_role |
