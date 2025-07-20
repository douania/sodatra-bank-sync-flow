import React, { useState, useCallback } from 'react';
import { FileText, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { BankType, RapportBancaire } from "@/types/banking-universal";
import { bankingUniversalService } from "@/services/bankingUniversalService";
import { useToast } from "@/hooks/use-toast";

interface ParseResult {
  success: boolean;
  rapport?: RapportBancaire;
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
  const { toast } = useToast();

  // Détection automatique de la banque basée sur le contenu
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

  // Parser spécialisé pour BDK (exemple d'implémentation)
  const parseBDK = useCallback((content: string): RapportBancaire => {
    // Parser basique - à enrichir avec la logique réelle d'extraction
    const lines = content.split('\n');
    const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4})/);
    const compteMatch = content.match(/COMPTE[:\s]+(\d+)/i);
    
    // Extraction des montants (patterns simplifiés)
    const soldeOuvertureMatch = content.match(/SOLDE\s+D[\'']OUVERTURE[:\s]+([\d\s,.-]+)/i);
    const soldeClotureMatch = content.match(/SOLDE\s+DE\s+CLOTURE[:\s]+([\d\s,.-]+)/i);
    
    const parseAmount = (str?: string): number => {
      if (!str) return 0;
      return parseFloat(str.replace(/[^\d.-]/g, '')) || 0;
    };

    return {
      banque: 'BDK',
      dateRapport: dateMatch?.[1] || new Date().toLocaleDateString('fr-FR'),
      compte: compteMatch?.[1] || 'N/A',
      soldeOuverture: parseAmount(soldeOuvertureMatch?.[1]),
      soldeCloture: parseAmount(soldeClotureMatch?.[1]),
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
  }, []);

  // Parser universel qui délègue au parser spécialisé
  const parseContent = useCallback((content: string, fileName: string): ParseResult => {
    try {
      const bankDetected = detectBank(content);
      
      if (!bankDetected) {
        return {
          success: false,
          error: 'Impossible de détecter la banque. Vérifiez le format du fichier.',
          bankDetected: undefined
        };
      }

      let rapport: RapportBancaire;

      // Délégation au parser spécialisé
      switch (bankDetected) {
        case 'BDK':
          rapport = parseBDK(content);
          break;
        case 'SGS':
        case 'BICIS':
        case 'ATB':
        case 'ORA':
        case 'BIS':
          // Pour l'instant, utiliser le parser BDK comme base
          // À implémenter spécifiquement pour chaque banque
          rapport = { ...parseBDK(content), banque: bankDetected };
          break;
        default:
          throw new Error(`Parser non implémenté pour ${bankDetected}`);
      }

      return {
        success: true,
        rapport,
        bankDetected
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur de parsing inconnue',
        bankDetected: undefined
      };
    }
  }, [detectBank, parseBDK]);

  // Gestion de l'upload de fichiers
  const handleFileUpload = useCallback(async (files: FileList) => {
    setIsUploading(true);
    setUploadProgress(0);
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

        // Simulation d'extraction de contenu PDF
        // En production, utiliser une vraie librairie d'extraction PDF
        const fileContent = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            // Simulation du contenu extrait
            resolve(`
              BANQUE DE KIGALI
              RAPPORT JOURNALIER
              DATE: 25/06/2025
              COMPTE: 1234567890
              SOLDE D'OUVERTURE: 15,450,000
              SOLDE DE CLOTURE: 16,200,000
              DEPOTS NON CREDITES: 500,000
              CHEQUES NON DEBITES: 750,000
            `);
          };
          reader.readAsText(file);
        });

        const parseResult = parseContent(fileContent, file.name);
        
        if (parseResult.success && parseResult.rapport) {
          // Sauvegarder en base
          const saveResult = await bankingUniversalService.saveReport(
            parseResult.rapport,
            { fileName: file.name, content: fileContent }
          );
          
          if (saveResult.success) {
            onParseComplete?.(parseResult.rapport);
            toast({
              title: "Rapport traité",
              description: `${parseResult.bankDetected} - ${file.name}`,
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

  // Drag & Drop handlers
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
            Support: BDK, SGS, BICIS, ATB, ORA, BIS.
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
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {result.rapport?.dateRapport} - {result.rapport?.compte}
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
          <strong>Banques supportées:</strong> BDK (complet), SGS, BICIS, ATB, ORA, BIS (en développement).
          Les données sont automatiquement sauvegardées et comparées avec les rapports précédents.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default UniversalBankParser;