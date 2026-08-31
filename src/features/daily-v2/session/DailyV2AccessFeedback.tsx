import React from 'react';
import type { DailyV2AccessState } from '../dailyV2AccessState';

/** Shared by the route guard and the standalone workspace guard. No access granted here. */
export function DailyV2AccessFeedback({ state }: {
  state: Exclude<DailyV2AccessState, { status: 'allowed' }>;
}) {
  if (state.status === 'checking') return (
    <div role="status" className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
      Vérification des accès Daily v2…
    </div>
  );
  const content = {
    session_required: { title: 'Connexion requise', description: 'Connectez-vous pour consulter Daily v2. Les données de la session précédente ne sont pas affichées.' },
    runtime_target_rejected: { title: 'Configuration Daily v2 non autorisée', description: state.safeDetail ?? 'La cible d’exécution Daily v2 n’est pas autorisée.' },
    role_lookup_failed: { title: 'Vérification des accès impossible', description: 'L’application n’a pas pu vérifier vos autorisations Daily v2. Réessayez plus tard.' },
    insufficient_role: { title: 'Accès Daily v2 non autorisé', description: 'Votre compte ne dispose pas d’un rôle autorisé pour Daily v2.' },
  }[state.reason];
  return <div className="min-h-[40vh] flex items-center justify-center px-4">
    <div role="alert" className="w-full max-w-xl rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
      <h1 className="text-lg font-semibold">{content.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{content.description}</p>
      <p className="mt-4 text-xs text-muted-foreground">Aucun accès Daily v2 n’a été accordé.</p>
    </div>
  </div>;
}
