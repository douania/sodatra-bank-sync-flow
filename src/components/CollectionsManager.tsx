
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle, Clock, Filter } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { CollectionReport } from '@/types/banking';

interface CollectionsManagerProps {
  refreshTrigger?: number;
}

const CollectionsManager: React.FC<CollectionsManagerProps> = ({ refreshTrigger }) => {
  const [collections, setCollections] = useState<CollectionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed'>('all');

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
      
      // Mettre à jour l'état local
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

      {/* Tableau des collections */}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code Client</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Date Rapport</TableHead>
                  <TableHead>Banque</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Date de Validité</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCollections.map((collection) => (
                  <TableRow key={collection.id}>
                    <TableCell className="font-medium">{collection.clientCode}</TableCell>
                    <TableCell>{collection.collectionAmount.toLocaleString()} FCFA</TableCell>
                    <TableCell>{new Date(collection.reportDate).toLocaleDateString('fr-FR')}</TableCell>
                    <TableCell>{collection.bankName || 'N/A'}</TableCell>
                    <TableCell>
                      <Badge variant={collection.status === 'processed' ? 'default' : 'secondary'}>
                        {collection.status === 'processed' ? 'Traitée' : 'En Attente'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {collection.dateOfValidity 
                        ? new Date(collection.dateOfValidity).toLocaleDateString('fr-FR')
                        : 'Non définie'
                      }
                    </TableCell>
                    <TableCell>
                      {collection.status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => markAsProcessed(collection.id!)}
                          className="flex items-center gap-1"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Marquer comme créditée
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CollectionsManager;
