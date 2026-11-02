import { currentTreasuryRuntimeVerdict, isTreasuryRuntimeRefused } from './treasuryRuntimeTarget';

/** Le lien de menu « Soldes à date » n'apparaît que si la cible est autorisée (jamais en production). */
export function isTreasuryMenuVisible(): boolean {
  return !isTreasuryRuntimeRefused(currentTreasuryRuntimeVerdict());
}
