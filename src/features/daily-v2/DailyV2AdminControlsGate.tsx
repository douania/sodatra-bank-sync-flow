import React, { type ReactNode } from 'react';

interface DailyV2AdminControlsGateProps {
  allowed: boolean;
  renderControls: () => ReactNode;
}

/**
 * Frontière de rendu des commandes registre/backfill.
 *
 * La callback n'est jamais évaluée lorsque la capacité admin effective est
 * fermée. Cette barrière UI complète, sans la remplacer, la frontière de
 * sécurité PostgreSQL appliquée par chaque RPC mutative.
 */
export function DailyV2AdminControlsGate({
  allowed,
  renderControls,
}: DailyV2AdminControlsGateProps) {
  return allowed ? <>{renderControls()}</> : null;
}
