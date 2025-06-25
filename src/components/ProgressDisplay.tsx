
import React from 'react';
import ProgressIndicator from './ProgressIndicator';

export const ProgressDisplay = () => {
  // Default props for when ProgressDisplay is used without specific progress data
  const defaultSteps = [
    {
      id: 'init',
      title: 'Initialisation',
      description: 'Préparation du traitement',
      status: 'pending' as const
    }
  ];

  return (
    <ProgressIndicator 
      steps={defaultSteps}
      overallProgress={0}
      isProcessing={false}
    />
  );
};
