/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  collectionsCorePilotActor,
  collectionsCoreRuntimeSignature,
  resolveCollectionsCorePilotGate,
  type CollectionsCorePilotActor,
  type CollectionsCorePilotGateState,
} from './collectionsCorePilotAccess';
import { currentCollectionsCoreRuntimeVerdict } from './collectionsCoreRuntimeTarget';

interface CollectionsCorePilotGateContextValue {
  gate: CollectionsCorePilotGateState;
  actor: CollectionsCorePilotActor | null;
}

const CollectionsCorePilotGateContext = createContext<CollectionsCorePilotGateContextValue>({
  gate: { status: 'checking' },
  actor: null,
});

export function CollectionsCorePilotGateProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [verdict] = useState(currentCollectionsCoreRuntimeVerdict);
  const signature = collectionsCoreRuntimeSignature(verdict);
  const [resolved, setResolved] = useState<CollectionsCorePilotGateState>({ status: 'checking' });

  useEffect(() => {
    let current = true;
    setResolved({ status: 'checking' });
    void resolveCollectionsCorePilotGate(verdict).then((gate) => {
      if (current) setResolved(gate);
    });
    return () => {
      current = false;
    };
  }, [signature, verdict]);

  const value = useMemo<CollectionsCorePilotGateContextValue>(() => {
    if (loading || resolved.status === 'checking') return { gate: { status: 'checking' }, actor: null };
    if (resolved.status !== 'allowed' || resolved.environment === 'local') {
      return { gate: resolved, actor: null };
    }
    if (!user) {
      return { gate: { status: 'blocked', reason: 'Une session pilote autorisée est requise.' }, actor: null };
    }
    const actor = collectionsCorePilotActor(resolved.pilotManifest, user.id);
    if (!actor) {
      return { gate: { status: 'blocked', reason: 'Ce compte ne fait pas partie des trois acteurs du pilote.' }, actor: null };
    }
    return { gate: resolved, actor };
  }, [loading, resolved, user]);

  return (
    <CollectionsCorePilotGateContext.Provider value={value}>
      {children}
    </CollectionsCorePilotGateContext.Provider>
  );
}

export function useCollectionsCorePilotGate() {
  return useContext(CollectionsCorePilotGateContext);
}
