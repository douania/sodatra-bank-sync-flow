import type { PrintIntentResult, PrintOutcome } from './payablesChequesTypes';

// Cycle d'impression côté interface. L'événement navigateur `afterprint` ne vaut
// JAMAIS preuve de réussite : il ouvre seulement la demande de confirmation au
// comptable. Seul un résultat choisi explicitement est envoyé au serveur.

export type PrintFlowState =
  | { step: 'idle' }
  | { step: 'intent_recorded'; intent: PrintIntentResult }
  | { step: 'printing'; intent: PrintIntentResult }
  | { step: 'awaiting_confirmation'; intent: PrintIntentResult }
  | { step: 'confirmed'; outcome: PrintOutcome };

export type PrintFlowEvent =
  | { type: 'INTENT_RECORDED'; intent: PrintIntentResult }
  | { type: 'PRINT_STARTED' }
  | { type: 'AFTERPRINT' }
  | { type: 'DIALOG_CLOSED_BY_USER' }
  | { type: 'OUTCOME_RECORDED'; outcome: PrintOutcome }
  | { type: 'RESET' };

export const INITIAL_PRINT_FLOW: PrintFlowState = { step: 'idle' };

export function printFlowReducer(state: PrintFlowState, event: PrintFlowEvent): PrintFlowState {
  switch (event.type) {
    case 'INTENT_RECORDED':
      return state.step === 'idle' ? { step: 'intent_recorded', intent: event.intent } : state;
    case 'PRINT_STARTED':
      return state.step === 'intent_recorded' ? { step: 'printing', intent: state.intent } : state;
    case 'AFTERPRINT':
    case 'DIALOG_CLOSED_BY_USER':
      // Fin de la boîte de dialogue : on demande au comptable ce qui s'est passé.
      return state.step === 'printing' ? { step: 'awaiting_confirmation', intent: state.intent } : state;
    case 'OUTCOME_RECORDED':
      return state.step === 'awaiting_confirmation' ? { step: 'confirmed', outcome: event.outcome } : state;
    case 'RESET':
      return INITIAL_PRINT_FLOW;
    default:
      return state;
  }
}

/** Le résultat ne peut être demandé au serveur qu'après la fin de la boîte d'impression. */
export function canDeclarePrintOutcome(state: PrintFlowState): state is Extract<PrintFlowState, { step: 'awaiting_confirmation' }> {
  return state.step === 'awaiting_confirmation';
}

export const PRINT_OUTCOME_LABELS: Record<PrintOutcome, string> = {
  PRINTED: 'Imprimé correctement sur la formule',
  NOT_PRINTED: 'Rien n’a été imprimé, la formule est intacte',
  SPOILED: 'Formule gâchée (à enregistrer inutilisée)',
  UNCERTAIN: 'Résultat incertain (formule à retrouver)',
};

export interface TakeoverItem {
  cheque_number: string;
  beneficiary: string;
  amount: number;
  issue_date: string;
}

/**
 * Lignes « numéro;bénéficiaire;montant;AAAA-MM-JJ ». Le numéro reste un texte
 * (zéros conservés) ; le montant doit être un entier positif ; aucune ligne
 * n'est corrigée silencieusement.
 */
export function parseTakeoverLines(text: string): { items: TakeoverItem[]; errors: string[] } {
  const items: TakeoverItem[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(';').map((part) => part.trim());
    const lineNo = index + 1;
    if (parts.length !== 4) {
      errors.push(`Ligne ${lineNo} : quatre champs attendus.`);
      return;
    }
    const [number, beneficiary, amountText, date] = parts;
    if (!/^[0-9]{1,16}$/.test(number)) errors.push(`Ligne ${lineNo} : numéro de chèque invalide.`);
    if (beneficiary.length < 2 || beneficiary.length > 120) errors.push(`Ligne ${lineNo} : bénéficiaire invalide.`);
    if (!/^[1-9][0-9]{0,11}$/.test(amountText)) errors.push(`Ligne ${lineNo} : montant entier positif attendu.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.push(`Ligne ${lineNo} : date AAAA-MM-JJ attendue.`);
    }
    items.push({ cheque_number: number, beneficiary, amount: Number(amountText), issue_date: date });
  });
  return { items, errors };
}
