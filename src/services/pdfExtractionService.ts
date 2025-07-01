
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
      
      // Timeout pour l'initialisation
      const pdfjs = await this.withTimeout(
        import('pdfjs-dist'),
        15000,
        'Timeout lors du chargement de PDF.js'
      );
      
      this.pdfjsLib = pdfjs;
      
      // Configuration du worker avec fallback
      const workerPaths = [
        '/pdf.worker.min.js', // Worker local
        'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.js', // CDN principal
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js' // CDN backup
      ];

      let workerConfigured = false;
      for (const workerPath of workerPaths) {
        try {
          console.log(`🔧 Configuration du worker: ${workerPath}`);
          this.pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
          workerConfigured = true;
          break;
        } catch (error) {
          console.warn(`⚠️ Échec worker ${workerPath}:`, error);
          continue;
        }
      }

      if (!workerConfigured) {
        console.warn('⚠️ Aucun worker configuré, mode sans worker');
        // Mode sans worker pour les cas critiques
        this.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
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

      // Initialisation avec timeout
      await this.withTimeout(
        this.initializePDFJS(),
        30000,
        'Timeout lors de l\'initialisation PDF.js'
      );
      
      // Chargement du document avec timeout
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer,
        verbosity: 0,
        useSystemFonts: true,
        disableAutoFetch: true, // Éviter les chargements automatiques qui peuvent bloquer
        disableStream: true, // Simplifier le chargement
        stopAtErrors: false
      });
      
      const pdf = await this.withTimeout(
        loadingTask.promise,
        45000,
        'Timeout lors du chargement du PDF'
      );
      
      console.log(`📄 PDF chargé: ${pdf.numPages} pages`);
      onProgress?.(20);
      
      let fullText = '';
      let successfulPages = 0;
      
      // Extraire le texte avec timeout par page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await this.withTimeout(
            pdf.getPage(pageNum),
            10000,
            `Timeout chargement page ${pageNum}`
          );
          
          const textContent = await this.withTimeout(
            page.getTextContent({
              normalizeWhitespace: true,
              disableCombineTextItems: false
            }),
            15000,
            `Timeout extraction texte page ${pageNum}`
          );
          
          const pageText = textContent.items
            .map((item: any) => {
              if (item.str && typeof item.str === 'string') {
                return item.str.trim();
              }
              return '';
            })
            .filter(text => text.length > 0)
            .join(' ');
          
          if (pageText.length > 0) {
            fullText += pageText + '\n';
            successfulPages++;
          }
          
          const progress = 20 + (pageNum / pdf.numPages) * 70;
          onProgress?.(Math.round(progress));
          
          console.log(`📄 Page ${pageNum}/${pdf.numPages} extraite: ${pageText.length} caractères`);
        } catch (pageError) {
          console.warn(`⚠️ Erreur page ${pageNum}:`, pageError);
          // Continuer avec les autres pages
        }
      }
      
      if (fullText.length === 0) {
        throw new Error('Aucun texte extractible trouvé dans le PDF');
      }
      
      onProgress?.(100);
      console.log(`✅ Extraction terminée: ${fullText.length} caractères au total (${successfulPages}/${pdf.numPages} pages)`);
      return fullText.trim();
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('Timeout')) {
          throw new Error('L\'extraction PDF a pris trop de temps. Le fichier est peut-être trop volumineux ou complexe.');
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
      const loadingTask = this.pdfjsLib.getDocument({ data: buffer, verbosity: 0 });
      const pdf = await this.withTimeout(loadingTask.promise, 30000, 'Timeout métadonnées PDF');
      
      const metadata = await pdf.getMetadata();
      return {
        numPages: pdf.numPages,
        title: metadata.info?.Title || 'Titre non disponible',
        author: metadata.info?.Author || 'Auteur non disponible',
        subject: metadata.info?.Subject || 'Sujet non disponible',
        creator: metadata.info?.Creator || 'Créateur non disponible',
        producer: metadata.info?.Producer || 'Producteur non disponible',
        creationDate: metadata.info?.CreationDate || 'Date non disponible'
      };
    } catch (error) {
      console.warn('⚠️ Impossible de récupérer les métadonnées PDF:', error);
      return {
        numPages: 0,
        title: 'Métadonnées non disponibles',
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
