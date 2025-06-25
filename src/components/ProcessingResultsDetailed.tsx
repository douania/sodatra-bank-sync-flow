
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, TrendingDown, Zap, MapPin, DollarSign, CheckCircle, AlertTriangle, Database } from 'lucide-react';

interface ProcessingResultsDetailedProps {
  results: {
    success: boolean;
    data?: {
      bankReports: any[];
      collectionReports?: any[];
      syncResult?: any;
    };
    errors?: string[];
  };
}

const ProcessingResultsDetailed: React.FC<ProcessingResultsDetailedProps> = ({ results }) => {
  if (!results.data) return null;

  const { bankReports = [], collectionReports = [], syncResult } = results.data;

  // ⭐ DÉTECTER LE TYPE DE TRAITEMENT
  const hasCollectionReport = collectionReports && collectionReports.length > 0;
  const hasBankReports = bankReports && bankReports.length > 0;
  const isCollectionOnlyUpload = hasCollectionReport && !hasBankReports;

  // ⭐ CRÉER UN SYNC RESULT FACTICE SI SEUL LE COLLECTION REPORT A ÉTÉ TRAITÉ
  const effectiveSyncResult = syncResult || (isCollectionOnlyUpload ? {
    new_collections: collectionReports.length,
    enriched_collections: 0,
    ignored_collections: 0,
    errors: []
  } : null);

  // Analyser les nouvelles données bancaires
  const bankMovements = bankReports.flatMap(report => [
    ...report.depositsNotCleared.map((deposit: any) => ({
      type: 'credit',
      bank: report.bank,
      amount: deposit.montant,
      date: deposit.dateValeur || deposit.dateDepot,
      reference: deposit.reference,
      clientCode: deposit.clientCode,
      description: `Dépôt non compensé - ${deposit.typeReglement}`
    })),
    ...report.impayes.map((impaye: any) => ({
      type: 'debit',
      bank: report.bank,
      amount: impaye.montant,
      date: impaye.dateRetour,
      reference: impaye.description,
      clientCode: impaye.clientCode,
      description: `Impayé - ${impaye.description}`
    }))
  ]);

  const totalCredits = bankMovements
    .filter(m => m.type === 'credit')
    .reduce((sum, m) => sum + m.amount, 0);

  const totalDebits = bankMovements
    .filter(m => m.type === 'debit')
    .reduce((sum, m) => sum + m.amount, 0);

  const netImpact = totalCredits - totalDebits;

  // Analyser les enrichissements automatiques
  const enrichments = effectiveSyncResult ? {
    newCollections: effectiveSyncResult.new_collections || 0,
    enrichedCollections: effectiveSyncResult.enriched_collections || 0,
    dateValidityAdded: effectiveSyncResult.summary?.enrichments?.date_of_validity_added || 0,
    commissionsAdded: effectiveSyncResult.summary?.enrichments?.bank_commissions_added || 0,
    referencesUpdated: effectiveSyncResult.summary?.enrichments?.references_updated || 0,
    statusesUpdated: effectiveSyncResult.summary?.enrichments?.statuses_updated || 0
  } : null;

  // ⭐ DÉTERMINER QUELS ONGLETS AFFICHER
  const availableTabs = [];
  
  if (hasCollectionReport) {
    availableTabs.push('collections');
  }
  
  if (hasBankReports && bankMovements.length > 0) {
    availableTabs.push('movements');
  }
  
  if (effectiveSyncResult) {
    availableTabs.push('enrichments');
  }
  
  if (hasBankReports || hasCollectionReport) {
    availableTabs.push('matching');
  }

  const defaultTab = availableTabs[0] || 'collections';

  return (
    <div className="space-y-6">
      {/* ⭐ RÉSUMÉ ADAPTATIF SELON LE TYPE DE TRAITEMENT */}
      {isCollectionOnlyUpload ? (
        // Résumé pour Collection Report uniquement
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Database className="h-5 w-5 text-blue-600" />
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {enrichments?.newCollections || 0}
                  </div>
                  <div className="text-sm text-blue-800">
                    Collections importées
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {collectionReports.reduce((sum, c) => sum + (c.collectionAmount || 0), 0).toLocaleString()} FCFA
                  </div>
                  <div className="text-sm text-green-800">
                    Montant total importé
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        // Résumé pour traitement complet avec relevés bancaires
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {totalCredits.toLocaleString()} FCFA
                  </div>
                  <div className="text-sm text-green-800">
                    Crédits détectés (+solde)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {totalDebits.toLocaleString()} FCFA
                  </div>
                  <div className="text-sm text-red-800">
                    Débits détectés (-solde)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-blue-200 ${netImpact >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <DollarSign className={`h-5 w-5 ${netImpact >= 0 ? 'text-blue-600' : 'text-orange-600'}`} />
                <div>
                  <div className={`text-2xl font-bold ${netImpact >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {netImpact >= 0 ? '+' : ''}{netImpact.toLocaleString()} FCFA
                  </div>
                  <div className={`text-sm ${netImpact >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>
                    Impact net sur solde
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList className={`grid w-full grid-cols-${availableTabs.length}`}>
          {availableTabs.includes('collections') && (
            <TabsTrigger value="collections">Collections Importées</TabsTrigger>
          )}
          {availableTabs.includes('movements') && (
            <TabsTrigger value="movements">Mouvements Bancaires</TabsTrigger>
          )}
          {availableTabs.includes('enrichments') && (
            <TabsTrigger value="enrichments">Enrichissements</TabsTrigger>
          )}
          {availableTabs.includes('matching') && (
            <TabsTrigger value="matching">Rapprochements</TabsTrigger>
          )}
        </TabsList>

        {/* ⭐ NOUVEL ONGLET: Collections Importées */}
        {availableTabs.includes('collections') && (
          <TabsContent value="collections">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="h-5 w-5" />
                  <span>Collections Importées du Fichier Excel</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {enrichments?.newCollections || 0}
                      </div>
                      <div className="text-sm text-blue-800">Nouvelles collections</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {collectionReports.reduce((sum, c) => sum + (c.collectionAmount || 0), 0).toLocaleString()}
                      </div>
                      <div className="text-sm text-green-800">Montant total (FCFA)</div>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">
                        {collectionReports.filter(c => c.bankName).length}
                      </div>
                      <div className="text-sm text-purple-800">Avec banque renseignée</div>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-600">
                        {new Set(collectionReports.map(c => c.clientCode)).size}
                      </div>
                      <div className="text-sm text-yellow-800">Clients uniques</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm">
                        Toutes les collections ont été importées avec traçabilité Excel complète
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm">
                        Prêt pour le rapprochement avec les relevés bancaires
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Onglet Mouvements Bancaires (seulement si relevés disponibles) */}
        {availableTabs.includes('movements') && (
          <TabsContent value="movements">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <MapPin className="h-5 w-5" />
                  <span>Nouveaux Mouvements Détectés</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bankMovements.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    Aucun nouveau mouvement bancaire détecté
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Banque</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Montant</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bankMovements.map((movement, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Badge variant={movement.type === 'credit' ? 'default' : 'destructive'}>
                              {movement.type === 'credit' ? (
                                <div className="flex items-center space-x-1">
                                  <TrendingUp className="h-3 w-3" />
                                  <span>Crédit</span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1">
                                  <TrendingDown className="h-3 w-3" />
                                  <span>Débit</span>
                                </div>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{movement.bank}</TableCell>
                          <TableCell>{movement.date}</TableCell>
                          <TableCell>{movement.clientCode || '-'}</TableCell>
                          <TableCell>{movement.description}</TableCell>
                          <TableCell className={`text-right font-bold ${
                            movement.type === 'credit' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {movement.type === 'credit' ? '+' : '-'}{movement.amount.toLocaleString()} FCFA
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Onglet Enrichissements */}
        {availableTabs.includes('enrichments') && (
          <TabsContent value="enrichments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="h-5 w-5" />
                  <span>
                    {isCollectionOnlyUpload ? 'Import Collection Report' : 'Enrichissements Automatiques'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {enrichments ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 bg-blue-50 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">
                          {enrichments.newCollections}
                        </div>
                        <div className="text-sm text-blue-800">Nouvelles collections</div>
                      </div>
                      <div className="text-center p-4 bg-yellow-50 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-600">
                          {enrichments.enrichedCollections}
                        </div>
                        <div className="text-sm text-yellow-800">Collections enrichies</div>
                      </div>
                      <div className="text-center p-4 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">
                          {enrichments.dateValidityAdded}
                        </div>
                        <div className="text-sm text-green-800">Dates validité ajoutées</div>
                      </div>
                      <div className="text-center p-4 bg-purple-50 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">
                          {enrichments.commissionsAdded}
                        </div>
                        <div className="text-sm text-purple-800">Commissions ajoutées</div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm">
                          {enrichments.referencesUpdated} références mises à jour automatiquement
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm">
                          {enrichments.statusesUpdated} statuts mis à jour automatiquement
                        </span>
                      </div>
                      {isCollectionOnlyUpload && (
                        <div className="flex items-center space-x-2">
                          <AlertTriangle className="h-4 w-4 text-blue-600" />
                          <span className="text-sm text-blue-800">
                            Pour enrichir davantage, uploadez les relevés bancaires
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucun enrichissement automatique effectué
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Onglet Rapprochements */}
        {availableTabs.includes('matching') && (
          <TabsContent value="matching">
            <Card>
              <CardHeader>
                <CardTitle>
                  {isCollectionOnlyUpload ? 'Prêt pour le Rapprochement' : 'Logique de Rapprochement Intelligent'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {isCollectionOnlyUpload ? (
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="font-semibold text-blue-800 mb-2">
                        Collections Prêtes pour Rapprochement
                      </h4>
                      <div className="text-sm space-y-1">
                        <div>• <strong>{enrichments?.newCollections || 0} collections</strong> importées en base de données</div>
                        <div>• <strong>Traçabilité Excel</strong> complète préservée</div>
                        <div>• <strong>Prêt pour rapprochement</strong> avec les relevés bancaires</div>
                        <div className="mt-3 p-3 bg-blue-100 rounded">
                          <span className="text-blue-800 font-medium">
                            💡 Conseil : Uploadez maintenant les relevés bancaires pour effectuer le rapprochement automatique
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <h4 className="font-semibold text-blue-800 mb-2">
                          Algorithme de Correspondance
                        </h4>
                        <div className="text-sm space-y-1">
                          <div>• <strong>Montant exact (50 pts):</strong> Correspondance parfaite du montant</div>
                          <div>• <strong>Banque (30 pts):</strong> Même établissement bancaire</div>
                          <div>• <strong>Date (20 pts):</strong> Proximité temporelle (±3 jours)</div>
                          <div>• <strong>Référence (15 pts):</strong> Code client ou référence commune</div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-green-50 rounded">
                          <div className="text-lg font-bold text-green-600">≥80%</div>
                          <div className="text-sm text-green-800">Rapprochement parfait</div>
                        </div>
                        <div className="text-center p-3 bg-yellow-50 rounded">
                          <div className="text-lg font-bold text-yellow-600">50-79%</div>
                          <div className="text-sm text-yellow-800">Rapprochement partiel</div>
                        </div>
                        <div className="text-center p-3 bg-red-50 rounded">
                          <div className="text-lg font-bold text-red-600">&lt;50%</div>
                          <div className="text-sm text-red-800">Non rapproché</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default ProcessingResultsDetailed;
