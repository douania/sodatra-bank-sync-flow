import {
  DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF,
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
} from '@/features/daily-v2/dailyV2RuntimeTarget';
import type { ImportDocumentKind } from './importPreflightService';

export type OperationalImportDeploymentTarget = 'staging' | 'production' | 'unknown';

export type OperationalImportQualification =
  | 'PRODUCTION_CANDIDATE'
  | 'STAGING_PILOT'
  | 'BLOCKED';

export interface OperationalImportReadinessEntry {
  id: string;
  label: string;
  route: '/upload' | '/daily-statements';
  formats: readonly string[];
  qualification: OperationalImportQualification;
  evidence: string;
  limitation?: string;
}

export interface OperationalImportDocumentQualification {
  qualification: OperationalImportQualification;
  productionEligible: boolean;
  reason: string;
}

/**
 * Matrice produit affichable et testable. "PRODUCTION_CANDIDATE" ne constitue
 * jamais une activation : la cible production reste read-only jusqu'au GO
 * dédié, et les rôles/RLS/grants restent des barrières distinctes.
 */
export const OPERATIONAL_IMPORT_FORMAT_READINESS: readonly OperationalImportReadinessEntry[] = [
  {
    id: 'collection-report',
    label: 'Collection Report',
    route: '/upload',
    formats: ['XLSX', 'XLS'],
    qualification: 'PRODUCTION_CANDIDATE',
    evidence: 'Précontrôle, review humaine, promotion explicite et tests synthétiques.',
  },
  {
    id: 'internal-book',
    label: 'Internal Book',
    route: '/upload',
    formats: ['XLSX', 'XLS'],
    qualification: 'PRODUCTION_CANDIDATE',
    evidence: 'Détection structurelle, sélection, orchestration et adaptation couvertes synthétiquement.',
  },
  {
    id: 'bdk-bank-report',
    label: 'Rapport bancaire BDK',
    route: '/upload',
    formats: ['PDF'],
    qualification: 'STAGING_PILOT',
    evidence: 'Contrat générique local fail-closed couvert synthétiquement ; les formes non comprises sont refusées.',
    limitation: 'La fixture BDK réaliste du dépôt reste refusée sur /upload ; qualification sur fichiers réels anonymisés requise.',
  },
  {
    id: 'other-bank-reports',
    label: 'Rapports ATB, BICIS, ORA, SGBS et BIS',
    route: '/upload',
    formats: ['PDF', 'XLSX', 'XLS'],
    qualification: 'STAGING_PILOT',
    evidence: 'Identité bancaire corroborée et extraction locale fail-closed couvertes synthétiquement banque par banque.',
    limitation: 'Qualification sur fichiers réels anonymisés encore requise avant toute promotion.',
  },
  {
    id: 'fund-position',
    label: 'Fund Position',
    route: '/upload',
    formats: ['PDF', 'XLSX', 'XLS'],
    qualification: 'STAGING_PILOT',
    evidence: 'Date, grand total explicite, détail bancaire et montants sont contrôlés en fail-closed.',
    limitation: 'Qualification sur fichiers réels anonymisés encore requise avant toute promotion.',
  },
  {
    id: 'client-reconciliation',
    label: 'Client Reconciliation',
    route: '/upload',
    formats: ['XLSX', 'XLS'],
    qualification: 'BLOCKED',
    evidence: 'Détection uniquement.',
    limitation: 'Moteur d’import réel non connecté.',
  },
  {
    id: 'daily-statements',
    label: 'Relevés structurés Daily v2',
    route: '/daily-statements',
    formats: ['CSV BDK/ORA', 'XLSX ATB/BICIS/BIS/BRIDGE'],
    qualification: 'PRODUCTION_CANDIDATE',
    evidence: 'Parsing, staging, promotion, audit et reporting couverts par la matrice Daily v2.',
    limitation: 'Voie séparée de /upload ; production encore read-only.',
  },
] as const;

export function qualifyOperationalImportDocument(
  kind: ImportDocumentKind,
  fileName: string,
  documentLabel: string,
): OperationalImportDocumentQualification {
  if (kind === 'CLIENT_RECONCILIATION') {
    return {
      qualification: 'BLOCKED',
      productionEligible: false,
      reason: 'Le moteur Client Reconciliation réel n’est pas encore connecté.',
    };
  }

  if (kind === 'UNKNOWN') {
    return {
      qualification: 'BLOCKED',
      productionEligible: false,
      reason: 'Le document n’est pas identifié par un contrat opérationnel.',
    };
  }

  if (kind === 'COLLECTION_REPORT' || kind === 'INTERNAL_BOOK') {
    return {
      qualification: 'PRODUCTION_CANDIDATE',
      productionEligible: true,
      reason: 'Famille couverte par un parcours synthétique versionné.',
    };
  }

  return {
    qualification: 'STAGING_PILOT',
    productionEligible: false,
    reason: kind === 'FUND_POSITION'
      ? 'Fund Position reste un pilote staging jusqu’à qualification fichier complète.'
      : 'Les rapports bancaires restent des pilotes staging jusqu’à qualification sur fichiers réels anonymisés.',
  };
}

export interface OperationalImportTargetInput {
  supabaseUrl?: string;
  projectId?: string;
}

export function resolveOperationalImportDeploymentTarget(
  input: OperationalImportTargetInput,
): OperationalImportDeploymentTarget {
  const projectId = input.projectId?.trim() ?? '';
  let projectRefFromUrl = '';

  if (input.supabaseUrl?.trim()) {
    try {
      const hostname = new URL(input.supabaseUrl).hostname.toLowerCase();
      if (!hostname.endsWith('.supabase.co')) return 'unknown';
      projectRefFromUrl = hostname.slice(0, -'.supabase.co'.length);
    } catch {
      return 'unknown';
    }
  }

  if (projectId && projectRefFromUrl && projectId !== projectRefFromUrl) return 'unknown';
  const projectRef = projectRefFromUrl || projectId;

  if (projectRef === DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF) return 'staging';
  if (projectRef === DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF) return 'production';
  return 'unknown';
}

export function currentOperationalImportDeploymentTarget(): OperationalImportDeploymentTarget {
  try {
    return resolveOperationalImportDeploymentTarget({
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
    });
  } catch {
    return 'unknown';
  }
}
