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
  AMOUNT: { xMin: 720, xMax: 850 }  // AJUSTÉ pour capturer les montants alignés à droite
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
      if (trimmed === '' || trimmed === '0') return true;
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
    
    console.log(`[BDK] Détection RENFORCÉE pour ${items.length} éléments, largeur: ${pageWidth}`);
    
    // 1. Filtrer les éléments selon les sections spéciales
    const filteredItems = this.filterSpecialSections(items);
    
    // 2. Créer les colonnes avec les zones calibrées ajustées
    const columns = this.createCalibratedColumns(pageWidth);
    
    // 3. Pré-traitement : Identifier et prioriser les montants
    const { amountItems, otherItems } = this.separateAmountItems(filteredItems);
    
    // 4. Distribuer d'abord les montants vers la colonne AMOUNT
    this.distributeAmountItems(columns, amountItems);
    
    // 5. Distribuer ensuite les autres éléments
    this.distributeOtherItems(columns, otherItems);
    
    // 6. Post-traitement : Corriger les erreurs et remplir les cellules vides
    this.postProcessColumns(columns);
    
    // 7. Validation finale avec métriques détaillées
    this.validateColumnContentEnhanced(columns);
    
    console.log(`[BDK] ${columns.length} colonnes CALIBRÉES ET RENFORCÉES appliquées`);
    columns.forEach((col, i) => {
      console.log(`[BDK] Colonne ${i} (${BDK_COLUMN_TEMPLATES[i]?.name}): ${col.texts.length} éléments, x: ${Math.round(col.xStart)}-${Math.round(col.xEnd)}`);
    });
    
    return columns;
  }

  /**
   * Sépare les éléments de montants des autres éléments
   */
  private separateAmountItems(items: TextItem[]): { amountItems: TextItem[], otherItems: TextItem[] } {
    const amountItems: TextItem[] = [];
    const otherItems: TextItem[] = [];
    
    for (const item of items) {
      const trimmed = item.text.trim();
      
      // Critères stricts pour identifier un montant
      const isAmountLike = 
        /^[\d\s]{2,}$/.test(trimmed) && // Au moins 2 caractères numériques/espaces
        !(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) && // Pas une date
        !(/^\d{1,6}$/.test(trimmed) && trimmed.length <= 6) && // Pas un numéro de chèque simple
        parseInt(trimmed.replace(/\s/g, '')) > 100;
      
      if (isAmountLike) {
        amountItems.push(item);
        console.log(`[BDK] Montant identifié: "${trimmed}" à x=${item.x}`);
      } else {
        otherItems.push(item);
      }
    }
    
    console.log(`[BDK] Séparation: ${amountItems.length} montants, ${otherItems.length} autres éléments`);
    return { amountItems, otherItems };
  }

  /**
   * Distribue les montants spécifiquement vers la colonne AMOUNT (index 6)
   */
  private distributeAmountItems(columns: Column[], amountItems: TextItem[]): void {
    const amountColumn = columns[6]; // Colonne AMOUNT
    
    for (const item of amountItems) {
      // Vérifier si l'élément est dans la zone AMOUNT ou proche du bord droit
      const isInAmountZone = item.x >= amountColumn.xStart && item.x <= amountColumn.xEnd;
      const distanceFromRightEdge = amountColumn.xEnd - item.x;
      const isNearRightEdge = distanceFromRightEdge <= 100; // Tolérance pour alignement à droite
      
      if (isInAmountZone || isNearRightEdge) {
        amountColumn.texts.push(item);
        console.log(`[BDK] Montant "${item.text}" attribué à AMOUNT (x=${item.x}, distance du bord droit=${distanceFromRightEdge})`);
      } else {
        // Si le montant n'est pas dans la zone, l'attribuer quand même à AMOUNT mais avec un warning
        amountColumn.texts.push(item);
        console.log(`[BDK] ⚠️ Montant "${item.text}" forcé vers AMOUNT (x=${item.x} hors zone)`);
      }
    }
  }

  /**
   * Distribue les autres éléments selon la logique standard
   */
  private distributeOtherItems(columns: Column[], otherItems: TextItem[]): void {
    for (const item of otherItems) {
      const bestColumnIndex = this.findBestColumnForItem(item, columns);
      if (bestColumnIndex !== -1 && bestColumnIndex !== 6) { // Ne pas mettre d'autres éléments dans AMOUNT
        columns[bestColumnIndex].texts.push(item);
      } else if (bestColumnIndex === 6) {
        // Si l'algorithme veut mettre un non-montant dans AMOUNT, le rediriger
        const alternativeIndex = this.findAlternativeColumn(item, columns);
        columns[alternativeIndex].texts.push(item);
        console.log(`[BDK] Élément "${item.text}" redirigé de AMOUNT vers colonne ${alternativeIndex}`);
      }
    }
  }

  /**
   * Post-traitement pour corriger les erreurs et remplir les cellules vides
   */
  private postProcessColumns(columns: Column[]): void {
    // 1. Trier les éléments de chaque colonne par position Y
    columns.forEach(column => {
      column.texts.sort((a, b) => a.y - b.y);
    });
    
    // 2. Identifier les lignes sans montant et ajouter "0"
    this.fillEmptyAmountCells(columns);
    
    // 3. Corriger les éléments mal placés
    this.correctMisplacedAmounts(columns);
    
    // 4. Vérifier l'alignement des lignes
    this.validateRowAlignment(columns);
  }

  /**
   * Remplit les cellules AMOUNT vides avec "0"
   */
  private fillEmptyAmountCells(columns: Column[]): void {
    const amountColumn = columns[6];
    
    // Identifier les positions Y des autres colonnes pour détecter les lignes manquantes
    const allYPositions = new Set<number>();
    columns.slice(0, 6).forEach(col => {
      col.texts.forEach(item => allYPositions.add(Math.round(item.y / 10) * 10)); // Grouper par dizaines
    });
    
    const amountYPositions = new Set(amountColumn.texts.map(item => Math.round(item.y / 10) * 10));
    
    // Trouver les positions Y manquantes dans la colonne AMOUNT
    const missingPositions = Array.from(allYPositions).filter(y => !amountYPositions.has(y));
    
    console.log(`[BDK] ${missingPositions.length} positions AMOUNT manquantes détectées: ${missingPositions}`);
    
    // Ajouter des éléments "0" aux positions manquantes
    missingPositions.forEach(y => {
      const syntheticItem: TextItem = {
        text: '0',
        x: (columns[6].xStart + columns[6].xEnd) / 2,
        y: y,
        width: 20,
        height: 12,
        fontSize: 12,
        fontName: 'synthetic'
      };
      amountColumn.texts.push(syntheticItem);
      console.log(`[BDK] Cellule AMOUNT vide remplie avec "0" à y=${y}`);
    });
    
    // Re-trier après ajout
    amountColumn.texts.sort((a, b) => a.y - b.y);
  }

  /**
   * Corrige les montants mal placés dans d'autres colonnes
   */
  private correctMisplacedAmounts(columns: Column[]): void {
    for (let i = 0; i < 6; i++) { // Examiner toutes les colonnes sauf AMOUNT
      const column = columns[i];
      const amountColumn = columns[6];
      
      const misplacedAmounts = column.texts.filter(item => {
        const trimmed = item.text.trim();
        return /^[\d\s]{3,}$/.test(trimmed) && 
               !(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) &&
               parseInt(trimmed.replace(/\s/g, '')) > 1000;
      });
      
      misplacedAmounts.forEach(item => {
        // Déplacer vers AMOUNT
        column.texts = column.texts.filter(t => t !== item);
        amountColumn.texts.push(item);
        console.log(`[BDK] Montant mal placé "${item.text}" déplacé de colonne ${i} vers AMOUNT`);
      });
    }
  }

  /**
   * Valide l'alignement des lignes
   */
  private validateRowAlignment(columns: Column[]): void {
    const tolerance = 15; // Tolérance pour considérer que les éléments sont sur la même ligne
    
    columns[6].texts.forEach(amountItem => {
      const sameRowItems = columns.slice(0, 6).map(col => 
        col.texts.find(item => Math.abs(item.y - amountItem.y) <= tolerance)
      ).filter(Boolean);
      
      if (sameRowItems.length === 0) {
        console.log(`[BDK] ⚠️ Montant isolé détecté: "${amountItem.text}" à y=${amountItem.y}`);
      }
    });
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
    
    console.log(`[BDK] Colonnes calibrées RENFORCÉES créées avec facteur d'échelle: ${scaleFactor.toFixed(3)}`);
    console.log(`[BDK] Zone AMOUNT ajustée: ${(COLUMN_ZONES_CALIBRATED.AMOUNT.xMin * scaleFactor).toFixed(0)}-${(COLUMN_ZONES_CALIBRATED.AMOUNT.xMax * scaleFactor).toFixed(0)}`);
    
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
      
      // Diagnostic pour les autres colonnes
      if (invalidItems.length > 0 && invalidItems.length <= 3 && index !== 6) {
        console.log(`[BDK] Éléments invalides en colonne ${index}:`, invalidItems.map(item => `"${item.text}"`));
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
          const num = parseInt(item.text.replace(/\s/g, ''));
          return !isNaN(num) && (num === 0 || num > 100);
        });
        if (realAmounts.length > column.texts.length * 0.8) {
          score += 10; // Bonus pour avoir majoritairement des montants réalistes
        }
      }
      
      columnScores.push(Math.min(score, 100));
      
      if (score < 70) {
        recommendations.push(`Colonne ${template.name}: ${score.toFixed(0)}% de validation - Vérifier le calibrage`);
      }
      
      if (column.texts.length === 0) {
        recommendations.push(`Colonne ${template.name}: Aucun élément détecté - Zone peut-être trop restrictive`);
      }
      
      // Recommandations spécifiques pour AMOUNT
      if (index === 6 && column.texts.filter(item => item.text === '0').length > column.texts.length * 0.5) {
        recommendations.push(`Colonne AMOUNT: Beaucoup de valeurs "0" - Vérifier si les vrais montants sont bien détectés`);
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
