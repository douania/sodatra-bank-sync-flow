
// ⭐ SERVICE DE PERSISTANCE DES PROGRÈS
interface ProgressState {
  sessionId: string;
  startTime: number;
  currentStep: string;
  overallProgress: number;
  stepDetails: {
    [stepId: string]: {
      status: 'pending' | 'running' | 'completed' | 'error';
      progress?: number;
      details?: string;
      error?: string;
    };
  };
  isActive: boolean;
  lastUpdate: number;
}

export class ProgressPersistenceService {
  private static readonly STORAGE_KEY = 'sodatra_processing_progress';
  private static sessionId = this.generateSessionId();

  private static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  static saveProgress(progressState: Omit<ProgressState, 'sessionId' | 'startTime' | 'lastUpdate'>): void {
    const existingState = this.loadProgress();
    
    const fullState: ProgressState = {
      sessionId: this.sessionId,
      startTime: existingState?.startTime || Date.now(),
      lastUpdate: Date.now(),
      ...progressState
    };

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(fullState));
      console.log('💾 Progression sauvegardée:', {
        session: fullState.sessionId,
        step: fullState.currentStep,
        progress: fullState.overallProgress
      });
    } catch (error) {
      console.warn('⚠️ Impossible de sauvegarder la progression:', error);
    }
  }

  static loadProgress(): ProgressState | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;

      const state: ProgressState = JSON.parse(stored);
      
      // Vérifier si la session n'est pas trop ancienne (2 heures max)
      const maxAge = 2 * 60 * 60 * 1000; // 2 heures
      if (Date.now() - state.lastUpdate > maxAge) {
        console.log('🕒 Session expirée, suppression');
        this.clearProgress();
        return null;
      }

      return state;
    } catch (error) {
      console.warn('⚠️ Impossible de charger la progression:', error);
      return null;
    }
  }

  static clearProgress(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('🗑️ Progression effacée');
    } catch (error) {
      console.warn('⚠️ Impossible d\'effacer la progression:', error);
    }
  }

  static isProcessingActive(): boolean {
    const state = this.loadProgress();
    return state?.isActive === true;
  }

  static getElapsedTime(): number {
    const state = this.loadProgress();
    if (!state) return 0;
    return Date.now() - state.startTime;
  }

  static getSessionInfo(): { id: string; elapsed: number } | null {
    const state = this.loadProgress();
    if (!state) return null;
    
    return {
      id: state.sessionId,
      elapsed: this.getElapsedTime()
    };
  }
}
