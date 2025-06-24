
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BankReconciliationEngine from '@/components/BankReconciliationEngine';
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
    handleRefresh(); // Rafraîchir les autres composants
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Rapprochement Bancaire</h1>
      </div>

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="sync">Synchronisation Intelligente</TabsTrigger>
          <TabsTrigger value="engine">Moteur de Rapprochement</TabsTrigger>
          <TabsTrigger value="collections">Gestion Collections</TabsTrigger>
          <TabsTrigger value="statistics">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-4">
          <IntelligentSyncManager onSyncComplete={handleSyncComplete} />
        </TabsContent>

        <TabsContent value="engine" className="space-y-4">
          <BankReconciliationEngine />
        </TabsContent>

        <TabsContent value="collections" className="space-y-4">
          <CollectionsManager refreshTrigger={refreshTrigger} />
        </TabsContent>

        <TabsContent value="statistics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Taux de Rapprochement</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">85%</div>
                <p className="text-sm text-gray-600">Rapprochements automatiques</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Montant Traité</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">425M</div>
                <p className="text-sm text-gray-600">FCFA ce mois-ci</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Économie de Temps</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">80%</div>
                <p className="text-sm text-gray-600">Réduction manuelle</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Analyse des Performances</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Rapprochements Parfaits</span>
                    <span>65%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full" style={{ width: '65%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Rapprochements Partiels</span>
                    <span>25%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '25%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Non Rapprochés</span>
                    <span>10%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-red-500 h-2 rounded-full" style={{ width: '10%' }}></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reconciliation;
