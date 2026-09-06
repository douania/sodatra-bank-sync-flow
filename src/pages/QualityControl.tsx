
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, Brain, Shield, CheckCircle, Info } from 'lucide-react';
import { qualityControlEngine } from '@/services/qualityControlEngine';
import { QualityReport } from '@/types/qualityControl';
import QualityControlDashboard from '@/components/QualityControlDashboard';
import { excelProcessingService } from '@/services/excelProcessingService';
import { databaseService } from '@/services/databaseService';
import { toast } from '@/components/ui/sonner';

// PACK 0 — écran consultatif : aucune correction n'est validée, rejetée ni
// persistée depuis cette page. Le rapport compare un Collection Report Excel
// aux crédits bancaires explicites disponibles ; sans preuve exploitable, le
// contrôle est déclaré non évaluable, jamais conforme.
export const QUALITY_CONTROL_CONSULTATIVE_NOTICE =
  "Écran consultatif : aucune correction n'est appliquée ni enregistrée depuis cette page. " +
  "Seuls les crédits bancaires explicites servent de preuve ; un dépôt non crédité n'est jamais une preuve d'encaissement.";

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
      // 1. Traiter le fichier Excel (parser FROZEN, inchangé)
      toast.info('Traitement du fichier Excel…');
      const excelResult = await excelProcessingService.processCollectionReportExcel(selectedFile);

      if (!excelResult.success || !excelResult.data) {
        throw new Error('Erreur traitement Excel: ' + (excelResult.errors?.join(', ') || 'Erreur inconnue'));
      }

      // 2. Récupérer les rapports bancaires disponibles (lecture seule)
      toast.info('Récupération des preuves bancaires…');
      const bankReports = await databaseService.getAllBankReports();

      // 3. Analyse consultative
      toast.info('Comparaison consultative en cours…');
      const report = await qualityControlEngine.analyzeQuality(excelResult.data, bankReports);

      setQualityReport(report);

      // 4. Restitution : jamais de verdict absolu de conformité.
      if (report.evaluation.status === 'NOT_EVALUABLE') {
        toast.warning(report.evaluation.reason);
      } else {
        toast.info(
          `Analyse consultative terminée : ${report.summary.errors_detected} anomalie(s) potentielle(s) à examiner.`,
        );
      }

    } catch (error) {
      console.error('Erreur analyse qualité:', error);
      toast.error('Erreur lors de l\'analyse: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (qualityReport) {
    return (
      <QualityControlDashboard
        report={qualityReport}
        onReset={() => setQualityReport(null)}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4 flex items-center justify-center space-x-2">
          <Shield className="h-8 w-8 text-blue-600" />
          <span>Contrôle Qualité (consultatif)</span>
        </h1>
        <p className="mt-2 text-gray-600 max-w-2xl mx-auto">
          Compare les lignes d'un Collection Report Excel aux crédits bancaires explicites disponibles en base
          et signale des anomalies potentielles à examiner. Aucune donnée n'est modifiée.
        </p>
      </div>

      <Alert className="max-w-2xl mx-auto">
        <Info className="h-4 w-4" />
        <AlertTitle>Contrôle consultatif</AlertTitle>
        <AlertDescription>{QUALITY_CONTROL_CONSULTATIVE_NOTICE}</AlertDescription>
      </Alert>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-6 w-6" />
            <span>Analyse consultative</span>
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
              <h3 className="font-semibold text-blue-800 mb-2">Processus d'analyse</h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• <strong>Étape 1:</strong> Extraction des données du fichier Excel</li>
                <li>• <strong>Étape 2:</strong> Lecture des rapports bancaires disponibles</li>
                <li>• <strong>Étape 3:</strong> Comparaison aux crédits bancaires explicites uniquement</li>
                <li>• <strong>Étape 4:</strong> Signalement d'anomalies potentielles (saisie, omission, incohérence)</li>
                <li>• <strong>Étape 5:</strong> Rapport consultatif, ou « contrôle non évaluable » sans preuve exploitable</li>
              </ul>
            </div>

            {/* Types d'anomalies signalées */}
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="font-semibold text-yellow-800 mb-2">Types d'anomalies signalées</h3>
              <div className="text-sm text-yellow-700 space-y-2">
                <div>
                  <strong>Saisie :</strong> montants, dates ou banques divergents d'un crédit rapproché
                </div>
                <div>
                  <strong>Omission :</strong> crédit bancaire sans ligne Excel correspondante
                </div>
                <div>
                  <strong>Incohérence :</strong> date de validité absente malgré un crédit rapproché
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
                  Lancer l'analyse consultative
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
