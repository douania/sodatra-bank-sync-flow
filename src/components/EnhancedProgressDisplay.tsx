
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Clock, AlertCircle, Loader, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { ProgressPersistenceService } from '@/services/progressPersistenceService';

interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  details?: string;
  error?: string;
}

interface EnhancedProgressDisplayProps {
  steps: ProgressStep[];
  overallProgress: number;
  isProcessing: boolean;
  onReconnect?: () => void;
}

export const EnhancedProgressDisplay: React.FC<EnhancedProgressDisplayProps> = ({
  steps,
  overallProgress,
  isProcessing,
  onReconnect
}) => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [persistedState, setPersistedState] = useState(ProgressPersistenceService.loadProgress());
  const [elapsedTime, setElapsedTime] = useState(0);

  // ⭐ MISE À JOUR PÉRIODIQUE DE L'ÉTAT PERSISTÉ
  useEffect(() => {
    const interval = setInterval(() => {
      const state = ProgressPersistenceService.loadProgress();
      setPersistedState(state);
      
      if (state) {
        setElapsedTime(ProgressPersistenceService.getElapsedTime());
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // ⭐ DÉTECTION DE DÉCONNEXION
  useEffect(() => {
    if (isProcessing && steps.length === 0 && persistedState?.isActive) {
      setConnectionStatus('disconnected');
    } else if (isProcessing) {
      setConnectionStatus('connected');
    }
  }, [isProcessing, steps.length, persistedState]);

  // ⭐ SAUVEGARDE AUTOMATIQUE DU PROGRÈS
  useEffect(() => {
    if (isProcessing && steps.length > 0) {
      const currentStep = steps.find(s => s.status === 'running')?.id || 'unknown';
      const stepDetails = steps.reduce((acc, step) => {
        acc[step.id] = {
          status: step.status,
          progress: step.progress,
          details: step.details,
          error: step.error
        };
        return acc;
      }, {} as any);

      ProgressPersistenceService.saveProgress({
        currentStep,
        overallProgress,
        stepDetails,
        isActive: true
      });
    } else if (!isProcessing) {
      // Marquer comme inactif mais garder l'historique
      const state = ProgressPersistenceService.loadProgress();
      if (state) {
        ProgressPersistenceService.saveProgress({
          ...state,
          isActive: false
        });
      }
    }
  }, [isProcessing, steps, overallProgress]);

  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStepIcon = (status: ProgressStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'running':
        return <Loader className="h-5 w-5 text-blue-600 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStepBadge = (status: ProgressStep['status']) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Terminé</Badge>;
      case 'running':
        return <Badge className="bg-blue-100 text-blue-800">En cours</Badge>;
      case 'error':
        return <Badge variant="destructive">Erreur</Badge>;
      default:
        return <Badge variant="outline">En attente</Badge>;
    }
  };

  const handleReconnect = () => {
    setConnectionStatus('reconnecting');
    onReconnect?.();
    
    // Simuler une reconnexion
    setTimeout(() => {
      setConnectionStatus('connected');
    }, 2000);
  };

  const handleClearHistory = () => {
    ProgressPersistenceService.clearProgress();
    setPersistedState(null);
  };

  const isReconnecting = connectionStatus === 'reconnecting';
  const isDisconnected = connectionStatus === 'disconnected';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span>Progression du Traitement</span>
            {isProcessing && <Loader className="h-5 w-5 animate-spin" />}
            
            {/* ⭐ INDICATEUR DE CONNEXION */}
            <div className="flex items-center">
              {connectionStatus === 'connected' && (
                <Wifi className="h-4 w-4 text-green-600" />
              )}
              {isDisconnected && (
                <WifiOff className="h-4 w-4 text-red-600" />
              )}
              {isReconnecting && (
                <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
              )}
            </div>
          </div>

          {/* ⭐ TEMPS ÉCOULÉ */}
          {(elapsedTime > 0 || isProcessing) && (
            <div className="text-sm text-gray-600">
              {formatElapsedTime(elapsedTime)}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* ⭐ AVERTISSEMENT DE DÉCONNEXION */}
        {isDisconnected && persistedState?.isActive && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-yellow-800">Connexion perdue</h4>
                <p className="text-sm text-yellow-700">
                  Le traitement continue en arrière-plan. Session: {persistedState.sessionId.slice(-8)}
                </p>
              </div>
              <Button 
                onClick={handleReconnect}
                variant="outline"
                size="sm"
                disabled={isReconnecting}
              >
                {isReconnecting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Reconnexion...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reconnecter
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ⭐ BARRE DE PROGRESSION GLOBALE */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progression globale</span>
            <span>{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="w-full h-3" />
        </div>

        {/* ⭐ ÉTAPES DÉTAILLÉES */}
        <div className="space-y-4">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`border rounded-lg p-4 transition-all ${
                step.status === 'running' ? 'border-blue-300 bg-blue-50' : 
                step.status === 'completed' ? 'border-green-300 bg-green-50' :
                step.status === 'error' ? 'border-red-300 bg-red-50' :
                'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {getStepIcon(step.status)}
                  <div>
                    <div className="font-medium">{step.title}</div>
                    <div className="text-sm text-gray-600">{step.description}</div>
                    {step.details && (
                      <div className="text-xs text-gray-500 mt-1">{step.details}</div>
                    )}
                    {step.error && (
                      <div className="text-xs text-red-600 mt-1">{step.error}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {getStepBadge(step.status)}
                  {step.status === 'running' && step.progress !== undefined && (
                    <span className="text-sm text-blue-600 font-medium">
                      {Math.round(step.progress)}%
                    </span>
                  )}
                </div>
              </div>
              
              {/* ⭐ BARRE DE PROGRESSION POUR L'ÉTAPE */}
              {step.status === 'running' && step.progress !== undefined && (
                <div className="mt-3">
                  <Progress value={step.progress} className="w-full h-2" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ⭐ BOUTONS D'ACTION */}
        {persistedState && !isProcessing && (
          <div className="flex justify-end space-x-2">
            <Button
              onClick={handleClearHistory}
              variant="outline"
              size="sm"
            >
              Effacer l'historique
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
