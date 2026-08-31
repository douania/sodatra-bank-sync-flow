export function dailyV2SessionLabel(loading: boolean, connected: boolean): string {
  return loading ? 'Session : vérification…' : connected ? 'Session : connectée' : 'Session : connexion requise';
}

export function dailyV2RuntimeLockPresentation(input: {
  staticReadOnly: boolean; productionPilot: boolean;
  pending: boolean; fetching: boolean; error: boolean; value: boolean | undefined;
}) {
  if (input.staticReadOnly) return { title: 'Cible non autorisée', label: 'lecture seule imposée' };
  if (input.pending || input.fetching) return { title: 'Vérification du verrou serveur', label: 'vérification — écritures suspendues' };
  if (input.error || typeof input.value !== 'boolean') return { title: 'Verrou serveur indisponible', label: 'indisponible — lecture seule' };
  if (input.value) return { title: 'Verrou maître ouvert', label: 'verrou maître ouvert — droits et scopes serveur requis' };
  return { title: input.productionPilot ? 'Pilote production verrouillé' : 'Environnement en lecture seule', label: 'lecture seule' };
}
