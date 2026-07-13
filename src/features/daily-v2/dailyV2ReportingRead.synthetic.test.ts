import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_V2_REPORTING_MAX_UNITS,
  DailyV2ServiceError,
  runDailyV2CanonicalReportingRead,
  type DailyV2ReportingReadAdapter,
  type DailyV2ReportingReadFilters,
} from './dailyV2ReportingReadCore';
import type { DailyV2ReportingUnitRow } from './dailyV2Types';

const FILTERS: DailyV2ReportingReadFilters = {
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  bank: null,
  currency: null,
};

const CUTOFF = '2026-07-10T08:00:00.000Z';
const ANCHOR_ID = '00000000-0000-4000-8000-00000000a11c';

function syntheticRow(
  index: number,
  overrides: Partial<DailyV2ReportingUnitRow> = {},
): DailyV2ReportingUnitRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    accounting_date: '2026-07-05',
    bank: 'BDK',
    currency: 'XOF',
    account_fingerprint: 'synthetic-read-fingerprint-alpha',
    line_count: 1,
    day_total_debits: 100.5,
    day_total_credits: 250,
    opening_balance_derived: null,
    closing_balance_derived: 1000.25,
    aggregates_status: 'derived',
    validation_status: 'valid',
    ingested_at: CUTOFF,
    ...overrides,
  };
}

function syntheticRows(count: number): DailyV2ReportingUnitRow[] {
  return Array.from({ length: count }, (_, index) => syntheticRow(index));
}

const VALID_ANCHOR = { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 1 };

interface SyntheticReadConfig {
  /** Successive readEpochCount() returns; the last value repeats. */
  epochs: number[];
  anchor: { data: unknown; count: number | null };
  pages?: Array<{ data: unknown; count: number | null }>;
}

function syntheticAdapter(config: SyntheticReadConfig) {
  let epochIndex = 0;
  const calls = {
    epoch: 0,
    anchor: 0,
    pages: [] as Array<{ from: number; to: number; snapshotCutoff: string }>,
  };
  const adapter: DailyV2ReportingReadAdapter = {
    async readEpochCount() {
      calls.epoch += 1;
      const value = config.epochs[Math.min(epochIndex, config.epochs.length - 1)];
      epochIndex += 1;
      return value;
    },
    async readAnchor() {
      calls.anchor += 1;
      return config.anchor;
    },
    async readPage(input) {
      calls.pages.push({
        from: input.from,
        to: input.to,
        snapshotCutoff: input.snapshotCutoff,
      });
      const page = (config.pages ?? [])[calls.pages.length - 1];
      if (page === undefined) {
        throw new Error('synthetic adapter: unexpected extra page read');
      }
      return page;
    },
  };
  return { adapter, calls };
}

async function expectRefusal(
  adapter: DailyV2ReportingReadAdapter,
  safeCode: string,
): Promise<void> {
  await assert.rejects(
    runDailyV2CanonicalReportingRead(adapter, FILTERS),
    (error: unknown) => {
      assert.ok(error instanceof DailyV2ServiceError, 'a DailyV2ServiceError is expected');
      assert.equal(error.safeCode, safeCode);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// A. Stable non-empty success
// ---------------------------------------------------------------------------

test('A. returns every row of a stable multi-page read with the anchored count', async () => {
  const allRows = syntheticRows(1500);
  const { adapter, calls } = syntheticAdapter({
    epochs: [7],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 1500 },
    pages: [
      { data: allRows.slice(0, 1000), count: 1500 },
      { data: allRows.slice(1000), count: 1500 },
    ],
  });

  const result = await runDailyV2CanonicalReportingRead(adapter, FILTERS);

  assert.equal(result.totalCount, 1500);
  assert.equal(result.rows.length, 1500);
  assert.equal(result.rows[0].bank, 'BDK');
  assert.equal(result.rows[0].line_count, 1);
  assert.equal(calls.epoch, 2);
  assert.equal(calls.anchor, 1);
  assert.deepEqual(
    calls.pages.map((page) => ({ from: page.from, to: page.to })),
    [
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ],
  );
  // The validated anchor timestamp is the cutoff given to every page.
  assert.ok(calls.pages.every((page) => page.snapshotCutoff === CUTOFF));
});

test('A2. a single-page read passes rows and totalCount through unchanged', async () => {
  const { adapter } = syntheticAdapter({
    epochs: [3],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 2 },
    pages: [{ data: syntheticRows(2), count: 2 }],
  });
  const result = await runDailyV2CanonicalReportingRead(adapter, FILTERS);
  assert.equal(result.totalCount, 2);
  assert.equal(result.rows.length, 2);
});

// ---------------------------------------------------------------------------
// B. Stable empty success
// ---------------------------------------------------------------------------

test('B. an empty stable read returns zero rows without reading any page', async () => {
  const { adapter, calls } = syntheticAdapter({
    epochs: [11],
    anchor: { data: [], count: 0 },
  });
  const result = await runDailyV2CanonicalReportingRead(adapter, FILTERS);
  assert.deepEqual(result, { rows: [], totalCount: 0 });
  assert.equal(calls.pages.length, 0);
  assert.equal(calls.epoch, 2);
});

// ---------------------------------------------------------------------------
// C / D. Concurrent canonical mutation (epoch drift)
// ---------------------------------------------------------------------------

test('C. an epoch drift after a full read refuses the report', async () => {
  const { adapter } = syntheticAdapter({
    epochs: [5, 6],
    anchor: VALID_ANCHOR,
    pages: [{ data: [syntheticRow(0)], count: 1 }],
  });
  await expectRefusal(adapter, 'REPORT_CONCURRENT_CANONICAL_MUTATION');
});

test('D. an empty report racing a mutation is refused the same way', async () => {
  const { adapter, calls } = syntheticAdapter({
    epochs: [5, 9],
    anchor: { data: [], count: 0 },
  });
  await expectRefusal(adapter, 'REPORT_CONCURRENT_CANONICAL_MUTATION');
  assert.equal(calls.pages.length, 0);
});

// ---------------------------------------------------------------------------
// E. Page count drift
// ---------------------------------------------------------------------------

test('E. a page whose exact count diverges from the anchored count is refused', async () => {
  const { adapter } = syntheticAdapter({
    epochs: [4],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 2 },
    pages: [{ data: syntheticRows(2), count: 3 }],
  });
  await expectRefusal(adapter, 'REPORT_SNAPSHOT_COUNT_MISMATCH');
});

// ---------------------------------------------------------------------------
// F. Invalid anchor
// ---------------------------------------------------------------------------

test('F. a positive count with an invalid anchor is refused fail-closed', async () => {
  for (const anchor of [
    { data: [], count: 2 },
    { data: [{ id: 'not-a-uuid', ingested_at: CUTOFF }], count: 2 },
    { data: [{ id: ANCHOR_ID, ingested_at: 'July 10, 2026' }], count: 2 },
    { data: [{ id: ANCHOR_ID, ingested_at: '' }], count: 2 },
  ]) {
    const { adapter, calls } = syntheticAdapter({ epochs: [4], anchor });
    await expectRefusal(adapter, 'REPORT_SNAPSHOT_ANCHOR_INVALID');
    assert.equal(calls.pages.length, 0);
  }
});

// ---------------------------------------------------------------------------
// G. Ceiling
// ---------------------------------------------------------------------------

test('G. a count above the 5000-unit ceiling refuses before any page is read', async () => {
  assert.equal(DAILY_V2_REPORTING_MAX_UNITS, 5000);
  const { adapter, calls } = syntheticAdapter({
    epochs: [4],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 5001 },
  });
  await expectRefusal(adapter, 'REPORT_TOO_MANY_UNITS');
  assert.equal(calls.pages.length, 0);
});

// ---------------------------------------------------------------------------
// H. Fetched total diverges from the announced count
// ---------------------------------------------------------------------------

test('H. fewer fetched rows than the anchored count is refused, never truncated', async () => {
  const { adapter } = syntheticAdapter({
    epochs: [4],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 2 },
    pages: [{ data: [syntheticRow(0)], count: 2 }],
  });
  await expectRefusal(adapter, 'REPORT_READ_INCONSISTENT');
});

// ---------------------------------------------------------------------------
// I. Invalid page rows (Zod)
// ---------------------------------------------------------------------------

test('I. one invalid row refuses the whole page with no partial subset', async () => {
  for (const badRow of [
    syntheticRow(0, { bank: '   ' }),
    syntheticRow(0, { line_count: 0 }),
    syntheticRow(0, { line_count: 2_147_483_648 }),
    syntheticRow(0, { day_total_debits: Number.POSITIVE_INFINITY }),
    syntheticRow(0, { accounting_date: '05/07/2026' }),
    { ...syntheticRow(0), unexpected_key: true } as unknown as DailyV2ReportingUnitRow,
  ]) {
    const { adapter } = syntheticAdapter({
      epochs: [4],
      anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: 2 },
      pages: [{ data: [syntheticRow(1), badRow], count: 2 }],
    });
    await expectRefusal(adapter, 'REPORT_RESPONSE_INVALID');
  }
});

// ---------------------------------------------------------------------------
// J. Missing exact count
// ---------------------------------------------------------------------------

test('J. a null count on the anchor or on a page is refused fail-closed', async () => {
  const anchorless = syntheticAdapter({
    epochs: [4],
    anchor: { data: [{ id: ANCHOR_ID, ingested_at: CUTOFF }], count: null },
  });
  await expectRefusal(anchorless.adapter, 'REPORT_COUNT_UNAVAILABLE');

  const pageless = syntheticAdapter({
    epochs: [4],
    anchor: VALID_ANCHOR,
    pages: [{ data: [syntheticRow(0)], count: null }],
  });
  await expectRefusal(pageless.adapter, 'REPORT_COUNT_UNAVAILABLE');
});
