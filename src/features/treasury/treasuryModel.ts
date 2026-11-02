import { z } from 'zod';
import { formatDailyV2MinorUnits } from '@/features/daily-v2/dailyV2Money';

// Modèle de présentation de la vue « Soldes à date » (trésorerie V1, Lot 1).
// Pur : aucun accès réseau. Une valeur absente reste « Indisponible », jamais
// zéro ; un sous-total partiel n'est jamais présenté comme un total.

export const ACCOUNT_STATUSES = ['AVAILABLE', 'NOT_COVERED', 'BLOCKED', 'OUT_OF_SCOPE'] as const;
export type TreasuryAccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const CONSOLIDATION_STATUSES = ['COMPLETE', 'PARTIAL', 'BLOCKED'] as const;
export type TreasuryConsolidationStatus = (typeof CONSOLIDATION_STATUSES)[number];

const amountText = z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTime = z.string().min(10);

const observedSchema = z.object({ balance: amountText, date: isoDate });
// Preuves effectivement utilisées pour le solde de D, avec leurs références.
const sourceSchema = z.union([
  z.object({
    kind: z.literal('CANONICAL_UNIT'),
    role: z.enum(['CLOSING', 'OPENING']),
    unit_id: z.string().uuid(),
    export_id: z.string().uuid(),
    day: isoDate,
    ingested_at: dateTime.nullable(),
    export_ingested_at: dateTime.nullable(),
    source_format: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('CLOSURE_LATER_LINE'),
    export_id: z.string().uuid(),
    delivery: z.enum(['promoted', 'duplicate']),
    later_line_day: isoDate,
    export_ingested_at: dateTime,
  }),
  z.object({
    kind: z.literal('CLOSURE_NEXT_OPENING'),
    unit_id: z.string().uuid(),
    export_id: z.string().uuid(),
    day: isoDate,
    ingested_at: dateTime.nullable(),
    export_ingested_at: dateTime,
  }),
  z.object({
    kind: z.literal('CHAIN_LINK'),
    day: isoDate,
    link: z.enum(['OK', 'CONTINUOUS_GAP', 'ANCHOR', 'BREAK', 'UNPROVEN']),
    reference_day: isoDate.nullable(),
  }),
  z.object({
    kind: z.literal('DECLARED_PERIOD'),
    export_id: z.string().uuid(),
    period_start: isoDate,
    period_end: isoDate,
    closed_until: isoDate,
    export_ingested_at: dateTime,
  }),
]);

const accountSchema = z.object({
  expected_account_id: z.string().uuid(),
  registry_account_id: z.string().uuid().nullable(),
  bank: z.string(),
  currency: z.string(),
  alias: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  reasons: z.array(z.string()),
  balance_at_date: amountText.nullable(),
  observed_balance: observedSchema.nullable(),
  source_format: z.string().nullable(),
  qualification: z.string(),
  qualification_evidence: z.string().nullable(),
  dates: z.object({
    bank_date_covered: isoDate.nullable(),
    age_days: z.number().int().nullable(),
    bank_date_observed: isoDate.nullable(),
    balance_source_day: isoDate.nullable(),
  }),
  sources: z.array(sourceSchema),
  value_dates: z.object({
    total_lines: z.number().int().min(0),
    lines_with_value_date: z.number().int().min(0),
  }),
});

const resultSchema = z.object({
  contract: z.literal('treasury_balances_at_v1'),
  as_of: isoDate,
  today: isoDate,
  read_at: dateTime,
  timezone: z.literal('Africa/Dakar'),
  basis: z.literal('ACCOUNTING_DATE'),
  value_date_window_days: z.number().int(),
  inventory: z.object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    active_accounts: z.number().int().min(0),
    attested: z.boolean(),
    attested_at: dateTime.nullable(),
    unlisted_registry_accounts: z.array(z.object({
      registry_account_id: z.string().uuid(),
      bank: z.string(),
      currency: z.string(),
      alias: z.string(),
    })),
  }),
  accounts: z.array(accountSchema),
  consolidation: z.object({
    currency: z.literal('XOF'),
    status: z.enum(CONSOLIDATION_STATUSES),
    amount: amountText.nullable(),
    accounts_expected: z.number().int().min(0),
    accounts_available: z.number().int().min(0),
    accounts_not_covered: z.number().int().min(0),
    accounts_blocked: z.number().int().min(0),
    accounts_out_of_scope: z.number().int().min(0),
    registry_accounts_outside_inventory: z.number().int().min(0),
    reasons: z.array(z.string()),
  }),
});

export type TreasuryBalances = z.infer<typeof resultSchema>;
export type TreasuryAccount = z.infer<typeof accountSchema>;
export type TreasurySource = z.infer<typeof sourceSchema>;

export class TreasuryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TreasuryError';
  }
}

export function parseTreasuryBalances(raw: unknown): TreasuryBalances {
  const parsed = resultSchema.safeParse(raw);
  if (parsed.success !== true) {
    throw new TreasuryError('TREASURY_RESPONSE_INVALID', 'La réponse du serveur ne respecte pas le contrat attendu.');
  }
  return parsed.data;
}

export const ACCOUNT_STATUS_LABELS: Record<TreasuryAccountStatus, string> = {
  AVAILABLE: 'Disponible',
  NOT_COVERED: 'Non couvert à D',
  BLOCKED: 'Bloqué',
  OUT_OF_SCOPE: 'Hors périmètre',
};

export const CONSOLIDATION_STATUS_LABELS: Record<TreasuryConsolidationStatus, string> = {
  COMPLETE: 'Complet',
  PARTIAL: 'Partiel',
  BLOCKED: 'Bloqué',
};

export const QUALIFICATION_LABELS: Record<string, string> = {
  NOT_QUALIFIED: 'Non qualifié',
  PILOT: 'Pilote',
  QUALIFIED: 'Qualifié',
  SUSPENDED: 'Suspendu',
  NO_FORMAT: 'Sans format d’export',
};

export const REASON_LABELS: Record<string, string> = {
  CURRENCY_OUT_OF_SCOPE: 'Devise hors périmètre (XOF seul)',
  BANK_WITHOUT_FORMAT: 'Banque sans format d’export pris en charge',
  ACCOUNT_NOT_REGISTERED: 'Compte attendu absent du registre Daily v2',
  REGISTRY_ACCOUNT_INACTIVE: 'Compte du registre désactivé',
  CURRENCY_CONTRADICTION: 'Devise contradictoire entre le registre et les relevés',
  CHAIN_BROKEN: 'Chaîne des soldes rompue',
  CHAIN_BROKEN_AFTER_DATE: 'Solde contredit par l’ouverture d’un relevé ultérieur',
  CHAIN_UNPROVEN_AFTER_DATE: 'Ouverture ultérieure différente sans mouvement livré entre-temps',
  CHAIN_UNPROVEN: 'Chaîne des soldes non prouvée (relevés manquants)',
  NO_STATEMENT: 'Aucun relevé à cette date',
  PROVISIONAL_DAY: 'Journée encore provisoire',
  DAY_WITHOUT_PROOF: 'Journée sans relevé ni preuve de couverture',
  BALANCE_NOT_DERIVED: 'Solde non dérivable du relevé',
  UNIT_NEEDS_REVIEW: 'Relevé de la journée à revoir',
  DAY_NOT_CLOSED: 'Journée non close lors de l’export',
  DAY_CONTESTED: 'Journée disputée par une autre livraison',
  DAY_CONFLICT: 'Journée en conflit entre deux livraisons',
  PARSER_VERSION_UNSUPPORTED: 'Version de lecture du relevé non prise en charge',
  BALANCE_UNKNOWN_AT_DATE: 'Solde inconnu à cette date',
  FORMAT_NOT_QUALIFIED: 'Format bancaire non qualifié',
  FORMAT_PILOT: 'Format bancaire en pilote, non qualifié',
  FORMAT_SUSPENDED: 'Qualification du format suspendue',
  INVENTORY_EMPTY: 'Inventaire des comptes attendus vide',
  INVENTORY_NOT_ATTESTED: 'Inventaire non attesté ou modifié depuis l’attestation',
  REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY: 'Comptes du registre hors inventaire',
  ACCOUNTS_NOT_COVERED: 'Comptes non couverts à D',
  ACCOUNTS_BLOCKED: 'Comptes bloqués',
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? `Motif ${code}`;
}

export const ERROR_MESSAGES: Record<string, string> = {
  TREASURY_RUNTIME_REFUSED: 'La vue « Soldes à date » n’est pas ouverte dans cet environnement.',
  TREASURY_AUTH_REQUIRED: 'Session requise.',
  TREASURY_MODULE_CLOSED: 'Le module « Soldes à date » est fermé sur ce serveur.',
  TREASURY_COMMAND_IN_PROGRESS: 'Cette action est déjà en cours de traitement.',
  'PAYABLES_CAPABILITY_REQUIRED:READ': 'Habilitation de lecture requise.',
  'PAYABLES_CAPABILITY_REQUIRED:BANK_READ': 'Habilitation de lecture bancaire (BANK_READ) requise.',
  PAYABLES_ADMIN_REQUIRED: 'Réservé à l’administrateur unique.',
  TREASURY_AS_OF_REQUIRED: 'Une date comptable D est requise.',
  TREASURY_FUTURE_DATE_FORBIDDEN: 'La date D ne peut pas être postérieure à aujourd’hui.',
  TREASURY_INVENTORY_CHANGED: 'L’inventaire a changé depuis votre lecture : relisez avant d’attester.',
  TREASURY_INVENTORY_EMPTY: 'Aucun compte attendu à attester.',
  TREASURY_REASON_REQUIRED: 'Motif requis (5 à 500 caractères).',
  TREASURY_REGISTRY_ACCOUNT_ALREADY_EXPECTED: 'Ce compte du registre figure déjà dans l’inventaire.',
  TREASURY_REGISTRY_ACCOUNT_EXISTS_LINK_INSTEAD: 'Ce compte existe déjà au registre : rattachez-le au lieu d’en créer un second.',
  TREASURY_EXPECTED_ACCOUNT_DUPLICATE: 'Compte attendu déjà présent.',
  TREASURY_RESPONSE_INVALID: 'La réponse du serveur ne respecte pas le contrat attendu.',
};

export function errorMessage(code: string | null, fallback = 'La lecture a été refusée.'): string {
  return (code && ERROR_MESSAGES[code]) || fallback;
}

/** Code fermé extrait d'une erreur serveur, sans message brut. */
export function treasuryErrorCode(raw: unknown): string | null {
  const message = typeof raw === 'object' && raw !== null && 'message' in raw ? String((raw as { message: unknown }).message) : '';
  const match = /^(TREASURY_[A-Z_]+|PAYABLES_CAPABILITY_REQUIRED:[A-Z_]+|PAYABLES_ADMIN_REQUIRED)$/.exec(message.trim());
  return match ? match[1] : null;
}

/** Texte décimal exact (2 décimales au plus) vers centimes, sans passer par number. */
export function amountTextToMinorUnits(text: string): bigint {
  const match = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TreasuryError('TREASURY_AMOUNT_INVALID', 'Montant invalide.');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  return match[1] === '-' && cents !== 0n ? -cents : cents;
}

export const UNAVAILABLE_LABEL = 'Indisponible';

export function formatAmount(text: string | null | undefined, currency: string): string {
  if (text === null || text === undefined) return UNAVAILABLE_LABEL;
  return formatDailyV2MinorUnits(amountTextToMinorUnits(text), currency);
}

export interface ConsolidationPresentation {
  headline: string;
  amount: string;
  decisionGrade: boolean;
  status: TreasuryConsolidationStatus;
}

export function presentConsolidation(result: TreasuryBalances): ConsolidationPresentation {
  const c = result.consolidation;
  if (c.status === 'COMPLETE') {
    return { headline: `Total à ${result.as_of}`, amount: formatAmount(c.amount, c.currency), decisionGrade: true, status: c.status };
  }
  if (c.status === 'PARTIAL') {
    return {
      headline: `Sous-total partiel à ${result.as_of} — ${c.accounts_available} compte${c.accounts_available > 1 ? 's' : ''} sur ${c.accounts_expected}`,
      amount: formatAmount(c.amount, c.currency),
      decisionGrade: false,
      status: c.status,
    };
  }
  return {
    headline: `Bloqué à ${result.as_of} — sous-total de diagnostic, non utilisable pour décider`,
    amount: formatAmount(c.amount, c.currency),
    decisionGrade: false,
    status: c.status,
  };
}

/**
 * Date couverte = dernière date dont le solde serait rendu disponible ; une date
 * seulement observée (solde dérivé, non validé) est montrée à part.
 */
export function freshnessLabel(account: TreasuryAccount): string {
  const covered = account.dates.bank_date_covered;
  const observed = account.dates.bank_date_observed;
  const age = account.dates.age_days;
  let label = 'Aucune date bancaire couverte';
  if (covered && age === null) label = `Couvert jusqu’au ${covered}`;
  if (covered && age !== null) {
    label = `Couvert jusqu’au ${covered} (${age === 0 ? 'aujourd’hui' : `il y a ${age} jour${age > 1 ? 's' : ''}`})`;
  }
  if (observed && observed !== covered) return `${label} · dernière date observée, non validée : ${observed}`;
  return label;
}

export function valueDateLabel(account: TreasuryAccount, windowDays: number): string {
  const { total_lines: total, lines_with_value_date: withValue } = account.value_dates;
  if (total === 0) return `Aucune ligne sur ${windowDays} jours`;
  return `${withValue} / ${total} lignes avec date de valeur (${windowDays} jours)`;
}

/**
 * Date D proposée par défaut : la veille calendaire à Dakar (paramètre
 * d'exploitation à fixer avant ouverture, D8). L'utilisateur peut la changer.
 */
export function defaultAsOf(now: Date): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
  const [year, month, day] = today.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return previous.toISOString().slice(0, 10);
}

/** Référence courte d'un fichier ou d'une journée importés (identifiant interne, sans donnée bancaire). */
function shortRef(id: string): string {
  return id.slice(0, 8);
}

const LINK_LABELS: Record<Extract<TreasurySource, { kind: 'CHAIN_LINK' }>['link'], string> = {
  OK: 'égale au solde prouvé du',
  CONTINUOUS_GAP: 'égale à la clôture du',
  ANCHOR: 'premier relevé de la chaîne',
  BREAK: 'contredite par le solde prouvé du',
  UNPROVEN: 'continuité non prouvée depuis le',
};

export function sourceLabel(source: TreasurySource): string {
  switch (source.kind) {
    case 'CANONICAL_UNIT':
      return `${source.role === 'CLOSING' ? 'Clôture' : 'Ouverture'} du relevé du ${source.day} (fichier ${shortRef(source.export_id)})`
        + ` — importé le ${source.export_ingested_at ?? 'inconnu'}, journée intégrée le ${source.ingested_at ?? 'inconnu'}`;
    case 'CLOSURE_LATER_LINE':
      return `Clôture prouvée par le fichier ${shortRef(source.export_id)}`
        + ` (${source.delivery === 'duplicate' ? 'relivraison' : 'livraison'}, ligne ultérieure du ${source.later_line_day})`
        + ` — importé le ${source.export_ingested_at}`;
    case 'CLOSURE_NEXT_OPENING':
      return `Clôture confirmée par l’ouverture du ${source.day} (fichier ${shortRef(source.export_id)})`
        + ` — importé le ${source.export_ingested_at}`;
    case 'CHAIN_LINK':
      return `Ouverture du ${source.day} : ${LINK_LABELS[source.link]}${source.reference_day ? ` ${source.reference_day}` : ''}`;
    case 'DECLARED_PERIOD':
      return `Période déclarée ${source.period_start} → ${source.period_end} (close jusqu’au ${source.closed_until},`
        + ` fichier ${shortRef(source.export_id)}) — importée le ${source.export_ingested_at}`;
  }
}
