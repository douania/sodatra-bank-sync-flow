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

**Statut : IN_PROGRESS**

**Objectif** : Créer la documentation interne pour tracer l'état réel du projet.

**Fichiers créés** :
- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_BACKLOG.md`
- `docs/DEFERRED_BACKLOG.md`

---

## Lot 2 — Sécurité Supabase / RLS

**Statut : PLANNED**

**Objectif** : Sécuriser réellement l'accès aux données.

**Périmètre prévu** :
- Désactiver sign-up côté Supabase Dashboard (action manuelle)
- Auditer les utilisateurs existants dans auth.users
- Confirmer le modèle mono-société invite-only
- Corriger les RLS `USING(true)` / `WITH CHECK(true)` sur les 10 tables concernées
- Nettoyer les policies dupliquées
- Révoquer l'accès GraphQL anon
- Restreindre `has_role` EXECUTE à authenticated

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
