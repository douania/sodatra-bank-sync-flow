import React, { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDropzone, FileRejection } from 'react-dropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; 
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileSpreadsheet, FileText, Upload, Building2, X, AlertTriangle, CheckCircle, FileUp, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { fileProcessingService, type ProcessingResult } from '@/services/fileProcessingService';
import { progressService } from '@/services/progressService';
import { ProgressDisplay } from '@/components/ProgressDisplay';
import ProcessingResultsDetailed from '@/components/ProcessingResultsDetailed';
import CollectionImportReviewPanel from '@/components/CollectionImportReview';
import {
  attachProposedStatuses,
  partitionCollectionReportFiles,
  prepareCollectionImportReview,
} from '@/services/collectionImportReviewService';
import {
  assertPromotionAllowed,
  getValidatedCollections,
  promoteValidatedCollections,
} from '@/services/collectionImportPromotionService';
import type { CollectionImportReview } from '@/types/processing';
import {
  isUploadMutationAllowed,
  UPLOAD_READ_ONLY_TARGET_MESSAGE,
} from '@/services/uploadRuntimeGuard';
import { buildImportPreflight } from '@/services/importPreflightService';
import { useAuth } from '@/contexts/AuthContext';
import {
  evaluateOperationalImportAccess,
  type OperationalImportAccessVerdict,
  type OperationalImportRole,
} from '@/services/operationalImportAccess';
import { getCurrentUserOperationalImportRoles } from '@/services/operationalImportRoleService';
import {
  currentOperationalImportDeploymentTarget,
  OPERATIONAL_IMPORT_FORMAT_READINESS,
} from '@/services/operationalImportReadiness';

function qualificationLabel(qualification: string): string {
  if (qualification === 'PRODUCTION_CANDIDATE') return 'Candidat production';
  if (qualification === 'STAGING_PILOT') return 'Pilote staging';
  return 'Bloqué';
}

const OperationalImportReadinessCard = () => (
  <Card className="mb-8">
    <CardHeader>
      <CardTitle>Disponibilité réelle des imports</CardTitle>
      <CardDescription>
        La qualification décrit les preuves versionnées. Elle n'active jamais la production à elle seule.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="grid gap-3 md:grid-cols-2">
        {OPERATIONAL_IMPORT_FORMAT_READINESS.map(entry => (
          <div key={entry.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{entry.label}</div>
                <div className="text-xs text-muted-foreground">
                  {entry.formats.join(' · ')} — {entry.route}
                </div>
              </div>
              <Badge variant={entry.qualification === 'BLOCKED' ? 'destructive' : 'secondary'}>
                {qualificationLabel(entry.qualification)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{entry.evidence}</p>
            {entry.limitation && (
              <p className="mt-1 text-sm text-amber-700">{entry.limitation}</p>
            )}
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

function blockedImportCopy(verdict: OperationalImportAccessVerdict): {
  title: string;
  description: string;
} {
  if (verdict.allowed) return { title: '', description: '' };
  if (verdict.reason === 'target_read_only') {
    return { title: 'Production en lecture seule', description: UPLOAD_READ_ONLY_TARGET_MESSAGE };
  }
  if (verdict.reason === 'roles_pending') {
    return { title: 'Vérification des autorisations', description: 'Chargement des rôles applicatifs…' };
  }
  if (verdict.reason === 'role_lookup_failed') {
    return {
      title: 'Autorisations indisponibles',
      description: 'La lecture des rôles a échoué ; import bloqué par défaut.',
    };
  }
  return {
    title: 'Accès opérateur requis',
    description: 'L’import et la promotion sont réservés aux rôles admin et manager.',
  };
}

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<ProcessingResult | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<FileRejection[]>([]);
  // ⭐ PACK-C : staging/review Collection Report — aucune écriture DB avant promotion.
  const [collectionReview, setCollectionReview] = useState<CollectionImportReview | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promotionResult, setPromotionResult] = useState<ProcessingResult | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  // ⭐ 0Z_AM : garde d'interface production read-only — réutilise la politique
  // canonique cible × capacité (production : read uniquement, fail-closed).
  // Jamais une barrière de sécurité : Auth, rôles, RLS et grants restent serveur.
  // Chaque famille d'actions déclare sa capacité exacte : sélection/traitement
  // = deposit ; promotion Collection = promote.
  const targetAllowsDeposit = isUploadMutationAllowed('deposit');
  const targetAllowsPromotion = isUploadMutationAllowed('promote');
  const rolesQuery = useQuery<OperationalImportRole[]>({
    queryKey: ['operational-import', 'roles', user?.id],
    queryFn: getCurrentUserOperationalImportRoles,
    enabled: Boolean(user?.id) && targetAllowsDeposit,
    staleTime: 5 * 60 * 1000,
  });
  const importAccess = evaluateOperationalImportAccess({
    targetAllowsMutation: targetAllowsDeposit,
    roles: rolesQuery.data ?? [],
    rolesPending: rolesQuery.isPending,
    rolesError: rolesQuery.isError,
  });
  const canProcessFiles = importAccess.allowed;
  const canPromoteCollections = importAccess.allowed && targetAllowsPromotion;
  const blockedCopy = blockedImportCopy(importAccess);
  const deploymentTarget = currentOperationalImportDeploymentTarget();
  const importPreflight = useMemo(
    () => buildImportPreflight(selectedFiles, { deploymentTarget }),
    [deploymentTarget, selectedFiles],
  );

  // ⭐ PACK-C.1 : toute modification de la liste des fichiers invalide la review,
  // la promotion et les résultats précédents — sinon l'UI afficherait un staging
  // périmé ne correspondant plus aux fichiers sélectionnés.
  const resetImportStateAfterFileChange = useCallback(() => {
    setCollectionReview(null);
    setPromotionResult(null);
    setProcessingResults(null);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    // ⭐ PACK-C.1 : nouveaux fichiers ajoutés → l'état de review/promotion est périmé.
    if (acceptedFiles.length > 0) {
      resetImportStateAfterFileChange();
    }

    // Ajouter les nouveaux fichiers à la liste existante
    setSelectedFiles(prevFiles => [...prevFiles, ...acceptedFiles]);
    
    // Gérer les fichiers rejetés
    if (rejectedFiles.length > 0) {
      setRejectedFiles(rejectedFiles);
      toast({
        variant: "destructive",
        title: "Fichiers non acceptés",
        description: `${rejectedFiles.length} fichier(s) n'ont pas pu être acceptés.`,
      });
    }
  }, [toast, resetImportStateAfterFileChange]);
  
  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    // ⭐ 0Z_AM : ceinture et bretelles — la dropzone n'est jamais rendue en
    // read-only (retour anticipé ci-dessous), et reste désactivée si montée.
    disabled: !canProcessFiles,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  });
  
  const removeFile = (fileToRemove: File) => {
    // ⭐ PACK-C.1 : fichier retiré → l'état de review/promotion est périmé.
    resetImportStateAfterFileChange();

    setSelectedFiles(prevFiles => prevFiles.filter(file => file !== fileToRemove));
  };
  
  const clearRejectedFiles = () => {
    setRejectedFiles([]);
  };

  const handleSubmit = async () => {
    // ⭐ 0Z_AM : fail-closed même si un bouton résiduel était déclenché —
    // le traitement exige la capacité deposit.
    if (!canProcessFiles) {
      toast({
        variant: "destructive",
        title: blockedCopy.title,
        description: blockedCopy.description,
      });
      return;
    }

    if (!importPreflight.canProcess) {
      toast({
        variant: "destructive",
        title: "Lot d'import bloqué",
        description: `${importPreflight.blockedCount} fichier(s) doivent être corrigés ou retirés avant tout traitement.`,
      });
      return;
    }

    setProcessing(true);
    setProcessingStartTime(Date.now());
    setProcessingResults(null);
    setCollectionReview(null);
    setPromotionResult(null);
    progressService.reset();

    try {
      // ⭐ PACK-C : les Collection Report Excel ne passent plus par processFiles
      // (qui écrit en DB immédiatement). Ils sont analysés en staging mémoire ;
      // l'écriture DB n'a lieu qu'à la promotion explicite.
      const { collectionFiles, otherFiles } = await partitionCollectionReportFiles(selectedFiles);

      if (collectionFiles.length > 0) {
        let review = await prepareCollectionImportReview(collectionFiles);
        // Statuts proposés (NEW / EXISTS_COMPLETE / EXISTS_INCOMPLETE) : lecture
        // seule, best-effort — la review reste utilisable si la DB est injoignable.
        review = await attachProposedStatuses(review);
        setCollectionReview(review);

        const rejectionCount = review.counters.rejected_rows + review.counters.file_level_rejections;
        toast({
          title: "Review Collection prête — aucune écriture DB",
          description: `${review.counters.accepted_rows} ligne(s) acceptée(s), ${rejectionCount} rejet(s), ${review.counters.warnings} warning(s). Validez puis promouvez explicitement.`,
        });
      }

      if (otherFiles.length > 0) {
        const result = await fileProcessingService.processFiles(otherFiles);

        // ⭐ PACK-B2 : toujours exposer le résultat structuré, même en échec partiel/global
        setProcessingResults(result);

        const excelErrorCount = result.data?.excelImportDiagnostics?.excel_errors?.length ?? 0;
        const excelWarningCount = result.data?.excelImportDiagnostics?.excel_warnings?.length ?? 0;

        if (result.success && excelErrorCount === 0 && excelWarningCount === 0) {
          toast({
            title: "Traitement terminé avec succès",
            description: "Fichiers traités sans erreur détectée.",
          });
        } else if (result.success) {
          toast({
            title: "Traitement terminé avec réserves",
            description: `${excelErrorCount} ligne(s) Excel rejetée(s), ${excelWarningCount} warning(s) — consultez l'audit de l'import ci-dessous.`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Traitement partiellement échoué / à vérifier",
            description: "Erreur lors du traitement des fichiers: " + (result.errors?.join(', ') || 'Erreur inconnue'),
          });
        }
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

  // ⭐ PACK-C : promotion explicite des lignes validées — seul point d'écriture DB
  // du flux Collection Report.
  const handlePromote = async (reviewWithSelection: CollectionImportReview) => {
    // ⭐ 0Z_AM : fail-closed même si un bouton résiduel était déclenché —
    // la promotion exige la capacité promote.
    if (!canPromoteCollections) {
      toast({
        variant: "destructive",
        title: blockedCopy.title,
        description: blockedCopy.description,
      });
      return;
    }

    const gate = assertPromotionAllowed(reviewWithSelection);
    if (!gate.allowed) {
      toast({
        variant: "destructive",
        title: "Promotion impossible",
        description: gate.reason,
      });
      return;
    }

    setPromoting(true);
    try {
      const promotion = await promoteValidatedCollections(reviewWithSelection);
      const validated = getValidatedCollections(reviewWithSelection);

      const result: ProcessingResult = {
        success: promotion.syncResult.errors.length === 0,
        data: {
          bankReports: [],
          collectionReports: validated,
          syncResult: promotion.syncResult,
          excelImportDiagnostics: {
            files_processed: reviewWithSelection.counters.files_processed,
            collections_extracted: reviewWithSelection.counters.accepted_rows,
            excel_errors: [
              ...reviewWithSelection.fileLevelErrors,
              ...reviewWithSelection.rejectedRows,
            ],
            excel_warnings: reviewWithSelection.warnings,
          },
        },
        errors: promotion.syncResult.errors.map(
          syncError => `${syncError.collection?.clientCode ?? 'INCONNU'}: ${syncError.error}`
        ),
      };

      setCollectionReview(reviewWithSelection);
      setPromotionResult(result);

      if (promotion.syncResult.errors.length === 0) {
        toast({
          title: "Promotion terminée",
          description: `Écriture DB effectuée après validation : ${promotion.validatedCount} ligne(s) promue(s).`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Promotion terminée avec erreurs",
          description: `${promotion.syncResult.errors.length} erreur(s) de synchronisation — consultez le détail ci-dessous.`,
        });
      }
    } catch (error) {
      console.error("Erreur lors de la promotion:", error);
      toast({
        variant: "destructive",
        title: "Erreur de promotion",
        description: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    } finally {
      setPromoting(false);
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

  // ⭐ 0Z_AM : production read-only — sans la capacité deposit (cœur de la
  // page d'import), aucun élément d'import actif n'est rendu (ni dropzone,
  // ni sélecteur, ni bouton de traitement, ni panneau de promotion).
  if (!canProcessFiles) {
    return (
      <div className="container mx-auto py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Importation des Données</h1>
          <p className="text-gray-600 mt-2">
            Import de fichiers indisponible sur cette cible.
          </p>
        </div>
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>{blockedCopy.title}</AlertTitle>
          <AlertDescription>
            {blockedCopy.description} Toute mutation exige aussi les contrôles serveur
            Auth, rôles, RLS et grants ; une qualification ne vaut pas activation.
          </AlertDescription>
        </Alert>
        <div className="mt-8">
          <OperationalImportReadinessCard />
        </div>
      </div>
    );
  }

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

      <OperationalImportReadinessCard />
      
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
            disabled={processing || !importPreflight.canProcess}
            size="lg"
            className="px-8 py-6 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg"
          >
            {processing ? (
              <>
                Traitement en cours...
              </>
            ) : (
              <>
                {importPreflight.canProcess
                  ? `Analyser / Traiter ${selectedFiles.length} fichier(s)`
                  : `Corriger ${importPreflight.blockedCount} fichier(s) bloqué(s)`}
                <ArrowRight className="ml-2 h-5 w-5" />
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
      
      {processing && <ProgressDisplay />}

      {/* ⭐ PACK-C : review humaine du staging Collection — zéro écriture DB avant promotion */}
      {collectionReview && (
        <CollectionImportReviewPanel
          review={collectionReview}
          promoting={promoting}
          promotionDone={!!promotionResult}
          onPromote={handlePromote}
        />
      )}

      {/* ⭐ PACK-C : résultat de la promotion (écriture DB après validation explicite) */}
      {promotionResult && (
        <>
          <Alert className="mb-6 border-green-300 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Écriture DB effectuée après validation — résultat détaillé ci-dessous.
            </AlertDescription>
          </Alert>
          <ProcessingResultsDetailed
            results={promotionResult}
            processingTime={processingStartTime ? Date.now() - processingStartTime : undefined}
          />
        </>
      )}

      {processingResults && (
        <ProcessingResultsDetailed
          results={processingResults}
          processingTime={processingStartTime ? Date.now() - processingStartTime : undefined}
        />
      )}
      
      {/* Liste des fichiers sélectionnés */}
      {selectedFiles.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {importPreflight.canProcess ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
              <span>
                Précontrôle : {importPreflight.readyCount} prêt(s), {importPreflight.blockedCount} bloqué(s)
              </span>
            </CardTitle>
            <CardDescription>
              Aucun traitement ni aucune écriture ne démarre tant qu'un fichier est vide,
              dupliqué, ambigu ou non supporté.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {importPreflight.entries.map((entry, index) => (
                <div
                  key={`${entry.file.name}-${entry.file.size}-${entry.file.lastModified}-${index}`}
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    entry.status === 'BLOCKED'
                      ? 'border-red-300 bg-red-50'
                      : 'border-green-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {getFileTypeIcon(entry.documentLabel)}
                    <div>
                      <div className="font-medium truncate max-w-md">{entry.file.name}</div>
                      <div className="text-sm text-gray-500">
                        {(entry.file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                      {entry.issues.map(issue => (
                        <div key={issue.code} className="text-sm text-red-700 mt-1">
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge className={`${getFileTypeColor(entry.documentLabel)} px-3 py-1`}>
                      {entry.documentLabel}
                    </Badge>
                    <Badge variant={entry.status === 'READY' ? 'secondary' : 'destructive'}>
                      {entry.status === 'READY' ? 'Prêt' : 'Bloqué'}
                    </Badge>
                    <Badge variant="outline">
                      {qualificationLabel(entry.qualification)}
                    </Badge>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removeFile(entry.file)}
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
