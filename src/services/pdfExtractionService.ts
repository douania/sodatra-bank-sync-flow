
// Service dédié pour l'extraction de texte depuis les PDF
export class PDFExtractionService {
  private static instance: PDFExtractionService;
  private pdfjsLib: any = null;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): PDFExtractionService {
    if (!PDFExtractionService.instance) {
      PDFExtractionService.instance = new PDFExtractionService();
    }
    return PDFExtractionService.instance;
  }

  private async initializePDFJS(): Promise<void> {
    if (this.isInitialized && this.pdfjsLib) {
      return;
    }

    try {
      console.log('🔧 Initialisation de PDF.js...');
      
      // Import statique de pdfjs-dist
      this.pdfjsLib = await import('pdfjs-dist');
      
      // Configuration du worker avec un CDN fiable
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
      
      this.isInitialized = true;
      console.log('✅ PDF.js initialisé avec succès');
    } catch (error) {
      console.error('❌ Erreur initialisation PDF.js:', error);
      throw new Error('Impossible d\'initialiser PDF.js');
    }
  }

  public async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    try {
      await this.initializePDFJS();
      
      console.log('📄 Début extraction PDF...');
      
      // Charger le document PDF
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer,
        verbosity: 0 // Réduire les logs PDF.js
      });
      
      const pdf = await loadingTask.promise;
      console.log(`📄 PDF chargé: ${pdf.numPages} pages`);
      
      let fullText = '';
      
      // Extraire le texte de chaque page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          const pageText = textContent.items
            .map((item: any) => {
              if (item.str) {
                return item.str;
              }
              return '';
            })
            .join(' ');
          
          fullText += pageText + '\n';
          console.log(`📄 Page ${pageNum} extraite: ${pageText.length} caractères`);
        } catch (pageError) {
          console.warn(`⚠️ Erreur page ${pageNum}:`, pageError);
          // Continuer avec les autres pages
        }
      }
      
      console.log(`✅ Extraction terminée: ${fullText.length} caractères au total`);
      return fullText;
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      
      // Message d'erreur plus descriptif
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          throw new Error('Erreur de chargement PDF.js. Vérifiez votre connexion internet.');
        } else if (error.message.includes('Invalid PDF')) {
          throw new Error('Le fichier PDF semble corrompu ou invalide.');
        } else {
          throw new Error(`Erreur PDF: ${error.message}`);
        }
      }
      
      throw new Error('Erreur inconnue lors de l\'extraction PDF');
    }
  }

  // Méthode pour tester si PDF.js est disponible
  public async testPDFJS(): Promise<boolean> {
    try {
      await this.initializePDFJS();
      return true;
    } catch {
      return false;
    }
  }
}

// Export de l'instance singleton
export const pdfExtractionService = PDFExtractionService.getInstance();
