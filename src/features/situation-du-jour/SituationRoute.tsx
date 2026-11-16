import { SituationDuJourPage } from './SituationDuJourPage';
import { currentSituationRuntimeVerdict, isSituationRuntimeRefused } from './situationRuntimeTarget';

// Garde de la route : la cible est évaluée AVANT de monter l'écran. Refusée
// (production, cible inconnue ou contradictoire, drapeau absent), l'écran
// n'est pas monté et aucun fichier ne peut être déposé.
export function SituationRoute() {
  const verdict = currentSituationRuntimeVerdict();
  if (isSituationRuntimeRefused(verdict)) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Situation du jour non disponible</h1>
        <p className="mt-2 text-sm text-muted-foreground">{verdict.reason}</p>
      </div>
    );
  }
  return <SituationDuJourPage />;
}
