
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
  };
}

export class ExcelProcessingService {

  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('🚀 DÉBUT TRAITEMENT EXCEL - Fichier:', file.name, 'Taille:', file.size, 'bytes');
      
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
      console.log('🔄 Conversion JSON terminée, nombre de lignes:', jsonData.length);
      
      if (jsonData.length < 2) {
        console.error('❌ Fichier invalide - pas assez de données');
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins une ligne d\'en-tête et une ligne de données']
        };
      }

      // Extraire les en-têtes (première ligne)
      const headers = jsonData[0] as string[];
      const dataRows = jsonData.slice(1) as any[][];
      
      console.log('📋 EN-TÊTES DÉTECTÉS:', headers);
      console.log('📊 NOMBRE DE LIGNES DE DONNÉES:', dataRows.length);

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
            columnAnalysis
          }
        };
      }

      // Afficher un échantillon des premières lignes pour debug
      const sampleRows = dataRows.slice(0, 3);
      console.log('🔍 ÉCHANTILLON DES DONNÉES (3 premières lignes):', sampleRows);

      // Traiter chaque ligne de données
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNumber = i + 2; // +2 car ligne 1 = en-têtes, et index commence à 0
        
        console.log(`\n🔄 TRAITEMENT LIGNE ${rowNumber}:`, row);
        
        try {
          // Créer un objet avec les en-têtes comme clés
          const rowObject: any = {};
          headers.forEach((header, index) => {
            rowObject[header] = row[index];
          });

          console.log(`🔍 [${rowNumber}] Objet ligne:`, rowObject);

          // Vérifier si la ligne est vide
          if (row.every(cell => !cell || cell.toString().trim() === '')) {
            console.log(`⚠️ Ligne ${rowNumber} vide, ignorée`);
            continue;
          }

          // ⭐ UTILISER LE NOUVEAU MAPPER
          const collection = excelMappingService.transformExcelRowToSupabase(rowObject, rowNumber);
          
          collections.push(collection);
          console.log(`✅ Ligne ${rowNumber} traitée avec succès:`, {
            clientCode: collection.clientCode,
            collectionAmount: collection.collectionAmount,
            bankName: collection.bankName
          });

        } catch (error) {
          const errorMsg = `Erreur ligne ${rowNumber}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          errors.push(errorMsg);
          console.error('❌', errorMsg, 'Données de la ligne:', row);
        }
      }

      const result: ExcelProcessingResult = {
        success: collections.length > 0,
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        totalRows: dataRows.length,
        processedRows: collections.length,
        debugInfo: {
          detectedHeaders: headers,
          sampleRows: sampleRows,
          mappingResults: columnAnalysis.mapping,
          columnAnalysis
        }
      };

      console.log(`\n📊 RÉSUMÉ DU TRAITEMENT:`);
      console.log(`✅ Collections créées: ${collections.length}`);
      console.log(`❌ Erreurs: ${errors.length}`);
      console.log(`📋 Total lignes: ${dataRows.length}`);
      console.log(`🗺️ Colonnes reconnues: ${columnAnalysis.recognized.length}/${headers.length}`);
      
      if (collections.length > 0) {
        console.log('🎯 Première collection créée:', collections[0]);
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
}

export const excelProcessingService = new ExcelProcessingService();
