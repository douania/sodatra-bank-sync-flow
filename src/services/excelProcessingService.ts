
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
    // ⭐ NOUVEAU DIAGNOSTIC COMPLET
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
      const allDataRows = jsonData.slice(1) as any[][]; // ⭐ TOUTES LES LIGNES DE DONNÉES !
      
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

      // ⭐ TRAITER TOUTES LES LIGNES (2024 ET 2025) !
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

          // ⭐ VALIDATION PLUS PERMISSIVE - vérifier si la ligne contient des données utiles
          const validationResult = this.validateRowPermissive(rowObject, rowNumber);
          if (!validationResult.isValid) {
            console.log(`⚠️ Ligne ${rowNumber} rejetée: ${validationResult.reason}`);
            this.incrementRejectionReason(rejectionReasons, validationResult.reason);
            continue;
          }

          // ⭐ LOG DÉTAILLÉ DU CLIENT NAME
          const clientNameValue = rowObject["CLIENT NAME"];
          const clientCodeValue = rowObject["CLIENT CODE"];
          console.log(`🔍 [${rowNumber}] CLIENT NAME détecté: "${clientNameValue}" (type: ${typeof clientNameValue})`);
          console.log(`🔍 [${rowNumber}] CLIENT CODE détecté: "${clientCodeValue}" (type: ${typeof clientCodeValue})`);
          
          // ⭐ UTILISER LE NOUVEAU MAPPER AVEC GESTION D'ERREUR AMÉLIORÉE
          const collection = excelMappingService.transformExcelRowToSupabase(rowObject, rowNumber);
          
          collections.push(collection);
          console.log(`✅ Ligne ${rowNumber} traitée avec succès:`, {
            clientCode: collection.clientCode,
            collectionAmount: collection.collectionAmount,
            bankName: collection.bankName,
            reportDate: collection.reportDate
          });

        } catch (error) {
          const errorMsg = `Erreur ligne ${rowNumber}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          errors.push(errorMsg);
          
          // ⭐ CAPTURER LES LIGNES PROBLÉMATIQUES POUR ANALYSE
          problemRows.push({
            rowNumber,
            data: row,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
          });
          
          // ⭐ COMPTER LES RAISONS DE REJET
          const reason = error instanceof Error ? error.message.split(':')[0] : 'Erreur transformation';
          this.incrementRejectionReason(rejectionReasons, reason);
          
          console.error('❌', errorMsg, 'Données de la ligne:', row);
          console.error('❌ Détails CLIENT NAME pour ligne', rowNumber, ':', {
            clientNameRaw: row[headers.indexOf("CLIENT NAME")],
            clientCodeRaw: row[headers.indexOf("CLIENT CODE")],
            fullRowObject: headers.reduce((obj, header, idx) => ({ ...obj, [header]: row[idx] }), {})
          });
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

      console.log(`\n📊 RÉSUMÉ FINAL DU TRAITEMENT:`);
      console.log(`✅ Collections créées: ${collections.length}`);
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

  // ⭐ VALIDATION PERMISSIVE - seuls les champs vraiment critiques
  private validateRowPermissive(rowObject: any, rowNumber: number): { isValid: boolean; reason: string } {
    // Vérifier si la ligne est complètement vide
    const hasAnyData = Object.values(rowObject).some(value => 
      value !== null && value !== undefined && value !== '' && String(value).trim() !== ''
    );
    
    if (!hasAnyData) {
      return { isValid: false, reason: 'Ligne complètement vide' };
    }

    // Vérifier les champs VRAIMENT critiques seulement
    const clientName = rowObject["CLIENT NAME"];
    const clientCode = rowObject["CLIENT CODE"];
    const amount = rowObject["AMOUNT "] || rowObject["MONTANT"];
    const bank = rowObject["BANK"] || rowObject["BANQUE"];

    // Au moins un identifiant client
    if (!clientName && !clientCode) {
      return { isValid: false, reason: 'CLIENT NAME et CLIENT CODE manquants' };
    }

    // Au moins un montant
    if (amount === null || amount === undefined || amount === '') {
      return { isValid: false, reason: 'AMOUNT manquant' };
    }

    // Banque optionnelle mais utile
    // Date optionnelle car peut être calculée

    return { isValid: true, reason: '' };
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
