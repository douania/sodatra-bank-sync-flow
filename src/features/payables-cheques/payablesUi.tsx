/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { newCommandKey } from './payablesChequesService';
import { formatXof } from './operationalPositionModel';
import type { PayablesAccess, PayablesCapability } from './payablesChequesTypes';

export const PAYABLES_QUERY_ROOT = 'payables-cheques';

/**
 * Clé de commande stable pour une intention utilisateur : une nouvelle tentative
 * après coupure rejoue la même clé ; la clé change seulement après un succès.
 */
export function useCommandKey(scope: string): [string, () => void] {
  const [key, setKey] = useState(() => newCommandKey(scope));
  const rotate = useCallback(() => setKey(newCommandKey(scope)), [scope]);
  return [key, rotate];
}

/** Mutation du domaine : succès signalé, erreur en vocabulaire fermé, lectures invalidées. */
export function usePayablesMutation<TArgs, TResult>(
  scope: string,
  run: (key: string, args: TArgs) => Promise<TResult>,
  successMessage: string,
) {
  const queryClient = useQueryClient();
  const [key, rotate] = useCommandKey(scope);
  return useMutation({
    mutationFn: (args: TArgs) => run(key, args),
    onSuccess: () => {
      rotate();
      toast.success(successMessage);
      void queryClient.invalidateQueries({ queryKey: [PAYABLES_QUERY_ROOT] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function hasCapability(access: PayablesAccess, capability: PayablesCapability): boolean {
  return access.business_writes_enabled && access.capabilities.includes(capability);
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function Amount({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Indisponible</span>;
  return <span className="tabular-nums">{formatXof(value)}</span>;
}

export const nativeSelectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}
