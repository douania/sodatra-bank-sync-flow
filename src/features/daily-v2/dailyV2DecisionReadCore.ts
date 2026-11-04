/**
 * Lot 1 opérationnel — lectures des décisions Daily v2, cœur pur (P2 de la
 * contre-revue CTO de la PR #156).
 *
 * Chaque liste est lue jusqu'à épuisement : pages ordonnées de façon stable
 * (clés de tri puis identifiant unique), décalage égal au nombre de lignes déjà
 * reçues, listes d'identifiants découpées en lots, total exact du serveur
 * atteint et jamais dépassé. Une lecture en erreur, incomplète ou instable lève
 * DAILY_V2_READ_INCOMPLETE : aucune réponse tronquée n'est présentée comme
 * complète, et l'interface suspend les décisions qui en dépendent.
 *
 * Ce module n'importe aucun client, n'écrit rien et n'appelle aucun RPC :
 * l'adaptateur réel, en lecture seule, vit dans dailyV2SupabaseService.ts.
 * Il valide aussi les deux lectures serveur du lot (plan d'approbation
 * groupée, statut des réfutations) : le navigateur ne recalcule ni l'une ni
 * l'autre.
 */

import { z } from 'zod';
import { DailyV2ServiceError } from './dailyV2ReportingReadCore';
import type {
  DailyV2AttemptAttestationRow,
  DailyV2BatchExpected,
  DailyV2CanonicalUnitRow,
  DailyV2ExportAttemptRow,
  DailyV2RefutationSourceRow,
  DailyV2RefutationStatusRead,
  DailyV2ServerBatchPlan,
  DailyV2StagingUnitRow,
  DailyV2VersionRefutationRow,
} from './dailyV2Types';

export const DAILY_V2_DECISION_PAGE_SIZE = 500;
export const DAILY_V2_DECISION_ID_CHUNK = 100;
/** Plafond d'une liste : au-delà, la lecture est déclarée incomplète, jamais tronquée en silence. */
export const DAILY_V2_DECISION_MAX_ROWS = 20_000;
export const DAILY_V2_READ_INCOMPLETE = 'DAILY_V2_READ_INCOMPLETE';

export type DailyV2DecisionTable =
  | 'daily_statement_units_staging'
  | 'daily_statement_export_attempts'
  | 'daily_statement_units_canonical'
  | 'daily_statement_attempt_attestations'
  | 'daily_statement_version_refutations'
  | 'daily_statement_refutation_sources';

export interface DailyV2DecisionPageQuery {
  table: DailyV2DecisionTable;
  eq: ReadonlyArray<readonly [column: string, value: string]>;
  in: readonly [column: string, values: readonly string[]] | null;
  /** Colonnes de tri croissant ; la dernière (ou leur combinaison) est unique. */
  order: readonly string[];
  from: number;
  to: number;
}

export interface DailyV2DecisionPage {
  data: unknown[] | null;
  count: number | null;
  error: { message?: string; code?: string } | null;
}

/** Une page, total exact compris (adaptateur en lecture seule). */
export type DailyV2DecisionPageReader = (query: DailyV2DecisionPageQuery) => Promise<DailyV2DecisionPage>;

export interface DailyV2DecisionReadOptions {
  pageSize?: number;
  idChunk?: number;
  maxRows?: number;
}

type Row = Record<string, unknown>;
type BaseQuery = Omit<DailyV2DecisionPageQuery, 'from' | 'to'>;

function incomplete(label: string, detail: string): DailyV2ServiceError {
  return new DailyV2ServiceError(
    `Lecture incomplète (${label}) : ${detail}. Aucune décision n’est proposée sur cette base.`,
    DAILY_V2_READ_INCOMPLETE,
  );
}

function sortKey(row: Row, order: readonly string[]): string[] {
  return order.map((column) => String(row[column] ?? ''));
}

function compareKeys(a: string[], b: string[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

/** Toutes les lignes d'une requête, page après page, jusqu'au total exact annoncé. */
export async function readAllDecisionRows<T extends Row>(
  reader: DailyV2DecisionPageReader,
  base: BaseQuery,
  label: string,
  options: DailyV2DecisionReadOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DAILY_V2_DECISION_PAGE_SIZE;
  const maxRows = options.maxRows ?? DAILY_V2_DECISION_MAX_ROWS;
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  for (;;) {
    const from = rows.length;
    let page: DailyV2DecisionPage;
    try {
      page = await reader({ ...base, from, to: from + pageSize - 1 });
    } catch {
      throw incomplete(label, 'erreur de lecture du serveur');
    }
    if (page.error) throw incomplete(label, 'erreur de lecture du serveur');
    if (page.count === null || !Number.isInteger(page.count) || page.count < 0) {
      throw incomplete(label, 'total exact absent');
    }
    if (expected === null) {
      expected = page.count;
      if (expected > maxRows) throw incomplete(label, `plus de ${maxRows} lignes`);
    } else if (page.count !== expected) {
      throw incomplete(label, 'liste modifiée pendant la lecture');
    }
    const data = page.data ?? [];
    if (data.length > pageSize) throw incomplete(label, 'page plus grande que demandée');
    for (const raw of data) {
      if (raw === null || typeof raw !== 'object') throw incomplete(label, 'ligne illisible');
      const row = raw as T;
      const identity = sortKey(row, base.order).join('\u0000');
      if (seen.has(identity)) throw incomplete(label, 'ordre instable (ligne répétée)');
      seen.add(identity);
      rows.push(row);
    }
    if (rows.length > expected) throw incomplete(label, 'plus de lignes que le total annoncé');
    if (rows.length === expected) return rows;
    if (data.length === 0) throw incomplete(label, 'page vide avant le total annoncé');
  }
}

/** Lignes dont `column` vaut l'un des identifiants, lus par lots puis réordonnés. */
export async function readDecisionRowsForIds<T extends Row>(
  reader: DailyV2DecisionPageReader,
  base: Omit<BaseQuery, 'in'>,
  column: string,
  ids: readonly string[],
  label: string,
  options: DailyV2DecisionReadOptions = {},
): Promise<T[]> {
  const chunk = options.idChunk ?? DAILY_V2_DECISION_ID_CHUNK;
  const maxRows = options.maxRows ?? DAILY_V2_DECISION_MAX_ROWS;
  const unique = Array.from(new Set(ids)).sort();
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < unique.length; index += chunk) {
    const part = await readAllDecisionRows<T>(reader, { ...base, in: [column, unique.slice(index, index + chunk)] }, label, options);
    for (const row of part) {
      const identity = sortKey(row, base.order).join('\u0000');
      if (seen.has(identity)) throw incomplete(label, 'ligne répétée entre lots');
      seen.add(identity);
      rows.push(row);
    }
    if (rows.length > maxRows) throw incomplete(label, `plus de ${maxRows} lignes`);
  }
  return rows.sort((a, b) => compareKeys(sortKey(a, base.order), sortKey(b, base.order)));
}

/** Les lectures des décisions, liées à un adaptateur de pages. */
export function createDailyV2DecisionReads(reader: DailyV2DecisionPageReader, options: DailyV2DecisionReadOptions = {}) {
  const attemptsByIds = async (attemptIds: readonly string[], label: string): Promise<DailyV2ExportAttemptRow[]> => {
    const attempts = await readDecisionRowsForIds<DailyV2ExportAttemptRow & Row>(reader,
      { table: 'daily_statement_export_attempts', eq: [], order: ['id'] }, 'id', attemptIds, label, options);
    // Chaque fichier référencé doit être lu : un fichier manquant rend la lecture incomplète.
    if (attempts.length !== new Set(attemptIds).size) throw incomplete(label, 'fichier associé manquant');
    return attempts;
  };
  return {
    /** Livraisons d'une journée (toutes) et leurs fichiers. */
    async listDayDeliveries(dayUnitId: string) {
      const units = await readAllDecisionRows<DailyV2StagingUnitRow & Row>(reader, {
        table: 'daily_statement_units_staging', eq: [['day_unit_id', dayUnitId]], in: null, order: ['created_at', 'id'],
      }, 'livraisons de la journée', options);
      const attemptIds = units.map((unit) => unit.attempt_id);
      const attempts = attemptIds.length === 0 ? [] : await attemptsByIds(attemptIds, 'fichiers de la journée');
      return { units: units as DailyV2StagingUnitRow[], attempts };
    },
    /** Journées livrées par des fichiers. */
    async listAttemptsUnits(attemptIds: readonly string[]) {
      return await readDecisionRowsForIds<DailyV2StagingUnitRow & Row>(reader, {
        table: 'daily_statement_units_staging', eq: [], order: ['accounting_date', 'id'],
      }, 'attempt_id', attemptIds, 'journées des fichiers', options) as DailyV2StagingUnitRow[];
    },
    /** Unités retenues (actives) des journées. */
    async listActiveCanonicalUnits(dayUnitIds: readonly string[]) {
      return await readDecisionRowsForIds<DailyV2CanonicalUnitRow & Row>(reader, {
        table: 'daily_statement_units_canonical', eq: [['status', 'ingested']], order: ['id'],
      }, 'day_unit_id', dayUnitIds, 'unités retenues', options) as DailyV2CanonicalUnitRow[];
    },
    async listAttemptAttestations(attemptIds: readonly string[]) {
      return await readDecisionRowsForIds<DailyV2AttemptAttestationRow & Row>(reader, {
        table: 'daily_statement_attempt_attestations', eq: [], order: ['created_at', 'id'],
      }, 'attempt_id', attemptIds, 'attestations', options) as DailyV2AttemptAttestationRow[];
    },
    /** Réfutations d'une journée (décisions et révocations) et leurs sources couvertes. */
    async listVersionRefutations(dayUnitId: string) {
      const refutations = await readAllDecisionRows<DailyV2VersionRefutationRow & Row>(reader, {
        table: 'daily_statement_version_refutations', eq: [['day_unit_id', dayUnitId]], in: null, order: ['created_at', 'id'],
      }, 'réfutations', options) as DailyV2VersionRefutationRow[];
      const ids = refutations.filter((row) => row.action === 'REFUTE').map((row) => row.id);
      const sources = ids.length === 0 ? [] : await readDecisionRowsForIds<DailyV2RefutationSourceRow & Row>(reader, {
        table: 'daily_statement_refutation_sources', eq: [], order: ['refutation_id', 'raw_text_hash', 'account_registry_id'],
      }, 'refutation_id', ids, 'sources réfutées', options) as DailyV2RefutationSourceRow[];
      return { refutations, sources };
    },
  };
}

// --------------------------------------------------------------------------
// Lectures serveur du lot : réponses validées, sans recalcul local.
// --------------------------------------------------------------------------
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DAILY_V2_BATCH_INADMISSIBLE_REASONS = [
  'FILE_UNRESOLVED', 'STATUS_NOT_STAGED', 'AGGREGATES_UNAVAILABLE', 'LINES_NOT_CONFORMING', 'REVIEW_UNRESOLVED',
  'NOT_ADMISSIBLE',
] as const;

const batchPlanSchema = z.object({
  attempt_id: uuid,
  expected: z.object({
    days: z.array(z.object({
      staging_unit_id: uuid,
      day_unit_id: z.string().min(1),
      day_content_hash: z.string().min(1),
      canonical_unit_id: uuid.nullable(),
      canonical_content_hash: z.string().min(1).nullable(),
    }).strict()),
    attestation_ids: z.array(uuid),
  }).strict(),
  max_days: z.number().int().positive(),
  admissible: z.array(z.object({
    staging_unit_id: uuid,
    accounting_date: isoDate,
    validation_status: z.string().min(1),
    review_reason_codes: z.array(z.string()),
  }).strict()),
  inadmissible: z.array(z.object({
    staging_unit_id: uuid,
    accounting_date: isoDate,
    status: z.string().min(1),
    reason: z.enum(DAILY_V2_BATCH_INADMISSIBLE_REASONS),
  }).strict()),
}).strict();

/** Plan d'approbation groupée du serveur : la liste admissible est exactement celle transmise. */
export function parseDailyV2BatchPlan(data: unknown, attemptId: string): DailyV2ServerBatchPlan {
  const parsed = batchPlanSchema.safeParse(data);
  if (!parsed.success || parsed.data.attempt_id !== attemptId) {
    throw new DailyV2ServiceError('Plan d’approbation groupée invalide (fail-closed).', 'BATCH_PLAN_INVALID');
  }
  const plan = parsed.data;
  const expectedIds = plan.expected.days.map((day) => day.staging_unit_id).sort();
  const admissibleIds = plan.admissible.map((day) => day.staging_unit_id).sort();
  if (expectedIds.join(',') !== admissibleIds.join(',')
    || plan.inadmissible.some((day) => expectedIds.includes(day.staging_unit_id))) {
    throw new DailyV2ServiceError('Plan d’approbation groupée incohérent (fail-closed).', 'BATCH_PLAN_INVALID');
  }
  return {
    attemptId: plan.attempt_id,
    expected: plan.expected as DailyV2BatchExpected,
    maxDays: plan.max_days,
    admissible: plan.admissible.map((day) => ({
      stagingUnitId: day.staging_unit_id, accountingDate: day.accounting_date,
      validationStatus: day.validation_status, reviewReasonCodes: day.review_reason_codes,
    })),
    inadmissible: plan.inadmissible.map((day) => ({
      stagingUnitId: day.staging_unit_id, accountingDate: day.accounting_date, status: day.status, reason: day.reason,
    })),
  };
}

const refutationStatusSchema = z.union([
  z.object({
    day_unit_id: z.string().min(1),
    verifiable: z.literal(true),
    read_at: z.string().min(10),
    refutations: z.array(z.object({
      refutation_id: uuid,
      proof_kind: z.enum(['FRESH_DELIVERY', 'BANK_PIECE']),
      state: z.enum(['EFFECTIVE', 'PARTIAL', 'SUSPENDED']),
      causes: z.array(z.enum(['RETAINED_VERSION_CHANGED', 'RETAINED_VERSION_UNUSABLE', 'PROOF_NO_LONGER_VALID',
        'SOURCE_NOT_JUSTIFIED', 'NEW_SOURCE_UNCOVERED'])),
      uncovered_sources: z.number().int().nonnegative(),
    }).strict()),
  }).strict(),
  z.object({
    day_unit_id: z.string().min(1),
    verifiable: z.literal(false),
    cause: z.enum(['DAY_UNKNOWN', 'TREASURY_MODULE_CLOSED', 'ACCOUNT_NOT_IN_INVENTORY', 'FUTURE_DAY']),
    refutations: z.array(z.unknown()).length(0),
  }).strict(),
]);

/** Statut courant des réfutations d'une journée, tel que la lecture « Soldes à date » l'établit. */
export function parseDailyV2RefutationStatus(data: unknown, dayUnitId: string): DailyV2RefutationStatusRead {
  const parsed = refutationStatusSchema.safeParse(data);
  if (!parsed.success || parsed.data.day_unit_id !== dayUnitId) {
    throw new DailyV2ServiceError('Statut des réfutations invalide (fail-closed).', 'REFUTATION_STATUS_INVALID');
  }
  const read = parsed.data;
  if (read.verifiable === false) return { dayUnitId, verifiable: false, cause: read.cause };
  const ids = read.refutations.map((row) => row.refutation_id);
  if (new Set(ids).size !== ids.length) {
    throw new DailyV2ServiceError('Statut des réfutations incohérent (fail-closed).', 'REFUTATION_STATUS_INVALID');
  }
  return {
    dayUnitId, verifiable: true, readAt: read.read_at,
    refutations: read.refutations.map((row) => ({
      refutationId: row.refutation_id, proofKind: row.proof_kind, state: row.state, causes: row.causes,
      uncoveredSources: row.uncovered_sources,
    })),
  };
}
