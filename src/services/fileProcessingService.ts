import { extractBankReport, extractFundPosition, extractClientReconciliation } from './extractionService';
import { excelProcessingService } from './excelProcessingService';
import { databaseService } from './databaseService';
import { intelligentSyncService } from './intelligentSyncService';
import { qualityControlEngine } from './qualityControlEngine';
import { SupabaseRetryService } from './supabaseClientService';
import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';
import { progressService } from './progressService';
import type { ExcelImportDiagnostics, ProcessingResult } from '@/types/processing';
import {
  appendInternalBookProcessingResult,
  detectInternalBookRuntimeFile,
  processInternalBookRuntimeFile,
} from './internalBookRuntimeProcessingService';
import { aggregateBatchSyncResults } from './syncResultAggregator';
export type { ProcessingResult } from '@/types/processing';

export class FileProcessingService {
  async processFiles(files: File[]): Promise<ProcessingResult> {
    const results: ProcessingResult = {
      success: false,
      data: {
        bankReports: [],
        fundPosition: undefined,
        clientReconciliation: [],
        collectionReports: [],
        syncResult: undefined
      },
      errors: []
    };

    // ⭐ TIMEOUT DE SÉCURITÉ ÉTENDU - 15 minutes au lieu de 5
    const processingTimeout = setTimeout(() => {
      console.warn('⚠️ TIMEOUT: Le traitement prend trop de temps (15 minutes)');
      progressService.errorStep('timeout', 'Timeout', 'Le traitement a pris trop de temps', 'Timeout de 15 minutes atteint');
    }, 15 * 60 * 1000); // 15 minutes

    try {
      console.log('🚀 DÉBUT TRAITEMENT FICHIERS - Mode Optimisé avec Timeouts Étendus');
      console.log('📁 Fichiers reçus:', files.map(f => f.name));
      
      // ⭐ DÉMARRAGE DU HEARTBEAT
      const { HeartbeatService } = await import('./supabaseClientService');
      HeartbeatService.start();
      
      progressService.updateOverallProgress(0);
      
      // ⭐ DÉTECTION INTELLIGENTE DES TYPES DE FICHIERS
      progressService.startStep('file_detection', 'Détection des fichiers', 'Analyse des types de fichiers');
      
    const categorizedFiles = await this.categorizeFiles(files);
      
      progressService.completeStep('file_detection', 'Détection des fichiers', 'Types de fichiers identifiés', 
        `${files.length} fichiers analysés`);
      
      console.log('🔍 Fichiers catégorisés:', {
        internalBooks: categorizedFiles.internalBooks.length,
        collectionReports: categorizedFiles.collectionReports.length,
        bankReports: categorizedFiles.bankReports.length,
        fundPosition: categorizedFiles.fundPosition ? 'Oui' : 'Non',
        clientReconciliation: categorizedFiles.clientReconciliation ? 'Oui' : 'Non'
      });

      // ⭐ DÉTECTER LE TYPE DE TRAITEMENT
      const hasCollectionReport = categorizedFiles.collectionReports.length > 0;
      const hasBankStatements = categorizedFiles.bankReports.length > 0;
      const hasFundPosition = !!categorizedFiles.fundPosition;
      const hasClientReconciliation = !!categorizedFiles.clientReconciliation;
      const hasInternalBooks = categorizedFiles.internalBooks.length > 0;

      console.log('🔍 Type de traitement détecté:');
      console.log(`  - Internal Book: ${hasInternalBooks ? '✅' : '❌'}`);
      console.log(`  - Collection Report: ${hasCollectionReport ? '✅' : '❌'}`);
      console.log(`  - Relevés bancaires: ${hasBankStatements ? '✅' : '❌'}`);
      console.log(`  - Fund Position: ${hasFundPosition ? '✅' : '❌'}`);
      console.log(`  - Client Reconciliation: ${hasClientReconciliation ? '✅' : '❌'}`);

      if (hasInternalBooks) {
        progressService.startStep('internal_book_processing', 'Internal Book', 'Traitement des fichiers Internal Book');

        for (const internalBookFile of categorizedFiles.internalBooks) {
          const runtimeResult = await processInternalBookRuntimeFile(internalBookFile);
          appendInternalBookProcessingResult(results, runtimeResult);
        }

        progressService.completeStep('internal_book_processing', 'Internal Book', 'Traitement Internal Book terminé',
          `${categorizedFiles.internalBooks.length} fichier(s) traité(s)`);
      }

      // 1. ⭐ TRAITEMENT OPTIMISÉ DU COLLECTION REPORT
      if (hasCollectionReport) {
        progressService.startStep('excel_processing', 'Traitement Excel', 'Extraction des données du fichier Excel');
        
        console.log('🧠 === DÉBUT ANALYSE ET ENRICHISSEMENT INTELLIGENT OPTIMISÉ ===');
        console.log('📁 Fichiers:', categorizedFiles.collectionReports.map(f => f.name).join(', '));
        
        progressService.updateStepProgress('excel_processing', 'Traitement Excel', 'Lecture et conversion du fichier', 25, 
          `Traitement de ${categorizedFiles.collectionReports.length} fichier(s) Excel`);
        
        // Traiter tous les fichiers de collection
        let allCollections: CollectionReport[] = [];

        // ⭐ PACK-B2 : diagnostics d'import Excel exposés dans le résultat (auditabilité).
        // Les erreurs Excel en succès partiel restent hors de results.errors pour ne pas
        // changer la règle de succès globale.
        const excelImportDiagnostics: ExcelImportDiagnostics = {
          files_processed: 0,
          collections_extracted: 0,
          excel_errors: [],
          excel_warnings: []
        };
        results.data!.excelImportDiagnostics = excelImportDiagnostics;

        for (const collectionFile of categorizedFiles.collectionReports) {
          progressService.updateStepProgress('excel_processing', 'Traitement Excel',
            `Traitement de ${collectionFile.name}`, 25 + (50 * categorizedFiles.collectionReports.indexOf(collectionFile) / categorizedFiles.collectionReports.length));

          // ⭐ EXTRACTION EXCEL AVEC RETRY
          const excelResult = await SupabaseRetryService.executeWithRetry(
            () => excelProcessingService.processCollectionReportExcel(collectionFile),
            { maxRetries: 3 },
            `Extraction Excel - ${collectionFile.name}`
          );

          excelImportDiagnostics.files_processed++;
          for (const message of excelResult.errors ?? []) {
            excelImportDiagnostics.excel_errors.push({ file: collectionFile.name, message });
          }
          for (const message of excelResult.warnings ?? []) {
            excelImportDiagnostics.excel_warnings.push({ file: collectionFile.name, message });
          }

          if (excelResult.success && excelResult.data) {
            allCollections = [...allCollections, ...excelResult.data];
            excelImportDiagnostics.collections_extracted += excelResult.data.length;
          } else {
            const errorMsg = `Erreur traitement Excel ${collectionFile.name}: ${excelResult.errors?.join(', ') || 'Erreur inconnue'}`;
            console.error('❌', errorMsg);
            results.errors?.push(errorMsg);
            if (!excelResult.errors || excelResult.errors.length === 0) {
              excelImportDiagnostics.excel_errors.push({ file: collectionFile.name, message: 'Erreur inconnue' });
            }
          }
        }
        
        if (allCollections.length === 0) {
          const errorMsg = 'Aucune collection extraite des fichiers Excel';
          progressService.errorStep('excel_processing', 'Traitement Excel', 'Échec de l\'extraction', errorMsg);
          results.errors?.push(errorMsg);
        } else {
          progressService.updateStepProgress('excel_processing', 'Traitement Excel', 'Extraction en cours', 60, 
            `${allCollections.length} collections extraites`);
          
          console.log(`📊 ${allCollections.length} collections extraites des fichiers Excel`);
          
          // ⭐ ANALYSE INTELLIGENTE AVEC RETRY
          progressService.startStep('intelligent_analysis', 'Analyse Intelligente', 'Comparaison avec la base de données');
          
          console.log('🧠 === DÉBUT ANALYSE INTELLIGENTE ===');
          const analysisResult = await SupabaseRetryService.executeWithRetry(
            () => intelligentSyncService.analyzeExcelFile(allCollections),
            { maxRetries: 3 },
            'Analyse Intelligente'
          );
          
          progressService.updateStepProgress('intelligent_analysis', 'Analyse Intelligente', 'Analyse des doublons et enrichissements', 80,
            `${analysisResult.length} collections analysées`);
          
          // ⭐ SYNCHRONISATION INTELLIGENTE PAR BATCH
          progressService.startStep('intelligent_sync', 'Synchronisation Intelligente', 'Application des enrichissements par batch');
          
          console.log('🔄 === DÉBUT SYNCHRONISATION INTELLIGENTE PAR BATCH ===');
          
          // Utiliser le traitement par batch pour la synchronisation
          const { BatchProcessingService } = await import('./batchProcessingService');
          
          const batchSyncResult = await BatchProcessingService.processCollectionsBatch(
            allCollections,
            async (batch) => {
              // Analyser le batch
              const batchAnalysis = await intelligentSyncService.analyzeExcelFile(batch);
              // Synchroniser le batch
              return await intelligentSyncService.processIntelligentSync(batchAnalysis);
            },
            {
              batchSize: 50,
              pauseBetweenBatchesMs: 300,
              enableProgressTracking: true
            },
            'intelligent_sync'
          );
          
          // ⭐ AGRÉGATION DES RÉSULTATS BATCH (résultats de lots + erreurs top-level)
          const syncResult = aggregateBatchSyncResults(batchSyncResult.results, batchSyncResult.errors);
          
          progressService.completeStep('excel_processing', 'Traitement Excel', 'Extraction terminée', 
            `${allCollections.length} collections extraites`);
          
          progressService.completeStep('intelligent_analysis', 'Analyse Intelligente', 'Analyse terminée', 
            `${analysisResult.filter(a => a.status === 'NEW').length} nouvelles, ${analysisResult.filter(a => a.status === 'EXISTS_INCOMPLETE').length} à enrichir`);
          
          // ⭐ STOCKAGE DES RÉSULTATS
          results.data!.collectionReports = allCollections;
          results.data!.syncResult = syncResult;
          
          console.log('✅ === RÉSUMÉ SYNCHRONISATION INTELLIGENTE PAR BATCH ===');
          console.log(`📊 Collections analysées: ${allCollections.length}`);
          console.log(`✅ Ajoutées réellement: ${syncResult.new_collections}`);
          console.log(`♻️ Mises à jour idempotentes: ${syncResult.idempotent_updates}`);
          console.log(`⚡ Enrichies: ${syncResult.enriched_collections}`);
          console.log(`🔒 Ignorées / préservées: ${syncResult.ignored_collections}`);
          console.log(`❌ Erreurs: ${syncResult.errors.length}`);
          console.log(`⏱️ Temps de traitement: ${Math.round(batchSyncResult.processingTime/1000)}s`);
          
          // ⭐ AJOUTER LES ERREURS AU RÉSULTAT GLOBAL
          if (syncResult.errors.length > 0) {
            const errorMessages = syncResult.errors.map(e => `${e.collection?.clientCode ?? 'INCONNU'}: ${e.error}`);
            results.errors?.push(...errorMessages);
          }
        }
      } else {
        console.log('ℹ️ Aucun Collection Report fourni, traitement des autres documents uniquement');
      }

      // 2. ⭐ NOUVEAU : TRAITEMENT DES RAPPORTS D'ANALYSE BANCAIRES
      if (hasBankStatements) {
        progressService.startStep('bank_analysis', 'Rapports Bancaires', 'Traitement des relevés bancaires');
        
        console.log('🏦 === DÉBUT TRAITEMENT RELEVÉS BANCAIRES ===');
        const bankReports = await this.processBankReports(categorizedFiles.bankReports);
        
        if (bankReports.length > 0) {
          results.data!.bankReports = bankReports;
          
          // Sauvegarde en base
          for (const report of bankReports) {
            const saveResult = await databaseService.saveBankReport(report);
            if (!saveResult.success) {
              results.errors?.push(`Erreur sauvegarde ${report.bank}: ${saveResult.error}`);
            }
          }
          
          progressService.completeStep('bank_analysis', 'Relevés Bancaires', 'Relevés bancaires traités',
            `${bankReports.length} relevés bancaires traités`);
        } else {
          progressService.errorStep('bank_analysis', 'Relevés Bancaires', 'Aucun relevé traité', 
            'Aucun relevé bancaire n\'a pu être traité');
        }
      }

      // 3. ⭐ TRAITEMENT CONDITIONNEL FUND POSITION
      if (hasFundPosition) {
        progressService.startStep('fund_position', 'Fund Position', 'Calcul de la position des fonds');
        
        console.log('💰 Extraction Fund Position...');
        const fundPosition = await this.processFundPosition(categorizedFiles.fundPosition!, results.data!.collectionReports);
        if (fundPosition) {
          results.data!.fundPosition = fundPosition;
          const saveResult = await databaseService.saveFundPosition(fundPosition);
          if (!saveResult.success) {
            results.errors?.push(`Erreur sauvegarde Fund Position: ${saveResult.error}`);
          }
        }
        
        progressService.completeStep('fund_position', 'Fund Position', 'Position calculée');
      }

      // 4. ⭐ TRAITEMENT CONDITIONNEL CLIENT RECONCILIATION
      if (hasClientReconciliation) {
        progressService.startStep('client_reconciliation', 'Réconciliation Client', 'Calcul des réconciliations clients');
        
        console.log('👥 Extraction Client Reconciliation...');
        const clientRecon = await this.processClientReconciliation(categorizedFiles.clientReconciliation!);
        results.data!.clientReconciliation = clientRecon;
        
        progressService.completeStep('client_reconciliation', 'Réconciliation Client', 'Réconciliations calculées',
          `${clientRecon.length} clients traités`);
      }

      // ⭐ FINALISATION OPTIMISÉE
      progressService.updateOverallProgress(100);
      results.success = results.errors?.length === 0;
      
      console.log(`\n🎯 === RÉSUMÉ FINAL TRAITEMENT OPTIMISÉ ===`);
      console.log(`✅ Succès: ${results.success}`);
      console.log(`📊 Collections: ${results.data!.collectionReports?.length || 0}`);
      console.log(`🏦 Relevés bancaires: ${results.data!.bankReports.length}`);
      console.log(`💰 Fund Position: ${results.data!.fundPosition ? '✅' : '❌'}`);
      console.log(`👥 Client Reconciliation: ${results.data!.clientReconciliation?.length || 0}`);
      console.log(`❌ Erreurs: ${results.errors?.length || 0}`);
      
      if (hasCollectionReport && results.data!.syncResult) {
        console.log(`🧠 Enrichissement intelligent réussi !`);
      }
      if (hasBankStatements) {
        console.log(`🏦 Relevés bancaires intégrés !`);
      }

      // ⭐ ARRÊT DU HEARTBEAT
      HeartbeatService.stop();
      clearTimeout(processingTimeout);
      return results;

    } catch (error) {
      console.error('❌ ERREUR CRITIQUE GÉNÉRALE:', error);
      progressService.errorStep('general_error', 'Erreur Critique', 'Échec du traitement', 
        error instanceof Error ? error.message : 'Erreur inconnue');
      results.errors?.push(error instanceof Error ? error.message : 'Erreur inconnue');
      
      // ⭐ NETTOYAGE EN CAS D'ERREUR
      const { HeartbeatService } = await import('./supabaseClientService');
      HeartbeatService.stop();
      clearTimeout(processingTimeout);
      return results;
    }
  }

  // ⭐ NOUVELLE MÉTHODE : Catégorisation intelligente des fichiers
  private async categorizeFiles(files: File[]): Promise<{
    internalBooks: File[];
    collectionReports: File[];
    bankReports: File[];
    fundPosition: File | null;
    clientReconciliation: File | null;
  }> {
    const categorized = {
      internalBooks: [] as File[],
      collectionReports: [] as File[],
      bankReports: [] as File[],
      fundPosition: null as File | null,
      clientReconciliation: null as File | null
    };
    
    for (const file of files) {
      const internalBookDetection = await detectInternalBookRuntimeFile(file);
      if (internalBookDetection.isInternalBook) {
        categorized.internalBooks.push(file);
        continue;
      }

      const fileType = await this.detectFileTypeDetailed(file);
      
      switch (fileType) {
        case 'COLLECTION_REPORT':
          categorized.collectionReports.push(file);
          break;
        case 'FUND_POSITION':
          // Prendre le plus récent si plusieurs fichiers Fund Position
          if (!categorized.fundPosition || 
              file.lastModified > categorized.fundPosition.lastModified) {
            categorized.fundPosition = file;
          }
          break;
        case 'CLIENT_RECONCILIATION':
          // Prendre le plus récent si plusieurs fichiers Client Reconciliation
          if (!categorized.clientReconciliation || 
              file.lastModified > categorized.clientReconciliation.lastModified) {
            categorized.clientReconciliation = file;
          }
          break;
        case 'BANK_REPORT':
          categorized.bankReports.push(file);
          break;
        default:
          // Pour les fichiers non identifiés, essayer de les traiter comme des relevés bancaires
          categorized.bankReports.push(file);
          break;
      }
    }
    
    return categorized;
  }
  
  // ⭐ NOUVELLE MÉTHODE : Détection détaillée du type de fichier
  private async detectFileTypeDetailed(file: File): Promise<string> {
    const filename = file.name.toUpperCase();
    
    // Détection basée sur le nom du fichier
    if (filename.includes('COLLECTION') || filename.includes('COLLECT')) {
      return 'COLLECTION_REPORT';
    }
    
    if (filename.includes('FUND') && filename.includes('POSITION') || 
        filename.includes('FP') || filename.includes('FUND_POSITION')) {
      return 'FUND_POSITION';
    }
    
    if (filename.includes('CLIENT') && filename.includes('RECON')) {
      return 'CLIENT_RECONCILIATION';
    }
    
    const bankKeywords = {
      'BDK': ['BDK', 'BANQUE DE DAKAR'],
      'ATB': ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
      'BICIS': ['BICIS', 'BIC'],
      'ORA': ['ORA', 'ORABANK'],
      'SGBS': ['SGBS', 'SOCIETE GENERALE', 'SG'],
      'BIS': ['BIS', 'BANQUE ISLAMIQUE']
    };
    
    for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
      if (keywords.some(keyword => filename.includes(keyword))) {
        return 'BANK_REPORT';
      }
    }
    
    // Si le nom de fichier ne suffit pas, essayer d'analyser le contenu pour Excel
    if (filename.endsWith('.XLSX') || filename.endsWith('.XLS')) {
      try {
        const buffer = await file.arrayBuffer();
        const textContent = await this.extractTextFromExcel(buffer);
        
        // Rechercher des mots-clés dans le contenu
        if (textContent.includes('COLLECTION') || textContent.includes('CLIENT CODE')) {
          return 'COLLECTION_REPORT';
        }
        
        if (textContent.includes('FUND POSITION') || textContent.includes('BOOK BALANCE')) {
          return 'FUND_POSITION';
        }
        
        if (textContent.includes('CLIENT RECONCILIATION')) {
          return 'CLIENT_RECONCILIATION';
        }
        
        for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
          if (keywords.some(keyword => textContent.includes(keyword))) {
            return 'BANK_REPORT';
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur analyse contenu Excel:', error);
      }
    }
    
    // Type par défaut
    return 'UNKNOWN';
  }

  // ⭐ NOUVELLE MÉTHODE : Traitement des rapports bancaires
  private async processBankReports(bankReportFiles: File[]): Promise<BankReport[]> {
    const reports: BankReport[] = [];
    const { bankReportProcessingService } = await import('./bankReportProcessingService');
    
    console.log(`🏦 Traitement de ${bankReportFiles.length} relevés bancaires...`);
    
    for (const file of bankReportFiles) {
      console.log(`📄 Traitement du relevé: ${file.name}`);
      
      try {
        const processingResult = await bankReportProcessingService.processBankReportExcel(file);
        
        if (processingResult.success && processingResult.data) {
          console.log(`✅ Rapport ${processingResult.bankType} traité avec succès`);
          console.log(`📊 ${bankReportProcessingService.getBankReportSummary(processingResult.data)}`);
          
          // Validation du rapport
          const warnings = await bankReportProcessingService.validateBankReport(processingResult.data);
          if (warnings.length > 0) {
            console.warn(`⚠️ Avertissements pour ${processingResult.bankType}:`, warnings);
          }
          
          reports.push(processingResult.data);
        } else {
          console.error(`❌ Échec traitement ${file.name}:`, processingResult.errors);
        }
      } catch (error) {
        console.error(`❌ Erreur traitement ${file.name}:`, error);
      }
    }
    
    console.log(`📊 ${reports.length} relevés bancaires traités au total`);
    return reports;
  }

  // ⭐ TRAITEMENT FUND POSITION
  private async processFundPosition(file: File, currentCollections?: CollectionReport[]): Promise<FundPosition | null> {
    try {
      console.log('💰 === TRAITEMENT DÉTAILLÉ FUND POSITION ===');
      
      // Extraire le contenu du fichier
      const buffer = await file.arrayBuffer();
      let textContent = '';
      
      // Extraction du contenu selon le type de fichier
      if (file.name.toLowerCase().endsWith('.pdf')) {
        textContent = await this.extractTextFromPDF(buffer);
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        textContent = await this.extractTextFromExcel(buffer);
      } else {
        console.warn('⚠️ Format de fichier non supporté pour Fund Position');
        return null;
      }
      
      if (!textContent || textContent.length < 100) {
        console.warn('⚠️ Contenu textuel insuffisant extrait du fichier Fund Position');
        return null;
      }
      
      console.log(`📄 Contenu extrait: ${textContent.length} caractères`);
      
      // Utiliser le service d'extraction pour analyser le contenu
      const { extractFundPosition } = await import('./extractionService');
      const extractionResult = extractFundPosition(textContent);

      if (!extractionResult.success || !extractionResult.data) {
        console.error('❌ Échec de l\'extraction du Fund Position:', extractionResult.errors);
        return null;
      }
      
      const fundPosition = extractionResult.data;
      
      console.log('📊 === FUND POSITION EXTRAITE ===');
      console.log(`📅 Date: ${fundPosition.reportDate}`);
      console.log(`💰 Total fonds disponibles: ${fundPosition.totalFundAvailable.toLocaleString()}`);
      console.log(`📤 Collections non déposées: ${fundPosition.collectionsNotDeposited.toLocaleString()}`);
      console.log(`🎯 Grand total: ${fundPosition.grandTotal.toLocaleString()}`);
      console.log(`📊 Détails par banque: ${fundPosition.details?.length || 0} banques`);
      console.log(`📋 Collections en attente: ${fundPosition.holdCollections?.length || 0} items`);
      
      return fundPosition;
      
    } catch (error) {
      console.error('❌ Erreur calcul Fund Position:', error);
      return null;
    }
  }

  private async processClientReconciliation(file: File): Promise<ClientReconciliation[]> {
    // ⭐ Créer une réconciliation client basée sur les données réelles
    try {
      console.log('👥 Calcul Client Reconciliation basée sur les impayés des rapports bancaires...');

      // 1. Récupérer les rapports bancaires avec leurs impayés
      const bankReports = await databaseService.getLatestBankReports();

      console.log('🔍 Rapports bancaires récupérés:', bankReports.length);

      // 2. Agréger les impayés par client avec leurs noms
      const clientImpayes = new Map<string, {
        amount: number;
        clientName: string;
      }>();

      bankReports.forEach(report => {
        console.log(`🏦 Analyse rapport ${report.bank} du ${report.date}:`, {
          impayes: report.impayes.length,
          solde: report.closingBalance
        });

        report.impayes.forEach(impaye => {
          const clientCode = impaye.clientCode;
          // Extraire le nom du client depuis la description de l'impayé
          const clientName = this.extractClientName(impaye.description || '', clientCode);

          console.log(`  ❌ Impayé trouvé: Client ${clientCode} (${clientName}), Montant: ${impaye.montant.toLocaleString()} FCFA, Date: ${impaye.dateEcheance}`);

          const current = clientImpayes.get(clientCode) || { amount: 0, clientName };
          const newAmount = current.amount + impaye.montant;
          console.log(`  💰 Montant cumulé pour ${clientCode}: ${current.amount} + ${impaye.montant} = ${newAmount}`);

          clientImpayes.set(clientCode, {
            amount: newAmount,
            clientName: clientName
          });
        });
      });

      console.log(`👥 Impayés trouvés pour ${clientImpayes.size} clients:`);
      clientImpayes.forEach((data, clientCode) => {
        console.log(`  - ${clientCode} (${data.clientName}): ${data.amount.toLocaleString()} FCFA`);
      });

      // 3. Créer les réconciliations client avec les montants d'impayés réels et les noms de clients
      const clientReconciliations: ClientReconciliation[] = [];

      // Ajouter les clients avec impayés
      for (const [clientCode, data] of clientImpayes.entries()) {
        console.log(`👤 Ajout client avec impayés: ${clientCode} (${data.clientName}) - ${data.amount.toLocaleString()} FCFA`);
        clientReconciliations.push({
          reportDate: new Date().toISOString().split('T')[0],
          clientCode: clientCode,
          clientName: data.clientName,
          impayesAmount: data.amount
        });
      }

      // Ajouter également les clients sans impayés depuis les collections
      const clientsData = await databaseService.getClientsWithCollections();
      for (const client of clientsData) {
        // Ne pas dupliquer les clients déjà ajoutés avec impayés
        if (!clientImpayes.has(client.clientCode)) {
          console.log(`👤 Ajout client sans impayés: ${client.clientCode}`);
          clientReconciliations.push({
            reportDate: new Date().toISOString().split('T')[0],
            clientCode: client.clientCode,
            clientName: client.clientName || `Client ${client.clientCode}`,
            impayesAmount: 0 // Client sans impayés
          });
        }
      }

      console.log('👥 Client Reconciliation calculée:', clientReconciliations.length, 'clients');
      console.log('📊 Échantillon des réconciliations calculées:');
      clientReconciliations.slice(0, 5).forEach(reconciliation => {
        console.log(`  - ${reconciliation.clientCode} (${reconciliation.clientName}): ${reconciliation.impayesAmount.toLocaleString()} FCFA`);
      });

      // Vérifier s'il y a des montants non nuls
      const nonZeroReconciliations = clientReconciliations.filter(r => r.impayesAmount > 0);
      console.log(`📊 Réconciliations avec montants non nuls: ${nonZeroReconciliations.length}`);
      nonZeroReconciliations.forEach(reconciliation => {
        console.log(`  - ${reconciliation.clientCode} (${reconciliation.clientName}): ${reconciliation.impayesAmount.toLocaleString()} FCFA`);
      });
      return clientReconciliations;
    } catch (error) {
      console.error('❌ Erreur calcul Client Reconciliation:', error);
      return [];
    }
  }

  /**
   * Extrait un nom de client propre à partir de la description d'un impayé
   * en supprimant les mots-clés comme "EFFET", "IMPAYE", etc.
   */
  private extractClientName(description: string, clientCode: string): string {
    if (!description || description.trim() === '') {
      return `Client ${clientCode}`;
    }

    // Nettoyer la description
    const cleanName = description.trim()
      // Supprimer les mots-clés courants qui ne font pas partie du nom
      .replace(/\b(EFFET|IMPAYE|CHEQUE|IMPAYÉ|BOUNCED|RETURNED|CHQ|FACTURE|INVOICE)\b/gi, '')
      // Supprimer les codes de banque
      .replace(/\b(BDK|ATB|BICIS|ORA|SGBS|SGS|BIS)\b/g, '')
      // Supprimer les numéros et dates
      .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
      .replace(/\b\d+\b/g, '')
      // Supprimer les caractères spéciaux et espaces multiples
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Si après nettoyage il ne reste rien de significatif, utiliser le code client
    if (!cleanName || cleanName.length < 3) {
      return `Client ${clientCode}`;
    }

    return cleanName;
  }
  
  // Méthodes d'extraction de contenu à partir de fichiers
  private async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    try {
      // Import pdfjs-dist for browser-compatible PDF parsing
      const pdfjsLib = await import('pdfjs-dist');
      
      // Set worker source for PDF.js
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
      
      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      
      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: { str?: string }) => item.str ?? '')
          .join(' ');
        fullText += pageText + '\n';
      }
      
      console.log(`📄 PDF text extracted: ${fullText.length} characters`);
      return fullText;
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      // Fallback: return empty string but log the error
      console.warn('⚠️ PDF extraction failed, returning empty content');
      return '';
    }
  }
  
  private async extractTextFromExcel(buffer: ArrayBuffer): Promise<string> {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      let allText = '';
      
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        
        for (const row of sheetData) {
          if (Array.isArray(row)) {
            allText += row.join(' ') + '\n';
          }
        }
      }
      
      return allText;
    } catch (error) {
      console.error('❌ Erreur extraction Excel:', error);
      return '';
    }
  }
}

export const fileProcessingService = new FileProcessingService();
