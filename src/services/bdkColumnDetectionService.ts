import { TextItem, Column } from './positionalExtractionService';
import { columnClusteringService } from './columnClusteringService';

// Zones de colonnes calibrées basées sur l'analyse précise des screenshots BDK
const COLUMN_ZONES_CALIBRATED = {
  DATE: { xMin: 35, xMax: 105 },
  CH_NO: { xMin: 105, xMax: 185 },
  DESCRIPTION: { xMin: 185, xMax: 385 },
  VENDOR_PROVIDER: { xMin: 385, xMax: 485 },
  CLIENT: { xMin: 485, xMax: 585 },
  TR_NO_FACT_NO: { xMin: 585, xMax: 720 },
  AMOUNT: { xMin: 720, xMax: 850 }  // Zone AMOUNT calibrée pour capturer les montants alignés à droite
};

// Mots-clés pour identifier les sections spéciales
const SPECIAL_SECTIONS = {
  HEADERS: ['ADD:', 'LESS:', 'BANK FACILITY', 'IMPAYE'],
  TOTALS: ['TOTAL DEPOSIT', 'TOTAL BALANCE', 'CLOSING BALANCE', 'OPENING BALANCE'],
  IGNORE_PATTERNS: ['DEPOSIT NOT YET CLEARED', 'CHECK NOT YET CLEARED', 'BANK FACILITY', 'IMPAYE']
};

export interface BDKColumnTemplate {
  name: string;
  expectedWidth: number;
  contentType: 'date' | 'number' | 'text' | 'amount';
  validation: (text: string) => boolean;
  zone: { xMin: number; xMax: number };
  alignment?: 'left' | 'right' | 'center';
}

export const BDK_COLUMN_TEMPLATES: BDKColumnTemplate[] = [
  {
    name: 'Date',
    expectedWidth: 70,
    contentType: 'date',
    validation: (text: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(text.trim()) || text.trim() === '',
    zone: COLUMN_ZONES_CALIBRATED.DATE,
    alignment: 'left'
  },
  {
    name: 'CH.NO',
    expectedWidth: 80,
    contentType: 'number',
    validation: (text: string) => /^\d+$/.test(text.trim()) || text.trim() === '',
    zone: COLUMN_ZONES_CALIBRATED.CH_NO,
    alignment: 'left'
  },
  {
    name: 'Description',
    expectedWidth: 200,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0,
    zone: COLUMN_ZONES_CALIBRATED.DESCRIPTION,
    alignment: 'left'
  },
  {
    name: 'Vendor Provider',
    expectedWidth: 100,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0,
    zone: COLUMN_ZONES_CALIBRATED.VENDOR_PROVIDER,
    alignment: 'left'
  },
  {
    name: 'Client',
    expectedWidth: 100,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0,
    zone: COLUMN_ZONES_CALIBRATED.CLIENT,
    alignment: 'left'
  },
  {
    name: 'TR No/FACT.No',
    expectedWidth: 135,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0,
    zone: COLUMN_ZONES_CALIBRATED.TR_NO_FACT_NO,
    alignment: 'left'
  },
  {
    name: 'Amount',
    expectedWidth: 130,
    contentType: 'amount',
    validation: (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || trimmed === '0' || trimmed === 'N/A' || trimmed === '---') return true;
      // Regex renforcée pour les montants BDK : "3 000 000", "147 500", etc.
      return /^[\d\s]{1,}$/.test(trimmed) && !/[a-zA-Z]/.test(trimmed);
    },
    zone: COLUMN_ZONES_CALIBRATED.AMOUNT,
    alignment: 'right'
  }
];

export class BDKColumnDetectionService {
  
  /**
   * Détecte spécifiquement 7 colonnes pour les documents BDK avec zones calibrées améliorées
   */
  detectBDKColumns(items: TextItem[], pageWidth: number): Column[] {
    if (items.length === 0) return [];
    
    console.log(`[BDK] Détection CORRIGÉE pour ${items.length} éléments, largeur: ${pageWidth}`);
    
    // 1. Filtrer les éléments selon les sections spéciales
    const filteredItems = this.filterSpecialSections(items);
    
    // 2. Créer les colonnes avec les zones calibrées ajustées
    const columns = this.createCalibratedColumns(pageWidth);
    
    // 3. Pré-traitement : Identifier et prioriser UNIQUEMENT les montants dans la zone AMOUNT
    const { amountItems, otherItems } = this.separateAmountItemsStrict(filteredItems, columns[6]);
    
    // 4. Distribuer d'abord les montants vers la colonne AMOUNT
    this.distributeAmountItems(columns, amountItems);
    
    // 5. Distribuer ensuite les autres éléments (EXCLUANT la colonne AMOUNT)
    this.distributeOtherItemsExcludingAmount(columns, otherItems);
    
    // 6. Post-traitement : Remplir les cellules AMOUNT vides UNIQUEMENT
    this.fillEmptyAmountCellsImproved(columns);
    
    // 7. Validation finale avec métriques détaillées
    this.validateColumnContentEnhanced(columns);
    
    console.log(`[BDK] ${columns.length} colonnes CORRIGÉES appliquées - Aucun déplacement erroné`);
    columns.forEach((col, i) => {
      console.log(`[BDK] Colonne ${i} (${BDK_COLUMN_TEMPLATES[i]?.name}): ${col.texts.length} éléments, x: ${Math.round(col.xStart)}-${Math.round(col.xEnd)}`);
    });
    
    return columns;
  }

  /**
   * Sépare STRICTEMENT les éléments de montants - SEULEMENT ceux dans la zone AMOUNT
   */
  private separateAmountItemsStrict(items: TextItem[], amountColumn: Column): { amountItems: TextItem[], otherItems: TextItem[] } {
    const amountItems: TextItem[] = [];
    const otherItems: TextItem[] = [];
    
    for (const item of items) {
      const trimmed = item.text.trim();
      
      // Critères TRÈS stricts pour identifier un montant
      const isInAmountZone = item.x >= amountColumn.xStart && item.x <= amountColumn.xEnd;
      const isNumericPattern = /^[\d\s]{3,}$/.test(trimmed); // Au moins 3 caractères numériques/espaces
      const isNotDate = !(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed));
      const isNotSimpleNumber = !(trimmed.length <= 6 && /^\d+$/.test(trimmed)); // Éviter les numéros de chèques simples
      const isSignificantAmount = parseInt(trimmed.replace(/\s/g, '')) > 500; // Montant significatif
      
      // Un élément est considéré comme montant SEULEMENT s'il est dans la zone AMOUNT ET respecte tous les critères
      const isAmountItem = isInAmountZone && isNumericPattern && isNotDate && isNotSimpleNumber && isSignificantAmount;
      
      if (isAmountItem) {
        amountItems.push(item);
        console.log(`[BDK] Montant STRICT identifié: "${trimmed}" à x=${item.x} (zone AMOUNT: ${amountColumn.xStart}-${amountColumn.xEnd})`);
      } else {
        otherItems.push(item);
        if (isNumericPattern && isSignificantAmount && !isInAmountZone) {
          console.log(`[BDK] Nombre "${trimmed}" CONSERVÉ en position x=${item.x} (hors zone AMOUNT)`);
        }
      }
    }
    
    console.log(`[BDK] Séparation STRICTE: ${amountItems.length} montants dans zone AMOUNT, ${otherItems.length} autres éléments`);
    return { amountItems, otherItems };
  }

  /**
   * Distribue les montants spécifiquement vers la colonne AMOUNT (index 6)
   */
  private distributeAmountItems(columns: Column[], amountItems: TextItem[]): void {
    const amountColumn = columns[6]; // Colonne AMOUNT
    
    for (const item of amountItems) {
      amountColumn.texts.push(item);
      console.log(`[BDK] Montant "${item.text}" attribué à AMOUNT (x=${item.x})`);
    }
  }

  /**
   * Distribue les autres éléments selon la logique standard MAIS EXCLUANT la colonne AMOUNT
   */
  private distributeOtherItemsExcludingAmount(columns: Column[], otherItems: TextItem[]): void {
    for (const item of otherItems) {
      const bestColumnIndex = this.findBestColumnForItemExcludingAmount(item, columns);
      if (bestColumnIndex !== -1) {
        columns[bestColumnIndex].texts.push(item);
        if (bestColumnIndex === 5) {
          console.log(`[BDK] Élément "${item.text}" attribué à colonne ${bestColumnIndex} (TR No/FACT.No) - x=${item.x}`);
        }
      }
    }
  }

  /**
   * Remplissage amélioré des cellules AMOUNT vides avec "N/A"
   */
  private fillEmptyAmountCellsImproved(columns: Column[]): void {
    const amountColumn = columns[6];
    
    // Identifier les positions Y des autres colonnes pour détecter les lignes
    const allYPositions = new Set<number>();
    columns.slice(0, 6).forEach(col => {
      col.texts.forEach(item => allYPositions.add(Math.round(item.y / 8) * 8)); // Grouper par tranches de 8px
    });
    
    const amountYPositions = new Set(amountColumn.texts.map(item => Math.round(item.y / 8) * 8));
    
    // Trouver les positions Y manquantes dans la colonne AMOUNT
    const missingPositions = Array.from(allYPositions).filter(y => !amountYPositions.has(y));
    
    console.log(`[BDK] ${missingPositions.length} positions AMOUNT manquantes détectées`);
    
    // Ajouter des éléments "N/A" aux positions manquantes
    missingPositions.forEach(y => {
      const syntheticItem: TextItem = {
        text: 'N/A',
        x: (amountColumn.xStart + amountColumn.xEnd) / 2,
        y: y,
        width: 30,
        height: 12,
        fontSize: 12,
        fontName: 'synthetic'
      };
      amountColumn.texts.push(syntheticItem);
      console.log(`[BDK] Cellule AMOUNT vide remplie avec "N/A" à y=${y}`);
    });
    
    // Re-trier après ajout
    amountColumn.texts.sort((a, b) => a.y - b.y);
  }

  /**
   * Trouve une colonne alternative si AMOUNT n'est pas appropriée
   */
  private findAlternativeColumn(item: TextItem, columns: Column[]): number {
    let bestColumn = 5; // Default to TR No/FACT.No
    let minDistance = Infinity;
    
    for (let i = 0; i < 6; i++) { // Examiner toutes les colonnes sauf AMOUNT
      const column = columns[i];
      const columnCenter = (column.xStart + column.xEnd) / 2;
      const distance = Math.abs(item.x - columnCenter);
      
      if (distance < minDistance) {
        minDistance = distance;
        bestColumn = i;
      }
    }
    
    return bestColumn;
  }

  /**
   * Filtres les éléments pour exclure les sections spéciales problématiques
   */
  private filterSpecialSections(items: TextItem[]): TextItem[] {
    return items.filter(item => {
      const text = item.text.toUpperCase().trim();
      
      // Garder les en-têtes de colonnes normales
      if (['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'].includes(text)) {
        return true;
      }
      
      // Exclure les sections spéciales
      const isSpecialSection = SPECIAL_SECTIONS.IGNORE_PATTERNS.some(pattern => 
        text.includes(pattern)
      );
      
      // Exclure les lignes de totaux spéciaux
      const isTotalLine = SPECIAL_SECTIONS.TOTALS.some(total => 
        text.includes(total)
      );
      
      // Exclure les en-têtes de section
      const isSectionHeader = SPECIAL_SECTIONS.HEADERS.some(header => 
        text === header || text.startsWith(header)
      );
      
      if (isSpecialSection || isTotalLine || isSectionHeader) {
        console.log(`[BDK] Filtrage élément spécial: "${text}"`);
        return false;
      }
      
      return true;
    });
  }

  /**
   * Crée les colonnes avec les zones calibrées améliorées
   */
  private createCalibratedColumns(pageWidth: number): Column[] {
    const columns: Column[] = [];
    
    // Calculer le facteur d'échelle basé sur la largeur de la page
    const referencePage = 850;
    const scaleFactor = pageWidth / referencePage;
    
    BDK_COLUMN_TEMPLATES.forEach((template, index) => {
      columns.push({
        xStart: template.zone.xMin * scaleFactor,
        xEnd: template.zone.xMax * scaleFactor,
        index,
        texts: []
      });
    });
    
    console.log(`[BDK] Colonnes calibrées CORRIGÉES créées avec facteur d'échelle: ${scaleFactor.toFixed(3)}`);
    console.log(`[BDK] Zone AMOUNT stricte: ${(COLUMN_ZONES_CALIBRATED.AMOUNT.xMin * scaleFactor).toFixed(0)}-${(COLUMN_ZONES_CALIBRATED.AMOUNT.xMax * scaleFactor).toFixed(0)}`);
    
    return columns;
  }
  
  /**
   * Trouve la meilleure colonne pour un élément donné
   */
  private findBestColumnForItem(item: TextItem, columns: Column[]): number {
    let bestColumn = -1;
    let bestScore = -1;
    
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const template = BDK_COLUMN_TEMPLATES[i];
      
      // Vérifier si l'élément est dans la zone de la colonne
      if (item.x >= column.xStart && item.x <= column.xEnd) {
        let score = 100; // Score de base pour être dans la zone
        
        // Bonus spécial pour la colonne AMOUNT avec alignement à droite
        if (template.alignment === 'right' && i === 6) {
          const distanceFromRight = column.xEnd - item.x;
          const columnWidth = column.xEnd - column.xStart;
          if (distanceFromRight < columnWidth * 0.4) {
            score += 75; // Bonus important pour être près du bord droit
          }
          
          // Bonus supplémentaire si c'est un montant valide
          if (template.validation(item.text)) {
            score += 50;
          }
        } else {
          // Bonus standard pour la validation du contenu
          if (template.validation(item.text)) {
            score += 30;
          }
          
          // Pénalité pour la distance du centre (colonnes alignées à gauche)
          const columnCenter = (column.xStart + column.xEnd) / 2;
          const distance = Math.abs(item.x - columnCenter);
          const columnWidth = column.xEnd - column.xStart;
          const normalizedDistance = distance / columnWidth;
          score -= normalizedDistance * 20;
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestColumn = i;
        }
      }
    }
    
    // Si aucune colonne parfaite, utiliser la logique de distance minimale
    if (bestColumn === -1) {
      let minDistance = Infinity;
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i];
        const columnCenter = (column.xStart + column.xEnd) / 2;
        const distance = Math.abs(item.x - columnCenter);
        
        if (distance < minDistance) {
          minDistance = distance;
          bestColumn = i;
        }
      }
    }
    
    return bestColumn;
  }
  
  /**
   * Validation améliorée du contenu avec analyse contextuelle
   */
  private validateColumnContentEnhanced(columns: Column[]): void {
    columns.forEach((column, index) => {
      const template = BDK_COLUMN_TEMPLATES[index];
      if (!template) return;
      
      const validItems = column.texts.filter(item => template.validation(item.text));
      const invalidItems = column.texts.filter(item => !template.validation(item.text));
      const validationRate = column.texts.length > 0 ? validItems.length / column.texts.length : 0;
      
      console.log(`[BDK] Colonne ${index} (${template.name}): ${validationRate.toFixed(2)} de validation (${validItems.length}/${column.texts.length})`);
      
      // Analyser spécifiquement la colonne AMOUNT
      if (index === 6 && invalidItems.length > 0) {
        console.log(`[BDK] Éléments invalides en colonne AMOUNT:`, invalidItems.map(item => `"${item.text}" à x=${item.x}`));
      }
      
      // Analyser spécifiquement la colonne TR No/FACT.No
      if (index === 5) {
        const numericItems = column.texts.filter(item => /^\d+$/.test(item.text.trim()));
        console.log(`[BDK] Colonne TR No/FACT.No contient ${numericItems.length} éléments numériques (normal pour factures/dossiers)`);
      }
    });
  }
  
  /**
   * Détecte si un document est un rapport BDK
   */
  isBDKDocument(items: TextItem[]): boolean {
    const textContent = items.map(item => item.text.toUpperCase()).join(' ');
    
    const bdkIndicators = [
      'BDK',
      'CH.NO',
      'VENDOR PROVIDER',
      'TR NO/FACT.NO',
      'DEPOSIT NOT YET CLEARED',
      'CHECK NOT YET CLEARED'
    ];
    
    const foundIndicators = bdkIndicators.filter(indicator => 
      textContent.includes(indicator)
    );
    
    const isBDK = foundIndicators.length >= 3;
    console.log(`[BDK] Document BDK détecté: ${isBDK} (${foundIndicators.length}/6 indicateurs)`);
    
    return isBDK;
  }
  
  /**
   * Analyse la qualité de la détection pour le debug
   */
  analyzeDetectionQuality(columns: Column[]): {
    overallScore: number;
    columnScores: number[];
    recommendations: string[];
  } {
    const columnScores: number[] = [];
    const recommendations: string[] = [];
    
    columns.forEach((column, index) => {
      const template = BDK_COLUMN_TEMPLATES[index];
      if (!template) {
        columnScores.push(0);
        return;
      }
      
      const validItems = column.texts.filter(item => template.validation(item.text));
      let score = column.texts.length > 0 ? (validItems.length / column.texts.length) * 100 : 100;
      
      // Bonus spécial pour la colonne AMOUNT si elle contient des montants réalistes
      if (index === 6) {
        const realAmounts = column.texts.filter(item => {
          const trimmed = item.text.trim();
          if (trimmed === 'N/A' || trimmed === '---') return true; // Valeurs synthétiques acceptables
          const num = parseInt(trimmed.replace(/\s/g, ''));
          return !isNaN(num) && num >= 0;
        });
        if (realAmounts.length > column.texts.length * 0.8) {
          score += 10; // Bonus pour avoir majoritairement des montants ou valeurs synthétiques
        }
      }
      
      // Bonus pour la colonne TR No/FACT.No qui peut contenir des numéros
      if (index === 5) {
        score += 5; // Bonus car cette colonne peut légitimement contenir des numéros
      }
      
      columnScores.push(Math.min(score, 100));
      
      if (score < 70) {
        recommendations.push(`Colonne ${template.name}: ${score.toFixed(0)}% de validation - Vérifier le calibrage`);
      }
      
      if (column.texts.length === 0) {
        recommendations.push(`Colonne ${template.name}: Aucun élément détecté - Zone peut-être trop restrictive`);
      }
    });
    
    const overallScore = columnScores.reduce((sum, score) => sum + score, 0) / columnScores.length;
    
    if (overallScore < 80) {
      recommendations.push('Score global faible - Considérer un recalibrage des zones');
    }
    
    return {
      overallScore,
      columnScores,
      recommendations
    };
  }
}

export const bdkColumnDetectionService = new BDKColumnDetectionService();
