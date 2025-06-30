
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
      
      // Import statique de pdfjs-dist pour éviter les problèmes de modules dynamiques
      const pdfjs = await import('pdfjs-dist');
      this.pdfjsLib = pdfjs;
      
      // Essayer d'abord le worker local, puis le CDN en fallback
      const workerPaths = [
        '/pdf.worker.min.js', // Worker local
        'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.js', // CDN alternatif
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js' // CDN backup
      ];

      let workerLoaded = false;
      for (const workerPath of workerPaths) {
        try {
          this.pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
          console.log(`🔧 Tentative de chargement du worker: ${workerPath}`);
          
          // Test simple pour vérifier si le worker fonctionne
          const testDoc = await this.pdfjsLib.getDocument({ data: new Uint8Array([]) }).promise.catch(() => null);
          if (testDoc || workerPath.includes('unpkg') || workerPath.includes('jsdelivr')) {
            console.log(`✅ Worker PDF.js configuré: ${workerPath}`);
            workerLoaded = true;
            break;
          }
        } catch (error) {
          console.warn(`⚠️ Échec du worker ${workerPath}:`, error);
          continue;
        }
      }

      if (!workerLoaded) {
        console.warn('⚠️ Aucun worker PDF.js disponible, mode dégradé');
      }
      
      this.isInitialized = true;
      console.log('✅ PDF.js initialisé');
    } catch (error) {
      console.error('❌ Erreur initialisation PDF.js:', error);
      throw new Error('Impossible d\'initialiser PDF.js: ' + (error instanceof Error ? error.message : 'Erreur inconnue'));
    }
  }

  public async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    try {
      await this.initializePDFJS();
      
      console.log('📄 Début extraction PDF...', `Taille: ${buffer.byteLength} bytes`);
      
      if (buffer.byteLength === 0) {
        throw new Error('Le fichier PDF est vide');
      }
      
      // Charger le document PDF avec options de robustesse
      const loadingTask = this.pdfjsLib.getDocument({ 
        data: buffer,
        verbosity: 0, // Réduire les logs PDF.js
        useSystemFonts: true, // Utiliser les polices système
        disableAutoFetch: false, // Permettre le chargement automatique
        disableStream: false, // Permettre le streaming
        disableRange: false, // Permettre le chargement par plages
        stopAtErrors: false // Continuer malgré les erreurs
      });
      
      const pdf = await loadingTask.promise;
      console.log(`📄 PDF chargé: ${pdf.numPages} pages`);
      
      let fullText = '';
      let successfulPages = 0;
      
      // Extraire le texte de chaque page avec gestion d'erreurs robuste
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent({
            normalizeWhitespace: true, // Normaliser les espaces
            disableCombineTextItems: false // Combiner les éléments de texte
          });
          
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
          
          console.log(`📄 Page ${pageNum} extraite: ${pageText.length} caractères`);
        } catch (pageError) {
          console.warn(`⚠️ Erreur page ${pageNum}:`, pageError);
          // Continuer avec les autres pages
        }
      }
      
      if (fullText.length === 0) {
        throw new Error('Aucun texte extractible trouvé dans le PDF');
      }
      
      console.log(`✅ Extraction terminée: ${fullText.length} caractères au total (${successfulPages}/${pdf.numPages} pages)`);
      return fullText.trim();
      
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      
      // Messages d'erreur plus descriptifs et utiles
      if (error instanceof Error) {
        if (error.message.includes('Invalid PDF')) {
          throw new Error('Le fichier PDF semble corrompu ou n\'est pas un PDF valide. Vérifiez le fichier et réessayez.');
        } else if (error.message.includes('fetch')) {
          throw new Error('Problème de chargement des ressources PDF.js. L\'extraction peut ne pas fonctionner correctement.');
        } else if (error.message.includes('worker')) {
          throw new Error('Erreur de configuration PDF.js. Certaines fonctionnalités peuvent être limitées.');
        } else if (error.message.includes('vide')) {
          throw new Error('Le fichier PDF est vide ou n\'a pas pu être lu.');
        } else {
          throw new Error(`Erreur d'extraction PDF: ${error.message}`);
        }
      }
      
      throw new Error('Erreur inconnue lors de l\'extraction PDF. Vérifiez que le fichier est un PDF valide.');
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

  // Méthode pour obtenir des métadonnées du PDF sans extraction complète
  public async getPDFMetadata(buffer: ArrayBuffer): Promise<any> {
    try {
      await this.initializePDFJS();
      const loadingTask = this.pdfjsLib.getDocument({ data: buffer, verbosity: 0 });
      const pdf = await loadingTask.promise;
      
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
}

// Export de l'instance singleton
export const pdfExtractionService = PDFExtractionService.getInstance();
