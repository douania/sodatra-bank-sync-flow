
type ProgressEventType = 'step_start' | 'step_progress' | 'step_complete' | 'step_error' | 'overall_progress';

interface ProgressEvent {
  type: ProgressEventType;
  stepId: string;
  stepTitle: string;
  stepDescription: string;
  progress?: number;
  details?: string;
  error?: string;
  overallProgress: number;
}

type ProgressCallback = (event: ProgressEvent) => void;

class ProgressService {
  private callbacks: ProgressCallback[] = [];
  private currentOverallProgress = 0;
  private stepProgressMap: Map<string, number> = new Map();

  subscribe(callback: ProgressCallback) {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  emit(event: ProgressEvent) {
    this.callbacks.forEach(callback => callback(event));
  }

  startStep(stepId: string, title: string, description: string) {
    this.stepProgressMap.set(stepId, 0);
    this.emit({
      type: 'step_start',
      stepId,
      stepTitle: title,
      stepDescription: description,
      overallProgress: this.currentOverallProgress
    });
  }

  updateStepProgress(stepId: string, title: string, description: string, progress: number, details?: string) {
    // Mettre à jour la progression de l'étape
    this.stepProgressMap.set(stepId, progress);
    
    // Calculer automatiquement la progression globale basée sur les étapes
    this.recalculateOverallProgress();
    
    this.emit({
      type: 'step_progress',
      stepId,
      stepTitle: title,
      stepDescription: description,
      progress,
      details,
      overallProgress: this.currentOverallProgress
    });
  }

  completeStep(stepId: string, title: string, description: string, details?: string) {
    this.stepProgressMap.set(stepId, 100);
    this.recalculateOverallProgress();
    
    this.emit({
      type: 'step_complete',
      stepId,
      stepTitle: title,
      stepDescription: description,
      details,
      overallProgress: this.currentOverallProgress
    });
  }

  errorStep(stepId: string, title: string, description: string, error: string) {
    this.emit({
      type: 'step_error',
      stepId,
      stepTitle: title,
      stepDescription: description,
      error,
      overallProgress: this.currentOverallProgress
    });
  }

  updateOverallProgress(progress: number) {
    this.currentOverallProgress = Math.min(100, Math.max(0, progress));
    this.emit({
      type: 'overall_progress',
      stepId: 'overall',
      stepTitle: 'Progression globale',
      stepDescription: 'Traitement en cours',
      overallProgress: this.currentOverallProgress
    });
  }

  // Nouvelle méthode pour calculer automatiquement la progression globale
  private recalculateOverallProgress() {
    const steps = Array.from(this.stepProgressMap.values());
    if (steps.length === 0) return;
    
    const totalProgress = steps.reduce((sum, progress) => sum + progress, 0);
    const averageProgress = totalProgress / steps.length;
    
    this.currentOverallProgress = Math.min(100, Math.max(0, averageProgress));
  }

  reset() {
    this.currentOverallProgress = 0;
    this.stepProgressMap.clear();
  }
}

export const progressService = new ProgressService();
