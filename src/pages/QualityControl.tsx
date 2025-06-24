
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Brain, Shield, CheckCircle } from 'lucide-react';
import { qualityControlEngine } from '@/services/qualityControlEngine';
import { QualityReport } from '@/types/qualityControl';
import QualityControlDashboard from '@/components/QualityControlDashboard';
import { excelProcessingService } from '@/services/excelProcessingService';
import { databaseService } from '@/services/databaseService';
import { toast } from '@/components/ui/sonner';

const QualityControl = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setQualityReport(null);
    }
  };

  const handleQualityAnalysis = async () => {
    if (!selectedFile) {
      toast.error('Veuillez sélectionner un fichier Excel');
      return;
    }

    setIsAnalyzing(true);

    try {
      console.log('🔍 DÉBUT ANALYSE QUALITÉ COMPLÈTE');
      
      // 1. Traiter le fichier Excel
      toast.info('📊 Traitement du fichier Excel...');
      const excelResult = await excelProcessingService.processCollectionReportExcel(selectedFile);
      
      if (!excelResult.success || !excelResult.data) {
        throw new Error('Erreur traitement Excel: ' + (excelResult.errors?.join(', ') || 'Erreur inconnue'));
      }

      console.log(`📊 ${excelResult.data.length} collections extraites du fichier Excel`);

      // 2. Récupérer les relevés bancaires de la base
      toast.info('🏦 Récupération des relevés bancaires...');
      const bankReports = await databaseService.getAllBankReports();
      
      console.log(`🏦 ${bankReports.length} relevés bancaires récupérés`);

      // 3. Lancer l'analyse qualité
      toast.info('🤖 Analyse intelligente en cours...');
      const report = await qualityControlEngine.analyzeQuality(excelResult.data, bankReports);
      
      setQualityReport(report);

      // 4. Afficher les résultats
      if (report.summary.errors_detected === 0) {
        toast.success('🎉 Aucune erreur détectée ! Données parfaitement conformes.');
      } else {
        toast.warning(`⚠️ ${report.summary.errors_detected} erreur(s) détectée(s) (${report.summary.error_rate}% du total)`);
      }

      console.log('✅ ANALYSE QUALITÉ TERMINÉE:', {
        collections_analysées: report.summary.total_collections_analyzed,
        erreurs_détectées: report.summary.errors_detected,
        taux_erreur: report.summary.error_rate + '%',
        score_confiance: report.summary.confidence_score + '%'
      });

    } catch (error) {
      console.error('❌ Erreur analyse qualité:', error);
      toast.error('Erreur lors de l\'analyse: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleValidateError = async (errorId: string) => {
    try {
      await qualityControlEngine.validateError(errorId);
      
      // Mettre à jour le rapport localement
      if (qualityReport) {
        const updatedErrors = qualityReport.errors.map(error => 
          error.id === errorId ? { ...error, status: 'VALIDATED' as const } : error
        );
        
        setQualityReport({
          ...qualityReport,
          errors: updatedErrors,
          pending_validations: updatedErrors.filter(e => e.status === 'PENDING'),
          validated_corrections: updatedErrors.filter(e => e.status === 'VALIDATED')
        });
      }
      
      toast.success('✅ Correction validée et appliquée');
    } catch (error) {
      console.error('Erreur validation:', error);
      toast.error('Erreur lors de la validation');
    }
  };

  const handleRejectError = async (errorId: string, reason: string) => {
    try {
      await qualityControlEngine.rejectError(errorId, reason);
      
      // Mettre à jour le rapport localement
      if (qualityReport) {
        const updatedErrors = qualityReport.errors.map(error => 
          error.id === errorId ? { ...error, status: 'REJECTED' as const } : error
        );
        
        setQualityReport({
          ...qualityReport,
          errors: updatedErrors,
          pending_validations: updatedErrors.filter(e => e.status === 'PENDING'),
          rejected_suggestions: updatedErrors.filter(e => e.status === 'REJECTED')
        });
      }
      
      toast.success('❌ Suggestion rejetée');
    } catch (error) {
      console.error('Erreur rejet:', error);
      toast.error('Erreur lors du rejet');
    }
  };

  const handleModifyCorrection = async (errorId: string, correction: any) => {
    try {
      await qualityControlEngine.applyCorrection(errorId, correction);
      toast.success('✏️ Correction modifiée et appliquée');
    } catch (error) {
      console.error('Erreur modification:', error);
      toast.error('Erreur lors de la modification');
    }
  };

  if (qualityReport) {
    return (
      <QualityControlDashboard
        report={qualityReport}
        onValidateError={handleValidateError}
        onRejectError={handleRejectError}
        onModifyCorrection={handleModifyCorrection}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4 flex items-center justify-center space-x-2">
          <Shield className="h-8 w-8 text-blue-600" />
          <span>Contrôle Qualité Intelligent</span>
        </h1>
        <p className="mt-2 text-gray-600 max-w-2xl mx-auto">
          Analysez la qualité de vos données Excel en les comparant avec les relevés bancaires. 
          Notre IA détecte automatiquement les erreurs, omissions et incohérences.
        </p>
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-6 w-6" />
            <span>Analyse Intelligente</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            
            {/* Sélection du fichier */}
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
              {selectedFile && (
                <div className="mt-2 text-sm text-green-600 flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4" />
                  <span>Fichier sélectionné: {selectedFile.name}</span>
                </div>
              )}
            </div>

            {/* Description du processus */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">🤖 Processus d'Analyse</h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• <strong>Étape 1:</strong> Extraction des données du fichier Excel</li>
                <li>• <strong>Étape 2:</strong> Récupération des relevés bancaires</li>
                <li>• <strong>Étape 3:</strong> Comparaison intelligente des données</li>
                <li>• <strong>Étape 4:</strong> Détection d'erreurs, omissions et incohérences</li>
                <li>• <strong>Étape 5:</strong> Génération du rapport de qualité</li>
              </ul>
            </div>

            {/* Types d'erreurs détectées */}
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="font-semibold text-yellow-800 mb-2">🔍 Types d'Erreurs Détectées</h3>
              <div className="text-sm text-yellow-700 space-y-2">
                <div>
                  <strong>🔴 Erreurs de saisie:</strong> Montants, dates, banques incorrects
                </div>
                <div>
                  <strong>🟡 Omissions:</strong> Collections manquantes dans Excel
                </div>
                <div>
                  <strong>🟠 Incohérences:</strong> Dates de validité, statuts incorrects
                </div>
              </div>
            </div>

            {/* Bouton d'analyse */}
            <Button
              onClick={handleQualityAnalysis}
              disabled={!selectedFile || isAnalyzing}
              className="w-full bg-blue-600 hover:bg-blue-700"
              size="lg"
            >
              {isAnalyzing ? (
                <>
                  <Brain className="h-5 w-5 mr-2 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 mr-2" />
                  Lancer l'Analyse Qualité
                </>
              )}
            </Button>

          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default QualityControl;
