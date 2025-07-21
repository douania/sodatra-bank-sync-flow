
import { bdkExtractionService, BDKParsedData } from './bdkExtractionService';
import { positionalExtractionService, PositionalData, TextItem, TableData } from './positionalExtractionService';

export interface EnhancedBDKResult {
  basicExtraction: BDKParsedData;
  positionalExtraction: BDKParsedData;
  isPositionalBetter: boolean;
  confidence: 'high' | 'medium' | 'low';
  detectedTables: TableData[];
}

export class EnhancedBDKExtractionService {
  
  /**
   * Extraction BDK avec comparaison entre méthode basique et positionnelle
   */
  async extractBDKWithPositional(file: File): Promise<EnhancedBDKResult> {
    // Extraction basique (existante)
    const basicText = await this.extractTextFromPDF(file);
    const basicExtraction = bdkExtractionService.extractBDKData(basicText);
    
    // Extraction positionnelle
    const positionalData = await positionalExtractionService.extractPositionalData(file);
    const positionalExtraction = await this.extractBDKFromPositional(positionalData);
    
    // Comparaison et sélection de la meilleure méthode
    const comparison = this.compareExtractions(basicExtraction, positionalExtraction);
    
    return {
      basicExtraction,
      positionalExtraction,
      isPositionalBetter: comparison.isPositionalBetter,
      confidence: comparison.confidence,
      detectedTables: positionalData.flatMap(page => page.tables)
    };
  }
  
  /**
   * Extraction BDK à partir de données positionnelles
   */
  private async extractBDKFromPositional(positionalData: PositionalData[]): Promise<BDKParsedData> {
    if (positionalData.length === 0) {
      throw new Error('Aucune donnée positionnelle disponible');
    }
    
    // Combiner tous les éléments de toutes les pages
    const allItems = positionalData.flatMap(page => page.items);
    
    // Extraire les sections spécifiques avec l'extraction positionnelle
    const openingBalanceItems = this.extractOpeningBalanceSection(allItems);
    const depositsItems = this.extractDepositsSection(allItems);
    const checksItems = this.extractChecksSection(allItems);
    const facilitiesItems = this.extractFacilitiesSection(allItems);
    const impayesItems = this.extractImpayesSection(allItems);
    
    // Traiter chaque section
    const openingBalance = this.processOpeningBalance(openingBalanceItems);
    const deposits = this.processDeposits(depositsItems);
    const checks = this.processChecks(checksItems);
    const facilities = this.processFacilities(facilitiesItems);
    const impayes = this.processImpayes(impayesItems);
    
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
    
    return {
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
  }
  
  /**
   * Extrait la section du solde d'ouverture
   */
  private extractOpeningBalanceSection(items: TextItem[]): TextItem[] {
    return positionalExtractionService.extractSection(items, 'OPENING BALANCE');
  }
  
  /**
   * Extrait la section des dépôts
   */
  private extractDepositsSection(items: TextItem[]): TextItem[] {
    return positionalExtractionService.extractSection(items, 'DEPOSIT NOT YET CLEARED', 'TOTAL DEPOSIT');
  }
  
  /**
   * Extrait la section des chèques
   */
  private extractChecksSection(items: TextItem[]): TextItem[] {
    return positionalExtractionService.extractSection(items, 'CHECK Not yet cleared', 'TOTAL (B)');
  }
  
  /**
   * Extrait la section des facilités
   */
  private extractFacilitiesSection(items: TextItem[]): TextItem[] {
    return positionalExtractionService.extractSection(items, 'BANK FACILITY');
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
    
    // Utiliser la méthode existante du service BDK
    return bdkExtractionService['extractOpeningBalance'](text);
  }
  
  /**
   * Traite la section des dépôts avec une meilleure détection positionnelle
   */
  private processDeposits(items: TextItem[]) {
    // Grouper les éléments par lignes basées sur la position Y
    const rows = this.groupItemsByRows(items);
    
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
          
          deposits.push(deposit);
        }
      }
    }
    
    return deposits;
  }
  
  /**
   * Traite la section des chèques avec une meilleure détection positionnelle
   */
  private processChecks(items: TextItem[]) {
    const rows = this.groupItemsByRows(items);
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
            amount: amount
          };
          
          checks.push(check);
        }
      }
    }
    
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
