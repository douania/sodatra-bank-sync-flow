import React, { useState, useCallback } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; 
import { Alert, AlertDescription } from '@/components/ui/alert'; 
import { FileSpreadsheet, FileText, Upload, Building2, X, AlertTriangle, CheckCircle, FileUp, ArrowRight } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { fileProcessingService } from '@/services/fileProcessingService';
import { progressService } from '@/services/progressService';
import { ProgressDisplay } from '@/components/ProgressDisplay';
import ProcessingResultsDetailed from '@/components/ProcessingResultsDetailed';

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileTypes, setFileTypes] = useState<{ [key: string]: string }>({});
  const [processing, setProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<any>(null);
  const [rejectedFiles, setRejectedFiles] = useState<FileRejection[]>([]);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    // Ajouter les nouveaux fichiers à la liste existante
    setSelectedFiles(prevFiles => [...prevFiles, ...acceptedFiles]);
    
    // Détecter automatiquement le type de chaque fichier
    const newFileTypes: { [key: string]: string } = {};
    
    acceptedFiles.forEach(file => {
      const detectedType = detectFileType(file);
      newFileTypes[file.name] = detectedType;
      console.log(`🔍 Fichier détecté: ${file.name} => ${detectedType}`);
    });
    
    setFileTypes(prev => ({ ...prev, ...newFileTypes }));
    
    // Gérer les fichiers rejetés
    if (rejectedFiles.length > 0) {
      setRejectedFiles(rejectedFiles);
      toast({
        variant: "destructive",
        title: "Fichiers non acceptés",
        description: `${rejectedFiles.length} fichier(s) n'ont pas pu être acceptés.`,
      });
    }
  }, [toast]);
  
  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  });
  
  const removeFile = (fileName: string) => {
    setSelectedFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
    
    // Supprimer également le type de fichier
    setFileTypes(prev => {
      const newTypes = { ...prev };
      delete newTypes[fileName];
      return newTypes;
    });
  };
  
  const clearRejectedFiles = () => {
    setRejectedFiles([]);
  };

  const detectFileType = (file: File): string => {
    const filename = file.name.toUpperCase();
    
    // Détecter les rapports de collection
    if (filename.includes('COLLECTION') || filename.includes('COLLECT')) {
      return 'Collection Report';
    }
    
    // Détecter les rapports de position de fonds
    if (filename.includes('FUND') || filename.includes('POSITION') || 
        filename.includes('FP') || filename.includes('FUND_POSITION')) {
      return 'Fund Position';
    }
    
    // Détecter les rapports de réconciliation client
    if (filename.includes('CLIENT') && filename.includes('RECON')) {
      return 'Client Reconciliation';
    }
    
    const bankKeywords = {
      'BDK': ['BDK', 'BANQUE DE DAKAR'],
      'ATB': ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
      'BICIS': ['BICIS', 'BIC'],
      'ORA': ['ORA', 'ORABANK'],
      'SGBS': ['SGBS', 'SOCIETE GENERALE', 'SG'],
      'BIS': ['BIS', 'BANQUE ISLAMIQUE']
    };
    
    // Détecter les rapports bancaires
    
    for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
      if (keywords.some(keyword => filename.includes(keyword))) {
        return bankCode;
      }
    }
    
    // Si aucun type spécifique n'est détecté
    return 'Autre Document';
  };

  const handleSubmit = async () => {
    setProcessing(true);
    setProcessingResults(null);
    progressService.reset();

    try {
      const result = await fileProcessingService.processFiles(selectedFiles);

      if (result.success) {
        toast({
          title: "Succès",
          description: "Fichiers traités avec succès.",
        });
        
        setProcessingResults(result);
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
  
  const getFileTypeIcon = (type: string) => {
    if (type.includes('Collection')) return <FileSpreadsheet className="h-5 w-5 text-blue-500" />;
    if (type.includes('Fund')) return <FileText className="h-5 w-5 text-green-500" />;
    if (type.includes('Client')) return <FileText className="h-5 w-5 text-purple-500" />;
    if (type.includes('BDK') || type.includes('ATB') || type.includes('BICIS') || type.includes('ORA') || type.includes('SGBS') || type.includes('BIS')) {
      return <Building2 className="h-5 w-5 text-orange-500" />;
    }
    return <FileText className="h-5 w-5 text-gray-500" />;
  };

  const getFileTypeColor = (type: string) => {
    if (type.includes('Collection')) return 'bg-blue-100 text-blue-800';
    if (type.includes('Fund')) return 'bg-green-100 text-green-800';
    if (type.includes('Client')) return 'bg-purple-100 text-purple-800';
    
    // Différencier les relevés des rapports
    if (type.includes('statement')) {
      return 'bg-teal-100 text-teal-800';
    }
    
    if (type.includes('analysis') || type.includes('BDK') || type.includes('ATB') || type.includes('BICIS') || 
        type.includes('ORA') || type.includes('SGBS') || type.includes('BIS')) {
      return 'bg-amber-100 text-amber-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Importation des Données</h1>
          <p className="text-gray-600 mt-2">
            Déposez tous vos fichiers en une seule fois. Le système les identifiera et les traitera automatiquement.
          </p>
        </div>
        <Badge className="text-lg px-4 py-2 bg-blue-100 text-blue-800">
          Importation Intelligente
        </Badge>
      </div>
      
      {/* Zone de dépôt principale */}
      <Card className="mb-8">
        <CardContent className="p-6">
          <div {...getRootProps({ className: 'dropzone' })}>
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center w-full h-48 bg-blue-50 border-2 border-blue-300 border-dashed rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
              <FileUp className="h-12 w-12 text-blue-500 mb-4" />
              <h3 className="text-lg font-semibold text-blue-700 mb-2">Déposez tous vos fichiers ici</h3>
              <p className="text-blue-600 text-center max-w-md">
                Glissez-déposez tous vos fichiers Excel et PDF en une seule fois. 
                Le système détectera automatiquement leur type.
              </p>
              <p className="text-sm text-blue-500 mt-2">
                Formats acceptés: .xlsx, .xls, .csv, .pdf
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Bouton de traitement */}
      {selectedFiles.length > 0 && (
        <div className="flex justify-center my-8 sticky bottom-4">
          <Button 
            onClick={handleSubmit} 
            disabled={processing || selectedFiles.length === 0}
            size="lg"
            className="px-8 py-6 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg"
          >
            {processing ? (
              <>
                Traitement en cours...
              </>
            ) : (
              <>
                Traiter {selectedFiles.length} fichier(s) <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
        </div>
      )}
      
      {/* Affichage des fichiers rejetés */}
      {rejectedFiles.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex justify-between items-center">
              <span>{rejectedFiles.length} fichier(s) non accepté(s)</span>
              <Button variant="outline" size="sm" onClick={clearRejectedFiles}>
                Effacer
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {rejectedFiles.map((rejection, index) => (
                <div key={index} className="text-sm">
                  {rejection.file.name} - {rejection.errors.map(e => e.message).join(', ')}
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      {processingResults && (
        <ProcessingResultsDetailed results={processingResults} />
      )}
      
      {/* Liste des fichiers sélectionnés */}
      {selectedFiles.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span>{selectedFiles.length} Fichier(s) Prêt(s) pour Traitement</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    {getFileTypeIcon(fileTypes[file.name] || 'Autre')}
                    <div>
                      <div className="font-medium truncate max-w-md">{file.name}</div>
                      <div className="text-sm text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge className={`${getFileTypeColor(fileTypes[file.name] || 'Autre')} px-3 py-1`}>
                      {fileTypes[file.name] || 'Autre Document'}
                    </Badge>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removeFile(file.name)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FileUpload;