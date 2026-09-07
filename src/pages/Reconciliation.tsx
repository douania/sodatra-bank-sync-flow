
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, ShieldOff } from 'lucide-react';
import CollectionsManager from '@/components/CollectionsManager';
import IntelligentSyncManager from '@/components/IntelligentSyncManager';
import { LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE } from '@/services/uploadRuntimeGuard';

// PACK 0 — la page est strictement consultative : la synchronisation Excel
// directe et le marquage manuel effet/chèque sont neutralisés sur toutes les
// cibles (voir uploadRuntimeGuard). La neutralisation frontend ne révoque
// aucun accès serveur : la fermeture serveur reste due avant l'activation du
// nouveau contrat Collections.
const Reconciliation = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Rapprochement Bancaire (consultation)</h1>
      </div>

      <Alert className="border-orange-300 bg-orange-50">
        <AlertTriangle className="h-5 w-5 text-orange-600" />
        <AlertDescription className="text-orange-800 font-medium">
          Le moteur de rapprochement bancaire réel n'est pas connecté. Cette page ne permet que la consultation des
          collections et l'analyse comparative d'un fichier Excel.
        </AlertDescription>
      </Alert>

      <Alert>
        <ShieldOff className="h-4 w-4" />
        <AlertTitle>Écritures legacy isolées</AlertTitle>
        <AlertDescription>{LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE}</AlertDescription>
      </Alert>

      <Tabs defaultValue="collections" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="collections">Collections (consultation)</TabsTrigger>
          <TabsTrigger value="analysis">Analyse Excel (consultation)</TabsTrigger>
        </TabsList>

        <TabsContent value="collections" className="space-y-4">
          <CollectionsManager />
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          <IntelligentSyncManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reconciliation;
