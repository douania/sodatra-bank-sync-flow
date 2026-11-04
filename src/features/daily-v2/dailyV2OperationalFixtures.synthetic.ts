/**
 * Lot 1 opérationnel — jeux SYNTHÉTIQUES passés par le VRAI pipeline Daily v2.
 * Aucune donnée bancaire réelle. Les classeurs sont construits en mémoire, puis
 * `prepareDailyV2BrowserDeposit` produit les arguments RPC exacts : aucune
 * empreinte, aucune clé journalière et aucun solde dérivé n'est écrit à la main.
 * Utilisé par le test TypeScript des versions et par le générateur SQL des
 * suites Daily v2 opérationnelles.
 */
import * as XLSX from 'xlsx';
import {
  prepareDailyV2BrowserDeposit,
  type DailyV2SupportedBank,
  type PrepareDailyV2BrowserResult,
} from './dailyV2BrowserPipeline';

export const OPX_CURRENCY = 'XOF';
export const OPX_ATB_FINGERPRINT = '1'.repeat(64);
export const OPX_ATB_ACCOUNT = '00000000-0000-4000-8000-0000000000f1';
export const OPX_BIS_FINGERPRINT = '2'.repeat(64);
export const OPX_BIS_ACCOUNT = '00000000-0000-4000-8000-0000000000f2';
export const OPX_ATB_BATCH_FINGERPRINT = '3'.repeat(64);
export const OPX_ATB_BATCH_ACCOUNT = '00000000-0000-4000-8000-0000000000f3';
export const OPX_BACKFILL_GRANT = '00000000-0000-4000-8000-00000000f0f2';

type Row = unknown[];

function workbookBytes(rows: Row[], bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SYNTHETIC');
  const written = XLSX.write(workbook, { type: 'array', bookType, compression: false }) as ArrayBuffer | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

function excelSerial(day: number, month: number, year: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** ATB ONLINE .xls : montant signé, lignes en ordre DESCENDANT (la plus récente d'abord). */
function atbFile(title: string, rows: Array<[string, number, string, string, string]>): ArrayBuffer {
  return workbookBytes(
    [
      [title], [], [], [], [], [],
      ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
      ...rows.map(([reference, serial, amount, balance, label]) =>
        [reference, serial, serial, amount, balance, OPX_CURRENCY, label]),
    ],
    'xls',
  );
}

/** BIS ONLINE .xls : débit et crédit séparés, devise fixe, ordre descendant. */
function bisFile(rows: Array<{ date: string; debit: number; credit: number; balance: string; tag: string }>): ArrayBuffer {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';
  const body = rows.map((entry) => {
    const line = new Array(15).fill('');
    line[1] = entry.date;
    line[3] = entry.date;
    line[5] = `OPX BIS ${entry.tag}`;
    line[10] = entry.debit;
    line[12] = entry.credit;
    line[14] = entry.balance;
    return line;
  });
  return workbookBytes([['SYNTHETIC ONLINE EXPORT'], [], [], [], [], [], [], [], [], [], header, ...body], 'xls');
}

const J = excelSerial(15, 10, 2026);
const J2 = excelSerial(16, 10, 2026);
const J3 = excelSerial(18, 10, 2026);
const P = excelSerial(19, 10, 2026);
const R1 = excelSerial(23, 10, 2026);
const R2 = excelSerial(24, 10, 2026);
const B1 = excelSerial(5, 10, 2026);
const B2 = excelSerial(6, 10, 2026);
const B3 = excelSerial(7, 10, 2026);

export interface OperationalScenario {
  key: string;
  bank: DailyV2SupportedBank;
  fileName: string;
  bytes: ArrayBuffer;
  accountFingerprint: string;
  accountRegistryId: string;
  requestedMode?: 'daily' | 'backfill';
  backfillGrantId?: string;
}

/**
 * Journée J (15/10) : version erronée (ouverture 90, crédit 10, clôture 100) et
 * version corrigée (ouverture 100, même crédit, clôture 110), mêmes mouvements.
 */
export const OPERATIONAL_SCENARIOS: OperationalScenario[] = [
  { key: 'wrong', fileName: 'opx atb wrong.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-1', J, '10', '100', 'OPX ATB CREDIT J']]) },
  { key: 'right', fileName: 'opx atb right.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-1', J, '10', '110', 'OPX ATB CREDIT J']]) },
  // Autre fichier (empreinte brute différente) portant la MÊME version erronée.
  { key: 'wrong_f2', fileName: 'opx atb wrong f2.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT F2', [['OPX-1', J, '10', '100', 'OPX ATB CREDIT J']]) },
  // Livraison corrective postérieure : la version corrigée de J et une journée livrée le 18.
  { key: 'right_later', fileName: 'opx atb right later.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [
    ['OPX-9', J3, '5', '115', 'OPX ATB CREDIT J3'], ['OPX-1', J, '10', '110', 'OPX ATB CREDIT J']]) },
  // Même net, ventilation différente (crédit 11 puis débit 1), mêmes soldes que la version corrigée.
  { key: 'breakdown', fileName: 'opx atb breakdown.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [
    ['OPX-3', J, '-1', '110', 'OPX ATB DEBIT J'], ['OPX-2', J, '11', '111', 'OPX ATB CREDIT J BIS']]) },
  // Mêmes mouvements, solde courant absent : agrégats indisponibles.
  { key: 'unavailable', fileName: 'opx atb unavailable.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-1', J, '10', '', 'OPX ATB CREDIT J']]) },
  // Journée J2 (16/10) : réserve CTO 4.2 (première copie inutilisable).
  { key: 'wrong2', fileName: 'opx atb wrong2.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-4', J2, '20', '200', 'OPX ATB CREDIT J2']]) },
  { key: 'right2', fileName: 'opx atb right2.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-4', J2, '20', '220', 'OPX ATB CREDIT J2']]) },
  // Journée P (19/10) : écartement sur une journée retenue.
  { key: 'pend_a', fileName: 'opx atb pend a.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-5', P, '10', '210', 'OPX ATB CREDIT P']]) },
  { key: 'pend_same', fileName: 'opx atb pend same.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT SAME', [['OPX-5', P, '10', '210', 'OPX ATB CREDIT P']]) },
  { key: 'pend_breakdown', fileName: 'opx atb pend breakdown.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [
    ['OPX-7', P, '-1', '210', 'OPX ATB DEBIT P'], ['OPX-6', P, '11', '211', 'OPX ATB CREDIT P BIS']]) },
  { key: 'pend_contra', fileName: 'opx atb pend contra.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-8', P, '20', '220', 'OPX ATB CREDIT P TER']]) },
  // Courses réelles entre sessions : deux journées en attente (23 et 24/10).
  { key: 'race_u', fileName: 'opx atb race u.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-R1', R1, '10', '310', 'OPX ATB CREDIT R1']]) },
  { key: 'race_v', fileName: 'opx atb race v.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [['OPX-R2', R2, '10', '320', 'OPX ATB CREDIT R2']]) },
  // Fichier de trois journées, identité non corroborée : approbation groupée.
  { key: 'batch', fileName: 'opx atb batch.xls', bytes: atbFile('SYNTHETIC ONLINE EXPORT', [
    ['OPX-B3', B3, '30', '160', 'OPX ATB CREDIT B3'], ['OPX-B2', B2, '20', '130', 'OPX ATB CREDIT B2'],
    ['OPX-B1', B1, '10', '110', 'OPX ATB CREDIT B1']]) },
].map((s) => ({
  ...s,
  bank: 'ATB' as const,
  accountFingerprint: s.key === 'batch' ? OPX_ATB_BATCH_FINGERPRINT : OPX_ATB_FINGERPRINT,
  accountRegistryId: s.key === 'batch' ? OPX_ATB_BATCH_ACCOUNT : OPX_ATB_ACCOUNT,
}));

// BIS : journée X (20/02) déposée en quotidien, puis relivrée par un backfill aux
// soldes différents (même mouvement) : exception H1 du cœur de backfill.
OPERATIONAL_SCENARIOS.push(
  { key: 'bis_daily', bank: 'BIS', fileName: 'opx bis daily.xls',
    bytes: bisFile([{ date: '20/02/2026', debit: 0, credit: 200, balance: '1,100 Créditeur', tag: 'CREDIT X' }]),
    accountFingerprint: OPX_BIS_FINGERPRINT, accountRegistryId: OPX_BIS_ACCOUNT },
  { key: 'bis_backfill', bank: 'BIS', fileName: 'opx bis backfill.xls',
    bytes: bisFile([
      { date: '20/02/2026', debit: 0, credit: 200, balance: '1,150 Créditeur', tag: 'CREDIT X' },
      { date: '01/01/2026', debit: 100, credit: 0, balance: '950 Créditeur', tag: 'DEBIT Y' },
    ]),
    accountFingerprint: OPX_BIS_FINGERPRINT, accountRegistryId: OPX_BIS_ACCOUNT,
    requestedMode: 'backfill', backfillGrantId: OPX_BACKFILL_GRANT },
);

export type OperationalPayloads = Map<string, Extract<PrepareDailyV2BrowserResult, { success: true }>>;

export async function prepareOperationalPayloads(): Promise<OperationalPayloads> {
  const out: OperationalPayloads = new Map();
  for (const scenario of OPERATIONAL_SCENARIOS) {
    const bytes = scenario.bytes;
    const result = await prepareDailyV2BrowserDeposit({
      file: { name: scenario.fileName, size: bytes.byteLength, arrayBuffer: async () => bytes.slice(0) },
      bank: scenario.bank,
      currency: OPX_CURRENCY,
      accountFingerprint: scenario.accountFingerprint,
      accountRegistryId: scenario.accountRegistryId,
      requestedMode: scenario.requestedMode,
      backfillGrantId: scenario.backfillGrantId,
    });
    if (result.success === false) {
      throw new Error(`${scenario.key}: the real pipeline refused the synthetic deposit: ${result.errors.join(' | ')}`);
    }
    out.set(scenario.key, result);
  }
  return out;
}
