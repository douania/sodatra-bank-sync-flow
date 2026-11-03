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
const count = z.number().int().min(0);
// Totaux « débits/crédits » d'une version, en texte décimal exact.
const totalsText = z.string().regex(/^-?\d{1,16}(\.\d{1,2})?\/-?\d{1,16}(\.\d{1,2})?$/);

// Constats de versions et d'écartements (Lot 1 opérationnel). Les quatre
// premiers figurent aussi parmi les sources d'un solde rendu.
const rejectedDeliverySchema = z.object({ kind: z.literal('REJECTED_DELIVERY'), day: isoDate, count });
const refutedVersionSchema = z.object({
  kind: z.literal('REFUTED_VERSION'),
  day: isoDate,
  nature: z.enum(['FRESH_DELIVERY', 'BANK_PIECE']),
  automatic: z.boolean(),
  proof_day: isoDate.nullable(),
  sources: count,
  covered_deliveries: count,
  covered_redeposits: count,
  movements_unresolved: z.boolean(),
  mention: z.string().nullable(),
});
const breakdownDivergenceSchema = z.object({
  kind: z.literal('VERSION_BREAKDOWN_DIVERGENCE'),
  day: isoDate,
  count,
  retained_totals: totalsText.nullable(),
  other_totals: totalsText.nullable(),
  movements_unresolved: z.literal(true),
});
const detailDivergenceSchema = z.object({
  kind: z.literal('VERSION_DETAIL_DIVERGENCE'), day: isoDate, count, movements_unresolved: z.literal(true),
});
const findingSchema = z.union([
  rejectedDeliverySchema,
  refutedVersionSchema,
  breakdownDivergenceSchema,
  detailDivergenceSchema,
  z.object({ kind: z.literal('VERSION_CONTRADICTION'), day: isoDate, uncovered_sources: count }),
  z.object({
    kind: z.literal('VERSION_BALANCE_NOT_COMPARABLE'),
    day: isoDate,
    cause: z.enum(['AGGREGATES_UNAVAILABLE', 'VERSION_FACTS_INCOHERENT']),
    side: z.enum(['RETAINED', 'OTHER', 'BOTH']),
    uncovered_sources: count,
  }),
  z.object({ kind: z.literal('VERSION_REFUTATION_SUSPENDED'), day: isoDate }),
]);

// Point de départ vérifié d'un compte, état pour la date lue.
const verifiedStartSchema = z.object({
  verified_start_id: z.string().uuid(),
  day: isoDate,
  posed_at: dateTime,
  evidence_ref: z.string(),
  state: z.enum(['ACTIVE', 'REVOKED']),
  for_date: z.enum(['EFFECTIVE', 'SUSPENDED', 'NOT_YET_APPLICABLE', 'REVOKED']),
  suspension: z.string().nullable(),
  applied: z.boolean(),
  history_before: z.object({
    unproven_days: count,
    pending_days: count,
    conflict_days: count,
    rejected_deliveries: count,
  }),
});

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
    content_hash: z.string().min(1).max(256).nullable(),
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
    link: z.enum(['OK', 'CONTINUOUS_GAP', 'ANCHOR', 'BREAK', 'UNPROVEN', 'VERIFIED_START']),
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
  z.object({
    kind: z.literal('VERIFIED_START'),
    day: isoDate,
    posed_at: dateTime,
    evidence_ref: z.string(),
  }),
  rejectedDeliverySchema,
  refutedVersionSchema,
  breakdownDivergenceSchema,
  detailDivergenceSchema,
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
  verified_starts: z.array(verifiedStartSchema),
  retained_unit_at_date: z.object({ unit_id: z.string().uuid(), content_hash: z.string().min(1).max(256) }).nullable(),
  findings: z.array(findingSchema),
  counters: z.object({ rejected_deliveries: count, refuted_versions: count }),
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
export type TreasuryFinding = z.infer<typeof findingSchema>;
export type TreasuryVerifiedStart = z.infer<typeof verifiedStartSchema>;

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
  DAY_PENDING_VALIDATION: 'Journée livrée, en attente de validation',
  UNIT_FINANCIAL_FACTS_INCOHERENT: 'Faits financiers du relevé incohérents (ouverture, mouvements, clôture)',
  VERSION_BALANCE_NOT_COMPARABLE: 'Soldes de deux livraisons non comparables (données insuffisantes)',
  VERIFIED_START_SUSPENDED: 'Point de départ vérifié suspendu',
  VERSION_REFUTATION_SUSPENDED: 'Réfutation d’une version suspendue',
  ACCOUNT_IDENTITY_NOT_CORROBORATED: 'Identité du compte non corroborée par le fichier',
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
  TREASURY_TEXT_SENSITIVE: 'Le texte ressemble à un numéro de compte, un IBAN ou une adresse : retirez-le.',
  TREASURY_EVIDENCE_REQUIRED: 'Référence de preuve requise (1 à 200 caractères).',
  TREASURY_OPENING_NOT_WHOLE_XOF: 'Ouverture lue sur pièce à saisir en francs XOF entiers.',
  TREASURY_RETAINED_OPENING_NOT_WHOLE_XOF: 'L’ouverture retenue de cette journée n’est pas en francs XOF entiers.',
  TREASURY_OPENING_MISMATCH: 'L’ouverture saisie ne correspond pas à celle de la journée retenue.',
  TREASURY_EXPECTED_ACCOUNT_UNKNOWN: 'Compte absent de l’inventaire actif.',
  TREASURY_VERIFIED_START_STALE: 'La journée a changé depuis votre lecture : relisez avant de poser le point.',
  TREASURY_VERIFIED_START_ALREADY_ACTIVE: 'Un point de départ est déjà actif pour ce compte et cette journée.',
  TREASURY_VERIFIED_START_NOT_EFFECTIVE: 'Le point ne serait pas effectif pour sa journée : rien n’a été enregistré.',
  TREASURY_VERIFIED_START_UNKNOWN: 'Point de départ inconnu.',
  TREASURY_VERIFIED_START_ALREADY_REVOKED: 'Point de départ déjà révoqué.',
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
  VERIFIED_START: 'point de départ vérifié sur pièce',
};

export const PIECE_MENTION = 'attestation sur pièce archivée, contenu non vérifié automatiquement';

// Accord explicite : les adjectifs s'accordent, les compléments restent invariables.
function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

function totalsLabel(text: string | null): string {
  if (text === null) return 'indisponibles';
  const [debits, credits] = text.split('/');
  return `débits ${debits}, crédits ${credits}`;
}

const SIDE_LABELS: Record<'RETAINED' | 'OTHER' | 'BOTH', string> = {
  RETAINED: 'version retenue',
  OTHER: 'autre livraison',
  BOTH: 'les deux versions',
};

/** Libellé d'un constat de version ou d'écartement, sans donnée bancaire. */
export function findingLabel(finding: TreasuryFinding): string {
  switch (finding.kind) {
    case 'REJECTED_DELIVERY':
      return `${plural(finding.count, 'livraison écartée', 'livraisons écartées')} le ${finding.day} (sans effet sur le solde retenu)`;
    case 'REFUTED_VERSION': {
      const proof = finding.nature === 'BANK_PIECE'
        ? `pièce corrective émise le ${finding.proof_day ?? 'inconnu'} — ${finding.mention ?? PIECE_MENTION}`
        : `livraison fraîche${finding.proof_day ? ` (journée ${finding.proof_day})` : ''}`;
      return `Version réfutée le ${finding.day}${finding.automatic ? ' automatiquement' : ''} : ${proof} ;`
        + ` ${plural(finding.sources, 'source justifiée', 'sources justifiées')}, ${plural(finding.covered_deliveries, 'livraison couverte', 'livraisons couvertes')}`
        + `, ${plural(finding.covered_redeposits, 'redépôt identique', 'redépôts identiques')}`
        + (finding.movements_unresolved ? ' ; mouvements non résolus (seuls les soldes sont prouvés)' : '');
    }
    case 'VERSION_BREAKDOWN_DIVERGENCE':
      return `Ventilation différente le ${finding.day} (${plural(finding.count, 'livraison', 'livraisons')}) : version retenue`
        + ` ${totalsLabel(finding.retained_totals)} ; autre version ${totalsLabel(finding.other_totals)} — mouvements non résolus`;
    case 'VERSION_DETAIL_DIVERGENCE':
      return `Détail des mouvements différent le ${finding.day} (${plural(finding.count, 'livraison', 'livraisons')}), mêmes soldes`
        + ' — mouvements non résolus';
    case 'VERSION_CONTRADICTION':
      return `Contradiction démontrée le ${finding.day} : ${plural(finding.uncovered_sources, 'source non couverte', 'sources non couvertes')}`
        + ' par une réfutation';
    case 'VERSION_BALANCE_NOT_COMPARABLE':
      return `Soldes non comparables le ${finding.day} (${finding.cause === 'AGGREGATES_UNAVAILABLE'
        ? 'agrégats indisponibles' : 'faits financiers incohérents'}, ${SIDE_LABELS[finding.side]}) :`
        + ` ${plural(finding.uncovered_sources, 'source non couverte', 'sources non couvertes')}`;
    case 'VERSION_REFUTATION_SUSPENDED':
      return `Réfutation du ${finding.day} suspendue : une nouvelle source rouvre la question, une nouvelle preuve est nécessaire`;
  }
}

const VERIFIED_START_STATE_LABELS: Record<TreasuryVerifiedStart['for_date'], string> = {
  EFFECTIVE: 'effectif à D',
  SUSPENDED: 'suspendu à D',
  NOT_YET_APPLICABLE: 'postérieur à D',
  REVOKED: 'révoqué',
};

export const SUSPENSION_LABELS: Record<string, string> = {
  ACCOUNT_INACTIVE: 'compte du registre désactivé',
  UNIT_CHANGED: 'journée retenue modifiée depuis la pose',
  OPENING_CHANGED: 'ouverture retenue modifiée depuis la pose',
  CONTRADICTION_AT_HORIZON: 'contradiction datée au plus tard à l’horizon de D',
};

function suspensionLabel(code: string): string {
  if (SUSPENSION_LABELS[code]) return SUSPENSION_LABELS[code];
  if (code.startsWith('DAY_')) return `journée non prouvée (${code.slice(4)})`;
  return `motif ${code}`;
}

/** Point de départ vérifié : journée, période d'application, état et lacunes antérieures. */
export function verifiedStartLabel(point: TreasuryVerifiedStart): string {
  const suspension = point.suspension === null ? '' : ` (${suspensionLabel(point.suspension)})`;
  const h = point.history_before;
  return `Point de départ du ${point.day}, applicable à partir de cette journée : ${VERIFIED_START_STATE_LABELS[point.for_date]}`
    + `${suspension}${point.applied ? ', appliqué à D' : ''}. Avant ce point : ${plural(h.unproven_days, 'journée non prouvée', 'journées non prouvées')},`
    + ` ${plural(h.pending_days, 'journée en attente ou disputée', 'journées en attente ou disputées')}, ${plural(h.conflict_days, 'journée en conflit', 'journées en conflit')},`
    + ` ${plural(h.rejected_deliveries, 'livraison écartée', 'livraisons écartées')} (non couvertes par le point).`;
}

const FINDING_KINDS: ReadonlySet<string> = new Set([
  'REJECTED_DELIVERY', 'REFUTED_VERSION', 'VERSION_BREAKDOWN_DIVERGENCE', 'VERSION_DETAIL_DIVERGENCE',
]);

/** Journée retenue affichée par la lecture : liaison d'un point de départ, revérifiée sous verrou. */
export interface RetainedDayUnit {
  canonicalUnitId: string;
  contentHash: string;
}

/**
 * Unité retenue de la journée D elle-même, telle que la lecture l'affiche, même
 * sans solde à D (journée non close) ; sinon aucune pose possible.
 */
export function retainedUnitAtDate(account: TreasuryAccount): RetainedDayUnit | null {
  const unit = account.retained_unit_at_date;
  if (unit === null) return null;
  return { canonicalUnitId: unit.unit_id, contentHash: unit.content_hash };
}

/** Ouverture lue sur pièce : francs XOF entiers, sans séparateur ni décimale. */
export function isWholeXofText(text: string): boolean {
  return /^-?\d{1,16}$/.test(text.trim());
}

/** Preuves du solde ; les constats de versions, aussi rendus parmi les sources, sont listés à part. */
export function proofSources(account: TreasuryAccount): TreasurySource[] {
  return account.sources.filter((source) => !FINDING_KINDS.has(source.kind));
}

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
    case 'VERIFIED_START':
      return `Point de départ vérifié du ${source.day} (pièce ${source.evidence_ref}) — posé le ${source.posed_at}`;
    case 'REJECTED_DELIVERY':
    case 'REFUTED_VERSION':
    case 'VERSION_BREAKDOWN_DIVERGENCE':
    case 'VERSION_DETAIL_DIVERGENCE':
      return findingLabel(source);
  }
}
