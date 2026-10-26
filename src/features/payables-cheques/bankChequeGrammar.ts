// Grammaires fermées et versionnées des débits de chèques par banque — miroir
// exact de payables_private.extract_cheque_reference (corpus de parité commun
// dans supabase/tests/payables_cheques_core/60_bank_followup_position.sql).
//
// Arbitrage CTO du 25 octobre 2026 : la référence dérivée d'un libellé ne vaut
// qu'une PROPOSITION de rapprochement, confirmée par un comptable habilité.
// Aucune suppression de zéros, aucune conversion numérique.

export type ChequeReferenceOutcome =
  | 'REFERENCE'
  | 'NO_REFERENCE'
  | 'AMBIGUOUS'
  | 'EXCLUDED_FEE'
  | 'EXCLUDED_WITHDRAWAL'
  | 'UNKNOWN_FORM'
  | 'NOT_CHEQUE'
  | 'BANK_NOT_QUALIFIED';

export interface ChequeReferenceExtraction {
  grammarVersion: string;
  family: string | null;
  outcome: ChequeReferenceOutcome;
  referenceText: string | null;
}

export const QUALIFIED_CHEQUE_BANKS = ['BDK', 'ORA', 'ATB', 'BICIS'] as const;

export function chequeGrammarVersion(bank: string | null | undefined): string {
  return bank && (QUALIFIED_CHEQUE_BANKS as readonly string[]).includes(bank)
    ? `PCG-${bank}-V1`
    : `PCG-${bank ?? 'UNKNOWN'}-NOT-QUALIFIED`;
}

const FEE = /(^| )(FRAIS|COMMISSION|COMMISSIONS|COM|TVA|TAF|AGIOS)( |$)/;
const WITHDRAWAL = /^RETRAIT( |$)/;
const CHEQUE_WORD = /(^| )(CHQ|CHEQUE|CHEQ|CHÈQUE)( |$)/;

interface Family {
  bank: string;
  family: string;
  prefix: RegExp;
  full: RegExp;
  repeated?: boolean;
}

const FAMILIES: readonly Family[] = [
  {
    bank: 'BDK',
    family: 'BDK_CHEQUE_RECU_COMPENSE',
    prefix: /^CHEQUE RECU COMPENSE( |$)/,
    full: /^CHEQUE RECU COMPENSE CHQ N ([0-9]{7})( |$)/,
  },
  {
    bank: 'ORA',
    family: 'ORA_CHQ_RECU_COMPENSE',
    prefix: /^CHQ RECU COMPENSE( |$)/,
    full: /^CHQ RECU COMPENSE ([0-9]{7}) CHQ OCI N\. ([0-9]{7})$/,
    repeated: true,
  },
  {
    bank: 'ATB',
    family: 'ATB_REGLMT_CHEQUE_COMPENSE',
    prefix: /^REGLMT CHEQUE COMPENSE( |$)/,
    full: /^REGLMT CHEQUE COMPENSE CHEQUE REF ([0-9]{7})$/,
  },
  {
    bank: 'BICIS',
    family: 'BICIS_REGLMT_CHQ_COMPENSE',
    prefix: /^REGLMT CHQ COMPENSE( |$)/,
    full: /^REGLMT CHQ COMPENSE NO ([0-9]{7}) FAVEUR( |$)/,
  },
];

export function extractChequeReference(bank: string | null | undefined, label: string | null | undefined): ChequeReferenceExtraction {
  const grammarVersion = chequeGrammarVersion(bank);
  // Blancs ASCII explicites seulement (miroir de la classe SQL) : une espace
  // insécable n'est jamais assimilée à un séparateur.
  const normalized = (label ?? '').toUpperCase().replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ +| +$/g, '');
  const result = (outcome: ChequeReferenceOutcome, family: string | null = null, referenceText: string | null = null) => ({
    grammarVersion,
    family,
    outcome,
    referenceText,
  });
  if (!bank || !(QUALIFIED_CHEQUE_BANKS as readonly string[]).includes(bank)) return result('BANK_NOT_QUALIFIED');
  if (FEE.test(normalized)) return result('EXCLUDED_FEE');
  if (WITHDRAWAL.test(normalized)) return result('EXCLUDED_WITHDRAWAL');
  const family = FAMILIES.find((f) => f.bank === bank && f.prefix.test(normalized));
  if (!family) return result(CHEQUE_WORD.test(normalized) ? 'UNKNOWN_FORM' : 'NOT_CHEQUE');
  const match = family.full.exec(normalized);
  if (!match) return result('NO_REFERENCE', family.family);
  if (family.repeated && match[1] !== match[2]) return result('AMBIGUOUS', family.family);
  return result('REFERENCE', family.family, match[1]);
}
