import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  Building2, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  DollarSign,
  PieChart,
  BarChart3,
  RefreshCw,
  Download,
  Calendar
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart as RechartsPieChart, Cell } from 'recharts';
import { bankingUniversalService } from "@/services/bankingUniversalService";
import { BankType, RapportConsolide, RapportBancaire } from "@/types/banking-universal";
import { useToast } from "@/hooks/use-toast";
import EvolutionAnalysis from "@/components/EvolutionAnalysis";
import IntelligenceMetier from "@/components/IntelligenceMetier";
import RealtimeManager from "@/components/RealtimeManager";

const BankingDashboard: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [consolidatedData, setConsolidatedData] = useState<RapportConsolide | null>(null);
  const [selectedBanks, setSelectedBanks] = useState<BankType[]>(['BDK', 'SGS', 'BICIS']);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const bankColors = {
    BDK: '#3B82F6',
    SGS: '#10B981',
    BICIS: '#F59E0B',
    ATB: '#EF4444',
    ORA: '#8B5CF6',
    BIS: '#06B6D4'
  };

  // Données simulées pour la démo
  const mockData = {
    dateGeneration: new Date().toISOString(),
    periode: { 
      debut: new Date().toISOString().split('T')[0], 
      fin: new Date().toISOString().split('T')[0] 
    },
    banques: [
      {
        banque: 'BDK' as BankType,
        dateRapport: new Date().toISOString().split('T')[0],
        compte: '1234567890',
        soldeOuverture: 15450000,
        soldeCloture: 16200000,
        depotsNonCredites: [
          { id: '1', reference: 'DEP001', montant: 500000, description: 'Dépôt client ABC', type: 'depot', statut: 'en_attente' },
        ],
        chequesNonDebites: [
          { id: '2', reference: 'CHQ001', montant: 750000, description: 'Chèque 123456', type: 'cheque', statut: 'en_attente' },
        ],
        autresDebits: [],
        autresCredits: [],
        facilitesBancaires: [
          { type: 'Découvert', montantAutorise: 5000000, montantUtilise: 1200000, montantDisponible: 3800000 }
        ],
        impayes: [
          { reference: 'IMP001', montant: 2000000, dateEcheance: '2025-06-20', dateRetour: '2025-06-22', motif: 'Provision insuffisante', clientCode: 'CLI001', description: 'CHAFIC AZAR & Cie' }
        ],
        metadata: {
          formatSource: 'PDF',
          versionParser: '1.0.0',
          dateExtraction: new Date().toISOString(),
          checksum: 'abc123'
        }
      }
    ],
    totaux: {
      liquiditeDisponible: 111400000,
      facilitesUtilisees: 809000000,
      montantRisque: 120100000,
      depotsEnAttente: 39400000
    },
    alertesGlobales: [
      {
        type: 'critique' as const,
        message: 'Impayé détecté',
        details: 'CHAFIC AZAR & Cie - 2,0 M FCFA',
        banque: 'BDK' as BankType,
        dateDetection: new Date().toISOString()
      },
      {
        type: 'attention' as const,
        message: 'Chèques anciens',
        details: 'Chèques en circulation depuis plus de 6 mois',
        banque: 'BDK' as BankType,
        dateDetection: new Date().toISOString()
      }
    ],
    recommandations: [
      'Traiter l\'impayé BDK en priorité',
      'Régulariser les chèques anciens',
      'Accélérer le traitement des dépôts en attente'
    ],
    tendances: {
      liquidite: [105000000, 98000000, 110000000, 115000000, 108000000, 111400000],
      facilites: [800000000, 805000000, 810000000, 815000000, 809000000, 809000000],
      dates: ['20/06', '21/06', '22/06', '23/06', '24/06', '25/06']
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedBanks]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // En production, utiliser le service réel
      // const data = await bankingUniversalService.generateConsolidatedReport(selectedBanks, new Date().toISOString().split('T')[0]);
      
      // Pour la démo, utiliser les données simulées
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulation du loading
      setConsolidatedData(mockData as RapportConsolide);
      
    } catch (error) {
      console.error('Erreur chargement dashboard:', error);
      toast({
        title: "Erreur de chargement",
        description: "Impossible de charger les données du dashboard",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
    toast({
      title: "Données actualisées",
      description: "Le dashboard a été mis à jour avec les dernières données",
    });
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'critique': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'attention': return <Clock className="h-4 w-4 text-yellow-600" />;
      default: return <CheckCircle className="h-4 w-4 text-blue-600" />;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-lg font-medium">Chargement du dashboard...</p>
            <p className="text-muted-foreground">Consolidation des données bancaires</p>
          </div>
        </div>
      </div>
    );
  }

  if (!consolidatedData) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Aucune donnée disponible. Veuillez d'abord importer des rapports bancaires.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard Bancaire Universel</h1>
          <p className="text-muted-foreground">
            Vue consolidée multi-banques - Dernière mise à jour: {new Date(consolidatedData.dateGeneration).toLocaleString('fr-FR')}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={refreshData} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
        </div>
      </div>

      {/* Métriques principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Liquidité Disponible</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatAmount(consolidatedData.totaux.liquiditeDisponible)}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 mr-1 text-green-600" />
              +2.3% par rapport à hier
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facilités Utilisées</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatAmount(consolidatedData.totaux.facilitesUtilisees)}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 mr-1 text-blue-600" />
              Taux d'utilisation: 40.9%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Montant à Risque</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatAmount(consolidatedData.totaux.montantRisque)}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingDown className="h-3 w-3 mr-1 text-green-600" />
              -1.2% par rapport à hier
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dépôts en Attente</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {formatAmount(consolidatedData.totaux.depotsEnAttente)}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 mr-1 text-yellow-600" />
              +5.2% par rapport à hier
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertes critiques */}
      {consolidatedData.alertesGlobales.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span>Alertes Actives ({consolidatedData.alertesGlobales.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {consolidatedData.alertesGlobales.map((alerte, index) => (
                <Alert key={index} className={`border-l-4 ${
                  alerte.type === 'critique' ? 'border-l-red-500 bg-red-50' :
                  alerte.type === 'attention' ? 'border-l-yellow-500 bg-yellow-50' :
                  'border-l-blue-500 bg-blue-50'
                }`}>
                  <div className="flex items-start space-x-3">
                    {getAlertIcon(alerte.type)}
                    <div className="flex-1">
                      <p className="font-medium">{alerte.message}</p>
                      <p className="text-sm text-muted-foreground">{alerte.details}</p>
                      <div className="flex items-center mt-2 space-x-2">
                        <Badge variant="outline">{alerte.banque}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(alerte.dateDetection).toLocaleString('fr-FR')}
                        </span>
                      </div>
                    </div>
                  </div>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Graphiques et analyses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Évolution de la liquidité */}
        <Card>
          <CardHeader>
            <CardTitle>Évolution de la Liquidité (7 jours)</CardTitle>
            <CardDescription>Tendance de la liquidité disponible</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={consolidatedData.tendances.dates.map((date, i) => ({
                date,
                liquidite: consolidatedData.tendances.liquidite[i] / 1000000 // En millions
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value} M FCFA`, 'Liquidité']} />
                <Line type="monotone" dataKey="liquidite" stroke="#10B981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Utilisation des facilités */}
        <Card>
          <CardHeader>
            <CardTitle>Utilisation des Facilités</CardTitle>
            <CardDescription>Évolution sur 7 jours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={consolidatedData.tendances.dates.map((date, i) => ({
                date,
                facilites: consolidatedData.tendances.facilites[i] / 1000000 // En millions
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value} M FCFA`, 'Facilités']} />
                <Bar dataKey="facilites" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Détails par banque */}
      <Card>
        <CardHeader>
          <CardTitle>Position par Banque</CardTitle>
          <CardDescription>Détails des positions bancaires individuelles</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="positions" className="space-y-4">
            <TabsList>
              <TabsTrigger value="positions">Positions</TabsTrigger>
              <TabsTrigger value="evolutions">Évolutions</TabsTrigger>
              <TabsTrigger value="intelligence">Intelligence IA</TabsTrigger>
              <TabsTrigger value="realtime">Temps Réel</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
            </TabsList>
            
            <TabsContent value="positions" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {consolidatedData.banques.map((rapport, index) => (
                  <Card key={index} className="border-l-4" style={{ borderLeftColor: bankColors[rapport.banque] }}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between text-lg">
                        <span>{rapport.banque}</span>
                        <Building2 className="h-5 w-5" style={{ color: bankColors[rapport.banque] }} />
                      </CardTitle>
                      <CardDescription>Compte: {rapport.compte}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Solde ouverture:</span>
                        <span className="font-medium">{formatAmount(rapport.soldeOuverture)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Solde clôture:</span>
                        <span className="font-medium">{formatAmount(rapport.soldeCloture)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Mouvement:</span>
                        <span className={`font-medium ${
                          rapport.soldeCloture - rapport.soldeOuverture >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatAmount(rapport.soldeCloture - rapport.soldeOuverture)}
                        </span>
                      </div>
                      <div className="pt-2 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Dépôts en attente:</span>
                          <span>{rapport.depotsNonCredites.length}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span>Chèques non débités:</span>
                          <span>{rapport.chequesNonDebites.length}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span>Impayés:</span>
                          <span className={rapport.impayes.length > 0 ? 'text-red-600 font-medium' : ''}>
                            {rapport.impayes.length}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="evolutions" className="space-y-4">
              <EvolutionAnalysis banque={selectedBanks[0]} />
            </TabsContent>
            
            <TabsContent value="intelligence" className="space-y-4">
              <IntelligenceMetier />
            </TabsContent>
            
            <TabsContent value="realtime" className="space-y-4">
              <RealtimeManager />
            </TabsContent>
            
            <TabsContent value="transactions">
              <div className="text-center py-8 text-muted-foreground">
                Vue détaillée des transactions en développement
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Recommandations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommandations Automatiques</CardTitle>
          <CardDescription>Actions suggérées basées sur l'analyse des données</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {consolidatedData.recommandations.map((recommandation, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <p className="text-sm">{recommandation}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankingDashboard;