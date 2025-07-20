import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, 
  TrendingUp, 
  AlertTriangle, 
  Target, 
  Lightbulb,
  Clock,
  DollarSign,
  BarChart3,
  CheckCircle,
  Calendar,
  ArrowRight
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { bankingUniversalService } from "@/services/bankingUniversalService";
import { BankType, RapportBancaire } from "@/types/banking-universal";
import { useToast } from "@/hooks/use-toast";

interface Pattern {
  id: string;
  type: 'recurrent_unpaid' | 'old_checks' | 'liquidity_trend' | 'facility_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  frequency: number;
  impact: number;
  recommendation: string;
  detectedAt: string;
}

interface Prediction {
  id: string;
  type: 'liquidity' | 'facility_usage' | 'risk_exposure';
  period: '7d' | '30d' | '90d';
  confidence: number;
  prediction: number;
  current: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  description: string;
}

interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: 'risk_management' | 'liquidity_optimization' | 'operational_efficiency' | 'strategic';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  expectedBenefit: number;
  deadline: string;
}

const IntelligenceMetier: React.FC = () => {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedBank, setSelectedBank] = useState<BankType>('BDK');
  const { toast } = useToast();

  // Données simulées pour la démo
  const mockPatterns: Pattern[] = [
    {
      id: '1',
      type: 'recurrent_unpaid',
      severity: 'high',
      title: 'Impayés Récurrents Détectés',
      description: 'Le client CLI001 (CHAFIC AZAR & Cie) présente 3 impayés sur les 6 derniers mois',
      frequency: 3,
      impact: 85,
      recommendation: 'Réviser les conditions de crédit et envisager une garantie supplémentaire',
      detectedAt: '2025-06-25T10:00:00Z'
    },
    {
      id: '2',
      type: 'old_checks',
      severity: 'medium',
      title: 'Chèques Anciens en Circulation',
      description: '5 chèques datant de plus de 6 mois sont encore en circulation',
      frequency: 5,
      impact: 45,
      recommendation: 'Contacter les bénéficiaires pour régularisation ou annulation',
      detectedAt: '2025-06-25T10:00:00Z'
    },
    {
      id: '3',
      type: 'liquidity_trend',
      severity: 'low',
      title: 'Tendance Positive de Liquidité',
      description: 'Amélioration constante de la liquidité sur les 30 derniers jours (+15%)',
      frequency: 1,
      impact: 75,
      recommendation: 'Opportunité d\'investissement court terme ou réduction des facilités coûteuses',
      detectedAt: '2025-06-25T10:00:00Z'
    },
    {
      id: '4',
      type: 'facility_pattern',
      severity: 'medium',
      title: 'Utilisation Cyclique des Facilités',
      description: 'Pattern mensuel d\'utilisation élevée des facilités en fin de mois',
      frequency: 12,
      impact: 60,
      recommendation: 'Optimiser la planification de trésorerie pour réduire les pics d\'utilisation',
      detectedAt: '2025-06-25T10:00:00Z'
    }
  ];

  const mockPredictions: Prediction[] = [
    {
      id: '1',
      type: 'liquidity',
      period: '7d',
      confidence: 92,
      prediction: 118500000,
      current: 111400000,
      trend: 'increasing',
      description: 'Liquidité prévue en hausse grâce aux dépôts attendus'
    },
    {
      id: '2',
      type: 'facility_usage',
      period: '30d',
      confidence: 87,
      prediction: 850000000,
      current: 809000000,
      trend: 'increasing',
      description: 'Augmentation attendue de l\'utilisation des facilités'
    },
    {
      id: '3',
      type: 'risk_exposure',
      period: '90d',
      confidence: 78,
      prediction: 95000000,
      current: 120100000,
      trend: 'decreasing',
      description: 'Réduction du risque grâce aux mesures de recouvrement'
    }
  ];

  const mockRecommendations: Recommendation[] = [
    {
      id: '1',
      priority: 'high',
      category: 'risk_management',
      title: 'Renforcer le Suivi Client CLI001',
      description: 'Mettre en place un suivi renforcé et réviser les conditions de crédit',
      impact: 'Réduction du risque d\'impayés de 40%',
      effort: 'medium',
      expectedBenefit: 2000000,
      deadline: '2025-07-15'
    },
    {
      id: '2',
      priority: 'medium',
      category: 'operational_efficiency',
      title: 'Automatiser la Détection des Chèques Anciens',
      description: 'Implémenter un système d\'alerte automatique pour les chèques de plus de 90 jours',
      impact: 'Réduction du temps de traitement de 60%',
      effort: 'low',
      expectedBenefit: 500000,
      deadline: '2025-07-30'
    },
    {
      id: '3',
      priority: 'medium',
      category: 'liquidity_optimization',
      title: 'Optimiser les Placements Court Terme',
      description: 'Investir l\'excédent de liquidité dans des placements à court terme',
      impact: 'Revenus supplémentaires estimés',
      effort: 'low',
      expectedBenefit: 1200000,
      deadline: '2025-07-01'
    },
    {
      id: '4',
      priority: 'low',
      category: 'strategic',
      title: 'Diversifier les Banques Partenaires',
      description: 'Évaluer l\'ajout de nouvelles banques pour réduire la concentration de risque',
      impact: 'Réduction du risque de concentration',
      effort: 'high',
      expectedBenefit: 5000000,
      deadline: '2025-09-30'
    }
  ];

  useEffect(() => {
    runIntelligenceAnalysis();
  }, [selectedBank]);

  const runIntelligenceAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      // Simulation de l'analyse IA
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setPatterns(mockPatterns);
      setPredictions(mockPredictions);
      setRecommendations(mockRecommendations);
      
      toast({
        title: "Analyse terminée",
        description: `${mockPatterns.length} patterns détectés, ${mockRecommendations.length} recommandations générées`,
      });
      
    } catch (error) {
      console.error('Erreur analyse intelligence:', error);
      toast({
        title: "Erreur d'analyse",
        description: "Une erreur est survenue lors de l'analyse intelligente",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-red-400';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'border-red-500 bg-red-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-green-500 bg-green-50';
      default: return 'border-gray-500 bg-gray-50';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'decreasing': return <TrendingUp className="h-4 w-4 text-red-600 rotate-180" />;
      default: return <ArrowRight className="h-4 w-4 text-blue-600" />;
    }
  };

  const confidenceData = predictions.map(p => ({
    name: p.type,
    confidence: p.confidence,
    period: p.period
  }));

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center space-x-2">
            <Brain className="h-8 w-8 text-blue-600" />
            <span>Intelligence Métier</span>
          </h2>
          <p className="text-muted-foreground">
            Analyse prédictive et recommandations automatiques basées sur l'IA
          </p>
        </div>
        <div className="flex space-x-2">
          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value as BankType)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="BDK">BDK</option>
            <option value="SGS">SGS</option>
            <option value="BICIS">BICIS</option>
            <option value="ATB">ATB</option>
            <option value="ORA">ORA</option>
            <option value="BIS">BIS</option>
          </select>
          <Button onClick={runIntelligenceAnalysis} disabled={isAnalyzing}>
            {isAnalyzing ? (
              <>
                <Brain className="h-4 w-4 mr-2 animate-pulse" />
                Analyse...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Analyser
              </>
            )}
          </Button>
        </div>
      </div>

      {isAnalyzing && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <Brain className="h-8 w-8 animate-pulse text-blue-600" />
              <div>
                <p className="font-medium">Analyse en cours...</p>
                <p className="text-sm text-muted-foreground">
                  Détection de patterns, génération de prédictions et recommandations
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="patterns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="patterns">Patterns Détectés</TabsTrigger>
          <TabsTrigger value="predictions">Prédictions</TabsTrigger>
          <TabsTrigger value="recommendations">Recommandations</TabsTrigger>
        </TabsList>

        <TabsContent value="patterns" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {patterns.map((pattern) => (
              <Card key={pattern.id} className="relative">
                <div className={`absolute top-0 left-0 w-1 h-full ${getSeverityColor(pattern.severity)} rounded-l-lg`}></div>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{pattern.title}</CardTitle>
                    <Badge variant={pattern.severity === 'high' ? 'destructive' : pattern.severity === 'medium' ? 'default' : 'secondary'}>
                      {pattern.severity}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-muted-foreground">{pattern.description}</p>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Fréquence:</span>
                      <p className="font-medium">{pattern.frequency} fois</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Impact:</span>
                      <p className="font-medium">{pattern.impact}%</p>
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <div className="flex items-start space-x-2">
                      <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">Recommandation</p>
                        <p className="text-sm text-blue-700">{pattern.recommendation}</p>
                      </div>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    Détecté le {new Date(pattern.detectedAt).toLocaleString('fr-FR')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Prédictions détaillées */}
            <div className="space-y-4">
              {predictions.map((prediction) => (
                <Card key={prediction.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg capitalize">
                        {prediction.type.replace('_', ' ')}
                      </CardTitle>
                      <div className="flex items-center space-x-2">
                        {getTrendIcon(prediction.trend)}
                        <Badge variant="outline">{prediction.period}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-muted-foreground">{prediction.description}</p>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm text-muted-foreground">Actuel:</span>
                        <p className="font-bold text-lg">{formatAmount(prediction.current)}</p>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Prévu:</span>
                        <p className={`font-bold text-lg ${
                          prediction.trend === 'increasing' ? 'text-green-600' : 
                          prediction.trend === 'decreasing' ? 'text-red-600' : 'text-blue-600'
                        }`}>
                          {formatAmount(prediction.prediction)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Confiance:</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-20 h-2 bg-gray-200 rounded-full">
                          <div 
                            className="h-2 bg-blue-600 rounded-full" 
                            style={{ width: `${prediction.confidence}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">{prediction.confidence}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            
            {/* Graphique de confiance */}
            <Card>
              <CardHeader>
                <CardTitle>Confiance des Prédictions</CardTitle>
                <CardDescription>Niveau de fiabilité par type de prédiction</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={confidenceData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, confidence }) => `${name}: ${confidence}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="confidence"
                    >
                      {confidenceData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <Card key={rec.id} className={`border-l-4 ${getPriorityColor(rec.priority)}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{rec.title}</CardTitle>
                    <div className="flex items-center space-x-2">
                      <Badge variant={rec.priority === 'high' ? 'destructive' : rec.priority === 'medium' ? 'default' : 'secondary'}>
                        {rec.priority}
                      </Badge>
                      <Badge variant="outline">{rec.category.replace('_', ' ')}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground">{rec.description}</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Impact:</span>
                      <p className="font-medium">{rec.impact}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Effort:</span>
                      <p className="font-medium capitalize">{rec.effort}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Bénéfice attendu:</span>
                      <p className="font-medium text-green-600">{formatAmount(rec.expectedBenefit)}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Échéance: {new Date(rec.deadline).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                    <Button size="sm" variant="outline">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Planifier
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default IntelligenceMetier;