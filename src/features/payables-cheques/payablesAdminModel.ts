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
import { payablesErrorMessage } from './payablesErrors';
import type { PayablesRuntimeMode } from './payablesRuntimeTarget';

export type AdminState = 'NOT_CONFIGURED' | 'ADMIN' | 'NOT_ADMIN';

/** L'autorité vient uniquement de la réponse serveur, jamais d'une capacité héritée. */
export function adminState(access: PayablesAccess): AdminState {
  if (!access.admin_configured) return 'NOT_CONFIGURED';
  return access.is_admin ? 'ADMIN' : 'NOT_ADMIN';
}

export type ModuleOpening = { open: true } | { open: false; reason: string };

// Type guard explicite (projet non strict, docs/BASELINES.md §3).
export function isModuleClosed(opening: ModuleOpening): opening is Extract<ModuleOpening, { open: false }> {
  return opening.open === false;
}

/**
 * Ouverture du module selon le mode de la cible. Module complet : droit de
 * lecture ou d'audit. Administration seule (production) : administrateur
 * reconnu par le serveur, quelles que soient les autres capacités.
 */
export function moduleOpening(mode: PayablesRuntimeMode, access: PayablesAccess): ModuleOpening {
  if (mode === 'admin-only') {
    // Booléens stricts de la réponse serveur : toute autre valeur garde le module fermé.
    return access.admin_configured === true && access.is_admin === true
      ? { open: true }
      : { open: false, reason: payablesErrorMessage('PAYABLES_ADMIN_ONLY_ACCESS_REQUIRED') };
  }
  const canRead = access.capabilities.includes('READ') || access.capabilities.includes('AUDIT');
  return canRead ? { open: true } : { open: false, reason: 'Aucune habilitation de lecture sur ce module.' };
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

/** Dernier numéro de version connu d'un paramètre (0 si aucun). */
export function expectedParameterVersion(rows: ParameterVersionRow[], kind: string, subjectKey: string): number {
  return rows
    .filter((v) => v.kind === kind && v.subject_key === subjectKey)
    .reduce((max, v) => Math.max(max, v.version_no), 0);
}

/** État d'une lecture : en cours, en échec (données absentes ou périmées) ou disponible, vide comprise. */
export type ReadState = 'LOADING' | 'ERROR' | 'READY';

export function readState(query: { isPending: boolean; isError: boolean }): ReadState {
  if (query.isError) return 'ERROR';
  return query.isPending ? 'LOADING' : 'READY';
}

/**
 * Brouillon d'une nouvelle version de paramètre. La version de référence d'un
 * paramètre visé est celle connue la première fois que la saisie le vise ;
 * elle ne suit jamais le cache ensuite, même si la saisie quitte ce paramètre
 * puis y revient : une version enregistrée entre-temps devient un conflit à
 * lever explicitement.
 */
export interface ParameterDraft {
  kind: string;
  subjectKey: string;
  validFrom: string;
  payload: string;
  evidenceRef: string;
  /** Référence du paramètre visé ; null tant que rien n'est saisi. */
  baseVersion: number | null;
  /** Référence retenue pour chaque paramètre déjà visé par cette saisie. */
  knownBases: Record<string, number>;
}

export type ParameterDraftFields = Omit<ParameterDraft, 'baseVersion' | 'knownBases'>;

const draftTarget = (kind: string, subjectKey: string) => `${kind}|${subjectKey}`;

function withBase(draft: ParameterDraft, base: number): ParameterDraft {
  return { ...draft, baseVersion: base, knownBases: { ...draft.knownBases, [draftTarget(draft.kind, draft.subjectKey)]: base } };
}

export function editParameterDraft(draft: ParameterDraft, patch: Partial<ParameterDraftFields>,
  rows: ParameterVersionRow[]): ParameterDraft {
  const next = { ...draft, ...patch };
  const retargeted = next.kind !== draft.kind || next.subjectKey !== draft.subjectKey;
  if (draft.baseVersion !== null && !retargeted) return next;
  const known = next.knownBases[draftTarget(next.kind, next.subjectKey)];
  return withBase(next, known ?? expectedParameterVersion(rows, next.kind, next.subjectKey));
}

/** Référence fixée par une décision enregistrée sur ce paramètre (pas de faux conflit sur sa propre version). */
export function savedParameterDraft(draft: ParameterDraft, kind: string, subjectKey: string, versionNo: number): ParameterDraft {
  const knownBases = { ...draft.knownBases, [draftTarget(kind, subjectKey)]: versionNo };
  const current = draft.kind === kind && draft.subjectKey === subjectKey;
  return { ...draft, knownBases, baseVersion: current ? versionNo : draft.baseVersion };
}

export interface ParameterDraftConflict {
  base: number;
  current: number;
  latest: ParameterVersionRow | null;
}

/** Version enregistrée depuis le début de la saisie : conflit, jamais avancée en silence. */
export function parameterDraftConflict(draft: ParameterDraft, rows: ParameterVersionRow[]): ParameterDraftConflict | null {
  if (draft.baseVersion === null) return null;
  const current = expectedParameterVersion(rows, draft.kind, draft.subjectKey);
  if (current === draft.baseVersion) return null;
  const latest = rows.find((v) => v.kind === draft.kind && v.subject_key === draft.subjectKey && v.version_no === current) ?? null;
  return { base: draft.baseVersion, current, latest };
}

/** Confirmation explicite : la saisie, inchangée, porte désormais sur la dernière version relue. */
export function rebaseParameterDraft(draft: ParameterDraft, rows: ParameterVersionRow[]): ParameterDraft {
  return withBase(draft, expectedParameterVersion(rows, draft.kind, draft.subjectKey));
}

/** Rechargement : contenu de la dernière version, justificatif à fournir de nouveau. */
export function reloadParameterDraft(draft: ParameterDraft, rows: ParameterVersionRow[]): ParameterDraft {
  const conflict = parameterDraftConflict(draft, rows);
  const current = expectedParameterVersion(rows, draft.kind, draft.subjectKey);
  return withBase({
    ...draft,
    payload: conflict?.latest ? JSON.stringify(conflict.latest.payload, null, 2) : draft.payload,
    evidenceRef: '',
  }, current);
}

/** Version attendue transmise au serveur : celle du brouillon ; aucun envoi tant qu'un conflit n'est pas levé. */
export function parameterDraftExpectedVersion(draft: ParameterDraft, rows: ParameterVersionRow[]): number | null {
  if (parameterDraftConflict(draft, rows)) return null;
  return draft.baseVersion ?? expectedParameterVersion(rows, draft.kind, draft.subjectKey);
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
