import TreasuryBalances from '@/pages/TreasuryBalances';
import { currentTreasuryRuntimeVerdict, isTreasuryRuntimeRefused } from './treasuryRuntimeTarget';

// Garde de la route : la cible est évaluée avant de monter la page ; refusée,
// aucune lecture n'est lancée (la page, et donc le service, ne sont pas montés).
export function TreasuryRoute() {
  const verdict = currentTreasuryRuntimeVerdict();
  if (isTreasuryRuntimeRefused(verdict)) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Soldes à date non disponibles</h1>
        <p className="mt-2 text-sm text-muted-foreground">{verdict.reason}</p>
      </div>
    );
  }
  return <TreasuryBalances />;
}
