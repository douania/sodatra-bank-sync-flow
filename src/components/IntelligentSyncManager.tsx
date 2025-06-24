
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, Database, RefreshCw, TrendingUp, AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react';
import { intelligentSyncService, CollectionComparison, SyncResult } from '@/services/intelligentSyncService';
import { excelProcessingService } from '@/services/excelProcessingService';

interface IntelligentSyncManagerProps {
  onSyncComplete?: (result: SyncResult) => void;
}

const IntelligentSyncManager: React.FC<IntelligentSyncManagerProps> = ({ onSyncComplete }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CollectionComparison[] | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAnalysisResult(null);
      setSyncResult(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setProgress(0);

    try {
      console.log('🧠 DÉBUT ANALYSE INTELLIGENTE');
      
      // 1. Traiter le fichier Excel
      setProgress(20);
      const excelResult = await excelProcessingService.processCollectionReportExcel(selectedFile);
      
      if (!excelResult.success || !excelResult.data) {
        throw new Error('Erreur traitement Excel: ' + (excelResult.errors?.join(', ') || 'Erreur inconnue'));
      }

      setProgress(50);
      
      // 2. Analyser avec la logique intelligente
      const comparisons = await intelligentSyncService.analyzeExcelFile(excelResult.data);
      
      setProgress(100);
      setAnalysisResult(comparisons);
      
      console.log('✅ Analyse terminée:', {
        total: comparisons.length,
        nouveau: comparisons.filter(c => c.status === 'NEW').length,
        àEnrichir: comparisons.filter(c => c.status === 'EXISTS_INCOMPLETE').length,
        complet: comparisons.filter(c => c.status === 'EXISTS_COMPLETE').length
      });

    } catch (error) {
      console.error('❌ Erreur analyse:', error);
      alert('Erreur lors de l\'analyse: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSync = async () => {
    if (!analysisResult) return;

    setIsSyncing(true);
    setProgress(0);

    try {
      console.log('🔄 DÉBUT SYNCHRONISATION');
      
      const result = await intelligentSyncService.processIntelligentSync(analysisResult);
      
      setProgress(100);
      setSyncResult(result);
      
      if (onSyncComplete) {
        onSyncComplete(result);
      }
      
      console.log('✅ Synchronisation terminée:', result);

    } catch (error) {
      console.error('❌ Erreur synchronisation:', error);
      alert('Erreur lors de la synchronisation: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    } finally {
      setIsSyncing(false);
    }
  };

  const renderAnalysisResults = () => {
    if (!analysisResult) return null;

    const stats = {
      total: analysisResult.length,
      new: analysisResult.filter(c => c.status === 'NEW').length,
      toEnrich: analysisResult.filter(c => c.status === 'EXISTS_INCOMPLETE').length,
      complete: analysisResult.filter(c => c.status === 'EXISTS_COMPLETE').length,
      missingDateValidity: analysisResult.filter(c => c.missingFields.includes('date_of_validity')).length
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <div>
                  <div className="text-2xl font-bold text-green-600">{stats.new}</div>
                  <div className="text-sm text-gray-600">Nouvelles</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Zap className="h-4 w-4 text-yellow-600" />
                <div>
                  <div className="text-2xl font-bold text-yellow-600">{stats.toEnrich}</div>
                  <div className="text-sm text-gray-600">À enrichir</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-blue-600" />
                <div>
                  <div className="text-2xl font-bold text-blue-600">{stats.complete}</div>
                  <div className="text-sm text-gray-600">Complètes</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <div>
                  <div className="text-2xl font-bold text-red-600">{stats.missingDateValidity}</div>
                  <div className="text-sm text-gray-600">Sans date validité</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Brain className="h-5 w-5" />
              <span>Recommandations Intelligentes</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.new > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-green-50">Nouvelles Collections</Badge>
                  <span className="text-sm">{stats.new} collections seront ajoutées</span>
                </div>
              )}
              {stats.toEnrich > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-yellow-50">Enrichissement</Badge>
                  <span className="text-sm">{stats.toEnrich} collections seront enrichies avec de nouvelles données</span>
                </div>
              )}
              {stats.complete > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-blue-50">Préservation</Badge>
                  <span className="text-sm">{stats.complete} collections déjà complètes seront préservées</span>
                </div>
              )}
              {stats.missingDateValidity > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-red-50">Priorité</Badge>
                  <span className="text-sm">{stats.missingDateValidity} collections ont besoin d'une date de validité</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderSyncResults = () => {
    if (!syncResult) return null;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{syncResult.new_collections}</div>
                <div className="text-sm text-gray-600">Collections Ajoutées</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-600">{syncResult.enriched_collections}</div>
                <div className="text-sm text-gray-600">Collections Enrichies</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{syncResult.ignored_collections}</div>
                <div className="text-sm text-gray-600">Collections Préservées</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Détails des Enrichissements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{syncResult.summary.enrichments.date_of_validity_added}</div>
                <div className="text-sm text-gray-600">Dates validité ajoutées</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{syncResult.summary.enrichments.bank_commissions_added}</div>
                <div className="text-sm text-gray-600">Commissions ajoutées</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{syncResult.summary.enrichments.references_updated}</div>
                <div className="text-sm text-gray-600">Références mises à jour</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{syncResult.summary.enrichments.statuses_updated}</div>
                <div className="text-sm text-gray-600">Statuts mis à jour</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {syncResult.errors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">Erreurs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {syncResult.errors.slice(0, 5).map((error, index) => (
                  <div key={index} className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    {error.error}
                  </div>
                ))}
                {syncResult.errors.length > 5 && (
                  <div className="text-sm text-gray-600">
                    ... et {syncResult.errors.length - 5} autres erreurs
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-6 w-6" />
            <span>Synchronisation Intelligente</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Fichier Collection Report Excel
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            <div className="flex space-x-4">
              <Button
                onClick={handleAnalyze}
                disabled={!selectedFile || isAnalyzing}
                className="flex items-center space-x-2"
              >
                <Database className="h-4 w-4" />
                <span>{isAnalyzing ? 'Analyse...' : 'Analyser'}</span>
              </Button>

              <Button
                onClick={handleSync}
                disabled={!analysisResult || isSyncing}
                variant="outline"
                className="flex items-center space-x-2"
              >
                <RefreshCw className="h-4 w-4" />
                <span>{isSyncing ? 'Synchronisation...' : 'Synchroniser'}</span>
              </Button>
            </div>

            {(isAnalyzing || isSyncing) && (
              <div className="space-y-2">
                <Progress value={progress} className="w-full" />
                <div className="text-sm text-gray-600 flex items-center space-x-2">
                  <Clock className="h-4 w-4" />
                  <span>
                    {isAnalyzing && 'Analyse en cours...'}
                    {isSyncing && 'Synchronisation en cours...'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {(analysisResult || syncResult) && (
        <Tabs defaultValue="analysis" className="space-y-4">
          <TabsList>
            <TabsTrigger value="analysis">Analyse</TabsTrigger>
            <TabsTrigger value="results">Résultats</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis">
            {renderAnalysisResults()}
          </TabsContent>

          <TabsContent value="results">
            {renderSyncResults()}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default IntelligentSyncManager;
