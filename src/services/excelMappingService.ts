
import { CollectionReport } from '@/types/banking';

export class ExcelToSupabaseMapper {
  
  // ⭐ MAPPING EXACT DES COLONNES AVEC TOUS LES CARACTÈRES SPÉCIAUX
  private static readonly COLUMN_MAPPING = {
    // ⭐ COLONNES PRINCIPALES
    "DATE": "reportDate",
    "FACTURE N°": "factureNo",                    // ⚠️ Caractère spécial °
    "CLIENT NAME": "clientCode",                  // On utilise comme clientCode
    "AMOUNT ": "collectionAmount",                // ⚠️ ESPACE à la fin !
    "BANK": "bankName",
    
    // ⭐ INFORMATIONS BANCAIRES
    "No.CHq /Bd": "noChqBd",                     // ⚠️ Points et espaces
    "BANK NAME": "bankNameDisplay",
    "DEPO.REF": "depoRef",                       // ⚠️ Point dans le nom
    
    // ⭐⭐ DATE CRUCIALE
    "Date of VAlidity": "dateOfValidity",        // ⚠️ Majuscule bizarre dans VAlidity
    
    // ⭐ CALCULS FINANCIERS
    "NJ": "nj",
    "TAUX": "taux",
    "Interet": "interet",                        // ⚠️ Pas d'accent
    "commission": "commission",                  // ⚠️ Minuscule
    "TOB": "tob",
    "frais escompte": "fraisEscompte",          // ⚠️ Espace
    "BankCommission": "bankCommission",          // ⚠️ CamelCase
    
    // ⭐ RÉFÉRENCES
    "SG or FA N°": "sgOrFaNo",                  // ⚠️ Espaces et °
    "D.NAmount": "dNAmount",                    // ⚠️ Point et CamelCase
    "INCOME ": "income",                        // ⚠️ ESPACE à la fin !
    
    // ⭐ GESTION IMPAYÉS
    "Date of impay": "dateOfImpay",
    "Reglement impayé": "reglementImpaye",     // ⚠️ Accent
    "remarques": "remarques",
    
    // ⭐ ALTERNATIVES POSSIBLES (variations de noms)
    "CLIENT CODE": "clientCode",
    "MONTANT": "collectionAmount",
    "BANQUE": "bankName",
    "FACTURE": "factureNo",
    "REFERENCE": "depoRef"
  };

  static transformExcelRowToSupabase(excelRow: any, rowNumber: number): CollectionReport {
    console.log(`🔄 [${rowNumber}] Transformation Excel row:`, excelRow);
    
    const mapped: Partial<CollectionReport> = {
      status: 'pending'
    };
    
    // ⭐ TRANSFORMATION AVEC GESTION DES ERREURS
    for (const [excelCol, supabaseField] of Object.entries(this.COLUMN_MAPPING)) {
      try {
        const value = excelRow[excelCol];
        if (value !== undefined && value !== null) {
          console.log(`🔗 [${rowNumber}] Mapping "${excelCol}" = "${value}" → ${supabaseField}`);
          (mapped as any)[supabaseField] = this.transformValue(value, supabaseField);
        }
      } catch (error) {
        console.warn(`⚠️ [${rowNumber}] Erreur mapping colonne "${excelCol}":`, error);
      }
    }
    
    // ⭐ AJOUT DES MÉTADONNÉES
    if (!mapped.reportDate) {
      mapped.reportDate = new Date().toISOString().split('T')[0];
    }
    
    console.log(`✅ [${rowNumber}] Objet mappé final:`, mapped);
    
    // ⭐ VALIDATION DES CHAMPS OBLIGATOIRES
    if (!mapped.clientCode) {
      throw new Error(`[${rowNumber}] CLIENT CODE manquant - colonnes détectées: ${Object.keys(excelRow).join(', ')}`);
    }
    
    if (!mapped.collectionAmount || mapped.collectionAmount <= 0) {
      throw new Error(`[${rowNumber}] COLLECTION AMOUNT manquant ou invalide (${mapped.collectionAmount}) - colonnes détectées: ${Object.keys(excelRow).join(', ')}`);
    }
    
    return mapped as CollectionReport;
  }
  
  // ⭐ TRANSFORMATION DES VALEURS AVEC TYPES CORRECTS
  private static transformValue(value: any, fieldName: string): any {
    // Gestion des valeurs nulles/vides
    if (value === null || value === undefined || 
        (typeof value === 'number' && isNaN(value)) ||
        (typeof value === 'string' && value.trim() === '')) {
      return null;
    }
    
    console.log(`🔍 Transforming ${fieldName}: ${value} (type: ${typeof value})`);
    
    // ⭐ TRANSFORMATION PAR TYPE DE CHAMP
    switch (fieldName) {
      // Dates
      case 'reportDate':
      case 'dateOfValidity':
      case 'dateOfImpay':
      case 'reglementImpaye':
        return this.transformDate(value);
      
      // Nombres décimaux
      case 'collectionAmount':
      case 'taux':
      case 'interet':
      case 'commission':
      case 'tob':
      case 'fraisEscompte':
      case 'bankCommission':
      case 'dNAmount':
      case 'income':
        return this.transformDecimal(value);
      
      // Entiers
      case 'nj':
        return this.transformInteger(value);
      
      // Texte (y compris factureNo qui peut être string)
      default:
        return this.transformText(value);
    }
  }
  
  // ⭐ TRANSFORMATION DES DATES
  private static transformDate(value: any): string | null {
    if (!value) return null;
    
    try {
      // Si c'est déjà un objet Date
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // Format YYYY-MM-DD
      }
      
      // Si c'est un timestamp Excel/pandas (nombre de jours depuis 1900)
      if (typeof value === 'number') {
        // Excel compte les jours depuis le 1er janvier 1900
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000); // -2 pour ajustement Excel
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
      
      // Si c'est une string ISO
      if (typeof value === 'string') {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
      
      console.warn('⚠️ Date non reconnu:', value, typeof value);
      return null;
    } catch (error) {
      console.warn('⚠️ Erreur transformation date:', value, error);
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DES DÉCIMAUX
  private static transformDecimal(value: any): number | null {
    if (value === null || value === undefined) return null;
    
    try {
      // Si c'est déjà un nombre
      if (typeof value === 'number') {
        return isNaN(value) ? null : value;
      }
      
      // Si c'est une string, nettoyer et convertir
      if (typeof value === 'string') {
        const cleanValue = value.replace(/[^\d.-]/g, ''); // Garder seulement chiffres, point et moins
        const num = parseFloat(cleanValue);
        return isNaN(num) ? null : num;
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DES ENTIERS
  private static transformInteger(value: any): number | null {
    if (value === null || value === undefined) return null;
    
    try {
      if (typeof value === 'number') {
        return isNaN(value) ? null : Math.floor(value);
      }
      
      if (typeof value === 'string') {
        const cleanValue = value.replace(/[^\d-]/g, '');
        const num = parseInt(cleanValue, 10);
        return isNaN(num) ? null : num;
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DU TEXTE
  private static transformText(value: any): string | null {
    if (value === null || value === undefined) return null;
    
    try {
      const text = String(value).trim();
      return text === '' ? null : text;
    } catch {
      return null;
    }
  }

  // ⭐ ANALYSE DES COLONNES DÉTECTÉES
  static analyzeExcelColumns(headers: string[]): {
    recognized: string[];
    unrecognized: string[];
    mapping: { [key: string]: string };
  } {
    const recognized: string[] = [];
    const unrecognized: string[] = [];
    const mapping: { [key: string]: string } = {};
    
    headers.forEach(header => {
      const mappedField = this.COLUMN_MAPPING[header];
      if (mappedField) {
        recognized.push(header);
        mapping[header] = mappedField;
      } else {
        unrecognized.push(header);
      }
    });
    
    return { recognized, unrecognized, mapping };
  }
}

export const excelMappingService = ExcelToSupabaseMapper;
