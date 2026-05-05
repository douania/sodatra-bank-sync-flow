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
      // ⭐ Lot 3B.2 — date optionnelle (effetEcheanceDate). Pas de fallback "aujourd'hui".
      const parsed = this.parseDate(noChqBdValue, { required: false, fieldName: 'noChqBd' });
      return {
        type: 'EFFET',
        effetEcheanceDate: parsed ? new Date(parsed) : null,
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

    // ⭐ Lot 3B.1.ter — clientCode OBLIGATOIRE. Plus de fallback 'UNKNOWN'.
    const parsedClientCode = this.parseString(row.clientCode);
    if (!parsedClientCode) {
      throw new Error(
        `clientCode manquant ou vide (file="${row.excel_filename}", row=${row.excel_source_row}). Ligne rejetée.`
      );
    }

    // ⭐ Lot 3B.2 — reportDate OBLIGATOIRE. Plus de fallback "date du jour".
    // throw si invalide → la ligne est rejetée par excelProcessingService (errors[]).
    const rowContext = `file="${row.excel_filename}", row=${row.excel_source_row}`;
    const parsedReportDate = this.parseDate(row.reportDate, {
      required: true,
      fieldName: 'reportDate',
      rowContext,
    });

    const collection: CollectionReport = {
      reportDate: parsedReportDate as string, // garanti non-null par required:true
      clientCode: parsedClientCode,
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
      
      // ⭐ Lot 3B.2 — Champs date optionnels : null/undefined + warning, jamais "aujourd'hui".
      dateOfValidity: this.parseDate(row.dateOfValidity, {
        required: false,
        fieldName: 'dateOfValidity',
        rowContext,
      }) ?? undefined,
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
      dateOfImpay: this.parseDate(row.dateOfImpay, {
        required: false,
        fieldName: 'dateOfImpay',
        rowContext,
      }) ?? undefined,
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

  /**
   * ⭐ Lot 3B.2 — parseDate strict, sans fallback "date du jour".
   *
   * Formats acceptés :
   *  - Date JS valide
   *  - Excel serial number (1 ≤ n < 80000)
   *  - DD/MM/YYYY et DD/MM/YY (pivot 50 : <50 → 20xx, ≥50 → 19xx)
   *  - YYYY-MM-DD (ISO)
   *
   * Comportement :
   *  - required:true + invalide/absent → throw Error explicite (ligne rejetée).
   *  - required:false + invalide → null + warning console (ligne acceptée).
   *  - required:false + absent → null silencieux (champ vide légitime).
   *
   * Validation calendaire stricte : 31/02/2026 est rejeté.
   */
  private parseDate(
    value: any,
    opts: { required: boolean; fieldName: string; rowContext?: string }
  ): string | null {
    const { required, fieldName, rowContext } = opts;
    const ctx = rowContext ? ` (${rowContext})` : '';

    // Absence
    if (value === null || value === undefined || value === '') {
      if (required) {
        throw new Error(`${fieldName} obligatoire mais absent${ctx}.`);
      }
      return null;
    }

    const isoDate = this.tryParseDateStrict(value);

    if (!isoDate) {
      const raw = typeof value === 'string' ? value : String(value);
      if (required) {
        throw new Error(
          `${fieldName} obligatoire mais invalide${ctx}. Valeur reçue: "${raw}". ` +
            `Formats acceptés : Date, Excel serial, DD/MM/YYYY, DD/MM/YY, YYYY-MM-DD.`
        );
      }
      console.warn(
        `⚠️ ${fieldName} invalide${ctx} — valeur="${raw}" — champ laissé vide (null).`
      );
      return null;
    }

    return isoDate;
  }

  /**
   * Tente de parser une valeur en date ISO YYYY-MM-DD.
   * Retourne null si invalide. Pas de side effect, pas de fallback.
   */
  private tryParseDateStrict(value: any): string | null {
    let date: Date | null = null;

    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      date = value;
    } else if (typeof value === 'number') {
      // Excel serial number — plage raisonnable [1, 80000) ≈ [1900, 2119]
      if (!isFinite(value) || value < 1 || value >= 80000) return null;
      date = new Date((value - 25569) * 86400 * 1000);
      if (isNaN(date.getTime())) return null;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      // ISO YYYY-MM-DD strict
      const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        const [, y, m, d] = isoMatch;
        return this.buildIsoIfValid(parseInt(y), parseInt(m), parseInt(d));
      }

      // DD/MM/YYYY ou DD/MM/YY (pivot 50)
      const frMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (frMatch) {
        const [, dStr, mStr, yStr] = frMatch;
        let year = parseInt(yStr);
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
        return this.buildIsoIfValid(year, parseInt(mStr), parseInt(dStr));
      }

      // Tout autre format string → REJET (plus de new Date(string) permissif)
      return null;
    } else {
      return null;
    }

    // Cas Date / Excel serial : conversion en composantes UTC pour valider et formater.
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    return this.buildIsoIfValid(y, m, d);
  }

  /**
   * Construit une date ISO YYYY-MM-DD si la combinaison Y/M/D est calendairement valide.
   * Rejette 31/02, 31/04, etc.
   */
  private buildIsoIfValid(year: number, month: number, day: number): string | null {
    if (
      !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
      year < 1900 || year > 2119 ||
      month < 1 || month > 12 ||
      day < 1 || day > 31
    ) {
      return null;
    }
    // Validation calendaire : reconstruire et comparer
    const test = new Date(Date.UTC(year, month - 1, day));
    if (
      test.getUTCFullYear() !== year ||
      test.getUTCMonth() !== month - 1 ||
      test.getUTCDate() !== day
    ) {
      return null;
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
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