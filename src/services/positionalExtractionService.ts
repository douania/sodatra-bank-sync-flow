
import { getDocument } from 'pdfjs-dist';

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

export interface Column {
  xStart: number;
  xEnd: number;
  index: number;
  texts: TextItem[];
}

export interface Row {
  yStart: number;
  yEnd: number;
  index: number;
  cells: { [columnIndex: number]: TextItem[] };
}

export interface TableData {
  columns: Column[];
  rows: Row[];
  headers: string[];
  data: string[][];
}

export interface PositionalData {
  items: TextItem[];
  tables: TableData[];
  pageWidth: number;
  pageHeight: number;
}

export class PositionalExtractionService {
  
  /**
   * Extrait les données positionnelles d'un PDF
   */
  async extractPositionalData(file: File): Promise<PositionalData[]> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;
    
    const pagesData: PositionalData[] = [];
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      
      // Extraire tous les éléments de texte avec leurs positions
      const items: TextItem[] = textContent.items.map((item: any) => ({
        text: item.str,
        x: item.transform[4], // Position X
        y: viewport.height - item.transform[5], // Position Y (inversée car PDF Y commence en bas)
        width: item.width,
        height: item.height,
        fontSize: item.height,
        fontName: item.fontName || 'unknown'
      }));
      
      // Détecter les structures tabulaires
      const tables = this.detectTables(items);
      
      pagesData.push({
        items,
        tables,
        pageWidth: viewport.width,
        pageHeight: viewport.height
      });
    }
    
    return pagesData;
  }
  
  /**
   * Détecte les structures tabulaires dans une liste d'éléments textuels
   */
  private detectTables(items: TextItem[]): TableData[] {
    if (items.length === 0) return [];
    
    // Grouper les éléments par position Y approximative pour identifier les lignes
    const rows = this.groupByRows(items);
    
    // Détecter les colonnes basées sur les positions X
    const columns = this.detectColumns(items);
    
    // Créer la structure tabulaire
    const tableData = this.createTableStructure(rows, columns);
    
    return tableData.columns.length > 0 && tableData.rows.length > 0 ? [tableData] : [];
  }
  
  /**
   * Groupe les éléments par lignes basées sur leur position Y
   */
  private groupByRows(items: TextItem[]): Row[] {
    const tolerance = 5; // Tolérance pour regrouper les éléments sur la même ligne
    
    // Trier par position Y
    const sortedItems = [...items].sort((a, b) => a.y - b.y);
    
    const rows: Row[] = [];
    let currentRow: TextItem[] = [];
    let currentY = -1;
    
    for (const item of sortedItems) {
      if (currentY === -1 || Math.abs(item.y - currentY) <= tolerance) {
        currentRow.push(item);
        currentY = item.y;
      } else {
        if (currentRow.length > 0) {
          rows.push(this.createRow(currentRow, rows.length));
        }
        currentRow = [item];
        currentY = item.y;
      }
    }
    
    // Ajouter la dernière ligne
    if (currentRow.length > 0) {
      rows.push(this.createRow(currentRow, rows.length));
    }
    
    return rows;
  }
  
  /**
   * Crée un objet Row à partir d'une liste d'éléments
   */
  private createRow(items: TextItem[], index: number): Row {
    const yValues = items.map(item => item.y);
    const yStart = Math.min(...yValues);
    const yEnd = Math.max(...yValues);
    
    return {
      yStart,
      yEnd,
      index,
      cells: {} // Sera rempli plus tard lors de la création de la table
    };
  }
  
  /**
   * Détecte les colonnes basées sur les positions X
   */
  private detectColumns(items: TextItem[]): Column[] {
    const tolerance = 10; // Tolérance pour regrouper les éléments dans la même colonne
    
    // Extraire toutes les positions X et les trier
    const xPositions = [...new Set(items.map(item => item.x))].sort((a, b) => a - b);
    
    const columns: Column[] = [];
    let currentColumnItems: TextItem[] = [];
    let currentXStart = -1;
    
    for (const x of xPositions) {
      const itemsAtX = items.filter(item => Math.abs(item.x - x) <= tolerance);
      
      if (currentXStart === -1 || x - currentXStart <= tolerance * 2) {
        currentColumnItems.push(...itemsAtX);
        if (currentXStart === -1) currentXStart = x;
      } else {
        if (currentColumnItems.length > 0) {
          columns.push(this.createColumn(currentColumnItems, columns.length, currentXStart));
        }
        currentColumnItems = itemsAtX;
        currentXStart = x;
      }
    }
    
    // Ajouter la dernière colonne
    if (currentColumnItems.length > 0) {
      columns.push(this.createColumn(currentColumnItems, columns.length, currentXStart));
    }
    
    return columns;
  }
  
  /**
   * Crée un objet Column à partir d'une liste d'éléments
   */
  private createColumn(items: TextItem[], index: number, xStart: number): Column {
    const xValues = items.map(item => item.x + item.width);
    const xEnd = Math.max(...xValues);
    
    return {
      xStart,
      xEnd,
      index,
      texts: items
    };
  }
  
  /**
   * Crée la structure tabulaire finale
   */
  private createTableStructure(rows: Row[], columns: Column[]): TableData {
    // Associer les cellules aux lignes et colonnes
    for (const row of rows) {
      for (const column of columns) {
        const cellItems = column.texts.filter(item => 
          item.y >= row.yStart && item.y <= row.yEnd
        );
        
        if (cellItems.length > 0) {
          row.cells[column.index] = cellItems;
        }
      }
    }
    
    // Extraire les headers (première ligne)
    const headers: string[] = [];
    if (rows.length > 0) {
      const firstRow = rows[0];
      for (let i = 0; i < columns.length; i++) {
        const cellItems = firstRow.cells[i] || [];
        headers.push(cellItems.map(item => item.text).join(' '));
      }
    }
    
    // Extraire les données (lignes suivantes)
    const data: string[][] = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowData: string[] = [];
      
      for (let colIndex = 0; colIndex < columns.length; colIndex++) {
        const cellItems = row.cells[colIndex] || [];
        rowData.push(cellItems.map(item => item.text).join(' '));
      }
      
      data.push(rowData);
    }
    
    return {
      columns,
      rows,
      headers,
      data
    };
  }
  
  /**
   * Extrait une section spécifique basée sur des mots-clés
   */
  extractSection(items: TextItem[], startKeyword: string, endKeyword?: string): TextItem[] {
    const startIndex = items.findIndex(item => 
      item.text.toUpperCase().includes(startKeyword.toUpperCase())
    );
    
    if (startIndex === -1) return [];
    
    let endIndex = items.length;
    if (endKeyword) {
      const foundEndIndex = items.findIndex((item, index) => 
        index > startIndex && item.text.toUpperCase().includes(endKeyword.toUpperCase())
      );
      if (foundEndIndex !== -1) {
        endIndex = foundEndIndex;
      }
    }
    
    return items.slice(startIndex, endIndex);
  }
  
  /**
   * Convertit les éléments positionnels en texte structuré
   */
  itemsToStructuredText(items: TextItem[]): string {
    // Grouper par lignes
    const rows = this.groupByRows(items);
    
    // Convertir chaque ligne en texte
    const lines = rows.map(row => {
      const rowItems = Object.values(row.cells).flat();
      return rowItems
        .sort((a, b) => a.x - b.x) // Trier par position X
        .map(item => item.text)
        .join(' ');
    });
    
    return lines.join('\n');
  }
}

export const positionalExtractionService = new PositionalExtractionService();
