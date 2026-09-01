import { supabase } from '@/integrations/supabase/client';
import type { CollectionReport } from '@/types/banking';
import type { SyncResultData } from '@/types/processing';
import {
  COLLECTION_IMPORT_MAX_FILES,
  COLLECTION_IMPORT_MAX_ROWS,
} from './collectionImportLimits';
import { createCollectionImportCommandKey } from './collectionImportCommandKey';

interface AtomicCollectionImportResult {
  command_key: string;
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  divergent_rows: number;
  audit_rows: number;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`Collection Report : champ obligatoire invalide (${field}).`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength = 2000): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Collection Report : champ texte invalide (${field}).`);
  }
  return value.trim() || null;
}

function requiredPositiveAmount(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value <= 0
    || Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('Collection Report : montant obligatoire invalide ou non positif.');
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`Collection Report : montant ou taux invalide (${field}).`);
  }
  return value;
}

function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Collection Report : date ISO invalide (${field}).`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`Collection Report : date calendaire invalide (${field}).`);
  }
  return text;
}

function optionalIsoDate(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  return requiredIsoDate(value, field);
}

export function buildAtomicCollectionRows(collections: readonly CollectionReport[]) {
  if (collections.length < 1 || collections.length > COLLECTION_IMPORT_MAX_ROWS) {
    throw new Error(
      `Collection Report : une promotion doit contenir entre 1 et ${COLLECTION_IMPORT_MAX_ROWS} lignes.`,
    );
  }

  const traceKeys = new Set<string>();
  const filenames = new Set<string>();

  return collections.map((collection, index) => {
    const excelFilename = requiredText(collection.excelFilename, `rows[${index}].excel_filename`, 255);
    const excelSourceRow = collection.excelSourceRow;
    if (!Number.isSafeInteger(excelSourceRow) || (excelSourceRow as number) <= 1) {
      throw new Error(`Collection Report : ligne source Excel invalide (rows[${index}]).`);
    }
    const traceKey = `${excelFilename}\u0000${excelSourceRow}`;
    if (traceKeys.has(traceKey)) {
      throw new Error('Collection Report : traçabilité Excel dupliquée dans la sélection.');
    }
    traceKeys.add(traceKey);
    filenames.add(excelFilename);
    if (filenames.size > COLLECTION_IMPORT_MAX_FILES) {
      throw new Error(
        `Collection Report : maximum ${COLLECTION_IMPORT_MAX_FILES} fichiers par promotion.`,
      );
    }

    return {
      report_date: requiredIsoDate(collection.reportDate, `rows[${index}].report_date`),
      client_code: requiredText(collection.clientCode, `rows[${index}].client_code`, 500),
      collection_amount: requiredPositiveAmount(collection.collectionAmount),
      bank_name: requiredText(collection.bankName, `rows[${index}].bank_name`, 200),
      status: collection.status ?? 'pending',
      collection_type: optionalText(collection.collectionType, `rows[${index}].collection_type`, 20),
      effet_echeance_date: optionalIsoDate(
        collection.effetEcheanceDate,
        `rows[${index}].effet_echeance_date`,
      ),
      effet_status: optionalText(collection.effetStatus, `rows[${index}].effet_status`, 20),
      cheque_number: optionalText(collection.chequeNumber, `rows[${index}].cheque_number`, 200),
      cheque_status: optionalText(collection.chequeStatus, `rows[${index}].cheque_status`, 20),
      excel_filename: excelFilename,
      excel_source_row: excelSourceRow as number,
      date_of_validity: optionalIsoDate(collection.dateOfValidity, `rows[${index}].date_of_validity`),
      facture_no: optionalText(collection.factureNo, `rows[${index}].facture_no`, 500),
      no_chq_bd: optionalText(collection.noChqBd, `rows[${index}].no_chq_bd`, 500),
      bank_name_display: optionalText(
        collection.bankNameDisplay,
        `rows[${index}].bank_name_display`,
        500,
      ),
      depo_ref: optionalText(collection.depoRef, `rows[${index}].depo_ref`, 500),
      nj: optionalNumber(collection.nj, `rows[${index}].nj`),
      taux: optionalNumber(collection.taux, `rows[${index}].taux`),
      interet: optionalNumber(collection.interet, `rows[${index}].interet`),
      commission: optionalNumber(collection.commission, `rows[${index}].commission`),
      tob: optionalNumber(collection.tob, `rows[${index}].tob`),
      frais_escompte: optionalNumber(collection.fraisEscompte, `rows[${index}].frais_escompte`),
      bank_commission: optionalNumber(
        collection.bankCommission,
        `rows[${index}].bank_commission`,
      ),
      sg_or_fa_no: optionalText(collection.sgOrFaNo, `rows[${index}].sg_or_fa_no`, 500),
      d_n_amount: optionalNumber(collection.dNAmount, `rows[${index}].d_n_amount`),
      income: optionalNumber(collection.income, `rows[${index}].income`),
      date_of_impay: optionalIsoDate(collection.dateOfImpay, `rows[${index}].date_of_impay`),
      reglement_impaye: optionalIsoDate(
        collection.reglementImpaye,
        `rows[${index}].reglement_impaye`,
      ),
      remarques: optionalText(collection.remarques, `rows[${index}].remarques`, 4000),
    };
  });
}

function parseAtomicResult(value: unknown): AtomicCollectionImportResult {
  const result = value as Partial<AtomicCollectionImportResult> | null;
  const integerFields: Array<keyof AtomicCollectionImportResult> = [
    'total_rows',
    'inserted_rows',
    'updated_rows',
    'divergent_rows',
    'audit_rows',
  ];
  if (!result || typeof result.command_key !== 'string') {
    throw new Error('Réponse atomique Collection invalide — promotion considérée comme échouée.');
  }
  for (const field of integerFields) {
    if (!Number.isSafeInteger(result[field]) || (result[field] as number) < 0) {
      throw new Error('Réponse atomique Collection invalide — promotion considérée comme échouée.');
    }
  }
  if (
    result.total_rows !== result.inserted_rows! + result.updated_rows!
    || result.audit_rows !== result.total_rows
  ) {
    throw new Error('Compteurs atomiques Collection incohérents — vérification requise.');
  }
  return result as AtomicCollectionImportResult;
}

export async function readCollectionReportPromotionScope(): Promise<boolean> {
  const { data, error } = await supabase.rpc('collection_report_promotion_enabled_v1');
  if (error || typeof data !== 'boolean') {
    throw new Error('Lecture du verrou serveur Collection impossible.');
  }
  return data;
}

export async function promoteCollectionReportAtomically(
  collections: readonly CollectionReport[],
  commandKey?: string,
): Promise<SyncResultData> {
  const rows = buildAtomicCollectionRows(collections);
  const stableCommandKey = commandKey ?? await createCollectionImportCommandKey(rows);
  const { data, error } = await supabase.rpc('import_collection_report_atomic_v1', {
    p_command_key: stableCommandKey,
    p_rows: rows,
  });
  if (error) {
    const knownErrors: Record<string, string> = {
      COLLECTION_IMPORT_SERVER_READ_ONLY: 'Le scope serveur Collection est fermé ou expiré.',
      COLLECTION_IMPORT_FORBIDDEN: 'Le rôle courant ne permet pas la promotion Collection.',
      COLLECTION_IMPORT_COMMAND_PAYLOAD_MISMATCH: 'La clé de commande ne correspond pas au payload préparé.',
      COLLECTION_IMPORT_PAYLOAD_INVALID_OR_LIMIT_EXCEEDED: 'Le lot Collection dépasse les bornes serveur.',
      COLLECTION_IMPORT_ROW_SCHEMA_INVALID: 'Le schéma du lot Collection est invalide.',
      COLLECTION_IMPORT_ROW_VALUES_INVALID: 'Une valeur Collection obligatoire est invalide.',
      COLLECTION_IMPORT_FILE_LIMIT_EXCEEDED: 'Le lot Collection dépasse la limite de fichiers.',
      COLLECTION_IMPORT_DUPLICATE_TRACEABILITY_IN_PAYLOAD: 'La sélection contient une traçabilité dupliquée.',
      COLLECTION_IMPORT_MASS_ROW_SHIFT_DETECTED: 'Un décalage massif de lignes a été détecté ; aucune écriture effectuée.',
    };
    const safeMessage = Object.entries(knownErrors).find(([code]) => error.message?.includes(code))?.[1];
    throw new Error(safeMessage ?? 'Promotion atomique Collection refusée ; aucune écriture partielle attendue.');
  }
  const result = parseAtomicResult(data);
  return {
    new_collections: result.inserted_rows,
    idempotent_updates: result.updated_rows,
    enriched_collections: 0,
    incomplete_not_enriched: 0,
    ignored_collections: 0,
    errors: [],
    summary: {
      total_processed: result.total_rows,
      enrichments: {
        date_of_validity_added: 0,
        bank_commissions_added: 0,
        references_updated: 0,
        statuses_updated: 0,
      },
    },
  };
}
