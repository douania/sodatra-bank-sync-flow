import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { fileProcessingService } from '@/services/fileProcessingService';
import { qualityControlEngine } from '@/services/qualityControlEngine';
import { intelligentSyncService } from '@/services/intelligentSyncService';
import Stepper from '@/components/Stepper';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Toaster, toast } from '@/components/ui/sonner';
import { databaseService } from '@/services/databaseService';
import ProcessingResultsDetailed from '@/components/ProcessingResultsDetailed';
import QualityControlDashboard from '@/components/QualityControlDashboard';
import ProgressIndicator from '@/components/ProgressIndicator';
import { progressService } from '@/services/progressService';

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStep, setProcessStep] = useState(1);
  const [processingResults, setProcessingResults] = useState<any | null>(null);
  const [collectionCount, setCollectionCount] = useState(0);
  const [pendingValidations, setPendingValidations] = useState<any[]>([]);
  const [showQualityValidation, setShowQualityValidation] = useState(false);
  const [progressSteps, setProgressSteps] = useState<any[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    loadCollectionCount();

    // S'abonner aux événements de progression
    const unsubscribe = progressService.subscribe((event) => {
      console.log('📊 Événement progression:', event);
      
      setProgressSteps(prev => {
        const existingIndex = prev.findIndex(step => step.id === event.stepId);
        const newStep = {
          id: event.stepId,
          title: event.stepTitle,
          description: event.stepDescription,
          status: event.type === 'step_start' ? 'running' :
                  event.type === 'step_complete' ? 'completed' :
                  event.type === 'step_error' ? 'error' : 'running',
          progress: event.progress,
          details: event.details || event.error
        };

        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = newStep;
          return updated;
        } else {
          return [...prev, newStep];
        }
      });

      setOverallProgress(event.overallProgress);
    });

    return unsubscribe;
  }, []);

  const loadCollectionCount = async () => {
    const count = await databaseService.getCollectionCount();
    setCollectionCount(count);
  };

  // Helper function to get the correct status type
  const getStepStatus = (stepId: number): 'pending' | 'current' | 'completed' => {
    if (processStep === stepId) return 'current';
    if (processStep > stepId) return 'completed';
    return 'pending';
  };

  const steps = [
    { id: 1, title: 'Sélection des Fichiers', description: 'Choisir les fichiers à traiter', status: getStepStatus(1) },
    { id: 2, title: 'Traitement des Données', description: 'Analyse et extraction', status: getStepStatus(2) },
    { id: 3, title: 'Analyse des Résultats', description: 'Vérification des données', status: getStepStatus(3) },
    { id: 4, title: 'Finalisation', description: 'Traitement terminé', status: getStepStatus(4) },
  ];

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, fileType: string) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFiles(prev => ({ ...prev, [fileType]: file }));
    }
  };

  const processFiles = async () => {
    if (!selectedFiles.collectionReport) {
      toast("Fichier manquant", {
        description: "Veuillez sélectionner au moins le fichier Collection Report.",
      });
      return;
    }

    setIsProcessing(true);
    setProcessStep(2);
    setShowProgress(true);
    setProgressSteps([]);
    setOverallProgress(0);
    
    // Réinitialiser le service de progression
    progressService.reset();

    try {
      toast("🚀 Traitement en cours", {
        description: "Analyse intelligente avec contrôle qualité...",
      });

      console.log('🚀 DÉBUT TRAITEMENT FICHIERS AVEC INDICATEUR DE PROGRESSION');
      
      // Traitement avec progression détaillée
      const results = await fileProcessingService.processFiles(selectedFiles);
      
      console.log('📊 RÉSULTAT TRAITEMENT:', results);
      
      // ⚠️ VÉRIFIER SI VALIDATION QUALITÉ REQUISE
      if (results.data?.syncResult?.quality_validation_required) {
        console.log('⚠️ Validation qualité requise avant sauvegarde');
        
        setProcessStep(3); // Étape validation
        setPendingValidations(results.data.syncResult.pending_validations || []);
        setShowQualityValidation(true);
        setProcessingResults(results);
        
        toast("⚠️ Validation requise", {
          description: `${results.data.syncResult.pending_validations?.length || 0} changement(s) détecté(s) nécessitent votre validation.`,
        });
        
        return; // ⚠️ ARRÊTER ICI - Attendre validation utilisateur
      }
      
      // ✅ TRAITEMENT NORMAL - Aucune validation requise
      setProcessStep(4);
      setProcessingResults(results);

      // Recharger le compteur après traitement
      const newCount = await databaseService.getCollectionCount();
      setCollectionCount(newCount);

      if (results.success) {
        const collectionsCount = results.data?.collectionReports?.length || 0;
        const bankReportsCount = results.data?.bankReports?.length || 0;
        const syncResult = results.data?.syncResult;
        
        console.log('✅ TRAITEMENT RÉUSSI');
        console.log(`📊 Collections: ${collectionsCount}`);
        console.log(`🏦 Rapports bancaires: ${bankReportsCount}`);
        
        const syncSummary = syncResult ? {
          new: syncResult.new_collections || 0,
          enriched: syncResult.enriched_collections || 0,
          errors: syncResult.errors?.length || 0
        } : { new: 0, enriched: 0, errors: 0 };

        toast("✅ Traitement terminé avec succès !", {
          description: `${collectionsCount} collections analysées. ${syncSummary.new} nouvelles, ${syncSummary.enriched} enrichies.`,
        });
      } else {
        console.error('❌ ERREURS TRAITEMENT:', results.errors);
        toast("⚠️ Traitement terminé avec erreurs", {
          description: `${results.errors?.length || 0} erreurs détectées. Voir les détails ci-dessous.`,
        });
      }
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE:', error);
      progressService.errorStep('error', 'Erreur Critique', 'Une erreur inattendue s\'est produite', 
        error instanceof Error ? error.message : 'Erreur inconnue');
      
      setProcessStep(4);
      setProcessingResults({
        success: false,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue']
      });
      
      toast("❌ Erreur critique", {
        description: "Une erreur inattendue s'est produite. Voir les détails.",
      });
    } finally {
      setIsProcessing(false);
      setOverallProgress(100);
    }
  };

  // ⭐ NOUVELLE MÉTHODE: Valider les changements de qualité
  const handleValidateQualityChanges = async (validatedErrors: any[]) => {
    try {
      console.log('✅ Validation des changements qualité...');
      
      // Appliquer les corrections validées
      for (const error of validatedErrors) {
        if (error.status === 'VALIDATED') {
          await qualityControlEngine.validateError(error.id);
        } else if (error.status === 'REJECTED') {
          await qualityControlEngine.rejectError(error.id, 'Rejeté par utilisateur');
        }
      }
      
      // Procéder au traitement normal après validation
      setProcessStep(2);
      setShowQualityValidation(false);
      
      toast("🔄 Reprise du traitement", {
        description: "Application des validations en cours...",
      });
      
      // Relancer le traitement avec les validations appliquées
      const analysisResult = await intelligentSyncService.analyzeExcelFile(
        processingResults?.data?.collectionReports || []
      );
      const syncResult = await intelligentSyncService.processIntelligentSync(analysisResult);
      
      setProcessStep(4);
      setProcessingResults(prev => ({
        ...prev,
        data: {
          ...prev.data,
          syncResult
        }
      }));
      
      // Recharger le compteur
      const newCount = await databaseService.getCollectionCount();
      setCollectionCount(newCount);
      
      toast("✅ Traitement terminé avec validations !", {
        description: "Toutes les corrections ont été appliquées avec succès.",
      });
      
    } catch (error) {
      console.error('❌ Erreur validation qualité:', error);
      toast("❌ Erreur lors de la validation", {
        description: "Impossible d'appliquer les validations.",
      });
    }
  };

  const renderProcessingResults = () => {
    if (!processingResults) return null;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Résultats du Traitement</CardTitle>
        </CardHeader>
        <CardContent>
          {processingResults.success ? (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Traitement réussi !
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Traitement terminé avec des erreurs.
              </AlertDescription>
            </Alert>
          )}
          {processingResults.errors && processingResults.errors.length > 0 && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">Erreurs:</h3>
              <ul>
                {processingResults.errors.map((error: string, index: number) => (
                  <li key={index} className="text-red-500">{error}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderNewProcessingResults = () => {
    if (!processingResults) return null;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {processingResults.success ? (
                <>
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <span>Traitement Terminé avec Succès</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                  <span>Traitement Terminé avec Erreurs</span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {processingResults.errors && processingResults.errors.length > 0 && (
              <Alert className="mb-4" variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {processingResults.errors.length} erreur(s) détectée(s) :
                    </div>
                    {processingResults.errors.slice(0, 3).map((error: string, index: number) => (
                      <div key={index} className="text-sm">• {error}</div>
                    ))}
                    {processingResults.errors.length > 3 && (
                      <div className="text-sm italic">
                        ... et {processingResults.errors.length - 3} autres erreurs
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
            
            <ProcessingResultsDetailed results={processingResults} />
          </CardContent>
        </Card>
      </div>
    );
  };

  // ⭐ NOUVELLE MÉTHODE: Rendu de l'interface de validation qualité
  const renderQualityValidation = () => {
    if (!showQualityValidation || !pendingValidations.length) return null;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-6 w-6 text-yellow-600" />
            <span>Validation des Changements Détectés</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-semibold mb-2">
                {pendingValidations.length} changement(s) détecté(s) nécessitent votre validation
              </div>
              <div className="text-sm">
                L'application a détecté des modifications suspectes en comparant avec les relevés bancaires.
                Veuillez valider ou rejeter chaque changement avant de continuer.
              </div>
            </AlertDescription>
          </Alert>
          
          <QualityControlDashboard
            report={{
              id: 'validation-' + Date.now(),
              analysis_date: new Date().toISOString(),
              summary: {
                total_collections_analyzed: processingResults?.data?.collectionReports?.length || 0,
                errors_detected: pendingValidations.length,
                error_rate: ((pendingValidations.length / (processingResults?.data?.collectionReports?.length || 1)) * 100),
                confidence_score: 85
              },
              errors_by_type: {
                saisie_errors: pendingValidations.filter(e => e.type === 'SAISIE_ERROR').length,
                omissions: pendingValidations.filter(e => e.type === 'OMISSION_ERROR').length,
                incohérences: pendingValidations.filter(e => e.type === 'INCOHÉRENCE_ERROR').length
              },
              errors: pendingValidations,
              pending_validations: pendingValidations,
              validated_corrections: [],
              rejected_suggestions: []
            }}
            onValidateError={async (errorId: string) => {
              const updatedValidations = pendingValidations.map(v => 
                v.id === errorId ? { ...v, status: 'VALIDATED' } : v
              );
              setPendingValidations(updatedValidations);
            }}
            onRejectError={async (errorId: string, reason: string) => {
              const updatedValidations = pendingValidations.map(v => 
                v.id === errorId ? { ...v, status: 'REJECTED' } : v
              );
              setPendingValidations(updatedValidations);
            }}
            onModifyCorrection={async (errorId: string, correction: any) => {
              console.log('Modification correction:', errorId, correction);
            }}
          />
          
          <div className="mt-6 flex space-x-4">
            <Button 
              onClick={() => handleValidateQualityChanges(pendingValidations)}
              className="bg-green-600 hover:bg-green-700"
            >
              ✅ Appliquer les Validations
            </Button>
            <Button 
              variant="outline"
              onClick={() => {
                setShowQualityValidation(false);
                setProcessStep(1);
                toast("❌ Traitement annulé", {
                  description: "Veuillez corriger les données et réessayer.",
                });
              }}
            >
              ❌ Annuler le Traitement
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <Toaster />
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Import de Données Bancaires avec Contrôle Qualité
        </h1>
        <p className="mt-2 text-gray-600">
          Téléchargez les fichiers avec contrôle qualité intégré. L'application détecte automatiquement les changements suspects.
        </p>
        
        <div className="mt-4">
          <span className="text-lg font-semibold text-blue-600">
            {collectionCount} Collections en base
          </span>
        </div>
      </div>

      <Stepper steps={steps} />

      {processStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Upload className="h-6 w-6" />
              <span>Sélection des Fichiers</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="collectionReport">Collection Report Excel</Label>
                <Input
                  type="file"
                  id="collectionReport"
                  accept=".xlsx,.xls"
                  onChange={(e) => handleFileChange(e, 'collectionReport')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="fundsPosition">Fund Position PDF</Label>
                <Input
                  type="file"
                  id="fundsPosition"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'fundsPosition')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="clientReconciliation">Client Reconciliation PDF</Label>
                <Input
                  type="file"
                  id="clientReconciliation"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'clientReconciliation')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="bdk_statement">BDK Statement PDF</Label>
                <Input
                  type="file"
                  id="bdk_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'bdk_statement')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sgs_statement">SGS Statement PDF</Label>
                <Input
                  type="file"
                  id="sgs_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'sgs_statement')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="bicis_statement">BICIS Statement PDF</Label>
                <Input
                  type="file"
                  id="bicis_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'bicis_statement')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="atb_statement">ATB Statement PDF</Label>
                <Input
                  type="file"
                  id="atb_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'atb_statement')}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="bis_statement">BIS Statement PDF</Label>
                <Input
                  type="file"
                  id="bis_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'bis_statement')}
                  className="mt-1"
                />
              </div>
               <div>
                <Label htmlFor="ora_statement">ORA Statement PDF</Label>
                <Input
                  type="file"
                  id="ora_statement"
                  accept=".pdf"
                  onChange={(e) => handleFileChange(e, 'ora_statement')}
                  className="mt-1"
                />
              </div>
            </div>
            <Button onClick={processFiles} className="mt-4">
              <Upload className="h-4 w-4 mr-2" />
              Traiter les Fichiers
            </Button>
          </CardContent>
        </Card>
      )}

      {processStep === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Clock className="h-6 w-6 animate-spin" />
                <span>Traitement en Cours...</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center space-y-4">
                <div className="text-lg text-gray-600">
                  Analyse intelligente des fichiers en cours...
                </div>
                <div className="text-sm text-gray-500">
                  Extraction, enrichissement et synchronisation des données
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Nouvel indicateur de progression */}
          {showProgress && (
            <ProgressIndicator
              steps={progressSteps}
              overallProgress={overallProgress}
              isProcessing={isProcessing}
            />
          )}
        </div>
      )}

      {processStep === 3 && renderQualityValidation()}

      {processStep === 4 && renderNewProcessingResults()}
    </div>
  );
};

export default FileUpload;
