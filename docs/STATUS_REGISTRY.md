# STATUS REGISTRY — Bank Sync Flow

> Registre des lots de stabilisation. Mis à jour après chaque lot.

## Statuts possibles

| Statut | Signification |
|---|---|
| `CLOSED` | Terminé, validé |
| `CLOSED_WITH_RESERVE` | Terminé avec réserve documentée |
| `TO_DOCUMENT` | Fait mais pas encore documenté formellement |
| `PLANNED` | Planifié, non commencé |
| `IN_PROGRESS` | En cours |
| `DEFERRED` | Reporté volontairement |

---

## Lot 1 — Sécurité UI + Vérité produit

**Statut : CLOSED_WITH_RESERVE**

**Objectif** : Rendre l'interface plus honnête et supprimer l'accès sign-up public côté UI.

**Fichiers modifiés** :
- `src/pages/Auth.tsx` — Onglet Sign Up et `handleSignUp` supprimés
- `src/pages/ResetPassword.tsx` — Attend `authLoading` avant redirection + spinner
- `src/components/Layout.tsx` — 4 entrées nav retirées (Banking Dashboard, Rapports Bancaires, Vue Consolidée, Alertes)
- `src/pages/BankingDashboard.tsx` — Early return avec bandeau "données de démonstration"
- `src/pages/BankingReports.tsx` — Early return avec bandeau "données de démonstration"
- `src/pages/Alerts.tsx` — Réécrit avec bandeau uniquement
- `src/pages/ConsolidatedDashboard.tsx` — Réécrit avec bandeau uniquement

**Réserve** : `src/services/supabaseClientService.ts` modifié hors périmètre initial (voir TS-0).

**Hors scope** : Migrations, RLS, pipeline Excel, AuthContext.signUp, App.tsx.

---

## Lot 1B — Rapprochement retiré de la nav + bandeau

**Statut : CLOSED**

**Objectif** : Suite audit Manus, retirer aussi le module Rapprochement de la navigation et ajouter un bandeau.

**Fichiers modifiés** :
- `src/components/Layout.tsx` — Entrée "Rapprochement" retirée
- `src/pages/Reconciliation.tsx` — Bandeau d'avertissement ajouté

**Hors scope** : `BankReconciliationEngine.tsx` non modifié.

---

## TS-0 — Hotfix typage HeartbeatService

**Statut : TO_DOCUMENT**

**Fichier** : `src/services/supabaseClientService.ts`
**Nature** : `NodeJS.Timeout` → `ReturnType<typeof setInterval>` (correction TypeScript uniquement)
**Impact métier** : Nul. Corrige une erreur de compilation pré-existante.

---

## DOC-1 — Documentation CTO minimale

**Statut : CLOSED**

**Objectif** : Créer la documentation interne pour tracer l'état réel du projet.

**Fichiers créés** :
- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_BACKLOG.md`
- `docs/DEFERRED_BACKLOG.md`

---

## Lot 2B — Sécurité Supabase / RLS (migration additive)

**Statut : CLOSED_PENDING_FUNCTIONAL_TESTS**

**Objectif** : Durcir réellement l'accès aux données via RLS additives, sans casser l'existant.

**Migration versionnée** :
`supabase/migrations/20260430150428_04e86234-f4a5-447b-8638-8f85518fa4ef.sql`

Le repo GitHub est aligné avec l'état réel Supabase. Aucune ré-exécution n'est nécessaire.

**Contenu de la migration** (transaction `BEGIN/COMMIT`, idempotente) :
- Promotion admin **additive** pour `sodatrasn@gmail.com` (`9539d4f5-a600-4bf7-931f-315e597e4441`) via `INSERT ... ON CONFLICT DO NOTHING` — le rôle `user` est conservé.
- `REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC` + `GRANT ... TO authenticated, service_role`.
- `REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC` (aucun grant à `authenticated`).
- `DROP POLICY IF EXISTS` + `CREATE POLICY` pour 11 tables métier (`bank_reports`, `bank_facilities`, `bank_evolution_tracking`, `collection_report`, `client_reconciliation`, `deposits_not_cleared`, `fund_position`, `fund_position_detail`, `fund_position_hold`, `impayes`, `universal_bank_reports`).
- Modèle de droits :
  - **SELECT** : `admin`, `manager`, `auditor` ou `user`.
  - **INSERT / UPDATE** : `admin` ou `manager` (avec `WITH CHECK` explicite).
  - **DELETE** : `admin` uniquement.
- `universal_bank_reports` : les rapports orphelins (`user_id IS NULL`) restent visibles uniquement par `admin` et `manager`.

**Vérifications post-migration effectuées** :
- `sodatrasn@gmail.com` possède bien `user` + `admin`.
- 0 policy `USING(true)` ou `WITH CHECK(true)` restante en schéma `public`.
- Les fonctions `SECURITY DEFINER` ne sont plus exécutables par `anon` / `PUBLIC`.

**Note importante** : la "distribution uniforme 4 policies × 13 tables" n'est **pas** un objectif. `user_roles`, `bank_audit_log` et `universal_bank_reports` ont volontairement des policies spécifiques à leur usage (admin-only, append-only audit, scoping par `user_id`).

**Reste à faire avant `CLOSED`** :
1. **SEC-01 — action manuelle utilisateur** : désactiver le sign-up dans le Dashboard Supabase
   → Authentication → Providers → Email → *Disable sign ups*.
   Lien : https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/auth/providers
2. **Tests fonctionnels** avec `sodatrasn@gmail.com` :
   - Login OK.
   - Dashboard chargé sans erreur console.
   - Lecture `collection_report` OK.
   - Import simple OK.
   - Console navigateur : aucune erreur RLS / `42501`.
   - Logs Supabase : aucun `permission denied for table ...`.

Une fois les deux conditions remplies, passer le statut à `CLOSED` et ouvrir Lot 3.

---

## Lot 3 — Import Excel fiable

**Statut : PLANNED**

**Périmètre prévu** :
- Interdire les dates fallback "du jour" automatiques
- Interdire les lignes sans traçabilité Excel
- Interdire Math.random() pour contourner les contraintes d'unicité
- Ne plus tronquer les montants avec Math.trunc
- Valider les headers Excel avant import

---

## Lot 4 — Nettoyage code mock / code mort

**Statut : DEFERRED**

**Périmètre prévu** :
- Supprimer le code mock des pages bannérisées ou les convertir en modules réels
- Supprimer les fichiers orphelins (`ProcessingResultsDetailed copy.tsx`, `extractionService_PRODUCTION.ts`)
- Nettoyer les imports inutilisés
- Supprimer les migrations historiques discardées
