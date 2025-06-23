import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileText, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fileProcessingService } from '@/services/fileProcessingService';
import Stepper from '@/components/Stepper';

const FileUpload = () => {
  const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: File | null }>({
    bankStatements: null,
    collectionReport: null,
    clientReconciliation: null,
    fundsPosition: null
  });

  const [processStep, setProcessStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<any>(null);
  const { toast } = useToast();

  const steps = [
    { 
      id: 1, 
      title: 'Upload Fichiers', 
      description: 'Télécharger tous les fichiers requis', 
      status: (processStep > 1 ? 'completed' : 'current') as 'pending' | 'current' | 'completed'
    },
    { 
      id: 2, 
      title: 'Extraction', 
      description: 'Extraction des données selon patterns SODATRA', 
      status: (processStep > 2 ? 'completed' : processStep === 2 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    },
    { 
      id: 3, 
      title: 'Sauvegarde', 
      description: 'Sauvegarde en base de données', 
      status: (processStep > 3 ? 'completed' : processStep === 3 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    },
    { 
      id: 4, 
      title: 'Dashboard Prêt', 
      description: 'Données prêtes pour analyse', 
      status: (processStep === 4 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    }
  ];

  const fileTypes = [
    {
      key: 'bankStatements',
      label: 'Relevés Bancaires (PDF)',
      description: 'BDK, SGS, BICIS, ATB, BIS, ORA selon guide',
      accept: '.pdf',
      required: true
    },
    {
      key: 'collectionReport',
      label: 'Collection Report (Excel)',
      description: 'Fichier Excel des remises et encaissements',
      accept: '.xlsx,.xls',
      required: true
    },
    {
      key: 'clientReconciliation',
      label: 'Client Reconciliation (PDF)',
      description: 'Rapport de rapprochement clients avec impayés',
      accept: '.pdf',
      required: true
    },
    {
      key: 'fundsPosition',
      label: 'Fund Position (PDF)',
      description: 'Position maître consolidée',
      accept: '.pdf',
      required: true
    }
  ];

  const handleFileUpload = (fileType: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadedFiles(prev => ({
        ...prev,
        [fileType]: file
      }));
      
      toast({
        title: "Fichier ajouté",
        description: `${file.name} prêt pour traitement`,
      });
    }
  };

  const allRequiredFilesUploaded = fileTypes.every(type => 
    !type.required || uploadedFiles[type.key] !== null
  );

  const handleProcessFiles = async () => {
    if (!allRequiredFilesUploaded) return;

    setIsProcessing(true);
    setProcessStep(2);

    try {
      console.log('🚀 Démarrage traitement selon guide SODATRA');
      
      // Étape 2: Extraction (2 minutes selon guide)
      toast({
        title: "Extraction en cours",
        description: "Traitement avec patterns validés SODATRA...",
      });

      const results = await fileProcessingService.processFiles(uploadedFiles);
      
      setProcessStep(3);
      
      // Étape 3: Validation et sauvegarde
      toast({
        title: "Sauvegarde en cours",
        description: "Validation des données et sauvegarde...",
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setProcessStep(4);
      setProcessingResults(results);

      if (results.success) {
        toast({
          title: "✅ Traitement terminé !",
          description: `${results.data?.bankReports.length || 0} rapports bancaires traités`,
        });
      } else {
        toast({
          title: "⚠️ Traitement avec erreurs",
          description: `${results.errors?.length || 0} erreurs détectées`,
          variant: "destructive"
        });
      }

    } catch (error) {
      console.error('Erreur traitement:', error);
      toast({
        title: "❌ Erreur de traitement",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">SODATRA Bank Control - Upload</h1>
        <p className="mt-2 text-gray-600">
          Téléchargez les fichiers selon le guide d'implémentation. Traitement automatique en ~8 minutes.
        </p>
      </div>

      <Stepper steps={steps} />

      {processStep === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {fileTypes.map((fileType) => (
            <Card key={fileType.key} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>{fileType.label}</span>
                  {fileType.required && <span className="text-red-500">*</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">{fileType.description}</p>
                
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    accept={fileType.accept}
                    onChange={(e) => handleFileUpload(fileType.key, e)}
                    className="hidden"
                    id={`file-${fileType.key}`}
                  />
                  <label htmlFor={`file-${fileType.key}`} className="cursor-pointer">
                    {uploadedFiles[fileType.key] ? (
                      <div className="flex items-center justify-center space-x-2 text-green-600">
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">
                          {uploadedFiles[fileType.key]?.name}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-8 w-8 text-gray-400 mx-auto" />
                        <div className="text-sm text-gray-600">
                          Cliquez pour télécharger ou glissez-déposez
                        </div>
                        <div className="text-xs text-gray-400">
                          {fileType.accept.replace(/\./g, '').toUpperCase()}
                        </div>
                      </div>
                    )}
                  </label>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {processStep === 1 && (
        <div className="flex justify-center">
          <Button
            onClick={handleProcessFiles}
            disabled={!allRequiredFilesUploaded || isProcessing}
            className="px-8 py-3 text-lg bg-blue-600 hover:bg-blue-700"
          >
            {isProcessing ? (
              <>
                <Clock className="mr-2 h-4 w-4 animate-spin" />
                Traitement en cours...
              </>
            ) : (
              'Démarrer le Traitement SODATRA'
            )}
          </Button>
        </div>
      )}

      {processStep > 1 && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <span>Traitement Automatique SODATRA</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {processStep >= 2 && (
                <Alert className="border-blue-200 bg-blue-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Extraction avec patterns validés (BDK, SGS, BICIS, ATB, BIS, ORA)...
                  </AlertDescription>
                </Alert>
              )}
              
              {processStep >= 3 && (
                <Alert className="border-yellow-200 bg-yellow-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Sauvegarde des données bancaires et validation des rapprochements...
                  </AlertDescription>
                </Alert>
              )}
              
              {processStep === 4 && processingResults && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    ✅ Traitement terminé ! {processingResults.data?.bankReports.length || 0} rapports bancaires extraits.
                    {processingResults.data?.fundPosition && " Fund Position validée."}
                    {processingResults.errors?.length > 0 && ` ${processingResults.errors.length} alertes détectées.`}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {processStep === 4 && (
              <div className="mt-6 flex justify-center">
                <Button 
                  onClick={() => window.location.href = '/dashboard'}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Voir le Dashboard →
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FileUpload;
