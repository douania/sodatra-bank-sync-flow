
import { CollectionReport } from '@/types/banking';

export class ExcelToSupabaseMapper {
  
  // ⭐ MAPPING EXACT DES COLONNES AVEC TOUS LES CARACTÈRES SPÉCIAUX
  private static readonly COLUMN_MAPPING = {
    // ⭐ COLONNES PRINCIPALES
    "DATE": "reportDate",
    "FACTURE N°": "factureNo",                    // ⚠️ Caractère spécial °
    "CLIENT NAME": "clientCode",                  // ⭐ CORRECTION: CLIENT NAME → clientCode
    "CLIENT CODE": "clientCode",                  // ⭐ FALLBACK: si CLIENT CODE existe aussi
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
    
    // ⭐ AJOUT DES MÉTADONNÉES AVEC DATE INTELLIGENTE
    if (!mapped.reportDate) {
      // Essayer d'extraire la date des données ou utiliser la date actuelle
      const extractedDate = this.extractDateFromRow(excelRow);
      mapped.reportDate = extractedDate || new Date().toISOString().split('T')[0];
    }
    
    console.log(`📋 [${rowNumber}] Objet mappé avant validation:`, mapped);
    
    // ⭐⭐ VALIDATION ULTRA-PERMISSIVE DU CLIENT CODE
    if (!mapped.clientCode || mapped.clientCode.toString().trim() === '') {
      // ⭐ LOGS DÉTAILLÉS POUR DEBUG
      console.log(`🔍 [${rowNumber}] CLIENT CODE manquant, recherche alternatives:`, {
        clientCodeValue: mapped.clientCode,
        clientNameFromExcel: excelRow["CLIENT NAME"],
        clientCodeFromExcel: excelRow["CLIENT CODE"],
        availableColumns: Object.keys(excelRow)
      });
      
      // ⭐ MULTIPLES TENTATIVES DE FALLBACK
      const fallbackOptions = [
        excelRow["CLIENT NAME"],
        excelRow["CLIENT CODE"], 
        excelRow["REFERENCE"],
        excelRow["DEPO.REF"],
        excelRow["SG or FA N°"],
        // Dernier recours: générer un code basé sur d'autres données
        `AUTO_${rowNumber}_${(excelRow["BANK"] || 'UNK').substring(0,3)}`
      ];
      
      let fallbackClientCode = null;
      for (const option of fallbackOptions) {
        if (option && option.toString().trim() !== '') {
          fallbackClientCode = option.toString().trim();
          console.log(`✅ [${rowNumber}] CLIENT CODE trouvé via fallback: "${fallbackClientCode}"`);
          break;
        }
      }
      
      if (fallbackClientCode) {
        mapped.clientCode = fallbackClientCode;
      } else {
        // ⭐ GÉNÉRATION AUTOMATIQUE si vraiment aucune donnée
        mapped.clientCode = `UNKNOWN_${rowNumber}_${Date.now().toString().slice(-6)}`;
        console.warn(`🔄 [${rowNumber}] CLIENT CODE généré automatiquement: "${mapped.clientCode}"`);
      }
    }
    
    // ⭐ VALIDATION TRÈS PERMISSIVE DU MONTANT
    if (!mapped.collectionAmount && mapped.collectionAmount !== 0) {
      console.log(`🔍 [${rowNumber}] COLLECTION AMOUNT manquant, recherche alternatives:`, {
        collectionAmountValue: mapped.collectionAmount,
        amountFromExcel: excelRow["AMOUNT "],
        amountAltFromExcel: excelRow["MONTANT"],
        incomeFromExcel: excelRow["INCOME "],
        dNAmountFromExcel: excelRow["D.NAmount"]
      });
      
      // ⭐ MULTIPLES TENTATIVES DE FALLBACK POUR LE MONTANT
      const amountFallbacks = [
        excelRow["AMOUNT "],
        excelRow["MONTANT"],
        excelRow["INCOME "],
        excelRow["D.NAmount"]
      ];
      
      let fallbackAmount = null;
      for (const amountOption of amountFallbacks) {
        const transformedAmount = this.transformDecimal(amountOption);
        if (transformedAmount !== null && !isNaN(transformedAmount)) {
          fallbackAmount = transformedAmount;
          console.log(`✅ [${rowNumber}] AMOUNT trouvé via fallback: ${fallbackAmount}`);
          break;
        }
      }
      
      if (fallbackAmount !== null) {
        mapped.collectionAmount = fallbackAmount;
      } else {
        // ⭐ SI VRAIMENT AUCUN MONTANT, UTILISER 0 (au lieu de rejeter)
        mapped.collectionAmount = 0;
        console.warn(`⚠️ [${rowNumber}] AMOUNT défini à 0 (aucune valeur trouvée)`);
      }
    }
    
    // ⭐ AJOUT DE LA BANQUE SI MANQUANTE
    if (!mapped.bankName) {
      const bankFallbacks = [
        excelRow["BANK"],
        excelRow["BANQUE"],
        excelRow["BANK NAME"],
        "UNKNOWN_BANK"
      ];
      
      for (const bankOption of bankFallbacks) {
        if (bankOption && bankOption.toString().trim() !== '') {
          mapped.bankName = bankOption.toString().trim();
          break;
        }
      }
    }
    
    console.log(`✅ [${rowNumber}] Validation PERMISSIVE réussie pour CLIENT: "${mapped.clientCode}", AMOUNT: ${mapped.collectionAmount}, BANK: "${mapped.bankName}"`);
    
    return mapped as CollectionReport;
  }
  
  // ⭐ NOUVELLE FONCTION: EXTRACTION INTELLIGENTE DE DATE
  private static extractDateFromRow(excelRow: any): string | null {
    const dateFields = [
      excelRow["DATE"],
      excelRow["Date of VAlidity"],
      excelRow["date_of_validity"],
      excelRow["REPORTDATE"]
    ];
    
    for (const dateValue of dateFields) {
      if (dateValue) {
        const transformedDate = this.transformDate(dateValue);
        if (transformedDate) {
          return transformedDate;
        }
      }
    }
    
    return null;
  }
  
  // ⭐ TRANSFORMATION DES VALEURS AVEC TYPES CORRECTS
  private static transformValue(value: any, fieldName: string): any {
    // ⭐ GESTION PLUS PERMISSIVE DES VALEURS NULLES/VIDES
    if (value === null || value === undefined) {
      return null;
    }
    
    // ⭐ ACCEPTER LES NOMBRES NaN pour certains champs (les transformer en null)
    if (typeof value === 'number' && isNaN(value)) {
      return null;
    }
    
    // ⭐ ACCEPTER LES STRINGS VIDES POUR CERTAINS CHAMPS (optionnels)
    if (typeof value === 'string' && value.trim() === '') {
      // Pour les champs obligatoires, garder une valeur vide
      // Pour les champs optionnels, retourner null
      const optionalFields = ['factureNo', 'noChqBd', 'depoRef', 'sgOrFaNo', 'remarques'];
      return optionalFields.includes(fieldName) ? null : value;
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
      
      // Nombres décimaux (TRÈS PERMISSIFS)
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
  
  // ⭐ TRANSFORMATION DES DATES ULTRA-PERMISSIVE
  private static transformDate(value: any): string | null {
    if (!value) return null;
    
    try {
      // Si c'est déjà un objet Date
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // Format YYYY-MM-DD
      }
      
      // Si c'est un timestamp Excel/pandas (nombre de jours depuis 1900)
      if (typeof value === 'number' && value > 0) {
        // Excel compte les jours depuis le 1er janvier 1900
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000); // -2 pour ajustement Excel
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
          return date.toISOString().split('T')[0];
        }
      }
      
      // Si c'est une string ISO ou format standard
      if (typeof value === 'string') {
        // Nettoyer la string si nécessaire
        const cleanValue = value.trim();
        const date = new Date(cleanValue);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
          return date.toISOString().split('T')[0];
        }
        
        // Essayer les formats DD/MM/YYYY ou MM/DD/YYYY
        const datePatterns = [
          /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
          /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
          /^(\d{1,2})-(\d{1,2})-(\d{4})$/
        ];
        
        for (const pattern of datePatterns) {
          const match = cleanValue.match(pattern);
          if (match) {
            const [, first, second, year] = match;
            // Essayer DD/MM/YYYY puis MM/DD/YYYY
            const dateOption1 = new Date(parseInt(year), parseInt(second) - 1, parseInt(first));
            const dateOption2 = new Date(parseInt(year), parseInt(first) - 1, parseInt(second));
            
            if (!isNaN(dateOption1.getTime()) && dateOption1.getFullYear() > 1900) {
              return dateOption1.toISOString().split('T')[0];
            }
            if (!isNaN(dateOption2.getTime()) && dateOption2.getFullYear() > 1900) {
              return dateOption2.toISOString().split('T')[0];
            }
          }
        }
      }
      
      console.warn('⚠️ Date non reconnue (acceptée comme null):', value, typeof value);
      return null;
    } catch (error) {
      console.warn('⚠️ Erreur transformation date (acceptée comme null):', value, error);
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DES DÉCIMAUX ULTRA-PERMISSIVE
  private static transformDecimal(value: any): number | null {
    if (value === null || value === undefined) return null;
    
    try {
      // Si c'est déjà un nombre
      if (typeof value === 'number') {
        // ⭐ ACCEPTER MÊME LES NaN (les convertir en null)
        return isNaN(value) ? null : value;
      }
      
      // Si c'est une string, nettoyer et convertir (TRÈS PERMISSIF)
      if (typeof value === 'string') {
        const cleanValue = value
          .replace(/[^\d.-]/g, '') // Garder seulement chiffres, point et moins
          .replace(/\.+/g, '.') // Supprimer les multiples points
          .replace(/-+/g, '-'); // Supprimer les multiples moins
        
        if (cleanValue === '' || cleanValue === '.' || cleanValue === '-') {
          return null;
        }
        
        const num = parseFloat(cleanValue);
        return isNaN(num) ? null : num;
      }
      
      // Essayer de convertir tout autre type
      const num = Number(value);
      return isNaN(num) ? null : num;
    } catch {
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DES ENTIERS PERMISSIVE
  private static transformInteger(value: any): number | null {
    if (value === null || value === undefined) return null;
    
    try {
      if (typeof value === 'number') {
        return isNaN(value) ? null : Math.floor(value);
      }
      
      if (typeof value === 'string') {
        const cleanValue = value.replace(/[^\d-]/g, '');
        if (cleanValue === '' || cleanValue === '-') return null;
        
        const num = parseInt(cleanValue, 10);
        return isNaN(num) ? null : num;
      }
      
      const num = Number(value);
      return isNaN(num) ? null : Math.floor(num);
    } catch {
      return null;
    }
  }
  
  // ⭐ TRANSFORMATION DU TEXTE PERMISSIVE
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
    
    // ⭐ LOGS DÉTAILLÉS DU MAPPING
    console.log('🗺️ ANALYSE DÉTAILLÉE DES COLONNES:');
    console.log('✅ Reconnues:', recognized);
    console.log('❌ Non reconnues:', unrecognized);
    console.log('🔗 Mapping complet:', mapping);
    
    return { recognized, unrecognized, mapping };
  }
}

export const excelMappingService = ExcelToSupabaseMapper;
