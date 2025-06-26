import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, CheckCircle, Clock, Filter, Eye, MapPin, Search } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { CollectionReport } from '@/types/banking';
import DuplicateAnalyzer from './DuplicateAnalyzer';

interface CollectionsManagerProps {
  refreshTrigger?: number;
}

const CollectionsManager: React.FC<CollectionsManagerProps> = ({ refreshTrigger }) => {
  const [collections, setCollections] = useState<CollectionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed'>('all');
  const [selectedCollection, setSelectedCollection] = useState<CollectionReport | null>(null);
  const [activeTab, setActiveTab] = useState('collections');

  useEffect(() => {
    loadCollections();
  }, [refreshTrigger]);

  const loadCollections = async () => {
    try {
      setLoading(true);
      const data = await databaseService.getCollectionReports();
      setCollections(data);
      console.log('📊 Collections chargées:', data.length);
    } catch (error) {
      console.error('❌ Erreur chargement collections:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsProcessed = async (collectionId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      await databaseService.updateCollectionDateOfValidity(collectionId, today);
      
      setCollections(prev => 
        prev.map(collection => 
          collection.id === collectionId 
            ? { ...collection, status: 'processed' as const, dateOfValidity: today }
            : collection
        )
      );
      
      console.log('✅ Collection marquée comme traitée');
    } catch (error) {
      console.error('❌ Erreur mise à jour collection:', error);
    }
  };

  const filteredCollections = collections.filter(collection => {
    if (filter === 'all') return true;
    if (filter === 'pending') return collection.status === 'pending';
    if (filter === 'processed') return collection.status === 'processed';
    return true;
  });

  const pendingCount = collections.filter(c => c.status === 'pending').length;
  const processedCount = collections.filter(c => c.status === 'processed').length;
  const totalAmount = collections.reduce((sum, c) => sum + c.collectionAmount, 0);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Gestion des Collections
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">Chargement des collections...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Métriques des collections */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{collections.length}</div>
            <p className="text-xs text-muted-foreground">Total Collections</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-orange-600">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">En Attente</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{processedCount}</div>
            <p className="text-xs text-muted-foreground">Traitées</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{(totalAmount / 1000000).toFixed(1)}M</div>
            <p className="text-xs text-muted-foreground">Montant Total FCFA</p>
          </CardContent>
        </Card>
      </div>

      {/* Onglets principaux */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="duplicates">Analyse des Doublons</TabsTrigger>
        </TabsList>

        <TabsContent value="collections" className="space-y-6">
          {/* Tableau des collections avec nouvelles colonnes */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Collections Détaillées
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant={filter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('all')}
                  >
                    Toutes ({collections.length})
                  </Button>
                  <Button
                    variant={filter === 'pending' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('pending')}
                  >
                    En Attente ({pendingCount})
                  </Button>
                  <Button
                    variant={filter === 'processed' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('processed')}
                  >
                    Traitées ({processedCount})
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredCollections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Aucune collection trouvée pour ce filtre
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Facture N°</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Banque</TableHead>
                        <TableHead>Date Validité</TableHead>
                        <TableHead>N° Chq/BD</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCollections.map((collection) => (
                        <TableRow key={collection.id}>
                          <TableCell className="font-medium">{collection.clientCode}</TableCell>
                          <TableCell>{collection.factureNo || 'N/A'}</TableCell>
                          <TableCell className="font-semibold">
                            {collection.collectionAmount.toLocaleString()} FCFA
                          </TableCell>
                          <TableCell>
                            {collection.collectionType === 'EFFET' ? (
                              <Badge className="bg-purple-100 text-purple-800">Effet</Badge>
                            ) : collection.collectionType === 'CHEQUE' ? (
                              <Badge className="bg-blue-100 text-blue-800">Chèque</Badge>
                            ) : (
                              <Badge variant="outline">Inconnu</Badge>
                            )}
                          </TableCell>
                          <TableCell>{collection.bankNameDisplay || collection.bankName || 'N/A'}</TableCell>
                          <TableCell>
                            {collection.dateOfValidity 
                              ? new Date(collection.dateOfValidity).toLocaleDateString('fr-FR')
                              : <span className="text-red-500">Non définie ⚠️</span>
                            }
                          </TableCell>
                          <TableCell>
                            {collection.collectionType === 'EFFET' ? (
                              <span className="text-purple-600">{collection.effetEcheanceDate || collection.noChqBd}</span>
                            ) : collection.collectionType === 'CHEQUE' ? (
                              <span className="text-blue-600">{collection.chequeNumber || collection.noChqBd}</span>
                            ) : (
                              collection.noChqBd || 'N/A'
                            )}
                          </TableCell>
                          <TableCell>
                            {collection.collectionType === 'EFFET' ? (
                              <Badge variant={
                                collection.effetStatus === 'PAID' ? 'default' : 
                                collection.effetStatus === 'IMPAYE' ? 'destructive' : 
                                'secondary'
                              }>
                                {collection.effetStatus === 'PAID' ? 'Payé' : 
                                 collection.effetStatus === 'IMPAYE' ? 'Impayé' : 
                                 'En attente'}
                              </Badge>
                            ) : collection.collectionType === 'CHEQUE' ? (
                              <Badge variant={
                                collection.chequeStatus === 'CLEARED' ? 'default' : 
                                collection.chequeStatus === 'BOUNCED' ? 'destructive' : 
                                'secondary'
                              }>
                                {collection.chequeStatus === 'CLEARED' ? 'Encaissé' : 
                                 collection.chequeStatus === 'BOUNCED' ? 'Rejeté' : 
                                 'En attente'}
                              </Badge>
                            ) : (
                              <Badge variant={collection.status === 'processed' ? 'default' : 'secondary'}>
                                {collection.status === 'processed' ? 'Traitée' : 'En Attente'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedCollection(collection)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {collection.status === 'pending' && (
                                <>
                                  {collection.collectionType === 'EFFET' ? (
                                    <Button
                                      size="sm"
                                      onClick={() => markAsProcessed(collection.id!)}
                                      className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700"
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                      Payer Effet
                                    </Button>
                                  ) : collection.collectionType === 'CHEQUE' ? (
                                    <Button
                                      size="sm"
                                      onClick={() => markAsProcessed(collection.id!)}
                                      className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700"
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                      Encaisser
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={() => markAsProcessed(collection.id!)}
                                      className="flex items-center gap-1"
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                      Créditer
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duplicates">
          <DuplicateAnalyzer />
        </TabsContent>
      </Tabs>

      {/* Modal de détails */}
      {selectedCollection && (
        <Card className="fixed inset-0 z-50 bg-white/95 backdrop-blur-sm overflow-auto">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Détails Collection - {selectedCollection.factureNo}</CardTitle>
              <Button 
                variant="outline" 
                onClick={() => setSelectedCollection(null)}
              >
                Fermer
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">Informations Générales</h3>
              <div className="space-y-2 text-sm">
                <div><span className="font-medium">Client:</span> {selectedCollection.clientCode}</div>
                <div><span className="font-medium">Montant:</span> {selectedCollection.collectionAmount.toLocaleString()} FCFA</div>
                <div><span className="font-medium">Banque:</span> {selectedCollection.bankNameDisplay || selectedCollection.bankName}</div>
                <div><span className="font-medium">Date Rapport:</span> {new Date(selectedCollection.reportDate).toLocaleDateString('fr-FR')}</div>
                <div><span className="font-medium">Date Validité:</span> {selectedCollection.dateOfValidity ? new Date(selectedCollection.dateOfValidity).toLocaleDateString('fr-FR') : 'Non définie'}</div>
              </div>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Détails Financiers</h3>
              <div className="space-y-2 text-sm">
                <div><span className="font-medium">Intérêt:</span> {selectedCollection.interet || 'N/A'}</div>
                <div><span className="font-medium">Commission:</span> {selectedCollection.commission || 'N/A'}</div>
                <div><span className="font-medium">TOB:</span> {selectedCollection.tob || 'N/A'}</div>
                <div><span className="font-medium">Revenus:</span> {selectedCollection.income || 'N/A'}</div>
                <div><span className="font-medium">Remarques:</span> {selectedCollection.remarques || 'Aucune'}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CollectionsManager;