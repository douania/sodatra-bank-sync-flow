
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import CollectionsManager from '@/components/CollectionsManager';
import IntelligentSyncManager from '@/components/IntelligentSyncManager';
import { SyncResult } from '@/services/intelligentSyncService';

const Reconciliation = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSyncComplete = (result: SyncResult) => {
    console.log('✅ Synchronisation terminée:', result);
    handleRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Rapprochement Bancaire</h1>
      </div>

      <Alert className="border-orange-300 bg-orange-50">
        <AlertTriangle className="h-5 w-5 text-orange-600" />
        <AlertDescription className="text-orange-800 font-medium">
          ⚠️ Le moteur de rapprochement bancaire réel n'est pas encore connecté. La Synchronisation Intelligente (Excel) et la consultation des Collections sont actives et opérationnelles.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sync">Synchronisation Intelligente</TabsTrigger>
          <TabsTrigger value="collections">Gestion Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-4">
          <IntelligentSyncManager onSyncComplete={handleSyncComplete} />
        </TabsContent>

        <TabsContent value="collections" className="space-y-4">
          <CollectionsManager refreshTrigger={refreshTrigger} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reconciliation;
