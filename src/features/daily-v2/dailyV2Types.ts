import type { Json } from '@/integrations/supabase/types';

export type DailyV2AppRole = 'admin' | 'auditor' | 'manager' | 'user';
export type DailyV2FingerprintScheme = 'sha256_hex_v1' | 'legacy_opaque_v1';
export type DailyV2RequestedMode = 'daily' | 'backfill';
export type DailyV2ParserValidationStatus = 'valid' | 'needs_review';
export type DailyV2AggregatesStatus = 'derived' | 'unavailable';
export type DailyV2RequestedUnitStatus = 'staged' | 'provisional';
export type DailyV2StagingStatus =
  | 'staged'
  | 'provisional'
  | 'duplicate'
  | 'conflict'
  | 'needs_review'
  | 'promoted'
  | 'promotion_failed'
  | 'superseded'
  | 'rejected';
export type DailyV2CanonicalStatus = 'ingested' | 'superseded';
export type DailyV2ReviewReasonCode =
  | 'TRUSTED_CURRENCY_UNCORROBORATED'
  | 'RUNNING_BALANCE_MISSING'
  | 'RUNNING_BALANCE_CHAIN_INCOHERENT'
  | 'AGGREGATES_UNAVAILABLE'
  | 'ACTIVE_LINE_HASH_SCOPE_CONFLICT'
  | 'ACCOUNT_IDENTITY_NOT_CORROBORATED'
  | 'BACKFILL_REVIEW_REQUIRED';

export interface DailyV2AccountRegistryRow {
  id: string;
  created_at: string;
  created_by: string;
  bank: string;
  currency: string;
  safe_alias: string;
  fingerprint_scheme: DailyV2FingerprintScheme;
  account_fingerprint: string;
  account_number_masked: string | null;
  status: 'active' | 'inactive';
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
}

export interface DailyV2BackfillGrantRow {
  id: string;
  account_registry_id: string;
  created_at: string;
  created_by: string;
  period_start: string;
  period_end: string;
  max_units: number;
  expires_at: string;
  status: 'active' | 'consumed' | 'revoked';
  consumed_at: string | null;
  consumed_by: string | null;
  consumed_attempt_id: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
}

export interface DailyV2AccountEventRow {
  id: string;
  created_at: string;
  actor_id: string;
  account_registry_id: string;
  backfill_grant_id: string | null;
  event_type: 'account_provisioned' | 'account_deactivated' | 'backfill_grant_issued' | 'backfill_grant_consumed' | 'backfill_grant_revoked';
  safe_message: string;
  safe_details: Json | null;
}

export interface DailyV2ExportAttemptRow {
  id: string;
  created_at: string;
  created_by: string | null;
  requested_mode: DailyV2RequestedMode;
  source_format: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  account_registry_id: string | null;
  account_number_masked: string | null;
  source_file_name_redacted: string | null;
  raw_text_hash: string;
  export_period_start: string;
  export_period_end: string;
  statement_date: string | null;
  export_reference_date: string | null;
  parser_validation_status: DailyV2ParserValidationStatus;
  errors_count: number;
  warnings_count: number;
  runtime_version: string | null;
  parser_version: string | null;
  ingestion_ready: boolean;
  bridge_guard_passed: boolean;
  period_days: number;
  backfill_grant_reference: string | null;
  backfill_grant_id: string | null;
  review_reason_codes: DailyV2ReviewReasonCode[];
  units_total: number;
}

export interface DailyV2StagingUnitRow {
  id: string;
  attempt_id: string;
  day_unit_id: string;
  bank: string;
  account_fingerprint: string;
  account_registry_id: string | null;
  currency: string;
  accounting_date: string;
  day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  review_reason_codes: DailyV2ReviewReasonCode[];
  status: DailyV2StagingStatus;
  created_at: string;
  created_by: string | null;
}

export interface DailyV2StagingLineRow {
  id: string;
  staging_unit_id: string;
  attempt_id: string;
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: string;
}

export interface DailyV2CanonicalUnitRow {
  id: string;
  promoted_from_staging_unit_id: string;
  day_unit_id: string;
  bank: string;
  account_fingerprint: string;
  account_registry_id: string | null;
  currency: string;
  accounting_date: string;
  active_day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  review_reason_codes: DailyV2ReviewReasonCode[];
  status: DailyV2CanonicalStatus;
  ingested_at: string;
  ingested_by: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
}

/**
 * Narrow canonical-unit projection reserved for the 0O reporting read.
 * INTERNAL ONLY: `id` stabilizes pagination and `account_fingerprint` feeds
 * the local alias — neither may reach the UI, a safe report or an export.
 */
export interface DailyV2ReportingUnitRow {
  id: string;
  accounting_date: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  ingested_at: string;
}

export interface DailyV2CanonicalLineRow {
  id: string;
  canonical_unit_id: string;
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  is_active: boolean;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: string;
}

export interface DailyV2AuditEventRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  attempt_id: string | null;
  staging_unit_id: string | null;
  canonical_unit_id: string | null;
  day_unit_id: string | null;
  raw_text_hash: string | null;
  event_type: string;
  previous_status: string | null;
  new_status: string | null;
  safe_message: string | null;
  safe_details: Json | null;
}

export interface DailyV2RpcAttempt {
  requested_mode: DailyV2RequestedMode;
  source_format: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  account_registry_id: string;
  account_number_masked: string | null;
  source_file_name_redacted: string | null;
  raw_text_hash: string;
  export_period_start: string;
  export_period_end: string;
  statement_date: string | null;
  export_reference_date: string | null;
  parser_validation_status: DailyV2ParserValidationStatus;
  errors_count: number;
  warnings_count: number;
  runtime_version: string | null;
  parser_version: string | null;
  review_reason_codes: DailyV2ReviewReasonCode[];
}

export interface DailyV2RpcUnit {
  day_unit_id: string;
  accounting_date: string;
  day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  review_reason_codes: DailyV2ReviewReasonCode[];
  requested_unit_status: DailyV2RequestedUnitStatus;
}

export interface DailyV2RpcLine {
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
}

export interface DailyV2RpcGuardContext {
  ingestion_ready: boolean;
  period_days: number;
  bridge_guard_passed: boolean;
  backfill_grant_id: string | null;
}

export interface DailyV2PreIngestPayload {
  p_attempt: DailyV2RpcAttempt;
  p_units: DailyV2RpcUnit[];
  p_lines: DailyV2RpcLine[];
  p_guard_context: DailyV2RpcGuardContext;
}

export interface DailyV2PreIngestUnitResult {
  day_unit_id: string;
  unit_status: DailyV2StagingStatus;
  staging_unit_id: string;
  active_canonical_unit_id: string | null;
}

export interface DailyV2PreIngestResponse {
  attempt_id: string;
  requested_mode: DailyV2RequestedMode;
  units: DailyV2PreIngestUnitResult[];
}

export interface DailyV2PromoteResponse {
  outcome: 'duplicate' | 'conflict' | 'needs_review' | 'promoted';
  active_canonical_unit_id?: string;
  canonical_unit_id?: string;
}

export interface DailyV2SupersedeResponse {
  outcome: 'duplicate' | 'superseded';
  active_canonical_unit_id?: string;
  old_canonical_unit_id?: string;
  new_canonical_unit_id?: string;
}

// Lot 1 opérationnel : décisions, attestations, versions et réfutations.
export type DailyV2AttestationType = 'ACCOUNT_IDENTITY' | 'TRUSTED_CURRENCY';
export type DailyV2VersionComparison =
  | 'SAME_VERSION'
  | 'CONTRADICTION'
  | 'AGREEMENT_BREAKDOWN'
  | 'AGREEMENT_DETAIL'
  | 'INSUFFICIENT_UNAVAILABLE'
  | 'INSUFFICIENT_INCOHERENT';
export type DailyV2RefutationProofKind = 'FRESH_DELIVERY' | 'BANK_PIECE';

export interface DailyV2AttemptAttestationRow {
  id: string;
  attempt_id: string;
  attestation_type: DailyV2AttestationType;
  action: 'ATTEST' | 'REVOKE';
  raw_text_hash: string;
  account_registry_id: string;
  currency: string;
  revokes_id: string | null;
  after_revocation_id: string | null;
  evidence_ref: string | null;
  reason: string;
  actor_id: string;
  created_at: string;
}

export interface DailyV2VersionRefutationRow {
  id: string;
  action: 'REFUTE' | 'REVOKE';
  day_unit_id: string;
  account_registry_id: string;
  accounting_date: string;
  refuted_version_key: string;
  retained_canonical_unit_id: string;
  retained_version_key: string;
  comparison: Exclude<DailyV2VersionComparison, 'SAME_VERSION' | 'AGREEMENT_BREAKDOWN' | 'AGREEMENT_DETAIL'>
    | 'NOT_APPLICABLE';
  proof_kind: DailyV2RefutationProofKind | null;
  proof_staging_unit_id: string | null;
  proof_bound_day: string | null;
  piece_id: string | null;
  revokes_id: string | null;
  after_revocation_id: string | null;
  reason: string;
  actor_id: string;
  created_at: string;
}

export interface DailyV2RefutationSourceRow {
  refutation_id: string;
  raw_text_hash: string;
  account_registry_id: string;
  first_seen_at: string;
  proof_bound_day: string;
  verdict: 'JUSTIFIED';
}

export interface DailyV2CorrectionPieceRow {
  id: string;
  account_registry_id: string;
  piece_sha256: string;
  piece_reference: string;
  archive_reference: string;
  issued_on: string;
  archive_attested: boolean;
  nature: 'ARCHIVED_PIECE_ATTESTATION';
  actor_id: string;
  created_at: string;
}

/** Source d'une version telle qu'affichée, puis transmise à l'identique (état attendu). */
export interface DailyV2VersionSource {
  raw_text_hash: string;
  account_registry_id: string;
  first_seen_at: string;
}

export type DailyV2RefutationProof =
  | { kind: 'FRESH_DELIVERY'; staging_unit_id: string }
  | {
    kind: 'BANK_PIECE';
    piece_sha256: string;
    piece_reference: string;
    archive_reference: string;
    issued_on: string;
    archive_attested: true;
    opening: string | null;
    closing: string | null;
    debits: string | null;
    credits: string | null;
  };

export interface DailyV2BatchExpected {
  days: Array<{
    staging_unit_id: string;
    day_unit_id: string;
    day_content_hash: string;
    canonical_unit_id: string | null;
    canonical_content_hash: string | null;
  }>;
  attestation_ids: string[];
}

export interface DailyV2DecisionResult {
  outcome: string;
  [key: string]: unknown;
}

// --------------------------------------------------------------------------
// Versions d'une journée (fonctions pures, sans réseau). Miroir exact des
// règles du serveur (migration 20261103120000) : clé de version, cohérence,
// comparaison à trois issues, sources, justification d'une preuve, liste
// admissible d'un fichier. Le serveur reste seul juge : il recalcule sous
// verrou et refuse tout écart avec l'état transmis.
// --------------------------------------------------------------------------

export const DAILY_V2_PIECE_MENTION = 'attestation sur pièce archivée, contenu non vérifié automatiquement';
export const DAILY_V2_PENDING_STATUSES = ['staged', 'needs_review', 'promotion_failed'] as const;
export const DAILY_V2_ATTESTABLE_CODES: Record<DailyV2AttestationType, string> = {
  ACCOUNT_IDENTITY: 'ACCOUNT_IDENTITY_NOT_CORROBORATED',
  TRUSTED_CURRENCY: 'TRUSTED_CURRENCY_UNCORROBORATED',
};

/** Faits financiers d'une livraison ou de l'unité retenue. */
export interface DailyV2VersionFacts {
  hash: string;
  aggregates: string;
  opening: number | null;
  closing: number | null;
  debits: number | null;
  credits: number | null;
}

export function stagingVersionFacts(unit: DailyV2StagingUnitRow): DailyV2VersionFacts {
  return {
    hash: unit.day_content_hash, aggregates: unit.aggregates_status, opening: unit.opening_balance_derived,
    closing: unit.closing_balance_derived, debits: unit.day_total_debits, credits: unit.day_total_credits,
  };
}

export function canonicalVersionFacts(unit: DailyV2CanonicalUnitRow): DailyV2VersionFacts {
  return {
    hash: unit.active_day_content_hash, aggregates: unit.aggregates_status, opening: unit.opening_balance_derived,
    closing: unit.closing_balance_derived, debits: unit.day_total_debits, credits: unit.day_total_credits,
  };
}

/**
 * Texte exact d'un montant numeric(18,2) tel que PostgreSQL le rend. Au-delà de
 * 10^13, un nombre JavaScript ne garantit plus les centimes : refus (fail-closed).
 */
export function dailyV2AmountText(value: number | null): string {
  if (value === null) return '-';
  if (!Number.isFinite(value) || Math.abs(value) >= 1e13) {
    throw new Error('DAILY_V2_AMOUNT_OUT_OF_EXACT_RANGE');
  }
  return value.toFixed(2);
}

/** Clé de version : identité des mouvements et version financière complète (daily_stmt_version_key). */
export function dailyV2VersionKey(facts: DailyV2VersionFacts): string {
  return [facts.hash, facts.aggregates || '-', dailyV2AmountText(facts.opening), dailyV2AmountText(facts.closing),
    dailyV2AmountText(facts.debits), dailyV2AmountText(facts.credits)].join('|');
}

function cents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

/** Relations 1 à 4 : totaux présents et positifs, soldes dérivés liés aux mouvements ou absents. */
export function dailyV2VersionCoherent(facts: DailyV2VersionFacts): boolean {
  const [opening, closing, debits, credits] = [facts.opening, facts.closing, facts.debits, facts.credits].map(cents);
  if (debits === null || credits === null || debits < 0 || credits < 0) return false;
  if (facts.aggregates === 'derived') {
    return opening !== null && closing !== null && closing === opening + credits - debits;
  }
  if (facts.aggregates === 'unavailable') return opening === null && closing === null;
  return false;
}

function net(facts: DailyV2VersionFacts): number | null {
  const debits = cents(facts.debits);
  const credits = cents(facts.credits);
  return debits === null || credits === null ? null : credits - debits;
}

/** Comparaison d'une livraison W à la version retenue R (daily_stmt_version_compare). */
export function dailyV2CompareVersions(w: DailyV2VersionFacts, r: DailyV2VersionFacts): DailyV2VersionComparison {
  const same = (a: number | null, b: number | null) => cents(a) === cents(b);
  if (w.hash === r.hash && w.aggregates === r.aggregates && same(w.opening, r.opening) && same(w.closing, r.closing)
      && same(w.debits, r.debits) && same(w.credits, r.credits)) {
    return 'SAME_VERSION';
  }
  if (net(w) !== net(r)) return 'CONTRADICTION';
  const wCoherent = dailyV2VersionCoherent(w);
  const rCoherent = dailyV2VersionCoherent(r);
  const pairOk = !(w.hash === r.hash && (!same(w.debits, r.debits) || !same(w.credits, r.credits)));
  if (wCoherent && rCoherent && pairOk && w.aggregates === 'derived' && r.aggregates === 'derived') {
    if (!same(w.opening, r.opening) || !same(w.closing, r.closing)) return 'CONTRADICTION';
    if (!same(w.debits, r.debits) || !same(w.credits, r.credits)) return 'AGREEMENT_BREAKDOWN';
    return 'AGREEMENT_DETAIL';
  }
  if (!wCoherent || !rCoherent || !pairOk) return 'INSUFFICIENT_INCOHERENT';
  return 'INSUFFICIENT_UNAVAILABLE';
}

/** Date calendaire à Dakar d'un instant serveur. */
export function dakarDate(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dakar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

export interface DailyV2SourceWithCount extends DailyV2VersionSource {
  deliveries: number;
}

/**
 * Sources d'une version (daily_stmt_version_sources) : fichiers qui la portent,
 * hors livraisons provisoires et remplacées, avec leur première apparition.
 * L'instant reste le texte serveur, sans conversion (précision conservée).
 */
export function dailyV2VersionSources(
  units: DailyV2StagingUnitRow[], attempts: DailyV2ExportAttemptRow[], versionKey: string,
): DailyV2SourceWithCount[] {
  const byAttempt = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const sources = new Map<string, DailyV2SourceWithCount>();
  for (const unit of units) {
    if (unit.status === 'provisional' || unit.status === 'superseded') continue;
    if (dailyV2VersionKey(stagingVersionFacts(unit)) !== versionKey) continue;
    const attempt = byAttempt.get(unit.attempt_id);
    if (!attempt || attempt.account_registry_id === null) throw new Error('DAILY_V2_SOURCE_CONTEXT_MISSING');
    const id = `${attempt.raw_text_hash}|${attempt.account_registry_id}`;
    const known = sources.get(id);
    if (!known) {
      sources.set(id, { raw_text_hash: attempt.raw_text_hash, account_registry_id: attempt.account_registry_id,
        first_seen_at: attempt.created_at, deliveries: 1 });
    } else {
      known.deliveries += 1;
      if (Date.parse(attempt.created_at) < Date.parse(known.first_seen_at)) known.first_seen_at = attempt.created_at;
    }
  }
  return [...sources.values()].sort((a, b) => (a.raw_text_hash === b.raw_text_hash
    ? a.account_registry_id.localeCompare(b.account_registry_id) : a.raw_text_hash < b.raw_text_hash ? -1 : 1));
}

export interface DailyV2SourceVerdict {
  source: DailyV2SourceWithCount;
  firstSeenDay: string;
  justified: boolean;
}

/** Une preuve justifie une source si sa borne est strictement postérieure, au jour près, à sa première apparition. */
export function dailyV2SourceVerdicts(sources: DailyV2SourceWithCount[], bound: string | null): DailyV2SourceVerdict[] {
  return sources.map((source) => {
    const firstSeenDay = dakarDate(source.first_seen_at);
    return { source, firstSeenDay, justified: bound !== null && /^\d{4}-\d{2}-\d{2}$/.test(bound) && bound > firstSeenDay };
  });
}

/** Borne d'une livraison fraîche : dernière journée livrée par son fichier, au plus tard le jour de son dépôt. */
export function dailyV2FreshDeliveryBound(attempt: DailyV2ExportAttemptRow, attemptUnits: DailyV2StagingUnitRow[]): string | null {
  const deposited = dakarDate(attempt.created_at);
  const days = attemptUnits.filter((unit) => unit.attempt_id === attempt.id && unit.accounting_date <= deposited)
    .map((unit) => unit.accounting_date).sort();
  return days.length === 0 ? null : days[days.length - 1];
}

/** Valeurs de pièce exigées par le serveur : celles qui portent la contradiction, ou les soldes. */
export function dailyV2PieceRequirements(refuted: DailyV2VersionFacts, retained: DailyV2VersionFacts,
  comparison: DailyV2VersionComparison): { balances: boolean; totals: boolean } {
  const totals = net(refuted) !== net(retained);
  let balances = comparison.startsWith('INSUFFICIENT')
    || (retained.aggregates === 'derived' && refuted.aggregates === 'derived'
      && (cents(refuted.opening) !== cents(retained.opening) || cents(refuted.closing) !== cents(retained.closing)));
  if (!totals && !balances) balances = true;
  return { balances, totals };
}

export function activeAttestations(rows: DailyV2AttemptAttestationRow[]): DailyV2AttemptAttestationRow[] {
  const revoked = new Set(rows.filter((row) => row.action === 'REVOKE').map((row) => row.revokes_id));
  return rows.filter((row) => row.action === 'ATTEST' && !revoked.has(row.id));
}

export function activeRefutations(rows: DailyV2VersionRefutationRow[]): DailyV2VersionRefutationRow[] {
  const revoked = new Set(rows.filter((row) => row.action === 'REVOKE').map((row) => row.revokes_id));
  return rows.filter((row) => row.action === 'REFUTE' && !revoked.has(row.id));
}

export interface DailyV2DayVersion {
  key: string;
  facts: DailyV2VersionFacts;
  retained: boolean;
  deliveries: DailyV2StagingUnitRow[];
  comparison: DailyV2VersionComparison | null;
  sources: DailyV2SourceWithCount[];
  refutation: DailyV2VersionRefutationRow | null;
  /** Sources apparues hors de la réfutation active : elles la rouvrent (nouvelle preuve nécessaire). */
  uncoveredSources: DailyV2SourceWithCount[];
}

/** Versions d'une journée : livraisons regroupées par identité des mouvements et version financière. */
export function groupDailyV2DayVersions(input: {
  units: DailyV2StagingUnitRow[];
  attempts: DailyV2ExportAttemptRow[];
  active: DailyV2CanonicalUnitRow | null;
  refutations: DailyV2VersionRefutationRow[];
  refutationSources: DailyV2RefutationSourceRow[];
}): DailyV2DayVersion[] {
  const retainedFacts = input.active ? canonicalVersionFacts(input.active) : null;
  const retainedKey = retainedFacts ? dailyV2VersionKey(retainedFacts) : null;
  const active = activeRefutations(input.refutations);
  const groups = new Map<string, DailyV2DayVersion>();
  for (const unit of input.units) {
    if (unit.status === 'superseded') continue;
    const facts = stagingVersionFacts(unit);
    const key = dailyV2VersionKey(facts);
    const known = groups.get(key);
    if (known) {
      known.deliveries.push(unit);
      continue;
    }
    const refutation = active.find((row) => row.refuted_version_key === key) ?? null;
    groups.set(key, {
      key, facts, retained: key === retainedKey, deliveries: [unit],
      comparison: retainedFacts ? dailyV2CompareVersions(facts, retainedFacts) : null,
      sources: [], refutation, uncoveredSources: [],
    });
  }
  for (const version of groups.values()) {
    version.sources = dailyV2VersionSources(input.units, input.attempts, version.key);
    if (version.refutation) {
      const covered = new Set(input.refutationSources.filter((row) => row.refutation_id === version.refutation!.id)
        .map((row) => `${row.raw_text_hash}|${row.account_registry_id}`));
      version.uncoveredSources = version.sources.filter((source) =>
        !covered.has(`${source.raw_text_hash}|${source.account_registry_id}`));
    }
  }
  return [...groups.values()].sort((a, b) => Number(b.retained) - Number(a.retained) || a.key.localeCompare(b.key));
}

export const COMPARISON_LABELS: Record<DailyV2VersionComparison, string> = {
  SAME_VERSION: 'Même version',
  CONTRADICTION: 'Contradiction démontrée',
  AGREEMENT_BREAKDOWN: 'Accord établi — ventilation différente (mouvements non résolus)',
  AGREEMENT_DETAIL: 'Accord établi — détail différent (mouvements non résolus)',
  INSUFFICIENT_UNAVAILABLE: 'Données insuffisantes — agrégats indisponibles',
  INSUFFICIENT_INCOHERENT: 'Données insuffisantes — faits financiers incohérents',
};

export function isRefutable(version: DailyV2DayVersion, retained: DailyV2VersionFacts | null): boolean {
  if (version.retained || version.comparison === null || retained === null || version.sources.length === 0) return false;
  if (version.comparison === 'CONTRADICTION') return true;
  return version.comparison.startsWith('INSUFFICIENT') && retained.aggregates === 'derived' && dailyV2VersionCoherent(retained);
}

export function isBalanceCorrectionCandidate(unit: DailyV2StagingUnitRow, active: DailyV2CanonicalUnitRow | null): boolean {
  if (!active || unit.status !== 'duplicate' || unit.day_content_hash !== active.active_day_content_hash) return false;
  const facts = stagingVersionFacts(unit);
  return dailyV2VersionKey(facts) !== dailyV2VersionKey(canonicalVersionFacts(active))
    && facts.aggregates === 'derived' && dailyV2VersionCoherent(facts);
}

/** Montant saisi : format strict du serveur (daily_stmt_parse_amount_strict). */
export function isDailyV2AmountText(text: string): boolean {
  return /^-?[0-9]{1,16}([.][0-9]{1,2})?$/.test(text.trim());
}

export const DAILY_V2_BATCH_MAX_DAYS = 45;
const ATTESTATION_CODES = ['ACCOUNT_IDENTITY_NOT_CORROBORATED', 'TRUSTED_CURRENCY_UNCORROBORATED'];

export interface DailyV2BatchPlan {
  fileHealthy: boolean;
  unresolvedFileCodes: string[];
  admissible: DailyV2StagingUnitRow[];
  inadmissible: Array<{ unit: DailyV2StagingUnitRow; reason: string }>;
  expected: DailyV2BatchExpected;
}

export function computeDailyV2BatchPlan(input: {
  attempt: DailyV2ExportAttemptRow;
  units: DailyV2StagingUnitRow[];
  activeCanonicals: DailyV2CanonicalUnitRow[];
  attestations: DailyV2AttemptAttestationRow[];
}): DailyV2BatchPlan {
  const revoked = new Set(input.attestations.filter((row) => row.action === 'REVOKE').map((row) => row.revokes_id));
  const active = input.attestations.filter((row) => row.attempt_id === input.attempt.id && row.action === 'ATTEST'
    && !revoked.has(row.id));
  const resolved = new Set<string>(active.map((row) => (row.attestation_type === 'ACCOUNT_IDENTITY'
    ? 'ACCOUNT_IDENTITY_NOT_CORROBORATED' : 'TRUSTED_CURRENCY_UNCORROBORATED')));
  const unresolvedFileCodes = (input.attempt.review_reason_codes ?? []).filter((code) => !resolved.has(code));
  const fileHealthy = unresolvedFileCodes.length === 0;
  const canonicalByDay = new Map(input.activeCanonicals.filter((row) => row.status === 'ingested')
    .map((row) => [row.day_unit_id, row]));

  const admissible: DailyV2StagingUnitRow[] = [];
  const inadmissible: Array<{ unit: DailyV2StagingUnitRow; reason: string }> = [];
  const units = input.units.filter((unit) => unit.attempt_id === input.attempt.id)
    .sort((a, b) => a.accounting_date.localeCompare(b.accounting_date) || a.id.localeCompare(b.id));
  for (const unit of units) {
    const codes = unit.review_reason_codes ?? [];
    if (!fileHealthy) {
      inadmissible.push({ unit, reason: `Fichier entier non résolu : ${unresolvedFileCodes.join(', ')}` });
    } else if (unit.status !== 'staged') {
      inadmissible.push({ unit, reason: `Statut ${unit.status}` });
    } else if (unit.aggregates_status !== 'derived') {
      inadmissible.push({ unit, reason: 'Soldes non dérivés' });
    } else if (unit.validation_status === 'needs_review' && codes.length === 0) {
      inadmissible.push({ unit, reason: 'À revoir sans motif enregistré' });
    } else if (unit.validation_status === 'needs_review'
      && codes.some((code) => !resolved.has(code) || !ATTESTATION_CODES.includes(code))) {
      inadmissible.push({ unit, reason: `Motifs non résolus : ${codes.filter((code) => !resolved.has(code)).join(', ')}` });
    } else if (unit.validation_status !== 'valid' && unit.validation_status !== 'needs_review') {
      inadmissible.push({ unit, reason: `Validation ${unit.validation_status}` });
    } else {
      admissible.push(unit);
    }
  }
  // Ordre du serveur : journée (collation C), puis identifiant.
  const byC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const days = admissible.map((unit) => {
    const canonical = canonicalByDay.get(unit.day_unit_id) ?? null;
    return {
      staging_unit_id: unit.id, day_unit_id: unit.day_unit_id, day_content_hash: unit.day_content_hash,
      canonical_unit_id: canonical?.id ?? null, canonical_content_hash: canonical?.active_day_content_hash ?? null,
    };
  }).sort((a, b) => byC(a.day_unit_id, b.day_unit_id) || byC(a.staging_unit_id, b.staging_unit_id));
  return {
    fileHealthy, unresolvedFileCodes, admissible, inadmissible,
    expected: { days, attestation_ids: active.map((row) => row.id).sort(byC) },
  };
}

export interface DailyV2Page<T> {
  rows: T[];
  count: number;
  page: number;
  pageSize: number;
}

export type DailyV2Database = {
  public: {
    Tables: {
      daily_statement_export_attempts: DailyV2TableDefinition<DailyV2ExportAttemptRow>;
      daily_statement_units_staging: DailyV2TableDefinition<DailyV2StagingUnitRow>;
      daily_statement_lines_staging: DailyV2TableDefinition<DailyV2StagingLineRow>;
      daily_statement_units_canonical: DailyV2TableDefinition<DailyV2CanonicalUnitRow>;
      daily_statement_lines_canonical: DailyV2TableDefinition<DailyV2CanonicalLineRow>;
      daily_statement_import_events: DailyV2TableDefinition<DailyV2AuditEventRow>;
      daily_statement_account_registry: DailyV2TableDefinition<DailyV2AccountRegistryRow>;
      daily_statement_backfill_grants: DailyV2TableDefinition<DailyV2BackfillGrantRow>;
      daily_statement_account_events: DailyV2TableDefinition<DailyV2AccountEventRow>;
      daily_statement_attempt_attestations: DailyV2TableDefinition<DailyV2AttemptAttestationRow>;
      daily_statement_version_refutations: DailyV2TableDefinition<DailyV2VersionRefutationRow>;
      daily_statement_refutation_sources: DailyV2TableDefinition<DailyV2RefutationSourceRow>;
      daily_statement_correction_pieces: DailyV2TableDefinition<DailyV2CorrectionPieceRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      daily_stmt_mutations_enabled: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      pre_ingest_daily_statement_units: {
        Args: {
          p_attempt: DailyV2RpcAttempt;
          p_units: DailyV2RpcUnit[];
          p_lines: DailyV2RpcLine[];
          p_guard_context: DailyV2RpcGuardContext;
        };
        Returns: Json;
      };
      promote_daily_statement_unit: {
        Args: { p_staging_unit_id: string; p_approval_reason?: string | null };
        Returns: Json;
      };
      supersede_daily_statement_unit: {
        Args: {
          p_old_canonical_unit_id: string;
          p_new_staging_unit_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      provision_daily_statement_account: {
        Args: {
          p_bank: string;
          p_currency: string;
          p_safe_alias: string;
          p_account_number_masked?: string | null;
        };
        Returns: Json;
      };
      deactivate_daily_statement_account: {
        Args: { p_account_registry_id: string; p_reason: string };
        Returns: Json;
      };
      issue_daily_statement_backfill_grant: {
        Args: {
          p_account_registry_id: string;
          p_period_start: string;
          p_period_end: string;
          p_max_units: number;
          p_expires_at: string;
        };
        Returns: Json;
      };
      revoke_daily_statement_backfill_grant: {
        Args: { p_backfill_grant_id: string; p_reason: string };
        Returns: Json;
      };
      attest_daily_statement_attempt: {
        Args: {
          p_command_key: string;
          p_attempt_id: string;
          p_attestation_type: DailyV2AttestationType;
          p_raw_text_hash: string;
          p_account_registry_id: string;
          p_currency: string | null;
          p_evidence_ref: string;
          p_reason: string;
        };
        Returns: Json;
      };
      revoke_daily_statement_attempt_attestation: {
        Args: { p_command_key: string; p_attestation_id: string; p_reason: string };
        Returns: Json;
      };
      reject_daily_statement_unit: {
        Args: {
          p_command_key: string;
          p_staging_unit_id: string;
          p_expected_status: DailyV2StagingStatus;
          p_expected_canonical_unit_id: string | null;
          p_expected_canonical_content_hash: string | null;
          p_reason: string;
        };
        Returns: Json;
      };
      promote_daily_statement_attempt_units: {
        Args: {
          p_command_key: string;
          p_attempt_id: string;
          p_expected: Json;
          p_approval_reason: string;
        };
        Returns: Json;
      };
      supersede_daily_statement_unit_balances: {
        Args: {
          p_command_key: string;
          p_canonical_unit_id: string;
          p_corrective_staging_unit_id: string;
          p_expected_corrective_version_key: string;
          p_reason: string;
        };
        Returns: Json;
      };
      refute_daily_statement_version: {
        Args: {
          p_command_key: string;
          p_day_unit_id: string;
          p_refuted_version_key: string;
          p_expected_retained_version_key: string;
          p_expected_sources: Json;
          p_proof: Json;
          p_reason: string;
        };
        Returns: Json;
      };
      revoke_daily_statement_version_refutation: {
        Args: { p_command_key: string; p_refutation_id: string; p_reason: string };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type DailyV2TableDefinition<Row extends object> = {
  Row: Row & Record<string, unknown>;
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
