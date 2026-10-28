// Lecture du modèle « administrateur unique » pour l'interface : état de
// l'autorité, droits en vigueur, rattachements courants, version attendue d'un
// paramètre, propositions héritées restées en attente. Fonctions pures ; le
// serveur reste seul juge de chaque décision.

import {
  PAYABLES_RETIRED_CAPABILITIES,
  type CapabilityGrantRow,
  type ParameterVersionRow,
  type PayablesAccess,
  type PayablesCapability,
  type PersonLinkRow,
  type PersonRow,
} from './payablesChequesTypes';

export type AdminState = 'NOT_CONFIGURED' | 'ADMIN' | 'NOT_ADMIN';

/** L'autorité vient uniquement de la réponse serveur, jamais d'une capacité héritée. */
export function adminState(access: PayablesAccess): AdminState {
  if (!access.admin_configured) return 'NOT_CONFIGURED';
  return access.is_admin ? 'ADMIN' : 'NOT_ADMIN';
}

/** Capacités en vigueur par utilisateur : dernière décision validée, capacités retirées exclues. */
export function effectiveGrants(rows: CapabilityGrantRow[]): Map<string, PayablesCapability[]> {
  const latest = new Map<string, CapabilityGrantRow>();
  for (const row of rows) {
    if (row.status !== 'VALIDATED' || row.decision_seq === null) continue;
    if (PAYABLES_RETIRED_CAPABILITIES.includes(row.capability)) continue;
    const key = `${row.user_id}|${row.capability}`;
    const current = latest.get(key);
    if (!current || (current.decision_seq ?? 0) < row.decision_seq) latest.set(key, row);
  }
  const byUser = new Map<string, PayablesCapability[]>();
  for (const row of latest.values()) {
    if (row.action !== 'GRANT') continue;
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.capability].sort());
  }
  return byUser;
}

/** Rattachement courant de chaque utilisateur (dernier lien validé, retrait compris). */
export function currentLinks(rows: PersonLinkRow[]): Map<string, string> {
  const latest = new Map<string, PersonLinkRow>();
  for (const row of rows) {
    if (row.status !== 'VALIDATED' || row.decision_seq === null) continue;
    const current = latest.get(row.user_id);
    if (!current || (current.decision_seq ?? 0) < row.decision_seq) latest.set(row.user_id, row);
  }
  const links = new Map<string, string>();
  for (const row of latest.values()) if (row.action === 'LINK') links.set(row.user_id, row.person_id);
  return links;
}

/** Dernier numéro de version connu d'un paramètre (0 si aucun) : version attendue par le serveur. */
export function expectedParameterVersion(rows: ParameterVersionRow[], kind: string, subjectKey: string): number {
  return rows
    .filter((v) => v.kind === kind && v.subject_key === subjectKey)
    .reduce((max, v) => Math.max(max, v.version_no), 0);
}

export type LegacyProposalKind = 'CAPABILITY' | 'PERSON' | 'PERSON_LINK' | 'PARAMETER';

export interface LegacyProposal {
  kind: LegacyProposalKind;
  id: string;
  proposedBy: string | null;
  label: string;
}

/**
 * Propositions de l'ancienne gouvernance restées en attente : sans effet,
 * closes seulement par l'administrateur (jamais validées).
 */
export function legacyPendingProposals(input: {
  persons: PersonRow[]; links: PersonLinkRow[]; grants: CapabilityGrantRow[]; parameters: ParameterVersionRow[];
}): LegacyProposal[] {
  return [
    ...input.persons.filter((p) => p.status === 'PROPOSED')
      .map((p): LegacyProposal => ({ kind: 'PERSON', id: p.id, proposedBy: p.proposed_by, label: `Personne : ${p.display_name}` })),
    ...input.links.filter((l) => l.status === 'PROPOSED')
      .map((l): LegacyProposal => ({ kind: 'PERSON_LINK', id: l.id, proposedBy: l.proposed_by,
        label: `Rattachement ${l.action} : personne ${l.person_id.slice(0, 8)} ↔ compte ${l.user_id.slice(0, 8)}` })),
    ...input.grants.filter((g) => g.status === 'PROPOSED')
      .map((g): LegacyProposal => ({ kind: 'CAPABILITY', id: g.id, proposedBy: g.proposed_by,
        label: `Habilitation ${g.action} ${g.capability} → ${g.user_id.slice(0, 8)}` })),
    ...input.parameters.filter((v) => v.status === 'PROPOSED')
      .map((v): LegacyProposal => ({ kind: 'PARAMETER', id: v.id, proposedBy: v.proposed_by,
        label: `${v.kind} ${v.subject_key} v${v.version_no} à partir du ${v.valid_from}` })),
  ];
}
