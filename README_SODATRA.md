
# SODATRA - Système d'Analyse Bancaire

## Description
SODATRA est une application web développée avec React et TypeScript pour l'analyse et la consolidation de rapports bancaires. Elle permet de traiter des fichiers Excel contenant des données de collecte bancaire et génère des analyses consolidées avec contrôle qualité.

## Fonctionnalités Principales

🏦 **Traitement Bancaire Multi-Format**
- Support des formats Excel (.xlsx, .xls)
- Détection automatique du type de rapport bancaire
- Extraction intelligente des données

📊 **Analyse Consolidée**
- Tableau de bord avec métriques en temps réel
- Graphiques interactifs (Recharts)
- Comparaison multi-banques

🔍 **Contrôle Qualité Avancé**
- Détection automatique des doublons
- Validation des incohérences
- Rapport de conformité détaillé

⚡ **Performance Optimisée**
- Traitement par lots
- Système de retry automatique
- Persistance du progrès en cas de déconnexion

## Technologies

- **Frontend**: React 18 + TypeScript + Vite
- **UI/UX**: Tailwind CSS + shadcn/ui
- **Base de Données**: Supabase (PostgreSQL)
- **Graphiques**: Recharts
- **État**: TanStack Query
- **Icônes**: Lucide React

## Installation Rapide

```bash
# 1. Cloner le projet
git clone <URL_DU_REPO>
cd sodatra

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env.local
# Éditer .env.local avec vos credentials Supabase

# 4. Lancer en développement
npm run dev
```

## Configuration Supabase

1. Créer un projet Supabase
2. Exécuter les migrations SQL dans l'ordre
3. Configurer les variables d'environnement
4. Activer Row Level Security si nécessaire

## Structure du Projet

```
src/
├── components/          # Composants React
│   ├── ui/             # Composants UI de base (shadcn/ui)
│   ├── EnhancedProgressDisplay.tsx
│   ├── CollectionsManager.tsx
│   └── ConsolidatedDashboard.tsx
├── pages/              # Pages de l'application
│   ├── FileUpload.tsx
│   ├── Dashboard.tsx
│   └── QualityControl.tsx
├── services/           # Services métier
│   ├── supabaseClientService.ts
│   ├── fileProcessingService.ts
│   └── bankReportProcessingService.ts
├── types/              # Types TypeScript
└── hooks/              # Hooks personnalisés
```

## Scripts Disponibles

```bash
npm run dev          # Développement
npm run build        # Build de production
npm run preview      # Aperçu du build
npm run lint         # Linting TypeScript
```

## Fonctionnalités Avancées

### Traitement Intelligent
- Reconnaissance automatique des formats bancaires
- Extraction contextuelle des données
- Nettoyage et validation automatiques

### Monitoring en Temps Réel
- Affichage du progrès de traitement
- Indicateurs de connexion
- Alertes en cas de problème

### Récupération Robuste
- Système de retry avec backoff exponentiel
- Persistance du progrès
- Reconnexion automatique

## Déploiement

### Développement Local
```bash
npm run dev
# Accessible sur http://localhost:5173
```

### Production
```bash
npm run build
# Les fichiers sont générés dans ./dist
```

### Variables d'Environnement de Production
```env
VITE_SUPABASE_URL=your_production_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_production_supabase_publishable_key
VITE_SUPABASE_PROJECT_ID=your_production_supabase_project_id
```

## Support et Documentation

- **Guide de Migration**: `MIGRATION_GUIDE.md`
- **Documentation Fonctionnelle**: `FEATURES_DOCUMENTATION.md`
- **Types TypeScript**: `src/types/`
- **Tests**: Les composants incluent des logs pour le debug

## Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## License

Ce projet est sous licence propriétaire. Voir le fichier `LICENSE` pour plus de détails.

## Contact

Pour toute question technique ou demande de support, contacter l'équipe de développement.

---

**Version**: 1.0.0  
**Dernière mise à jour**: $(date)  
**Statut**: Production Ready ✅
