
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertTriangle, Clock, FileX } from 'lucide-react';

const Dashboard = () => {
  // Données simulées pour la démonstration
  const stats = {
    filesProcessed: 12,
    reconciliationRate: 85,
    alertsCount: 3,
    lastProcessing: '2024-01-15 08:30:00'
  };

  const recentAlerts = [
    { id: 1, type: 'warning', message: 'Écart de montant détecté - SGS Bank (+2.3%)', time: '08:45' },
    { id: 2, type: 'error', message: 'Transaction non rapprochée - Ref: TRX001234', time: '08:30' },
    { id: 3, type: 'info', message: 'Nouveau fichier de rapprochement traité', time: '08:15' }
  ];

  const banks = [
    { name: 'SGS Bank', status: 'success', reconciled: 45, total: 50 },
    { name: 'BDK', status: 'warning', reconciled: 38, total: 42 },
    { name: 'BICIS', status: 'success', reconciled: 22, total: 22 },
    { name: 'UBA', status: 'error', reconciled: 15, total: 20 }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard de Contrôle Bancaire</h1>
        <div className="text-sm text-gray-500">
          Dernière mise à jour: {stats.lastProcessing}
        </div>
      </div>

      {/* Statistiques principales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fichiers Traités</CardTitle>
            <FileX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.filesProcessed}</div>
            <p className="text-xs text-muted-foreground">Aujourd'hui</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taux de Rapprochement</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.reconciliationRate}%</div>
            <p className="text-xs text-muted-foreground">Sur les dernières 24h</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Actives</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.alertsCount}</div>
            <p className="text-xs text-muted-foreground">Nécessitent une action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Statut Global</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">Actif</div>
            <p className="text-xs text-muted-foreground">Système opérationnel</p>
          </CardContent>
        </Card>
      </div>

      {/* Statut des banques */}
      <Card>
        <CardHeader>
          <CardTitle>Statut par Banque</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {banks.map((bank, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    bank.status === 'success' ? 'bg-green-500' :
                    bank.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="font-medium">{bank.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {bank.reconciled}/{bank.total} rapprochés
                  </div>
                  <div className="text-xs text-gray-500">
                    {Math.round((bank.reconciled / bank.total) * 100)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Alertes récentes */}
      <Card>
        <CardHeader>
          <CardTitle>Alertes Récentes</CardTitle>
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
