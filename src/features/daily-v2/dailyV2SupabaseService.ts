import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type {
  DailyV2AppRole,
  DailyV2AuditEventRow,
  DailyV2CanonicalLineRow,
  DailyV2CanonicalUnitRow,
  DailyV2Database,
  DailyV2Page,
  DailyV2PreIngestPayload,
  DailyV2PreIngestResponse,
  DailyV2PromoteResponse,
  DailyV2StagingLineRow,
  DailyV2StagingStatus,
  DailyV2StagingUnitRow,
  DailyV2SupersedeResponse,
} from './dailyV2Types';
import { currentDailyV2RuntimeTargetVerdict } from './dailyV2RuntimeTarget';

const dailyV2Supabase = supabase as unknown as SupabaseClient<DailyV2Database>;
const MAX_SAFE_REASON_LENGTH = 200;

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

export class DailyV2ServiceError extends Error {
  readonly safeCode?: string;

  constructor(message: string, safeCode?: string) {
    super(message);
    this.name = 'DailyV2ServiceError';
    this.safeCode = safeCode;
  }
}

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
