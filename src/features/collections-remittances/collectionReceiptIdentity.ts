import type {
  CollectionInstrumentRow,
  CollectionReceiptRow,
} from './collectionsTypes';

const methodLabels: Record<CollectionReceiptRow['method'], string> = {
  CHEQUE: 'Chèque',
  EFFECT: 'Effet',
  TRANSFER: 'Virement',
  CASH: 'Espèces',
};

function formatBusinessDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function receiptInstrumentReferences(
  receiptId: string,
  instruments: CollectionInstrumentRow[],
): string[] {
  return instruments
    .filter((instrument) => instrument.receipt_id === receiptId)
    .map((instrument) => instrument.cheque_number ?? instrument.effect_reference)
    .filter((reference): reference is string => Boolean(reference?.trim()))
    .map((reference) => reference.trim())
    .filter((reference, index, references) => references.indexOf(reference) === index)
    .sort((left, right) => left.localeCompare(right, 'fr'));
}

export function collectionReceiptIdentity(
  receipt: CollectionReceiptRow,
  instruments: CollectionInstrumentRow[],
): string {
  const references = receiptInstrumentReferences(receipt.id, instruments);
  const clientReference = receipt.client_reference?.trim()
    ? `Réf. client ${receipt.client_reference.trim()}`
    : 'Sans réf. client';
  const instrumentReference = references.length > 0
    ? `Titre ${references.join(', ')}`
    : 'Sans réf. de titre';

  return [
    receipt.client_name_snapshot,
    clientReference,
    methodLabels[receipt.method],
    `Remise ${formatBusinessDate(receipt.bank_submission_date)}`,
    instrumentReference,
    `ID ${receipt.id.slice(0, 8)}`,
  ].join(' · ');
}

export function missingCollectionReceiptIdentity(receiptId: string): string {
  return `Remise liée non visible · ID ${receiptId.slice(0, 8)}`;
}
