
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

const Reconciliation = () => {
  const [searchTerm, setSearchTerm] = useState('');

  // Données simulées
  const reconciliationData = [
    {
      id: 'REC001',
      bank: 'SGS Bank',
      amount: 150000,
      reference: 'TRX001234',
      date: '2024-01-15',
      status: 'matched',
      matchScore: 98,
      collectionRef: 'COL567890'
    },
    {
      id: 'REC002',
      bank: 'BDK',
      amount: 75000,
      reference: 'TRX001235',
      date: '2024-01-15',
      status: 'partial',
      matchScore: 85,
      collectionRef: 'COL567891'
    },
    {
      id: 'REC003',
      bank: 'BICIS',
      amount: 200000,
      reference: 'TRX001236',
      date: '2024-01-14',
      status: 'unmatched',
      matchScore: 0,
      collectionRef: null
    }
  ];

  const alerts = [
    {
      id: 'ALT001',
      type: 'amount_variance',
      message: 'Écart de montant: SGS Bank - Attendu: 150,000 CFA, Trouvé: 153,500 CFA (+2.3%)',
      severity: 'warning',
      bank: 'SGS Bank',
      reference: 'TRX001234'
    },
    {
      id: 'ALT002',
      type: 'unmatched',
      message: 'Transaction non rapprochée: Aucune correspondance trouvée',
      severity: 'error',
      bank: 'BICIS',
      reference: 'TRX001236'
    },
    {
      id: 'ALT003',
      type: 'date_variance',
      message: 'Écart de date: Transaction en retard de 2 jours',
      severity: 'info',
      bank: 'BDK',
      reference: 'TRX001235'
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return <Badge variant="default" className="bg-green-100 text-green-800">Rapproché</Badge>;
      case 'partial':
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Partiel</Badge>;
      case 'unmatched':
        return <Badge variant="destructive">Non rapproché</Badge>;
      default:
        return <Badge variant="secondary">Inconnu</Badge>;
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <X className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const filteredData = reconciliationData.filter(item =>
    item.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.bank.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Rapprochement Bancaire</h1>
        <div className="flex space-x-2">
          <Button variant="outline">Exporter PDF</Button>
          <Button variant="outline">Exporter Excel</Button>
        </div>
      </div>

      <Tabs defaultValue="reconciliation" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reconciliation">Rapprochements</TabsTrigger>
          <TabsTrigger value="alerts">Alertes</TabsTrigger>
          <TabsTrigger value="statistics">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Résultats du Rapprochement</CardTitle>
                <div className="flex items-center space-x-2">
                  <Search className="h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Rechercher par référence ou banque..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Banque</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Réf. Collection</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.reference}</TableCell>
                      <TableCell>{item.bank}</TableCell>
                      <TableCell>{item.amount.toLocaleString()} CFA</TableCell>
                      <TableCell>{item.date}</TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>
                        <span className={`font-medium ${
                          item.matchScore >= 95 ? 'text-green-600' :
                          item.matchScore >= 80 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {item.matchScore}%
                        </span>
                      </TableCell>
                      <TableCell>{item.collectionRef || '-'}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          Détails
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Alertes et Anomalies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alerts.map((alert) => (
                  <div key={alert.id} className={`p-4 border rounded-lg ${
                    alert.severity === 'error' ? 'border-red-200 bg-red-50' :
                    alert.severity === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                    'border-blue-200 bg-blue-50'
                  }`}>
                    <div className="flex items-start space-x-3">
                      {getSeverityIcon(alert.severity)}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{alert.message}</p>
                        <div className="mt-1 text-sm text-gray-600">
                          <span className="font-medium">Banque:</span> {alert.bank} | 
                          <span className="font-medium ml-2">Référence:</span> {alert.reference}
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        Résoudre
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statistics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Taux de Rapprochement</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">85%</div>
                <p className="text-sm text-gray-600">2 sur 3 transactions rapprochées</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Montant Total</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">425,000</div>
                <p className="text-sm text-gray-600">CFA traités aujourd'hui</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Alertes Actives</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">3</div>
                <p className="text-sm text-gray-600">Nécessitent une attention</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reconciliation;
