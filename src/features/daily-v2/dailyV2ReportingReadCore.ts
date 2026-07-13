/**
 * Pure orchestration core of the Daily v2 canonical reporting read
 * (DAILY-V2-CANONICAL-REPORTING-EXPORT-0O).
 *
 * Behavioral heart of the snapshot/epoch read, isolated from any I/O so every
 * success and refusal branch is directly executable in synthetic tests. The
 * narrow READ-ONLY adapter below is the only gateway to the database layer:
 * this module never imports a client, never mutates, never calls an RPC and
 * never sees a connection string. The real adapter lives in
 * dailyV2SupabaseService.ts, is not exported, and keeps the runtime target
 * guard in front of the public entry point.
 */

import { z } from 'zod';
import type { DailyV2ReportingUnitRow } from './dailyV2Types';

export class DailyV2ServiceError extends Error {
  readonly safeCode?: string;

  constructor(message: string, safeCode?: string) {
    super(message);
    this.name = 'DailyV2ServiceError';
    this.safeCode = safeCode;
  }
}

const REPORTING_PAGE_SIZE = 1000;
/** Absolute reporting ceiling: above this, the caller must narrow the window. */
export const DAILY_V2_REPORTING_MAX_UNITS = 5000;

const MAX_SAFE_REPORTING_TEXT_LENGTH = 200;
const MAX_SAFE_REPORTING_TIMESTAMP_LENGTH = 40;
/** Upper bound of a PostgreSQL `integer` column (source of line_count). */
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const REPORTING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Strict ISO-8601 shape: guarantees the DB-provided cutoff embeds no PostgREST
// structural character (comma, parenthesis, quote, space) when the real
// adapter interpolates it into the or() snapshot condition.
const REPORTING_ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

const reportingIsoTimestampSchema = z
  .string()
  .min(1)
  .max(MAX_SAFE_REPORTING_TIMESTAMP_LENGTH)
  .regex(REPORTING_ISO_TIMESTAMP_PATTERN)
  .refine((value) => !Number.isNaN(Date.parse(value)));

/** Exactly one anchor row is expected whenever the snapshot count is > 0. */
const reportingSnapshotAnchorSchema = z
  .array(
    z.strictObject({
      id: z.string().uuid(),
      ingested_at: reportingIsoTimestampSchema,
    }),
  )
  .length(1);

const reportingUnitRowSchema = z.strictObject({
  id: z.string().uuid(),
  accounting_date: z.string().regex(REPORTING_DATE_PATTERN),
  bank: z.string().trim().min(1).max(MAX_SAFE_REPORTING_TEXT_LENGTH),
  currency: z.string().trim().min(1).max(MAX_SAFE_REPORTING_TEXT_LENGTH),
  account_fingerprint: z.string().min(1).max(MAX_SAFE_REPORTING_TEXT_LENGTH),
  line_count: z.number().int().min(1).max(POSTGRES_INTEGER_MAX),
  day_total_debits: z.number().finite(),
  day_total_credits: z.number().finite(),
  opening_balance_derived: z.number().finite().nullable(),
  closing_balance_derived: z.number().finite().nullable(),
  aggregates_status: z.enum(['derived', 'unavailable']),
  validation_status: z.enum(['valid', 'needs_review']),
  ingested_at: reportingIsoTimestampSchema,
});

const reportingUnitRowsSchema = z.array(reportingUnitRowSchema);

/**
 * Fail-closed runtime validation of a reporting page: the whole page is
 * refused when a single row is invalid — no valid subset is ever kept, and
 * neither Zod details nor the faulty value leak into the error.
 */
function parseDailyV2ReportingRows(value: unknown): DailyV2ReportingUnitRow[] {
  const parsed = reportingUnitRowsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DailyV2ServiceError(
      'Réponse reporting canonical invalide (fail-closed, page entière refusée).',
      'REPORT_RESPONSE_INVALID',
    );
  }
  // Without strictNullChecks (tsconfig strict: false), Zod infers nullable
  // keys as optional; the schema only ever admits number | null here, so the
  // ?? null below is a pure type-level normalization with no runtime effect.
  return parsed.data.map((row) => ({
    ...row,
    opening_balance_derived: row.opening_balance_derived ?? null,
    closing_balance_derived: row.closing_balance_derived ?? null,
  }));
}

export interface DailyV2ReportingReadFilters {
  startDate: string;
  endDate: string;
  bank: string | null;
  currency: string | null;
}

/**
 * Narrow READ-ONLY gateway to the canonical units table. The real
 * implementation composes the PostgREST queries; synthetic tests provide a
 * deterministic in-memory implementation. Nothing here can mutate.
 */
export interface DailyV2ReportingReadAdapter {
  /** Exact count of ALL canonical units (any status) — the monotone epoch. */
  readEpochCount(): Promise<number>;
  /** Newest active unit of the filtered set, with the exact set count. */
  readAnchor(
    filters: DailyV2ReportingReadFilters,
  ): Promise<{ data: unknown; count: number | null }>;
  /** One page of the set active at the cutoff, with the exact set count. */
  readPage(input: {
    filters: DailyV2ReportingReadFilters;
    snapshotCutoff: string;
    from: number;
    to: number;
  }): Promise<{ data: unknown; count: number | null }>;
}

/** Fail-closed: any epoch drift proves a concurrent canonical mutation. */
function assertDailyV2CanonicalEpochUnchanged(
  epochBefore: number,
  epochAfter: number,
): void {
  if (epochAfter !== epochBefore) {
    throw new DailyV2ServiceError(
      'Une mutation canonical concurrente a été détectée pendant la lecture reporting ' +
        '(fail-closed, aucun rapport partiel).',
      'REPORT_CONCURRENT_CANONICAL_MUTATION',
    );
  }
}

/**
 * Snapshot/epoch reporting read. The time cutoff is a complementary defence,
 * not a snapshot transaction: a monotone epoch (total canonical count, all
 * statuses) is read before the anchor and re-read after the last page — any
 * drift refuses the report, the empty report included. Fail-closed on any
 * inconsistency: missing count, count above the ceiling, invalid anchor,
 * per-page count drift, invalid row, or a fetched total that diverges from
 * the anchored count (no partial report is ever produced).
 */
export async function runDailyV2CanonicalReportingRead(
  adapter: DailyV2ReportingReadAdapter,
  filters: DailyV2ReportingReadFilters,
): Promise<{ rows: DailyV2ReportingUnitRow[]; totalCount: number }> {
  const epochBefore = await adapter.readEpochCount();

  const { data: anchorData, count: anchorCount } = await adapter.readAnchor(filters);

  if (anchorCount === null || anchorCount === undefined) {
    throw new DailyV2ServiceError(
      'Le comptage exact du reporting est indisponible (fail-closed).',
      'REPORT_COUNT_UNAVAILABLE',
    );
  }
  if (anchorCount > DAILY_V2_REPORTING_MAX_UNITS) {
    throw new DailyV2ServiceError(
      `La période sélectionnée couvre ${anchorCount} unités canonical, au-dessus du plafond de ` +
        `${DAILY_V2_REPORTING_MAX_UNITS}. Réduisez la période ou ajoutez un filtre.`,
      'REPORT_TOO_MANY_UNITS',
    );
  }
  if (anchorCount === 0) {
    // The empty report is subject to the same epoch comparison: a mutation
    // racing the anchor must refuse even an empty result.
    assertDailyV2CanonicalEpochUnchanged(epochBefore, await adapter.readEpochCount());
    return { rows: [], totalCount: 0 };
  }

  const anchorParsed = reportingSnapshotAnchorSchema.safeParse(anchorData);
  if (!anchorParsed.success) {
    throw new DailyV2ServiceError(
      'Ancre de snapshot reporting invalide (fail-closed).',
      'REPORT_SNAPSHOT_ANCHOR_INVALID',
    );
  }
  const snapshotCutoff = anchorParsed.data[0].ingested_at;

  const rows: DailyV2ReportingUnitRow[] = [];

  for (let from = 0; from < anchorCount; from += REPORTING_PAGE_SIZE) {
    const { data, count } = await adapter.readPage({
      filters,
      snapshotCutoff,
      from,
      to: from + REPORTING_PAGE_SIZE - 1,
    });

    if (count === null || count === undefined) {
      throw new DailyV2ServiceError(
        'Le comptage exact du reporting est indisponible (fail-closed).',
        'REPORT_COUNT_UNAVAILABLE',
      );
    }
    if (count !== anchorCount) {
      throw new DailyV2ServiceError(
        'L’ensemble canonical actif a changé pendant la lecture paginée (fail-closed, aucun rapport partiel).',
        'REPORT_SNAPSHOT_COUNT_MISMATCH',
      );
    }

    rows.push(...parseDailyV2ReportingRows(data ?? []));
  }

  if (rows.length !== anchorCount) {
    throw new DailyV2ServiceError(
      'Lecture reporting incohérente avec le comptage initial (fail-closed, aucun rapport partiel).',
      'REPORT_READ_INCONSISTENT',
    );
  }

  const epochAfter = await adapter.readEpochCount();
  assertDailyV2CanonicalEpochUnchanged(epochBefore, epochAfter);

  return { rows, totalCount: anchorCount };
}
