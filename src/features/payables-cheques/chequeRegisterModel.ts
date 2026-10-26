// Registre des chèques : TOUTES les formules connues, qu'elles viennent du
// circuit (paiement), de la reprise initiale ou d'une émission déclarée en
// exception sans paiement rattaché. Chaque entrée est consultable seule ; le
// numéro reste un texte (zéros conservés).

import type { ChequeFormRow, DeliveryRow, ExitRow, IssuanceRow } from './payablesChequesTypes';

export type RegisterFilter = 'ALL' | 'CIRCULATION' | 'WITHOUT_PAYMENT';

export const REGISTER_FILTER_LABELS: Record<RegisterFilter, string> = {
  CIRCULATION: 'En circulation',
  WITHOUT_PAYMENT: 'Sans paiement rattaché (reprise, exception)',
  ALL: 'Tout le registre',
};

export const PROVENANCE_LABELS: Record<ChequeFormRow['provenance'], string> = {
  NATIVE: 'Circuit',
  TAKEOVER: 'Reprise initiale',
  EXCEPTION: 'Déclaré en exception',
  PRESIGNED_INVENTORY: 'Pré-signée (inventaire)',
};

export interface RegisterEntry {
  form: ChequeFormRow;
  /** Dernière révision de l'émission (date réelle, montant ; NULL si inconnu). */
  issuance: IssuanceRow | null;
  issuanceRevisions: IssuanceRow[];
  delivery: DeliveryRow | null;
  exits: ExitRow[];
  hasPayment: boolean;
  inCirculation: boolean;
}

export function buildChequeRegister(
  forms: ChequeFormRow[], issuances: IssuanceRow[], deliveries: DeliveryRow[], exits: ExitRow[], filter: RegisterFilter,
): RegisterEntry[] {
  return forms
    .map((form) => {
      const revisions = issuances.filter((i) => i.form_id === form.id).sort((a, b) => b.revision_no - a.revision_no);
      return {
        form,
        issuance: revisions[0] ?? null,
        issuanceRevisions: revisions,
        delivery: deliveries.find((d) => d.form_id === form.id) ?? null,
        exits: exits.filter((e) => e.form_id === form.id),
        hasPayment: form.payment_id !== null,
        inCirculation: form.state === 'ISSUED',
      };
    })
    .filter((entry) => filter === 'ALL'
      || (filter === 'CIRCULATION' && entry.inCirculation)
      || (filter === 'WITHOUT_PAYMENT' && !entry.hasPayment))
    .sort((a, b) => a.form.bank_account_id.localeCompare(b.form.bank_account_id)
      || a.form.cheque_number.localeCompare(b.form.cheque_number));
}

/** Sorties hors banque proposables : remplacement seulement avec un paiement à reporter. */
export function allowedExitKinds(entry: RegisterEntry): Array<'CANCELLATION' | 'REPLACEMENT' | 'CORRECTION'> {
  if (!entry.inCirculation) return [];
  return entry.hasPayment ? ['CANCELLATION', 'REPLACEMENT', 'CORRECTION'] : ['CANCELLATION', 'CORRECTION'];
}
