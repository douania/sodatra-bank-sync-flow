// Vocabulaire fermé des refus serveur. Le message affiché ne reprend jamais le
// texte brut de l'erreur : seul le code PAYABLES_* reconnu est conservé.

const MESSAGES: Record<string, string> = {
  PAYABLES_AUTH_REQUIRED: 'Une session authentifiée est requise.',
  PAYABLES_DOMAIN_READ_ONLY: 'Le module est fermé en écriture sur ce serveur.',
  PAYABLES_CAPABILITY_REQUIRED: 'Votre compte ne détient pas l’habilitation nécessaire.',
  PAYABLES_SECOND_ACTOR_REQUIRED: 'Cette validation doit être faite par une autre personne.',
  PAYABLES_SELF_GRANT_FORBIDDEN: 'Personne ne peut s’attribuer un droit ni valider sa propre inscription.',
  PAYABLES_STALE_VERSION: 'L’élément a été modifié entre-temps : rechargez avant de recommencer.',
  PAYABLES_LOCKED_BY_OTHER: 'Un autre comptable traite cet élément.',
  PAYABLES_IDEMPOTENCY_PAYLOAD_MISMATCH: 'Cette commande a déjà été envoyée avec un contenu différent.',
  PAYABLES_IDEMPOTENCY_INCOMPLETE: 'Une commande identique est encore en cours.',
  PAYABLES_PROPOSAL_ALREADY_PENDING: 'Une proposition est déjà en attente pour cet élément.',
  PAYABLES_PROPOSAL_STATE_INVALID: 'Cette proposition n’est plus en attente.',
  PAYABLES_VALIDITY_OVERLAP: 'La date d’effet doit être postérieure à la dernière version validée.',
  PAYABLES_ADMIN_REQUIRED: 'Seul l’administrateur du module peut faire cette modification.',
  PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN:
    'L’administrateur ne statue ni sur ses propres droits ni sur son propre rattachement.',
  PAYABLES_LEGACY_GOVERNANCE_DISABLED:
    'L’ancienne gouvernance à deux acteurs est désactivée : l’administrateur du module décide.',
  PAYABLES_CAPABILITY_RETIRED: 'Cette capacité de l’ancienne gouvernance est retirée.',
  PAYABLES_CAPABILITY_UNCHANGED: 'Cette habilitation est déjà dans l’état demandé.',
  PAYABLES_CAPABILITY_UNKNOWN: 'Capacité inconnue.',
  PAYABLES_USER_UNKNOWN: 'Compte utilisateur inconnu.',
  PAYABLES_PERSON_DUPLICATE: 'Une personne active porte déjà ce nom.',
  PAYABLES_PERSON_NOT_ACTIVE: 'La personne n’est pas active.',
  PAYABLES_LINK_CONFLICT: 'Ce compte ou cette personne est déjà rattaché.',
  PAYABLES_LINK_STATE_INVALID: 'Ce rattachement n’est pas en vigueur.',
  PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE:
    'Ce compte a préparé un chèque encore en cours : terminez-le ou déclarez-le inutilisé avant de changer son rattachement.',
  PAYABLES_EXPECTED_VERSION_REQUIRED: 'La version attendue du paramètre est requise.',
  PAYABLES_LEGACY_PROPOSAL_OWN: 'Une proposition héritée de l’administrateur lui-même reste en l’état, sans effet.',
  PAYABLES_LEGACY_PROPOSAL_KIND_INVALID: 'Type de proposition inconnu.',
  PAYABLES_SUPPLIER_DUPLICATE: 'Un fournisseur de même nom existe déjà : utilisez-le.',
  PAYABLES_SUPPLIER_MERGED: 'Ce fournisseur a été fusionné : utilisez le fournisseur conservé.',
  PAYABLES_REFERENCE_INVALID: 'La référence doit être saisie exactement, sans espace au début ni à la fin.',
  PAYABLES_CURRENCY_NOT_SUPPORTED: 'Seul le franc CFA (XOF) est pris en charge dans cette version.',
  PAYABLES_AMOUNT_INVALID: 'Le montant doit être un nombre entier positif de francs CFA.',
  PAYABLES_INVOICE_BLOCKED: 'La facture est bloquée par une exception ouverte.',
  PAYABLES_INVOICE_FULLY_ENGAGED: 'La facture est déjà entièrement engagée.',
  PAYABLES_INVOICE_ENGAGED_CHANGE_FORBIDDEN: 'Une facture portant un engagement ne se modifie pas.',
  PAYABLES_AMOUNT_EXCEEDS_REMAINING: 'Le montant dépasse le restant à engager.',
  PAYABLES_AMOUNT_EXCEEDS_CEILING: 'Le montant dépasse le plafond de ce paiement.',
  PAYABLES_PARTIAL_FLAG_REQUIRED: 'Choisissez « paiement partiel » pour un montant inférieur au restant.',
  PAYABLES_CATEGORY_INACTIVE: 'La catégorie de règlement n’est pas active.',
  PAYABLES_ACCOUNT_INVALID: 'Le compte bancaire n’est pas actif.',
  PAYABLES_FORM_ALREADY_USED: 'Ce numéro de formule est déjà enregistré pour ce compte.',
  PAYABLES_FORM_ALREADY_ACTIVE: 'Ce paiement a déjà une formule en cours.',
  PAYABLES_FORM_STATE_INVALID: 'L’état de la formule ne permet pas cette action.',
  PAYABLES_CHEQUE_NUMBER_INVALID: 'Le numéro préimprimé ne doit contenir que des chiffres.',
  PAYABLES_PRINT_PROFILE_NOT_VALIDATED: 'Aucun profil d’impression validé pour cette banque.',
  PAYABLES_PRINT_PROFILE_BANK_NOT_ENABLED: 'Seul le profil ORABANK est ouvert dans cette version.',
  PAYABLES_PRINT_LAYOUT_OVERFLOW: 'Le texte dépasse la zone imprimable de la formule.',
  PAYABLES_PRINT_PROFILE_INVALID: 'Le profil d’impression est incomplet ou incohérent.',
  PAYABLES_CONTENT_VERSION_STALE: 'Le contenu du chèque a changé : rechargez l’aperçu.',
  PAYABLES_RELEASE_FORBIDDEN_FORM_UNCERTAIN:
    'Libération refusée : une formule de ce paiement est imprimée, incertaine, perdue ou détenue.',
  PAYABLES_SIGNATURE_RULE_NOT_MET: 'Les signatures requises ne sont pas réunies.',
  PAYABLES_SIGNATORY_NOT_ADMISSIBLE: 'Un signataire n’est pas admissible à la date de signature ou d’émission.',
  PAYABLES_SIGNATORY_IS_PREPARER: 'Le signataire ne peut pas être le préparateur.',
  PAYABLES_SIGNATURE_VERSION_MISMATCH: 'La signature porte sur une version antérieure du chèque.',
  PAYABLES_SIGNATURE_AFTER_ISSUE: 'Une signature est postérieure à la date d’émission.',
  PAYABLES_SIGNATURE_BEFORE_PRINT: 'La date de signature précède l’impression de cette version du chèque.',
  PAYABLES_PREPARER_NOT_LINKED: 'Le préparateur n’est pas rattaché à une personne vérifiée.',
  PAYABLES_PRESIGNED_FORM_USE_DISABLED: 'L’utilisation d’une formule pré-signée est désactivée.',
  PAYABLES_ISSUE_ALREADY_RECORDED: 'L’émission de ce chèque est déjà enregistrée.',
  PAYABLES_FUTURE_DATE_FORBIDDEN: 'Une date future n’est pas admise.',
  PAYABLES_EVIDENCE_INVALID: 'Un justificatif est requis.',
  PAYABLES_REASON_INVALID: 'Un motif lisible est requis.',
  PAYABLES_REPLACEMENT_EXCEEDS_CEILING: 'Le remplacement dépasse le plafond disponible.',
  PAYABLES_EXIT_STATE_INVALID: 'Seul un chèque émis en circulation peut sortir hors banque.',
  PAYABLES_TAKEOVER_CONTROL_MISMATCH: 'Le nombre ou le total de contrôle ne correspond pas au lot.',
  PAYABLES_TAKEOVER_DUPLICATE_ITEM: 'Le lot contient deux fois le même numéro.',
  PAYABLES_TAKEOVER_ITEM_AFTER_CUTOFF: 'Une ligne du lot est postérieure à la date de reprise.',
  PAYABLES_RESOLUTION_CODE_INVALID: 'Cette décision n’est pas prévue pour ce type d’exception.',
  PAYABLES_AMOUNT_STILL_UNKNOWN: 'Le montant doit d’abord être établi.',
  PAYABLES_MATCH_STATE_INVALID: 'Ce rapprochement n’est plus en attente.',
  PAYABLES_REBIND_EVIDENCE_INVALID: 'La ligne proposée ne prouve pas exactement le même débit.',
  PAYABLES_PERIOD_INVALID: 'La période demandée est invalide.',
  PAYABLES_NOTHING_TO_ALLOCATE: 'Il ne reste rien à engager sur cette facture.',
  PAYABLES_TRANSFER_REFERENCE_DUPLICATE: 'Cette référence bancaire est déjà déclarée pour ce compte.',
  PAYABLES_READ_INCOMPLETE: 'Lecture incomplète (réponse non conforme) : rechargez ; aucun total n’est affiché.',
  PAYABLES_READ_LIMIT_EXCEEDED: 'Volume au-delà de la limite de lecture : aucune liste ni aucun total n’est affiché.',
  PAYABLES_READ_LIST_UNKNOWN: 'Lecture non prévue par le module.',
};

export class PayablesError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PayablesError';
  }
}

export function payablesErrorCode(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw
    : raw && typeof raw === 'object' && 'message' in raw ? String((raw as { message?: unknown }).message ?? '')
    : '';
  return /PAYABLES_[A-Z0-9_]+/.exec(text)?.[0] ?? null;
}

/** Message affichable : vocabulaire fermé, jamais le texte serveur brut. */
export function payablesErrorMessage(code: string | null, fallback = 'L’opération a été refusée.'): string {
  if (!code) return fallback;
  return MESSAGES[code] ?? `${fallback} (${code})`;
}

export function toPayablesError(raw: unknown, fallback?: string): PayablesError {
  const code = payablesErrorCode(raw);
  return new PayablesError(code ?? 'PAYABLES_UNKNOWN', payablesErrorMessage(code, fallback));
}
