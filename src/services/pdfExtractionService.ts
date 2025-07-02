
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

  private calculateTimeouts(fileSize: number) {
    // Calcul adaptatif des timeouts basé sur la taille du fichier
    const baseSizeInMB = fileSize / (1024 * 1024);
    
    return {
      initialization: Math.max(15000, Math.min(45000, baseSizeInMB * 2000)), // 15s à 45s
      documentLoading: Math.max(30000, Math.min(90000, baseSizeInMB * 3000)), // 30s à 90s
      pageLoading: Math.max(8000, Math.min(20000, baseSizeInMB * 500)), // 8s à 20s
      textExtraction: Math.max(10000, Math.min(30000, baseSizeInMB * 1000)) // 10s à 30s
    };
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
      
      // Timeout pour l'initialisation (réduit)
      const pdfjs = await this.withTimeout(
        import('pdfjs-dist'),
        15000,
        'Timeout lors du chargement de PDF.js'
      );
      
      this.pdfjsLib = pdfjs;
      
      // Configuration du worker avec fallback intelligent
      try {
        // Essayer le worker local d'abord
        console.log('🔧 Configuration worker local...');
        this.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
        console.log('✅ Worker local configuré');
      } catch (localError) {
        console.warn('⚠️ Worker local non disponible, essai CDN...', localError);
        
        try {
          // Fallback vers CDN avec version plus récente
          this.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.js';
          console.log('✅ Worker CDN configuré');
        } catch (cdnError) {
          console.warn('⚠️ Worker CDN non disponible, mode sans worker...', cdnError);
          
          // Mode sans worker en dernier recours
          this.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          console.log('⚠️ Mode sans worker activé - performance réduite mais fonctionnel');
        }
      }
      
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

      // Calcul des timeouts adaptés à la taille du fichier
      const timeouts = this.calculateTimeouts(buffer.byteLength);
      console.log('⏱️ Timeouts calculés:', timeouts);

      // Initialisation avec timeout adaptatif
      await this.withTimeout(
        this.initializePDFJS(),
        timeouts.initialization,
        'Timeout lors de l\'initialisation PDF.js'
      );
      
      onProgress?.(10);
      
      // Configuration optimisée pour l'extraction
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer,
        verbosity: 0,
        useSystemFonts: false, // Désactiver pour améliorer les performances
        disableAutoFetch: true,
        disableStream: true,
        stopAtErrors: false,
        maxImageSize: 1024 * 1024, // Limiter la taille des images pour éviter les timeouts
        cMapPacked: true
      });
      
      // Chargement du document avec timeout adaptatif
      const pdf: any = await this.withTimeout(
        loadingTask.promise,
        timeouts.documentLoading,
        `Timeout lors du chargement du PDF (${timeouts.documentLoading}ms)`
      );
      
      console.log(`📄 PDF chargé: ${pdf.numPages} pages`);
      onProgress?.(20);
      
      let fullText = '';
      let successfulPages = 0;
      const maxPages = Math.min(pdf.numPages, 50); // Limiter à 50 pages pour éviter les timeouts
      
      if (pdf.numPages > 50) {
        console.log(`⚠️ PDF volumineux (${pdf.numPages} pages), limitation à ${maxPages} pages`);
      }
      
      // Extraire le texte avec timeouts adaptés par page
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        try {
          console.log(`📄 Traitement page ${pageNum}/${maxPages}...`);
          
          const page: any = await this.withTimeout(
            pdf.getPage(pageNum),
            timeouts.pageLoading,
            `Timeout chargement page ${pageNum}`
          );
          
          const textContent: any = await this.withTimeout(
            page.getTextContent({
              normalizeWhitespace: true,
              disableCombineTextItems: false,
              includeMarkedContent: false // Désactiver pour améliorer les performances
            }),
            timeouts.textExtraction,
            `Timeout extraction texte page ${pageNum}`
          );
          
          const pageText = textContent.items
            .map((item: any) => {
              if (item.str && typeof item.str === 'string') {
                return item.str.trim();
              }
              return '';
            })
            .filter((text: string) => text.length > 0)
            .join(' ');
          
          if (pageText.length > 0) {
            fullText += pageText + '\n';
            successfulPages++;
          }
          
          const progress = 20 + ((pageNum / maxPages) * 70);
          onProgress?.(Math.round(progress));
          
          console.log(`📄 Page ${pageNum}/${maxPages} extraite: ${pageText.length} caractères`);
        } catch (pageError) {
          console.warn(`⚠️ Erreur page ${pageNum}:`, pageError);
          // Continuer avec les autres pages au lieu de bloquer
          continue;
        }
      }
      
      if (fullText.length === 0) {
        throw new Error('Aucun texte extractible trouvé dans le PDF');
      }
      
      onProgress?.(100);
      const finalMessage = pdf.numPages > 50 
        ? `✅ Extraction terminée: ${fullText.length} caractères (${successfulPages}/${maxPages} pages traitées sur ${pdf.numPages} au total)`
        : `✅ Extraction terminée: ${fullText.length} caractères (${successfulPages}/${pdf.numPages} pages)`;
      
      console.log(finalMessage);
      return fullText.trim();
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('Timeout')) {
          throw new Error('L\'extraction PDF a pris trop de temps. Essayez avec un fichier plus petit ou contactez le support.');
        } else if (error.message.includes('Invalid PDF')) {
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
      await this.withTimeout(this.initializePDFJS(), 10000, 'Timeout test PDF.js');
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
        verbosity: 0,
        useSystemFonts: false,
        disableAutoFetch: true,
        disableStream: true
      });
      const pdf: any = await this.withTimeout(loadingTask.promise, 20000, 'Timeout métadonnées PDF');
      
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
