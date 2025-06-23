
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, CheckCircle, X, Clock, RefreshCw } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { BankReport, FundPosition } from '@/types/banking';
import AlertsManager from '@/components/AlertsManager';

const Alerts = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    loadAlertsData();
  }, []);

  const loadAlertsData = async () => {
    setLoading(true);
    try {
      const [reports, position] = await Promise.all([
        databaseService.getLatestBankReports(),
        databaseService.getLatestFundPosition()
      ]);
      
      setBankReports(reports);
      setFundPosition(position);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Erreur chargement alertes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Alertes historiques simulées pour la démonstration
  const [historicalAlerts] = useState([
    {
      id: 'ALT001',
      timestamp: '2024-01-15 08:45:00',
      type: 'amount_variance',
      severity: 'warning',
      message: 'Variation significative SGS Bank',
      details: 'Variation de +18.2% détectée sur les soldes SGS Bank',
      bank: 'SGS Bank',
      reference: 'VAR001234',
      status: 'active',
      value: 18.2,
      threshold: 15
    },
    {
      id: 'ALT002',
      timestamp: '2024-01-15 08:30:00',
      type: 'facility_critical',
      severity: 'error',
      message: 'Facilité critique BICIS',
      details: 'Facilité caisse utilisée à 95.8%',
      bank: 'BICIS',
      reference: 'FAC001236',
      status: 'resolved',
      value: 95.8,
      threshold: 90
    },
    {
      id: 'ALT003',
      timestamp: '2024-01-15 08:15:00',
      type: 'unpaid_detected',
      severity: 'warning',
      message: 'Impayés détectés BDK',
      details: '3 impayés pour un montant total de 12.5M CFA',
      bank: 'BDK',
      reference: 'IMP001235',
      status: 'active',
      value: 12.5
    }
  ]);

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <X className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'error':
        return <Badge variant="destructive">Critique</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-100 text-yellow-800">Attention</Badge>;
      case 'info':
        return <Badge className="bg-blue-100 text-blue-800">Info</Badge>;
      default:
        return <Badge variant="secondary">Autre</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="destructive">Active</Badge>;
      case 'resolved':
        return <Badge className="bg-green-100 text-green-800">Résolue</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">En attente</Badge>;
      default:
        return <Badge variant="secondary">Inconnu</Badge>;
    }
  };

  const resolveAlert = (alertId: string) => {
    // Logique de résolution d'alerte - à implémenter avec la base de données
    console.log('Résolution alerte:', alertId);
  };

  const activeHistoricalAlerts = historicalAlerts.filter(alert => alert.status === 'active');
  const resolvedHistoricalAlerts = historicalAlerts.filter(alert => alert.status === 'resolved');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Chargement des alertes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Système d'Alertes SODATRA</h1>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={loadAlertsData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
          <Button variant="outline">Exporter</Button>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        Dernière actualisation: {lastRefresh.toLocaleString('fr-FR')}
      </div>

      <Tabs defaultValue="live" className="space-y-6">
        <TabsList>
          <TabsTrigger value="live">Alertes en Temps Réel</TabsTrigger>
          <TabsTrigger value="historical">Historique</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-6">
          <AlertsManager bankReports={bankReports} fundPosition={fundPosition} />
        </TabsContent>

        <TabsContent value="historical" className="space-y-6">
          {/* Alertes historiques actives */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <span>Alertes Historiques Actives</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horodatage</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Sévérité</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Banque</TableHead>
                    <TableHead>Valeur/Seuil</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeHistoricalAlerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell className="text-sm">{alert.timestamp}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getSeverityIcon(alert.severity)}
                          <span className="text-sm">{alert.type.replace(/_/g, ' ')}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getSeverityBadge(alert.severity)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{alert.message}</p>
                          <p className="text-sm text-gray-600">{alert.details}</p>
                        </div>
                      </TableCell>
                      <TableCell>{alert.bank}</TableCell>
                      <TableCell className="text-sm">
                        {alert.value && (
                          <div>
                            <span className="font-mono">{alert.value}</span>
                            {alert.threshold && <span className="text-gray-500"> / {alert.threshold}</span>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(alert.status)}</TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => resolveAlert(alert.id)}
                          >
                            Résoudre
                          </Button>
                          <Button variant="outline" size="sm">
                            Détails
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Alertes résolues */}
          {resolvedHistoricalAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Alertes Résolues</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Horodatage</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Banque</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolvedHistoricalAlerts.map((alert) => (
                      <TableRow key={alert.id} className="opacity-75">
                        <TableCell className="text-sm">{alert.timestamp}</TableCell>
                        <TableCell>{alert.type.replace(/_/g, ' ')}</TableCell>
                        <TableCell>{alert.message}</TableCell>
                        <TableCell>{alert.bank}</TableCell>
                        <TableCell>{getStatusBadge(alert.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="config" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration des Seuils d'Alerte</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Variation des soldes (%)</label>
                    <input 
                      type="number" 
                      defaultValue="15" 
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Seuil en pourcentage"
                    />
                    <p className="text-xs text-gray-500">Seuil d'alerte pour les variations importantes de soldes</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Utilisation facilités (%)</label>
                    <input 
                      type="number" 
                      defaultValue="80" 
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Seuil en pourcentage"
                    />
                    <p className="text-xs text-gray-500">Seuil d'alerte pour l'utilisation des facilités bancaires</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Collections non déposées (M CFA)</label>
                    <input 
                      type="number" 
                      defaultValue="200" 
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Montant en millions"
                    />
                    <p className="text-xs text-gray-500">Seuil d'alerte pour les collections en attente</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Écart Fund Position (%)</label>
                    <input 
                      type="number" 
                      defaultValue="5" 
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Seuil en pourcentage"
                    />
                    <p className="text-xs text-gray-500">Seuil d'écart acceptable entre Fund Position et soldes</p>
                  </div>
                </div>
                
                <div className="pt-4">
                  <Button>Sauvegarder la Configuration</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Alerts;
