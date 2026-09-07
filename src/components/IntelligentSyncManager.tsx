
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Brain, Database, TrendingUp, AlertCircle, CheckCircle, Clock, Zap, ShieldOff } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { intelligentSyncService, CollectionComparison } from '@/services/intelligentSyncService';
import { excelProcessingService } from '@/services/excelProcessingService';
import { LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE } from '@/services/uploadRuntimeGuard';

/**
 * PACK 0 — isolation du chemin d'écriture Collection legacy.
 *
 * La synchronisation directe écrivait dans `collection_report` sans passer
 * par la promotion atomique de `/upload`. Elle est neutralisée sur toutes les
 * cibles : ce composant n'expose plus ni bouton ni handler de synchronisation,
 * et le seul point d'exécution subsistant
 * (`executeLegacyCollectionMutation('legacy_sync', …)` dans uploadRuntimeGuard)
 * refuse avant tout appel service. L'analyse comparative (lecture seule) est
 * conservée comme consultation utile. Cette neutralisation est une barrière
 * d'interface : elle ne révoque pas les accès serveur.
 */
const IntelligentSyncManager: React.FC = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CollectionComparison[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAnalysisResult(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setProgress(0);

    try {
      // 1. Traiter le fichier Excel (parser FROZEN, inchangé)
      setProgress(20);
      const excelResult = await excelProcessingService.processCollectionReportExcel(selectedFile);

      if (!excelResult.success || !excelResult.data) {
        throw new Error('Erreur traitement Excel: ' + (excelResult.errors?.join(', ') || 'Erreur inconnue'));
      }

      setProgress(50);

      // 2. Comparaison en lecture seule avec la base
      const comparisons = await intelligentSyncService.analyzeExcelFile(excelResult.data);

      setProgress(100);
      setAnalysisResult(comparisons);
    } catch (error) {
      console.error('Erreur analyse:', error);
      toast.error('Erreur lors de l\'analyse: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    } finally {
      setIsAnalyzing(false);
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
                  <div className="text-sm text-gray-600">Absentes de la base</div>
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
                  <div className="text-sm text-gray-600">Incomplètes en base</div>
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
                  <div className="text-sm text-gray-600">Complètes en base</div>
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
              <span>Lecture consultative</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.new > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-green-50">Absentes</Badge>
                  <span className="text-sm">{stats.new} lignes du fichier n'existent pas en base ; leur import passe uniquement par la promotion atomique de /upload.</span>
                </div>
              )}
              {stats.toEnrich > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-yellow-50">Incomplètes</Badge>
                  <span className="text-sm">{stats.toEnrich} lignes existent en base avec des champs manquants ; aucun enrichissement n'est appliqué depuis cet écran.</span>
                </div>
              )}
              {stats.complete > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-blue-50">Complètes</Badge>
                  <span className="text-sm">{stats.complete} lignes sont déjà complètes en base.</span>
                </div>
              )}
              {stats.missingDateValidity > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-red-50">À examiner</Badge>
                  <span className="text-sm">{stats.missingDateValidity} lignes n'ont pas de date de validité.</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Alert>
        <ShieldOff className="h-4 w-4" />
        <AlertTitle>Synchronisation désactivée</AlertTitle>
        <AlertDescription>{LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-6 w-6" />
            <span>Analyse Excel comparative (consultation)</span>
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
                <span>{isAnalyzing ? 'Analyse...' : 'Analyser (lecture seule)'}</span>
              </Button>
            </div>

            {isAnalyzing && (
              <div className="space-y-2">
                <Progress value={progress} className="w-full" />
                <div className="text-sm text-gray-600 flex items-center space-x-2">
                  <Clock className="h-4 w-4" />
                  <span>Analyse en cours...</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {analysisResult && renderAnalysisResults()}
    </div>
  );
};

export default IntelligentSyncManager;
