# Plan — Création de `ARCHITECTURE_FONCTIONNELLE.md`

## Objectif
Créer **un seul** nouveau fichier Markdown à la racine du repo, en français, décrivant ce que l'application sodatra/bank-sync-flow est censée faire. Aucune modification de code, aucun nouveau composant, aucun changement de schéma.

## Fichier créé
- `ARCHITECTURE_FONCTIONNELLE.md` (racine du repo)

## Structure du document

### En-tête
- Titre, sous-titre, date, mention "document fonctionnel — ne décrit pas l'état d'implémentation runtime mais la cible métier".
- Mini sommaire des 4 diagrammes + section périmètre cible.

### Diagramme 1 — Inputs → Traitement → Outputs (`flowchart LR`)
- **Inputs** : Excel (`COLLECTION REPORT`, `FUND POSITION`, `CLIENT RECONCILIATION`) + relevés bancaires PDF/Excel (BDK, ATB, BICIS, ORA, SGS/SGBS, BIS).
- **Pipeline** : détection (`fileProcessingService` / `enhancedFileProcessingService`) → extraction (`excelProcessingService`, `bankReportProcessingService`, `bankReportSectionExtractor`, `advancedExtractionService`, `pdfjs`, `enhancedBDKExtractionService`, `positionalExtractionService`) → mapping (`excelMappingService`, regex EFFET vs CHEQUE) → sync intelligente (`intelligentSyncService`, contrainte `unique_excel_traceability`) → persistance (`databaseService`).
- **Tables Supabase** : `bank_reports`, `bank_facilities`, `deposits_not_cleared`, `impayes`, `collection_report`, `fund_position`, `fund_position_detail`, `fund_position_hold`, `client_reconciliation`.
- **Outputs** : Dashboard consolidé, Vue cross-bank, Alertes critiques, Contrôle qualité, Réconciliation, Rapports bancaires.
- Paragraphe sous-jacent : tables/services concernés, ce qui marche (Excel COLLECTION REPORT idempotent, sync 648 lignes, BDK 7 colonnes), ce qui n'est pas implémenté (`bdk_analysis` annoncé dans `enhancedFileProcessingService.processOrganizedFiles`, parsers ATB/BICIS/ORA/SGS/BIS partiels).

### Diagramme 2 — Cycle effet / chèque / impayé (`stateDiagram-v2`)
- États : `NEW` → `PENDING` (effet ou chèque) → `PAID`/`IMPAYE` ou `CLEARED`/`BOUNCED`, rebouclage `IMPAYE` → `reglement_impaye` → `RESOLU`.
- Paragraphe : table `collection_report` (`processing_status`, `effet_status`, `cheque_status`, `date_of_validity`, `date_of_impay`, `reglement_impaye`), services `excelMappingService` (détection EFFET/CHEQUE), `intelligentSyncService` (enrichissement). Fonctionnel : extraction des champs et persistance. Non implémenté : moteur de transition d'état automatique, alertes d'échéance effet.

### Diagramme 3 — Trésorerie / Fund Position (`flowchart TB`)
- Entrées : `bank_reports` (open/close), `bank_facilities` (utilisation), `deposits_not_cleared`, `fund_position_hold`, `impayes` agrégés vers `client_reconciliation`.
- Sorties : `fund_position` + `fund_position_detail`, total liquidité, montant à risque, recommandations.
- Paragraphe : services `dashboardMetricsService`, `crossBankAnalysisService`, `bankingUniversalService`. Fonctionnel : structure des tables, agrégation de base. Non implémenté : moteur de recommandations, calcul cross-bank de risque, `BankingDashboard.tsx` utilise `mockData` (ligne 59).

### Diagramme 4 — Bénéfices utilisateur (`mindmap`)
- 3 branches : Comptabilité bancaire, Trésorerie, Recouvrements clients (sous-feuilles selon le brief).
- Paragraphe : pages cibles (`ConsolidatedDashboard`, `BankingDashboard`, `BankingReports`, `Reconciliation`, `Alerts`, `QualityControl`). Fonctionnel : Upload, sync Excel, affichage consolidé partiel. Non implémenté : `BankingDashboard` et `BankingReports` mockés, alertes d'effets à échéance non câblées.

### Section finale — Périmètre fonctionnel cible
Trois sous-sections en français courant pour DAF / trésorier / comptable :
1. **Comptabilité bancaire** — consolidation multi-banques, suivi des facilités, réconciliation des écritures.
2. **Trésorerie** — fund position quotidienne, alertes liquidité, suivi des dépôts en attente.
3. **Recouvrements clients** — suivi des impayés, agrégation cross-bank par client, alertes effets à échéance, traçabilité Excel→DB ligne par ligne (`excel_filename` + `excel_source_row` + `unique_excel_traceability`).

## Règles respectées
- Un seul fichier créé, aucun code modifié.
- 100% français.
- 4 diagrammes Mermaid distincts (`flowchart LR`, `stateDiagram-v2`, `flowchart TB`, `mindmap`) intégrés en blocs ` ```mermaid `.
- Distinction explicite "fonctionnel aujourd'hui" vs "annoncé / non implémenté" pour chaque diagramme, sans rien inventer.
- Pas de mention d'éléments hors codebase.

## Hors périmètre
- Pas de patch sur `intelligentSyncService`, `databaseService`, `excelMappingService`, etc.
- Pas de mise à jour de `STATUS_REGISTRY.md` ni `DEFERRED_BACKLOG.md`.
- Pas de migration, RLS, edge function.
