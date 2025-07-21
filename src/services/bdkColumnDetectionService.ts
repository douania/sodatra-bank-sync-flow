
import { TextItem, Column } from './positionalExtractionService';
import { columnClusteringService } from './columnClusteringService';

// Zones de colonnes calibrées basées sur l'analyse du PDF BDK réel (ajustées selon screenshots)
const COLUMN_ZONES_CALIBRATED = {
  DATE: { xMin: 35, xMax: 105 },           // Ajusté pour mieux capturer les dates
  CH_NO: { xMin: 105, xMax: 185 },        // Ajusté pour les numéros de chèques
  DESCRIPTION: { xMin: 185, xMax: 385 },  // Élargi pour les descriptions complètes
  VENDOR_PROVIDER: { xMin: 385, xMax: 485 },
  CLIENT: { xMin: 485, xMax: 585 },
  TR_NO_FACT_NO: { xMin: 585, xMax: 685 },    // CRITIQUE - Zone ajustée
  AMOUNT: { xMin: 685, xMax: 820 }             // CRITIQUE - Étendu pour capturer montants alignés à droite
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
    expectedWidth: 100,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0,
    zone: COLUMN_ZONES_CALIBRATED.TR_NO_FACT_NO,
    alignment: 'left'
  },
  {
    name: 'Amount',
    expectedWidth: 135,
    contentType: 'amount',
    validation: (text: string) => /^\d+(\s+\d+)*$/.test(text.trim()) || /^\d+[\.,]\d+$/.test(text.trim()) || text.trim() === '',
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
    
    console.log(`[BDK] Détection AMÉLIORÉE pour ${items.length} éléments, largeur: ${pageWidth}`);
    
    // 1. Filtrer les éléments selon les sections spéciales
    const filteredItems = this.filterSpecialSections(items);
    
    // 2. Créer les colonnes avec les zones calibrées améliorées
    const columns = this.createCalibratedColumns(pageWidth);
    
    // 3. Distribuer les éléments avec logique améliorée
    this.distributeItemsIntelligently(columns, filteredItems);
    
    // 4. Post-traitement pour optimiser la distribution
    this.optimizeColumnDistribution(columns);
    
    // 5. Validation finale avec contextualisation
    this.validateColumnContentEnhanced(columns);
    
    console.log(`[BDK] ${columns.length} colonnes CALIBRÉES AMÉLIORÉES appliquées`);
    columns.forEach((col, i) => {
      console.log(`[BDK] Colonne ${i} (${BDK_COLUMN_TEMPLATES[i]?.name}): ${col.texts.length} éléments, x: ${Math.round(col.xStart)}-${Math.round(col.xEnd)}`);
    });
    
    return columns;
  }

  /**
   * Filtre les éléments pour exclure les sections spéciales problématiques
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
    // Les zones calibrées sont maintenant basées sur une analyse plus précise
    const referencePage = 850; // Ajusté selon les screenshots
    const scaleFactor = pageWidth / referencePage;
    
    BDK_COLUMN_TEMPLATES.forEach((template, index) => {
      columns.push({
        xStart: template.zone.xMin * scaleFactor,
        xEnd: template.zone.xMax * scaleFactor,
        index,
        texts: []
      });
    });
    
    console.log(`[BDK] Colonnes calibrées AMÉLIORÉES créées avec facteur d'échelle: ${scaleFactor.toFixed(3)}`);
    
    return columns;
  }
  
  /**
   * Distribution intelligente des éléments avec gestion de l'alignement
   */
  private distributeItemsIntelligently(columns: Column[], items: TextItem[]): void {
    for (const item of items) {
      const bestColumnIndex = this.findBestColumnForItem(item, columns);
      if (bestColumnIndex !== -1) {
        columns[bestColumnIndex].texts.push(item);
      }
    }
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
        
        // Bonus pour l'alignement (spécialement pour les montants)
        if (template.alignment === 'right' && i === 6) { // Colonne Amount
          const distanceFromRight = column.xEnd - item.x;
          const columnWidth = column.xEnd - column.xStart;
          if (distanceFromRight < columnWidth * 0.3) { // Proche du bord droit
            score += 50;
          }
        }
        
        // Bonus pour la validation du contenu
        if (template.validation(item.text)) {
          score += 30;
        }
        
        // Pénalité pour la distance du centre (sauf pour les montants alignés à droite)
        if (template.alignment !== 'right') {
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
   * Optimise la distribution des colonnes après allocation initiale
   */
  private optimizeColumnDistribution(columns: Column[]): void {
    // Trier les éléments de chaque colonne par position Y (ordre d'apparition)
    columns.forEach(column => {
      column.texts.sort((a, b) => a.y - b.y);
    });
    
    // Détecter et corriger les éléments mal placés
    this.correctMisplacedItems(columns);
  }
  
  /**
   * Corrige les éléments qui semblent mal placés
   */
  private correctMisplacedItems(columns: Column[]): void {
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const template = BDK_COLUMN_TEMPLATES[i];
      
      // Examiner les éléments qui ne passent pas la validation
      const invalidItems = column.texts.filter(item => !template.validation(item.text));
      
      for (const invalidItem of invalidItems) {
        // Chercher une meilleure colonne pour cet élément
        let betterColumn = -1;
        for (let j = 0; j < columns.length; j++) {
          if (j !== i && BDK_COLUMN_TEMPLATES[j].validation(invalidItem.text)) {
            betterColumn = j;
            break;
          }
        }
        
        // Déplacer l'élément si une meilleure colonne est trouvée
        if (betterColumn !== -1) {
          column.texts = column.texts.filter(item => item !== invalidItem);
          columns[betterColumn].texts.push(invalidItem);
          console.log(`[BDK] Élément "${invalidItem.text}" déplacé de colonne ${i} vers ${betterColumn}`);
        }
      }
    }
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
      
      // Analyser les éléments invalides pour diagnostic
      if (invalidItems.length > 0 && invalidItems.length <= 3) {
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
      const score = column.texts.length > 0 ? (validItems.length / column.texts.length) * 100 : 100;
      columnScores.push(score);
      
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
