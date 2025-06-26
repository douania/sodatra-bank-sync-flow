
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, Building2, CreditCard, Clock } from 'lucide-react';
import { databaseService } from '@/services/databaseService';

interface ClientRiskAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientCode: string;
  clientData: {
    totalRisk: number;
    bankCount: number;
    banks: string[];
  };
}

interface ClientDetailData {
  collections: Array<{
    bankName: string;
    collectionAmount: number;
    reportDate: string;
    status: string;
    factureNo?: string;
    creditedDate?: string;
  }>;
  impayes: Array<{
    bankName: string;
    montant: number;
    dateEcheance: string;
    description?: string;
    clientCode: string;
  }>;
  facilities: Array<{
    bankName: string;
    facilityType: string;
    limitAmount: number;
    usedAmount: number;
    availableAmount: number;
  }>;
  depositsNotCleared: Array<{
    bankName: string;
    montant: number;
    dateDepot: string;
    typeReglement: string;
    reference?: string;
  }>;
}

const ClientRiskAnalysisModal: React.FC<ClientRiskAnalysisModalProps> = ({
  isOpen,
  onClose,
  clientCode,
  clientData
}) => {
  const [detailData, setDetailData] = useState<ClientDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && clientCode) {
      loadClientDetails();
    }
  }, [isOpen, clientCode]);

  const loadClientDetails = async () => {
    setLoading(true);
    try {
      // Charger les collections
      const collections = await databaseService.getCollectionsByClient(clientCode);
      
      // Charger les impayés de toutes les banques pour ce client
      const bankReports = await databaseService.getLatestBankReports();
      const allImpayes = bankReports.flatMap(report => 
        report.impayes
          .filter(impaye => impaye.clientCode === clientCode)
          .map(impaye => ({
            ...impaye,
            bankName: report.bank
          }))
      );
      
      // Charger les facilités liées au client (si disponibles)
      const allFacilities = bankReports.flatMap(report =>
        report.bankFacilities.map(facility => ({
          ...facility,
          bankName: report.bank
        }))
      );

      // Charger les dépôts non compensés du client
      const allDeposits = bankReports.flatMap(report =>
        report.depositsNotCleared
          .filter(deposit => deposit.clientCode === clientCode)
          .map(deposit => ({
            ...deposit,
            bankName: report.bank
          }))
      );

      setDetailData({
        collections,
        impayes: allImpayes,
        facilities: allFacilities,
        depositsNotCleared: allDeposits
      });
    } catch (error) {
      console.error('Erreur chargement détails client:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateRiskLevel = (amount: number, bankCount: number) => {
    if (amount > 50000000) return { level: 'CRITICAL', color: 'bg-red-500', label: 'Critique' };
    if (amount > 20000000 || bankCount > 2) return { level: 'HIGH', color: 'bg-orange-500', label: 'Élevé' };
    if (amount > 10000000 || bankCount > 1) return { level: 'MEDIUM', color: 'bg-yellow-500', label: 'Moyen' };
    return { level: 'LOW', color: 'bg-green-500', label: 'Faible' };
  };

  const formatCurrency = (amount: number) => {
    return `${(amount / 1000000).toFixed(1)}M FCFA`;
  };

  const riskLevel = calculateRiskLevel(clientData.totalRisk, clientData.bankCount);

  if (loading) {
    return (
      <Dialog open={isOpen} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-lg">Chargement des détails...</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building2 className="h-5 w-5" />
            <span>Analyse Détaillée - Client {clientCode}</span>
            <Badge className={`${riskLevel.color} text-white`}>
              {riskLevel.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Résumé Consolidé */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span>Résumé du Risque</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(clientData.totalRisk)}
                </div>
                <div className="text-sm text-gray-600">Exposition Totale</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {clientData.bankCount}
                </div>
                <div className="text-sm text-gray-600">Banques Impliquées</div>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {riskLevel.label}
                </div>
                <div className="text-sm text-gray-600">Niveau de Risque</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {clientData.banks.join(', ')}
                </div>
                <div className="text-sm text-gray-600">Banques</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Calcul du Risque */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>🧮 Méthode de Calcul du Risque</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded">
                <strong>Critères de Classification:</strong>
                <ul className="mt-2 space-y-1 text-sm">
                  <li>• <span className="text-red-600 font-semibold">CRITIQUE</span>: Montant {'>'}  50M FCFA</li>
                  <li>• <span className="text-orange-600 font-semibold">ÉLEVÉ</span>: Montant {'>'} 20M FCFA OU présent sur {'>'} 2 banques</li>
                  <li>• <span className="text-yellow-600 font-semibold">MOYEN</span>: Montant {'>'} 10M FCFA OU présent sur {'>'} 1 banque</li>
                  <li>• <span className="text-green-600 font-semibold">FAIBLE</span>: Autres cas</li>
                </ul>
              </div>
              <div className="p-3 bg-blue-50 rounded">
                <strong>Pour {clientCode}:</strong>
                <div className="mt-1 text-sm">
                  Montant total: {formatCurrency(clientData.totalRisk)} • 
                  Banques: {clientData.bankCount} • 
                  Résultat: <span className={`font-semibold ${riskLevel.color.replace('bg-', 'text-')}`}>
                    {riskLevel.label.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Données Détaillées */}
        <Tabs defaultValue="collections" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="impayes">Impayés</TabsTrigger>
            <TabsTrigger value="facilities">Facilités</TabsTrigger>
            <TabsTrigger value="deposits">Dépôts Non Compensés</TabsTrigger>
          </TabsList>

          <TabsContent value="collections" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <span>Collections (Table: collection_report)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detailData?.collections && detailData.collections.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Banque</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Date Rapport</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Facture N°</TableHead>
                        <TableHead>Date Crédit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.collections.map((collection, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{collection.bankName}</TableCell>
                          <TableCell className="text-green-600 font-semibold">
                            {formatCurrency(collection.collectionAmount)}
                          </TableCell>
                          <TableCell>{collection.reportDate}</TableCell>
                          <TableCell>
                            <Badge variant={collection.status === 'processed' ? 'default' : 'secondary'}>
                              {collection.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{collection.factureNo || '-'}</TableCell>
                          <TableCell>{collection.creditedDate || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucune collection trouvée pour ce client
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="impayes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <span>Impayés (Table: bank_reports → impayes)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detailData?.impayes && detailData.impayes.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Banque</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Date Échéance</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.impayes.map((impaye, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{impaye.bankName}</TableCell>
                          <TableCell className="text-red-600 font-semibold">
                            {formatCurrency(impaye.montant)}
                          </TableCell>
                          <TableCell>{impaye.dateEcheance}</TableCell>
                          <TableCell>{impaye.description || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucun impayé trouvé pour ce client
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="facilities" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <CreditCard className="h-5 w-5 text-blue-500" />
                  <span>Facilités Bancaires (Table: bank_reports → bank_facilities)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detailData?.facilities && detailData.facilities.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Banque</TableHead>
                        <TableHead>Type Facilité</TableHead>
                        <TableHead>Limite</TableHead>
                        <TableHead>Utilisé</TableHead>
                        <TableHead>Disponible</TableHead>
                        <TableHead>Taux Utilisation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.facilities.map((facility, index) => {
                        const utilizationRate = facility.limitAmount > 0 ? (facility.usedAmount / facility.limitAmount) * 100 : 0;
                        return (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{facility.bankName}</TableCell>
                            <TableCell>{facility.facilityType}</TableCell>
                            <TableCell>{formatCurrency(facility.limitAmount)}</TableCell>
                            <TableCell className="text-orange-600">
                              {formatCurrency(facility.usedAmount)}
                            </TableCell>
                            <TableCell className="text-green-600">
                              {formatCurrency(facility.availableAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={utilizationRate > 80 ? 'destructive' : utilizationRate > 50 ? 'secondary' : 'default'}>
                                {utilizationRate.toFixed(1)}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucune facilité trouvée
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deposits" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  <span>Dépôts Non Compensés (Table: bank_reports → deposits_not_cleared)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detailData?.depositsNotCleared && detailData.depositsNotCleared.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Banque</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Date Dépôt</TableHead>
                        <TableHead>Type Règlement</TableHead>
                        <TableHead>Référence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.depositsNotCleared.map((deposit, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{deposit.bankName}</TableCell>
                          <TableCell className="text-yellow-600 font-semibold">
                            {formatCurrency(deposit.montant)}
                          </TableCell>
                          <TableCell>{deposit.dateDepot}</TableCell>
                          <TableCell>{deposit.typeReglement}</TableCell>
                          <TableCell>{deposit.reference || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucun dépôt non compensé trouvé pour ce client
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ClientRiskAnalysisModal;
