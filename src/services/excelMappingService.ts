import { CollectionReport } from '@/types/banking';

// Interface pour le résultat de détection du type de collection
interface CollectionTypeResult {
  type: 'EFFET' | 'CHEQUE' | 'UNKNOWN';
  effetEcheanceDate: Date | null;
  chequeNumber: string | null;
  rawValue?: string;
}

class ExcelMappingService {
  // Détecte le type de collection (EFFET ou CHEQUE) basé sur la valeur de No.CHq /Bd
  detectCollectionType(noChqBdValue: any): CollectionTypeResult {
    if (!noChqBdValue || noChqBdValue === null) {
      return {
        type: 'UNKNOWN',
        effetEcheanceDate: null,
        chequeNumber: null
      };
    }
    
    // Détection : DATE = EFFET
    if (this.isDate(noChqBdValue)) {
      return {
        type: 'EFFET',
        effetEcheanceDate: this.parseDate(noChqBdValue) ? new Date(this.parseDate(noChqBdValue)!) : null,
        chequeNumber: null,
        rawValue: String(noChqBdValue)
      };
    }
    
    // Détection : NUMÉRO = CHÈQUE
    if (this.isNumber(noChqBdValue)) {
      return {
        type: 'CHEQUE',
        effetEcheanceDate: null,
        chequeNumber: String(noChqBdValue),
        rawValue: String(noChqBdValue)
      };
    }
    
    // Cas ambigus
    return {
      type: 'UNKNOWN',
      effetEcheanceDate: null,
      chequeNumber: null,
      rawValue: String(noChqBdValue)
    };
  }
  
  private isDate(value: any): boolean {
    // Vérification si c'est un objet Date
    if (value instanceof Date) return true;
    
    // Vérification si c'est une string de date
    if (typeof value === 'string') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}/;
      return dateRegex.test(value);
    }
    
    return false;
  }
  
  private isNumber(value: any): boolean {
    // Vérification si c'est un nombre
    if (typeof value === 'number' && !isNaN(value)) return true;
    
    // Vérification si c'est une string numérique
    if (typeof value === 'string') {
      const numericRegex = /^\d+$/;
      return numericRegex.test(value.trim());
    }
    
    return false;
  }

  mapExcelRowToCollection(row: any): CollectionReport {
    console.log('🔄 MAPPING avec tolérance aux erreurs:', {
      client: row.clientCode,
      filename: row.excel_filename,
      sourceRow: row.excel_source_row
    });
    
    // Détection du type de collection (EFFET ou CHEQUE)
    const noChqBdValue = row.noChqBd;
    const typeResult = this.detectCollectionType(noChqBdValue);
    
    // ⭐ Lot 3B.1 — Traçabilité Excel OBLIGATOIRE.
    // La traçabilité (excel_filename + excel_source_row) doit avoir été assignée
    // en amont par excelProcessingService.parseExcelRow. Aucun fallback toléré.
    if (!row.excel_filename || typeof row.excel_filename !== 'string') {
      throw new Error(
        `Traçabilité Excel manquante (excel_filename) pour clientCode="${row.clientCode ?? ''}"`
      );
    }
    if (!row.excel_source_row || typeof row.excel_source_row !== 'number' || row.excel_source_row <= 0) {
      throw new Error(
        `Traçabilité Excel manquante (excel_source_row) pour clientCode="${row.clientCode ?? ''}" / file="${row.excel_filename}"`
      );
    }

    const collection: CollectionReport = {
      reportDate: this.parseDate(row.reportDate) || new Date().toISOString().split('T')[0], // Date par défaut si parsing échoue
      clientCode: this.parseString(row.clientCode) || 'UNKNOWN',
      collectionAmount: this.parseNumber(row.collectionAmount) || 0,
      bankName: this.parseString(row.bankName),
      status: 'pending',
      
      // Logique métier effet/chèque
      collectionType: typeResult.type,
      effetEcheanceDate: typeResult.effetEcheanceDate ? typeResult.effetEcheanceDate.toISOString().split('T')[0] : undefined,
      effetStatus: typeResult.type === 'EFFET' ? 'PENDING' : undefined,
      chequeNumber: typeResult.chequeNumber,
      chequeStatus: typeResult.type === 'CHEQUE' ? 'PENDING' : undefined,
      
      // ⭐ TRAÇABILITÉ OBLIGATOIRE — validée plus haut, pas de fallback.
      excelFilename: row.excel_filename,
      excelSourceRow: row.excel_source_row,
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

    console.log('✅ Collection mappée:', {
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
        // ⭐ AMÉLIORATION - Détecter le format français DD/MM/YYYY
        const trimmedValue = value.trim();
        
        // Détection format français DD/MM/YYYY ou DD/MM/YY
        const frenchDateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
        const frenchMatch = trimmedValue.match(frenchDateRegex);
        
        if (frenchMatch) {
          const [, day, month, year] = frenchMatch;
          
          // Conversion vers le format ISO YYYY-MM-DD
          let fullYear = parseInt(year);
          if (fullYear < 100) {
            // Gérer les années à 2 chiffres (25 -> 2025, 95 -> 1995)
            fullYear += fullYear < 50 ? 2000 : 1900;
          }
          
          const isoDate = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          console.log(`📅 Date française détectée: ${trimmedValue} -> ${isoDate}`);
          
          const parsed = new Date(isoDate);
          if (!isNaN(parsed.getTime())) {
            date = parsed;
          } else {
            throw new Error(`Date française invalide après conversion: ${isoDate}`);
          }
        } else {
          // Essayer le parsing standard pour les autres formats
          const parsed = new Date(trimmedValue);
          if (isNaN(parsed.getTime())) {
            console.warn('⚠️ Date invalide, utilisation de la date du jour:', trimmedValue);
            return new Date().toISOString().split('T')[0];
          }
          date = parsed;
        }
      } else {
        console.warn('⚠️ Format de date non reconnu, utilisation de la date du jour:', value);
        return new Date().toISOString().split('T')[0];
      }
      
      return date.toISOString().split('T')[0];
    } catch (error) {
      console.warn('⚠️ Erreur parsing date, utilisation de la date du jour:', value, error);
      return new Date().toISOString().split('T')[0];
    }
  }
  
  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    
    try {
      if (typeof value === 'number') {
        // ⭐ TRONQUER pour éviter les erreurs de type integer avec des valeurs comme "72.0"
        return isNaN(value) ? undefined : Math.trunc(value);
      }
      
      if (typeof value === 'string') {
        // Nettoyer la chaîne (espaces, virgules comme séparateurs de milliers)
        const cleaned = value.replace(/[\s,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        // ⭐ TRONQUER pour garantir un entier sans partie décimale
        return isNaN(parsed) ? undefined : Math.trunc(parsed);
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