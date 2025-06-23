import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertTriangle, Clock, FileX, TrendingUp, TrendingDown, DollarSign, Building2 } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { crossBankAnalysisService } from '@/services/crossBankAnalysisService';
import { BankReport, FundPosition } from '@/types/banking';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

const Dashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
  const [consolidatedAnalysis, setConsolidatedAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [reports, position] = await Promise.all([
        databaseService.getLatestBankReports(),
        databaseService.getLatestFundPosition()
      ]);
      
      setBankReports(reports);
      setFundPosition(position);
      
      if (reports.length > 0) {
        const analysis = crossBankAnalysisService.analyzeConsolidatedPosition(reports);
        const alerts = crossBankAnalysisService.generateCriticalAlerts(analysis);
        
        setConsolidatedAnalysis({
          consolidatedPosition: analysis,
          consolidatedFacilities: {
            totalLimits: analysis.totalFacilityLimits,
            totalUsed: analysis.totalFacilityUsed,
            totalAvailable: analysis.totalFacilityAvailable,
            utilizationRate: analysis.utilizationRate
          },
          totalImpayes: {
            totalAmount: analysis.totalImpayes,
            totalCount: analysis.impayeCount
          },
          crossBankClients: {
            riskyClients: analysis.crossBankImpayes.map(impaye => ({
              clientCode: impaye.clientCode,
              bankCount: impaye.bankCount,
              banks: impaye.banks.map(b => b.bankName),
              totalRisk: impaye.totalAmount
            }))
          },
          criticalAlerts: alerts
        });
        
        console.log('🏦 Analyse consolidée:', analysis);
      }
    } catch (error) {
      console.error('Erreur chargement dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Chargement du dashboard consolidé...</div>
      </div>
    );
  }

  const analysis = consolidatedAnalysis || {
    consolidatedPosition: { totalOpeningBalance: 0, totalClosingBalance: 0, netMovement: 0, variationPercentage: 0 },
    consolidatedFacilities: { totalLimits: 0, totalUsed: 0, totalAvailable: 0, utilizationRate: 0 },
    totalImpayes: { totalAmount: 0, totalCount: 0 },
    crossBankClients: { riskyClients: [], crossBankImpayes: [] },
    criticalAlerts: []
  };

  // Données pour les graphiques consolidés
  const bankBalanceData = bankReports.map(report => ({
    bank: report.bank,
    opening: report.openingBalance / 1000000,
    closing: report.closingBalance / 1000000,
    movement: (report.closingBalance - report.openingBalance) / 1000000
  }));

  const facilityUtilizationData = bankReports.map(report => {
    const totalLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
    const totalUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
    return {
      bank: report.bank,
      limit: totalLimit / 1000000,
      used: totalUsed / 1000000,
      utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
      available: (totalLimit - totalUsed) / 1000000
    };
  });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Consolidé Multi-Banques SODATRA</h1>
        <div className="text-sm text-gray-500">
          Position consolidée au {new Date().toLocaleDateString('fr-FR')}
        </div>
      </div>

      {/* KPIs Consolidés Critiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Position Consolidée</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(analysis.consolidatedPosition.totalClosingBalance / 1000000).toFixed(1)}M
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              {analysis.consolidatedPosition.netMovement >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
              )}
              {analysis.consolidatedPosition.variationPercentage >= 0 ? '+' : ''}
              {analysis.consolidatedPosition.variationPercentage.toFixed(1)}% variation
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facilités Consolidées</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(analysis.consolidatedFacilities.totalLimits / 1000000000).toFixed(1)}Md
            </div>
            <div className="text-xs text-muted-foreground">
              Utilisé: {analysis.consolidatedFacilities.utilizationRate.toFixed(1)}%
            </div>
            <div className="text-xs text-green-600">
              Disponible: {(analysis.consolidatedFacilities.totalAvailable / 1000000000).toFixed(1)}Md
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Impayés Cross-Bank</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {(analysis.totalImpayes.totalAmount / 1000000).toFixed(1)}M
            </div>
            <div className="text-xs text-muted-foreground">
              {analysis.totalImpayes.totalCount} transactions
            </div>
            <div className="text-xs text-red-500">
              {analysis.crossBankClients.riskyClients.length} clients multi-banques
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Critiques</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {analysis.criticalAlerts.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Surveillance active
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alertes Cross-Bank Critiques */}
      {analysis.criticalAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">🚨 Alertes Cross-Bank Critiques</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.criticalAlerts.map((alert: any, index: number) => (
                <Alert key={index} className="border-red-200 bg-red-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold">{alert.title}</span>
                      <div className="text-sm text-gray-600">{alert.description}</div>
                    </div>
                    <div className="text-sm font-medium text-red-600">
                      {alert.value && `${(alert.value / 1000000).toFixed(1)}M FCFA`}
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Graphiques Consolidés */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Mouvements par Banque (Millions FCFA)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                opening: { label: "Ouverture", color: "#8884d8" },
                closing: { label: "Clôture", color: "#82ca9d" },
                movement: { label: "Mouvement", color: "#ff7300" }
              }}
              className="h-80"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bankBalanceData}>
                  <XAxis dataKey="bank" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="opening" fill="#8884d8" name="Ouverture" />
                  <Bar dataKey="closing" fill="#82ca9d" name="Clôture" />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Utilisation des Facilités par Banque</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                utilization: { label: "Utilisation %", color: "#ff7300" }
              }}
              className="h-80"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={facilityUtilizationData}
                    dataKey="utilization"
                    nameKey="bank"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    fill="#8884d8"
                    label={(entry) => `${entry.bank}: ${entry.utilization.toFixed(1)}%`}
                  >
                    {facilityUtilizationData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Clients Cross-Bank à Risque */}
      {analysis.crossBankClients.riskyClients.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>⚠️ Clients Multi-Banques à Risque</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analysis.crossBankClients.riskyClients.map((client: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg bg-red-50">
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div>
                      <span className="font-medium">{client.clientCode}</span>
                      <div className="text-sm text-gray-500">
                        Présent sur {client.bankCount} banques: {client.banks.join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-red-600">
                      {(client.totalRisk / 1000000).toFixed(1)}M FCFA
                    </div>
                    <div className="text-xs text-gray-500">
                      Exposition totale
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statut Détaillé par Banque */}
      <Card>
        <CardHeader>
          <CardTitle>Position Détaillée par Banque</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {bankReports.map((report, index) => {
              const variation = report.closingBalance - report.openingBalance;
              const variationPercent = report.openingBalance > 0 ? (variation / report.openingBalance) * 100 : 0;
              const hasImpayes = report.impayes.length > 0;
              const hasCriticalMovement = Math.abs(variation) > 50000000; // >50M
              const status = hasImpayes || hasCriticalMovement ? 'error' : Math.abs(variationPercent) > 10 ? 'warning' : 'success';
              
              const totalFacilityLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
              const totalFacilityUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
              const facilityRate = totalFacilityLimit > 0 ? (totalFacilityUsed / totalFacilityLimit) * 100 : 0;
              
              return (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      status === 'success' ? 'bg-green-500' :
                      status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <div>
                      <span className="font-medium">{report.bank}</span>
                      <div className="text-xs text-gray-500">
                        Facilités: {facilityRate.toFixed(1)}% utilisé 
                        ({(totalFacilityUsed / 1000000).toFixed(0)}M / {(totalFacilityLimit / 1000000).toFixed(0)}M)
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {(report.closingBalance / 1000000).toFixed(1)}M FCFA
                    </div>
                    <div className="text-xs text-gray-500">
                      {variation >= 0 ? '+' : ''}{(variation / 1000000).toFixed(1)}M ({variationPercent.toFixed(1)}%)
                    </div>
                    {hasImpayes && (
                      <div className="text-xs text-red-600">
                        {report.impayes.length} impayé(s) - {(report.impayes.reduce((sum, i) => sum + i.montant, 0) / 1000000).toFixed(1)}M
                      </div>
                    )}
                    {report.checksNotCleared && report.checksNotCleared.length > 0 && (
                      <div className="text-xs text-orange-600">
                        {report.checksNotCleared.length} chèque(s) non débité(s)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
