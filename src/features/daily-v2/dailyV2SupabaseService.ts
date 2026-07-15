import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type {
  DailyV2AppRole,
  DailyV2AccountRegistryRow,
  DailyV2AccountEventRow,
  DailyV2AuditEventRow,
  DailyV2BackfillGrantRow,
  DailyV2CanonicalLineRow,
  DailyV2CanonicalUnitRow,
  DailyV2Database,
  DailyV2Page,
  DailyV2PreIngestPayload,
  DailyV2PreIngestResponse,
  DailyV2PromoteResponse,
  DailyV2ReportingUnitRow,
  DailyV2StagingLineRow,
  DailyV2StagingStatus,
  DailyV2StagingUnitRow,
  DailyV2SupersedeResponse,
} from './dailyV2Types';
import { currentDailyV2RuntimeTargetVerdict } from './dailyV2RuntimeTarget';
import {
  DailyV2ServiceError,
  runDailyV2CanonicalReportingRead,
  type DailyV2ReportingReadAdapter,
  type DailyV2ReportingReadFilters,
} from './dailyV2ReportingReadCore';

// Stable public surface: the error class and the reporting ceiling moved to
// the pure read core but stay importable from this module.
export { DAILY_V2_REPORTING_MAX_UNITS, DailyV2ServiceError } from './dailyV2ReportingReadCore';

const dailyV2Supabase = supabase as unknown as SupabaseClient<DailyV2Database>;
const MAX_SAFE_REASON_LENGTH = 200;

const accountRegistrySchema = z.object({
  id: z.string().uuid(),
  bank: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  safe_alias: z.string().min(1).max(80),
  account_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  account_number_masked: z.string().regex(/^\*+[0-9]{0,4}$/).nullable(),
  status: z.enum(['active', 'inactive']),
});

const backfillGrantSchema = z.object({
  id: z.string().uuid(),
  account_registry_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  max_units: z.number().int().min(1).max(4000),
  expires_at: z.string(),
  status: z.enum(['active', 'consumed', 'revoked']),
});

const preIngestResponseSchema = z.object({
  attempt_id: z.string().uuid(),
  requested_mode: z.enum(['daily', 'backfill']),
  units: z.array(
    z.object({
      day_unit_id: z.string().regex(/^[0-9a-f]{64}$/),
      unit_status: z.enum([
        'staged',
        'provisional',
        'duplicate',
        'conflict',
        'needs_review',
        'promoted',
        'promotion_failed',
        'superseded',
      ]),
      staging_unit_id: z.string().uuid(),
      active_canonical_unit_id: z.string().uuid().nullable(),
    }),
  ),
});

const promoteResponseSchema = z.object({
  outcome: z.enum(['duplicate', 'conflict', 'needs_review', 'promoted']),
  active_canonical_unit_id: z.string().uuid().optional(),
  canonical_unit_id: z.string().uuid().optional(),
});

const supersedeResponseSchema = z.object({
  outcome: z.enum(['duplicate', 'superseded']),
  active_canonical_unit_id: z.string().uuid().optional(),
  old_canonical_unit_id: z.string().uuid().optional(),
  new_canonical_unit_id: z.string().uuid().optional(),
});

export async function getCurrentUserDailyV2Roles(): Promise<DailyV2AppRole[]> {
  assertAuthorizedDailyV2Target();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.user) {
    throw new DailyV2ServiceError('Une session authentifiée est requise.', 'AUTH_REQUIRED');
  }

  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', sessionData.session.user.id);
  if (error) throw toSafeError(error, 'Lecture des rôles impossible.');

  return Array.from(
    new Set(
      (data ?? [])
        .map((entry) => entry.role)
        .filter((role): role is DailyV2AppRole =>
          ['admin', 'auditor', 'manager', 'user'].includes(role),
        ),
    ),
  );
}

export async function listDailyV2Accounts(input: {
  bank?: string;
  currency?: string;
  includeInactive?: boolean;
} = {}): Promise<DailyV2AccountRegistryRow[]> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  let query = dailyV2Supabase
    .from('daily_statement_account_registry')
    .select('*')
    .order('bank', { ascending: true })
    .order('safe_alias', { ascending: true });
  if (input.bank) query = query.eq('bank', input.bank);
  if (input.currency) query = query.eq('currency', input.currency);
  if (!input.includeInactive) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw toSafeError(error, 'Lecture du registre de comptes impossible.');
  return data ?? [];
}

/** Internal pipeline input only; never render, log or export this value. */
export function getDailyV2AccountOpaqueIdentity(account: DailyV2AccountRegistryRow): string {
  return account.account_fingerprint;
}

export async function provisionDailyV2Account(input: {
  bank: string;
  currency: string;
  safeAlias: string;
  accountNumberMasked?: string;
}): Promise<DailyV2AccountRegistryRow> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { data, error } = await dailyV2Supabase.rpc('provision_daily_statement_account', {
    p_bank: input.bank,
    p_currency: input.currency,
    p_safe_alias: input.safeAlias.trim(),
    p_account_number_masked: input.accountNumberMasked?.trim() || null,
  });
  if (error) throw toSafeError(error, 'Provisionnement du compte refusé.');
  return accountRegistrySchema.parse(data) as DailyV2AccountRegistryRow;
}

export async function deactivateDailyV2Account(input: {
  accountRegistryId: string;
  reason: string;
}): Promise<void> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { error } = await dailyV2Supabase.rpc('deactivate_daily_statement_account', {
    p_account_registry_id: input.accountRegistryId,
    p_reason: normalizeRequiredReason(input.reason),
  });
  if (error) throw toSafeError(error, 'Désactivation du compte refusée.');
}

export async function listDailyV2BackfillGrants(
  accountRegistryId: string,
): Promise<DailyV2BackfillGrantRow[]> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { data, error } = await dailyV2Supabase
    .from('daily_statement_backfill_grants')
    .select('*')
    .eq('account_registry_id', accountRegistryId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw toSafeError(error, 'Lecture des autorisations backfill impossible.');
  return data ?? [];
}

export async function issueDailyV2BackfillGrant(input: {
  accountRegistryId: string;
  periodStart: string;
  periodEnd: string;
  maxUnits: number;
  expiresAt: string;
}): Promise<DailyV2BackfillGrantRow> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { data, error } = await dailyV2Supabase.rpc('issue_daily_statement_backfill_grant', {
    p_account_registry_id: input.accountRegistryId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_max_units: input.maxUnits,
    p_expires_at: input.expiresAt,
  });
  if (error) throw toSafeError(error, 'Création de l’autorisation backfill refusée.');
  return backfillGrantSchema.parse(data) as DailyV2BackfillGrantRow;
}

export async function revokeDailyV2BackfillGrant(input: {
  backfillGrantId: string;
  reason: string;
}): Promise<void> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { error } = await dailyV2Supabase.rpc('revoke_daily_statement_backfill_grant', {
    p_backfill_grant_id: input.backfillGrantId,
    p_reason: normalizeRequiredReason(input.reason),
  });
  if (error) throw toSafeError(error, 'Révocation de l’autorisation backfill refusée.');
}

export async function listDailyV2AccountEvents(input: {
  page: number;
  pageSize: number;
}): Promise<DailyV2Page<DailyV2AccountEventRow>> {
  assertAuthorizedDailyV2Target();
  const { page, pageSize, from, to } = normalizePage(input.page, input.pageSize);
  const { data, error, count } = await dailyV2Supabase
    .from('daily_statement_account_events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw toSafeError(error, 'Lecture de l’audit du registre impossible.');
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
}

export async function preIngestDailyV2(
  payload: DailyV2PreIngestPayload,
): Promise<DailyV2PreIngestResponse> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const { data, error } = await dailyV2Supabase.rpc('pre_ingest_daily_statement_units', payload);
  if (error) throw toSafeError(error, 'Le dépôt Daily v2 a été refusé.');
  return parseRpcResponse<DailyV2PreIngestResponse>(
    preIngestResponseSchema,
    data,
    'Réponse de dépôt Daily v2 invalide.',
  );
}

export async function promoteDailyV2Unit(
  stagingUnitId: string,
  approvalReason?: string,
): Promise<DailyV2PromoteResponse> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const reason = normalizeOptionalReason(approvalReason);
  const { data, error } = await dailyV2Supabase.rpc('promote_daily_statement_unit', {
    p_staging_unit_id: stagingUnitId,
    p_approval_reason: reason,
  });
  if (error) throw toSafeError(error, 'La promotion Daily v2 a été refusée.');
  return parseRpcResponse<DailyV2PromoteResponse>(
    promoteResponseSchema,
    data,
    'Réponse de promotion Daily v2 invalide.',
  );
}

export async function supersedeDailyV2Unit(input: {
  oldCanonicalUnitId: string;
  newStagingUnitId: string;
  reason: string;
}): Promise<DailyV2SupersedeResponse> {
  assertAuthorizedDailyV2Target();
  await assertAuthenticatedSession();
  const reason = normalizeRequiredReason(input.reason);
  const { data, error } = await dailyV2Supabase.rpc('supersede_daily_statement_unit', {
    p_old_canonical_unit_id: input.oldCanonicalUnitId,
    p_new_staging_unit_id: input.newStagingUnitId,
    p_reason: reason,
  });
  if (error) throw toSafeError(error, 'Le remplacement Daily v2 a été refusé.');
  return parseRpcResponse<DailyV2SupersedeResponse>(
    supersedeResponseSchema,
    data,
    'Réponse de remplacement Daily v2 invalide.',
  );
}

export async function listDailyV2StagingUnits(input: {
  page: number;
  pageSize: number;
  status?: 'all' | DailyV2StagingStatus;
  review?: 'all' | 'required' | 'clear';
}): Promise<DailyV2Page<DailyV2StagingUnitRow>> {
  assertAuthorizedDailyV2Target();
  const { page, pageSize, from, to } = normalizePage(input.page, input.pageSize);
  let query = dailyV2Supabase
    .from('daily_statement_units_staging')
    .select('*', { count: 'exact' })
    .order('accounting_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (input.status && input.status !== 'all') query = query.eq('status', input.status);
  if (input.review === 'required') {
    query = query.or(
      'status.eq.needs_review,validation_status.eq.needs_review,aggregates_status.eq.unavailable',
    );
  } else if (input.review === 'clear') {
    query = query
      .neq('status', 'needs_review')
      .eq('validation_status', 'valid')
      .eq('aggregates_status', 'derived');
  }

  const { data, error, count } = await query;
  if (error) throw toSafeError(error, 'Lecture des unités staging impossible.');
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
}

export async function listDailyV2StagingLines(
  stagingUnitId: string,
): Promise<DailyV2StagingLineRow[]> {
  assertAuthorizedDailyV2Target();
  const { data, error } = await dailyV2Supabase
    .from('daily_statement_lines_staging')
    .select('*')
    .eq('staging_unit_id', stagingUnitId)
    .order('source_line_index', { ascending: true });
  if (error) throw toSafeError(error, 'Lecture des lignes staging impossible.');
  return data ?? [];
}

export async function listDailyV2CanonicalUnits(input: {
  page: number;
  pageSize: number;
  status?: 'all' | 'ingested' | 'superseded';
}): Promise<DailyV2Page<DailyV2CanonicalUnitRow>> {
  assertAuthorizedDailyV2Target();
  const { page, pageSize, from, to } = normalizePage(input.page, input.pageSize);
  let query = dailyV2Supabase
    .from('daily_statement_units_canonical')
    .select('*', { count: 'exact' })
    .order('accounting_date', { ascending: false })
    .order('ingested_at', { ascending: false })
    .range(from, to);
  if (input.status && input.status !== 'all') query = query.eq('status', input.status);

  const { data, error, count } = await query;
  if (error) throw toSafeError(error, 'Lecture des unités canonical impossible.');
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
}

export async function listDailyV2CanonicalLines(
  canonicalUnitId: string,
): Promise<DailyV2CanonicalLineRow[]> {
  assertAuthorizedDailyV2Target();
  const { data, error } = await dailyV2Supabase
    .from('daily_statement_lines_canonical')
    .select('*')
    .eq('canonical_unit_id', canonicalUnitId)
    .order('source_line_index', { ascending: true });
  if (error) throw toSafeError(error, 'Lecture des lignes canonical impossible.');
  return data ?? [];
}

export async function getActiveDailyV2CanonicalUnit(
  dayUnitId: string,
): Promise<DailyV2CanonicalUnitRow | null> {
  assertAuthorizedDailyV2Target();
  const { data, error } = await dailyV2Supabase
    .from('daily_statement_units_canonical')
    .select('*')
    .eq('day_unit_id', dayUnitId)
    .eq('status', 'ingested')
    .maybeSingle();
  if (error) throw toSafeError(error, 'Lecture de l’unité canonical active impossible.');
  return data;
}

export async function listDailyV2AuditEvents(input: {
  page: number;
  pageSize: number;
}): Promise<DailyV2Page<DailyV2AuditEventRow>> {
  assertAuthorizedDailyV2Target();
  const { page, pageSize, from, to } = normalizePage(input.page, input.pageSize);
  const { data, error, count } = await dailyV2Supabase
    .from('daily_statement_import_events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw toSafeError(error, 'Lecture de l’audit Daily v2 impossible.');
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
}

const REPORTING_COLUMNS =
  'id,accounting_date,bank,currency,account_fingerprint,line_count,' +
  'day_total_debits,day_total_credits,opening_balance_derived,closing_balance_derived,' +
  'aggregates_status,validation_status,ingested_at';

/**
 * Monotone concurrency epoch: exact count of ALL canonical units (active AND
 * superseded, no status filter). Allowed canonical mutations are append-only
 * (promotion) or supersede-with-insertion, so any concurrent mutation strictly
 * increases this count. Read-only HEAD request — no row is ever transferred.
 */
async function readDailyV2CanonicalEpochCount(): Promise<number> {
  const { error, count } = await dailyV2Supabase
    .from('daily_statement_units_canonical')
    .select('id', { count: 'exact', head: true });
  if (error) throw toSafeError(error, 'Lecture reporting canonical impossible.');
  if (count === null || count === undefined) {
    throw new DailyV2ServiceError(
      'Le comptage epoch canonical est indisponible (fail-closed).',
      'REPORT_EPOCH_COUNT_UNAVAILABLE',
    );
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new DailyV2ServiceError(
      'Le comptage epoch canonical est invalide (fail-closed).',
      'REPORT_EPOCH_COUNT_INVALID',
    );
  }
  return count;
}

/**
 * Real READ-ONLY adapter over the single existing Supabase client. NOT
 * exported: the UI can never supply its own client nor bypass the runtime
 * target guard of the public entry point below. Query composition only —
 * every fail-closed decision lives in the pure read core.
 */
const dailyV2ReportingReadAdapter: DailyV2ReportingReadAdapter = {
  async readEpochCount(): Promise<number> {
    return readDailyV2CanonicalEpochCount();
  },

  // Snapshot anchor: the newest active unit of the filtered set. Its
  // ingested_at becomes the immutable cutoff every page is filtered against.
  async readAnchor(filters: DailyV2ReportingReadFilters) {
    let anchorQuery = dailyV2Supabase
      .from('daily_statement_units_canonical')
      .select('id,ingested_at', { count: 'exact' })
      .eq('status', 'ingested')
      .gte('accounting_date', filters.startDate)
      .lte('accounting_date', filters.endDate)
      .order('ingested_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    if (filters.bank !== null) anchorQuery = anchorQuery.eq('bank', filters.bank);
    if (filters.currency !== null) anchorQuery = anchorQuery.eq('currency', filters.currency);

    const { data, error, count } = await anchorQuery;
    if (error) throw toSafeError(error, 'Lecture reporting canonical impossible.');
    return { data, count };
  },

  // Canonical set "active at the cutoff": still ingested, or superseded
  // strictly after the cutoff (it was active when the snapshot was anchored).
  // Replacement units promoted after the cutoff are excluded by the
  // ingested_at <= cutoff page filter. The cutoff comes from the core, which
  // validated it against the strict ISO anchor schema — never user input.
  async readPage(input: {
    filters: DailyV2ReportingReadFilters;
    snapshotCutoff: string;
    from: number;
    to: number;
  }) {
    const activeAtSnapshotCondition =
      `status.eq.ingested,and(status.eq.superseded,superseded_at.gt.${input.snapshotCutoff})`;

    let pageQuery = dailyV2Supabase
      .from('daily_statement_units_canonical')
      .select(REPORTING_COLUMNS, { count: 'exact' })
      .gte('accounting_date', input.filters.startDate)
      .lte('accounting_date', input.filters.endDate)
      .lte('ingested_at', input.snapshotCutoff)
      .or(activeAtSnapshotCondition)
      .order('accounting_date', { ascending: true })
      .order('id', { ascending: true })
      .range(input.from, input.to);
    if (input.filters.bank !== null) pageQuery = pageQuery.eq('bank', input.filters.bank);
    if (input.filters.currency !== null) {
      pageQuery = pageQuery.eq('currency', input.filters.currency);
    }

    const { data, error, count } = await pageQuery;
    if (error) throw toSafeError(error, 'Lecture reporting canonical impossible.');
    return { data, count };
  },
};

/**
 * Narrow, bounded canonical read RESERVED for the 0O reporting service.
 * Returns raw internal rows (id + account_fingerprint included) that must
 * never reach the UI, a safe report or an export — the reporting service
 * aggregates them immediately and discards them.
 *
 * READ path only: canonical units active at an immutable snapshot cutoff,
 * never the canonical lines, never staging, never an RPC. The snapshot,
 * epoch, pagination and validation behavior lives in
 * dailyV2ReportingReadCore.ts; this wrapper contributes the runtime target
 * guard and the real PostgREST adapter.
 */
export async function listDailyV2CanonicalUnitsForReporting(filters: {
  startDate: string;
  endDate: string;
  bank: string | null;
  currency: string | null;
}): Promise<{ rows: DailyV2ReportingUnitRow[]; totalCount: number }> {
  assertAuthorizedDailyV2Target();
  return runDailyV2CanonicalReportingRead(dailyV2ReportingReadAdapter, filters);
}

function assertAuthorizedDailyV2Target(): void {
  const verdict = currentDailyV2RuntimeTargetVerdict();
  if (verdict.allowed === false) {
    throw new DailyV2ServiceError(verdict.reason, 'TARGET_NOT_ALLOWED');
  }
}

async function assertAuthenticatedSession(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new DailyV2ServiceError('Une session authentifiée est requise.', 'AUTH_REQUIRED');
  }
}

function normalizePage(pageValue: number, pageSizeValue: number) {
  const page = Number.isInteger(pageValue) && pageValue >= 0 ? pageValue : 0;
  const pageSize =
    Number.isInteger(pageSizeValue) && pageSizeValue >= 1 && pageSizeValue <= 100
      ? pageSizeValue
      : 20;
  const from = page * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

function normalizeOptionalReason(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  if (trimmed.length > MAX_SAFE_REASON_LENGTH) {
    throw new DailyV2ServiceError(
      `La raison doit contenir au maximum ${MAX_SAFE_REASON_LENGTH} caractères.`,
      'REASON_TOO_LONG',
    );
  }
  return trimmed;
}

function normalizeRequiredReason(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new DailyV2ServiceError('Une raison est obligatoire.', 'REASON_REQUIRED');
  }
  if (trimmed.length > MAX_SAFE_REASON_LENGTH) {
    throw new DailyV2ServiceError(
      `La raison doit contenir au maximum ${MAX_SAFE_REASON_LENGTH} caractères.`,
      'REASON_TOO_LONG',
    );
  }
  return trimmed;
}

function parseRpcResponse<T>(
  schema: z.ZodType<unknown>,
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DailyV2ServiceError(message, 'RPC_RESPONSE_INVALID');
  }
  return parsed.data as T;
}

function toSafeError(error: { message?: string; code?: string }, fallback: string): DailyV2ServiceError {
  const message = error.message ?? '';
  const dailyCode = message.match(/DAILY_STMT_[A-Z0-9_]+/)?.[0];
  const safeCode = dailyCode ?? error.code;
  return new DailyV2ServiceError(dailyCode ? `${fallback} (${dailyCode})` : fallback, safeCode);
}
