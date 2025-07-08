
// Service dédié pour l'extraction de texte depuis les PDF
export class PDFExtractionService {
  private static instance: PDFExtractionService;
  private pdfjsLib: any = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): PDFExtractionService {
    if (!PDFExtractionService.instance) {
      PDFExtractionService.instance = new PDFExtractionService();
    }
    return PDFExtractionService.instance;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    
    return Promise.race([promise, timeoutPromise]);
  }


  private async initializePDFJS(): Promise<void> {
    if (this.isInitialized && this.pdfjsLib) {
      return;
    }

    // Éviter les initialisations multiples simultanées
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.performInitialization();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async performInitialization(): Promise<void> {
    try {
      console.log('🔧 Initialisation de PDF.js...');
      
      const pdfjs = await import('pdfjs-dist');
      this.pdfjsLib = pdfjs;
      
      // Configuration avec worker CDN pour de meilleures performances
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${this.pdfjsLib.version}/pdf.worker.min.js`;
      console.log('📁 Worker PDF.js configuré via CDN');
      
      this.isInitialized = true;
      console.log('✅ PDF.js initialisé avec succès');
    } catch (error) {
      console.error('❌ Erreur initialisation PDF.js:', error);
      this.isInitialized = false;
      throw new Error('Échec de l\'initialisation PDF.js: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    }
  }

  public async extractTextFromPDF(buffer: ArrayBuffer, onProgress?: (progress: number) => void): Promise<string> {
    try {
      console.log('📄 Début extraction PDF...', `Taille: ${buffer.byteLength} bytes`);
      
      if (buffer.byteLength === 0) {
        throw new Error('Le fichier PDF est vide');
      }

      await this.initializePDFJS();
      onProgress?.(10);
      
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer,
        verbosity: 0
      });
      
      const pdf: any = await loadingTask.promise;
      console.log(`📄 PDF chargé: ${pdf.numPages} pages`);
      onProgress?.(20);
      
      let fullText = '';
      
      // Extraire le texte de toutes les pages
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page: any = await pdf.getPage(pageNum);
          const textContent: any = await page.getTextContent({
            normalizeWhitespace: true,
            disableCombineTextItems: false
          });
          
          const pageText = textContent.items
            .map((item: any) => item.str?.trim() || '')
            .filter((text: string) => text.length > 0)
            .join(' ');
          
          if (pageText.length > 0) {
            fullText += pageText + '\n';
          }
          
          const progress = 20 + ((pageNum / pdf.numPages) * 70);
          onProgress?.(Math.round(progress));
          
        } catch (pageError) {
          console.warn(`⚠️ Erreur page ${pageNum}:`, pageError);
          continue;
        }
      }
      
      if (fullText.length === 0) {
        throw new Error('Aucun texte extractible trouvé dans le PDF');
      }
      
      onProgress?.(100);
      console.log(`✅ Extraction terminée: ${fullText.length} caractères (${pdf.numPages} pages)`);
      return fullText.trim();
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('Invalid PDF')) {
          throw new Error('Le fichier PDF semble corrompu ou n\'est pas un PDF valide.');
        } else if (error.message.includes('vide')) {
          throw new Error('Le fichier PDF est vide ou n\'a pas pu être lu.');
        } else {
          throw new Error(`Erreur d'extraction PDF: ${error.message}`);
        }
      }
      
      throw new Error('Erreur inconnue lors de l\'extraction PDF.');
    }
  }

  public async testPDFJS(): Promise<boolean> {
    try {
      await this.initializePDFJS();
      return true;
    } catch {
      return false;
    }
  }

  // Méthode pour obtenir des métadonnées du PDF
  public async getPDFMetadata(buffer: ArrayBuffer): Promise<any> {
    try {
      await this.initializePDFJS();
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer, 
        verbosity: 0
      });
      const pdf: any = await loadingTask.promise;
      
      const metadata = await pdf.getMetadata();
      return {
        numPages: pdf.numPages,
        title: metadata.info?.Title || 'Titre non disponible',
        author: metadata.info?.Author || 'Auteur non disponible',
        subject: metadata.info?.Subject || 'Sujet non disponible',
        creator: metadata.info?.Creator || 'Créateur non disponible',
        producer: metadata.info?.Producer || 'Producteur non disponible',
        creationDate: metadata.info?.CreationDate || 'Date non disponible',
        fileSize: `${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB`
      };
    } catch (error) {
      console.warn('⚠️ Impossible de récupérer les métadonnées PDF:', error);
      return {
        numPages: 0,
        title: 'Métadonnées non disponibles',
        fileSize: `${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB`,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  // Méthode pour annuler les opérations en cours
  public cancelOperations(): void {
    console.log('🚫 Annulation des opérations PDF en cours...');
    this.isInitialized = false;
    this.pdfjsLib = null;
    this.initPromise = null;
  }
}

// Export de l'instance singleton
export const pdfExtractionService = PDFExtractionService.getInstance();
