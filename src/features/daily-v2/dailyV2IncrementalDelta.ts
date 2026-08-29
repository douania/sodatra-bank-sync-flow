import type { DailyV2PreIngestPayload } from './dailyV2Types';

const HEX64_PATTERN = /^[0-9a-f]{64}$/;

export interface DailyV2ActiveCanonicalFingerprint {
  day_unit_id: string;
  active_day_content_hash: string;
}

export interface DailyV2IncrementalDeltaSummary {
  sourceUnits: number;
  sourceLines: number;
  identicalUnitsSkipped: number;
  identicalLinesSkipped: number;
  newUnits: number;
  changedUnits: number;
  serverReconciliationUnits: number;
  submittedUnits: number;
  submittedLines: number;
}

export interface DailyV2IncrementalDelta {
  payload: DailyV2PreIngestPayload;
  summary: DailyV2IncrementalDeltaSummary;
}

function assertHex64(value: string, label: string): void {
  if (!HEX64_PATTERN.test(value)) {
    throw new Error(`DAILY_V2_INCREMENTAL_INVALID_${label}`);
  }
}

/**
 * Client-side optimization only. The server remains the final R1/R2/R3
 * arbiter, so a canonical row created after this comparison is still handled
 * atomically by the ingest RPC.
 */
export function buildDailyV2BackfillIncrementalDelta(
  payload: DailyV2PreIngestPayload,
  activeCanonical: readonly DailyV2ActiveCanonicalFingerprint[],
  liveProvisionalDayUnitIds: readonly string[] = [],
): DailyV2IncrementalDelta {
  if (payload.p_attempt.requested_mode !== 'backfill' || payload.p_attempt.bank !== 'BIS') {
    throw new Error('DAILY_V2_INCREMENTAL_BIS_BACKFILL_ONLY');
  }

  const unitsById = new Map(payload.p_units.map((unit) => [unit.day_unit_id, unit]));
  if (unitsById.size !== payload.p_units.length) {
    throw new Error('DAILY_V2_INCREMENTAL_DUPLICATE_SOURCE_UNIT');
  }

  const canonicalById = new Map<string, string>();
  for (const row of activeCanonical) {
    assertHex64(row.day_unit_id, 'CANONICAL_DAY_UNIT_ID');
    assertHex64(row.active_day_content_hash, 'CANONICAL_CONTENT_HASH');
    if (canonicalById.has(row.day_unit_id)) {
      throw new Error('DAILY_V2_INCREMENTAL_DUPLICATE_ACTIVE_CANONICAL');
    }
    canonicalById.set(row.day_unit_id, row.active_day_content_hash);
  }

  const liveProvisional = new Set<string>();
  for (const dayUnitId of liveProvisionalDayUnitIds) {
    assertHex64(dayUnitId, 'PROVISIONAL_DAY_UNIT_ID');
    liveProvisional.add(dayUnitId);
  }

  const submittedDayIds = new Set<string>();
  let identicalUnitsSkipped = 0;
  let newUnits = 0;
  let changedUnits = 0;
  let serverReconciliationUnits = 0;

  const submittedUnits = payload.p_units.filter((unit) => {
    assertHex64(unit.day_unit_id, 'SOURCE_DAY_UNIT_ID');
    assertHex64(unit.day_content_hash, 'SOURCE_CONTENT_HASH');
    const activeHash = canonicalById.get(unit.day_unit_id);
    if (activeHash === unit.day_content_hash && !liveProvisional.has(unit.day_unit_id)) {
      identicalUnitsSkipped += 1;
      return false;
    }
    if (activeHash === undefined) newUnits += 1;
    else if (activeHash !== unit.day_content_hash) changedUnits += 1;
    else serverReconciliationUnits += 1;
    submittedDayIds.add(unit.day_unit_id);
    return true;
  });

  for (const line of payload.p_lines) {
    if (!unitsById.has(line.day_unit_id)) {
      throw new Error('DAILY_V2_INCREMENTAL_ORPHAN_SOURCE_LINE');
    }
  }
  const submittedLines = payload.p_lines.filter((line) => submittedDayIds.has(line.day_unit_id));

  return {
    payload: {
      ...payload,
      p_units: submittedUnits,
      p_lines: submittedLines,
    },
    summary: {
      sourceUnits: payload.p_units.length,
      sourceLines: payload.p_lines.length,
      identicalUnitsSkipped,
      identicalLinesSkipped: payload.p_lines.length - submittedLines.length,
      newUnits,
      changedUnits,
      serverReconciliationUnits,
      submittedUnits: submittedUnits.length,
      submittedLines: submittedLines.length,
    },
  };
}
