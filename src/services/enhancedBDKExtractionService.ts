import { bdkExtractionService, BDKParsedData } from './bdkExtractionService';
import { positionalExtractionService, PositionalData, TextItem, TableData } from './positionalExtractionService';

export interface EnhancedBDKResult {
  basicExtraction: BDKParsedData;
  positionalExtraction: BDKParsedData;
  isPositionalBetter: boolean;
  confidence: 'high' | 'medium' | 'low';
  detectedTables: TableData[];
  debugInfo: {
    basicDepositsCount: number;
    positionalDepositsCount: number;
    basicChecksCount: number;
    positionalChecksCount: number;
    extractionMethod: string;
    timestamp: string;
  };
}

export class EnhancedBDKExtractionService {
  
  /**
   * Extraction BDK avec comparaison entre méthode basique et positionnelle
   */
  async extractBDKWithPositional(file: File): Promise<EnhancedBDKResult> {
    console.log('🔍 [Enhanced BDK] Début de l\'extraction avec comparaison');
    
    // Extraction basique (existante)
    const basicText = await this.extractTextFromPDF(file);
    const basicExtraction = bdkExtractionService.extractBDKData(basicText);
    console.log('📊 [Enhanced BDK] Extraction basique terminée:', {
      deposits: basicExtraction.deposits.length,
      checks: basicExtraction.checks.length,
      validation: basicExtraction.validation.isValid
    });
    
    // Extraction positionnelle
    const positionalData = await positionalExtractionService.extractPositionalData(file);
    const positionalExtraction = await this.extractBDKFromPositional(positionalData);
    console.log('🎯 [Enhanced BDK] Extraction positionnelle terminée:', {
      deposits: positionalExtraction.deposits.length,
      checks: positionalExtraction.checks.length,
      validation: positionalExtraction.validation.isValid
    });
    
    // Comparaison et sélection de la meilleure méthode
    const comparison = this.compareExtractions(basicExtraction, positionalExtraction);
    
    const debugInfo = {
      basicDepositsCount: basicExtraction.deposits.length,
      positionalDepositsCount: positionalExtraction.deposits.length,
      basicChecksCount: basicExtraction.checks.length,
      positionalChecksCount: positionalExtraction.checks.length,
      extractionMethod: comparison.isPositionalBetter ? 'Positionnelle' : 'Basique',
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ [Enhanced BDK] Résultat final:', {
      selectedMethod: debugInfo.extractionMethod,
      confidence: comparison.confidence,
      debugInfo
    });
    
    return {
      basicExtraction,
      positionalExtraction,
      isPositionalBetter: comparison.isPositionalBetter,
      confidence: comparison.confidence,
      detectedTables: positionalData.flatMap(page => page.tables),
      debugInfo
    };
  }
  
  /**
   * Extraction BDK à partir de données positionnelles
   */
  private async extractBDKFromPositional(positionalData: PositionalData[]): Promise<BDKParsedData> {
    if (positionalData.length === 0) {
      throw new Error('Aucune donnée positionnelle disponible');
    }
    
    console.log('🔧 [Positional] Traitement de', positionalData.length, 'pages de données');
    
    // Combiner tous les éléments de toutes les pages
    const allItems = positionalData.flatMap(page => page.items);
    console.log('📝 [Positional] Total éléments à traiter:', allItems.length);
    
    // Extraire les sections spécifiques avec l'extraction positionnelle
    const openingBalanceItems = this.extractOpeningBalanceSection(allItems);
    const depositsItems = this.extractDepositsSection(allItems);
    const checksItems = this.extractChecksSection(allItems);
    const facilitiesItems = this.extractFacilitiesSection(allItems);
    const impayesItems = this.extractImpayesSection(allItems);
    
    console.log('📋 [Positional] Sections extraites:', {
      openingBalance: openingBalanceItems.length,
      deposits: depositsItems.length,
      checks: checksItems.length,
      facilities: facilitiesItems.length,
      impayes: impayesItems.length
    });
    
    // Traiter chaque section
    const openingBalance = this.processOpeningBalance(openingBalanceItems);
    const deposits = this.processDeposits(depositsItems);
    const checks = this.processChecks(checksItems);
    const facilities = this.processFacilities(facilitiesItems);
    const impayes = this.processImpayes(impayesItems);
    
    console.log('⚡ [Positional] Sections traitées:', {
      depositsCount: deposits.length,
      checksCount: checks.length,
      facilitiesCount: facilities.length,
      impayesCount: impayes.length
    });
    
    // Extraire la date du rapport
    const reportDate = this.extractReportDate(allItems);
    
    // Calculer les totaux
    const totalDeposits = deposits.reduce((sum, dep) => sum + dep.amount, 0);
    const totalChecks = checks.reduce((sum, chk) => sum + chk.amount, 0);
    const totalBalanceA = openingBalance.amount + totalDeposits;
    const closingBalance = this.extractClosingBalance(allItems);
    
    // Validation
    const calculatedClosing = totalBalanceA - totalChecks;
    const isValid = Math.abs(calculatedClosing - closingBalance) < 1000;
    const discrepancy = calculatedClosing - closingBalance;
    
    const result = {
      reportDate,
      openingBalance,
      deposits,
      totalDeposits,
      totalBalanceA,
      checks,
      totalChecks,
      closingBalance,
      facilities,
      totalFacilities: {
        totalLimit: facilities.reduce((sum, f) => sum + f.limit, 0),
        totalUsed: facilities.reduce((sum, f) => sum + f.used, 0),
        totalBalance: facilities.reduce((sum, f) => sum + f.balance, 0)
      },
      impayes,
      validation: {
        calculatedClosing,
        isValid,
        discrepancy
      }
    };
    
    console.log('🎯 [Positional] Résultat final généré:', {
      deposits: result.deposits.length,
      checks: result.checks.length,
      totalDeposits: result.totalDeposits,
      totalChecks: result.totalChecks,
      validation: result.validation
    });
    
    return result;
  }
  
  /**
   * Extrait la section du solde d'ouverture
   */
  private extractOpeningBalanceSection(items: TextItem[]): TextItem[] {
    console.log('🔍 [Sections] Recherche section OPENING BALANCE...');
    const section = positionalExtractionService.extractSection(items, 'OPENING BALANCE');
    console.log(`📋 [Sections] Section OPENING BALANCE: ${section.length} éléments trouvés`);
    return section;
  }
  
  /**
   * Extrait la section des dépôts - CORRIGÉ
   */
  private extractDepositsSection(items: TextItem[]): TextItem[] {
    console.log('🔍 [Sections] Recherche section DEPOSIT NOT YET CLEARED...');
    // Utiliser les bons mots-clés vus dans les logs
    const section = positionalExtractionService.extractSection(items, 'DEPOSIT NOT YET CLEARED', 'TOTAL DEPOSIT');
    console.log(`📋 [Sections] Section DEPOSITS: ${section.length} éléments trouvés`);
    
    if (section.length === 0) {
      console.log('⚠️ [Sections] Tentative avec mots-clés alternatifs pour les dépôts...');
      // Essayer des variations alternatives
      const altSection = positionalExtractionService.extractSection(items, 'ADD : DEPOSIT NOT YET CLEARED', 'TOTAL DEPOSIT');
      console.log(`📋 [Sections] Section DEPOSITS (alternative): ${altSection.length} éléments trouvés`);
      return altSection;
    }
    
    return section;
  }
  
  /**
   * Extrait la section des chèques - CORRIGÉ
   */
  private extractChecksSection(items: TextItem[]): TextItem[] {
    console.log('🔍 [Sections] Recherche section CHECK NOT YET CLEARED...');
    // Utiliser les bons mots-clés vus dans les logs
    const section = positionalExtractionService.extractSection(items, 'CHECK NOT YET CLEARED', 'TOTAL (B)');
    console.log(`📋 [Sections] Section CHECKS: ${section.length} éléments trouvés`);
    
    if (section.length === 0) {
      console.log('⚠️ [Sections] Tentative avec mots-clés alternatifs pour les chèques...');
      // Essayer des variations alternatives
      const altSection = positionalExtractionService.extractSection(items, 'LESS : CHECK NOT YET CLEARED', 'TOTAL (B)');
      console.log(`📋 [Sections] Section CHECKS (alternative): ${altSection.length} éléments trouvés`);
      return altSection;
    }
    
    return section;
  }
  
  /**
   * Extrait la section des facilités - CORRIGÉ
   */
  private extractFacilitiesSection(items: TextItem[]): TextItem[] {
    console.log('🔍 [Sections] Recherche section BANK FACILITY...');
    const section = positionalExtractionService.extractSection(items, 'BANK FACILITY');
    console.log(`📋 [Sections] Section BANK FACILITY: ${section.length} éléments trouvés`);
    return section;
  }
  
  /**
   * Extrait la section des impayés
   */
  private extractImpayesSection(items: TextItem[]): TextItem[] {
    return positionalExtractionService.extractSection(items, 'IMPAYE');
  }
  
  /**
   * Traite la section du solde d'ouverture
   */
  private processOpeningBalance(items: TextItem[]) {
    const text = positionalExtractionService.itemsToStructuredText(items);
    return bdkExtractionService['extractOpeningBalance'](text);
  }
  
  /**
   * Traite la section des dépôts avec une meilleure détection positionnelle
   */
  private processDeposits(items: TextItem[]) {
    console.log('💰 [Deposits] Traitement de', items.length, 'éléments pour les dépôts');
    
    // Grouper les éléments par lignes basées sur la position Y
    const rows = this.groupItemsByRows(items);
    console.log('📊 [Deposits]', rows.length, 'lignes détectées');
    
    const deposits = [];
    
    for (const row of rows) {
      // Trier les éléments de la ligne par position X
      const sortedItems = row.sort((a, b) => a.x - b.x);
      
      // Essayer d'identifier les colonnes : Date1, Date2, Description, Vendor, Client, Montant
      if (sortedItems.length >= 6) {
        const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
        const amountPattern = /^\d+(\s+\d+)*$/;
        
        // Vérifier si c'est une ligne de dépôt valide
        if (datePattern.test(sortedItems[0].text) && 
            datePattern.test(sortedItems[1].text) &&
            amountPattern.test(sortedItems[sortedItems.length - 1].text)) {
          
          const deposit = {
            dateOperation: sortedItems[0].text,
            dateValeur: sortedItems[1].text,
            description: sortedItems.slice(2, -3).map(item => item.text).join(' '),
            vendor: sortedItems[sortedItems.length - 3].text,
            client: sortedItems[sortedItems.length - 2].text,
            amount: this.parseAmount(sortedItems[sortedItems.length - 1].text)
          };
          
          console.log('✅ [Deposits] Dépôt valide trouvé:', {
            date: deposit.dateOperation,
            amount: deposit.amount,
            client: deposit.client
          });
          
          deposits.push(deposit);
        }
      }
    }
    
    console.log('💰 [Deposits] Total dépôts extraits:', deposits.length);
    return deposits;
  }
  
  /**
   * Traite la section des chèques avec une meilleure détection positionnelle
   */
  private processChecks(items: TextItem[]) {
    console.log('💳 [Checks] Traitement de', items.length, 'éléments pour les chèques');
    
    const rows = this.groupItemsByRows(items);
    console.log('📊 [Checks]', rows.length, 'lignes détectées');
    
    const checks = [];
    
    for (const row of rows) {
      const sortedItems = row.sort((a, b) => a.x - b.x);
      
      if (sortedItems.length >= 3) {
        const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
        const checkPattern = /^\d+$/;
        
        if (datePattern.test(sortedItems[0].text) && 
            checkPattern.test(sortedItems[1].text)) {
          
          // Chercher le montant (dernier élément numérique)
          let amount = 0;
          let description = '';
          
          for (let i = sortedItems.length - 1; i >= 2; i--) {
            const parsed = this.parseAmount(sortedItems[i].text);
            if (parsed > 0) {
              amount = parsed;
              description = sortedItems.slice(2, i).map(item => item.text).join(' ');
              break;
            }
          }
          
          const check = {
            date: sortedItems[0].text,
            checkNumber: sortedItems[1].text,
            description: description || 'N/A',
            client: '',
            reference: '',
            amount: amount
          };
          
          console.log('✅ [Checks] Chèque valide trouvé:', {
            date: check.date,
            number: check.checkNumber,
            amount: check.amount
          });
          
          checks.push(check);
        }
      }
    }
    
    console.log('💳 [Checks] Total chèques extraits:', checks.length);
    return checks;
  }
  
  /**
   * Traite les autres sections avec la méthode existante
   */
  private processFacilities(items: TextItem[]) {
    const text = positionalExtractionService.itemsToStructuredText(items);
    return bdkExtractionService['extractFacilities'](text).facilities;
  }
  
  private processImpayes(items: TextItem[]) {
    const text = positionalExtractionService.itemsToStructuredText(items);
    return bdkExtractionService['extractImpayes'](text);
  }
  
  private extractReportDate(items: TextItem[]): string {
    const dateItem = items.find(item => 
      /\d{2}\/\d{2}\/\d{4}/.test(item.text) && item.text.includes('BDK')
    );
    
    if (dateItem) {
      const match = dateItem.text.match(/(\d{2}\/\d{2}\/\d{4})/);
      return match?.[1] || new Date().toLocaleDateString('fr-FR');
    }
    
    return new Date().toLocaleDateString('fr-FR');
  }
  
  private extractClosingBalance(items: TextItem[]): number {
    const closingItem = items.find(item => 
      item.text.toUpperCase().includes('CLOSING BALANCE')
    );
    
    if (closingItem) {
      // Chercher le montant dans les éléments suivants
      const closingIndex = items.indexOf(closingItem);
      for (let i = closingIndex; i < Math.min(closingIndex + 5, items.length); i++) {
        const amount = this.parseAmount(items[i].text);
        if (amount > 0) {
          return amount;
        }
      }
    }
    
    return 0;
  }
  
  /**
   * Groupe les éléments par lignes basées sur la position Y
   */
  private groupItemsByRows(items: TextItem[]): TextItem[][] {
    const tolerance = 5;
    const rows: TextItem[][] = [];
    
    const sortedItems = [...items].sort((a, b) => a.y - b.y);
    
    let currentRow: TextItem[] = [];
    let currentY = -1;
    
    for (const item of sortedItems) {
      if (currentY === -1 || Math.abs(item.y - currentY) <= tolerance) {
        currentRow.push(item);
        currentY = item.y;
      } else {
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [item];
        currentY = item.y;
      }
    }
    
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }
    
    return rows;
  }
  
  /**
   * Parse un montant avec espaces
   */
  private parseAmount(amountStr: string): number {
    if (!amountStr) return 0;
    
    try {
      const cleaned = amountStr
        .replace(/[^\d\s]/g, '')
        .replace(/\s+/g, '');
      
      return parseInt(cleaned, 10) || 0;
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Compare les deux méthodes d'extraction
   */
  private compareExtractions(basic: BDKParsedData, positional: BDKParsedData) {
    let positionalScore = 0;
    let basicScore = 0;
    
    console.log('⚖️ [Comparison] Comparaison des méthodes:', {
      basic: { deposits: basic.deposits.length, checks: basic.checks.length, valid: basic.validation.isValid },
      positional: { deposits: positional.deposits.length, checks: positional.checks.length, valid: positional.validation.isValid }
    });
    
    // Comparer le nombre d'éléments extraits
    if (positional.deposits.length > basic.deposits.length) positionalScore++;
    else if (basic.deposits.length > positional.deposits.length) basicScore++;
    
    if (positional.checks.length > basic.checks.length) positionalScore++;
    else if (basic.checks.length > positional.checks.length) basicScore++;
    
    // Comparer la validation
    if (positional.validation.isValid && !basic.validation.isValid) positionalScore += 2;
    else if (basic.validation.isValid && !positional.validation.isValid) basicScore += 2;
    
    // Comparer la précision des montants
    if (Math.abs(positional.validation.discrepancy) < Math.abs(basic.validation.discrepancy)) {
      positionalScore++;
    } else {
      basicScore++;
    }
    
    const isPositionalBetter = positionalScore > basicScore;
    
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    const scoreDiff = Math.abs(positionalScore - basicScore);
    
    if (scoreDiff >= 3) confidence = 'high';
    else if (scoreDiff <= 1) confidence = 'low';
    
    console.log('🏆 [Comparison] Résultat:', {
      winner: isPositionalBetter ? 'Positionnelle' : 'Basique',
      scores: { positional: positionalScore, basic: basicScore },
      confidence
    });
    
    return { isPositionalBetter, confidence };
  }
  
  /**
   * Extrait le texte brut d'un PDF (méthode helper)
   */
  private async extractTextFromPDF(file: File): Promise<string> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
    
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText;
  }
}

export const enhancedBDKExtractionService = new EnhancedBDKExtractionService();
