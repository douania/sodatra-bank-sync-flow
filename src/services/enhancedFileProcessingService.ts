import { extractBankReport, extractFundPosition, extractClientReconciliation } from './extractionService';
import { excelProcessingService } from './excelProcessingService';
import { databaseService } from './databaseService';
import { intelligentSyncService } from './intelligentSyncService';
import { qualityControlEngine } from './qualityControlEngine';
import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';
import { progressService } from './progressService';
import * as XLSX from 'xlsx';

export interface ProcessingResult {
  success: boolean;
  data?: {
    bankReports: BankReport[];
    fundPosition?: FundPosition;
    clientReconciliation?: ClientReconciliation[];
    collectionReports?: CollectionReport[];
    syncResult?: any;
  };
  errors?: string[];
  debugInfo?: any;
}

export interface FileDetectionResult {
  file: File;
  detectedType: string;
  confidence: 'high' | 'medium' | 'low';
  bankType?: string;
}

export class EnhancedFileProcessingService {
  
  /**
   * Détecte automatiquement le type d'un fichier basé sur son nom et son contenu
   */
  async detectFileType(file: File): Promise<FileDetectionResult> {
    const filename = file.name.toUpperCase();
    const extension = file.name.toLowerCase().split('.').pop();

    // Détection du Collection Report
    if (filename.includes('COLLECTION') && filename.includes('REPORT') && (extension === 'xlsx' || extension === 'xls')) {
      return {
        file,
        detectedType: 'collectionReport',
        confidence: 'high'
      };
    }

    // Détection des banques
    const bankPatterns = [
      { keywords: ['BDK', 'BANQUE DE DAKAR'], code: 'BDK' },
      { keywords: ['ATB', 'ATLANTIQUE', 'ARAB TUNISIAN'], code: 'ATB' }, 
      { keywords: ['BICIS', 'BIC'], code: 'BICIS' }, 
      { keywords: ['ORA', 'ORABANK'], code: 'ORA' }, 
      { keywords: ['SGS', 'SOCIETE GENERALE', 'SGBS'], code: 'SGS' }, 
      { keywords: ['BIS', 'BANQUE ISLAMIQUE'], code: 'BIS' } 
    ];

    for (const pattern of bankPatterns) {
      if (pattern.keywords.some(keyword => filename.includes(keyword))) {
        // Distinguer rapport d'analyse vs relevé bancaire
        if (filename.includes('ONLINE') || filename.includes('STATEMENT') || filename.includes('RELEVE')) {
          return {
            file,
            detectedType: 'bankStatement',
            confidence: 'high',
            bankType: `${pattern.code} Relevé`
          };
        } else {
          return {
            file,
            detectedType: 'bankAnalysis',
            confidence: 'high',
            bankType: `${pattern.code} Rapport`
          };
        }
      }
    }

    // Détection Fund Position
    if (filename.includes('FUND') && filename.includes('POSITION')) {
      return {
        file,
        detectedType: 'fundsPosition',
        confidence: 'high'
      };
    }

    // Détection Client Reconciliation
    if (filename.includes('CLIENT') && filename.includes('RECONCILIATION')) {
      return {
        file,
        detectedType: 'clientReconciliation',
        confidence: 'high'
      };
    }

    // Détection par analyse du contenu pour les fichiers Excel
    if (extension === 'xlsx' || extension === 'xls') {
      try {
        const contentAnalysis = await this.analyzeExcelContent(file);
        if (contentAnalysis.detectedType !== 'unknown') {
          return {
            file,
            detectedType: contentAnalysis.detectedType,
            confidence: contentAnalysis.confidence,
            bankType: contentAnalysis.bankType
          };
        }
      } catch (error) {
        console.warn('Erreur lors de l\'analyse du contenu Excel:', error);
      }
    }

    // Détection par analyse du contenu pour les fichiers PDF
    if (extension === 'pdf') {
      try {
        const contentAnalysis = await this.analyzePDFContent(file);
        if (contentAnalysis.detectedType !== 'unknown') {
          return {
            file,
            detectedType: contentAnalysis.detectedType,
            confidence: contentAnalysis.confidence,
            bankType: contentAnalysis.bankType
          };
        }
      } catch (error) {
        console.warn('Erreur lors de l\'analyse du contenu PDF:', error);
      }
    }

    // Type non détecté
    return {
      file,
      detectedType: 'unknown',
      confidence: 'low'
    };
  }

  /**
   * Analyse le contenu d'un fichier Excel pour détecter son type
   */
  private async analyzeExcelContent(file: File): Promise<{ detectedType: string; confidence: 'high' | 'medium' | 'low'; bankType?: string }> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];

    // Convertir en texte pour analyse
    const textContent = data.flat().join(' ').toUpperCase();

    // Rechercher des patterns spécifiques
    if (textContent.includes('COLLECTION') && textContent.includes('AMOUNT') && textContent.includes('CLIENT')) {
      return { detectedType: 'collectionReport', confidence: 'high' };
    }

    if (textContent.includes('FUND') && textContent.includes('POSITION')) {
      return { detectedType: 'fundsPosition', confidence: 'high' };
    }

    if (textContent.includes('RECONCILIATION') && textContent.includes('CLIENT')) {
      return { detectedType: 'clientReconciliation', confidence: 'high' };
    }

    // Rechercher des patterns bancaires
    const bankPatterns = [
      { keywords: ['BDK', 'BANQUE DE DAKAR'], code: 'BDK' },
      { keywords: ['ATB', 'ATLANTIQUE'], code: 'ATB' },
      { keywords: ['BICIS'], code: 'BICIS' },
      { keywords: ['ORABANK'], code: 'ORA' },
      { keywords: ['SOCIETE GENERALE', 'SGBS'], code: 'SGS' },
      { keywords: ['BANQUE ISLAMIQUE'], code: 'BIS' }
    ];

    for (const pattern of bankPatterns) {
      if (pattern.keywords.some(keyword => textContent.includes(keyword))) {
        if (textContent.includes('BALANCE') || textContent.includes('SOLDE')) {
          return { detectedType: 'bankAnalysis', confidence: 'medium', bankType: pattern.code };
        }
      }
    }

    return { detectedType: 'unknown', confidence: 'low' };
  }

  /**
   * Analyse le contenu d'un fichier PDF pour détecter son type
   */
  private async analyzePDFContent(file: File): Promise<{ detectedType: string; confidence: 'high' | 'medium' | 'low'; bankType?: string }> {
    // Pour l'instant, on utilise une analyse basique basée sur le nom
    // Dans une implémentation complète, on utiliserait une bibliothèque PDF
    const filename = file.name.toUpperCase();

    if (filename.includes('FUND') && filename.includes('POSITION')) {
      return { detectedType: 'fundsPosition', confidence: 'high' };
    }

    if (filename.includes('CLIENT') && filename.includes('RECONCILIATION')) {
      return { detectedType: 'clientReconciliation', confidence: 'high' };
    }

    // Patterns bancaires
    const bankPatterns = [
      { keywords: ['BDK'], code: 'BDK' },
      { keywords: ['ATB'], code: 'ATB' },
      { keywords: ['BICIS'], code: 'BICIS' },
      { keywords: ['ORA'], code: 'ORA' },
      { keywords: ['SGS'], code: 'SGS' },
      { keywords: ['BIS'], code: 'BIS' }
    ];

    for (const pattern of bankPatterns) {
      if (pattern.keywords.some(keyword => filename.includes(keyword))) {
        return { detectedType: 'bankAnalysis', confidence: 'medium', bankType: pattern.code };
      }
    }

    return { detectedType: 'unknown', confidence: 'low' };
  }

  /**
   * Traite un tableau de fichiers avec détection automatique
   */
  async processFilesArray(files: File[]): Promise<ProcessingResult> {
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

    // Timeout de sécurité étendu
    const processingTimeout = setTimeout(() => {
      console.warn('⚠️ TIMEOUT: Le traitement prend trop de temps (15 minutes)');
      progressService.errorStep('timeout', 'Timeout', 'Le traitement a pris trop de temps', 'Timeout de 15 minutes atteint');
    }, 15 * 60 * 1000);

    try {
      console.log('🚀 DÉBUT TRAITEMENT FICHIERS EN MASSE - Mode Détection Automatique');
      console.log('📁 Nombre de fichiers reçus:', files.length);

      // Démarrage du heartbeat
      const { HeartbeatService } = await import('./supabaseClientService');
      HeartbeatService.start();
      
      progressService.updateOverallProgress(0);

      // Phase 1: Détection automatique des types de fichiers
      progressService.startStep('file_detection', 'Détection des Types', 'Analyse automatique des fichiers');
      
      const detectedFiles: FileDetectionResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`🔍 Analyse du fichier ${i + 1}/${files.length}: ${file.name}`);
        
        const detection = await this.detectFileType(file);
        detectedFiles.push(detection);
        
        progressService.updateStepProgress('file_detection', 'Détection des Types', 
          `Analyse de ${file.name}`, 
          Math.round(((i + 1) / files.length) * 100),
          `${detection.detectedType} (${detection.confidence})`);
      }

      progressService.completeStep('file_detection', 'Détection des Types', 'Détection terminée',
        `${detectedFiles.length} fichiers analysés`);

      // Organiser les fichiers par type
      const organizedFiles = this.organizeDetectedFiles(detectedFiles);
      
      console.log('📊 Résumé de la détection:');
      Object.entries(organizedFiles).forEach(([type, fileList]) => {
        console.log(`  - ${type}: ${fileList.length} fichier(s)`);
      });

      // Phase 2: Traitement des fichiers organisés
      await this.processOrganizedFiles(organizedFiles, results);

      // Finalisation
      progressService.updateOverallProgress(100);
      results.success = results.errors?.length === 0;
      
      console.log(`\n🎯 === RÉSUMÉ FINAL TRAITEMENT EN MASSE ===`);
      console.log(`✅ Succès: ${results.success}`);
      console.log(`📊 Collections: ${results.data!.collectionReports?.length || 0}`);
      console.log(`🏦 Rapports bancaires: ${results.data!.bankReports.length}`);
      console.log(`💰 Fund Position: ${results.data!.fundPosition ? '✅' : '❌'}`);
      console.log(`👥 Client Reconciliation: ${results.data!.clientReconciliation?.length || 0}`);
      console.log(`❌ Erreurs: ${results.errors?.length || 0}`);

      HeartbeatService.stop();
      clearTimeout(processingTimeout);
      return results;

    } catch (error) {
      console.error('❌ ERREUR CRITIQUE GÉNÉRALE:', error);
      progressService.errorStep('general_error', 'Erreur Critique', 'Échec du traitement', 
        error instanceof Error ? error.message : 'Erreur inconnue');
      results.errors?.push(error instanceof Error ? error.message : 'Erreur inconnue');
      
      const { HeartbeatService } = await import('./supabaseClientService');
      HeartbeatService.stop();
      clearTimeout(processingTimeout);
      return results;
    }
  }

  /**
   * Organise les fichiers détectés par type
   */
  private organizeDetectedFiles(detectedFiles: FileDetectionResult[]): { [key: string]: File[] } {
    const organized: { [key: string]: File[] } = {};

    detectedFiles.forEach(detection => {
      let key = detection.detectedType;
      
      // Ajouter le type de banque pour les rapports bancaires
      if (detection.bankType) {
        if (detection.detectedType === 'bankAnalysis') {
          key = `${detection.bankType.toLowerCase()}_analysis`;
        } else if (detection.detectedType === 'bankStatement') {
          key = `${detection.bankType.toLowerCase()}_statement`;
        }
      }

      if (!organized[key]) {
        organized[key] = [];
      }
      organized[key].push(detection.file);
    });

    return organized;
  }

  /**
   * Traite les fichiers organisés par type
   */
  private async processOrganizedFiles(organizedFiles: { [key: string]: File[] }, results: ProcessingResult): Promise<void> {
    const { SupabaseRetryService } = await import('./supabaseClientService');

    // Traitement du Collection Report
    if (organizedFiles.collectionReport && organizedFiles.collectionReport.length > 0) {
      progressService.startStep('excel_processing', 'Traitement Excel', 'Extraction des données du fichier Excel');
      
      const file = organizedFiles.collectionReport[0]; // Prendre le premier fichier
      console.log('🧠 Traitement du Collection Report:', file.name);
      
      const excelResult = await SupabaseRetryService.executeWithRetry(
        () => excelProcessingService.processCollectionReportExcel(file),
        { maxRetries: 3 },
        'Extraction Excel'
      );
      
      if (excelResult.success && excelResult.data) {
        results.data!.collectionReports = excelResult.data;
        
        // Analyse intelligente
        progressService.startStep('intelligent_analysis', 'Analyse Intelligente', 'Comparaison avec la base de données');
        const analysisResult = await intelligentSyncService.analyzeExcelFile(excelResult.data);
        
        // Synchronisation intelligente
        progressService.startStep('intelligent_sync', 'Synchronisation Intelligente', 'Application des enrichissements');
        const syncResult = await intelligentSyncService.processIntelligentSync(analysisResult);
        results.data!.syncResult = syncResult;
        
        progressService.completeStep('excel_processing', 'Traitement Excel', 'Extraction terminée');
        progressService.completeStep('intelligent_analysis', 'Analyse Intelligente', 'Analyse terminée');
        progressService.completeStep('intelligent_sync', 'Synchronisation Intelligente', 'Synchronisation terminée');
      } else {
        results.errors?.push('Erreur traitement Collection Report: ' + (excelResult.errors?.join(', ') || 'Erreur inconnue'));
      }
    }

    // Traitement des rapports d'analyse bancaires
    const bankAnalysisTypes = ['bdk_analysis', 'atb_analysis', 'bicis_analysis', 'ora_analysis', 'sgbs_analysis', 'bis_analysis'];
    for (const analysisType of bankAnalysisTypes) {
      if (organizedFiles[analysisType] && organizedFiles[analysisType].length > 0) {
        const file = organizedFiles[analysisType][0];
        console.log(`🏦 Traitement du rapport d'analyse ${analysisType}:`, file.name);
        
        // Ici, on appellerait le service d'extraction spécialisé pour les rapports d'analyse
        // Pour l'instant, on log juste l'intention
        console.log(`📊 Extraction des données du rapport ${analysisType} - À implémenter`);
      }
    }

    // Traitement des relevés bancaires
    const bankStatementTypes = ['bdk_statement', 'atb_statement', 'bicis_statement', 'ora_statement', 'sgbs_statement', 'bis_statement'];
    const bankReports: BankReport[] = [];
    
    for (const statementType of bankStatementTypes) {
      if (organizedFiles[statementType] && organizedFiles[statementType].length > 0) {
        const file = organizedFiles[statementType][0];
        console.log(`📄 Traitement du relevé bancaire ${statementType}:`, file.name);
        
        try {
          const bankReport = await this.extractBankReportFromFile(file);
          if (bankReport) {
            bankReports.push(bankReport);
            await databaseService.saveBankReport(bankReport);
          }
        } catch (error) {
          results.errors?.push(`Erreur traitement ${statementType}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
      }
    }
    
    results.data!.bankReports = bankReports;

    // Traitement Fund Position
    if (organizedFiles.fundsPosition && organizedFiles.fundsPosition.length > 0) {
      const file = organizedFiles.fundsPosition[0];
      console.log('💰 Traitement Fund Position:', file.name);
      
      try {
        const fundPosition = await this.extractFundPositionFromFile(file);
        if (fundPosition) {
          results.data!.fundPosition = fundPosition;
          await databaseService.saveFundPosition(fundPosition);
        }
      } catch (error) {
        results.errors?.push(`Erreur traitement Fund Position: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      }
    }

    // Traitement Client Reconciliation
    if (organizedFiles.clientReconciliation && organizedFiles.clientReconciliation.length > 0) {
      const file = organizedFiles.clientReconciliation[0];
      console.log('👥 Traitement Client Reconciliation:', file.name);
      
      try {
        const clientRecon = await this.extractClientReconciliationFromFile(file);
        if (clientRecon) {
          results.data!.clientReconciliation = clientRecon;
        }
      } catch (error) {
        results.errors?.push(`Erreur traitement Client Reconciliation: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      }
    }
  }

  /**
   * Extrait les données d'un rapport bancaire à partir d'un fichier
   */
  private async extractBankReportFromFile(file: File): Promise<BankReport | null> {
    try {
      // Extraire le contenu du fichier
      const buffer = await file.arrayBuffer();
      let textContent = '';
      
      // Extraction du contenu selon le type de fichier
      if (file.name.toLowerCase().endsWith('.pdf')) {
        textContent = await this.extractTextFromPDF(buffer);
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        textContent = await this.extractTextFromExcel(buffer);
      } else {
        console.warn('⚠️ Format de fichier non supporté pour rapport bancaire');
        return null;
      }
      
      if (!textContent || textContent.length < 100) {
        console.warn('⚠️ Contenu textuel insuffisant extrait du fichier');
        return null;
      }
      
      // Déterminer le type de banque à partir du nom de fichier
      const bankType = this.detectBankTypeFromFilename(file.name);
      
      // Utiliser le service d'extraction pour analyser le contenu
      const result = extractBankReport(textContent, bankType || 'UNKNOWN');
      
      if (!result.success || !result.data) {
        console.error('❌ Échec de l\'extraction du rapport bancaire:', result.errors);
        return null;
      }
      
      return result.data;
    } catch (error) {
      console.error('❌ Erreur extraction rapport bancaire:', error);
      return null;
    }
  }

  /**
   * Extrait les données de Fund Position à partir d'un fichier
   */
  private async extractFundPositionFromFile(file: File): Promise<FundPosition | null> {
    try {
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
      
      // Utiliser le service d'extraction pour analyser le contenu
      const result = extractFundPosition(textContent);
      
      if (!result.success || !result.data) {
        console.error('❌ Échec de l\'extraction du Fund Position:', result.errors);
        return null;
      }
      
      return result.data;
    } catch (error) {
      console.error('❌ Erreur extraction Fund Position:', error);
      return null;
    }
  }

  /**
   * Extrait les données de Client Reconciliation à partir d'un fichier
   */
  private async extractClientReconciliationFromFile(file: File): Promise<ClientReconciliation[] | null> {
    try {
      // Extraire le contenu du fichier
      const buffer = await file.arrayBuffer();
      let textContent = '';
      
      // Extraction du contenu selon le type de fichier
      if (file.name.toLowerCase().endsWith('.pdf')) {
        textContent = await this.extractTextFromPDF(buffer);
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        textContent = await this.extractTextFromExcel(buffer);
      } else {
        console.warn('⚠️ Format de fichier non supporté pour Client Reconciliation');
        return null;
      }
      
      if (!textContent || textContent.length < 100) {
        console.warn('⚠️ Contenu textuel insuffisant extrait du fichier Client Reconciliation');
        return null;
      }
      
      // Utiliser le service d'extraction pour analyser le contenu
      const result = extractClientReconciliation(textContent);
      
      if (!result.success || !result.data) {
        console.error('❌ Échec de l\'extraction du Client Reconciliation:', result.errors);
        return null;
      }
      
      return result.data;
    } catch (error) {
      console.error('❌ Erreur extraction Client Reconciliation:', error);
      return null;
    }
  }

  /**
   * Détecte le type de banque à partir du nom de fichier
   */
  private detectBankTypeFromFilename(filename: string): string | null {
    const upperFilename = filename.toUpperCase();
    
    const bankKeywords = {
      'BDK': ['BDK', 'BANQUE DE DAKAR'],
      'ATB': ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
      'BICIS': ['BICIS', 'BIC'],
      'ORA': ['ORA', 'ORABANK'],
      'SGBS': ['SGBS', 'SOCIETE GENERALE', 'SG', 'SGS'],
      'BIS': ['BIS', 'BANQUE ISLAMIQUE']
    };
    
    for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
      if (keywords.some(keyword => upperFilename.includes(keyword))) {
        return bankCode;
      }
    }
    
    return null;
  }

  /**
   * Extrait le texte d'un fichier PDF
   */
  private async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    try {
      // Import pdfjs-dist for browser-compatible PDF parsing
      const pdfjsLib = await import('pdfjs-dist');
      
      // Set worker source for PDF.js
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;
      
      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      
      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
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

  /**
   * Extrait le texte d'un fichier Excel
   */
  private async extractTextFromExcel(buffer: ArrayBuffer): Promise<string> {
    try {
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

  /**
   * Méthode de compatibilité avec l'ancienne interface
   */
  async processFiles(files: { [key: string]: File }): Promise<ProcessingResult> {
    // Convertir l'objet en tableau
    const fileArray = Object.values(files).filter(file => file !== null && file !== undefined);
    return this.processFilesArray(fileArray);
  }
}

// Instance singleton
export const enhancedFileProcessingService = new EnhancedFileProcessingService();