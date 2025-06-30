import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileSpreadsheet, FileText, Upload, Building2, Brain, FileSearch, Database, Code, AlertTriangle, Info } from 'lucide-react';
import { enhancedFileProcessingService } from '@/services/enhancedFileProcessingService';
import { excelProcessingService } from '@/services/excelProcessingService';
import { bankReportProcessingService } from '@/services/bankReportProcessingService';
import { pdfExtractionService } from '@/services/pdfExtractionService';
import { toast } from '@/components/ui/sonner';

const DocumentUnderstanding = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<any | null>(null);
  const [bankType, setBankType] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [pdfMetadata, setPdfMetadata] = useState<any | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setFileType(null);
      setConfidence(null);
      setRawText(null);
      setParsedData(null);
      setBankType(null);
      setExtractionError(null);
    }
  }, []);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  });

  const analyzeFile = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setExtractionError(null);
    setPdfMetadata(null);
    
    try {
      console.log('🔍 Début analyse fichier:', selectedFile.name);
      
      // 1. Detect file type
      const detection = await enhancedFileProcessingService.detectFileType(selectedFile);
      setFileType(detection.detectedType);
      setConfidence(detection.confidence);
      setBankType(detection.bankType || null);

      console.log('🎯 Type détecté:', detection.detectedType, 'Confiance:', detection.confidence);

      // 2. Extract raw text with improved error handling
      const buffer = await selectedFile.arrayBuffer();
      let extractedText = '';
      
      try {
        if (selectedFile.name.toLowerCase().endsWith('.pdf')) {
          console.log('📄 Extraction PDF...');
          
          // Essayer d'abord d'extraire les métadonnées
          try {
            const metadata = await pdfExtractionService.getPDFMetadata(buffer);
            setPdfMetadata(metadata);
            console.log('📋 Métadonnées PDF récupérées:', metadata);
          } catch (metaError) {
            console.warn('⚠️ Impossible de récupérer les métadonnées:', metaError);
          }
          
          // Puis extraire le texte
          extractedText = await pdfExtractionService.extractTextFromPDF(buffer);
          
          if (extractedText.length === 0) {
            setExtractionError('Le PDF a été lu mais aucun texte n\'a pu être extrait. Il pourrait s\'agir d\'un PDF scanné ou protégé.');
            extractedText = 'PDF lu mais aucun texte extractible trouvé';
          }
        } else if (selectedFile.name.toLowerCase().endsWith('.xlsx') || selectedFile.name.toLowerCase().endsWith('.xls')) {
          console.log('📊 Extraction Excel...');
          extractedText = await extractTextFromExcel(buffer);
        }
        
        console.log('📝 Texte extrait:', extractedText.length, 'caractères');
        setRawText(extractedText);
      } catch (extractError) {
        console.error('❌ Erreur extraction:', extractError);
        const errorMessage = extractError instanceof Error ? extractError.message : 'Erreur d\'extraction inconnue';
        setExtractionError(errorMessage);
        setRawText(`Erreur lors de l'extraction: ${errorMessage}`);
      }

      // 3. Process based on detected type
      if (detection.detectedType === 'collectionReport') {
        const result = await excelProcessingService.processCollectionReportExcel(selectedFile);
        if (result.success && result.data) {
          setParsedData({
            type: 'Collection Report',
            collections: result.data.slice(0, 10), // Limit to first 10 for display
            totalCollections: result.data.length
          });
        }
      } else if (detection.detectedType === 'bankAnalysis' || detection.detectedType === 'bankStatement') {
        const result = await bankReportProcessingService.processBankReportExcel(selectedFile);
        if (result.success && result.data) {
          setParsedData({
            type: 'Bank Report',
            bankName: result.data.bank,
            date: result.data.date,
            openingBalance: result.data.openingBalance,
            closingBalance: result.data.closingBalance,
            depositsNotCleared: result.data.depositsNotCleared,
            bankFacilities: result.data.bankFacilities,
            impayes: result.data.impayes
          });
        }
      }

      toast.success('Analyse terminée', {
        description: `Type détecté: ${detection.detectedType} (${detection.confidence})`,
      });
    } catch (error) {
      console.error('❌ Erreur analyse:', error);
      toast.error('Erreur lors de l\'analyse', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const extractTextFromExcel = async (buffer: ArrayBuffer): Promise<string> => {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      let allText = '';
      
      for (const sheetName of workbook.SheetNames) {
        allText += `\n--- SHEET: ${sheetName} ---\n`;
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        
        for (const row of sheetData) {
          if (Array.isArray(row)) {
            allText += row.join('\t') + '\n';
          }
        }
      }
      
      return allText;
    } catch (error) {
      console.error('❌ Erreur extraction Excel:', error);
      throw new Error('Erreur extraction Excel: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    }
  };

  const getFileTypeIcon = (type: string | null) => {
    switch (type) {
      case 'collectionReport':
        return <FileSpreadsheet className="h-6 w-6 text-blue-500" />;
      case 'bankAnalysis':
      case 'bankStatement':
        return <Building2 className="h-6 w-6 text-orange-500" />;
      case 'fundsPosition':
        return <FileText className="h-6 w-6 text-green-500" />;
      case 'clientReconciliation':
        return <FileText className="h-6 w-6 text-purple-500" />;
      default:
        return <FileSearch className="h-6 w-6 text-gray-500" />;
    }
  };

  const getConfidenceColor = (confidence: 'high' | 'medium' | 'low' | null) => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const renderParsedData = () => {
    if (!parsedData) return null;

    if (parsedData.type === 'Collection Report') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Collection Report</h3>
            <span className="text-sm text-gray-500">{parsedData.totalCollections} collections au total</span>
          </div>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Banque</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Référence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedData.collections.map((collection: any, index: number) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{collection.clientCode}</TableCell>
                  <TableCell>{collection.collectionAmount?.toLocaleString()}</TableCell>
                  <TableCell>{collection.reportDate}</TableCell>
                  <TableCell>{collection.bankName || 'N/A'}</TableCell>
                  <TableCell>
                    {collection.collectionType === 'EFFET' ? (
                      <Badge className="bg-purple-100 text-purple-800">Effet</Badge>
                    ) : collection.collectionType === 'CHEQUE' ? (
                      <Badge className="bg-blue-100 text-blue-800">Chèque</Badge>
                    ) : (
                      <Badge variant="outline">Inconnu</Badge>
                    )}
                  </TableCell>
                  <TableCell>{collection.factureNo || collection.noChqBd || 'N/A'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }

    if (parsedData.type === 'Bank Report') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Rapport Bancaire: {parsedData.bankName}</h3>
            <span className="text-sm text-gray-500">Date: {parsedData.date}</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Soldes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Solde d'ouverture:</span>
                    <span className="font-medium">{parsedData.openingBalance?.toLocaleString()} FCFA</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Solde de clôture:</span>
                    <span className="font-medium">{parsedData.closingBalance?.toLocaleString()} FCFA</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Mouvement:</span>
                    <span className={`font-medium ${parsedData.closingBalance - parsedData.openingBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(parsedData.closingBalance - parsedData.openingBalance)?.toLocaleString()} FCFA
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Statistiques</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Dépôts non crédités:</span>
                    <span className="font-medium">{parsedData.depositsNotCleared?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Facilités bancaires:</span>
                    <span className="font-medium">{parsedData.bankFacilities?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Impayés:</span>
                    <span className="font-medium">{parsedData.impayes?.length || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {parsedData.depositsNotCleared && parsedData.depositsNotCleared.length > 0 && (
            <div>
              <h4 className="text-md font-medium mb-2">Dépôts Non Crédités</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Dépôt</TableHead>
                    <TableHead>Date Valeur</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead>Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.depositsNotCleared.slice(0, 5).map((deposit: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell>{deposit.dateDepot}</TableCell>
                      <TableCell>{deposit.dateValeur || 'N/A'}</TableCell>
                      <TableCell>{deposit.typeReglement}</TableCell>
                      <TableCell>{deposit.clientCode || 'N/A'}</TableCell>
                      <TableCell>{deposit.reference || 'N/A'}</TableCell>
                      <TableCell>{deposit.montant?.toLocaleString()} FCFA</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {parsedData.depositsNotCleared.length > 5 && (
                <div className="text-center text-sm text-gray-500 mt-2">
                  + {parsedData.depositsNotCleared.length - 5} autres dépôts
                </div>
              )}
            </div>
          )}
          
          {parsedData.impayes && parsedData.impayes.length > 0 && (
            <div>
              <h4 className="text-md font-medium mb-2">Impayés</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Échéance</TableHead>
                    <TableHead>Date Retour</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.impayes.slice(0, 5).map((impaye: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell>{impaye.dateEcheance}</TableCell>
                      <TableCell>{impaye.dateRetour || 'N/A'}</TableCell>
                      <TableCell className="font-medium">{impaye.clientCode}</TableCell>
                      <TableCell>{impaye.description || 'N/A'}</TableCell>
                      <TableCell>{impaye.montant?.toLocaleString()} FCFA</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {parsedData.impayes.length > 5 && (
                <div className="text-center text-sm text-gray-500 mt-2">
                  + {parsedData.impayes.length - 5} autres impayés
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <h3 className="text-lg font-medium mb-2">Données Structurées</h3>
        <pre className="text-xs overflow-auto p-2 bg-gray-100 rounded">
          {JSON.stringify(parsedData, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Comprendre le Traitement des Documents</h1>
          <p className="text-gray-600 mt-2">
            Analysez comment l'application interprète et traite chaque type de document
          </p>
        </div>
        <Badge className="text-lg px-4 py-2 bg-blue-100 text-blue-800">
          Outil de Diagnostic
        </Badge>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileSearch className="h-6 w-6" />
            <span>Analyse de Document</span>
          </CardTitle>
          <CardDescription>
            Téléchargez un document pour voir comment le système l'interprète et quelles données sont extraites
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div
              {...getRootProps()}
              className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors border-gray-300 bg-gray-50 hover:bg-gray-100"
            >
              <input {...getInputProps()} />
              <Upload className="h-10 w-10 text-gray-400 mb-2" />
              <p className="text-gray-600 text-lg font-medium mb-1">
                Glissez-déposez un document ici
              </p>
              <p className="text-gray-500 text-sm">
                ou cliquez pour sélectionner un fichier
              </p>
            </div>

            {selectedFile && (
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="font-medium text-gray-900">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {selectedFile.type || 'Type inconnu'}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={analyzeFile}
                  disabled={isAnalyzing}
                  className="flex items-center space-x-2"
                >
                  <Brain className="h-4 w-4" />
                  <span>{isAnalyzing ? 'Analyse en cours...' : 'Analyser'}</span>
                </Button>
              </div>
            )}

            {/* Affichage des métadonnées PDF */}
            {pdfMetadata && (
              <Alert className="bg-blue-50 border-blue-200">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  <div className="font-medium text-blue-800 mb-2">Informations du PDF</div>
                  <div className="text-sm text-blue-700 space-y-1">
                    <div><strong>Pages:</strong> {pdfMetadata.numPages}</div>
                    {pdfMetadata.title !== 'Titre non disponible' && (
                      <div><strong>Titre:</strong> {pdfMetadata.title}</div>
                    )}
                    {pdfMetadata.author !== 'Auteur non disponible' && (
                      <div><strong>Auteur:</strong> {pdfMetadata.author}</div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Affichage des erreurs d'extraction amélioré */}
            {extractionError && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription>
                  <div className="font-medium text-yellow-800 mb-1">Avertissement d'extraction</div>
                  <p className="text-sm text-yellow-700">{extractionError}</p>
                  <p className="text-xs text-yellow-600 mt-2">
                    L'analyse peut continuer avec les données disponibles.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {(fileType || rawText || parsedData) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="h-6 w-6 text-blue-500" />
              <span>Résultats de l'Analyse</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="analysis" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="analysis">Résultats d'Analyse</TabsTrigger>
                <TabsTrigger value="raw">Texte Brut Extrait</TabsTrigger>
                <TabsTrigger value="parsed">Données Structurées</TabsTrigger>
              </TabsList>

              <TabsContent value="analysis" className="space-y-4">
                {fileType && (
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3 mb-4">
                      {getFileTypeIcon(fileType)}
                      <div>
                        <h3 className="text-lg font-medium">Type de Document Détecté</h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <Badge className={getConfidenceColor(confidence)}>
                            {confidence === 'high' ? 'Confiance Élevée' : 
                             confidence === 'medium' ? 'Confiance Moyenne' : 
                             'Confiance Faible'}
                          </Badge>
                          {bankType && (
                            <Badge variant="outline">{bankType}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Code className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">Type détecté:</span>
                        <span>
                          {fileType === 'collectionReport' ? 'Collection Report' :
                           fileType === 'bankAnalysis' ? 'Rapport d\'Analyse Bancaire' :
                           fileType === 'bankStatement' ? 'Relevé Bancaire' :
                           fileType === 'fundsPosition' ? 'Fund Position' :
                           fileType === 'clientReconciliation' ? 'Client Reconciliation' :
                           'Type Inconnu'}
                        </span>
                      </div>
                      
                      {bankType && (
                        <div className="flex items-center space-x-2">
                          <Building2 className="h-4 w-4 text-orange-500" />
                          <span className="font-medium">Banque détectée:</span>
                          <span>{bankType}</span>
                        </div>
                      )}
                      
                      <div className="mt-4 text-sm text-gray-600">
                        <p>
                          La détection du type de document est basée sur le nom du fichier, son extension et son contenu.
                          Une confiance élevée signifie que le système est très sûr du type de document.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw">
                {rawText ? (
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h3 className="text-lg font-medium mb-2">Texte Brut Extrait</h3>
                    <div className="max-h-96 overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap bg-gray-100 p-4 rounded">
                        {rawText}
                      </pre>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      Ce texte brut est ce que le système extrait du document avant de le structurer.
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucun texte brut extrait. Veuillez d'abord analyser un document.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="parsed">
                {parsedData ? (
                  <div className="p-4 bg-gray-50 rounded-lg">
                    {renderParsedData()}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Aucune donnée structurée extraite. Veuillez d'abord analyser un document.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Guide d'Interprétation des Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">Collection Report</h3>
              <p className="text-sm text-blue-700">
                Les fichiers Excel de Collection Report sont analysés ligne par ligne. Le système extrait les codes clients, 
                montants, dates et références. Il détecte automatiquement si chaque collection est un effet ou un chèque 
                basé sur le contenu de la colonne "No.CHq/Bd".
              </p>
            </div>
            
            <div className="p-4 bg-orange-50 rounded-lg">
              <h3 className="font-semibold text-orange-800 mb-2">Rapports Bancaires</h3>
              <p className="text-sm text-orange-700">
                Les rapports bancaires sont analysés par sections. Le système extrait les soldes d'ouverture et de clôture, 
                les dépôts non crédités, les facilités bancaires et les impayés. Les noms de clients dans les impayés sont 
                nettoyés pour éliminer les mots-clés comme "EFFET", "IMPAYE", etc.
              </p>
            </div>
            
            <div className="p-4 bg-green-50 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">Client Reconciliation</h3>
              <p className="text-sm text-green-700">
                Les rapports de réconciliation client sont analysés pour extraire les codes clients, noms et montants d'impayés.
                Le système nettoie automatiquement les noms de clients pour éliminer les mots-clés bancaires et autres termes
                non pertinents.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DocumentUnderstanding;
