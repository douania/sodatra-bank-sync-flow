import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileText, CheckCircle, AlertTriangle, Clock, Info, Database } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fileProcessingService } from '@/services/fileProcessingService';
import { databaseService } from '@/services/databaseService';
import Stepper from '@/components/Stepper';

const FileUpload = () => {
  const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: File | null }>({
    bdk_statement: null,
    sgs_statement: null,
    bicis_statement: null,
    atb_statement: null,
    bis_statement: null,
    ora_statement: null,
    collectionReport: null,
    clientReconciliation: null,
    fundsPosition: null
  });

  const [processStep, setProcessStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<any>(null);
  const [collectionCount, setCollectionCount] = useState<number | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(true);
  const { toast } = useToast();

  // ⭐ CHARGER LE NOMBRE DE COLLECTIONS AU DÉMARRAGE
  useEffect(() => {
    const loadCollectionCount = async () => {
      setIsLoadingCount(true);
      try {
        const count = await databaseService.getCollectionCount();
        setCollectionCount(count);
      } catch (error) {
        console.error('❌ Erreur chargement compteur:', error);
        setCollectionCount(0);
      } finally {
        setIsLoadingCount(false);
      }
    };

    loadCollectionCount();
  }, []);

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

  const bankStatementTypes = [
    {
      key: 'bdk_statement',
      label: 'Relevé BDK (PDF)',
      bankName: 'BDK',
      description: 'Banque de Kinshasa - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    },
    {
      key: 'sgs_statement',
      label: 'Relevé SGS (PDF)',
      bankName: 'SGS',
      description: 'Société Générale Sénégal - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    },
    {
      key: 'bicis_statement',
      label: 'Relevé BICIS (PDF)',
      bankName: 'BICIS',
      description: 'BICIS - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    },
    {
      key: 'atb_statement',
      label: 'Relevé ATB (PDF)',
      bankName: 'ATB',
      description: 'Atlantic Bank - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    },
    {
      key: 'bis_statement',
      label: 'Relevé BIS (PDF)',
      bankName: 'BIS',
      description: 'Bank of Industry and Services - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    },
    {
      key: 'ora_statement',
      label: 'Relevé ORA (PDF)',
      bankName: 'ORA',
      description: 'ORA Bank - Relevé bancaire PDF',
      accept: '.pdf',
      required: true
    }
  ];

  const otherFileTypes = [
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

  const allRequiredFilesUploaded = [...bankStatementTypes, ...otherFileTypes].every(type => 
    !type.required || uploadedFiles[type.key] !== null
  );

  const uploadedBankStatements = bankStatementTypes.filter(type => uploadedFiles[type.key] !== null).length;

  const handleProcessFiles = async () => {
    if (!allRequiredFilesUploaded || isProcessing) return;

    setIsProcessing(true);
    setProcessStep(2);
    setProcessingResults(null);

    try {
      console.log('🚀 === DÉBUT TRAITEMENT INTERFACE UTILISATEUR ===');
      
      // Étape 2: Extraction (2 minutes selon guide)
      toast({
        title: "Extraction en cours",
        description: "Traitement avec patterns validés SODATRA...",
      });

      const results = await fileProcessingService.processFiles(uploadedFiles);
      
      console.log('📋 Résultats reçus:', results);
      
      setProcessStep(3);
      
      // Étape 3: Validation et sauvegarde
      toast({
        title: "Sauvegarde en cours",
        description: "Validation des données et sauvegarde...",
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setProcessStep(4);
      setProcessingResults(results);

      // ⭐ RECHARGER LE COMPTEUR APRÈS TRAITEMENT
      const newCount = await databaseService.getCollectionCount();
      setCollectionCount(newCount);

      if (results.success) {
        const collectionsCount = results.data?.collectionReports?.length || 0;
        const bankReportsCount = results.data?.bankReports.length || 0;
        
        toast({
          title: "✅ Traitement terminé !",
          description: `${collectionsCount} collections et ${bankReportsCount} rapports bancaires traités`,
        });
      } else {
        const errorsCount = results.errors?.length || 0;
        toast({
          title: "⚠️ Traitement avec erreurs",
          description: `${errorsCount} erreurs détectées - Voir les détails ci-dessous`,
          variant: "destructive"
        });
      }

    } catch (error) {
      console.error('❌ ERREUR INTERFACE TRAITEMENT:', error);
      toast({
        title: "❌ Erreur de traitement",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const FileUploadCard = ({ fileType, index }: { fileType: any, index: number }) => (
    <Card key={fileType.key} className="hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>{fileType.label}</span>
          {fileType.required && <span className="text-red-500">*</span>}
          {fileType.bankName && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
              {fileType.bankName}
            </span>
          )}
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
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">SODATRA Bank Control - Upload</h1>
        <p className="mt-2 text-gray-600">
          Téléchargez les fichiers selon le guide d'implémentation. Traitement automatique en ~8 minutes.
        </p>
        
        {/* ⭐ AFFICHAGE DU COMPTEUR DE COLLECTIONS */}
        <div className="mt-4">
          <Alert className="border-blue-200 bg-blue-50">
            <Database className="h-4 w-4" />
            <AlertDescription>
              {isLoadingCount ? (
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 animate-spin" />
                  <span>Chargement du compteur...</span>
                </div>
              ) : (
                <div>
                  <span className="font-semibold">Collections en base de données :</span> 
                  <span className="ml-2 text-blue-700 font-bold text-lg">
                    {collectionCount?.toLocaleString() || 0}
                  </span>
                  <span className="ml-2 text-sm text-gray-600">
                    entrées existantes dans Supabase
                  </span>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </div>
      </div>

      <Stepper steps={steps} />

      {processStep === 1 && (
        <div className="space-y-8">
          {/* Section Relevés Bancaires */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Relevés Bancaires (6 banques)
              </h2>
              <div className="text-sm text-gray-500">
                {uploadedBankStatements}/6 relevés uploadés
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bankStatementTypes.map((fileType, index) => (
                <FileUploadCard key={fileType.key} fileType={fileType} index={index} />
              ))}
            </div>
          </div>

          {/* Section Autres Fichiers */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Autres Documents Requis
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {otherFileTypes.map((fileType, index) => (
                <FileUploadCard key={fileType.key} fileType={fileType} index={index} />
              ))}
            </div>
          </div>
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
                <>
                  <Alert className={processingResults.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
                    {processingResults.success ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    <AlertDescription>
                      {processingResults.success ? (
                        <>
                          ✅ Traitement terminé ! {processingResults.data?.collectionReports?.length || 0} collections extraites.
                          {processingResults.data?.fundPosition && " Fund Position validée."}
                        </>
                      ) : (
                        <>
                          ❌ Traitement avec erreurs. {processingResults.errors?.length || 0} erreurs détectées.
                        </>
                      )}
                    </AlertDescription>
                  </Alert>

                  {/* ⭐ DIAGNOSTIC ULTRA-DÉTAILLÉ DES COLLECTIONS */}
                  {processingResults.debugInfo?.fullDiagnosis && (
                    <Alert className="border-blue-200 bg-blue-50">
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold mb-3">🔍 DIAGNOSTIC COMPLET DES COLLECTIONS :</div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="space-y-2">
                            <div className="font-medium text-blue-700">📊 Données Excel :</div>
                            <div className="ml-4 space-y-1">
                              <div>Total lignes : {processingResults.debugInfo.fullDiagnosis.totalExcelRows}</div>
                              <div>Collections 2024 : {processingResults.debugInfo.fullDiagnosis.rows2024Count}</div>
                              <div>Collections 2025 : {processingResults.debugInfo.fullDiagnosis.rows2025Count}</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-medium text-green-700">✅ Collections Valides :</div>
                            <div className="ml-4 space-y-1">
                              <div>Valides 2024 : {processingResults.debugInfo.fullDiagnosis.validRows2024}</div>
                              <div>Valides 2025 : {processingResults.debugInfo.fullDiagnosis.validRows2025}</div>
                              <div className="font-semibold">TOTAL ATTENDU : {processingResults.debugInfo.fullDiagnosis.validRows2024 + processingResults.debugInfo.fullDiagnosis.validRows2025}</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-medium text-purple-700">🔄 Collections Transformées :</div>
                            <div className="ml-4 space-y-1">
                              <div>Transformées 2024 : {processingResults.debugInfo.fullDiagnosis.transformedRows2024}</div>
                              <div>Transformées 2025 : {processingResults.debugInfo.fullDiagnosis.transformedRows2025}</div>
                              <div className="font-semibold text-purple-800">TOTAL EXTRAIT : {processingResults.debugInfo.fullDiagnosis.transformedRows2024 + processingResults.debugInfo.fullDiagnosis.transformedRows2025}</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-medium text-red-700">❌ Efficacité d'Extraction :</div>
                            <div className="ml-4 space-y-1">
                              {(() => {
                                const expected = processingResults.debugInfo.fullDiagnosis.validRows2024 + processingResults.debugInfo.fullDiagnosis.validRows2025;
                                const extracted = processingResults.debugInfo.fullDiagnosis.transformedRows2024 + processingResults.debugInfo.fullDiagnosis.transformedRows2025;
                                const missing = expected - extracted;
                                const percentage = expected > 0 ? ((extracted / expected) * 100).toFixed(1) : '0.0';
                                
                                return (
                                  <>
                                    <div>Taux d'extraction : {percentage}%</div>
                                    <div className={missing > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                                      Collections manquantes : {missing}
                                    </div>
                                    {missing > 0 && (
                                      <div className="text-red-500 text-xs">
                                        🚨 {missing} collections perdues !
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>

                        {/* ⭐ RAISONS DE REJET DÉTAILLÉES */}
                        {processingResults.debugInfo.fullDiagnosis.rejectionReasons && Object.keys(processingResults.debugInfo.fullDiagnosis.rejectionReasons).length > 0 && (
                          <div className="mt-4">
                            <div className="font-medium text-orange-700 mb-2">📋 Raisons des rejets :</div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {Object.entries(processingResults.debugInfo.fullDiagnosis.rejectionReasons).map(([reason, count]) => (
                                <div key={reason} className="flex justify-between text-xs bg-orange-100 p-1 rounded">
                                  <span>{reason}</span>
                                  <span className="font-semibold">{String(count)} lignes</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ⭐ ÉCHANTILLONS POUR DEBUG */}
                        {processingResults.debugInfo.fullDiagnosis.sampleValidCollections2024 && processingResults.debugInfo.fullDiagnosis.sampleValidCollections2024.length > 0 && (
                          <div className="mt-4">
                            <div className="font-medium text-blue-700 mb-2">📝 Échantillon Collections 2024 :</div>
                            <div className="max-h-24 overflow-y-auto text-xs bg-blue-50 p-2 rounded">
                              {processingResults.debugInfo.fullDiagnosis.sampleValidCollections2024.slice(0, 2).map((sample, idx) => (
                                <div key={idx} className="mb-1">
                                  {sample["CLIENT NAME"]} - {sample["AMOUNT "]} - {sample["BANK"]}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {processingResults.debugInfo.fullDiagnosis.sampleValidCollections2025 && processingResults.debugInfo.fullDiagnosis.sampleValidCollections2025.length > 0 && (
                          <div className="mt-4">
                            <div className="font-medium text-green-700 mb-2">📝 Échantillon Collections 2025 :</div>
                            <div className="max-h-24 overflow-y-auto text-xs bg-green-50 p-2 rounded">
                              {processingResults.debugInfo.fullDiagnosis.sampleValidCollections2025.slice(0, 2).map((sample, idx) => (
                                <div key={idx} className="mb-1">
                                  {sample["CLIENT NAME"]} - {sample["AMOUNT "]} - {sample["BANK"]}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* ⭐ AFFICHAGE DÉTAILLÉ DES ERREURS AVEC EXEMPLES */}
                  {processingResults.errors && processingResults.errors.length > 0 && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold mb-2">❌ Erreurs détectées ({processingResults.errors.length}):</div>
                        <div className="max-h-40 overflow-y-auto space-y-1 text-sm">
                          {processingResults.errors.slice(0, 10).map((error: string, index: number) => (
                            <div key={index} className="text-red-700 bg-red-100 p-2 rounded text-xs">
                              {error}
                            </div>
                          ))}
                          {processingResults.errors.length > 10 && (
                            <div className="text-red-600 text-xs italic">
                              ... et {processingResults.errors.length - 10} autres erreurs similaires
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* ⭐ LIGNES PROBLÉMATIQUES DÉTAILLÉES */}
                  {processingResults.debugInfo?.problemRows && processingResults.debugInfo.problemRows.length > 0 && (
                    <Alert className="border-orange-200 bg-orange-50">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold mb-2">🔍 Lignes problématiques détectées :</div>
                        <div className="max-h-60 overflow-y-auto space-y-2 text-sm">
                          {processingResults.debugInfo.problemRows.slice(0, 5).map((problem, index) => (
                            <div key={index} className="bg-orange-100 p-2 rounded text-xs">
                              <div className="font-medium text-orange-800">Ligne {problem.rowNumber}:</div>
                              <div className="text-orange-700">{problem.error}</div>
                              <div className="text-orange-600 mt-1">
                                Données: {JSON.stringify(problem.data).substring(0, 100)}...
                              </div>
                            </div>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* ⭐ ANALYSE DÉTAILLÉE DES COLONNES */}
                  {processingResults.debugInfo?.columnAnalysis && (
                    <Alert className="border-blue-200 bg-blue-50">
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold mb-2">📊 Analyse des colonnes Excel :</div>
                        <div className="text-sm space-y-2">
                          <div>
                            <span className="font-medium text-green-700">✅ Colonnes reconnues ({processingResults.debugInfo.columnAnalysis.recognized.length}) :</span>
                            <div className="ml-4 text-green-600">
                              {processingResults.debugInfo.columnAnalysis.recognized.join(', ')}
                            </div>
                          </div>
                          
                          {processingResults.debugInfo.columnAnalysis.unrecognized.length > 0 && (
                            <div>
                              <span className="font-medium text-orange-700">⚠️ Colonnes non reconnues ({processingResults.debugInfo.columnAnalysis.unrecognized.length}) :</span>
                              <div className="ml-4 text-orange-600">
                                {processingResults.debugInfo.columnAnalysis.unrecognized.join(', ')}
                              </div>
                            </div>
                          )}

                          <div className="mt-3">
                            <span className="font-medium">🗺️ Mapping appliqué :</span>
                            <div className="ml-4 space-y-1 max-h-32 overflow-y-auto">
                              {Object.entries(processingResults.debugInfo.columnAnalysis.mapping).map(([excel, supabase]) => (
                                <div key={excel} className="text-xs">
                                  <span className="text-blue-600">"{excel}"</span> → <span className="text-green-600">{String(supabase)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </div>

            {processStep === 4 && processingResults?.success && (
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
