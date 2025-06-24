
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Trash2, Search, AlertTriangle, CheckCircle, Eye } from 'lucide-react';
import { databaseService, DuplicateReport } from '@/services/databaseService';
import { toast } from '@/components/ui/sonner';

const DuplicateAnalyzer: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [duplicateReport, setDuplicateReport] = useState<DuplicateReport | null>(null);
  const [removingDuplicates, setRemovingDuplicates] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);

  const analyzeDuplicates = async () => {
    try {
      setLoading(true);
      console.log('🔍 Analyse des doublons en cours...');
      
      const report = await databaseService.detectDuplicates();
      setDuplicateReport(report);
      
      if (report.totalDuplicates > 0) {
        toast(`🔍 Analyse terminée`, {
          description: `${report.totalDuplicates} doublons détectés dans ${report.duplicateGroups.length} groupes`,
        });
      } else {
        toast(`✅ Aucun doublon détecté`, {
          description: `Les ${report.totalCollections} collections sont toutes uniques`,
        });
      }
    } catch (error) {
      console.error('❌ Erreur analyse doublons:', error);
      toast(`❌ Erreur d'analyse`, {
        description: "Impossible d'analyser les doublons",
      });
    } finally {
      setLoading(false);
    }
  };

  const removeDuplicates = async () => {
    if (!duplicateReport || duplicateReport.duplicateGroups.length === 0) {
      return;
    }

    try {
      setRemovingDuplicates(true);
      
      const result = await databaseService.removeDuplicates(duplicateReport.duplicateGroups);
      
      if (result.success) {
        toast(`✅ Doublons supprimés`, {
          description: `${result.data?.deletedCount || 0} doublons ont été supprimés`,
        });
        
        // Réanalyser après suppression
        await analyzeDuplicates();
      } else {
        toast(`❌ Erreur de suppression`, {
          description: result.error || "Impossible de supprimer les doublons",
        });
      }
    } catch (error) {
      console.error('❌ Erreur suppression:', error);
      toast(`❌ Erreur critique`, {
        description: "Une erreur inattendue s'est produite",
      });
    } finally {
      setRemovingDuplicates(false);
    }
  };

  useEffect(() => {
    // Analyser automatiquement au chargement
    analyzeDuplicates();
  }, []);

  return (
    <div className="space-y-6">
      {/* Statistiques générales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{duplicateReport?.totalCollections || 0}</div>
            <p className="text-xs text-muted-foreground">Collections Totales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">{duplicateReport?.totalDuplicates || 0}</div>
            <p className="text-xs text-muted-foreground">Doublons Détectés</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-orange-600">{duplicateReport?.duplicateGroups.length || 0}</div>
            <p className="text-xs text-muted-foreground">Groupes de Doublons</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{duplicateReport?.uniqueCollections || 0}</div>
            <p className="text-xs text-muted-foreground">Collections Uniques</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions principales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Analyse des Doublons
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button 
              onClick={analyzeDuplicates} 
              disabled={loading}
              className="flex items-center gap-2"
            >
              <Search className="h-4 w-4" />
              {loading ? 'Analyse en cours...' : 'Réanalyser les Doublons'}
            </Button>
            
            {duplicateReport && duplicateReport.totalDuplicates > 0 && (
              <Button 
                onClick={removeDuplicates}
                disabled={removingDuplicates}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {removingDuplicates ? 'Suppression...' : `Supprimer ${duplicateReport.totalDuplicates} Doublons`}
              </Button>
            )}
          </div>

          {duplicateReport && (
            <Alert variant={duplicateReport.totalDuplicates > 0 ? "destructive" : "default"}>
              {duplicateReport.totalDuplicates > 0 ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {duplicateReport.totalDuplicates > 0 ? (
                  <div>
                    <div className="font-semibold mb-1">
                      ⚠️ {duplicateReport.totalDuplicates} doublons détectés !
                    </div>
                    <div className="text-sm">
                      {duplicateReport.duplicateGroups.length} groupes de collections identiques trouvés.
                      Ces doublons peuvent affecter la précision de vos rapports.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold mb-1">
                      ✅ Aucun doublon détecté
                    </div>
                    <div className="text-sm">
                      Toutes les {duplicateReport.totalCollections} collections sont uniques.
                    </div>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Liste des groupes de doublons */}
      {duplicateReport && duplicateReport.duplicateGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Groupes de Doublons Détectés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Banque</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Facture N°</TableHead>
                  <TableHead>Source Excel</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {duplicateReport.duplicateGroups.map((group, index) => {
                  const sample = group.collections[0];
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{sample.clientCode}</TableCell>
                      <TableCell>{sample.collectionAmount.toLocaleString()} FCFA</TableCell>
                      <TableCell>{sample.bankName}</TableCell>
                      <TableCell>{new Date(sample.reportDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{sample.factureNo || 'N/A'}</TableCell>
                      <TableCell>
                        {sample.excelFilename ? (
                          <div className="text-xs">
                            <div className="font-mono">{sample.excelFilename}</div>
                            {sample.excelSourceRow && (
                              <div className="text-muted-foreground">Ligne {sample.excelSourceRow}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">{group.count} doublons</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedGroup(group)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Modal détails groupe */}
      {selectedGroup && (
        <Card className="fixed inset-0 z-50 bg-white/95 backdrop-blur-sm overflow-auto">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Détails du Groupe de Doublons</CardTitle>
              <Button 
                variant="outline" 
                onClick={() => setSelectedGroup(null)}
              >
                Fermer
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Ce groupe contient {selectedGroup.count} collections identiques.
                  Seule la plus récente sera conservée lors de la suppression.
                </AlertDescription>
              </Alert>
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Source Excel</TableHead>
                    <TableHead>Date Traitement</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedGroup.collections.map((collection: any, index: number) => (
                    <TableRow key={collection.id}>
                      <TableCell className="font-mono text-xs">{collection.id}</TableCell>
                      <TableCell>
                        {collection.excelFilename ? (
                          <div className="text-xs">
                            <div className="font-mono">{collection.excelFilename}</div>
                            {collection.excelSourceRow && (
                              <div className="text-muted-foreground">Ligne {collection.excelSourceRow}</div>
                            )}
                            {collection.excelProcessedAt && (
                              <div className="text-muted-foreground">
                                {new Date(collection.excelProcessedAt).toLocaleString('fr-FR')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Source inconnue</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {collection.processingStatus || collection.excelProcessedAt ? 
                          new Date(collection.excelProcessedAt || collection.processingStatus).toLocaleString('fr-FR') : 
                          'N/A'
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant={collection.status === 'processed' ? 'default' : 'secondary'}>
                          {collection.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {index === 0 ? (
                          <Badge variant="default">À Conserver</Badge>
                        ) : (
                          <Badge variant="destructive">À Supprimer</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DuplicateAnalyzer;
