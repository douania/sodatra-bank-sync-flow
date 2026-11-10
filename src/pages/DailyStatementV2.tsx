import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  assessDailyV2ExportReferenceDate,
  prepareDailyV2BrowserDeposit,
  readDailyV2FileNameExportDate,
  type DailyV2BrowserRequestedMode,
  type DailyV2ExportReferenceAssessment,
  type DailyV2SupportedBank,
  type PrepareDailyV2BrowserResult,
} from '@/features/daily-v2/dailyV2BrowserPipeline';
import { detectStructuredBankStatementCsvBankHint } from '@/services/structuredBankStatementCsvParser';
import {
  DailyV2ServiceError,
  getActiveDailyV2CanonicalUnit,
  getDailyV2AccountOpaqueIdentity,
  getDailyV2MutationsEnabled,
  listDailyV2Accounts,
  listDailyV2AccountEvents,
  listDailyV2BackfillGrants,
  listDailyV2AuditEvents,
  listDailyV2CanonicalLines,
  listDailyV2CanonicalUnits,
  listDailyV2StagingLines,
  listDailyV2StagingUnits,
  preIngestDailyV2WithIncrementalDelta,
  provisionDailyV2Account,
  deactivateDailyV2Account,
  issueDailyV2BackfillGrant,
  revokeDailyV2BackfillGrant,
  promoteDailyV2Unit,
  supersedeDailyV2Unit,
  type DailyV2IncrementalIngestResult,
} from '@/features/daily-v2/dailyV2SupabaseService';
import type { DailyV2IncrementalDeltaSummary } from '@/features/daily-v2/dailyV2IncrementalDelta';
import type {
  DailyV2AppRole,
  DailyV2AccountEventRow,
  DailyV2AccountRegistryRow,
  DailyV2BackfillGrantRow,
  DailyV2CanonicalLineRow,
  DailyV2CanonicalUnitRow,
  DailyV2Page,
  DailyV2PreIngestResponse,
  DailyV2PromoteResponse,
  DailyV2StagingLineRow,
  DailyV2StagingStatus,
  DailyV2StagingUnitRow,
  DailyV2SupersedeResponse,
  DailyV2AuditEventRow,
  DailyV2StagingAccountFilter,
  DailyV2StagingDecisionContext,
} from '@/features/daily-v2/dailyV2Types';
import {
  DAILY_V2_DECISION_REASON_REQUIRED_MESSAGE,
  DAILY_V2_DECISION_REGISTRY_HOLD_MESSAGES,
  DAILY_V2_STAGING_DECISION_STALE_MESSAGES,
  captureDailyV2StagingDecisionContext,
  checkDailyV2DecisionRegistryRead,
  checkDailyV2StagingDecisionCurrent,
  describeDailyV2StagingAccount,
  formatDailyV2AccountOption,
  isDailyV2DecisionReasonRequired,
  isDailyV2StagingAccountIdentified,
} from '@/features/daily-v2/dailyV2Types';
import {
  AccessDenied,
  AccountAuditTable,
  AuditTable,
  CanonicalTable,
  ErrorList,
  Fact,
  Field,
  LinesTable,
  ListCard,
  Pager,
  ReviewReasonList,
  StagingTable,
  StatusBadge,
} from '@/features/daily-v2/DailyV2Tables';
import { invalidateDailyV2, shortId } from '@/features/daily-v2/dailyV2UiUtils';
import { DailyV2DayDecisionsDialog } from '@/features/daily-v2/DailyV2DecisionDialogs';
import { DailyV2BatchApprovalDialog } from '@/features/daily-v2/DailyV2BatchApprovalDialog';
import DailyV2Reporting from '@/features/daily-v2/DailyV2Reporting';
import { DailyV2AdminControlsGate } from '@/features/daily-v2/DailyV2AdminControlsGate';
import { useDailyV2Access } from '@/features/daily-v2/dailyV2Access';
import { DailyV2SessionBoundary } from '@/features/daily-v2/session/DailyV2SessionBoundary';
import { useDailyV2ScopedMutation as useMutation, useDailyV2SessionScope } from '@/features/daily-v2/session/dailyV2SessionScope';
import { dailyV2BuildVersionLabel, dailyV2RuntimeLockPresentation, dailyV2SessionLabel } from '@/features/daily-v2/session/dailyV2SessionPresentation';
import { currentBuildProvenance } from '@/config/buildProvenance';
import { DailyV2ExpiredViewError } from '@/features/daily-v2/session/dailyV2SessionLifetime';
import { DailyV2AccessFeedback } from '@/features/daily-v2/session/DailyV2AccessFeedback';
import {
  applyDailyV2RuntimeMutationLock,
  currentDailyV2Capabilities,
  currentDailyV2RuntimeTargetVerdict,
  isDailyV2ProductionPilotProject,
  resolveDailyV2ImportPermissions,
} from '@/features/daily-v2/dailyV2RuntimeTarget';

const PAGE_SIZE = 20;
const READ_ONLY_TARGET_MESSAGE =
  'Cible en lecture seule : cette opération nécessite une cible autorisée (GO CTO distinct).';
const STAGING_STATUSES: Array<'all' | DailyV2StagingStatus> = [
  'all', 'staged', 'provisional', 'duplicate', 'conflict',
  'needs_review', 'promoted', 'promotion_failed', 'superseded', 'rejected',
];

type LineDialog =
  | { kind: 'staging'; id: string; title: string }
  | { kind: 'canonical'; id: string; title: string }
  | null;

type DecisionDialog =
  | { kind: 'promote' | 'supersede'; unit: DailyV2StagingUnitRow; context: DailyV2StagingDecisionContext }
  | null;

type PreparedDeposit = Extract<PrepareDailyV2BrowserResult, { success: true }>;

/** Date effacée par un changement de contexte, avec sa cause, pour que l'effacement ne soit jamais silencieux. */
type ClearedReferenceDate = { date: string; cause: 'new_file' | 'first_file' | 'bank' } | null;

const REVIEW_READ_FAILED_MESSAGE =
  'Décision suspendue : la relecture de la revue a échoué. Actualisez la liste avant de confirmer.';

const DECISION_IN_FLIGHT_MESSAGE =
  'Une décision est déjà en cours d’envoi : attendez son résultat avant d’en confirmer une autre.';

const UNIDENTIFIED_DECISION_ACCOUNT_MESSAGE =
  'Décision impossible : le compte de cette unité n’est pas identifiable (registre indisponible ou compte absent du registre lu).';

function clearedReferenceDateMessage(cleared: NonNullable<ClearedReferenceDate>, fileName: string): string {
  switch (cleared.cause) {
    case 'new_file':
      return `La date saisie pour le fichier précédent (${cleared.date}) n’est pas reprise. Saisissez la date d’export de « ${fileName} », ou préparez sans date en connaissance de cause.`;
    case 'first_file':
      return `La date saisie avant le choix du fichier (${cleared.date}) n’est pas reprise. Saisissez la date d’export de « ${fileName} », ou préparez sans date en connaissance de cause.`;
    case 'bank':
      return `La date saisie (${cleared.date}) a été effacée par le changement de banque. Saisissez la date d’export de « ${fileName} », ou préparez sans date en connaissance de cause.`;
    default:
      return `La date saisie (${cleared.date}) a été effacée.`;
  }
}

const BANK_LABELS: Record<string, string> = {
  BDK: 'BDK', ORA: 'ORABANK', ATB: 'ATB', BICIS: 'BICIS', BIS: 'BIS', BRIDGE: 'BRIDGE BANK',
};

/** Effet de la date de référence sur la préparation affichée, relu du payload (statuts calculés par le pipeline). */
function assessPrepared(prepared: PreparedDeposit): DailyV2ExportReferenceAssessment {
  return assessDailyV2ExportReferenceDate({
    fileName: prepared.diagnostic.sourceFileName,
    bank: prepared.diagnostic.bank,
    exportReferenceDate: prepared.payload.p_attempt.export_reference_date,
    units: prepared.payload.p_units,
  });
}

function exportReferenceIssueMessages(assessment: DailyV2ExportReferenceAssessment): string[] {
  const reference = assessment.referenceDate ?? '';
  const latest = assessment.latestAccountingDate;
  return assessment.issues.map((issue) => {
    switch (issue) {
      case 'ORA_WITHOUT_REFERENCE_DATE':
        return `ORABANK sans date de référence : la dernière journée du fichier (${latest}) est demandée provisoire.`;
      case 'FILE_NAME_DATE_NOT_USED':
        return `Le nom du fichier porte la date ${assessment.fileNameDate}, mais aucune date de référence n’est transmise.`;
      case 'REFERENCE_BEFORE_LATEST_DAY':
        return `Date incohérente : ${reference} est antérieure à la dernière journée du fichier (${latest}). Corrigez la date avant tout dépôt.`;
      case 'REFERENCE_AFTER_LATEST_DAY':
        return `${reference} est postérieure à la dernière journée du fichier (${latest}) : aucune journée du fichier n’est demandée provisoire.`;
      case 'REFERENCE_AFTER_FILE_NAME_DATE':
        return `Date incohérente : ${reference} est postérieure à la date d’export lue dans le nom du fichier (${assessment.fileNameDate}) ; la journée d’export, peut-être incomplète, ne serait plus demandée provisoire. Corrigez la date avant tout dépôt.`;
      case 'FILE_NAME_DATE_BEFORE_CONTENT':
        return `La date lue dans le nom du fichier (${assessment.fileNameDate}) est antérieure à sa dernière journée (${latest}) : le nom ne décrit pas le contenu, vérifiez la date d’export.`;
      case 'REFERENCE_DIFFERS_FROM_FILE_NAME':
        return `La date saisie (${reference}) est antérieure à celle lue dans le nom du fichier (${assessment.fileNameDate}).`;
      default:
        return 'Contrôle de date non reconnu : vérifiez la date avant tout dépôt.';
    }
  });
}

const DailyStatementV2 = () => {
  const { user } = useAuth();
  const { roles, accessState } = useDailyV2Access();
  if (accessState.status !== 'allowed') return <DailyV2AccessFeedback state={accessState} />;
  if (!user) return <DailyV2AccessFeedback state={{ status: 'blocked', reason: 'session_required' }} />;
  return <DailyV2SessionBoundary key={JSON.stringify([user.id, [...roles].sort()])}>
    <DailyStatementWorkspace userId={user.id} roles={roles} />
  </DailyV2SessionBoundary>;
};

const DailyStatementWorkspace = ({ userId, roles }: { userId: string; roles: readonly DailyV2AppRole[] }) => {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const { lifetime } = useDailyV2SessionScope();
  const preparationEpoch = useRef(0);
  const depositEpoch = useRef(-1);
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<DailyV2SupportedBank>('BDK');
  const [currency, setCurrency] = useState('XOF');
  const [accountRegistryId, setAccountRegistryId] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [requestedMode, setRequestedMode] = useState<DailyV2BrowserRequestedMode>('daily');
  const [backfillGrantId, setBackfillGrantId] = useState('');
  const [newAccountAlias, setNewAccountAlias] = useState('');
  const [newAccountMasked, setNewAccountMasked] = useState('');
  const [accountDeactivationReason, setAccountDeactivationReason] = useState('');
  const [grantPeriodStart, setGrantPeriodStart] = useState('');
  const [grantPeriodEnd, setGrantPeriodEnd] = useState('');
  const [grantMaxUnits, setGrantMaxUnits] = useState('4000');
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [grantRevocationReason, setGrantRevocationReason] = useState('');
  const [prepared, setPrepared] = useState<PreparedDeposit | null>(null);
  // Confirmation explicite de la date d'export, liée à CETTE préparation : toute nouvelle préparation l'annule.
  const [confirmedPreparation, setConfirmedPreparation] = useState<PreparedDeposit | null>(null);
  // Date effacée par un changement de fichier ou de banque, affichée pour que l'effacement ne soit jamais silencieux.
  const [clearedReferenceDate, setClearedReferenceDate] = useState<ClearedReferenceDate>(null);
  const [prepareErrors, setPrepareErrors] = useState<string[]>([]);
  const [depositResult, setDepositResult] = useState<DailyV2PreIngestResponse | null>(null);
  const [incrementalDelta, setIncrementalDelta] = useState<DailyV2IncrementalDeltaSummary | null>(null);
  const [stagingPage, setStagingPage] = useState(0);
  const [stagingAccount, setStagingAccount] = useState<DailyV2StagingAccountFilter>('all');
  const [stagingStatus, setStagingStatus] = useState<'all' | DailyV2StagingStatus>('all');
  const [stagingReview, setStagingReview] = useState<'all' | 'required' | 'clear'>('all');
  const [canonicalPage, setCanonicalPage] = useState(0);
  const [canonicalStatus, setCanonicalStatus] = useState<'all' | 'ingested' | 'superseded'>('all');
  const [auditPage, setAuditPage] = useState(0);
  const [accountAuditPage, setAccountAuditPage] = useState(0);
  const [lineDialog, setLineDialog] = useState<LineDialog>(null);
  const [decisionDialog, setDecisionDialog] = useState<DecisionDialog>(null);
  const [reason, setReason] = useState('');
  const [versionsUnit, setVersionsUnit] = useState<DailyV2StagingUnitRow | null>(null);
  const [batchAttemptId, setBatchAttemptId] = useState<string | null>(null);

  const isAdmin = roles.includes('admin');
  const canDeposit = isAdmin || roles.includes('manager');
  const canReadStaging = canDeposit;
  const canReadCanonical = isAdmin || roles.includes('auditor');
  const canReadAudit = canReadCanonical;
  // Capacités de la CIBLE déployée (garde d'interface, jamais une barrière de
  // sécurité : Auth, rôles, RLS et gates RPC restent serveur). Chaque action
  // combine le rôle ET la capacité ; une cible read-only n'expose aucune mutation.
  const targetCapabilities = currentDailyV2Capabilities();
  const targetVerdict = currentDailyV2RuntimeTargetVerdict('read');
  const productionPilotTarget =
    targetVerdict.allowed && isDailyV2ProductionPilotProject(targetVerdict.projectRef);
  const staticReadOnlyTarget =
    !targetCapabilities.deposit && !targetCapabilities.promote && !targetCapabilities.admin;
  const runtimeLockQuery = useQuery<boolean>({
    queryKey: ['daily-v2', 'runtime-mutations-enabled', userId],
    queryFn: getDailyV2MutationsEnabled,
    enabled: targetCapabilities.read && !staticReadOnlyTarget,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
  // TanStack Query conserve la dernière donnée réussie après une erreur de
  // refetch. Neutraliser explicitement cette valeur évite qu'un ancien `true`
  // maintienne les commandes ouvertes pendant que le verrou est indisponible.
  const runtimeMutationsEnabled =
    staticReadOnlyTarget || runtimeLockQuery.isError || runtimeLockQuery.isPending || runtimeLockQuery.isFetching
      ? false : runtimeLockQuery.data;
  const capabilities = applyDailyV2RuntimeMutationLock(
    targetCapabilities,
    runtimeMutationsEnabled,
  );
  const readOnlyTarget =
    !capabilities.deposit && !capabilities.promote && !capabilities.admin;
  const {
    canPrepareLocally,
    canPersist: canSubmitDeposit,
  } = resolveDailyV2ImportPermissions(canDeposit, targetCapabilities, capabilities);
  const canDecide = isAdmin && capabilities.promote;
  const canAdminister = isAdmin && capabilities.admin;
  // A polling refresh suspends actions, not local typing or its focused DOM node.
  const showAdminForms = isAdmin && targetCapabilities.admin;
  const { title: readOnlyTitle, label: runtimeLockLabel } = dailyV2RuntimeLockPresentation({
    staticReadOnly: staticReadOnlyTarget, productionPilot: productionPilotTarget,
    pending: runtimeLockQuery.isPending, fetching: runtimeLockQuery.isFetching,
    error: runtimeLockQuery.isError, value: runtimeLockQuery.data,
  });
  const targetLabel = productionPilotTarget
    ? 'production · pilote contrôlé'
    : targetVerdict.allowed
      ? 'staging'
      : 'non autorisée';
  const accountsQuery = useQuery<DailyV2AccountRegistryRow[]>({
    queryKey: ['daily-v2', 'accounts', bank, currency, isAdmin],
    queryFn: () => listDailyV2Accounts({ bank, currency, includeInactive: isAdmin }),
    enabled: canDeposit,
  });
  const accounts = accountsQuery.data ?? [];
  const selectedAccount = accounts.find(
    (account) => account.id === accountRegistryId && account.status === 'active',
  );
  const grantsQuery = useQuery<DailyV2BackfillGrantRow[]>({
    queryKey: ['daily-v2', 'backfill-grants', accountRegistryId],
    queryFn: () => listDailyV2BackfillGrants(accountRegistryId),
    enabled: canAdminister && requestedMode === 'backfill' && Boolean(accountRegistryId),
  });

  const resetPrepared = useCallback(() => {
    preparationEpoch.current++;
    setPrepared(null);
    setConfirmedPreparation(null);
    setPrepareErrors([]);
    setDepositResult(null);
    setIncrementalDelta(null);
  }, []);

  useEffect(() => {
    if (canPrepareLocally) return;
    setFile(null);
    setReferenceDate('');
    setClearedReferenceDate(null);
    setBackfillGrantId('');
    resetPrepared();
  }, [canPrepareLocally, resetPrepared]);

  // Un nouveau fichier n'hérite jamais de la date du précédent : elle est effacée, et l'effacement est signalé.
  const onDrop = useCallback((accepted: File[]) => {
    if (!canPrepareLocally) return;
    setFile(accepted[0] ?? null);
    setClearedReferenceDate(referenceDate.trim() ? { date: referenceDate.trim(), cause: file ? 'new_file' : 'first_file' } : null);
    setReferenceDate('');
    setBackfillGrantId('');
    resetPrepared();
  }, [canPrepareLocally, file, referenceDate, resetPrepared]);

  const dropzone = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    disabled: !canPrepareLocally,
  });

  const prepareMutation = useMutation<PrepareDailyV2BrowserResult, Error, void>({
    mutationFn: async () => {
      if (!canPrepareLocally) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      if (!file) throw new DailyV2ServiceError('Sélectionnez un fichier structuré CSV ou Excel.');
      if (requestedMode === 'backfill' && !isAdmin) {
        throw new DailyV2ServiceError('Le backfill est réservé au rôle admin.');
      }
      const epoch = preparationEpoch.current;
      const result = await prepareDailyV2BrowserDeposit({
        file,
        bank,
        currency,
        accountFingerprint: selectedAccount ? getDailyV2AccountOpaqueIdentity(selectedAccount) : '',
        accountRegistryId: selectedAccount?.id ?? '',
        registeredAccountNumberMasked: selectedAccount?.account_number_masked,
        exportReferenceDate: referenceDate.trim() || undefined,
        requestedMode,
        backfillGrantId: backfillGrantId || undefined,
      }).catch((error) => {
        if (epoch !== preparationEpoch.current) throw new DailyV2ExpiredViewError();
        throw error;
      });
      if (epoch !== preparationEpoch.current) throw new DailyV2ExpiredViewError();
      return result;
    },
    onSuccess: (result) => {
      setDepositResult(null);
      if (result.success === false) {
        setPrepared(null);
        setPrepareErrors(result.errors);
        toast.error('Préparation refusée', { description: result.errors[0] });
        return;
      }
      setPrepared(result);
      setPrepareErrors([]);
      toast.success('Payload Daily v2 prêt');
    },
    onError: (error) => showSafeError(error, 'Préparation impossible.'),
  });

  const depositMutation = useMutation<DailyV2IncrementalIngestResult, Error, void>({
    mutationFn: async () => {
      if (!canSubmitDeposit) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      if (!prepared) throw new DailyV2ServiceError('Aucun payload validé à déposer.');
      if (confirmedPreparation !== prepared) {
        throw new DailyV2ServiceError('Confirmez la date d’export du fichier courant avant le dépôt.');
      }
      if (assessPrepared(prepared).blocking) {
        throw new DailyV2ServiceError('Date d’export incohérente avec le fichier : dépôt refusé.');
      }
      if (prepared.payload.p_attempt.account_registry_id !== selectedAccount?.id) {
        throw new DailyV2ServiceError('Le compte sélectionné a changé depuis la préparation : préparez de nouveau.');
      }
      depositEpoch.current = preparationEpoch.current;
      return preIngestDailyV2WithIncrementalDelta(prepared.payload);
    },
    onSuccess: async (result) => {
      // Le formulaire n'est vidé que s'il n'a pas changé pendant le dépôt : un fichier ou une date saisis
      // entre-temps sont conservés, et toute préparation alors en cours devient périmée.
      const formUnchanged = depositEpoch.current === preparationEpoch.current;
      preparationEpoch.current++;
      setIncrementalDelta(result.incrementalDelta);
      if (formUnchanged) {
        setPrepared(null);
        setConfirmedPreparation(null);
        setFile(null);
        setReferenceDate('');
        setClearedReferenceDate(null);
      }
      if (result.outcome === 'no_changes') {
        setDepositResult(null);
        toast.success('Aucune nouvelle journée BIS à déposer', {
          description: `${result.incrementalDelta.identicalUnitsSkipped} journée(s) historiques identiques ignorée(s). Le grant reste actif.`,
        });
        return;
      }
      setDepositResult(result.response);
      setBackfillGrantId('');
      await invalidateDailyV2(queryClient);
      if (!lifetime.isActive()) return;
      toast.success('Dépôt Daily v2 terminé', {
        description: result.incrementalDelta
          ? `${result.incrementalDelta.submittedUnits} journée(s) utile(s) déposée(s), ${result.incrementalDelta.identicalUnitsSkipped} identique(s) ignorée(s).`
          : undefined,
      });
    },
    onError: (error) => showSafeError(error, 'Dépôt impossible.'),
  });

  const provisionAccountMutation = useMutation({
    mutationFn: async () => {
      if (!canAdminister) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      return provisionDailyV2Account({
        bank,
        currency,
        safeAlias: newAccountAlias,
        accountNumberMasked: newAccountMasked || undefined,
      });
    },
    onSuccess: async (account) => {
      setNewAccountAlias('');
      setNewAccountMasked('');
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'accounts'] });
      if (!lifetime.isActive()) return;
      // Le compte sélectionné change : la préparation et sa confirmation, faites pour l'ancien compte, tombent.
      setAccountRegistryId(account.id);
      setBackfillGrantId('');
      resetPrepared();
      toast.success('Compte Daily v2 provisionné');
    },
    onError: (error) => showSafeError(error, 'Provisionnement impossible.'),
  });

  const deactivateAccountMutation = useMutation({
    mutationFn: async () => {
      if (!canAdminister) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      return deactivateDailyV2Account({
        accountRegistryId,
        reason: accountDeactivationReason,
      });
    },
    onSuccess: async () => {
      setAccountRegistryId('');
      setAccountDeactivationReason('');
      resetPrepared();
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'accounts'] });
      if (!lifetime.isActive()) return;
      toast.success('Compte Daily v2 désactivé');
    },
    onError: (error) => showSafeError(error, 'Désactivation impossible.'),
  });

  const issueGrantMutation = useMutation({
    mutationFn: async () => {
      if (!canAdminister) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      return issueDailyV2BackfillGrant({
        accountRegistryId,
        periodStart: grantPeriodStart,
        periodEnd: grantPeriodEnd,
        maxUnits: Number(grantMaxUnits),
        expiresAt: new Date(grantExpiresAt).toISOString(),
      });
    },
    onSuccess: async (grant) => {
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'backfill-grants'] });
      if (!lifetime.isActive()) return;
      setRequestedMode('backfill');
      setBackfillGrantId(grant.id);
      resetPrepared();
      toast.success('Autorisation backfill provisionnée');
    },
    onError: (error) => showSafeError(error, 'Création du grant impossible.'),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: async () => {
      if (!canAdminister) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      return revokeDailyV2BackfillGrant({
        backfillGrantId,
        reason: grantRevocationReason,
      });
    },
    onSuccess: async () => {
      setBackfillGrantId('');
      setGrantRevocationReason('');
      resetPrepared();
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'backfill-grants'] });
      if (!lifetime.isActive()) return;
      toast.success('Autorisation backfill révoquée');
    },
    onError: (error) => showSafeError(error, 'Révocation du grant impossible.'),
  });

  const stagingQuery = useQuery<DailyV2Page<DailyV2StagingUnitRow>>({
    queryKey: ['daily-v2', 'staging', stagingPage, stagingStatus, stagingReview, stagingAccount],
    queryFn: () => listDailyV2StagingUnits({
      page: stagingPage,
      pageSize: PAGE_SIZE,
      status: stagingStatus,
      review: stagingReview,
      account: stagingAccount,
    }),
    enabled: canReadStaging,
  });
  // Registre de la revue, toutes banques : mêmes droits de lecture que le formulaire d'import
  // (admin : comptes actifs et inactifs ; manager : comptes actifs, borné aussi par la RLS).
  const reviewAccountsQuery = useQuery<DailyV2AccountRegistryRow[]>({
    queryKey: ['daily-v2', 'accounts', 'review', isAdmin],
    queryFn: () => listDailyV2Accounts({ includeInactive: isAdmin }),
    enabled: canReadStaging,
  });
  const reviewAccounts = reviewAccountsQuery.data ?? [];
  // `null` tant que le registre n'a pas été lu : « indisponible », jamais confondu avec « non visible ».
  const reviewAccountsById = reviewAccountsQuery.data
    ? new Map(reviewAccounts.map((account) => [account.id, account] as const))
    : null;
  const reviewKey = JSON.stringify([stagingAccount, stagingStatus, stagingReview, stagingPage]);
  // Une relecture en attente du réseau (TanStack « paused ») n'a pas encore confirmé les données affichées.
  const stagingRefreshing = stagingQuery.isFetching || stagingQuery.isPaused;
  const registryRefreshing = reviewAccountsQuery.isFetching || reviewAccountsQuery.isPaused;
  const reviewView = {
    reviewKey,
    refreshing: stagingRefreshing,
    // TanStack conserve les anciennes lignes après une relecture en échec : elles ne valent pas vue courante.
    failed: stagingQuery.isError,
    rows: stagingQuery.data?.rows ?? [],
    accountsById: reviewAccountsById,
    // Idem pour le registre : un échec de relecture laisse les comptes en cache, qui ne valent plus lecture courante.
    registry: { refreshing: registryRefreshing, failed: reviewAccountsQuery.isError },
  };
  const reviewViewRef = useRef(reviewView);
  const decisionRef = useRef(decisionDialog);
  const reasonRef = useRef(reason);
  // Synchronisées dès le commit (avant tout événement suivant) : la confirmation relit la vue, le dialogue et le
  // motif validés, jamais ceux capturés par un gestionnaire d'un rendu antérieur.
  useLayoutEffect(() => {
    reviewViewRef.current = reviewView;
    decisionRef.current = decisionDialog;
    reasonRef.current = reason;
  });
  // Une seule décision (promotion ou supersede) en vol à la fois. `isPending` n'est connu qu'au rendu suivant :
  // le verrou est posé synchroniquement par la confirmation et levé à la fin de la mutation (succès ou échec),
  // ce qui laisse une nouvelle tentative explicite après un échec.
  const decisionInFlightRef = useRef(false);
  const releaseDecision = () => {
    decisionInFlightRef.current = false;
  };
  const filteredAccount = reviewAccountsById?.get(stagingAccount);
  const stagingAccountLabel = stagingAccount === 'all'
    ? null
    : stagingAccount === 'unregistered'
      ? 'Sans compte du registre'
      : filteredAccount
        ? formatDailyV2AccountOption(filteredAccount)
        : reviewAccountsById === null
          ? 'Registre des comptes indisponible'
          : 'Compte non visible avec vos droits';
  const canonicalQuery = useQuery<DailyV2Page<DailyV2CanonicalUnitRow>>({
    queryKey: ['daily-v2', 'canonical', canonicalPage, canonicalStatus],
    queryFn: () => listDailyV2CanonicalUnits({ page: canonicalPage, pageSize: PAGE_SIZE, status: canonicalStatus }),
    enabled: canReadCanonical,
  });
  const auditQuery = useQuery<DailyV2Page<DailyV2AuditEventRow>>({
    queryKey: ['daily-v2', 'audit', auditPage],
    queryFn: () => listDailyV2AuditEvents({ page: auditPage, pageSize: PAGE_SIZE }),
    enabled: canReadAudit,
  });
  const accountAuditQuery = useQuery<DailyV2Page<DailyV2AccountEventRow>>({
    queryKey: ['daily-v2', 'account-audit', accountAuditPage],
    queryFn: () => listDailyV2AccountEvents({ page: accountAuditPage, pageSize: PAGE_SIZE }),
    enabled: canReadAudit,
  });
  const stagingLinesQuery = useQuery<DailyV2StagingLineRow[]>({
    queryKey: ['daily-v2', 'staging-lines', lineDialog?.id],
    queryFn: () => listDailyV2StagingLines(lineDialog!.id),
    enabled: isAdmin && lineDialog?.kind === 'staging',
  });
  const canonicalLinesQuery = useQuery<DailyV2CanonicalLineRow[]>({
    queryKey: ['daily-v2', 'canonical-lines', lineDialog?.id],
    queryFn: () => listDailyV2CanonicalLines(lineDialog!.id),
    enabled: canReadCanonical && lineDialog?.kind === 'canonical',
  });

  const promoteMutation = useMutation<
    DailyV2PromoteResponse,
    Error,
    { unit: DailyV2StagingUnitRow; approvalReason?: string }
  >({
    mutationFn: async ({ unit, approvalReason }: { unit: DailyV2StagingUnitRow; approvalReason?: string }) => {
      if (!canDecide) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      return promoteDailyV2Unit(unit.id, approvalReason);
    },
    onSuccess: async (result) => {
      closeDecision();
      await invalidateDailyV2(queryClient);
      if (!lifetime.isActive()) return;
      toast.success(`Promotion : ${result.outcome}`);
    },
    onError: (error) => {
      showSafeError(error, 'Promotion impossible.');
      rereadReviewAfterFailedDecision();
    },
    onSettled: releaseDecision,
  });

  const supersedeMutation = useMutation<
    DailyV2SupersedeResponse,
    Error,
    { unit: DailyV2StagingUnitRow; supersedeReason: string }
  >({
    mutationFn: async ({ unit, supersedeReason }: { unit: DailyV2StagingUnitRow; supersedeReason: string }) => {
      if (!canDecide) throw new DailyV2ServiceError(READ_ONLY_TARGET_MESSAGE);
      const active = await getActiveDailyV2CanonicalUnit(unit.day_unit_id);
      lifetime.assertActive();
      if (!active) throw new DailyV2ServiceError('Aucune unité canonical active correspondante.');
      return supersedeDailyV2Unit({
        oldCanonicalUnitId: active.id,
        newStagingUnitId: unit.id,
        reason: supersedeReason,
      });
    },
    onSuccess: async (result) => {
      closeDecision();
      await invalidateDailyV2(queryClient);
      if (!lifetime.isActive()) return;
      toast.success(`Supersede : ${result.outcome}`);
    },
    onError: (error) => {
      showSafeError(error, 'Supersede impossible.');
      rereadReviewAfterFailedDecision();
    },
    onSettled: releaseDecision,
  });

  // Un échec peut être ambigu (réponse perdue après l'enregistrement serveur) : la revue est relue, et une nouvelle
  // tentative passe par la suspension « relecture en cours » puis par le contrôle de fraîcheur de l'unité.
  function rereadReviewAfterFailedDecision() {
    // Suspension immédiate, sans attendre le rendu (même principe que `closeDecision`) : un gestionnaire appelé avant le
    // prochain commit voit une relecture en cours ; la vue relue, synchronisée au commit, remplace cette marque.
    reviewViewRef.current = { ...reviewViewRef.current, refreshing: true };
    void queryClient.invalidateQueries({ queryKey: ['daily-v2', 'staging'] });
  }
  const closeDecision = () => {
    // Le dialogue est retiré aussi de la référence, sans attendre le commit : un gestionnaire appelé entre la fin
    // d'une décision (verrou levé) et le rendu suivant ne retrouve plus le dialogue décidé.
    decisionRef.current = null;
    setDecisionDialog(null);
    setReason('');
  };
  // Tout changement de vue de revue (compte, filtres, page) ferme les décisions ouvertes sur l'ancienne vue.
  const closeReviewDecisions = () => {
    closeDecision();
    setVersionsUnit(null);
    setBatchAttemptId(null);
  };
  // Une confirmation relit la vue et le dialogue réellement ouverts après le dernier rendu validé, et non
  // ceux capturés par le gestionnaire : même un gestionnaire d'un rendu antérieur ne décide pas sur une vue périmée.
  const confirmDecision = () => {
    const open = decisionRef.current;
    if (!open || open !== decisionDialog) return;
    if (decisionInFlightRef.current) {
      toast.error(DECISION_IN_FLIGHT_MESSAGE);
      return;
    }
    const view = reviewViewRef.current;
    if (view.failed) {
      toast.error(REVIEW_READ_FAILED_MESSAGE);
      return;
    }
    const check = checkDailyV2StagingDecisionCurrent(open.context, view);
    if (check.staleReason === 'VIEW_REFRESHING') {
      // Simple suspension : le dialogue et la raison saisie restent ouverts jusqu'à la fin de la relecture.
      toast.error(DAILY_V2_STAGING_DECISION_STALE_MESSAGES.VIEW_REFRESHING);
      return;
    }
    if (check.staleReason !== null || check.unit === null) {
      toast.error(DAILY_V2_STAGING_DECISION_STALE_MESSAGES[check.staleReason ?? 'UNIT_NOT_IN_VIEW']);
      closeDecision();
      return;
    }
    const registryHold = checkDailyV2DecisionRegistryRead(check.unit, view.registry);
    if (registryHold !== null) {
      // Suspension : le dialogue et la raison saisie restent ouverts jusqu'à une lecture saine du registre.
      toast.error(DAILY_V2_DECISION_REGISTRY_HOLD_MESSAGES[registryHold]);
      return;
    }
    if (!isDailyV2StagingAccountIdentified(describeDailyV2StagingAccount(check.unit, view.accountsById))) {
      toast.error(UNIDENTIFIED_DECISION_ACCOUNT_MESSAGE);
      return;
    }
    // Motif du dernier rendu validé, sans espaces de bord. Même règle que le bouton : exigé si l'unité capturée à
    // l'ouverture OU l'unité relue l'exige (suspension : dialogue et motif conservés).
    const decisionReason = reasonRef.current.trim();
    const reasonNeeded = isDailyV2DecisionReasonRequired(open.kind, open.unit)
      || isDailyV2DecisionReasonRequired(open.kind, check.unit);
    if (reasonNeeded && decisionReason === '') {
      toast.error(DAILY_V2_DECISION_REASON_REQUIRED_MESSAGE);
      return;
    }
    decisionInFlightRef.current = true;
    // Levée aussi par les rappels de l'appel (observateur, non filtrés par la portée de session), en plus de
    // `onSettled` du hook : le verrou ne survit jamais à la décision tant que la page reste montée. Un résultat rejeté
    // par la portée (rappels du hook filtrés) a une issue inconnue : la revue est relue, comme après un échec.
    const settle = {
      onSettled: (_data: unknown, error: unknown) => {
        releaseDecision();
        if (error instanceof DailyV2ExpiredViewError) rereadReviewAfterFailedDecision();
      },
    };
    try {
      if (open.kind === 'promote') promoteMutation.mutate({ unit: check.unit, approvalReason: decisionReason || undefined }, settle);
      else supersedeMutation.mutate({ unit: check.unit, supersedeReason: decisionReason }, settle);
    } catch (error) {
      // Un échec synchrone de lancement ne laisse jamais le verrou posé.
      releaseDecision();
      throw error;
    }
  };
  const preparedAssessment = prepared ? assessPrepared(prepared) : null;
  const preparationConfirmed = prepared !== null && confirmedPreparation === prepared;
  const preparedAccount = prepared
    ? accounts.find((account) => account.id === prepared.payload.p_attempt.account_registry_id) ?? null
    : null;
  const preparedAccountLabel = preparedAccount
    ? `${preparedAccount.safe_alias}${preparedAccount.account_number_masked ? ` — ${preparedAccount.account_number_masked}` : ''}`
    : 'compte introuvable dans le registre lu';
  // Défense en profondeur : une préparation faite pour un autre compte que celui sélectionné n'est jamais déposable.
  const preparedAccountChanged = prepared !== null && prepared.payload.p_attempt.account_registry_id !== selectedAccount?.id;
  const depositBlocked = !preparationConfirmed || Boolean(preparedAssessment?.blocking) || preparedAccountChanged;
  const fileNameDate = file ? readDailyV2FileNameExportDate(file.name) : null;
  const csvBankHint = file && file.name.trim().toLowerCase().endsWith('.csv')
    ? detectStructuredBankStatementCsvBankHint(file.name)
    : null;
  const decisionAccount = decisionDialog ? describeDailyV2StagingAccount(decisionDialog.unit, reviewAccountsById) : null;
  const decisionAccountIdentified = decisionAccount !== null && isDailyV2StagingAccountIdentified(decisionAccount);
  const decisionRegistryHold = decisionDialog ? checkDailyV2DecisionRegistryRead(decisionDialog.unit, reviewView.registry) : null;
  const decisionReadFailed = (stagingQuery.isError && !stagingRefreshing) || decisionRegistryHold === 'REGISTRY_READ_FAILED';
  // Relecture explicite de la revue et du registre, accessible depuis le dialogue resté ouvert après un échec.
  const refreshReview = () => {
    void stagingQuery.refetch();
    void reviewAccountsQuery.refetch();
  };
  // Motif affiché et exigé selon l'unité capturée à l'ouverture ET selon la même unité relue dans la vue courante.
  const decisionRereadUnit = decisionDialog
    ? reviewView.rows.find((row) => row.id === decisionDialog.unit.id) ?? null
    : null;
  const reasonRequired = decisionDialog !== null && (
    isDailyV2DecisionReasonRequired(decisionDialog.kind, decisionDialog.unit) ||
    (decisionRereadUnit !== null && isDailyV2DecisionReasonRequired(decisionDialog.kind, decisionRereadUnit)));
  // Codes à examiner : ceux de l'unité capturée et ceux de la même unité relue, pour justifier ce qui est exigé.
  const decisionReviewCodes = decisionDialog
    ? [...new Set([...decisionDialog.unit.review_reason_codes, ...(decisionRereadUnit?.review_reason_codes ?? [])])]
    : [];
  const lineRows = lineDialog?.kind === 'staging' ? stagingLinesQuery.data : canonicalLinesQuery.data;
  const lineLoading = lineDialog?.kind === 'staging' ? stagingLinesQuery.isLoading : canonicalLinesQuery.isLoading;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Relevés bancaires Daily v2</h1>
        <p className="text-muted-foreground mt-1">Import sécurisé, review staging, promotion, canonical et audit.</p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Flux contrôlé</AlertTitle>
        <AlertDescription>
          Aucun fichier brut CSV/Excel, numéro complet ou IBAN n’est envoyé en base. Les actions restent soumises à Auth, RLS et rôles serveur.
        </AlertDescription>
      </Alert>

      {readOnlyTarget && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>{readOnlyTitle}</AlertTitle>
          <AlertDescription>
            {staticReadOnlyTarget
              ? 'Consultation uniquement. La préparation locale et toutes les mutations sont indisponibles sur cette cible.'
              : productionPilotTarget
                ? 'La préparation locale est disponible, mais aucune mutation n’est possible tant que le verrou PostgreSQL reste fermé. Son absence, une erreur de lecture ou toute valeur autre que true maintient le pilote fermé.'
                : 'Consultation et préparation locale autorisées sur staging. Dépôt, promotion, supersede et administration du registre sont désactivés tant que le verrou serveur n’autorise pas explicitement les mutations.'}
          </AlertDescription>
        </Alert>
      )}

      {productionPilotTarget && !readOnlyTarget && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Pilote production actif</AlertTitle>
          <AlertDescription>
            Le verrou maître PostgreSQL est ouvert. Chaque action exige encore son scope et ses droits serveur ;
            cela ne vaut pas autorisation générale de dépôt, promotion, administration ou backfill.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{dailyV2SessionLabel(loading, Boolean(user))}</Badge>
        <Badge variant="outline">Cible : {targetLabel}</Badge>
        <Badge variant="secondary">Rôles vérifiés : {roles.join(', ')}</Badge>
        <Badge variant="secondary">Verrou serveur : {runtimeLockLabel}</Badge>
        <Badge variant="outline">{dailyV2BuildVersionLabel(currentBuildProvenance())}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Une nouvelle vérification des droits efface les données, fichiers et décisions en cours, notamment au retour dans l’onglet ou à la reconnexion réseau si les droits en cache ont plus de cinq minutes. Après interruption d’une action, consultez son état avant de la relancer : fermer la vue n’annule pas une opération déjà reçue par le serveur.</p>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="staging">Staging</TabsTrigger>
          <TabsTrigger value="canonical">Canonical</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="reporting">Reporting</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          {!canDeposit ? <AccessDenied text="Dépôt réservé aux rôles admin et manager." /> :
          !canPrepareLocally ? (
            <AccessDenied text="Préparation indisponible sur cette cible." />
          ) : (
            <>
              {!canSubmitDeposit && (
                <Alert>
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>Mode parse-only</AlertTitle>
                  <AlertDescription>
                    Le fichier est lu et contrôlé uniquement dans ce navigateur. Le payload peut
                    être préparé pour diagnostic, mais aucun dépôt RPC ni autre mutation serveur
                    n’est autorisé.
                  </AlertDescription>
                </Alert>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Préparer un relevé structuré</CardTitle>
                  <CardDescription>CSV BDK/ORA ou Excel ONLINE ATB/BICIS/BIS/BRIDGE, 10 MB maximum. Sélectionnez un compte actif du registre.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div {...dropzone.getRootProps()} className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center">
                    <input {...dropzone.getInputProps()} />
                    <Upload className="mx-auto h-8 w-8" />
                    <p className="mt-2 font-medium">{file?.name ?? 'Déposez un CSV, XLS ou XLSX'}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Banque">
                      <Select value={bank} onValueChange={(value: DailyV2SupportedBank) => { setBank(value); setAccountRegistryId(''); setClearedReferenceDate(referenceDate.trim() ? { date: referenceDate.trim(), cause: 'bank' } : null); setReferenceDate(''); setRequestedMode('daily'); setBackfillGrantId(''); resetPrepared(); }}>
                        <SelectTrigger aria-label="Banque"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BDK">BDK</SelectItem>
                          <SelectItem value="ORA">ORABANK</SelectItem>
                          <SelectItem value="ATB">ATB</SelectItem>
                          <SelectItem value="BICIS">BICIS</SelectItem>
                          <SelectItem value="BIS">BIS</SelectItem>
                          <SelectItem value="BRIDGE">BRIDGE BANK</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Devise">
                      <Input value={currency} maxLength={3} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setAccountRegistryId(''); setBackfillGrantId(''); resetPrepared(); }} />
                    </Field>
                    <Field label="Compte pré-provisionné">
                      <Select value={accountRegistryId} onValueChange={(value) => { setAccountRegistryId(value); setBackfillGrantId(''); resetPrepared(); }}>
                        <SelectTrigger aria-label="Compte pré-provisionné"><SelectValue placeholder={accountsQuery.isLoading ? 'Chargement…' : 'Choisir un compte actif'} /></SelectTrigger>
                        <SelectContent>
                          {accounts.filter((account) => account.status === 'active').map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.safe_alias}{account.account_number_masked ? ` — ${account.account_number_masked}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Date de référence export (DD/MM/YYYY)">
                      <Input aria-label="Date de référence export" value={referenceDate} onChange={(e) => { setReferenceDate(e.target.value); setClearedReferenceDate(null); resetPrepared(); }} placeholder={bank === 'ORA' ? 'Recommandée pour ORA' : 'Optionnelle'} />
                    </Field>
                    <Field label="Mode de dépôt">
                      <Select value={requestedMode} onValueChange={(value: DailyV2BrowserRequestedMode) => { setRequestedMode(value); setBackfillGrantId(''); resetPrepared(); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily — 45 jours maximum</SelectItem>
                          {canAdminister && bank === 'BIS' && <SelectItem value="backfill">Backfill BIS admin — 4000 jours maximum</SelectItem>}
                        </SelectContent>
                      </Select>
                    </Field>
                    {requestedMode === 'backfill' && (
                      <Field label="Autorisation backfill active">
                        <Select value={backfillGrantId} onValueChange={(value) => { setBackfillGrantId(value); resetPrepared(); }}>
                          <SelectTrigger><SelectValue placeholder="Choisir un grant provisionné" /></SelectTrigger>
                          <SelectContent>{(grantsQuery.data ?? []).map((grant) => (
                            <SelectItem key={grant.id} value={grant.id}>
                              {grant.period_start} → {grant.period_end} · {grant.max_units} unités
                            </SelectItem>
                          ))}</SelectContent>
                        </Select>
                      </Field>
                    )}
                  </div>
                  {file && (
                    <div className="space-y-2 rounded border p-3 text-sm" aria-label="Fichier et date d’export">
                      <p>Fichier courant : <strong>{file.name}</strong></p>
                      {csvBankHint !== null && (
                        <p data-bank-hint={csvBankHint}>
                          {csvBankHint === 'UNKNOWN'
                            ? 'Aucune banque reconnue dans le nom du fichier : la préparation sera refusée. Noms reconnus : ORA, ORAB ou ORABANK ; BDK ou BANQUE DE DAKAR, sans les deux à la fois.'
                            : `Banque reconnue d’après le nom du fichier : ${BANK_LABELS[csvBankHint]}${csvBankHint !== bank ? ` — ne correspond pas à la banque choisie (${BANK_LABELS[bank]}) : la préparation sera refusée.` : '.'}`}
                        </p>
                      )}
                      {clearedReferenceDate && (
                        <Alert>
                          <AlertTitle>Date précédente effacée</AlertTitle>
                          <AlertDescription>{clearedReferenceDateMessage(clearedReferenceDate, file.name)}</AlertDescription>
                        </Alert>
                      )}
                      {fileNameDate && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span>Date lue dans le nom du fichier : <strong>{fileNameDate}</strong></span>
                          {referenceDate.trim() !== fileNameDate && (
                            <Button size="sm" variant="outline" onClick={() => { setReferenceDate(fileNameDate); setClearedReferenceDate(null); resetPrepared(); }}>Utiliser cette date</Button>
                          )}
                        </div>
                      )}
                      <p data-reference-date-used={referenceDate.trim() || 'none'}>
                        Date qui sera transmise : <strong>{referenceDate.trim() || 'aucune'}</strong>
                        {!referenceDate.trim() && (bank === 'ORA'
                          ? ' — sans date, la dernière journée ORABANK du fichier sera demandée provisoire.'
                          : ' — sans date, aucune journée du fichier ne sera demandée provisoire.')}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={() => prepareMutation.mutate()} disabled={!file || !selectedAccount || (requestedMode === 'backfill' && !backfillGrantId) || prepareMutation.isPending || depositMutation.isPending}>
                      {prepareMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Préparer
                    </Button>
                    <Button variant="outline" onClick={() => { setFile(null); setAccountRegistryId(''); setReferenceDate(''); setClearedReferenceDate(null); setBackfillGrantId(''); resetPrepared(); }}>Réinitialiser</Button>
                  </div>
                </CardContent>
              </Card>

              <DailyV2AdminControlsGate allowed={showAdminForms} renderControls={() => (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Registre des comptes</CardTitle>
                      <CardDescription>Le serveur génère le fingerprint. L’opérateur ne saisit qu’un alias non sensible et, facultativement, un numéro déjà masqué.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Field label="Alias non sensible">
                        <Input value={newAccountAlias} maxLength={80} onChange={(event) => setNewAccountAlias(event.target.value)} placeholder="Ex. Compte exploitation Dakar" />
                      </Field>
                      <Field label="Numéro masqué facultatif">
                        <Input value={newAccountMasked} maxLength={64} onChange={(event) => setNewAccountMasked(event.target.value)} placeholder="Ex. ****1234" />
                      </Field>
                      <Button
                        onClick={() => provisionAccountMutation.mutate()}
                        disabled={!canAdminister || !newAccountAlias.trim() || provisionAccountMutation.isPending}
                      >
                        {provisionAccountMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Provisionner pour {bank}/{currency}
                      </Button>
                      {selectedAccount && (
                        <div className="space-y-3 rounded border p-3">
                          <p className="text-sm">Compte sélectionné : <strong>{selectedAccount.safe_alias}</strong></p>
                          <Field label="Raison de désactivation">
                            <Textarea value={accountDeactivationReason} maxLength={200} onChange={(event) => setAccountDeactivationReason(event.target.value)} />
                          </Field>
                          <Button
                            variant="destructive"
                            onClick={() => deactivateAccountMutation.mutate()}
                            disabled={!canAdminister || !accountDeactivationReason.trim() || deactivateAccountMutation.isPending}
                          >Désactiver ce compte</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Autorisation backfill BIS</CardTitle>
                      <CardDescription>Grant serveur à usage unique, borné par compte, période, volume du delta transmis et expiration.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!selectedAccount || bank !== 'BIS' ? (
                        <p className="text-sm text-muted-foreground">Sélectionnez un compte BIS actif pour provisionner un grant.</p>
                      ) : (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Début autorisé"><Input type="date" value={grantPeriodStart} onChange={(event) => setGrantPeriodStart(event.target.value)} /></Field>
                            <Field label="Fin autorisée"><Input type="date" value={grantPeriodEnd} onChange={(event) => setGrantPeriodEnd(event.target.value)} /></Field>
                            <Field label="Journées utiles maximum (delta)"><Input type="number" min="1" max="4000" value={grantMaxUnits} onChange={(event) => setGrantMaxUnits(event.target.value)} /></Field>
                            <Field label="Expiration"><Input type="datetime-local" value={grantExpiresAt} onChange={(event) => setGrantExpiresAt(event.target.value)} /></Field>
                          </div>
                          <Button
                            onClick={() => issueGrantMutation.mutate()}
                            disabled={!canAdminister || !grantPeriodStart || !grantPeriodEnd || !grantExpiresAt || !grantMaxUnits || issueGrantMutation.isPending}
                          >Créer un grant</Button>
                          {backfillGrantId && (
                            <div className="space-y-3 rounded border p-3">
                              <Field label="Raison de révocation">
                                <Textarea value={grantRevocationReason} maxLength={200} onChange={(event) => setGrantRevocationReason(event.target.value)} />
                              </Field>
                              <Button
                                variant="destructive"
                                onClick={() => revokeGrantMutation.mutate()}
                                disabled={!canAdminister || !grantRevocationReason.trim() || revokeGrantMutation.isPending}
                              >Révoquer le grant sélectionné</Button>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )} />

              {prepareErrors.length > 0 && <ErrorList title="Préparation refusée" errors={prepareErrors} />}

              {prepared && (
                <Card>
                  <CardHeader><CardTitle>Payload prêt</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4 text-sm">
                      <Fact label="Banque" value={prepared.diagnostic.bank} />
                      <Fact label="Devise" value={prepared.diagnostic.currency} />
                      <Fact label="Format" value={prepared.diagnostic.sourceFormat} />
                      <Fact label="Mode" value={prepared.diagnostic.requestedMode} />
                      <Fact label="Compte masqué" value={prepared.diagnostic.accountNumberMasked ?? 'N/A'} />
                      <Fact label="Validation" value={prepared.diagnostic.parserValidationStatus} />
                      <Fact label="Période" value={`${prepared.diagnostic.periodStart} → ${prepared.diagnostic.periodEnd}`} />
                      <Fact label="Unités" value={String(prepared.diagnostic.unitsCount)} />
                      <Fact label="Unités à revoir" value={String(prepared.diagnostic.reviewRequiredUnitsCount)} />
                      <Fact label="Lignes" value={String(prepared.diagnostic.lineCount)} />
                      <Fact label="Provisional" value={String(prepared.diagnostic.provisionalUnitsCount)} />
                      <Fact label="Fichier préparé" value={prepared.diagnostic.sourceFileName} />
                      <Fact label="Compte du dépôt" value={preparedAccountLabel} />
                      <Fact label="Date de référence export" value={prepared.payload.p_attempt.export_reference_date ?? 'aucune'} />
                    </div>
                    {preparedAssessment && (
                      <div className="space-y-3 rounded border p-3 text-sm" aria-label="Contrôle de la date d’export">
                        <p>
                          Journées demandées provisoires : <strong>{preparedAssessment.provisionalDates.join(', ') || 'aucune'}</strong>
                          {' '}· journées non provisoires : <strong>{preparedAssessment.nonProvisionalDatesCount}</strong>
                          {' '}· dernière journée du fichier : <strong>{preparedAssessment.latestAccountingDate}</strong>
                        </p>
                        <p className="text-muted-foreground">
                          Statuts demandés par cette préparation : ils ne démontrent ni la clôture bancaire d’une journée ni sa disponibilité en Trésorerie, vérifiées côté serveur.
                        </p>
                        {preparedAssessment.issues.length > 0 && (
                          <Alert variant={preparedAssessment.blocking ? 'destructive' : 'default'}>
                            <AlertTitle>{preparedAssessment.blocking ? 'Date incohérente : dépôt bloqué' : 'Points à vérifier avant confirmation'}</AlertTitle>
                            <AlertDescription>
                              <ul className="list-disc pl-5">{exportReferenceIssueMessages(preparedAssessment).map((message) => <li key={message}>{message}</li>)}</ul>
                            </AlertDescription>
                          </Alert>
                        )}
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={preparationConfirmed}
                            disabled={preparedAssessment.blocking}
                            onChange={(event) => setConfirmedPreparation(event.target.checked ? prepared : null)}
                          />
                          <span>
                            {preparedAssessment.referenceDate
                              ? `Je confirme que la date d’export ${preparedAssessment.referenceDate} correspond au fichier « ${prepared.diagnostic.sourceFileName} », pour le compte « ${preparedAccountLabel} ».`
                              : `Je confirme déposer « ${prepared.diagnostic.sourceFileName} » sans date de référence export, pour le compte « ${preparedAccountLabel} ».`}
                          </span>
                        </label>
                        {preparedAccountChanged && (
                          <p className="text-destructive">Le compte sélectionné a changé depuis cette préparation : préparez de nouveau.</p>
                        )}
                      </div>
                    )}
                    {prepared.diagnostic.reviewReasonCodes.length > 0 && (
                      <Alert>
                        <AlertTitle>Revue humaine requise</AlertTitle>
                        <AlertDescription className="mt-2">
                          <ReviewReasonList codes={prepared.diagnostic.reviewReasonCodes} />
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button onClick={() => depositMutation.mutate()} disabled={!canSubmitDeposit || depositMutation.isPending || depositBlocked}>
                      {depositMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Déposer via RPC
                    </Button>
                    {!canSubmitDeposit && (
                      <p className="text-sm text-muted-foreground">
                        Payload préparé localement. Persistance bloquée par le verrou serveur.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {incrementalDelta && (
                <Card>
                  <CardHeader>
                    <CardTitle>Synthèse incrémentale BIS</CardTitle>
                    <CardDescription>
                      Les journées canonical strictement identiques ne sont pas retransmises à la RPC.
                      Toute journée nouvelle, modifiée ou à réconcilier reste soumise à l’arbitrage serveur.
                      Une journée ignorée ne crée donc ni tentative ni événement d’audit supplémentaire en base.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm md:grid-cols-4">
                    <Fact label="Journées du fichier" value={String(incrementalDelta.sourceUnits)} />
                    <Fact label="Identiques ignorées" value={String(incrementalDelta.identicalUnitsSkipped)} />
                    <Fact label="Nouvelles" value={String(incrementalDelta.newUnits)} />
                    <Fact label="Modifiées à revoir" value={String(incrementalDelta.changedUnits)} />
                    <Fact label="À réconcilier serveur" value={String(incrementalDelta.serverReconciliationUnits)} />
                    <Fact label="Journées déposées" value={String(incrementalDelta.submittedUnits)} />
                    <Fact label="Lignes du fichier" value={String(incrementalDelta.sourceLines)} />
                    <Fact label="Lignes ignorées" value={String(incrementalDelta.identicalLinesSkipped)} />
                    <Fact label="Lignes déposées" value={String(incrementalDelta.submittedLines)} />
                  </CardContent>
                </Card>
              )}

              {depositResult && (
                <Card>
                  <CardHeader><CardTitle>Résultat du dépôt</CardTitle><CardDescription>Tentative {shortId(depositResult.attempt_id)}</CardDescription></CardHeader>
                  <CardContent className="space-y-2">
                    {depositResult.units.map((unit) => (
                      <div key={unit.staging_unit_id} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{shortId(unit.day_unit_id)}</span><StatusBadge status={unit.unit_status} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="staging">
          {!canReadStaging ? <AccessDenied text="Staging réservé aux rôles admin et manager." /> : (
            <ListCard title="Unités staging" loading={stagingQuery.isLoading} error={stagingQuery.isError} onRefresh={refreshReview}>
              <div className="mb-4 grid max-w-4xl gap-3 sm:grid-cols-3">
                <Select value={stagingAccount} onValueChange={(value: DailyV2StagingAccountFilter) => { setStagingAccount(value); setStagingPage(0); closeReviewDecisions(); }}>
                  <SelectTrigger aria-label="Filtrer par compte"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les comptes</SelectItem>
                    {reviewAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>{formatDailyV2AccountOption(account)}</SelectItem>
                    ))}
                    <SelectItem value="unregistered">Sans compte du registre</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={stagingStatus} onValueChange={(value: 'all' | DailyV2StagingStatus) => { setStagingStatus(value); setStagingPage(0); closeReviewDecisions(); }}>
                  <SelectTrigger aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGING_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={stagingReview} onValueChange={(value: 'all' | 'required' | 'clear') => { setStagingReview(value); setStagingPage(0); closeReviewDecisions(); }}>
                  <SelectTrigger aria-label="Filtrer par revue"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les revues</SelectItem>
                    <SelectItem value="required">Revue requise</SelectItem>
                    <SelectItem value="clear">Sans revue technique</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reviewAccountsQuery.isError && reviewAccountsById !== null && (
                <p className="mb-2 text-sm text-destructive" data-review-registry="failed">
                  Dernière lecture du registre des comptes en échec : les comptes affichés viennent d’une lecture antérieure et peuvent être périmés. Les décisions sur les unités rattachées au registre sont suspendues jusqu’à une relecture réussie.
                </p>
              )}
              {stagingAccountLabel !== null && (
                <p className="mb-2 text-sm text-muted-foreground" data-staging-account-filter={stagingAccount}>
                  Filtre serveur appliqué avant la pagination : <strong>{stagingAccountLabel}</strong> — {stagingQuery.data?.count ?? 0} unité(s).
                </p>
              )}
              <StagingTable rows={stagingQuery.data?.rows ?? []} accountsById={reviewAccountsById} isAdmin={isAdmin} canDecide={canDecide} onLines={(unit) => setLineDialog({ kind: 'staging', id: unit.id, title: `${unit.bank} ${unit.accounting_date}` })} onDecision={(kind, unit) => {
                if (!canDecide) {
                  toast.error(READ_ONLY_TARGET_MESSAGE);
                  return;
                }
                setReason('');
                setDecisionDialog({ kind, unit, context: captureDailyV2StagingDecisionContext(reviewKey, unit) });
              }} onVersions={(unit) => setVersionsUnit(unit)} />
              <Pager page={stagingPage} count={stagingQuery.data?.count ?? 0} onChange={(page) => { setStagingPage(page); closeReviewDecisions(); }} />
            </ListCard>
          )}
        </TabsContent>

        <TabsContent value="canonical">
          {!canReadCanonical ? <AccessDenied text="Canonical réservé aux rôles admin et auditor." /> : (
            <ListCard title="Unités canonical" loading={canonicalQuery.isLoading} error={canonicalQuery.isError} onRefresh={() => canonicalQuery.refetch()}>
              <div className="mb-4 max-w-xs">
                <Select value={canonicalStatus} onValueChange={(value: 'all' | 'ingested' | 'superseded') => { setCanonicalStatus(value); setCanonicalPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">all</SelectItem><SelectItem value="ingested">active</SelectItem><SelectItem value="superseded">superseded</SelectItem></SelectContent>
                </Select>
              </div>
              <CanonicalTable rows={canonicalQuery.data?.rows ?? []} onLines={(unit) => setLineDialog({ kind: 'canonical', id: unit.id, title: `${unit.bank} ${unit.accounting_date}` })} />
              <Pager page={canonicalPage} count={canonicalQuery.data?.count ?? 0} onChange={setCanonicalPage} />
            </ListCard>
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          {!canReadAudit ? <AccessDenied text="Audit réservé aux rôles admin et auditor." /> : (
            <>
              <ListCard title="Audit des imports" loading={auditQuery.isLoading} error={auditQuery.isError} onRefresh={() => auditQuery.refetch()}>
                <AuditTable rows={auditQuery.data?.rows ?? []} />
                <Pager page={auditPage} count={auditQuery.data?.count ?? 0} onChange={setAuditPage} />
              </ListCard>
              <ListCard title="Audit du registre et des grants" loading={accountAuditQuery.isLoading} error={accountAuditQuery.isError} onRefresh={() => accountAuditQuery.refetch()}>
                <AccountAuditTable rows={accountAuditQuery.data?.rows ?? []} />
                <Pager page={accountAuditPage} count={accountAuditQuery.data?.count ?? 0} onChange={setAccountAuditPage} />
              </ListCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="reporting">
          {!canReadCanonical ? <AccessDenied text="Reporting réservé aux rôles admin et auditor." /> : <DailyV2Reporting />}
        </TabsContent>
      </Tabs>

      <Dialog open={lineDialog !== null} onOpenChange={(open) => !open && setLineDialog(null)}>
        <DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Lignes — {lineDialog?.title}</DialogTitle><DialogDescription>Affichage soumis aux politiques RLS Daily v2.</DialogDescription></DialogHeader>
          <LinesTable rows={lineRows ?? []} loading={lineLoading} />
        </DialogContent>
      </Dialog>

      <DailyV2DayDecisionsDialog unit={versionsUnit} onClose={() => setVersionsUnit(null)} canDecide={canDecide}
        canAdminister={canAdminister} onBatch={(attemptId) => { setVersionsUnit(null); setBatchAttemptId(attemptId); }}
        onChanged={() => { void invalidateDailyV2(queryClient); }} />
      <DailyV2BatchApprovalDialog attemptId={batchAttemptId} onClose={() => setBatchAttemptId(null)} canDecide={canDecide}
        onChanged={() => { void invalidateDailyV2(queryClient); }} />

      <Dialog open={decisionDialog !== null} onOpenChange={(open) => !open && closeDecision()}>
        <DialogContent><DialogHeader><DialogTitle>{decisionDialog?.kind === 'supersede' ? 'Supersede canonical' : 'Promouvoir l’unité'}</DialogTitle><DialogDescription>Décision admin auditée. Les conflits ne sont jamais promus automatiquement.</DialogDescription></DialogHeader>
          {decisionDialog && decisionAccount && (
            <div className="grid gap-2 rounded border p-3 text-sm sm:grid-cols-2" aria-label="Unité concernée">
              <Fact label="Compte" value={`${decisionAccount.alias}${decisionAccount.inactive ? ' (inactif)' : ''}${decisionAccount.masked ? ` — ${decisionAccount.masked}` : ''}`} />
              <Fact label="Journée" value={`${decisionDialog.unit.accounting_date} · ${decisionDialog.unit.bank}/${decisionDialog.unit.currency}`} />
              <Fact label="Tentative" value={decisionDialog.unit.attempt_id.slice(0, 8)} />
              <Fact label="Unité" value={decisionDialog.unit.id.slice(0, 8)} />
            </div>
          )}
          {decisionDialog && !decisionAccountIdentified && (
            <Alert variant="destructive"><AlertTitle>Compte non identifiable</AlertTitle><AlertDescription>{UNIDENTIFIED_DECISION_ACCOUNT_MESSAGE}</AlertDescription></Alert>
          )}
          {decisionDialog && stagingRefreshing && (
            <p className="text-sm text-muted-foreground">Revue en cours d’actualisation : la confirmation reprend une fois la liste relue.</p>
          )}
          {decisionDialog && stagingQuery.isError && !stagingRefreshing && (
            <p className="text-sm text-destructive">{REVIEW_READ_FAILED_MESSAGE}</p>
          )}
          {decisionRegistryHold === 'REGISTRY_REFRESHING' && (
            <p className="text-sm text-muted-foreground">{DAILY_V2_DECISION_REGISTRY_HOLD_MESSAGES.REGISTRY_REFRESHING}</p>
          )}
          {decisionRegistryHold === 'REGISTRY_READ_FAILED' && (
            <p className="text-sm text-destructive">{DAILY_V2_DECISION_REGISTRY_HOLD_MESSAGES.REGISTRY_READ_FAILED}</p>
          )}
          {decisionDialog && decisionReadFailed && (
            <div><Button size="sm" variant="outline" onClick={refreshReview}>Relire la revue et le registre</Button></div>
          )}
          {decisionDialog && decisionReviewCodes.length > 0 && (
            <Alert>
              <AlertTitle>Motifs à examiner avant décision</AlertTitle>
              <AlertDescription className="mt-2"><ReviewReasonList codes={decisionReviewCodes} /></AlertDescription>
            </Alert>
          )}
          {/* Un motif saisi reste visible, et donc relisible, même si une relecture lève l'obligation : rien n'est transmis à l'insu. */}
          {(reasonRequired || reason.trim() !== '') && <Field label={reasonRequired ? 'Raison obligatoire' : 'Raison saisie (sera transmise)'}><Textarea value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>}
          <DialogFooter><Button variant="outline" onClick={closeDecision}>Annuler</Button><Button disabled={!canDecide || Boolean(reasonRequired && !reason.trim()) || promoteMutation.isPending || supersedeMutation.isPending || stagingRefreshing || stagingQuery.isError || decisionRegistryHold !== null || !decisionAccountIdentified} onClick={confirmDecision}>Confirmer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function showSafeError(error: unknown, fallback: string) {
  if (error instanceof DailyV2ServiceError) {
    toast.error(error.message, {
      description: error.safeCode ? `Code : ${error.safeCode}` : undefined,
    });
    return;
  }
  toast.error(fallback);
}

export default DailyStatementV2;
