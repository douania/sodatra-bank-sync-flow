
import { TextItem, Column } from './positionalExtractionService';
import { columnClusteringService } from './columnClusteringService';

export interface BDKColumnTemplate {
  name: string;
  expectedWidth: number;
  contentType: 'date' | 'number' | 'text' | 'amount';
  validation: (text: string) => boolean;
}

export const BDK_COLUMN_TEMPLATES: BDKColumnTemplate[] = [
  {
    name: 'Date',
    expectedWidth: 80,
    contentType: 'date',
    validation: (text: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(text.trim())
  },
  {
    name: 'CH.NO',
    expectedWidth: 60,
    contentType: 'number',
    validation: (text: string) => /^\d+$/.test(text.trim()) || text.trim() === ''
  },
  {
    name: 'Description',
    expectedWidth: 200,
    contentType: 'text',
    validation: (text: string) => text.trim().length > 0
  },
  {
    name: 'Vendor Provider',
    expectedWidth: 120,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0
  },
  {
    name: 'Client',
    expectedWidth: 100,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0
  },
  {
    name: 'TR No/FACT.No',
    expectedWidth: 100,
    contentType: 'text',
    validation: (text: string) => text.trim().length >= 0
  },
  {
    name: 'Amount',
    expectedWidth: 100,
    contentType: 'amount',
    validation: (text: string) => /^\d+(\s+\d+)*$/.test(text.trim()) || text.trim() === ''
  }
];

export class BDKColumnDetectionService {
  
  /**
   * Détecte spécifiquement 7 colonnes pour les documents BDK
   */
  detectBDKColumns(items: TextItem[], pageWidth: number): Column[] {
    if (items.length === 0) return [];
    
    console.log(`[BDK] Détection de colonnes pour ${items.length} éléments, largeur: ${pageWidth}`);
    
    // 1. Détecter les en-têtes de colonnes BDK
    const headers = this.detectColumnHeaders(items);
    console.log(`[BDK] En-têtes détectés:`, headers);
    
    // 2. Si on a des en-têtes, les utiliser pour définir les colonnes
    let columns: Column[];
    if (headers.length >= 3) {
      columns = this.createColumnsFromHeaders(headers, items, pageWidth);
    } else {
      // 3. Sinon, diviser uniformément en 7 colonnes
      columns = this.createUniformColumns(items, pageWidth);
    }
    
    // 4. S'assurer qu'on a exactement 7 colonnes
    this.ensureSevenColumns(columns, pageWidth);
    
    // 5. Distribuer les éléments dans les colonnes
    this.distributeItemsToColumns(columns, items);
    
    // 6. Validation finale
    this.validateColumnContent(columns);
    
    console.log(`[BDK] ${columns.length} colonnes finales détectées`);
    columns.forEach((col, i) => {
      console.log(`[BDK] Colonne ${i} (${BDK_COLUMN_TEMPLATES[i]?.name || 'Unknown'}): ${col.texts.length} éléments, x: ${Math.round(col.xStart)}-${Math.round(col.xEnd)}`);
    });
    
    return columns;
  }
  
  /**
   * Détecte les en-têtes de colonnes BDK
   */
  private detectColumnHeaders(items: TextItem[]): Array<{text: string, x: number, templateIndex: number}> {
    const headers: Array<{text: string, x: number, templateIndex: number}> = [];
    
    const headerTexts = ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'];
    
    for (const item of items) {
      const upperText = item.text.toUpperCase().trim();
      const templateIndex = headerTexts.findIndex(header => 
        upperText.includes(header) || header.includes(upperText)
      );
      
      if (templateIndex !== -1) {
        headers.push({
          text: upperText,
          x: item.x,
          templateIndex
        });
      }
    }
    
    // Trier par position X
    return headers.sort((a, b) => a.x - b.x);
  }
  
  /**
   * Crée les colonnes basées sur les en-têtes détectés
   */
  private createColumnsFromHeaders(headers: Array<{text: string, x: number, templateIndex: number}>, items: TextItem[], pageWidth: number): Column[] {
    const columns: Column[] = [];
    
    for (let i = 0; i < 7; i++) {
      const header = headers.find(h => h.templateIndex === i);
      
      if (header) {
        // Utiliser la position de l'en-tête comme référence
        const template = BDK_COLUMN_TEMPLATES[i];
        const columnWidth = this.calculateColumnWidth(i, pageWidth);
        
        columns.push({
          xStart: header.x - columnWidth / 4, // Décaler légèrement à gauche
          xEnd: header.x + columnWidth * 3 / 4, // Étendre à droite
          index: i,
          texts: []
        });
      } else {
        // Colonne manquante, utiliser une position calculée
        const columnWidth = pageWidth / 7;
        columns.push({
          xStart: i * columnWidth,
          xEnd: (i + 1) * columnWidth,
          index: i,
          texts: []
        });
      }
    }
    
    return columns;
  }
  
  /**
   * Crée des colonnes uniformément réparties
   */
  private createUniformColumns(items: TextItem[], pageWidth: number): Column[] {
    const columns: Column[] = [];
    const columnWidth = pageWidth / 7;
    
    for (let i = 0; i < 7; i++) {
      columns.push({
        xStart: i * columnWidth,
        xEnd: (i + 1) * columnWidth,
        index: i,
        texts: []
      });
    }
    
    return columns;
  }
  
  /**
   * S'assure qu'on a exactement 7 colonnes
   */
  private ensureSevenColumns(columns: Column[], pageWidth: number): void {
    while (columns.length < 7) {
      const index = columns.length;
      const columnWidth = pageWidth / 7;
      columns.push({
        xStart: index * columnWidth,
        xEnd: (index + 1) * columnWidth,
        index,
        texts: []
      });
    }
    
    if (columns.length > 7) {
      columns.splice(7);
    }
    
    // Ajuster les limites pour éviter les chevauchements
    this.adjustColumnBoundaries(columns, pageWidth);
  }
  
  /**
   * Distribue les éléments dans les colonnes appropriées
   */
  private distributeItemsToColumns(columns: Column[], items: TextItem[]): void {
    for (const item of items) {
      // Trouver la colonne la plus appropriée pour cet élément
      let bestColumn = 0;
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
      
      columns[bestColumn].texts.push(item);
    }
  }
  
  /**
   * Calcule la largeur attendue pour chaque colonne BDK
   */
  private calculateColumnWidth(columnIndex: number, pageWidth: number): number {
    const template = BDK_COLUMN_TEMPLATES[columnIndex];
    if (!template) {
      return pageWidth / 7; // Largeur par défaut
    }
    
    const totalExpectedWidth = BDK_COLUMN_TEMPLATES.reduce((sum, t) => sum + t.expectedWidth, 0);
    const scaleFactor = pageWidth / totalExpectedWidth;
    
    return template.expectedWidth * scaleFactor;
  }
  
  /**
   * Valide et ajuste les colonnes détectées
   */
  private validateAndAdjustColumns(columns: Column[], pageWidth: number): void {
    // S'assurer qu'on a exactement 7 colonnes
    if (columns.length < 7) {
      console.warn(`[BDK] Seulement ${columns.length} colonnes détectées, création de colonnes manquantes`);
      this.fillMissingColumns(columns, pageWidth);
    } else if (columns.length > 7) {
      console.warn(`[BDK] ${columns.length} colonnes détectées, fusion des colonnes en trop`);
      this.mergeExcessColumns(columns);
    }
    
    // Ajuster les limites pour éviter les chevauchements
    this.adjustColumnBoundaries(columns, pageWidth);
    
    // Valider le contenu de chaque colonne
    this.validateColumnContent(columns);
  }
  
  /**
   * Ajoute des colonnes manquantes
   */
  private fillMissingColumns(columns: Column[], pageWidth: number): void {
    const columnWidth = pageWidth / 7;
    
    while (columns.length < 7) {
      const index = columns.length;
      const xStart = index * columnWidth;
      const xEnd = (index + 1) * columnWidth;
      
      columns.push({
        xStart,
        xEnd,
        index,
        texts: []
      });
    }
  }
  
  /**
   * Fusionne les colonnes en excès
   */
  private mergeExcessColumns(columns: Column[]): void {
    while (columns.length > 7) {
      // Trouver les deux colonnes les plus proches
      let minDistance = Infinity;
      let mergeIndex = 0;
      
      for (let i = 0; i < columns.length - 1; i++) {
        const distance = columns[i + 1].xStart - columns[i].xEnd;
        if (distance < minDistance) {
          minDistance = distance;
          mergeIndex = i;
        }
      }
      
      // Fusionner les colonnes
      const col1 = columns[mergeIndex];
      const col2 = columns[mergeIndex + 1];
      
      col1.xEnd = col2.xEnd;
      col1.texts = [...col1.texts, ...col2.texts];
      
      columns.splice(mergeIndex + 1, 1);
      
      // Réindexer
      columns.forEach((col, index) => {
        col.index = index;
      });
    }
  }
  
  /**
   * Ajuste les limites des colonnes pour éviter les chevauchements
   */
  private adjustColumnBoundaries(columns: Column[], pageWidth: number): void {
    for (let i = 0; i < columns.length - 1; i++) {
      const currentCol = columns[i];
      const nextCol = columns[i + 1];
      
      if (currentCol.xEnd > nextCol.xStart) {
        const midPoint = (currentCol.xEnd + nextCol.xStart) / 2;
        currentCol.xEnd = midPoint;
        nextCol.xStart = midPoint;
      }
    }
    
    // S'assurer que la première colonne commence à 0
    if (columns.length > 0) {
      columns[0].xStart = 0;
    }
    
    // S'assurer que la dernière colonne se termine à la largeur de la page
    if (columns.length > 0) {
      columns[columns.length - 1].xEnd = pageWidth;
    }
  }
  
  /**
   * Valide le contenu de chaque colonne
   */
  private validateColumnContent(columns: Column[]): void {
    columns.forEach((column, index) => {
      const template = BDK_COLUMN_TEMPLATES[index];
      if (!template) return;
      
      const validItems = column.texts.filter(item => template.validation(item.text));
      const validationRate = column.texts.length > 0 ? validItems.length / column.texts.length : 0;
      
      console.log(`[BDK] Colonne ${index} (${template.name}): ${validationRate.toFixed(2)} de validation (${validItems.length}/${column.texts.length})`);
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
}

export const bdkColumnDetectionService = new BDKColumnDetectionService();
