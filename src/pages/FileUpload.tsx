import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import Stepper from '@/components/Stepper';

const FileUpload = () => {
  const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: File | null }>({
    bankStatements: null,
    collectionReport: null,
    clientReconciliation: null,
    fundsPosition: null
  });

  const [processStep, setProcessStep] = useState(1);

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
      description: 'Extraction des données', 
      status: (processStep > 2 ? 'completed' : processStep === 2 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    },
    { 
      id: 3, 
      title: 'Rapprochement', 
      description: 'Analyse et rapprochement automatique', 
      status: (processStep > 3 ? 'completed' : processStep === 3 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    },
    { 
      id: 4, 
      title: 'Résultats', 
      description: 'Affichage des résultats et alertes', 
      status: (processStep === 4 ? 'current' : 'pending') as 'pending' | 'current' | 'completed'
    }
  ];

  const fileTypes = [
    {
      key: 'bankStatements',
      label: 'Relevés Bancaires (PDF)',
      description: 'Relevés PDF de toutes les banques',
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
      label: 'Rapprochement Client (PDF)',
      description: 'Rapport de rapprochement clients',
      accept: '.pdf',
      required: true
    },
    {
      key: 'fundsPosition',
      label: 'Position de Fonds (PDF)',
      description: 'Rapport de position de fonds par banque',
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
    }
  };

  const allRequiredFilesUploaded = fileTypes.every(type => 
    !type.required || uploadedFiles[type.key] !== null
  );

  const handleProcessFiles = () => {
    if (allRequiredFilesUploaded) {
      setProcessStep(2);
      // Simuler le traitement
      setTimeout(() => setProcessStep(3), 2000);
      setTimeout(() => setProcessStep(4), 4000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upload et Traitement des Fichiers</h1>
        <p className="mt-2 text-gray-600">
          Téléchargez tous les fichiers requis pour démarrer le processus de rapprochement bancaire.
        </p>
      </div>

      <Stepper steps={steps} />

      {processStep === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {fileTypes.map((fileType) => (
            <Card key={fileType.key}>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>{fileType.label}</span>
                  {fileType.required && <span className="text-red-500">*</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">{fileType.description}</p>
                
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
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
            disabled={!allRequiredFilesUploaded}
            className="px-8 py-3 text-lg"
          >
            Démarrer le Traitement
          </Button>
        </div>
      )}

      {processStep > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Traitement en Cours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {processStep >= 2 && (
                <Alert className="border-blue-200 bg-blue-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Extraction des données en cours... Analyse des formats PDF et Excel.
                  </AlertDescription>
                </Alert>
              )}
              
              {processStep >= 3 && (
                <Alert className="border-yellow-200 bg-yellow-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Rapprochement automatique en cours... Comparaison des transactions.
                  </AlertDescription>
                </Alert>
              )}
              
              {processStep === 4 && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Traitement terminé ! Consultez les résultats dans l'onglet Rapprochement.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FileUpload;
