import React, { useState, useCallback } from 'react';
import { FileText, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { BankType, RapportBancaire } from "@/types/banking-universal";
import { bankingUniversalService } from "@/services/bankingUniversalService";
import { bdkExtractionService, BDKParsedData } from "@/services/bdkExtractionService";
import { useToast } from "@/hooks/use-toast";
import BDKDetailedReport from './BDKDetailedReport';
import PDFTextViewer from './PDFTextViewer';

interface ParseResult {
  success: boolean;
  rapport?: RapportBancaire;
  bdkData?: BDKParsedData;
  error?: string;
  bankDetected?: BankType;
  rawText?: string;
  fileName?: string;
}

interface UniversalBankParserProps {
  onParseComplete?: (rapport: RapportBancaire) => void;
  onError?: (error: string) => void;
}

export const UniversalBankParser: React.FC<UniversalBankParserProps> = ({
  onParseComplete,
  onError
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [parseResults, setParseResults] = useState<ParseResult[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentBDKData, setCurrentBDKData] = useState<BDKParsedData | null>(null);
  const [currentRawText, setCurrentRawText] = useState<string>('');
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const { toast } = useToast();

  const detectBank = useCallback((content: string): BankType | null => {
    const upperContent = content.toUpperCase();
    
    if (upperContent.includes('BDK') || upperContent.includes('BANQUE DE KIGALI')) return 'BDK';
    if (upperContent.includes('SGS') || upperContent.includes('SOCIÉTÉ GÉNÉRALE')) return 'SGS';
    if (upperContent.includes('BICIS') || upperContent.includes('BANQUE INTERNATIONALE')) return 'BICIS';
    if (upperContent.includes('ATB') || upperContent.includes('ATLANTIC BANK')) return 'ATB';
    if (upperContent.includes('ORA') || upperContent.includes('ORABANK')) return 'ORA';
    if (upperContent.includes('BIS') || upperContent.includes('BANQUE ISLAMIQUE')) return 'BIS';
    
    return null;
  }, []);

  const parseBDK = useCallback((content: string): { rapport: RapportBancaire; bdkData: BDKParsedData } => {
    console.log('🏦 Parsing BDK avec service avancé...');
    
    const bdkData = bdkExtractionService.extractBDKData(content);
    
    const rapport: RapportBancaire = {
      banque: 'BDK',
      dateRapport: bdkData.reportDate,
      compte: bdkData.accountNumber || 'N/A',
      soldeOuverture: bdkData.openingBalance.amount,
      soldeCloture: bdkData.closingBalance,
      
      depotsNonCredites: bdkData.deposits.map(dep => ({
        id: `dep_${dep.dateOperation}_${dep.amount}`,
        reference: `${dep.vendor}_${dep.client}`,
        montant: dep.amount,
        description: `${dep.description} - ${dep.vendor} - ${dep.client}`,
        dateOperation: dep.dateOperation,
        dateValeur: dep.dateValeur,
        type: 'depot' as const,
        statut: 'en_attente' as const
      })),
      
      chequesNonDebites: bdkData.checks.map(chk => ({
        id: `chk_${chk.date}_${chk.checkNumber}`,
        reference: chk.checkNumber,
        montant: chk.amount,
        description: `${chk.description} - ${chk.client || 'N/A'}`,
        dateOperation: chk.date,
        type: 'cheque' as const,
        statut: 'en_attente' as const
      })),
      
      autresDebits: [],
      autresCredits: [],
      
      facilitesBancaires: bdkData.facilities.map(fac => ({
        type: fac.name,
        montantAutorise: fac.limit,
        montantUtilise: fac.used,
        montantDisponible: fac.balance,
        dateEcheance: fac.dateEcheance
      })),
      
      impayes: bdkData.impayes.map(imp => ({
        reference: imp.reference,
        montant: imp.amount,
        dateEcheance: imp.date,
        dateRetour: imp.date,
        motif: imp.type,
        clientCode: imp.client,
        description: `${imp.description} - ${imp.bank}`
      })),
      
      metadata: {
        formatSource: 'PDF',
        versionParser: '2.0.0-BDK-Advanced',
        dateExtraction: new Date().toISOString(),
        checksum: Date.now().toString(),
        validation: {
          isValid: bdkData.validation.isValid,
          discrepancy: bdkData.validation.discrepancy,
          calculatedClosing: bdkData.validation.calculatedClosing
        }
      }
    };
    
    return { rapport, bdkData };
  }, []);

  const parseContent = useCallback((content: string, fileName: string): ParseResult => {
    try {
      const bankDetected = detectBank(content);
      
      if (!bankDetected) {
        return {
          success: false,
          error: 'Impossible de détecter la banque. Vérifiez le format du fichier.',
          bankDetected: undefined,
          rawText: content,
          fileName
        };
      }

      let rapport: RapportBancaire;
      let bdkData: BDKParsedData | undefined;

      switch (bankDetected) {
        case 'BDK':
          const bdkResult = parseBDK(content);
          rapport = bdkResult.rapport;
          bdkData = bdkResult.bdkData;
          break;
        case 'SGS':
        case 'BICIS':
        case 'ATB':
        case 'ORA':
        case 'BIS':
          const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4})/);
          rapport = {
            banque: bankDetected,
            dateRapport: dateMatch?.[1] || new Date().toLocaleDateString('fr-FR'),
            compte: 'N/A',
            soldeOuverture: 0,
            soldeCloture: 0,
            depotsNonCredites: [],
            chequesNonDebites: [],
            autresDebits: [],
            autresCredits: [],
            facilitesBancaires: [],
            impayes: [],
            metadata: {
              formatSource: 'PDF',
              versionParser: '1.0.0',
              dateExtraction: new Date().toISOString(),
              checksum: Date.now().toString()
            }
          };
          break;
        default:
          throw new Error(`Parser non implémenté pour ${bankDetected}`);
      }

      return {
        success: true,
        rapport,
        bdkData,
        bankDetected,
        rawText: content,
        fileName
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur de parsing inconnue',
        bankDetected: undefined,
        rawText: content,
        fileName
      };
    }
  }, [detectBank, parseBDK]);

  const handleFileUpload = useCallback(async (files: FileList) => {
    setIsUploading(true);
    setUploadProgress(0);
    setCurrentBDKData(null);
    setCurrentRawText('');
    setCurrentFileName('');
    const results: ParseResult[] = [];

    try {
      const totalFiles = files.length;
      
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        setUploadProgress((i / totalFiles) * 100);

        if (file.type !== 'application/pdf') {
          results.push({
            success: false,
            error: `${file.name}: Type de fichier non supporté. PDF requis.`,
            fileName: file.name
          });
          continue;
        }

        const fileContent = await extractPDFContent(file);
        const parseResult = parseContent(fileContent, file.name);
        
        if (parseResult.success && parseResult.rapport) {
          const saveResult = await bankingUniversalService.saveReport(
            parseResult.rapport,
            { fileName: file.name, content: fileContent }
          );
          
          if (saveResult.success) {
            onParseComplete?.(parseResult.rapport);
            
            if (parseResult.bdkData) {
              setCurrentBDKData(parseResult.bdkData);
            }
            
            // Store raw text for the first successful file
            if (!currentRawText && parseResult.rawText) {
              setCurrentRawText(parseResult.rawText);
              setCurrentFileName(file.name);
            }
            
            toast({
              title: "Rapport traité",
              description: `${parseResult.bankDetected} - ${file.name} ${parseResult.bdkData?.validation.isValid ? '✅' : '⚠️'}`,
            });
          } else {
            parseResult.error = saveResult.error;
            parseResult.success = false;
          }
        }

        results.push(parseResult);
      }

      setParseResults(results);
      setUploadProgress(100);

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (successCount > 0) {
        toast({
          title: "Traitement terminé",
          description: `${successCount} fichier(s) traité(s) avec succès. ${errorCount} erreur(s).`,
        });
      }

    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Erreur de traitement');
      toast({
        title: "Erreur de traitement",
        description: "Une erreur est survenue lors du traitement des fichiers.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [parseContent, onParseComplete, onError, toast, currentRawText]);

  const extractPDFContent = async (file: File): Promise<string> => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
      
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      }
      
      return fullText;
    } catch (error) {
      console.error('Erreur extraction PDF:', error);
      throw new Error('Erreur extraction PDF: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  return (
    <div className="space-y-6">
      {/* Zone d'upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Parser Bancaire Universel</span>
          </CardTitle>
          <CardDescription>
            Glissez vos rapports PDF bancaires ou cliquez pour les sélectionner.
            Support: BDK (complet), SGS, BICIS, ATB, ORA, BIS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-muted-foreground/50 transition-colors"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">
              Glissez vos fichiers PDF ici
            </p>
            <p className="text-muted-foreground mb-4">
              ou
            </p>
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept=".pdf"
                  onChange={handleFileInput}
                  className="sr-only"
                />
                Choisir les fichiers
              </label>
            </Button>
          </div>

          {/* Progression */}
          {isUploading && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Traitement en cours...</span>
              </div>
              <Progress value={uploadProgress} className="w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Affichage du texte brut du PDF */}
      {currentRawText && (
        <PDFTextViewer 
          rawText={currentRawText} 
          fileName={currentFileName}
          onHighlight={(text) => console.log('Highlighted:', text)}
        />
      )}

      {/* Affichage détaillé BDK */}
      {currentBDKData && (
        <BDKDetailedReport data={currentBDKData} />
      )}

      {/* Résultats du parsing */}
      {parseResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats du Traitement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {parseResults.map((result, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    {result.success ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    <div>
                      {result.success ? (
                        <div className="space-y-1">
                          <p className="font-medium">
                            Rapport traité avec succès
                            {result.bdkData && (
                              <span className="ml-2">
                                {result.bdkData.validation.isValid ? '✅' : '⚠️'}
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {result.rapport?.dateRapport} - {result.rapport?.compte}
                            {result.bdkData && !result.bdkData.validation.isValid && (
                              <span className="text-orange-600 ml-2">
                                (Écart détecté: {Math.abs(result.bdkData.validation.discrepancy).toLocaleString()} FCFA)
                              </span>
                            )}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium text-red-600">
                            Erreur de traitement
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {result.error}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  {result.bankDetected && (
                    <Badge variant="outline">
                      {result.bankDetected}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alertes d'information */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Banques supportées:</strong> BDK (extraction complète avec validation), SGS, BICIS, ATB, ORA, BIS (en développement).
          Les données sont automatiquement sauvegardées et validées mathématiquement.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default UniversalBankParser;
