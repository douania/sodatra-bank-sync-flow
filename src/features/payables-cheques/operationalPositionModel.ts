// Modèle de la vue opérationnelle par compte. Une valeur absente reste
// « indisponible » avec son motif, jamais zéro ; aucune somme entre devises ;
// la position indicative après chèques reste distincte du solde bancaire et de
// la disponibilité nette en date de valeur (non calculée par ce lot).

export interface AccountPositionRow {
  account_id: string;
  bank: string;
  account_alias: string;
  currency: string;
  last_statement_date: string | null;
  bank_balance: number | null;
  balance_status: string;
  register_status: string;
  takeover_cutoff: string | null;
  bank_qualified: boolean;
  circulation_count: number;
  circulation_amount: number | null;
  circulation_unknown_count: number;
  circulation_at_statement_amount: number | null;
  engaged_not_debited_amount: number;
  transfers_pending_count: number;
  transfers_pending_amount: number;
  pending_bank_items: number;
  open_blocking_exceptions: number;
  coverage_gap_days: number | null;
  indicative_position: number | null;
  indicative_reasons: string[];
}

export interface InvoiceOverviewRow {
  invoice_id: string;
  supplier_id: string;
  supplier_name: string;
  reference_exact: string;
  collision_ordinal: number;
  amount: number;
  currency: string;
  invoice_date: string | null;
  due_date: string | null;
  reserved_amount: number;
  engaged_amount: number;
  remaining_amount: number | null;
  blocked: boolean;
  row_version: number;
}

export type Displayed = { kind: 'value'; value: number } | { kind: 'unavailable'; reason: string };

const REASON_LABELS: Record<string, string> = {
  CURRENCY_NOT_SUPPORTED: 'devise non prise en charge (XOF uniquement)',
  BALANCE_NO_STATEMENT: 'aucun relevé',
  BALANCE_UNIT_NEEDS_REVIEW: 'dernier relevé en revue',
  BALANCE_AGGREGATES_UNAVAILABLE: 'soldes du dernier relevé non dérivés',
  BALANCE_CLOSING_MISSING: 'solde de clôture absent',
  REGISTER_NOT_STARTED: 'reprise initiale non faite',
  REGISTER_INCOMPLETE: 'reprise non attestée exhaustive',
  STATEMENT_BEFORE_TAKEOVER: 'dernier relevé antérieur à la reprise',
  BANK_NOT_QUALIFIED: 'banque non qualifiée pour le rapprochement des chèques',
  BANK_FOLLOWUP_PENDING: 'suivi bancaire non à jour',
  BLOCKING_EXCEPTION_OPEN: 'exception bloquante ouverte',
  AMOUNT_UNKNOWN: 'montant d’un chèque en circulation inconnu',
  COVERAGE_GAP: 'trou de couverture des relevés',
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export function balanceDisplay(row: AccountPositionRow): Displayed {
  if (row.balance_status === 'AVAILABLE' && row.bank_balance !== null) return { kind: 'value', value: row.bank_balance };
  return { kind: 'unavailable', reason: reasonLabel(`BALANCE_${row.balance_status}`) };
}

export function circulationDisplay(row: AccountPositionRow): Displayed {
  if (row.circulation_amount === null) return { kind: 'unavailable', reason: reasonLabel('AMOUNT_UNKNOWN') };
  return { kind: 'value', value: row.circulation_amount };
}

export function indicativeDisplay(row: AccountPositionRow): Displayed {
  if (row.indicative_position !== null && row.indicative_reasons.length === 0) {
    return { kind: 'value', value: row.indicative_position };
  }
  const reasons = row.indicative_reasons.length > 0 ? row.indicative_reasons : ['BANK_FOLLOWUP_PENDING'];
  return { kind: 'unavailable', reason: reasons.map(reasonLabel).join(' ; ') };
}

export type DueBucket = 'OVERDUE' | 'WITHIN_7_DAYS' | 'WITHIN_30_DAYS' | 'LATER' | 'UNKNOWN';

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  OVERDUE: 'Échues',
  WITHIN_7_DAYS: 'Sous 7 jours',
  WITHIN_30_DAYS: 'Sous 30 jours',
  LATER: 'Au-delà de 30 jours',
  UNKNOWN: 'Échéance non renseignée',
};

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function dueBucket(dueDate: string | null, asOf: string): DueBucket {
  if (!dueDate) return 'UNKNOWN';
  const days = dayDiff(asOf, dueDate);
  if (days < 0) return 'OVERDUE';
  if (days <= 7) return 'WITHIN_7_DAYS';
  if (days <= 30) return 'WITHIN_30_DAYS';
  return 'LATER';
}

export interface DueGroup {
  bucket: DueBucket;
  label: string;
  invoices: InvoiceOverviewRow[];
  /** Total du restant à engager, par devise ; NULL si un restant est indisponible. */
  remainingByCurrency: Record<string, number | null>;
}

/**
 * Factures restant à engager, regroupées par échéance. Une facture déjà
 * couverte par un paiement engagé n'apparaît que pour son restant ; une facture
 * bloquée apparaît avec un restant indisponible. Aucun total ne mélange deux
 * devises.
 */
export function groupInvoicesByDue(rows: InvoiceOverviewRow[], asOf: string): DueGroup[] {
  const order: DueBucket[] = ['OVERDUE', 'WITHIN_7_DAYS', 'WITHIN_30_DAYS', 'LATER', 'UNKNOWN'];
  const groups = new Map<DueBucket, DueGroup>(order.map((bucket) => [bucket, {
    bucket, label: DUE_BUCKET_LABELS[bucket], invoices: [], remainingByCurrency: {},
  }]));
  for (const row of rows) {
    if (!row.blocked && row.remaining_amount !== null && row.remaining_amount <= 0) continue;
    const group = groups.get(dueBucket(row.due_date, asOf))!;
    group.invoices.push(row);
    const previous = row.currency in group.remainingByCurrency ? group.remainingByCurrency[row.currency] : 0;
    group.remainingByCurrency[row.currency] = previous === null || row.remaining_amount === null || row.blocked
      ? null
      : previous + row.remaining_amount;
  }
  return order.map((bucket) => groups.get(bucket)!).filter((group) => group.invoices.length > 0);
}

const amountFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatXof(value: number): string {
  return `${amountFormat.format(value)} XOF`;
}

export function displayText(value: Displayed): string {
  return value.kind === 'value' ? formatXof(value.value) : `Indisponible — ${value.reason}`;
}
