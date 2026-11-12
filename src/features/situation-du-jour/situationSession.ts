// Session de travail de l'écran « Situation du jour » : les fichiers déposés,
// la date comptable, les attestations et le résultat vivent uniquement en
// mémoire. Rien n'est écrit dans un stockage du navigateur ni envoyé sur le
// réseau. `clear()` remet à zéro les octets des fichiers avant de les lâcher.
import { computeSituation, SituationInputError } from './situationCompute';
import type { SituationResult } from './situationCompute';
import { isIsoDate } from './situationCore';
import type { InMemoryFile } from './situationCore';
import type { StatementAttestation } from './statementBalances';

export const SITUATION_MAX_FILES = 40;
export const SITUATION_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface SituationFileLike {
  name: string;
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SituationSessionError =
  | 'TOO_MANY_FILES'
  | 'FILE_TOO_LARGE'
  | 'FILE_UNREADABLE'
  | 'ACCOUNTING_DATE_INVALID'
  | 'ACCOUNTING_DATE_IN_FUTURE'
  | 'COMPUTATION_FAILED';

export const SITUATION_SESSION_ERROR_LABELS: Record<SituationSessionError, string> = {
  TOO_MANY_FILES: `Trop de fichiers (maximum ${SITUATION_MAX_FILES}).`,
  FILE_TOO_LARGE: 'Un fichier dépasse la taille maximale acceptée.',
  FILE_UNREADABLE: 'Un fichier n’a pas pu être lu.',
  ACCOUNTING_DATE_INVALID: 'La date comptable est invalide.',
  ACCOUNTING_DATE_IN_FUTURE: 'La date comptable ne peut pas être dans le futur.',
  COMPUTATION_FAILED: 'Le calcul a échoué ; aucun résultat n’est affiché.',
};

export interface SituationSessionState {
  files: InMemoryFile[];
  accountingDate: string;
  attestations: Record<string, StatementAttestation>;
  result: SituationResult | null;
  error: SituationSessionError | null;
}

export interface SituationSession {
  getState(): SituationSessionState;
  subscribe(listener: () => void): () => void;
  addFiles(files: SituationFileLike[]): Promise<void>;
  removeFile(name: string): void;
  setAccountingDate(iso: string): void;
  setAttestation(fileName: string, attestation: StatementAttestation): void;
  compute(): void;
  clear(): void;
}

function wipe(file: InMemoryFile): void {
  new Uint8Array(file.bytes).fill(0);
}

export function createSituationSession(options: { today: () => string; initialAccountingDate: string }): SituationSession {
  let state: SituationSessionState = {
    files: [], accountingDate: options.initialAccountingDate, attestations: {}, result: null, error: null,
  };
  // Toute remise à zéro invalide les lectures de fichiers encore en cours.
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<SituationSessionState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async addFiles(incoming) {
      if (state.files.length + incoming.length > SITUATION_MAX_FILES) {
        update({ error: 'TOO_MANY_FILES' });
        return;
      }
      const startedAt = generation;
      const read: InMemoryFile[] = [];
      for (const file of incoming) {
        if (typeof file.size === 'number' && file.size > SITUATION_MAX_FILE_BYTES) {
          read.forEach(wipe);
          update({ error: 'FILE_TOO_LARGE' });
          return;
        }
        try {
          const bytes = await file.arrayBuffer();
          if (bytes.byteLength > SITUATION_MAX_FILE_BYTES) {
            read.forEach(wipe);
            update({ error: 'FILE_TOO_LARGE' });
            return;
          }
          read.push({ name: file.name, bytes });
        } catch {
          read.forEach(wipe);
          update({ error: 'FILE_UNREADABLE' });
          return;
        }
      }
      if (startedAt !== generation) {
        read.forEach(wipe);
        return;
      }
      // Un fichier redéposé sous le même nom remplace le précédent (jamais de double comptage par redépôt),
      // et son attestation tombe : elle valait pour l'ancien contenu.
      const names = new Set(read.map((file) => file.name));
      const attestations = { ...state.attestations };
      names.forEach((name) => { delete attestations[name]; });
      // Les anciens octets sont remis à zéro, sauf si le navigateur a rendu le même tampon.
      state.files
        .filter((file) => names.has(file.name) && !read.some((fresh) => fresh.bytes === file.bytes))
        .forEach(wipe);
      update({ files: [...state.files.filter((file) => !names.has(file.name)), ...read], attestations, result: null, error: null });
    },
    removeFile(name) {
      state.files.filter((file) => file.name === name).forEach(wipe);
      const attestations = { ...state.attestations };
      delete attestations[name];
      update({ files: state.files.filter((file) => file.name !== name), attestations, result: null, error: null });
    },
    setAccountingDate(iso) {
      update({ accountingDate: iso, result: null, error: null });
    },
    setAttestation(fileName, attestation) {
      update({ attestations: { ...state.attestations, [fileName]: attestation }, result: null, error: null });
    },
    compute() {
      if (!isIsoDate(state.accountingDate)) {
        update({ result: null, error: 'ACCOUNTING_DATE_INVALID' });
        return;
      }
      try {
        const result = computeSituation({
          files: state.files,
          accountingDate: state.accountingDate,
          today: options.today(),
          attestations: state.attestations,
        });
        update({ result, error: null });
      } catch (error) {
        const code = error instanceof SituationInputError && error.code === 'ACCOUNTING_DATE_IN_FUTURE'
          ? 'ACCOUNTING_DATE_IN_FUTURE'
          : error instanceof SituationInputError ? 'ACCOUNTING_DATE_INVALID' : 'COMPUTATION_FAILED';
        update({ result: null, error: code });
      }
    },
    clear() {
      generation += 1;
      state.files.forEach(wipe);
      update({ files: [], attestations: {}, result: null, error: null });
    },
  };
}
