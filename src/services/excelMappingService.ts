
import { CollectionReport } from '@/types/banking';

class ExcelMappingService {
  mapExcelRowToCollection(row: any): CollectionReport {
    console.log('🔄 MAPPING avec traçabilité:', {
      client: row.clientCode,
      filename: row.excel_filename,
      sourceRow: row.excel_source_row
    });
    
    // ⭐ PRÉSERVATION OBLIGATOIRE DE LA TRAÇABILITÉ
    const collection: CollectionReport = {
      reportDate: this.parseDate(row.reportDate),
      clientCode: this.parseString(row.clientCode) || 'UNKNOWN',
      collectionAmount: this.parseNumber(row.collectionAmount) || 0,
      bankName: this.parseString(row.bankName),
      status: 'pending',
      
      // ⭐ TRAÇABILITÉ EXCEL OBLIGATOIRE
      excelFilename: row.excel_filename || 'UNKNOWN_FILE',
      excelSourceRow: row.excel_source_row || 0,
      excelProcessedAt: new Date().toISOString(),
      
      // Champs optionnels
      dateOfValidity: this.parseDate(row.dateOfValidity),
      factureNo: this.parseString(row.factureNo),
      noChqBd: this.parseString(row.noChqBd),
      bankNameDisplay: this.parseString(row.bankNameDisplay),
      depoRef: this.parseString(row.depoRef),
      nj: this.parseNumber(row.nj),
      taux: this.parseNumber(row.taux),
      interet: this.parseNumber(row.interet),
      commission: this.parseNumber(row.commission),
      tob: this.parseNumber(row.tob),
      fraisEscompte: this.parseNumber(row.fraisEscompte),
      bankCommission: this.parseNumber(row.bankCommission),
      sgOrFaNo: this.parseString(row.sgOrFaNo),
      dNAmount: this.parseNumber(row.dNAmount),
      income: this.parseNumber(row.income),
      dateOfImpay: this.parseDate(row.dateOfImpay),
      reglementImpaye: this.parseString(row.reglementImpaye),
      remarques: this.parseString(row.remarques),
      
      processingStatus: 'NEW'
    };
    
    // ⭐ VÉRIFICATION CRITIQUE AVANT RETOUR
    if (!collection.excelFilename || !collection.excelSourceRow) {
      console.error('❌ TRAÇABILITÉ MANQUANTE APRÈS MAPPING:', {
        client: collection.clientCode,
        filename: collection.excelFilename,
        row: collection.excelSourceRow
      });
      
      throw new Error(`TRAÇABILITÉ MANQUANTE pour ${collection.clientCode}: filename=${collection.excelFilename}, row=${collection.excelSourceRow}`);
    }
    
    console.log('✅ Collection mappée avec traçabilité:', {
      client: collection.clientCode,
      filename: collection.excelFilename,
      row: collection.excelSourceRow
    });
    
    return collection;
  }
  
  private parseDate(value: any): string | undefined {
    if (!value) return undefined;
    
    try {
      let date: Date;
      
      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'number') {
        // Excel date serial number
        date = new Date((value - 25569) * 86400 * 1000);
      } else if (typeof value === 'string') {
        // Try to parse string date
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) {
          return undefined;
        }
        date = parsed;
      } else {
        return undefined;
      }
      
      return date.toISOString().split('T')[0];
    } catch (error) {
      console.warn('⚠️ Erreur parsing date:', value, error);
      return undefined;
    }
  }
  
  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    
    try {
      if (typeof value === 'number') {
        return isNaN(value) ? undefined : value;
      }
      
      if (typeof value === 'string') {
        // Nettoyer la chaîne (espaces, virgules comme séparateurs de milliers)
        const cleaned = value.replace(/[\s,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? undefined : parsed;
      }
      
      return undefined;
    } catch (error) {
      console.warn('⚠️ Erreur parsing nombre:', value, error);
      return undefined;
    }
  }
  
  private parseString(value: any): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    
    const str = String(value).trim();
    return str === '' ? undefined : str;
  }
}

export const excelMappingService = new ExcelMappingService();
