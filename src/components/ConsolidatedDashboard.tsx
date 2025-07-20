import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Building2, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  AlertTriangle,
  CheckCircle,
  Activity,
  PieChart,
  BarChart3,
  Globe
} from 'lucide-react';
import ConsolidatedMetrics from '@/components/ConsolidatedMetrics';
import ConsolidatedCharts from '@/components/ConsolidatedCharts';
import ConsolidatedBankView from '@/components/ConsolidatedBankView';
import CriticalAlertsPanel from '@/components/CriticalAlertsPanel';
import { BankingUniversalService } from '@/services/bankingUniversalService';
import { BankType } from '@/types/banking-universal';
import { toast } from 'sonner';

interface ConsolidatedData {
  totalBalance: number;
  totalMovements: number;
  bankCount: number;
  lastUpdate: string;
  monthlyGrowth: number;
  alertsCount: number;
  healthScore: number;
  bankBreakdown: Array<{
    name: string;
    balance: number;
    percentage: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
  trends: Array<{
    period: string;
    balance: number;
    movements: number;
  }>;
}

export function ConsolidatedDashboard() {
  const [data, setData] = useState<ConsolidatedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedView, setSelectedView] = useState<'overview' | 'details'>('overview');

  const bankingService = new BankingUniversalService();

  useEffect(() => {
    loadConsolidatedData();
  }, [timeRange]);

  const loadConsolidatedData = async () => {
    try {
      setLoading(true);
      
      // Charger les données pour toutes les banques
      const banks: BankType[] = ['BDK', 'ATB', 'BICIS', 'ORA', 'SGS', 'BIS'];
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - (timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90) * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      const consolidatedReport = await bankingService.generateConsolidatedReport(banks, endDate);
      
      // Simuler des données consolidées
      const mockData: ConsolidatedData = {
        totalBalance: consolidatedReport.totaux.liquiditeDisponible,
        totalMovements: consolidatedReport.banques.length * 50, // Estimation
        bankCount: banks.length,
        lastUpdate: new Date().toISOString(),
        monthlyGrowth: 2.3,
        alertsCount: consolidatedReport.alertesGlobales.length,
        healthScore: 92,
        bankBreakdown: consolidatedReport.banques.map(banque => ({
          name: banque.banque,
          balance: banque.soldeCloture,
          percentage: (banque.soldeCloture / consolidatedReport.totaux.liquiditeDisponible) * 100,
          status: banque.soldeCloture > 1000000 ? 'healthy' : banque.soldeCloture > 500000 ? 'warning' : 'critical'
        })),
        trends: [
          { period: 'S1', balance: 95000000, movements: 245 },
          { period: 'S2', balance: 97500000, movements: 267 },
          { period: 'S3', balance: 102000000, movements: 289 },
          { period: 'S4', balance: consolidatedReport.totaux.liquiditeDisponible, movements: consolidatedReport.banques.length * 50 }
        ]
      };

      setData(mockData);
    } catch (error) {
      console.error('Erreur lors du chargement des données consolidées:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-warning" />
        <p>Impossible de charger les données consolidées</p>
        <Button onClick={loadConsolidatedData} className="mt-4">
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Globe className="h-8 w-8" />
            Vue Consolidée Multi-Banques
          </h1>
          <p className="text-muted-foreground mt-1">
            Dernière mise à jour: {new Date(data.lastUpdate).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={timeRange === '7d' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange('7d')}
          >
            7j
          </Button>
          <Button
            variant={timeRange === '30d' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange('30d')}
          >
            30j
          </Button>
          <Button
            variant={timeRange === '90d' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange('90d')}
          >
            90j
          </Button>
          <Button onClick={loadConsolidatedData} variant="outline">
            <Activity className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
        </div>
      </div>

      {/* Métriques principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Solde Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(data.totalBalance / 1000000).toFixed(1)}M FCFA
            </div>
            <div className="flex items-center text-xs text-success">
              <TrendingUp className="h-3 w-3 mr-1" />
              +{data.monthlyGrowth}% ce mois
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Banques Actives</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.bankCount}</div>
            <div className="text-xs text-muted-foreground">
              Toutes opérationnelles
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Score de Santé</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{data.healthScore}%</div>
            <Progress value={data.healthScore} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Actives</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{data.alertsCount}</div>
            <div className="text-xs text-muted-foreground">
              Nécessitent attention
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Répartition par banque */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            Répartition par Banque
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.bankBreakdown.map((bank) => (
              <div key={bank.name} className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-semibold">{bank.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {(bank.balance / 1000000).toFixed(1)}M FCFA
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{bank.percentage.toFixed(1)}%</div>
                  <Badge 
                    variant={
                      bank.status === 'healthy' ? 'default' : 
                      bank.status === 'warning' ? 'secondary' : 
                      'destructive'
                    }
                    className="text-xs"
                  >
                    {bank.status === 'healthy' ? 'Sain' : 
                     bank.status === 'warning' ? 'Attention' : 'Critique'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={selectedView} onValueChange={(value) => setSelectedView(value as any)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="details">Détails par banque</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="alerts">Alertes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <ConsolidatedMetrics metrics={null} />
          <ConsolidatedCharts bankReports={[]} />
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          <ConsolidatedBankView bankReports={[]} consolidatedAnalysis={null} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Évolution des Soldes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.trends.map((trend, index) => (
                    <div key={trend.period} className="flex items-center justify-between">
                      <span className="font-medium">{trend.period}</span>
                      <div className="text-right">
                        <div className="font-semibold">
                          {(trend.balance / 1000000).toFixed(1)}M FCFA
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {trend.movements} mouvements
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Indicateurs de Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Disponibilité des données</span>
                    <div className="text-right">
                      <div className="font-semibold text-success">99.2%</div>
                      <Progress value={99.2} className="w-20 mt-1" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Précision des rapprochements</span>
                    <div className="text-right">
                      <div className="font-semibold text-success">96.8%</div>
                      <Progress value={96.8} className="w-20 mt-1" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Temps de traitement moyen</span>
                    <div className="text-right">
                      <div className="font-semibold">2.3s</div>
                      <div className="text-xs text-muted-foreground">Par rapport</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <CriticalAlertsPanel criticalAlerts={[]} crossBankClients={{ riskyClients: [] }} />
        </TabsContent>
      </Tabs>
    </div>
  );
}