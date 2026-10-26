/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { currentPayablesRuntimeVerdict, isRuntimeRefused } from './payablesRuntimeTarget';
import { readMyAccess } from './payablesChequesService';
import type { PayablesAccess } from './payablesChequesTypes';

export type PayablesGateState =
  | { status: 'checking' }
  | { status: 'blocked'; reason: string }
  | { status: 'allowed'; access: PayablesAccess };

const PayablesChequesGateContext = createContext<{ gate: PayablesGateState; refresh: () => void }>({
  gate: { status: 'checking' },
  refresh: () => undefined,
});

export function PayablesChequesGateProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [verdict] = useState(currentPayablesRuntimeVerdict);
  const [gate, setGate] = useState<PayablesGateState>({ status: 'checking' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let current = true;
    if (loading) {
      setGate({ status: 'checking' });
      return () => { current = false; };
    }
    if (isRuntimeRefused(verdict)) {
      setGate({ status: 'blocked', reason: verdict.reason });
      return () => { current = false; };
    }
    if (!user) {
      setGate({ status: 'blocked', reason: 'Une session authentifiée est requise.' });
      return () => { current = false; };
    }
    setGate({ status: 'checking' });
    readMyAccess()
      .then((access) => {
        if (!current) return;
        const canRead = access.capabilities.includes('READ') || access.capabilities.includes('AUDIT');
        setGate(canRead ? { status: 'allowed', access } : { status: 'blocked', reason: 'Aucune habilitation de lecture sur ce module.' });
      })
      .catch((error: Error) => {
        if (current) setGate({ status: 'blocked', reason: error.message });
      });
    return () => { current = false; };
  }, [loading, user, verdict, generation]);

  const value = useMemo(() => ({ gate, refresh: () => setGeneration((n) => n + 1) }), [gate]);
  return <PayablesChequesGateContext.Provider value={value}>{children}</PayablesChequesGateContext.Provider>;
}

export function usePayablesChequesGate() {
  return useContext(PayablesChequesGateContext);
}
