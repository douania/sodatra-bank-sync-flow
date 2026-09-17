/**
 * Résumé fermé des erreurs d'extraction destiné à l'interface (Pack 2, FIX_4 / FIX_5).
 *
 * Quel que soit l'extracteur (grille, texte PDF, legacy, Collection Report,
 * Internal Book, persistance, exception générale), aucun message brut ne
 * franchit la frontière du pipeline `/upload` : chaque message est réduit à un
 * rang de ligne éventuel et à un motif d'un vocabulaire fermé. Tout reste
 * (ligne brute, nom de fichier, feuille, banque de détail, client, chèque,
 * date, montant, message Supabase) est écarté.
 */

export type ExtractionErrorReason =
  | 'identité bancaire non corroborée'
  | 'structure de document ambiguë'
  | 'en-têtes obligatoires absents'
  | 'limite de lignes dépassée'
  | 'traçabilité Excel manquante'
  | 'date de rapport obligatoire invalide'
  | 'code client obligatoire absent'
  | 'banque obligatoire absente'
  | 'montant obligatoire invalide'
  | 'date invalide ou non corroborée'
  | 'solde d’ouverture invalide'
  | 'solde de clôture invalide'
  | 'cellule d’erreur Excel'
  | 'grand total Fund Position invalide'
  | 'détail Fund Position invalide'
  | 'bloc HOLD invalide'
  | 'section ou ligne non exploitable'
  | 'montant invalide ou absent'
  | 'sélection de feuille requise'
  | 'document non pris en charge'
  | 'réseau ou délai dépassé'
  | 'persistance refusée'
  | 'contrat d’extraction refusé';

function normalize(message: string): string {
  return message.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function classifyExtractionMessage(message: string): ExtractionErrorReason {
  const n = normalize(message);
  if (n.includes('ERREUR EXCEL')) return 'cellule d’erreur Excel';
  // Collection Report (mapper et service Excel) : motifs fermés, avant les
  // règles génériques sur FEUILLE / DATE / LIGNE / MONTANT.
  if (n.includes('HEADERS OBLIGATOIRES') || n.includes('FEUILLE DE DONNEES') || n.includes('AUCUNE FEUILLE') || n.includes('EN-TETE ET UNE LIGNE')) {
    return 'en-têtes obligatoires absents';
  }
  if (n.includes('DEPASSE LA LIMITE')) return 'limite de lignes dépassée';
  if (n.includes('TRACABILITE')) return 'traçabilité Excel manquante';
  if (n.includes('REPORTDATE')) return 'date de rapport obligatoire invalide';
  if (n.includes('CLIENTCODE')) return 'code client obligatoire absent';
  if (n.includes('BANKNAME')) return 'banque obligatoire absente';
  if (n.includes('COLLECTIONAMOUNT')) return 'montant obligatoire invalide';
  // Persistance et réseau (Supabase, retry) : jamais le message serveur.
  if (n.includes('TIMEOUT') || n.includes('NETWORK') || n.includes('CONNECTION') || n.includes('ECONNRESET') || n.includes('ETIMEDOUT') || n.includes('FETCH FAILED') || n.includes('CONNEXION') || n.includes('RESEAU')) {
    return 'réseau ou délai dépassé';
  }
  if (n.includes('SAUVEGARDE') || n.includes('PERSIST') || n.includes('ROW-LEVEL') || n.includes('RLS') || n.includes('PERMISSION') || n.includes('DUPLICATE') || n.includes('UNIQUE') || n.includes('SUPABASE') || n.includes('RPC')) {
    return 'persistance refusée';
  }
  if (n.includes('NOT AN INTERNAL BOOK') || n.includes('UNSUPPORTED') || n.includes('NON SUPPORTE') || n.includes('NON PRIS EN CHARGE') || n.includes('REQUIRES REVIEW')) {
    return 'document non pris en charge';
  }
  if (n.includes('FEUILLE')) return 'sélection de feuille requise';
  if (n.includes('IDENTITE BANCAIRE') || n.includes('BANQUE ABSENTE') || n.includes('BANQUE AMBIGUE') || n.includes('BANQUE INCOHERENTE')) {
    return 'identité bancaire non corroborée';
  }
  if (n.includes('STRUCTURE DE LIGNES') || n.includes('TITRE DE SECTION') || n.includes('EN-TETE DE COLONNES')) {
    return 'structure de document ambiguë';
  }
  if (n.includes('DATE')) return 'date invalide ou non corroborée';
  if (n.includes("SOLDE D'OUVERTURE") || n.includes('SOLDE D’OUVERTURE')) return 'solde d’ouverture invalide';
  if (n.includes('SOLDE DE CLOTURE')) return 'solde de clôture invalide';
  if (n.includes('GRAND TOTAL') || n.includes('TOTAL FUND AVAILABLE') || n.includes('FONDS DISPONIBLES') || n.includes('GRAND BALANCE')) {
    return 'grand total Fund Position invalide';
  }
  if (n.includes('HOLD')) return 'bloc HOLD invalide';
  if (n.includes('FUND POSITION') || n.includes('DETAIL BANCAIRE') || n.includes('COLLECTION')) return 'détail Fund Position invalide';
  if (n.includes('MONTANT') || n.includes('FINANCI') || n.includes('BLOC ')) return 'montant invalide ou absent';
  if (n.includes('SECTION') || n.includes('LIGNE') || n.includes('FACILIT') || n.includes('IMPAYE') || n.includes('LIBELLE')) {
    return 'section ou ligne non exploitable';
  }
  return 'contrat d’extraction refusé';
}

/** Rang de ligne porté par un message (« Ligne 12 … », « (ligne 12) », « n°12 », « row=12 »), sinon absent. */
export function extractLineReference(message: string): number | null {
  const match = message.match(/(?:\bLigne\b[^\d]{0,20}?|\(ligne\s+|\brow=)(\d{1,6})/i);
  return match ? Number(match[1]) : null;
}

/**
 * Résumé fermé : liste dédoublonnée « ligne N : motif » ou « motif », dans
 * l'ordre d'apparition. Jamais le texte du message d'origine.
 */
export function summarizeExtractionErrors(messages: readonly string[] | undefined): string {
  const items: string[] = [];
  for (const message of messages ?? []) {
    const reason = classifyExtractionMessage(message);
    const line = extractLineReference(message);
    const item = line === null ? reason : `ligne ${line} : ${reason}`;
    if (!items.includes(item)) items.push(item);
  }
  return items.length > 0 ? items.join(' ; ') : 'contrat d’extraction refusé';
}
