
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileSpreadsheet, FileText, Upload, Building2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { fileProcessingService } from '@/services/fileProcessingService';
import { progressService } from '@/services/progressService';
import { ProgressDisplay } from '@/components/ProgressDisplay';

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>({});
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = useCallback((category: string, file: File | null) => {
    if (file) {
      setSelectedFiles(prev => ({
        ...prev,
        [category]: file
      }));
      
      // Détection automatique des rapports bancaires
      if (category === 'other' && file) {
        const bankType = detectBankReportType(file.name);
        if (bankType) {
          console.log(`🏦 Rapport bancaire ${bankType} détecté automatiquement`);
          setSelectedFiles(prev => {
            const newFiles = { ...prev };
            newFiles[`${bankType.toLowerCase()}_analysis`] = file;
            delete newFiles.other;
            return newFiles;
          });
        }
      }
    } else {
      setSelectedFiles(prev => {
        const newFiles = { ...prev };
        delete newFiles[category];
        return newFiles;
      });
    }
  }, []);

  const onDrop = useCallback((acceptedFiles: File[], category: string) => {
    if (acceptedFiles.length > 0) {
      handleFileSelect(category, acceptedFiles[0]);
    }
  }, [handleFileSelect]);

  const { getRootProps: getCollectionRootProps, getInputProps: getCollectionInputProps } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'collectionReport'),
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  const { getRootProps: getBdkStatementRootProps, getInputProps: getBdkStatementInputProps } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'bdk_statement'),
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: false
  });

  const { getRootProps: getFundsPositionRootProps, getInputProps: getFundsPositionInputProps } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'fundsPosition'),
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: false
  });

  const { getRootProps: getClientReconciliationRootProps, getInputProps: getClientReconciliationInputProps } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'clientReconciliation'),
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: false
  });

  const detectBankReportType = (filename: string): string | null => {
    const bankKeywords = {
      'BDK': ['BDK', 'BANQUE DE DAKAR'],
      'ATB': ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
      'BICIS': ['BICIS', 'BIC'],
      'ORA': ['ORA', 'ORABANK'],
      'SGBS': ['SGBS', 'SOCIETE GENERALE', 'SG'],
      'BIS': ['BIS', 'BANQUE ISLAMIQUE']
    };
    
    const upperFilename = filename.toUpperCase();
    
    for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
      if (keywords.some(keyword => upperFilename.includes(keyword))) {
        return bankCode;
      }
    }
    
    return null;
  };

  const handleSubmit = async () => {
    setProcessing(true);
    progressService.reset();

    try {
      const result = await fileProcessingService.processFiles(selectedFiles);

      if (result.success) {
        toast({
          title: "Succès",
          description: "Fichiers traités avec succès.",
        });
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

  const uploadCategories = [
    {
      id: 'collectionReport',
      title: 'Collection Report',
      description: 'Fichier Excel principal avec les collections',
      icon: FileSpreadsheet,
      required: false,
      accept: '.xlsx,.xls,.csv'
    },
    // Rapports d'analyse bancaires
    {
      id: 'bdk_analysis',
      title: 'Rapport BDK',
      description: 'Rapport d\'analyse bancaire BDK',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    {
      id: 'atb_analysis',
      title: 'Rapport ATB',
      description: 'Rapport d\'analyse bancaire ATB',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    {
      id: 'bicis_analysis',
      title: 'Rapport BICIS',
      description: 'Rapport d\'analyse bancaire BICIS',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    {
      id: 'ora_analysis',
      title: 'Rapport ORA',
      description: 'Rapport d\'analyse bancaire ORA',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    {
      id: 'sgbs_analysis',
      title: 'Rapport SGBS',
      description: 'Rapport d\'analyse bancaire SGBS',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    {
      id: 'bis_analysis',
      title: 'Rapport BIS',
      description: 'Rapport d\'analyse bancaire BIS',
      icon: Building2,
      required: false,
      accept: '.xlsx,.xls,.pdf'
    },
    // Relevés bancaires existants
    {
      id: 'bdk_statement',
      title: 'Relevé BDK',
      description: 'Relevé bancaire BDK (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'sgs_statement',
      title: 'Relevé SGS',
      description: 'Relevé bancaire SGS (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'bicis_statement',
      title: 'Relevé BICIS',
      description: 'Relevé bancaire BICIS (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'atb_statement',
      title: 'Relevé ATB',
      description: 'Relevé bancaire ATB (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'bis_statement',
      title: 'Relevé BIS',
      description: 'Relevé bancaire BIS (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'ora_statement',
      title: 'Relevé ORA',
      description: 'Relevé bancaire ORA (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'fundsPosition',
      title: 'Fund Position',
      description: 'Position des fonds (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'clientReconciliation',
      title: 'Réconciliation Client',
      description: 'Réconciliation client (optionnel)',
      icon: FileText,
      required: false,
      accept: '.pdf,.xlsx,.xls'
    },
    {
      id: 'other',
      title: 'Autre Document',
      description: 'Fichier non catégorisé (détection automatique)',
      icon: Upload,
      required: false,
      accept: '.xlsx,.xls,.pdf,.csv'
    }
  ];

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Importation des Données</h1>
      <p className="text-gray-600 mb-8">
        Sélectionnez les fichiers à importer. Les fichiers seront traités et les données seront intégrées dans le dashboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {uploadCategories.map(category => (
          <Card key={category.id}>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                {category.icon && <category.icon className="h-5 w-5" />}
                <span>{category.title}</span>
              </CardTitle>
              <CardDescription className="text-gray-500">{category.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Label htmlFor={category.id} className="text-sm font-medium text-gray-700">
                Fichier {category.required ? '(Requis)' : '(Optionnel)'}
              </Label>
              {category.id === 'collectionReport' ? (
                <div {...getCollectionRootProps({ className: 'dropzone' })}>
                  <Input {...getCollectionInputProps({ id: category.id })} type="file" className="hidden" />
                  <div className="flex flex-col items-center justify-center w-full h-32 bg-gray-100 border-2 border-gray-300 border-dashed rounded-md cursor-pointer">
                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">Cliquez ou glissez-déposez votre fichier ici</p>
                  </div>
                </div>
              ) : category.id === 'bdk_statement' ? (
                <div {...getBdkStatementRootProps({ className: 'dropzone' })}>
                  <Input {...getBdkStatementInputProps({ id: category.id })} type="file" className="hidden" />
                  <div className="flex flex-col items-center justify-center w-full h-32 bg-gray-100 border-2 border-gray-300 border-dashed rounded-md cursor-pointer">
                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">Cliquez ou glissez-déposez votre fichier ici</p>
                  </div>
                </div>
              ) : category.id === 'fundsPosition' ? (
                <div {...getFundsPositionRootProps({ className: 'dropzone' })}>
                  <Input {...getFundsPositionInputProps({ id: category.id })} type="file" className="hidden" />
                  <div className="flex flex-col items-center justify-center w-full h-32 bg-gray-100 border-2 border-gray-300 border-dashed rounded-md cursor-pointer">
                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">Cliquez ou glissez-déposez votre fichier ici</p>
                  </div>
                </div>
              ) : category.id === 'clientReconciliation' ? (
                <div {...getClientReconciliationRootProps({ className: 'dropzone' })}>
                  <Input {...getClientReconciliationInputProps({ id: category.id })} type="file" className="hidden" />
                  <div className="flex flex-col items-center justify-center w-full h-32 bg-gray-100 border-2 border-gray-300 border-dashed rounded-md cursor-pointer">
                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">Cliquez ou glissez-déposez votre fichier ici</p>
                  </div>
                </div>
              ) : (
                <>
                  <Input
                    type="file"
                    id={category.id}
                    accept={category.accept}
                    className="mt-2 w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    onChange={(e: any) => handleFileSelect(category.id, e.target.files?.[0] || null)}
                  />
                </>
              )}
              {selectedFiles[category.id] && (
                <div className="mt-2 text-green-500 text-sm">
                  Fichier sélectionné: {selectedFiles[category.id].name}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={processing} className="mt-8 w-full md:w-auto">
        {processing ? (
          <>
            Traitement en cours...
          </>
        ) : (
          "Traiter les Fichiers"
        )}
      </Button>

      {processing && <ProgressDisplay />}
    </div>
  );
};

export default FileUpload;
