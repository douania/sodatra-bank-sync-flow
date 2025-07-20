import React, { useState, useCallback } from 'react';
import { FileText, Download, Mail, Calendar, Settings, BarChart3, PieChart, TrendingUp, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// Types pour la génération de rapports
interface RapportConfig {
  type: 'executif' | 'detaille' | 'risques' | 'tendances';
  format: 'pdf' | 'excel' | 'word';
  periode: {
    debut: string;
    fin: string;
  };
  banques: string[];
  sections: string[];
  destinataires: string[];
  frequence?: 'quotidien' | 'hebdomadaire' | 'mensuel';
  automatique: boolean;
}

interface SectionRapport {
  id: string;
  nom: string;
  description: string;
  obligatoire: boolean;
  type: 'tableau' | 'graphique' | 'texte' | 'alerte';
}

interface ModeleRapport {
  id: string;
  nom: string;
  description: string;
  sections: string[];
  type: 'executif' | 'detaille' | 'risques' | 'tendances';
}

const BankingReports: React.FC = () => {
  const [config, setConfig] = useState<RapportConfig>({
    type: 'executif',
    format: 'pdf',
    periode: {
      debut: new Date().toISOString().split('T')[0],
      fin: new Date().toISOString().split('T')[0]
    },
    banques: ['BDK'],
    sections: ['resume', 'indicateurs', 'alertes'],
    destinataires: [],
    automatique: false
  });

  const [enGeneration, setEnGeneration] = useState(false);
  const [rapportGenere, setRapportGenere] = useState<string | null>(null);
  const { toast } = useToast();

  // Sections disponibles pour les rapports
  const sectionsDisponibles: SectionRapport[] = [
    {
      id: 'resume',
      nom: 'Résumé Exécutif',
      description: 'Vue d\'ensemble des indicateurs clés',
      obligatoire: true,
      type: 'texte'
    },
    {
      id: 'indicateurs',
      nom: 'Indicateurs Financiers',
      description: 'Métriques de performance et liquidité',
      obligatoire: true,
      type: 'tableau'
    },
    {
      id: 'alertes',
      nom: 'Alertes et Risques',
      description: 'Identification des points d\'attention',
      obligatoire: true,
      type: 'alerte'
    },
    {
      id: 'liquidite',
      nom: 'Analyse de Liquidité',
      description: 'Position de trésorerie détaillée',
      obligatoire: false,
      type: 'graphique'
    },
    {
      id: 'facilites',
      nom: 'Utilisation des Facilités',
      description: 'Suivi des lignes de crédit',
      obligatoire: false,
      type: 'graphique'
    },
    {
      id: 'transactions',
      nom: 'Transactions en Attente',
      description: 'Dépôts et chèques non traités',
      obligatoire: false,
      type: 'tableau'
    },
    {
      id: 'tendances',
      nom: 'Analyse des Tendances',
      description: 'Évolution historique des indicateurs',
      obligatoire: false,
      type: 'graphique'
    },
    {
      id: 'comparaison',
      nom: 'Comparaison Inter-Banques',
      description: 'Analyse comparative des performances',
      obligatoire: false,
      type: 'tableau'
    },
    {
      id: 'recommandations',
      nom: 'Recommandations',
      description: 'Actions suggérées et optimisations',
      obligatoire: false,
      type: 'texte'
    }
  ];

  // Modèles de rapports prédéfinis
  const modelesRapports: ModeleRapport[] = [
    {
      id: 'executif',
      nom: 'Rapport Exécutif',
      description: 'Synthèse pour la direction générale',
      sections: ['resume', 'indicateurs', 'alertes', 'recommandations'],
      type: 'executif'
    },
    {
      id: 'detaille',
      nom: 'Rapport Détaillé',
      description: 'Analyse complète pour les équipes financières',
      sections: ['resume', 'indicateurs', 'alertes', 'liquidite', 'facilites', 'transactions', 'tendances', 'comparaison', 'recommandations'],
      type: 'detaille'
    },
    {
      id: 'risques',
      nom: 'Rapport de Risques',
      description: 'Focus sur la gestion des risques',
      sections: ['alertes', 'transactions', 'facilites', 'recommandations'],
      type: 'risques'
    },
    {
      id: 'tendances',
      nom: 'Analyse des Tendances',
      description: 'Évolution et prévisions',
      sections: ['tendances', 'comparaison', 'indicateurs', 'recommandations'],
      type: 'tendances'
    }
  ];

  // Banques disponibles
  const banquesDisponibles = ['BDK', 'SGS', 'BICIS', 'ATB', 'ORA', 'BIS'];

  // Fonction pour appliquer un modèle
  const appliquerModele = useCallback((modele: ModeleRapport) => {
    setConfig(prev => ({
      ...prev,
      type: modele.type,
      sections: modele.sections
    }));
  }, []);

  // Fonction pour générer le rapport
  const genererRapport = useCallback(async () => {
    setEnGeneration(true);
    
    try {
      // Simulation de la génération de rapport
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Génération du contenu du rapport basé sur la configuration
      const contenuRapport = genererContenuRapport(config);
      setRapportGenere(contenuRapport);
      
      toast({
        title: "Rapport généré",
        description: `Rapport ${config.type} créé avec succès`,
      });
      
    } catch (error) {
      console.error('Erreur lors de la génération:', error);
      toast({
        title: "Erreur de génération",
        description: "Une erreur est survenue lors de la génération du rapport",
        variant: "destructive",
      });
    } finally {
      setEnGeneration(false);
    }
  }, [config, toast]);

  // Fonction pour générer le contenu du rapport
  const genererContenuRapport = (config: RapportConfig): string => {
    const sections = config.sections.map(sectionId => {
      const section = sectionsDisponibles.find(s => s.id === sectionId);
      return section ? genererContenuSection(section, config) : '';
    }).join('\n\n');

    return `# RAPPORT BANCAIRE ${config.type.toUpperCase()}

**Période:** ${config.periode.debut} au ${config.periode.fin}
**Banques:** ${config.banques.join(', ')}
**Généré le:** ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}

---

${sections}

---

*Rapport généré automatiquement par le système de traitement bancaire*`;
  };

  // Fonction pour générer le contenu d'une section
  const genererContenuSection = (section: SectionRapport, config: RapportConfig): string => {
    switch (section.id) {
      case 'resume':
        return `## ${section.nom}

La position bancaire consolidée au ${config.periode.fin} présente les caractéristiques suivantes :

- **Liquidité totale disponible :** 111,4 M FCFA
- **Taux d'utilisation des facilités :** 40,9%
- **Montant total à risque :** 120,1 M FCFA
- **Nombre d'alertes actives :** 3

### Points Clés
- Position de liquidité stable avec une amélioration de 2,3% par rapport à la période précédente
- Utilisation modérée des facilités bancaires, restant dans les limites acceptables
- Présence d'impayés nécessitant un suivi prioritaire
- Dépôts en attente représentant une opportunité d'amélioration de la liquidité`;

      case 'indicateurs':
        return `## ${section.nom}

| Indicateur | Valeur | Évolution | Seuil |
|------------|--------|-----------|-------|
| Liquidité Disponible | 111,4 M FCFA | +2,3% | > 50 M FCFA ✅ |
| Facilités Utilisées | 809,0 M FCFA | +1,8% | < 80% ✅ |
| Ratio d'Utilisation | 40,9% | +0,5% | < 70% ✅ |
| Montant à Risque | 120,1 M FCFA | -1,2% | < 150 M FCFA ✅ |
| Dépôts en Attente | 39,4 M FCFA | +5,2% | Suivi requis ⚠️ |
| Chèques en Circulation | 116,6 M FCFA | -2,1% | Suivi requis ⚠️ |`;

      case 'alertes':
        return `## ${section.nom}

### 🔴 Alertes Critiques
- **BDK - Impayé détecté :** CHAFIC AZAR & Cie - 2,0 M FCFA (22/04/2025)

### 🟡 Alertes d'Attention
- **BDK - Chèques anciens :** Chèques en circulation depuis plus de 6 mois
- **Toutes banques - Dépôts en attente :** 39,4 M FCFA nécessitant un suivi

### 📊 Recommandations Immédiates
1. Traiter l'impayé BDK en priorité
2. Régulariser les chèques anciens
3. Accélérer le traitement des dépôts en attente`;

      case 'recommandations':
        return `## ${section.nom}

### Actions Prioritaires (0-7 jours)
1. **Traitement des impayés :** Régulariser l'impayé BDK de 2,0 M FCFA
2. **Optimisation des dépôts :** Accélérer le crédit des dépôts en attente
3. **Nettoyage des chèques anciens :** Identifier et traiter les chèques de plus de 6 mois

### Actions à Moyen Terme (1-4 semaines)
1. **Optimisation de liquidité :** Étudier les opportunités de placement court terme
2. **Révision des facilités :** Négocier l'augmentation des lignes sous-utilisées
3. **Automatisation :** Améliorer les processus de rapprochement

### Actions Stratégiques (1-3 mois)
1. **Diversification bancaire :** Évaluer l'ajout de nouvelles banques partenaires
2. **Système d'alertes :** Implémenter des seuils automatiques
3. **Formation équipes :** Renforcer les compétences en gestion de trésorerie`;

      default:
        return `## ${section.nom}

${section.description}

*Contenu détaillé à développer selon les spécifications.*`;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Générateur de Rapports Bancaires</h1>
          <p className="text-muted-foreground">Créez des rapports personnalisés automatiquement</p>
        </div>
        <div className="flex items-center space-x-3">
          <FileText className="h-8 w-8 text-blue-600" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration du rapport */}
        <div className="lg:col-span-2 space-y-6">
          {/* Modèles prédéfinis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-5 w-5" />
                <span>Modèles de Rapports</span>
              </CardTitle>
              <CardDescription>Choisissez un modèle prédéfini ou configurez votre rapport</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {modelesRapports.map((modele) => (
                  <div
                    key={modele.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      config.type === modele.type
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    onClick={() => appliquerModele(modele)}
                  >
                    <div className="flex items-center mb-2">
                      {modele.type === 'executif' && <BarChart3 className="h-5 w-5 text-blue-600 mr-2" />}
                      {modele.type === 'detaille' && <FileText className="h-5 w-5 text-green-600 mr-2" />}
                      {modele.type === 'risques' && <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />}
                      {modele.type === 'tendances' && <TrendingUp className="h-5 w-5 text-purple-600 mr-2" />}
                      <h3 className="font-medium">{modele.nom}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{modele.description}</p>
                    <p className="text-xs text-muted-foreground mt-2">{modele.sections.length} sections</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Configuration détaillée */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration du Rapport</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Format et période */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Format de sortie
                    </label>
                    <select
                      value={config.format}
                      onChange={(e) => setConfig(prev => ({ ...prev, format: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="pdf">PDF</option>
                      <option value="excel">Excel</option>
                      <option value="word">Word</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Date de début
                    </label>
                    <input
                      type="date"
                      value={config.periode.debut}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        periode: { ...prev.periode, debut: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Date de fin
                    </label>
                    <input
                      type="date"
                      value={config.periode.fin}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        periode: { ...prev.periode, fin: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Banques et options */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Banques à inclure
                    </label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {banquesDisponibles.map((banque) => (
                        <label key={banque} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={config.banques.includes(banque)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig(prev => ({
                                  ...prev,
                                  banques: [...prev.banques, banque]
                                }));
                              } else {
                                setConfig(prev => ({
                                  ...prev,
                                  banques: prev.banques.filter(b => b !== banque)
                                }));
                              }
                            }}
                            className="mr-2"
                          />
                          <span className="text-sm">{banque}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Génération automatique
                    </label>
                    <div className="flex items-center space-x-4">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={config.automatique}
                          onChange={(e) => setConfig(prev => ({ ...prev, automatique: e.target.checked }))}
                          className="mr-2"
                        />
                        <span className="text-sm">Activer</span>
                      </label>
                      {config.automatique && (
                        <select
                          value={config.frequence || 'quotidien'}
                          onChange={(e) => setConfig(prev => ({ ...prev, frequence: e.target.value as any }))}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          <option value="quotidien">Quotidien</option>
                          <option value="hebdomadaire">Hebdomadaire</option>
                          <option value="mensuel">Mensuel</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sections du rapport */}
          <Card>
            <CardHeader>
              <CardTitle>Sections du Rapport</CardTitle>
              <CardDescription>Personnalisez le contenu de votre rapport</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sectionsDisponibles.map((section) => (
                  <div
                    key={section.id}
                    className={`p-3 border rounded-md ${
                      section.obligatoire
                        ? 'border-blue-300 bg-blue-50'
                        : config.sections.includes(section.id)
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-300'
                    }`}
                  >
                    <label className="flex items-start">
                      <input
                        type="checkbox"
                        checked={config.sections.includes(section.id)}
                        disabled={section.obligatoire}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setConfig(prev => ({
                              ...prev,
                              sections: [...prev.sections, section.id]
                            }));
                          } else {
                            setConfig(prev => ({
                              ...prev,
                              sections: prev.sections.filter(s => s !== section.id)
                            }));
                          }
                        }}
                        className="mr-3 mt-1"
                      />
                      <div>
                        <h3 className="font-medium text-sm">{section.nom}</h3>
                        <p className="text-xs text-muted-foreground">{section.description}</p>
                        <div className="flex items-center mt-1 space-x-2">
                          <Badge variant="outline" className="text-xs">
                            {section.type}
                          </Badge>
                          {section.obligatoire && (
                            <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-800">
                              Obligatoire
                            </Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panneau de génération */}
        <div className="space-y-6">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button
                  onClick={genererRapport}
                  disabled={enGeneration || config.banques.length === 0}
                  className="w-full"
                >
                  {enGeneration ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Génération...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4 mr-2" />
                      Générer le Rapport
                    </>
                  )}
                </Button>

                {rapportGenere && (
                  <Button variant="outline" className="w-full">
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger
                  </Button>
                )}

                <Button variant="outline" className="w-full">
                  <Mail className="h-4 w-4 mr-2" />
                  Envoyer par Email
                </Button>

                <Button variant="outline" className="w-full">
                  <Calendar className="h-4 w-4 mr-2" />
                  Programmer
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Résumé de la configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Résumé</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-medium">{config.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">{config.format.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Banques:</span>
                  <span className="font-medium">{config.banques.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sections:</span>
                  <span className="font-medium">{config.sections.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Automatique:</span>
                  <span className="font-medium">{config.automatique ? 'Oui' : 'Non'}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Aperçu du rapport généré */}
      {rapportGenere && (
        <Card>
          <CardHeader>
            <CardTitle>Aperçu du Rapport</CardTitle>
            <CardDescription>Prévisualisation du contenu généré</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 p-4 rounded-md max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-800">
                {rapportGenere}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BankingReports;