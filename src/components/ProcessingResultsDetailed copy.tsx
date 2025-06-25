import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  FileSpreadsheet, 
  FileText, 
  Building2, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  TrendingUp,
  Users,
  DollarSign,
  Database
} from 'lucide-react';
import { ProcessingResult } from '@/services/enhancedFileProcessingService';

interface ProcessingResultsDetailedProps {
  results: ProcessingResult;
  processingTime?: number;
}

const ProcessingResultsDetailed: React.FC<ProcessingResultsDetailedProps> = ({ 
  results, 
  processingTime 
}) => {
  const getStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="h-5 w-5 text-green-500" />
    ) : (
      <XCircle className="h-5 w-5 text-red-500" />
    );
  };

  const getStatusBadge = (success: boolean) => {
    return (
      <Badge variant={success ? "default" : "destructive"}>
        {success ? "Succès" : "Échec"}
      </Badge>
    );
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fr-FR').format(num);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const calculateTotalCollectionAmount = () => {
    if (!results.data?.collectionReports) return 0;
    return results.data.collectionReports.reduce((total, collection) => 
      total + (collection.collectionAmount || 0), 0
    );
  };

  const calculateSuccessRate = () => {
    const totalItems = (results.data?.collectionReports?.length || 0) + 
                      (results.data?.bankReports?.length || 0) + 
                      (results.data?.fundPosition ? 1 : 0) + 
                      (results.data?.clientReconciliation?.length || 0);
    
    if (totalItems === 0) return 0;
    
    const errorCount = results.errors?.length || 0;
    return Math.max(0, Math.round(((totalItems - errorCount) / totalItems) * 100));
  };

  return (
    <div className="space-y-6 mt-8">
      {/* Résumé général */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            {getStatusIcon(results.success)}
            <span>Résumé du Traitement</span>
            {getStatusBadge(results.success)}
          </CardTitle>
          <CardDescription>
            Résultats de l'importation en masse des documents bancaires
            {processingTime && ` • Durée: ${Math.round(processingTime / 1000)}s`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Database className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Taux de Succès</p>
                <p className="text-2xl font-bold text-gray-900">{calculateSuccessRate()}%</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <FileSpreadsheet className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Collections</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatNumber(results.data?.collectionReports?.length || 0)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Building2 className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Rapports Bancaires</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatNumber(results.data?.bankReports?.length || 0)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <DollarSign className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Montant Total</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatCurrency(calculateTotalCollectionAmount())}
                </p>
              </div>
            </div>
          </div>
          
          {/* Barre de progression */}
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-500 mb-2">
              <span>Progression globale</span>
              <span>{calculateSuccessRate()}%</span>
            </div>
            <Progress value={calculateSuccessRate()} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Détails par type de document */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Collection Report */}
        {results.data?.collectionReports && results.data.collectionReports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <span>Collection Report</span>
              </CardTitle>
              <CardDescription>
                Données extraites du fichier Excel principal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Collections importées:</span>
                  <span className="font-medium">{formatNumber(results.data.collectionReports.length)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Montant total:</span>
                  <span className="font-medium">{formatCurrency(calculateTotalCollectionAmount())}</span>
                </div>
                {results.data.syncResult && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">Enrichissement Intelligent</p>
                    <div className="text-xs text-blue-600 mt-1">
                      <div>Nouvelles: {results.data.syncResult.new_collections || 0}</div>
                      <div>Enrichies: {results.data.syncResult.enriched_collections || 0}</div>
                      <div>Ignorées: {results.data.syncResult.ignored_collections || 0}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rapports Bancaires */}
        {results.data?.bankReports && results.data.bankReports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Building2 className="h-5 w-5 text-purple-600" />
                <span>Rapports Bancaires</span>
              </CardTitle>
              <CardDescription>
                Relevés et analyses bancaires traités
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {results.data.bankReports.map((report, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                    <div>
                      <span className="font-medium">{report.bank}</span>
                      <p className="text-xs text-gray-500">{report.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatCurrency(report.closingBalance)}
                      </p>
                      <p className="text-xs text-gray-500">Solde de clôture</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fund Position */}
        {results.data?.fundPosition && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-orange-600" />
                <span>Position des Fonds</span>
              </CardTitle>
              <CardDescription>
                Synthèse de la position financière
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Date du rapport:</span>
                  <span className="font-medium">{results.data.fundPosition.reportDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Fonds disponibles:</span>
                  <span className="font-medium">
                    {formatCurrency(results.data.fundPosition.totalFundAvailable)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Collections non déposées:</span>
                  <span className="font-medium">
                    {formatCurrency(results.data.fundPosition.collectionsNotDeposited)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-sm font-medium">Total général:</span>
                  <span className="font-bold text-lg">
                    {formatCurrency(results.data.fundPosition.grandTotal)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Client Reconciliation */}
        {results.data?.clientReconciliation && results.data.clientReconciliation.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-red-600" />
                <span>Réconciliation Client</span>
              </CardTitle>
              <CardDescription>
                Données de réconciliation des clients
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Clients traités:</span>
                  <span className="font-medium">{results.data.clientReconciliation.length}</span>
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {results.data.clientReconciliation.slice(0, 5).map((client, index) => (
                    <div key={index} className="flex justify-between text-xs py-1">
                      <span>{client.clientCode}</span>
                      <span>{formatCurrency(client.impayesAmount)}</span>
                    </div>
                  ))}
                  {results.data.clientReconciliation.length > 5 && (
                    <p className="text-xs text-gray-500 text-center mt-2">
                      ... et {results.data.clientReconciliation.length - 5} autres
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Erreurs et avertissements */}
      {results.errors && results.errors.length > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <span>Erreurs de Traitement</span>
            </CardTitle>
            <CardDescription>
              {results.errors.length} erreur(s) détectée(s) pendant le traitement
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.errors.map((error, index) => (
                <div key={index} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions recommandées */}
      <Card>
        <CardHeader>
          <CardTitle>Actions Recommandées</CardTitle>
          <CardDescription>
            Prochaines étapes suggérées après ce traitement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {results.success ? (
              <>
                <div className="flex items-center space-x-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Traitement terminé avec succès</span>
                </div>
                <div className="text-sm text-gray-600">
                  • Consultez le tableau de bord consolidé pour une vue d'ensemble
                  • Vérifiez les rapprochements automatiques dans la section Réconciliation
                  • Examinez les alertes qualité si disponibles
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-2 text-red-600">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm">Traitement partiellement échoué</span>
                </div>
                <div className="text-sm text-gray-600">
                  • Vérifiez les erreurs ci-dessus et corrigez les fichiers si nécessaire
                  • Relancez le traitement pour les fichiers en échec
                  • Contactez le support si les erreurs persistent
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProcessingResultsDetailed;

