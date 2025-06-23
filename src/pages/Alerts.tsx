
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle, X, Clock } from 'lucide-react';

const Alerts = () => {
  const [alerts, setAlerts] = useState([
    {
      id: 'ALT001',
      timestamp: '2024-01-15 08:45:00',
      type: 'amount_variance',
      severity: 'warning',
      message: 'Écart de montant détecté',
      details: 'SGS Bank - Attendu: 150,000 CFA, Trouvé: 153,500 CFA (+2.3%)',
      bank: 'SGS Bank',
      reference: 'TRX001234',
      status: 'active'
    },
    {
      id: 'ALT002',
      timestamp: '2024-01-15 08:30:00',
      type: 'unmatched_transaction',
      severity: 'error',
      message: 'Transaction non rapprochée',
      details: 'Aucune correspondance trouvée dans le Collection Report',
      bank: 'BICIS',
      reference: 'TRX001236',
      status: 'active'
    },
    {
      id: 'ALT003',
      timestamp: '2024-01-15 08:15:00',
      type: 'date_variance',
      severity: 'info',
      message: 'Écart de date',
      details: 'Transaction en retard de 2 jours par rapport à la date prévue',
      bank: 'BDK',
      reference: 'TRX001235',
      status: 'resolved'
    },
    {
      id: 'ALT004',
      timestamp: '2024-01-15 07:45:00',
      type: 'missing_file',
      severity: 'error',
      message: 'Fichier manquant',
      details: 'Relevé bancaire UBA non reçu pour la date du 15/01/2024',
      bank: 'UBA',
      reference: 'DAILY_REPORT_20240115',
      status: 'active'
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
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Attention</Badge>;
      case 'info':
        return <Badge variant="default" className="bg-blue-100 text-blue-800">Info</Badge>;
      default:
        return <Badge variant="secondary">Autre</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="destructive">Active</Badge>;
      case 'resolved':
        return <Badge variant="default" className="bg-green-100 text-green-800">Résolue</Badge>;
      case 'pending':
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800">En attente</Badge>;
      default:
        return <Badge variant="secondary">Inconnu</Badge>;
    }
  };

  const resolveAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, status: 'resolved' } : alert
    ));
  };

  const activeAlerts = alerts.filter(alert => alert.status === 'active');
  const resolvedAlerts = alerts.filter(alert => alert.status === 'resolved');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Gestion des Alertes</h1>
        <div className="flex space-x-2">
          <Button variant="outline">Marquer toutes comme lues</Button>
          <Button variant="outline">Exporter</Button>
        </div>
      </div>

      {/* Statistiques des alertes */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Actives</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{activeAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Nécessitent une action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Critiques</CardTitle>
            <X className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {activeAlerts.filter(a => a.severity === 'error').length}
            </div>
            <p className="text-xs text-muted-foreground">Priorité haute</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Résolues Aujourd'hui</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{resolvedAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Sur les dernières 24h</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Temps Moyen</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2.5h</div>
            <p className="text-xs text-muted-foreground">Résolution moyenne</p>
          </CardContent>
        </Card>
      </div>

      {/* Alertes actives */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <span>Alertes Actives</span>
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
                <TableHead>Référence</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeAlerts.map((alert) => (
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
                  <TableCell className="font-mono text-sm">{alert.reference}</TableCell>
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
      {resolvedAlerts.length > 0 && (
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
                {resolvedAlerts.map((alert) => (
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
    </div>
  );
};

export default Alerts;
