
# Guide de Migration du Projet SODATRA

## Technologies Utilisées
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **Base de données**: Supabase (PostgreSQL)
- **Icônes**: Lucide React
- **Graphiques**: Recharts
- **Gestion d'état**: Tanstack Query
- **Processing**: Services personnalisés pour l'analyse bancaire

## Prérequis pour la Migration

### 1. Configuration Node.js
```bash
# Version recommandée: Node.js 18+
node --version
npm --version
```

### 2. Configuration Supabase
Vous devrez créer un nouveau projet Supabase avec:
- URL du projet: `https://leakcdbbawzysfqyqsnr.supabase.co`
- Clé publique: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## Étapes de Migration

### Phase 1: Clonage et Installation
```bash
# 1. Cloner le repository
git clone <URL_DU_REPO>
cd <NOM_DU_PROJET>

# 2. Installer les dépendances
npm install

# 3. Copier les variables d'environnement
cp .env.example .env.local
```

### Phase 2: Configuration Supabase
1. Créer un nouveau projet Supabase
2. Exécuter les migrations SQL (dossier `supabase/migrations/`)
3. Configurer les variables d'environnement
4. Tester la connexion

### Phase 3: Build et Test
```bash
# 1. Build de développement
npm run dev

# 2. Build de production
npm run build

# 3. Prévisualisation
npm run preview
```

## Structure du Projet

### Services Critiques
- `src/services/supabaseClientService.ts` - Client Supabase optimisé
- `src/services/progressService.ts` - Gestion du progrès
- `src/services/fileProcessingService.ts` - Traitement des fichiers
- `src/services/bankReportProcessingService.ts` - Analyse bancaire

### Composants Principaux
- `src/components/EnhancedProgressDisplay.tsx` - Affichage du progrès
- `src/components/CollectionsManager.tsx` - Gestion des collections
- `src/components/ConsolidatedDashboard.tsx` - Tableau de bord

### Pages
- `src/pages/FileUpload.tsx` - Upload de fichiers
- `src/pages/Dashboard.tsx` - Tableau de bord principal
- `src/pages/QualityControl.tsx` - Contrôle qualité

## Dépendances Critiques

### Production
```json
{
  "@supabase/supabase-js": "^2.50.0",
  "@tanstack/react-query": "^5.56.2",
  "lucide-react": "^0.462.0",
  "recharts": "^2.12.7",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "xlsx": "^0.18.5"
}
```

### Développement
```json
{
  "@vitejs/plugin-react": "^4.x",
  "typescript": "^5.x",
  "tailwindcss": "^3.x"
}
```

## Points d'Attention

### 1. Configuration Supabase
- Les migrations SQL doivent être exécutées dans l'ordre
- La configuration des RLS (Row Level Security) est critique
- Les fonctions et triggers doivent être recréés

### 2. Variables d'Environnement
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Services de Traitement
- Les services de traitement bancaire utilisent des algorithmes spécifiques
- La persistance du progrès nécessite le localStorage
- Les timeouts et retry sont configurés pour Supabase

## Déploiement

### Options de Déploiement
1. **Vercel** (recommandé pour Vite/React)
2. **Netlify** 
3. **Hébergement personnalisé**

### Configuration de Production
```bash
# Build optimisé
npm run build

# Variables d'environnement de production
VITE_SUPABASE_URL=your_production_supabase_url
VITE_SUPABASE_ANON_KEY=your_production_supabase_anon_key
```

## Support et Dépannage

### Logs de Debug
Le projet inclut des logs détaillés:
- Console logs pour le suivi des opérations
- Service de heartbeat pour maintenir la connexion
- Système de retry automatique

### Erreurs Communes
1. **Erreurs de connexion Supabase**: Vérifier les credentials
2. **Erreurs de build TypeScript**: Vérifier les types
3. **Erreurs de traitement**: Vérifier les formats de fichiers

## Contact
Pour toute question sur la migration, se référer à la documentation ou contacter l'équipe technique.
