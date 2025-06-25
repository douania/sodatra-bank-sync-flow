
import { CollectionReport } from '@/types/banking';

class ExcelMappingService {
  mapExcelRowToCollection(row: any): CollectionReport {
    console.log('🔄 MAPPING avec tolérance aux erreurs:', {
      client: row.clientCode,
      filename: row.excel_filename,
      sourceRow: row.excel_source_row
    });
    
    // ⭐ MODE TOLÉRANT - Traçabilité optionnelle
    const collection: CollectionReport = {
      reportDate: this.parseDate(row.reportDate) || new Date().toISOString().split('T')[0], // Date par défaut si parsing échoue
      clientCode: this.parseString(row.clientCode) || 'UNKNOWN',
      collectionAmount: this.parseNumber(row.collectionAmount) || 0,
      bankName: this.parseString(row.bankName),
      status: 'pending',
      
      // ⭐ TRAÇABILITÉ OPTIONNELLE - Ne plus bloquer le traitement
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
    
    // ⭐ AVERTISSEMENT au lieu d'erreur bloquante
    if (!collection.excelFilename || !collection.excelSourceRow) {
      console.warn('⚠️ TRAÇABILITÉ MANQUANTE (non-bloquant):', {
        client: collection.clientCode,
        filename: collection.excelFilename,
        row: collection.excelSourceRow
      });
    }
    
    console.log('✅ Collection mappée (mode tolérant):', {
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
          console.warn('⚠️ Date invalide, utilisation de la date du jour:', value);
          return new Date().toISOString().split('T')[0]; // Date par défaut
        }
        date = parsed;
      } else {
        console.warn('⚠️ Format de date non reconnu, utilisation de la date du jour:', value);
        return new Date().toISOString().split('T')[0]; // Date par défaut
      }
      
      return date.toISOString().split('T')[0];
    } catch (error) {
      console.warn('⚠️ Erreur parsing date, utilisation de la date du jour:', value, error);
      return new Date().toISOString().split('T')[0]; // Date par défaut
    }
  }
  
  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    
    try {
      if (typeof value === 'number') {
        // ⭐ ARRONDIR automatiquement pour éviter les erreurs bigint
        return isNaN(value) ? undefined : Math.round(value);
      }
      
      if (typeof value === 'string') {
        // Nettoyer la chaîne (espaces, virgules comme séparateurs de milliers)
        const cleaned = value.replace(/[\s,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        // ⭐ ARRONDIR automatiquement
        return isNaN(parsed) ? undefined : Math.round(parsed);
      }
      
      return undefined;
    } catch (error) {
      console.warn('⚠️ Erreur parsing nombre (non-bloquant):', value, error);
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
