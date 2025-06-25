
import React, { useState, useEffect } from 'react';
import { EnhancedProgressDisplay } from './EnhancedProgressDisplay';
import { progressService } from '@/services/progressService';

interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  details?: string;
}

export const ProgressDisplay = () => {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = progressService.subscribe((event) => {
      // ⭐ MISE À JOUR EN TEMPS RÉEL DES ÉTAPES
      setSteps(prevSteps => {
        const existingStepIndex = prevSteps.findIndex(s => s.id === event.stepId);
        
        if (existingStepIndex >= 0) {
          // Mettre à jour l'étape existante
          const updatedSteps = [...prevSteps];
          updatedSteps[existingStepIndex] = {
            id: event.stepId,
            title: event.stepTitle,
            description: event.stepDescription,
            status: event.type === 'step_start' ? 'running' :
                   event.type === 'step_complete' ? 'completed' :
                   event.type === 'step_error' ? 'error' : 'running',
            progress: event.progress,
            details: event.details || event.error
          };
          return updatedSteps;
        } else {
          // Ajouter une nouvelle étape
          return [...prevSteps, {
            id: event.stepId,
            title: event.stepTitle,
            description: event.stepDescription,
            status: event.type === 'step_start' ? 'running' : 'pending',
            progress: event.progress,
            details: event.details
          }];
        }
      });

      // ⭐ MISE À JOUR DE LA PROGRESSION GLOBALE
      setOverallProgress(event.overallProgress);
      
      // ⭐ DÉTECTION DE L'ÉTAT DE TRAITEMENT
      setIsProcessing(event.type !== 'step_complete' && event.overallProgress < 100);
    });

    return unsubscribe;
  }, []);

  const handleReconnect = () => {
    console.log('🔄 Tentative de reconnexion...');
    // Logique de reconnexion - pour l'instant juste un log
    // Dans une vraie implémentation, on pourrait relancer le processus
  };

  return (
    <EnhancedProgressDisplay
      steps={steps}
      overallProgress={overallProgress}
      isProcessing={isProcessing}
      onReconnect={handleReconnect}
    />
  );
};
