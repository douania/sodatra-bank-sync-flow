
import { PDFLine, PDFSection } from './enhancedPDFExtraction';

export interface ColumnMapping {
  date?: number;
  checkNumber?: number;
  description?: number;
  client?: number;
  reference?: number;
  amount?: number;
  dateOperation?: number;
  dateValeur?: number;
  vendor?: number;
}

export interface ParsedCheckRow {
  date: string;
  checkNumber: string;
  description: string;
  client?: string;
  reference?: string;
  amount: number;
  rawColumns: string[];
}

export interface ParsedDepositRow {
  dateOperation: string;
  dateValeur: string;
  description: string;
  vendor: string;
  client: string;
  amount: number;
  rawColumns: string[];
}

export class BDKColumnDetector {
  
  /**
   * Détecte la structure des colonnes pour les chèques
   */
  detectCheckColumns(section: PDFSection): ColumnMapping {
    console.log('🔍 Détection colonnes chèques BDK...');
    
    const mapping: ColumnMapping = {};
    
    // Chercher la ligne d'en-tête
    const headerLine = section.lines.find(line => 
      this.isCheckHeaderLine(line.fullText)
    );
    
    if (headerLine && headerLine.columns.length >= 4) {
      console.log(`📋 En-têtes trouvés: [${headerLine.columns.join(' | ')}]`);
      
      // Mapping basé sur les mots-clés dans les en-têtes
      headerLine.columns.forEach((header, index) => {
        const upperHeader = header.toUpperCase();
        
        if (upperHeader.includes('DATE') && !mapping.date) {
          mapping.date = index;
        } else if (upperHeader.includes('CHECK') || upperHeader.includes('CHQ')) {
          mapping.checkNumber = index;
        } else if (upperHeader.includes('DESCRIPTION')) {
          mapping.description = index;
        } else if (upperHeader.includes('CLIENT')) {
          mapping.client = index;
        } else if (upperHeader.includes('REFERENCE') || upperHeader.includes('REF')) {
          mapping.reference = index;
        } else if (upperHeader.includes('AMOUNT')) {
          mapping.amount = index;
        }
      });
    } else {
      // Mapping par défaut basé sur l'ordre typique BDK
      console.log('📋 Utilisation du mapping par défaut pour chèques');
      mapping.date = 0;
      mapping.checkNumber = 1;
      mapping.description = 2;
      mapping.client = 3;
      mapping.reference = 4;
      mapping.amount = 5;
    }
    
    console.log(`✅ Mapping chèques: ${JSON.stringify(mapping)}`);
    return mapping;
  }
  
  /**
   * Détecte la structure des colonnes pour les dépôts
   */
  detectDepositColumns(section: PDFSection): ColumnMapping {
    console.log('🔍 Détection colonnes dépôts BDK...');
    
    const mapping: ColumnMapping = {};
    
    // Chercher la ligne d'en-tête
    const headerLine = section.lines.find(line => 
      this.isDepositHeaderLine(line.fullText)
    );
    
    if (headerLine && headerLine.columns.length >= 5) {
      console.log(`📋 En-têtes trouvés: [${headerLine.columns.join(' | ')}]`);
      
      headerLine.columns.forEach((header, index) => {
        const upperHeader = header.toUpperCase();
        
        if (upperHeader.includes('DATE') && upperHeader.includes('OPERATION')) {
          mapping.dateOperation = index;
        } else if (upperHeader.includes('DATE') && upperHeader.includes('VALEUR')) {
          mapping.dateValeur = index;
        } else if (upperHeader.includes('DATE') && !mapping.dateOperation) {
          mapping.dateOperation = index;
        } else if (upperHeader.includes('DESCRIPTION')) {
          mapping.description = index;
        } else if (upperHeader.includes('VENDOR')) {
          mapping.vendor = index;
        } else if (upperHeader.includes('CLIENT')) {
          mapping.client = index;
        } else if (upperHeader.includes('AMOUNT') || upperHeader.includes('MONTANT')) {
          mapping.amount = index;
        }
      });
    } else {
      // Mapping par défaut
      console.log('📋 Utilisation du mapping par défaut pour dépôts');
      mapping.dateOperation = 0;
      mapping.dateValeur = 1;
      mapping.description = 2;
      mapping.vendor = 3;
      mapping.client = 4;
      mapping.amount = 5;
    }
    
    console.log(`✅ Mapping dépôts: ${JSON.stringify(mapping)}`);
    return mapping;
  }
  
  /**
   * Parse les chèques d'une section avec la structure de colonnes détectée
   */
  parseChecks(section: PDFSection): ParsedCheckRow[] {
    const mapping = this.detectCheckColumns(section);
    const checks: ParsedCheckRow[] = [];
    
    console.log(`🔍 Parsing ${section.lines.length} lignes de chèques...`);
    
    for (const line of section.lines) {
      if (this.isCheckDataLine(line)) {
        const parsed = this.parseCheckLine(line, mapping);
        if (parsed) {
          checks.push(parsed);
          console.log(`✅ Chèque: ${parsed.date} - ${parsed.checkNumber} - ${parsed.amount.toLocaleString()} FCFA`);
        }
      }
    }
    
    console.log(`✅ ${checks.length} chèques parsés`);
    return checks;
  }
  
  /**
   * Parse les dépôts d'une section avec la structure de colonnes détectée
   */
  parseDeposits(section: PDFSection): ParsedDepositRow[] {
    const mapping = this.detectDepositColumns(section);
    const deposits: ParsedDepositRow[] = [];
    
    console.log(`🔍 Parsing ${section.lines.length} lignes de dépôts...`);
    
    for (const line of section.lines) {
      if (this.isDepositDataLine(line)) {
        const parsed = this.parseDepositLine(line, mapping);
        if (parsed) {
          deposits.push(parsed);
          console.log(`✅ Dépôt: ${parsed.dateOperation} - ${parsed.client} - ${parsed.amount.toLocaleString()} FCFA`);
        }
      }
    }
    
    console.log(`✅ ${deposits.length} dépôts parsés`);
    return deposits;
  }
  
  /**
   * Parse une ligne de chèque selon le mapping des colonnes
   */
  private parseCheckLine(line: PDFLine, mapping: ColumnMapping): ParsedCheckRow | null {
    const cols = line.columns;
    
    if (cols.length < 4) return null;
    
    try {
      // Extraire les données selon le mapping
      const date = cols[mapping.date || 0] || '';
      const checkNumber = cols[mapping.checkNumber || 1] || '';
      const description = cols[mapping.description || 2] || '';
      const client = cols[mapping.client || 3] || '';
      const reference = cols[mapping.reference || 4] || '';
      
      // Pour le montant, analyser intelligemment
      let amount = 0;
      const amountColumnIndex = mapping.amount || (cols.length - 1);
      
      if (amountColumnIndex < cols.length) {
        const amountColumn = cols[amountColumnIndex];
        
        if (amountColumn && amountColumn.trim()) {
          // Colonne AMOUNT non vide
          amount = this.parseAmount(amountColumn);
        } else {
          // Colonne AMOUNT vide, chercher dans la description
          console.log(`⚠️ Colonne AMOUNT vide pour chèque ${checkNumber}, analyse de la ligne complète`);
          amount = this.extractAmountFromFullLine(line.fullText);
        }
      }
      
      return {
        date: date.trim(),
        checkNumber: checkNumber.trim(),
        description: description.trim(),
        client: client.trim() || undefined,
        reference: reference.trim() || undefined,
        amount,
        rawColumns: cols
      };
      
    } catch (error) {
      console.error(`❌ Erreur parsing ligne chèque: ${line.fullText}`, error);
      return null;
    }
  }
  
  /**
   * Parse une ligne de dépôt selon le mapping des colonnes
   */
  private parseDepositLine(line: PDFLine, mapping: ColumnMapping): ParsedDepositRow | null {
    const cols = line.columns;
    
    if (cols.length < 5) return null;
    
    try {
      const dateOperation = cols[mapping.dateOperation || 0] || '';
      const dateValeur = cols[mapping.dateValeur || 1] || '';
      const description = cols[mapping.description || 2] || '';
      const vendor = cols[mapping.vendor || 3] || '';
      const client = cols[mapping.client || 4] || '';
      
      let amount = 0;
      const amountColumnIndex = mapping.amount || (cols.length - 1);
      
      if (amountColumnIndex < cols.length) {
        amount = this.parseAmount(cols[amountColumnIndex]);
      }
      
      return {
        dateOperation: dateOperation.trim(),
        dateValeur: dateValeur.trim(),
        description: description.trim(),
        vendor: vendor.trim(),
        client: client.trim(),
        amount,
        rawColumns: cols
      };
      
    } catch (error) {
      console.error(`❌ Erreur parsing ligne dépôt: ${line.fullText}`, error);
      return null;
    }
  }
  
  /**
   * Extrait un montant depuis une ligne complète quand la colonne AMOUNT est vide
   */
  private extractAmountFromFullLine(fullText: string): number {
    // Stratégie : identifier tous les nombres et prendre les derniers comme montant
    const allNumbers = fullText.match(/\d+/g) || [];
    
    if (allNumbers.length >= 2) {
      // Cas typique : "... JADO 100334 71 176 FCFA"
      // Les derniers nombres avant FCFA constituent le montant
      const lastTwoNumbers = allNumbers.slice(-2);
      const potentialAmount = parseInt(lastTwoNumbers.join(''));
      
      if (potentialAmount > 100) { // Seuil de validation
        console.log(`💰 Montant extrait de la ligne complète: ${potentialAmount.toLocaleString()} FCFA`);
        return potentialAmount;
      }
    }
    
    if (allNumbers.length === 1) {
      const singleAmount = parseInt(allNumbers[0]);
      if (singleAmount > 100) {
        return singleAmount;
      }
    }
    
    console.log(`⚠️ Aucun montant valide trouvé dans: "${fullText}"`);
    return 0;
  }
  
  /**
   * Parse un montant avec gestion des espaces et formats BDK
   */
  private parseAmount(amountStr: string): number {
    if (!amountStr || !amountStr.trim()) return 0;
    
    try {
      // Nettoyer : garder seulement chiffres et espaces
      const numbers = amountStr.match(/\d+/g);
      if (!numbers || numbers.length === 0) return 0;
      
      // Si plusieurs nombres, les concaténer (ex: "123 870" → "123870")
      const cleaned = numbers.join('');
      const result = parseInt(cleaned, 10) || 0;
      
      console.log(`💰 Montant parsé: "${amountStr}" → ${result.toLocaleString()}`);
      return result;
      
    } catch (error) {
      console.error('❌ Erreur parsing montant:', amountStr, error);
      return 0;
    }
  }
  
  // Méthodes de validation des lignes
  private isCheckHeaderLine(text: string): boolean {
    const upper = text.toUpperCase();
    return upper.includes('DATE') && 
           (upper.includes('CHECK') || upper.includes('CHQ')) && 
           upper.includes('DESCRIPTION');
  }
  
  private isDepositHeaderLine(text: string): boolean {
    const upper = text.toUpperCase();
    return upper.includes('DATE') && 
           upper.includes('DESCRIPTION') && 
           upper.includes('VENDOR');
  }
  
  private isCheckDataLine(line: PDFLine): boolean {
    return line.columns.length >= 3 &&
           /^\d{2}\/\d{2}\/\d{4}$/.test(line.columns[0]?.trim() || '') &&
           !this.isCheckHeaderLine(line.fullText) &&
           !line.fullText.toUpperCase().includes('TOTAL');
  }
  
  private isDepositDataLine(line: PDFLine): boolean {
    return line.columns.length >= 4 &&
           /^\d{2}\/\d{2}\/\d{4}$/.test(line.columns[0]?.trim() || '') &&
           !this.isDepositHeaderLine(line.fullText) &&
           !line.fullText.toUpperCase().includes('TOTAL');
  }
}

export const bdkColumnDetector = new BDKColumnDetector();
