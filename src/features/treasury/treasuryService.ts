import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { currentTreasuryRuntimeVerdict, isTreasuryRuntimeRefused } from './treasuryRuntimeTarget';
import { errorMessage, parseTreasuryBalances, TreasuryError, treasuryErrorCode, type TreasuryBalances } from './treasuryModel';

// Les fonctions de trésorerie ne figurent pas dans les types générés : client non
// typé localement, sans modification de src/integrations/supabase/types.ts.
const db = supabase as unknown as SupabaseClient;

// La cible est vérifiée AVANT tout accès au client : en production, aucun appel
// réseau n'est émis, quel que soit le drapeau du module chèques.
function assertTarget(): void {
  const verdict = currentTreasuryRuntimeVerdict();
  if (isTreasuryRuntimeRefused(verdict)) {
    throw new TreasuryError('TREASURY_RUNTIME_REFUSED', verdict.reason);
  }
}

function toTreasuryError(raw: unknown, fallback: string): TreasuryError {
  const code = treasuryErrorCode(raw);
  return new TreasuryError(code ?? 'TREASURY_REQUEST_FAILED', errorMessage(code, fallback));
}

/** Clé d'idempotence d'une action : à créer une fois par décision, réutilisée à chaque nouvel envoi. */
export function newTreasuryCommandKey(): string {
  return `treasury:${globalThis.crypto.randomUUID()}`;
}

/**
 * Une clé par décision : chaque décision (signature) garde sa clé tant qu'elle
 * n'a pas abouti, même si d'autres décisions sont envoyées entre-temps. Un
 * double clic ou un nouvel essai après une réponse perdue rejoue donc la même
 * commande au lieu d'en créer une seconde.
 */
export function createCommandKeyKeeper(newKey: () => string = newTreasuryCommandKey) {
  const pending = new Map<string, string>();
  return {
    keyFor(signature: string): string {
      const known = pending.get(signature);
      if (known !== undefined) return known;
      const key = newKey();
      pending.set(signature, key);
      return key;
    },
    succeeded(key: string): void {
      for (const [signature, pendingKey] of pending) {
        if (pendingKey === key) pending.delete(signature);
      }
    },
  };
}

/** Décisions d'inventaire en attente pour la page : survivent au masquage du panneau. */
export const inventoryCommandKeys = createCommandKeyKeeper();

export async function fetchTreasuryBalances(asOf: string): Promise<TreasuryBalances> {
  assertTarget();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new TreasuryError('TREASURY_AS_OF_REQUIRED', errorMessage('TREASURY_AS_OF_REQUIRED'));
  }
  const { data, error } = await db.rpc('treasury_balances_at_v1', { p_as_of: asOf });
  if (error) throw toTreasuryError(error, 'La lecture des soldes a été refusée.');
  return parseTreasuryBalances(data);
}

/**
 * Lecture liée à la session : la clé porte l'utilisateur, rien n'est lu sans
 * session et rien n'est conservé en cache une fois la vue quittée.
 */
export function treasuryBalancesQuery(userId: string | null, asOf: string) {
  return {
    queryKey: ['treasury-balances', userId, asOf] as const,
    queryFn: () => fetchTreasuryBalances(asOf),
    enabled: userId !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

type AdminResult = Record<string, unknown>;

async function adminCall(name: string, commandKey: string, args: Record<string, unknown>): Promise<AdminResult> {
  assertTarget();
  const { data, error } = await db.rpc(name, { p_command_key: commandKey, ...args });
  if (error) throw toTreasuryError(error, 'La décision a été refusée.');
  return (data ?? {}) as AdminResult;
}

export function addRegistryAccountToInventory(commandKey: string, registryAccountId: string, reason: string): Promise<AdminResult> {
  return adminCall('treasury_admin_add_expected_account_v1', commandKey, {
    p_registry_account_id: registryAccountId, p_bank: null, p_currency: null, p_safe_alias: null, p_reason: reason,
  });
}

export function addUnregisteredAccountToInventory(
  commandKey: string, input: { bank: string; currency: string; alias: string; reason: string },
): Promise<AdminResult> {
  return adminCall('treasury_admin_add_expected_account_v1', commandKey, {
    p_registry_account_id: null, p_bank: input.bank, p_currency: input.currency, p_safe_alias: input.alias,
    p_reason: input.reason,
  });
}

export function linkExpectedAccount(
  commandKey: string, expectedAccountId: string, registryAccountId: string, reason: string,
): Promise<AdminResult> {
  return adminCall('treasury_admin_link_expected_account_v1', commandKey, {
    p_expected_account_id: expectedAccountId, p_registry_account_id: registryAccountId, p_reason: reason,
  });
}

export function retireExpectedAccount(commandKey: string, expectedAccountId: string, reason: string): Promise<AdminResult> {
  return adminCall('treasury_admin_retire_expected_account_v1', commandKey, {
    p_expected_account_id: expectedAccountId, p_reason: reason,
  });
}

export function attestInventory(commandKey: string, inventoryFingerprint: string, reason: string): Promise<AdminResult> {
  return adminCall('treasury_admin_attest_inventory_v1', commandKey, {
    p_inventory_fingerprint: inventoryFingerprint, p_reason: reason,
  });
}
