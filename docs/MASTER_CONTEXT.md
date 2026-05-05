# MASTER CONTEXT — Bank Sync Flow (SODATRA)

> Source de vérité pour le contexte projet. À lire avant toute intervention.

## Objectif de l'application

Bank Sync Flow est un outil interne de gestion bancaire pour SODATRA. Il vise à :

- Centraliser les rapports bancaires (BDK, SGS, BICIS, ATB, ORA, BIS) à partir de fichiers Excel et PDF importés manuellement.
- Suivre les impayés, les collections, les facilités bancaires et la position de trésorerie.
- Fournir des tableaux de bord consolidés et des alertes sur les risques.

**Il n'y a aucune connexion API directe aux banques.** Toute donnée provient d'imports manuels Excel/PDF.

## État actuel

**Prototype / non production-ready.**

L'application contient un mélange de :
- Vraie logique métier fonctionnelle (import Excel, extraction PDF BDK, stockage Supabase).
- Modules de démonstration avec données simulées (dashboards, rapprochement, alertes).
- Sécurité insuffisante (RLS permissives, sign-up public).

**Règle CTO : aucune nouvelle fonctionnalité avant correction des P0 sécurité et intégrité.**

## Architecture

| Couche | Technologie |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript 5 + Tailwind CSS v3 |
| UI | shadcn/ui |
| Backend | Supabase (Auth, PostgreSQL, RLS) |
| Hébergement | Lovable |
| État | React Query + useState local |

Pas de serveur backend custom. Pas d'Edge Functions déployées. Pas de CI/CD.

## Flux principal

```
Excel/PDF → Upload (FileUpload.tsx) → Parsing client-side → Supabase tables → Dashboard
```

1. L'utilisateur uploade un fichier Excel ou PDF.
2. Le parsing est fait entièrement côté client (services TypeScript).
3. Les données extraites sont insérées dans les tables Supabase.
4. Le Dashboard affiche les données depuis Supabase.

## État des modules

### Fiables (connectés aux données réelles)

| Module | Page | Notes |
|---|---|---|
| Import fichiers Excel | `/upload` | Fonctionnel mais parsing permissif (voir DEFERRED_BACKLOG) |
| Import bulk | `/upload-bulk` | Partiellement fiable / à vérifier — pipelines d'import divergents |
| Dashboard principal | `/dashboard` | Connecté à Supabase, mais dépend de la fiabilité des données importées et de la correction des RLS |
| Contrôle qualité | `/quality-control` | Analyse les données importées |
| Analyse documents | `/document-understanding` | Extraction PDF |

### Mockés ou non connectés (retirés de la nav — Lot 1)

| Module | Page | Problème |
|---|---|---|
| Banking Dashboard | `/banking/dashboard` | Données 100% simulées (`mockData`) |
| Rapports Bancaires | `/banking/reports` | Génération simulée |
| Vue Consolidée | `/consolidated` | Données simulées dans composant |
| Alertes | `/alerts` | Alertes historiques simulées |
| Rapprochement | `/reconciliation` | Moteur génère résultats fictifs client-side, pas de persistance |

Ces pages affichent un bandeau d'avertissement et ne sont plus accessibles depuis la navigation principale. Les routes restent actives pour accès développeur.

### Composants orphelins ou dupliqués

- `src/components/ConsolidatedDashboard.tsx` — composant avec données simulées, non routé directement.
- `src/components/ProcessingResultsDetailed copy.tsx` — copie non nettoyée.
- `src/services/extractionService_PRODUCTION.ts` — version alternative non utilisée en production.

## Décisions CTO prises

1. **Lot 1** : Retirer les modules mockés de la navigation, ajouter des bandeaux, supprimer le sign-up UI, corriger le reset password.
2. **Modèle d'accès** : mono-société (SODATRA uniquement) — à confirmer formellement en Lot 2.
3. **Pas de refactoring global** : corrections par micro-lots chirurgicaux, vérifiables et réversibles.
4. **Ordre de priorité** : Sécurité → Intégrité données → Nettoyage → Fonctionnalités.
5. **Lot 2B (2026-04-30, clôturé 2026-05-04)** : RLS durcies pour 11 tables métier via migration additive versionnée (`supabase/migrations/20260430150428_04e86234-f4a5-447b-8638-8f85518fa4ef.sql`). Modèle mono-société invite-only acté. Sign-up Supabase désactivé (Authentication → Sign In / Providers → *Allow new users to sign up* = OFF, vérifié visuellement). Tests fonctionnels validés avec `sodatrasn@gmail.com` (login, dashboard, lecture `collection_report`, import simple, console sans `42501`, logs Postgres sans `permission denied`). Statut : `CLOSED`.
6. **Lot 3 (2026-05-04, clôturé 2026-05-05)** : sécurisation de l'import Excel `CLOSED`. Lot 3A (audit & plan) + Lot 3B découpé en micro-patches indépendants tous clôturés : `3B.0` docs, `3B.1` traçabilité obligatoire (+ `3B.1.bis` idempotence, `3B.1.ter` sélection feuille / clientCode obligatoire, `3B.1.quater` migration varchar→text), `3B.2` dates sans fallback (+ `3B.2.bis` succès partiel contrôlé), `3B.3` headers obligatoires, `3B.4` montants (suppression `Math.trunc`/`Math.abs`, décimales et signe préservés), `3B.5` tests finaux T1–T8 + clôture documentaire. Tous les P0 du Lot 3A traités. Restent ouverts hors périmètre : DEF-05, DEF-10, DEF-14, DEF-15. Détails : `docs/STATUS_REGISTRY.md`.

## Base de données

13 tables Supabase. Schéma détaillé dans les types générés (`src/integrations/supabase/types.ts`).

Tables principales : `bank_reports`, `collection_report`, `impayes`, `bank_facilities`, `deposits_not_cleared`, `fund_position`, `fund_position_detail`, `fund_position_hold`, `client_reconciliation`, `bank_evolution_tracking`, `bank_audit_log`, `universal_bank_reports`, `user_roles`.

## Audits réalisés

- **Audit Claude (Phase 1)** : sécurité, RLS, imports, mock, migrations. Base de travail principale.
- **Audit Manus** : confirme les constats Claude, ajoute le rapprochement fictif comme alerte.
