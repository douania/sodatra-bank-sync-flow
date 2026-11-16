import { currentSituationRuntimeVerdict, isSituationRuntimeRefused } from './situationRuntimeTarget';

/** Le lien de menu « Situation du jour » n'apparaît que si la cible est autorisée (jamais en production). */
export function isSituationMenuVisible(): boolean {
  return !isSituationRuntimeRefused(currentSituationRuntimeVerdict());
}
