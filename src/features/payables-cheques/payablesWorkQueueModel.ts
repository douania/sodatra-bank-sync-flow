// File de travail partagée : ce qui attend une action, qui s'en occupe, depuis quand.

export interface WorkQueueRow {
  item_type: string;
  object_id: string;
  related_id: string | null;
  since: string;
  lock_holder: string | null;
  lock_expires_at: string | null;
}

export const WORK_ITEM_LABELS: Record<string, string> = {
  PAYMENT_TO_PRINT: 'Demande de paiement à préparer et imprimer',
  PRINT_OUTCOME_PENDING: 'Résultat d’impression à confirmer',
  AWAITING_SIGNATURE_OR_CONFIRMATION: 'Chèque imprimé : signature puis confirmation d’émission',
  ISSUED_NOT_DELIVERED: 'Chèque émis non remis',
  EXIT_TO_VALIDATE: 'Annulation, remplacement ou correction à valider',
  TAKEOVER_TO_APPROVE: 'Lot de reprise à approuver',
  EXCEPTION_OPEN: 'Exception à instruire',
  BANK_MATCH_TO_DECIDE: 'Rapprochement bancaire à confirmer',
  SUPPLIER_MERGE_TO_VALIDATE: 'Fusion de fournisseurs à valider',
  PARAMETER_TO_VALIDATE: 'Paramètre à valider',
  CAPABILITY_TO_VALIDATE: 'Habilitation à valider',
  PERSON_TO_VALIDATE: 'Personne à valider',
  PERSON_LINK_TO_VALIDATE: 'Rattachement de compte à valider',
};

export interface WorkQueueItem extends WorkQueueRow {
  label: string;
  ageDays: number;
  lockedByOther: boolean;
  lockedByMe: boolean;
}

export function buildWorkQueue(rows: WorkQueueRow[], currentUserId: string | null, now: Date): WorkQueueItem[] {
  return rows
    .map((row) => {
      const active = row.lock_holder !== null && row.lock_expires_at !== null && Date.parse(row.lock_expires_at) > now.getTime();
      return {
        ...row,
        label: WORK_ITEM_LABELS[row.item_type] ?? row.item_type,
        ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(row.since)) / 86_400_000)),
        lockedByOther: active && row.lock_holder !== currentUserId,
        lockedByMe: active && row.lock_holder === currentUserId,
      };
    })
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}
