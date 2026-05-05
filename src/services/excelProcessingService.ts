import * as XLSX from 'xlsx';
import { CollectionReport } from '@/types/banking';
import { excelMappingService } from './excelMappingService';

export interface ExcelProcessingResult {
  success: boolean;
  data?: CollectionReport[];
  errors?: string[];
  warnings?: string[];
  sourceFile?: string;
  totalProcessed?: number;
}

class ExcelProcessingService {
  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('📊 DÉBUT TRAITEMENT EXCEL (MODE TOLÉRANT):', file.name);
      
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      if (!workbook.SheetNames.length) {
        return {
          success: false,
          errors: ['Aucune feuille trouvée dans le fichier Excel']
        };
      }
      
      // ⭐ Lot 3B.1.ter — Sélection intelligente de la feuille de données.
      // Ne plus utiliser SheetNames[0] aveuglément (Feuil3 = pivot agrégé).
      // Identifier la feuille contenant les vrais headers obligatoires.
      const selectedSheetName = this.selectDataSheet(workbook);
      if (!selectedSheetName) {
        return {
          success: false,
          errors: [
            'Aucune feuille de données valide trouvée. Headers obligatoires requis: ' +
            'date (DATE/Report Date), client (CLIENT NAME/Client/Code Client), montant (AMOUNT/Montant).'
          ]
        };
      }
      console.log(`📑 Feuille de données sélectionnée: ${selectedSheetName}`);
      const worksheet = workbook.Sheets[selectedSheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log(`📊 Données brutes extraites: ${rawData.length} lignes`);
      
      if (rawData.length < 2) {
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins un en-tête et une ligne de données']
        };
      }
      
      // Identifier la ligne d'en-tête
      const headers = rawData[0] as string[];
      console.log('📊 En-têtes détectés:', headers);
      
      // ⭐ MODE TOLÉRANT - Traiter les données même avec des erreurs
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      
      for (let rowIndex = 1; rowIndex < rawData.length; rowIndex++) {
        const row = rawData[rowIndex] as any[];
        
        // Ignorer les lignes complètement vides
        if (!row || row.every(cell => !cell && cell !== 0)) {
          console.log(`⚠️ Ligne ${rowIndex + 1} ignorée (vide)`);
          continue;
        }
        
        try {
          // ⭐ TRAÇABILITÉ OPTIONNELLE - Ne plus bloquer
          const rowData = this.parseExcelRow(headers, row, rowIndex + 1);
          
          // ⭐ ASSIGNATION OPTIONNELLE de la traçabilité
          rowData.excel_filename = file.name;
          rowData.excel_source_row = rowIndex + 1;
          
          console.log(`📊 Ligne ${rowIndex + 1}: traitement (mode tolérant)`, {
            filename: rowData.excel_filename,
            row: rowData.excel_source_row,
            client: rowData.clientCode
          });
          
          // Mapper vers le format CollectionReport
          const mappedData = excelMappingService.mapExcelRowToCollection(rowData);

          // ⭐ Lot 3B.1 — la traçabilité est désormais garantie par le mapper (throw si absente).
          // Si on arrive ici, mappedData.excelFilename / excelSourceRow sont valides.
          collections.push(mappedData);
          
        } catch (error) {
          // ⭐ Lot 3B.1 — Une erreur de traçabilité est BLOQUANTE pour la ligne concernée.
          // La ligne est rejetée (errors[]), pas mise en warning silencieux.
          // Les autres lignes continuent d'être traitées (pas d'arrêt global).
          const rawMsg = error instanceof Error ? error.message : 'Erreur inconnue';
          const isTraceabilityError = /Traçabilité Excel manquante/i.test(rawMsg);
          // ⭐ Lot 3B.2 — reportDate obligatoire invalide/absent → bloquant pour la ligne.
          const isMandatoryDateError = /reportDate obligatoire/i.test(rawMsg);
          // ⭐ Lot 3B.1.ter — clientCode obligatoire absent → bloquant pour la ligne.
          const isMandatoryClientError = /clientCode manquant/i.test(rawMsg);
          const errorMsg = `Ligne ${rowIndex + 1}: ${rawMsg}`;
          if (isTraceabilityError || isMandatoryDateError || isMandatoryClientError) {
            console.error('❌ Erreur bloquante (ligne rejetée):', errorMsg);
            errors.push(errorMsg);
          } else {
            console.warn('⚠️ Erreur non-bloquante:', errorMsg);
            warnings.push(errorMsg);
          }
          continue;
        }
      }
      
      console.log('📊 RÉSULTAT TRAITEMENT EXCEL:', {
        totalLignes: rawData.length - 1,
        collectionsTraitées: collections.length,
        erreurs: errors.length,
        avertissements: warnings.length
      });
      
      // ⭐ Lot 3B.1 — succès uniquement si AUCUNE erreur critique de traçabilité.
      // Les warnings non-bloquants n'invalident pas le succès global.
      return {
        success: errors.length === 0 && collections.length > 0,
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        sourceFile: file.name,
        totalProcessed: collections.length
      };
      
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT EXCEL:', error);
      return {
        success: false,
        errors: [`Erreur critique: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }
  
  // ⭐ Lot 3B.1.ter — Sélection intelligente de feuille.
  private selectDataSheet(workbook: XLSX.WorkBook): string | null {
    const dateKeys = ['date', 'report date'];
    const clientKeys = ['client name', 'client', 'client code', 'code client'];
    const amountKeys = ['amount', 'montant', 'collection amount'];

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      if (!rows.length) continue;
      const headers = (rows[0] || [])
        .filter((h: any) => h !== null && h !== undefined)
        .map((h: any) => String(h).trim().toLowerCase());
      if (!headers.length) continue;

      const hasDate = dateKeys.some(k => headers.includes(k));
      const hasClient = clientKeys.some(k => headers.includes(k));
      const hasAmount = amountKeys.some(k => headers.includes(k));

      if (hasDate && hasClient && hasAmount) {
        return sheetName;
      }
      console.log(`📑 Feuille "${sheetName}" rejetée (date=${hasDate}, client=${hasClient}, amount=${hasAmount})`);
    }
    return null;
  }

  private parseExcelRow(headers: string[], row: any[], rowNumber: number): any {
    const rowData: any = {
      _sourceRowNumber: rowNumber // Pour debug
    };
    
    for (let i = 0; i < headers.length && i < row.length; i++) {
      const header = headers[i];
      const value = row[i];
      
      if (header && value !== null && value !== undefined && value !== '') {
        // Nettoyer et normaliser la valeur
        let cleanValue = value;
        
        if (typeof value === 'string') {
          cleanValue = value.trim();
        }
        
        // Mapper les en-têtes vers les propriétés
        const mappedProperty = this.mapHeaderToProperty(header);
        if (mappedProperty) {
          rowData[mappedProperty] = cleanValue;
        }
      }
    }
    
    return rowData;
  }
  
  private mapHeaderToProperty(header: string): string | null {
    const headerMappings: { [key: string]: string } = {
      'Date': 'reportDate',
      'Report Date': 'reportDate',
      'CLIENT NAME': 'clientCode',
      'Client Code': 'clientCode',
      'Client': 'clientCode',
      'Code Client': 'clientCode',
      'Amount': 'collectionAmount',
      'AMOUNT': 'collectionAmount',
      'Collection Amount': 'collectionAmount',
      'Montant': 'collectionAmount',
      'Bank': 'bankName',
      'Banque': 'bankName',
      'Bank Name': 'bankName',
      'BANK NAME': 'bankName',
      'Date of Validity': 'dateOfValidity',
      'Date of VAlidity': 'dateOfValidity',
      'Date Validité': 'dateOfValidity',
      'Facture No': 'factureNo',
      'FACTURE N°': 'factureNo',
      'Invoice No': 'factureNo',
      'No Chèque/BD': 'noChqBd',
      'No.CHq /Bd': 'noChqBd',
      'Chèque BD': 'noChqBd',
      'Bank Name Display': 'bankNameDisplay',
      'Depot Ref': 'depoRef',
      'Référence': 'depoRef',
      'NJ': 'nj',
      'Taux': 'taux',
      'Rate': 'taux',
      'Intérêt': 'interet',
      'Interest': 'interet',
      'Commission': 'commission',
      'TOB': 'tob',
      'Frais Escompte': 'fraisEscompte',
      'frais escompte': 'fraisEscompte',
      'Bank Commission': 'bankCommission',
      'SG or FA No': 'sgOrFaNo',
      'D/N Amount': 'dNAmount',
      'Income': 'income',
      'Revenus': 'income',
      'Date of Impay': 'dateOfImpay',
      'Règlement Impayé': 'reglementImpaye',
      'Remarques': 'remarques',
      'Comments': 'remarques'
    };

    // ⭐ Lot 3B.1.ter — Matching strict : trim + exact case-insensitive uniquement.
    // Plus de `includes` partiel (créait des faux positifs ex: "Somme de AMOUNT" → Amount).
    const normalized = String(header || '').trim().toLowerCase();
    if (!normalized) return null;

    for (const [key, value] of Object.entries(headerMappings)) {
      if (key.trim().toLowerCase() === normalized) {
        return value;
      }
    }
    return null;
  }
}

export const excelProcessingService = new ExcelProcessingService();
