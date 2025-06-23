
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertTriangle, Clock, FileX, TrendingUp, TrendingDown } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { BankReport, FundPosition } from '@/types/banking';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const Dashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
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
    } catch (error) {
      console.error('Erreur chargement dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculs des KPIs selon le guide SODATRA
  const totalOpeningBalance = bankReports.reduce((sum, report) => sum + report.openingBalance, 0);
  const totalClosingBalance = bankReports.reduce((sum, report) => sum + report.closingBalance, 0);
  const variationBalance = totalClosingBalance - totalOpeningBalance;
  const variationPercentage = totalOpeningBalance > 0 ? (variationBalance / totalOpeningBalance) * 100 : 0;

  // Facilités bancaires totales
  const totalFacilities = bankReports.reduce((acc, report) => {
    const facilities = report.bankFacilities.reduce((sum, facility) => ({
      limits: sum.limits + facility.limitAmount,
      used: sum.used + facility.usedAmount,
      available: sum.available + facility.availableAmount
    }), { limits: 0, used: 0, available: 0 });
    
    return {
      limits: acc.limits + facilities.limits,
      used: acc.used + facilities.used,
      available: acc.available + facilities.available
    };
  }, { limits: 0, used: 0, available: 0 });

  const utilizationRate = totalFacilities.limits > 0 ? (totalFacilities.used / totalFacilities.limits) * 100 : 0;

  // Impayés totaux
  const totalImpayes = bankReports.reduce((sum, report) => 
    sum + report.impayes.reduce((impayeSum, impaye) => impayeSum + impaye.montant, 0), 0
  );

  // Données pour les graphiques
  const bankBalanceData = bankReports.map(report => ({
    bank: report.bank,
    opening: report.openingBalance / 1000000, // En millions
    closing: report.closingBalance / 1000000
  }));

  const facilityData = bankReports.map(report => {
    const totalLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
    const totalUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
    return {
      bank: report.bank,
      limit: totalLimit / 1000000,
      used: totalUsed / 1000000,
      utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0
    };
  });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

  const recentAlerts = [
    { 
      id: 1, 
      type: 'warning', 
      message: `Variation significative des soldes (+${variationPercentage.toFixed(1)}%)`, 
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    },
    { 
      id: 2, 
      type: utilizationRate > 80 ? 'error' : 'info', 
      message: `Taux d'utilisation facilités: ${utilizationRate.toFixed(1)}%`, 
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    },
    { 
      id: 3, 
      type: totalImpayes > 0 ? 'warning' : 'info', 
      message: `Impayés détectés: ${(totalImpayes / 1000000).toFixed(2)}M CFA`, 
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Chargement du dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard de Contrôle Bancaire SODATRA</h1>
        <div className="text-sm text-gray-500">
          Dernière mise à jour: {new Date().toLocaleString('fr-FR')}
        </div>
      </div>

      {/* KPIs principaux selon le guide */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Soldes Totaux</CardTitle>
            <FileX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(totalClosingBalance / 1000000).toFixed(1)}M</div>
            <div className="flex items-center text-xs text-muted-foreground">
              {variationBalance >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
              )}
              {variationPercentage >= 0 ? '+' : ''}{variationPercentage.toFixed(1)}% vs ouverture
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fund Position</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fundPosition ? (fundPosition.grandTotal / 1000000).toFixed(1) : '0'}M
            </div>
            <p className="text-xs text-muted-foreground">
              Collections: {fundPosition ? (fundPosition.collectionsNotDeposited / 1000000).toFixed(1) : '0'}M
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facilités Bancaires</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{utilizationRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {(totalFacilities.used / 1000000).toFixed(1)}M / {(totalFacilities.limits / 1000000).toFixed(1)}M
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Impayés</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {(totalImpayes / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">
              {bankReports.reduce((sum, r) => sum + r.impayes.length, 0)} transactions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Graphiques des soldes bancaires */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Soldes par Banque (Millions CFA)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                opening: { label: "Ouverture", color: "#8884d8" },
                closing: { label: "Clôture", color: "#82ca9d" }
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
            <CardTitle>Utilisation des Facilités (%)</CardTitle>
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
                    data={facilityData}
                    dataKey="utilization"
                    nameKey="bank"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    fill="#8884d8"
                    label={(entry) => `${entry.bank}: ${entry.utilization.toFixed(1)}%`}
                  >
                    {facilityData.map((entry, index) => (
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

      {/* Statut des banques selon vos données réelles */}
      <Card>
        <CardHeader>
          <CardTitle>Statut par Banque</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {bankReports.map((report, index) => {
              const variation = report.closingBalance - report.openingBalance;
              const variationPercent = report.openingBalance > 0 ? (variation / report.openingBalance) * 100 : 0;
              const hasImpayes = report.impayes.length > 0;
              const status = hasImpayes ? 'error' : Math.abs(variationPercent) > 10 ? 'warning' : 'success';
              
              return (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      status === 'success' ? 'bg-green-500' :
                      status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <span className="font-medium">{report.bank}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {(report.closingBalance / 1000000).toFixed(1)}M CFA
                    </div>
                    <div className="text-xs text-gray-500">
                      {variation >= 0 ? '+' : ''}{(variation / 1000000).toFixed(1)}M ({variationPercent.toFixed(1)}%)
                    </div>
                    {hasImpayes && (
                      <div className="text-xs text-red-600">
                        {report.impayes.length} impayé(s)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Alertes calculées selon vos seuils */}
      <Card>
        <CardHeader>
          <CardTitle>Alertes du Système</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <Alert key={alert.id} className={
                alert.type === 'error' ? 'border-red-200 bg-red-50' :
                alert.type === 'warning' ? 'border-yellow-200 bg-yellow-50' : 
                'border-blue-200 bg-blue-50'
              }>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex justify-between items-center">
                  <span>{alert.message}</span>
                  <span className="text-sm text-gray-500">{alert.time}</span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
