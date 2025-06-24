import * as XLSX from 'xlsx';
import { CollectionReport } from '@/types/banking';
import { excelMappingService } from './excelMappingService';

export interface ExcelProcessingResult {
  success: boolean;
  data?: CollectionReport[];
  errors?: string[];
  totalRows?: number;
  processedRows?: number;
  debugInfo?: {
    detectedHeaders: string[];
    sampleRows: any[];
    mappingResults: { [key: string]: any };
    columnAnalysis: {
      recognized: string[];
      unrecognized: string[];
      mapping: { [key: string]: string };
    };
    problemRows?: Array<{
      rowNumber: number;
      data: any;
      error: string;
    }>;
    fullDiagnosis?: {
      totalExcelRows: number;
      rows2024Count: number;
      rows2025Count: number;
      validRows2024: number;
      validRows2025: number;
      transformedRows2024: number;
      transformedRows2025: number;
      rejectionReasons: { [reason: string]: number };
      sampleValidCollections2024: any[];
      sampleValidCollections2025: any[];
      sampleInvalidRows: any[];
    };
  };
}

export class ExcelProcessingService {

  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('🚀 DÉBUT TRAITEMENT EXCEL COMPLET - Fichier:', file.name, 'Taille:', file.size, 'bytes');
      
      // Lire le fichier Excel
      const arrayBuffer = await file.arrayBuffer();
      console.log('📁 ArrayBuffer créé, taille:', arrayBuffer.byteLength);
      
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      console.log('📊 Workbook lu, feuilles disponibles:', workbook.SheetNames);
      
      // Prendre la première feuille
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      console.log('📋 Traitement de la feuille:', firstSheetName);
      
      // Convertir en JSON avec en-têtes
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      console.log('🔄 Conversion JSON terminée, nombre de lignes TOTAL:', jsonData.length);
      
      if (jsonData.length < 2) {
        console.error('❌ Fichier invalide - pas assez de données');
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins une ligne d\'en-tête et une ligne de données']
        };
      }

      // Extraire les en-têtes (première ligne)
      const headers = jsonData[0] as string[];
      const allDataRows = jsonData.slice(1) as any[][];
      
      console.log('📋 EN-TÊTES DÉTECTÉS:', headers);
      console.log('📊 NOMBRE TOTAL DE LIGNES DE DONNÉES:', allDataRows.length);

      // ⭐ DIAGNOSTIC COMPLET DES DONNÉES
      const fullDiagnosis = await this.performFullDiagnosis(headers, allDataRows);
      console.log('🔍 DIAGNOSTIC COMPLET:', fullDiagnosis);

      // ⭐ ANALYSE DES COLONNES AVEC LE NOUVEAU MAPPER
      const columnAnalysis = excelMappingService.analyzeExcelColumns(headers);
      console.log('🗺️ ANALYSE DES COLONNES:', columnAnalysis);

      if (columnAnalysis.recognized.length === 0) {
        console.error('❌ Aucune colonne reconnue dans le fichier Excel');
        return {
          success: false,
          errors: [`Aucune colonne reconnue. Colonnes détectées: ${headers.join(', ')}`],
          debugInfo: {
            detectedHeaders: headers,
            sampleRows: [],
            mappingResults: {},
            columnAnalysis,
            fullDiagnosis
          }
        };
      }

      // Afficher un échantillon des premières lignes pour debug
      const sampleRows = allDataRows.slice(0, 10);
      console.log('🔍 ÉCHANTILLON DES DONNÉES (10 premières lignes):', sampleRows);

      // ⭐ TRAITER TOUTES LES LIGNES AVEC VALIDATION TRÈS PERMISSIVE
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      const problemRows: Array<{ rowNumber: number; data: any; error: string }> = [];
      const rejectionReasons: { [reason: string]: number } = {};
      
      for (let i = 0; i < allDataRows.length; i++) {
        const row = allDataRows[i];
        const rowNumber = i + 2; // +2 car ligne 1 = en-têtes, et index commence à 0
        
        console.log(`\n🔄 TRAITEMENT LIGNE ${rowNumber}:`, row);
        
        try {
          // Créer un objet avec les en-têtes comme clés
          const rowObject: any = {};
          headers.forEach((header, index) => {
            rowObject[header] = row[index];
          });

          console.log(`🔍 [${rowNumber}] Objet ligne:`, rowObject);

          // ⭐ VALIDATION ULTRA-PERMISSIVE - accepter presque tout
          const validationResult = this.validateRowUltraPermissive(rowObject, rowNumber);
          if (!validationResult.isValid) {
            console.log(`⚠️ Ligne ${rowNumber} rejetée: ${validationResult.reason}`);
            this.incrementRejectionReason(rejectionReasons, validationResult.reason);
            continue;
          }

          // ⭐ TRANSFORMATION AVEC GESTION D'ERREUR ROBUSTE
          try {
            const collection = excelMappingService.transformExcelRowToSupabase(rowObject, rowNumber);
            collections.push(collection);
            console.log(`✅ Ligne ${rowNumber} traitée avec succès:`, {
              clientCode: collection.clientCode,
              collectionAmount: collection.collectionAmount,
              bankName: collection.bankName,
              reportDate: collection.reportDate
            });
          } catch (transformError) {
            // ⭐ TENTATIVE DE RÉCUPÉRATION AVEC TRANSFORMATION MANUELLE
            console.log(`🔧 Tentative de récupération pour ligne ${rowNumber}:`, transformError);
            
            try {
              const manualCollection = this.createCollectionManually(rowObject, rowNumber);
              if (manualCollection) {
                collections.push(manualCollection);
                console.log(`🛠️ Ligne ${rowNumber} récupérée manuellement:`, manualCollection.clientCode);
              } else {
                throw new Error('Échec transformation manuelle');
              }
            } catch (manualError) {
              const errorMsg = `Erreur ligne ${rowNumber}: ${manualError instanceof Error ? manualError.message : 'Erreur transformation'}`;
              errors.push(errorMsg);
              problemRows.push({
                rowNumber,
                data: row,
                error: manualError instanceof Error ? manualError.message : 'Erreur inconnue'
              });
              this.incrementRejectionReason(rejectionReasons, 'Erreur transformation');
            }
          }

        } catch (error) {
          const errorMsg = `Erreur ligne ${rowNumber}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          console.warn('⚠️', errorMsg, 'Données de la ligne:', row);
          // ⭐ NE PAS ARRÊTER LE TRAITEMENT, CONTINUER AVEC LA LIGNE SUIVANTE
        }
      }

      // ⭐ MISE À JOUR DU DIAGNOSTIC FINAL
      fullDiagnosis.transformedRows2024 = collections.filter(c => c.reportDate?.startsWith('2024')).length;
      fullDiagnosis.transformedRows2025 = collections.filter(c => c.reportDate?.startsWith('2025')).length;
      fullDiagnosis.rejectionReasons = rejectionReasons;

      const result: ExcelProcessingResult = {
        success: collections.length > 0,
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        totalRows: allDataRows.length,
        processedRows: collections.length,
        debugInfo: {
          detectedHeaders: headers,
          sampleRows: sampleRows,
          mappingResults: columnAnalysis.mapping,
          columnAnalysis,
          problemRows: problemRows.length > 0 ? problemRows : undefined,
          fullDiagnosis
        }
      };

      console.log(`\n📊 RÉSUMÉ FINAL DU TRAITEMENT AMÉLIORÉ:`);
      console.log(`✅ Collections créées: ${collections.length}/${allDataRows.length} (${((collections.length/allDataRows.length)*100).toFixed(1)}%)`);
      console.log(`❌ Erreurs: ${errors.length}`);
      console.log(`📋 Total lignes: ${allDataRows.length}`);
      console.log(`🗺️ Colonnes reconnues: ${columnAnalysis.recognized.length}/${headers.length}`);
      console.log(`🔍 Collections 2024: ${fullDiagnosis.transformedRows2024}`);
      console.log(`🔍 Collections 2025: ${fullDiagnosis.transformedRows2025}`);
      console.log(`📊 Raisons de rejet:`, rejectionReasons);
      
      if (problemRows.length > 0) {
        console.log(`🔍 LIGNES PROBLÉMATIQUES (${problemRows.length}):`);
        problemRows.slice(0, 10).forEach(problem => {
          console.log(`   - Ligne ${problem.rowNumber}: ${problem.error}`);
        });
      }
      
      if (collections.length > 0) {
        console.log('🎯 Première collection créée:', collections[0]);
        console.log('🎯 Dernière collection créée:', collections[collections.length - 1]);
      }

      return result;

    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT EXCEL:', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue lors du traitement Excel']
      };
    }
  }

  // ⭐ VALIDATION ULTRA-PERMISSIVE - accepter presque toutes les données
  private validateRowUltraPermissive(rowObject: any, rowNumber: number): { isValid: boolean; reason: string } {
    // Vérifier si la ligne est complètement vide
    const hasAnyData = Object.values(rowObject).some(value => 
      value !== null && value !== undefined && value !== '' && String(value).trim() !== ''
    );
    
    if (!hasAnyData) {
      return { isValid: false, reason: 'Ligne complètement vide' };
    }

    // ⭐ VALIDATION MINIMALE - juste vérifier qu'il y a quelque chose d'utile
    const clientName = rowObject["CLIENT NAME"];
    const clientCode = rowObject["CLIENT CODE"];
    const amount = rowObject["AMOUNT "] || rowObject["MONTANT"] || rowObject["AMOUNT"];

    // Accepter si au moins un identifiant existe
    if (!clientName && !clientCode) {
      return { isValid: false, reason: 'Aucun identifiant client' };
    }

    // Accepter si montant existe (même 0)
    if (amount === null || amount === undefined) {
      return { isValid: false, reason: 'Montant inexistant' };
    }

    return { isValid: true, reason: '' };
  }

  // ⭐ CRÉATION MANUELLE DE COLLECTION EN CAS D'ÉCHEC DE TRANSFORMATION
  private createCollectionManually(rowObject: any, rowNumber: number): CollectionReport | null {
    try {
      console.log(`🔧 Création manuelle pour ligne ${rowNumber}:`, rowObject);
      
      // Extraire les données essentielles manuellement
      const clientName = rowObject["CLIENT NAME"] || '';
      const clientCode = rowObject["CLIENT CODE"] || clientName.substring(0, 10) || `ROW_${rowNumber}`;
      const amount = rowObject["AMOUNT "] || rowObject["MONTANT"] || rowObject["AMOUNT"] || 0;
      const bank = rowObject["BANK"] || rowObject["BANQUE"] || 'UNKNOWN';
      const date = rowObject["DATE"] || rowObject["REPORTDATE"] || '2025-01-01';

      // Créer l'objet collection avec les valeurs par défaut
      const collection: CollectionReport = {
        clientCode: String(clientCode).trim(),
        collectionAmount: parseInt(String(amount).replace(/[^\d]/g, '')) || 0,
        bankName: String(bank).trim(),
        reportDate: this.formatDate(date),
        // Valeurs par défaut pour les champs optionnels
        commission: null,
        dateOfValidity: null,
        nj: null,
        taux: null,
        interet: null,
        tob: null,
        fraisEscompte: null,
        bankCommission: null,
        dNAmount: null,
        income: null,
        dateOfImpay: null,
        reglementImpaye: null,
        creditedDate: null,
        status: 'pending',
        remarques: `Récupération manuelle - Ligne ${rowNumber}`,
        factureNo: rowObject["FACTURE NO"] ? String(rowObject["FACTURE NO"]) : null,
        noChqBd: rowObject["NO CHQ/BD"] ? String(rowObject["NO CHQ/BD"]) : null,
        bankNameDisplay: String(bank).trim(),
        depoRef: rowObject["DEPO REF"] ? String(rowObject["DEPO REF"]) : null,
        processingStatus: 'RECOVERED',
        matchMethod: 'MANUAL_RECOVERY',
        sgOrFaNo: rowObject["SG OR FA NO"] ? String(rowObject["SG OR FA NO"]) : null
      };

      console.log(`🛠️ Collection manuelle créée:`, collection);
      return collection;

    } catch (error) {
      console.error(`❌ Échec création manuelle ligne ${rowNumber}:`, error);
      return null;
    }
  }

  // ⭐ FORMATAGE DE DATE ROBUSTE
  private formatDate(dateValue: any): string {
    if (!dateValue) return '2025-01-01';
    
    try {
      // Si c'est un objet Date
      if (dateValue instanceof Date) {
        return dateValue.toISOString().split('T')[0];
      }
      
      // Si c'est un timestamp Excel
      if (typeof dateValue === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
        return date.toISOString().split('T')[0];
      }
      
      // Si c'est une string
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
      
      return '2025-01-01';
    } catch {
      return '2025-01-01';
    }
  }

  // ⭐ NOUVEAU: DIAGNOSTIC COMPLET DES DONNÉES
  private async performFullDiagnosis(headers: string[], allDataRows: any[][]): Promise<any> {
    console.log('🔍 === DÉBUT DIAGNOSTIC COMPLET ===');
    
    // Identifier la séparation 2024/2025 en analysant les dates
    const dateColumnIndex = headers.indexOf('DATE') || headers.indexOf('REPORTDATE') || 0;
    let rows2024: any[][] = [];
    let rows2025: any[][] = [];
    
    // Séparer par année basé sur la date
    for (let i = 0; i < allDataRows.length; i++) {
      const row = allDataRows[i];
      const dateValue = row[dateColumnIndex];
      
      if (dateValue) {
        // Essayer de parser la date pour déterminer l'année
        const year = this.extractYearFromDate(dateValue);
        if (year === 2024) {
          rows2024.push(row);
        } else if (year === 2025) {
          rows2025.push(row);
        } else {
          // Si pas de date valide, considérer comme 2025 par défaut
          rows2025.push(row);
        }
      } else {
        // Pas de date, considérer comme 2025
        rows2025.push(row);
      }
    }

    console.log(`📅 Lignes 2024 identifiées: ${rows2024.length}`);
    console.log(`📅 Lignes 2025 identifiées: ${rows2025.length}`);

    // Analyser la validité des lignes
    const validRows2024 = rows2024.filter(row => this.isRowValid(headers, row)).length;
    const validRows2025 = rows2025.filter(row => this.isRowValid(headers, row)).length;

    console.log(`✅ Lignes valides 2024: ${validRows2024}/${rows2024.length}`);
    console.log(`✅ Lignes valides 2025: ${validRows2025}/${rows2025.length}`);

    // Échantillons pour debug
    const sampleValidCollections2024 = rows2024.filter(row => this.isRowValid(headers, row)).slice(0, 3)
      .map(row => this.createRowObject(headers, row));
    const sampleValidCollections2025 = rows2025.filter(row => this.isRowValid(headers, row)).slice(0, 3)
      .map(row => this.createRowObject(headers, row));
    const sampleInvalidRows = allDataRows.filter(row => !this.isRowValid(headers, row)).slice(0, 5)
      .map(row => this.createRowObject(headers, row));

    return {
      totalExcelRows: allDataRows.length,
      rows2024Count: rows2024.length,
      rows2025Count: rows2025.length,
      validRows2024,
      validRows2025,
      transformedRows2024: 0, // Sera mis à jour après transformation
      transformedRows2025: 0, // Sera mis à jour après transformation
      rejectionReasons: {},
      sampleValidCollections2024,
      sampleValidCollections2025,
      sampleInvalidRows
    };
  }

  // ⭐ UTILITAIRES POUR LE DIAGNOSTIC
  private extractYearFromDate(dateValue: any): number | null {
    if (!dateValue) return null;
    
    try {
      // Si c'est un objet Date
      if (dateValue instanceof Date) {
        return dateValue.getFullYear();
      }
      
      // Si c'est un timestamp Excel
      if (typeof dateValue === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
        return date.getFullYear();
      }
      
      // Si c'est une string
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          return date.getFullYear();
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  private isRowValid(headers: string[], row: any[]): boolean {
    // Au moins 50% des cellules non vides
    const nonEmptyCount = row.filter(cell => 
      cell !== null && cell !== undefined && cell !== '' && String(cell).trim() !== ''
    ).length;
    
    return nonEmptyCount >= Math.ceil(headers.length * 0.3); // Au moins 30% de données
  }

  private createRowObject(headers: string[], row: any[]): any {
    const obj: any = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  }

  private incrementRejectionReason(reasons: { [reason: string]: number }, reason: string): void {
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
}

export const excelProcessingService = new ExcelProcessingService();
