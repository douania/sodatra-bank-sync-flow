
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
    this.emit({
      type: 'step_start',
      stepId,
      stepTitle: title,
      stepDescription: description,
      overallProgress: this.currentOverallProgress
    });
  }

  updateStepProgress(stepId: string, title: string, description: string, progress: number, details?: string) {
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
    this.currentOverallProgress = progress;
    this.emit({
      type: 'overall_progress',
      stepId: 'overall',
      stepTitle: 'Progression globale',
      stepDescription: 'Traitement en cours',
      overallProgress: progress
    });
  }

  reset() {
    this.currentOverallProgress = 0;
  }
}

export const progressService = new ProgressService();
