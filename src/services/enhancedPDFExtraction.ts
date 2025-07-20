
import * as pdfjsLib from 'pdfjs-dist';

export interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PDFLine {
  y: number;
  items: PDFTextItem[];
  fullText: string;
  columns: string[];
}

export interface PDFSection {
  title: string;
  startY: number;
  endY: number;
  lines: PDFLine[];
  columnHeaders?: string[];
  columnPositions?: number[];
}

export class EnhancedPDFExtraction {
  
  /**
   * Extrait le contenu PDF avec préservation de la structure tabulaire
   */
  async extractStructuredContent(file: File): Promise<{
    rawText: string;
    lines: PDFLine[];
    sections: PDFSection[];
  }> {
    console.log('📄 Extraction PDF structurée...');
    
    try {
      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
      
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      let allItems: PDFTextItem[] = [];
      let rawText = '';
      
      // Extraire tous les éléments de texte avec leurs positions
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        const pageItems = textContent.items.map((item: any) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        }));
        
        allItems.push(...pageItems);
        rawText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
      }
      
      // Grouper les éléments par lignes basées sur la position Y
      const lines = this.groupItemsIntoLines(allItems);
      
      // Identifier les sections du document
      const sections = this.identifySections(lines);
      
      console.log(`✅ PDF structuré: ${lines.length} lignes, ${sections.length} sections`);
      
      return { rawText, lines, sections };
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF structurée:', error);
      throw error;
    }
  }
  
  /**
   * Groupe les éléments de texte en lignes basées sur leur position Y
   */
  private groupItemsIntoLines(items: PDFTextItem[]): PDFLine[] {
    // Filtrer les éléments vides
    const validItems = items.filter(item => item.text.trim().length > 0);
    
    // Grouper par position Y (tolérance de 2 pixels)
    const lineGroups = new Map<number, PDFTextItem[]>();
    
    for (const item of validItems) {
      const roundedY = Math.round(item.y / 2) * 2; // Arrondir à 2 pixels près
      
      if (!lineGroups.has(roundedY)) {
        lineGroups.set(roundedY, []);
      }
      lineGroups.get(roundedY)!.push(item);
    }
    
    // Convertir en lignes et trier par position Y (du haut vers le bas)
    const lines: PDFLine[] = [];
    
    for (const [y, lineItems] of lineGroups.entries()) {
      // Trier les éléments de la ligne par position X (de gauche à droite)
      lineItems.sort((a, b) => a.x - b.x);
      
      const fullText = lineItems.map(item => item.text).join(' ');
      const columns = this.detectColumnsInLine(lineItems);
      
      lines.push({
        y,
        items: lineItems,
        fullText,
        columns
      });
    }
    
    // Trier les lignes par Y (du haut vers le bas - coordonnées PDF inversées)
    lines.sort((a, b) => b.y - a.y);
    
    return lines;
  }
  
  /**
   * Détecte les colonnes dans une ligne basée sur l'espacement des éléments
   */
  private detectColumnsInLine(items: PDFTextItem[]): string[] {
    if (items.length <= 1) return [items[0]?.text || ''];
    
    const columns: string[] = [];
    let currentColumn = '';
    
    for (let i = 0; i < items.length; i++) {
      const currentItem = items[i];
      const nextItem = items[i + 1];
      
      currentColumn += currentItem.text;
      
      // Si il y a un grand écart avec l'élément suivant, c'est une nouvelle colonne
      if (nextItem && (nextItem.x - (currentItem.x + currentItem.width)) > 20) {
        columns.push(currentColumn.trim());
        currentColumn = '';
      } else if (nextItem) {
        currentColumn += ' ';
      }
    }
    
    // Ajouter la dernière colonne
    if (currentColumn.trim()) {
      columns.push(currentColumn.trim());
    }
    
    return columns;
  }
  
  /**
   * Identifie les sections du document BDK
   */
  private identifySections(lines: PDFLine[]): PDFSection[] {
    const sections: PDFSection[] = [];
    let currentSection: PDFSection | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.fullText.toUpperCase();
      
      // Détecter les titres de section
      if (this.isSectionHeader(text)) {
        // Fermer la section précédente
        if (currentSection) {
          currentSection.endY = line.y;
          sections.push(currentSection);
        }
        
        // Créer une nouvelle section
        currentSection = {
          title: text,
          startY: line.y,
          endY: 0,
          lines: [],
          columnHeaders: this.extractColumnHeaders(text, lines, i)
        };
      }
      
      // Ajouter la ligne à la section courante
      if (currentSection) {
        currentSection.lines.push(line);
      }
    }
    
    // Fermer la dernière section
    if (currentSection) {
      currentSection.endY = lines[lines.length - 1]?.y || 0;
      sections.push(currentSection);
    }
    
    return sections;
  }
  
  /**
   * Détermine si une ligne est un en-tête de section
   */
  private isSectionHeader(text: string): boolean {
    const sectionPatterns = [
      /OPENING\s+BALANCE/,
      /ADD\s*:\s*DEPOSIT\s+NOT\s+YET\s+CLEARED/,
      /LESS\s*:\s*CHECK\s+Not\s+yet\s+cleared/,
      /CLOSING\s+BALANCE/,
      /BANK\s+FACILITY/,
      /IMPAYE/
    ];
    
    return sectionPatterns.some(pattern => pattern.test(text));
  }
  
  /**
   * Extrait les en-têtes de colonnes d'une section
   */
  private extractColumnHeaders(sectionTitle: string, lines: PDFLine[], sectionIndex: number): string[] | undefined {
    // Chercher la ligne suivante qui pourrait contenir les en-têtes
    for (let i = sectionIndex + 1; i < Math.min(sectionIndex + 5, lines.length); i++) {
      const line = lines[i];
      const text = line.fullText.toUpperCase();
      
      // Pour la section des chèques
      if (sectionTitle.includes('CHECK') && this.isCheckHeader(text)) {
        return line.columns;
      }
      
      // Pour la section des dépôts
      if (sectionTitle.includes('DEPOSIT') && this.isDepositHeader(text)) {
        return line.columns;
      }
    }
    
    return undefined;
  }
  
  /**
   * Détermine si une ligne contient les headers des chèques
   */
  private isCheckHeader(text: string): boolean {
    return text.includes('DATE') && 
           text.includes('CHECK') && 
           text.includes('DESCRIPTION') &&
           text.includes('AMOUNT');
  }
  
  /**
   * Détermine si une ligne contient les headers des dépôts
   */
  private isDepositHeader(text: string): boolean {
    return text.includes('DATE') && 
           text.includes('DESCRIPTION') && 
           text.includes('VENDOR');
  }
}

export const enhancedPDFExtraction = new EnhancedPDFExtraction();
