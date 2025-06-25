
# Documentation des Fonctionnalités SODATRA

## Vue d'Ensemble
SODATRA est une application d'analyse bancaire qui traite les rapports de collecte et génère des analyses consolidées.

## Fonctionnalités Principales

### 1. Upload et Traitement de Fichiers
**Localisation**: `src/pages/FileUpload.tsx`

**Fonctionnalités**:
- Upload de fichiers Excel (.xlsx, .xls)
- Détection automatique du format bancaire
- Validation des données
- Traitement par lots

**Services associés**:
- `fileProcessingService.ts`
- `excelProcessingService.ts`
- `bankReportProcessingService.ts`

### 2. Tableau de Bord Consolidé
**Localisation**: `src/pages/ConsolidatedDashboard.tsx`

**Métriques affichées**:
- Montants totaux par banque
- Évolution temporelle
- Indicateurs de performance
- Alertes qualité

### 3. Contrôle Qualité
**Localisation**: `src/pages/QualityControl.tsx`

**Fonctionnalités**:
- Détection des doublons
- Validation des montants
- Rapport de conformité
- Suggestions d'amélioration

### 4. Gestion des Alertes
**Localisation**: `src/pages/Alerts.tsx`

**Types d'alertes**:
- Incohérences de données
- Échecs de traitement
- Problèmes de connectivité
- Seuils dépassés

## Services Techniques

### 1. Service de Persistance du Progrès
**Fichier**: `src/services/progressPersistenceService.ts`

**Fonctionnalités**:
- Sauvegarde automatique de l'état
- Récupération après déconnexion
- Suivi du temps écoulé
- Gestion de session

### 2. Service Client Supabase Optimisé
**Fichier**: `src/services/supabaseClientService.ts`

**Optimisations**:
- Système de retry automatique
- Timeouts étendus
- Heartbeat de connexion
- Insertion par lots

### 3. Service d'Extraction Avancée
**Fichier**: `src/services/advancedExtractionService.ts`

**Fonctionnalités**:
- Reconnaissance de format automatique
- Extraction de données structurées
- Nettoyage et validation
- Mapping intelligent

## Composants UI Spécialisés

### 1. Affichage de Progrès Amélioré
**Fichier**: `src/components/EnhancedProgressDisplay.tsx`

**Fonctionnalités**:
- Suivi en temps réel
- Indicateur de connexion
- Persistance d'état
- Actions de récupération

### 2. Moteur de Réconciliation Bancaire
**Fichier**: `src/components/BankReconciliationEngine.tsx`

**Fonctionnalités**:
- Comparaison automatique
- Détection d'écarts
- Suggestions de correction
- Rapports détaillés

### 3. Gestionnaire de Collections
**Fichier**: `src/components/CollectionsManager.tsx`

**Fonctionnalités**:
- Organisation par collections
- Filtrage et recherche
- Actions de masse
- Exportation

## Architecture des Données

### Tables Principales
1. **collection_report**: Rapports de collecte
2. **bank_statement**: Relevés bancaires
3. **processing_logs**: Logs de traitement
4. **quality_metrics**: Métriques de qualité

### Types de Données
**Fichier**: `src/types/banking.ts`

**Structures principales**:
- `BankReport`: Rapport bancaire
- `CollectionData`: Données de collecte
- `QualityMetrics`: Métriques qualité
- `ProcessingResult`: Résultats de traitement

## Workflow de Traitement

### 1. Upload de Fichier
```
Fichier → Validation → Détection Format → Extraction → Nettoyage → Sauvegarde
```

### 2. Analyse Qualité
```
Données → Validation → Contrôles → Métriques → Alertes → Rapports
```

### 3. Consolidation
```
Sources Multiples → Réconciliation → Agrégation → Visualisation → Export
```

## Configuration et Déploiement

### Variables d'Environnement Requises
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Scripts de Build
```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview"
}
```

### Optimisations de Performance
- Lazy loading des composants
- Mise en cache des requêtes
- Traitement par lots
- Compression des données

## Maintenance et Monitoring

### Logs et Debug
- Console logs détaillés
- Tracking des erreurs
- Métriques de performance
- Alertes système

### Sauvegarde et Récupération
- Sauvegarde automatique du progrès
- Récupération après crash
- Synchronisation des données
- Historique des versions
