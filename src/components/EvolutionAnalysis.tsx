import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  ArrowRight,
  Calendar,
  DollarSign,
  FileText,
  RefreshCw,
  Clock,
  ArrowUpDown
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { bankingUniversalService } from "@/services/bankingUniversalService";
import { BankType, ComparaisonRapport, Evolution, Alerte } from "@/types/banking-universal";
import { useToast } from "@/hooks/use-toast";

interface EvolutionAnalysisProps {
  banque?: BankType;
  dateActuelle?: string;
}

const EvolutionAnalysis: React.FC<EvolutionAnalysisProps> = ({ 
  banque = 'BDK', 
  dateActuelle = new Date().toISOString().split('T')[0]
}) => {
  const [comparaison, setComparaison] = useState<ComparaisonRapport | null>(null);
  const [evolutions, setEvolutions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'1j' | '7j' | '30j'>('7j');
  const { toast } = useToast();

  // Données simulées pour la démo
  const mockComparaison: ComparaisonRapport = {
    rapportPrecedent: {
      banque: 'BDK',
      dateRapport: '2025-06-24',
      compte: '1234567890',
      soldeOuverture: 15450000,
      soldeCloture: 15950000,
      depotsNonCredites: [
        { id: '1', reference: 'DEP001', montant: 500000, description: 'Dépôt client ABC', type: 'depot', statut: 'en_attente' },
        { id: '2', reference: 'DEP002', montant: 750000, description: 'Dépôt client XYZ', type: 'depot', statut: 'en_attente' }
      ],
      chequesNonDebites: [
        { id: '3', reference: 'CHQ001', montant: 750000, description: 'Chèque 123456', type: 'cheque', statut: 'en_attente' },
        { id: '4', reference: 'CHQ002', montant: 300000, description: 'Chèque 789012', type: 'cheque', statut: 'en_attente' }
      ],
      autresDebits: [],
      autresCredits: [],
      facilitesBancaires: [
        { type: 'Découvert', montantAutorise: 5000000, montantUtilise: 1200000, montantDisponible: 3800000 }
      ],
      impayes: [],
      metadata: {
        formatSource: 'PDF',
        versionParser: '1.0.0',
        dateExtraction: '2025-06-24T10:00:00Z',
        checksum: 'abc123'
      }
    },
    rapportActuel: {
      banque: 'BDK',
      dateRapport: '2025-06-25',
      compte: '1234567890',
      soldeOuverture: 15950000,
      soldeCloture: 16200000,
      depotsNonCredites: [
        { id: '2', reference: 'DEP002', montant: 750000, description: 'Dépôt client XYZ', type: 'depot', statut: 'en_attente' },
        { id: '5', reference: 'DEP003', montant: 1200000, description: 'Nouveau dépôt client DEF', type: 'depot', statut: 'en_attente' }
      ],
      chequesNonDebites: [
        { id: '4', reference: 'CHQ002', montant: 300000, description: 'Chèque 789012', type: 'cheque', statut: 'en_attente' }
      ],
      autresDebits: [],
      autresCredits: [],
      facilitesBancaires: [
        { type: 'Découvert', montantAutorise: 5000000, montantUtilise: 1500000, montantDisponible: 3500000 }
      ],
      impayes: [
        { reference: 'IMP001', montant: 2000000, dateEcheance: '2025-06-20', dateRetour: '2025-06-25', motif: 'Provision insuffisante', clientCode: 'CLI001', description: 'CHAFIC AZAR & Cie' }
      ],
      metadata: {
        formatSource: 'PDF',
        versionParser: '1.0.0',
        dateExtraction: '2025-06-25T10:00:00Z',
        checksum: 'def456'
      }
    },
    evolutions: [
      {
        type: 'depot_credite',
        element: { id: '1', reference: 'DEP001', montant: 500000, description: 'Dépôt client ABC', type: 'depot', statut: 'traite' },
        description: 'Dépôt DEP001 crédité (+500,000 FCFA)',
        impact: 'positif'
      },
      {
        type: 'cheque_debite',
        element: { id: '3', reference: 'CHQ001', montant: 750000, description: 'Chèque 123456', type: 'cheque', statut: 'traite' },
        description: 'Chèque CHQ001 débité (-750,000 FCFA)',
        impact: 'negatif'
      },
      {
        type: 'nouvel_impaye',
        element: { reference: 'IMP001', montant: 2000000, dateEcheance: '2025-06-20', dateRetour: '2025-06-25', motif: 'Provision insuffisante', clientCode: 'CLI001', description: 'CHAFIC AZAR & Cie' },
        description: 'Nouvel impayé: CHAFIC AZAR & Cie (-2,000,000 FCFA)',
        impact: 'negatif'
      }
    ],
    nouveauxElements: [
      { id: '5', reference: 'DEP003', montant: 1200000, description: 'Nouveau dépôt client DEF', type: 'depot', statut: 'en_attente' }
    ],
    elementsDisparus: [
      { id: '1', reference: 'DEP001', montant: 500000, description: 'Dépôt client ABC', type: 'depot', statut: 'traite' },
      { id: '3', reference: 'CHQ001', montant: 750000, description: 'Chèque 123456', type: 'cheque', statut: 'traite' }
    ],
    alertes: [
      {
        type: 'critique',
        message: 'Nouvel impayé détecté',
        details: 'CHAFIC AZAR & Cie - 2,000,000 FCFA',
        banque: 'BDK',
        dateDetection: '2025-06-25T10:30:00Z'
      },
      {
        type: 'attention',
        message: 'Augmentation utilisation facilités',
        details: 'Découvert passé de 1,200,000 à 1,500,000 FCFA',
        banque: 'BDK',
        dateDetection: '2025-06-25T10:30:00Z'
      }
    ]
  };

  const mockEvolutionHistory = [
    { date: '20/06', cheques: -2, depots: 3, impayes: 0, solde: 15200000 },
    { date: '21/06', cheques: -1, depots: 2, impayes: 0, solde: 15300000 },
    { date: '22/06', cheques: -3, depots: 1, impayes: 1, solde: 15100000 },
    { date: '23/06', cheques: -2, depots: 4, impayes: 0, solde: 15600000 },
    { date: '24/06', cheques: -1, depots: 2, impayes: 0, solde: 15950000 },
    { date: '25/06', cheques: -1, depots: 1, impayes: 1, solde: 16200000 }
  ];

  useEffect(() => {
    loadComparaisonData();
  }, [banque, dateActuelle]);

  const loadComparaisonData = async () => {
    setIsLoading(true);
    try {
      // En production, utiliser le service réel
      // const data = await bankingUniversalService.compareReports(banque, dateActuelle);
      // const evolutionsData = await bankingUniversalService.getEvolutions(banque, 50);
      
      // Pour la démo, utiliser les données simulées
      await new Promise(resolve => setTimeout(resolve, 1000));
      setComparaison(mockComparaison);
      setEvolutions(mockEvolutionHistory);
      
    } catch (error) {
      console.error('Erreur chargement comparaison:', error);
      toast({
        title: "Erreur de chargement",
        description: "Impossible de charger les données de comparaison",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getEvolutionIcon = (type: string) => {
    switch (type) {
      case 'depot_credite': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'cheque_debite': return <TrendingDown className="h-4 w-4 text-blue-600" />;
      case 'nouvel_impaye': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'facilite_modifiee': return <ArrowUpDown className="h-4 w-4 text-yellow-600" />;
      default: return <CheckCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'positif': return 'text-green-600 bg-green-50 border-green-200';
      case 'negatif': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-lg font-medium">Analyse des évolutions...</p>
        </div>
      </div>
    );
  }

  if (!comparaison) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Aucune donnée de comparaison disponible pour {banque} à la date {dateActuelle}.
        </AlertDescription>
      </Alert>
    );
  }

  const soldeEvolution = comparaison.rapportActuel.soldeCloture - comparaison.rapportPrecedent.soldeCloture;

  return (
    <div className="space-y-6">
      {/* En-tête avec sélection de période */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Analyse des Évolutions - {banque}</h2>
          <p className="text-muted-foreground">
            Comparaison {comparaison.rapportPrecedent.dateRapport} → {comparaison.rapportActuel.dateRapport}
          </p>
        </div>
        <div className="flex space-x-2">
          {(['1j', '7j', '30j'] as const).map((period) => (
            <Button
              key={period}
              variant={selectedPeriod === period ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedPeriod(period)}
            >
              {period}
            </Button>
          ))}
        </div>
      </div>

      {/* Métriques de comparaison */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Évolution Solde</CardTitle>
            {soldeEvolution >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${soldeEvolution >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatAmount(soldeEvolution)}
            </div>
            <p className="text-xs text-muted-foreground">
              {comparaison.rapportPrecedent.soldeCloture.toLocaleString()} → {comparaison.rapportActuel.soldeCloture.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Évolutions Détectées</CardTitle>
            <ArrowRight className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {comparaison.evolutions.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Changements identifiés
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nouveaux Éléments</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {comparaison.nouveauxElements.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Nouveaux dépôts/transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Actives</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {comparaison.alertes.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Points d'attention
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Graphique d'évolution */}
      <Card>
        <CardHeader>
          <CardTitle>Évolution des Transactions (7 jours)</CardTitle>
          <CardDescription>Tendances des chèques, dépôts et impayés</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={evolutions}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip 
                formatter={(value, name) => [
                  value, 
                  name === 'cheques' ? 'Chèques débités' : 
                  name === 'depots' ? 'Dépôts crédités' : 'Impayés'
                ]}
              />
              <Bar dataKey="cheques" fill="#EF4444" name="cheques" />
              <Bar dataKey="depots" fill="#10B981" name="depots" />
              <Bar dataKey="impayes" fill="#F59E0B" name="impayes" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Évolutions détaillées */}
        <Card>
          <CardHeader>
            <CardTitle>Évolutions Détectées</CardTitle>
            <CardDescription>Changements entre les deux rapports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {comparaison.evolutions.map((evolution, index) => (
                <div key={index} className={`p-4 rounded-lg border ${getImpactColor(evolution.impact)}`}>
                  <div className="flex items-start space-x-3">
                    {getEvolutionIcon(evolution.type)}
                    <div className="flex-1">
                      <p className="font-medium">{evolution.description}</p>
                      <div className="flex items-center mt-2 space-x-2">
                        <Badge variant="outline">
                          {evolution.type.replace('_', ' ').toUpperCase()}
                        </Badge>
                        <Badge variant={evolution.impact === 'positif' ? 'default' : 'destructive'}>
                          {evolution.impact}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Nouveaux éléments */}
        <Card>
          <CardHeader>
            <CardTitle>Nouveaux Éléments</CardTitle>
            <CardDescription>Transactions apparues dans le dernier rapport</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {comparaison.nouveauxElements.map((element, index) => (
                <div key={index} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{element.reference}</p>
                      <p className="text-sm text-muted-foreground">{element.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">{formatAmount(element.montant)}</p>
                      <Badge variant="outline">{element.type}</Badge>
                    </div>
                  </div>
                </div>
              ))}
              {comparaison.nouveauxElements.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  Aucun nouvel élément détecté
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertes générées */}
      {comparaison.alertes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>Alertes Automatiques</span>
            </CardTitle>
            <CardDescription>Alertes générées suite à l'analyse comparative</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {comparaison.alertes.map((alerte, index) => (
                <Alert key={index} className={`${
                  alerte.type === 'critique' ? 'border-red-500 bg-red-50' :
                  alerte.type === 'attention' ? 'border-yellow-500 bg-yellow-50' :
                  'border-blue-500 bg-blue-50'
                }`}>
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className={`h-4 w-4 ${
                      alerte.type === 'critique' ? 'text-red-600' :
                      alerte.type === 'attention' ? 'text-yellow-600' :
                      'text-blue-600'
                    }`} />
                    <div className="flex-1">
                      <AlertDescription>
                        <p className="font-medium">{alerte.message}</p>
                        <p className="text-sm mt-1">{alerte.details}</p>
                        <div className="flex items-center mt-2 space-x-2">
                          <Badge variant="outline">{alerte.banque}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(alerte.dateDetection).toLocaleString('fr-FR')}
                          </span>
                        </div>
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EvolutionAnalysis;