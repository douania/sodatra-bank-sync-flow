import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, FileText, Upload, Building2, X, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { enhancedFileProcessingService, ProcessingResult } from '@/services/enhancedFileProcessingService';
import { progressService } from '@/services/progressService';
import { ProgressDisplay } from '@/components/ProgressDisplay';
import ProcessingResultsDetailed from '@/components/ProcessingResultsDetailed';

interface DetectedFile {
  file: File;
  detectedType: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  icon: React.ComponentType<any>;
}

const FileUploadBulk = () => {
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<ProcessingResult | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const { toast } = useToast();

  // Fonction de détection automatique du type de fichier
  const detectFileType = useCallback((file: File): { type: string; confidence: 'high' | 'medium' | 'low'; description: string; icon: React.ComponentType<any> } => {
    const filename = file.name.toUpperCase();
    const extension = file.name.toLowerCase().split('.').pop();
    
    // Détection du Collection Report
    if (filename.includes('COLLECTION') && filename.includes('REPORT') && (extension === 'xlsx' || extension === 'xls')) {
      return {
        type: 'collectionReport',
        confidence: 'high',
        description: 'Fichier Excel principal avec les collections',
        icon: FileSpreadsheet
      };
    }

    // Détection des rapports d'analyse bancaires
    const bankAnalysisPatterns = [
      { keywords: ['BDK'], type: 'bdk_analysis', bank: 'BDK' },
      { keywords: ['ATB', 'ATLANTIQUE'], type: 'atb_analysis', bank: 'ATB' }, 
      { keywords: ['BICIS', 'BIC'], type: 'bicis_analysis', bank: 'BICIS' }, 
      { keywords: ['ORA', 'ORABANK'], type: 'ora_analysis', bank: 'ORA' }, 
      { keywords: ['SGS', 'SOCIETE GENERALE', 'SGBS'], type: 'sgbs_analysis', bank: 'SGBS' }, 
      { keywords: ['BIS', 'BANQUE ISLAMIQUE'], type: 'bis_analysis', bank: 'BIS' } 
    ];

    for (const pattern of bankAnalysisPatterns) {
      if (pattern.keywords.some(keyword => filename.includes(keyword))) {
        // Distinguer rapport d'analyse vs relevé bancaire
        if (filename.includes('ONLINE') || filename.includes('STATEMENT') || filename.includes('RELEVE')) {
          return {
            type: `${pattern.type.replace('_analysis', '_statement')}`,
            confidence: 'high',
            description: `${pattern.bank} Relevé Bancaire`,
            icon: FileText
          };
        } else {
          return {
            type: pattern.type,
            confidence: 'high',
            description: `${pattern.bank} Rapport Analytique`,
            icon: Building2
          };
        }
      }
    }

    // Détection Fund Position
    if (filename.includes('FUND') && filename.includes('POSITION')) {
      return {
        type: 'fundsPosition',
        confidence: 'high',
        description: 'Position des fonds',
        icon: FileText
      };
    }

    // Détection Client Reconciliation
    if (filename.includes('CLIENT') && filename.includes('RECONCILIATION')) {
      return {
        type: 'clientReconciliation',
        confidence: 'high',
        description: 'Réconciliation client',
        icon: FileText
      };
    }

    // Détection par date (format DDMMYY)
    const datePattern = /\d{6}/;
    if (datePattern.test(filename)) {
      // Si c'est un PDF avec une date, probablement un rapport bancaire
      if (extension === 'pdf') {
        return {
          type: 'unknown_bank_report',
          confidence: 'medium',
          description: 'Rapport bancaire (type à confirmer)',
          icon: Building2
        };
      }
    }

    // Type non détecté
    return {
      type: 'unknown',
      confidence: 'low',
      description: 'Type de fichier non détecté',
      icon: Upload
    };
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    console.log('onDrop called in FileUploadBulk.tsx');
    console.log('Accepted files:', acceptedFiles.length, acceptedFiles.map(f => f.name));
    const newDetectedFiles: DetectedFile[] = acceptedFiles.map(file => {
      const detection = detectFileType(file);
      return {
        file,
        detectedType: detection.type,
        confidence: detection.confidence,
        description: detection.description,
        icon: detection.icon
      };
    });

    setDetectedFiles(prev => {
      const updatedFiles = [...prev, ...newDetectedFiles];
      console.log('Detected files state after update:', updatedFiles.length, updatedFiles.map(f => f.file.name));
      return updatedFiles;
    });
  }, [detectFileType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/pdf': ['.pdf'],
      'text/csv': ['.csv']
    },
    multiple: true
  });

  const removeFile = useCallback((index: number) => {
    setDetectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const getConfidenceColor = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-red-100 text-red-800';
    }
  };

  const getConfidenceIcon = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high': return CheckCircle;
      case 'medium': return AlertCircle;
      case 'low': return AlertCircle;
    }
  };

  const handleSubmit = async () => {
    if (detectedFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "Aucun fichier",
        description: "Veuillez sélectionner au moins un fichier à traiter.",
      });
      return;
    }

    setProcessing(true);
    setProcessingStartTime(Date.now());
    setProcessingResults(null);
    progressService.reset();

    try {
      // Extraire les fichiers du tableau detectedFiles
      const filesToProcess = detectedFiles.map(df => df.file);

      const result = await enhancedFileProcessingService.processFilesArray(filesToProcess);
      
      setProcessingResults(result);

      if (result.success) {
        toast({
          title: "Succès",
          description: `${detectedFiles.length} fichier(s) traité(s) avec succès.`,
        });
        
        // Optionnel : vider la liste après traitement réussi
        // setDetectedFiles([]);
      } else {
        toast({
          variant: "destructive",
          title: "Erreur",
          description: "Erreur lors du traitement des fichiers: " + (result.errors?.join(', ') || 'Erreur inconnue'),
        });
      }
    } catch (error) {
      console.error("Erreur lors du traitement:", error);
      toast({
        variant: "destructive",
        title: "Erreur Critique",
        description: "Une erreur critique est survenue: " + (error instanceof Error ? error.message : 'Erreur inconnue'),
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Importation en Masse des Données</h1>
      <p className="text-gray-600 mb-8">
        Glissez-déposez tous vos fichiers en une seule fois. L'application détectera automatiquement le type de chaque document et les traitera en conséquence.
      </p>

      {/* Zone de dépôt principale */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-6 w-6" />
            <span>Zone de Dépôt des Fichiers</span>
          </CardTitle>
          <CardDescription>
            Glissez-déposez vos fichiers ici ou cliquez pour les sélectionner. Formats acceptés : Excel (.xlsx, .xls), PDF (.pdf), CSV (.csv)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragActive 
                ? 'border-blue-400 bg-blue-50' 
                : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className={`h-12 w-12 mb-4 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
            {isDragActive ? (
              <p className="text-blue-600 text-lg font-medium">Déposez les fichiers ici...</p>
            ) : (
              <>
                <p className="text-gray-600 text-lg font-medium mb-2">
                  Glissez-déposez vos fichiers ici
                </p>
                <p className="text-gray-500 text-sm">
                  ou cliquez pour sélectionner des fichiers
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Liste des fichiers détectés */}
      {detectedFiles.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Fichiers Détectés ({detectedFiles.length})</CardTitle>
            <CardDescription>
              Vérifiez que la détection automatique est correcte avant de traiter les fichiers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {detectedFiles.map((detectedFile, index) => {
                const ConfidenceIcon = getConfidenceIcon(detectedFile.confidence);
                const FileIcon = detectedFile.icon;
                
                return (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4 flex-1">
                      <FileIcon className="h-8 w-8 text-gray-600" />
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{detectedFile.file.name}</p>
                        <p className="text-sm text-gray-500">{detectedFile.description}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Taille: {(detectedFile.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={`${getConfidenceColor(detectedFile.confidence)} px-3 py-1`}>
                          <ConfidenceIcon className="h-3 w-3 mr-1" />
                          {detectedFile.confidence === 'high' ? 'Sûr' : 
                           detectedFile.confidence === 'medium' ? 'Probable' : 'Incertain'}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bouton de traitement */}
      <div className="flex justify-center">
        <Button 
          onClick={handleSubmit} 
          disabled={processing || detectedFiles.length === 0}
          size="lg"
          className="px-8"
        >
          {processing ? (
            <>
              Traitement en cours...
            </>
          ) : (
            `Traiter ${detectedFiles.length} fichier(s)`
          )}
        </Button>
      </div>

      {processing && <ProgressDisplay />}

      {/* Affichage des résultats */}
      {processingResults && (
        <ProcessingResultsDetailed 
          results={processingResults}
          processingTime={processingStartTime ? Date.now() - processingStartTime : undefined}
        />
      )}

      {/* Aide et informations */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-lg">Types de Fichiers Supportés</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              <span><strong>Collection Report:</strong> Fichier Excel principal</span>
            </div>
            <div className="flex items-center space-x-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              <span><strong>Rapports d'analyse:</strong> BDK, ATB, BICIS, ORA, SGBS, BIS</span>
            </div>
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-purple-600" />
              <span><strong>Relevés bancaires:</strong> Transactions détaillées</span>
            </div>
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-orange-600" />
              <span><strong>Fund Position:</strong> Position des fonds</span>
            </div>
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-red-600" />
              <span><strong>Client Reconciliation:</strong> Réconciliation client</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FileUploadBulk;