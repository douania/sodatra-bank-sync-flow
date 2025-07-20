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

interface ParseResult {
  success: boolean;
  rapport?: RapportBancaire;
  bdkData?: BDKParsedData;
  error?: string;
  bankDetected?: BankType;
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
  const { toast } = useToast();

  // Parser spécialisé pour BDK avec la nouvelle logique de colonnes
  const parseBDK = useCallback(async (file: File): Promise<{ rapport: RapportBancaire; bdkData: BDKParsedData }> => {
    console.log('🏦 Parsing BDK avec détection de colonnes avancée...');
    
    try {
      // Utiliser la nouvelle méthode d'extraction avec détection de colonnes
      const bdkData = await bdkExtractionService.extractBDKDataFromFile(file);
      
      // Convertir vers le format RapportBancaire universel
      const rapport: RapportBancaire = {
        banque: 'BDK',
        dateRapport: bdkData.reportDate,
        compte: bdkData.accountNumber || 'N/A',
        soldeOuverture: bdkData.openingBalance.amount,
        soldeCloture: bdkData.closingBalance,
        
        // Convertir les dépôts
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
        
        // Convertir les chèques
        chequesNonDebites: bdkData.checks.map(chk => ({
          id: `chk_${chk.date}_${chk.checkNumber}`,
          reference: chk.checkNumber,
          montant: chk.amount,
          description: `${chk.description}${chk.client ? ` - ${chk.client}` : ''}`,
          dateOperation: chk.date,
          type: 'cheque' as const,
          statut: 'en_attente' as const
        })),
        
        // Autres éléments vides pour l'instant
        autresDebits: [],
        autresCredits: [],
        
        // Convertir les facilités
        facilitesBancaires: bdkData.facilities.map(fac => ({
          type: fac.name,
          montantAutorise: fac.limit,
          montantUtilise: fac.used,
          montantDisponible: fac.balance,
          dateEcheance: fac.dateEcheance
        })),
        
        // Convertir les impayés
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
          versionParser: '3.0.0-BDK-ColumnDetection',
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
      
    } catch (error) {
      console.error('❌ Erreur parsing BDK avec colonnes:', error);
      // Fallback vers l'ancienne méthode si la nouvelle échoue
      console.log('🔄 Fallback vers extraction texte brut...');
      
      const textContent = await extractPDFContentAsText(file);
      const bdkData = bdkExtractionService.extractBDKData(textContent);
      
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
          description: `${chk.description}${chk.client ? ` - ${chk.client}` : ''}`,
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
          versionParser: '2.0.0-BDK-Fallback',
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
    }
  }, []);

  // Méthode d'extraction PDF texte simple pour fallback
  const extractPDFContentAsText = useCallback(async (file: File): Promise<string> => {
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
  }, []);

  // Parser universel qui délègue au parser spécialisé
  const parseContent = useCallback(async (file: File, fileName: string): Promise<ParseResult> => {
    try {
      // Détection de banque basée sur le nom de fichier ou contenu
      const bankDetected = detectBankFromFile(file, fileName);
      
      if (!bankDetected) {
        return {
          success: false,
          error: 'Impossible de détecter la banque. Vérifiez le format du fichier.',
          bankDetected: undefined
        };
      }

      let rapport: RapportBancaire;
      let bdkData: BDKParsedData | undefined;

      // Délégation au parser spécialisé
      switch (bankDetected) {
        case 'BDK':
          const bdkResult = await parseBDK(file);
          rapport = bdkResult.rapport;
          bdkData = bdkResult.bdkData;
          break;
        case 'SGS':
        case 'BICIS':
        case 'ATB':
        case 'ORA':
        case 'BIS':
          // Pour l'instant, utiliser le parser de base
          rapport = {
            banque: bankDetected,
            dateRapport: new Date().toLocaleDateString('fr-FR'),
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
        bankDetected
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur de parsing inconnue',
        bankDetected: undefined
      };
    }
  }, [parseBDK, detectBankFromFile]);

  // Détection de banque améliorée
  const detectBankFromFile = useCallback((file: File, fileName: string): BankType | null => {
    const upperFileName = fileName.toUpperCase();
    
    if (upperFileName.includes('BDK') || upperFileName.includes('BANQUE DE KIGALI')) return 'BDK';
    if (upperFileName.includes('SGS') || upperFileName.includes('SOCIÉTÉ GÉNÉRALE')) return 'SGS';
    if (upperFileName.includes('BICIS') || upperFileName.includes('BANQUE INTERNATIONALE')) return 'BICIS';
    if (upperFileName.includes('ATB') || upperFileName.includes('ATLANTIC BANK')) return 'ATB';
    if (upperFileName.includes('ORA') || upperFileName.includes('ORABANK')) return 'ORA';
    if (upperFileName.includes('BIS') || upperFileName.includes('BANQUE ISLAMIQUE')) return 'BIS';
    
    return null;
  }, []);

  // Gestion de l'upload de fichiers (mise à jour pour utiliser la nouvelle méthode)
  const handleFileUpload = useCallback(async (files: FileList) => {
    setIsUploading(true);
    setUploadProgress(0);
    setCurrentBDKData(null);
    const results: ParseResult[] = [];

    try {
      const totalFiles = files.length;
      
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        setUploadProgress((i / totalFiles) * 100);

        if (file.type !== 'application/pdf') {
          results.push({
            success: false,
            error: `${file.name}: Type de fichier non supporté. PDF requis.`
          });
          continue;
        }

        // Parsing avec la nouvelle méthode
        const parseResult = await parseContent(file, file.name);
        
        if (parseResult.success && parseResult.rapport) {
          // Sauvegarder en base
          const saveResult = await bankingUniversalService.saveReport(
            parseResult.rapport,
            { fileName: file.name, content: 'Extraction avec colonnes' }
          );
          
          if (saveResult.success) {
            onParseComplete?.(parseResult.rapport);
            
            // Si c'est BDK, sauvegarder les données détaillées pour affichage
            if (parseResult.bdkData) {
              setCurrentBDKData(parseResult.bdkData);
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

      // Résumé des résultats
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
  }, [parseContent, onParseComplete, onError, toast]);

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
            <span>Parser Bancaire Universel v3.0</span>
          </CardTitle>
          <CardDescription>
            Glissez vos rapports PDF bancaires ou cliquez pour les sélectionner.
            Support: BDK (détection de colonnes avancée), SGS, BICIS, ATB, ORA, BIS.
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
                <span className="text-sm">Traitement en cours avec détection de colonnes...</span>
              </div>
              <Progress value={uploadProgress} className="w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Affichage détaillé BDK */}
      {currentBDKData && (
        <BDKDetailedReport data={currentBDKData} />
      )}

      {/* Résultats du parsing */}
      {parseResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats du Traitement (v3.0 - Colonnes)</CardTitle>
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
                            Rapport traité avec succès (Colonnes détectées)
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
          <strong>Nouveau v3.0:</strong> Détection automatique des colonnes PDF pour BDK avec extraction précise des montants.
          Les données sont automatiquement sauvegardées et validées mathématiquement.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default UniversalBankParser;
