import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  prepareDailyV2BrowserDeposit,
  type DailyV2BrowserRequestedMode,
  type DailyV2SupportedBank,
  type PrepareDailyV2BrowserResult,
} from '@/features/daily-v2/dailyV2BrowserPipeline';
import {
  DailyV2ServiceError,
  getActiveDailyV2CanonicalUnit,
  getDailyV2AccountOpaqueIdentity,
  getCurrentUserDailyV2Roles,
  listDailyV2Accounts,
  listDailyV2AccountEvents,
  listDailyV2BackfillGrants,
  listDailyV2AuditEvents,
  listDailyV2CanonicalLines,
  listDailyV2CanonicalUnits,
  listDailyV2StagingLines,
  listDailyV2StagingUnits,
  preIngestDailyV2,
  provisionDailyV2Account,
  deactivateDailyV2Account,
  issueDailyV2BackfillGrant,
  revokeDailyV2BackfillGrant,
  promoteDailyV2Unit,
  supersedeDailyV2Unit,
} from '@/features/daily-v2/dailyV2SupabaseService';
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
import DailyV2Reporting from '@/features/daily-v2/DailyV2Reporting';

const PAGE_SIZE = 20;
const STAGING_STATUSES: Array<'all' | DailyV2StagingStatus> = [
  'all', 'staged', 'provisional', 'duplicate', 'conflict',
  'needs_review', 'promoted', 'promotion_failed', 'superseded',
];

type LineDialog =
  | { kind: 'staging'; id: string; title: string }
  | { kind: 'canonical'; id: string; title: string }
  | null;

type DecisionDialog =
  | { kind: 'promote'; unit: DailyV2StagingUnitRow }
  | { kind: 'supersede'; unit: DailyV2StagingUnitRow }
  | null;

const DailyStatementV2 = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
  const [prepared, setPrepared] = useState<Extract<PrepareDailyV2BrowserResult, { success: true }> | null>(null);
  const [prepareErrors, setPrepareErrors] = useState<string[]>([]);
  const [depositResult, setDepositResult] = useState<DailyV2PreIngestResponse | null>(null);
  const [stagingPage, setStagingPage] = useState(0);
  const [stagingStatus, setStagingStatus] = useState<'all' | DailyV2StagingStatus>('all');
  const [stagingReview, setStagingReview] = useState<'all' | 'required' | 'clear'>('all');
  const [canonicalPage, setCanonicalPage] = useState(0);
  const [canonicalStatus, setCanonicalStatus] = useState<'all' | 'ingested' | 'superseded'>('all');
  const [auditPage, setAuditPage] = useState(0);
  const [accountAuditPage, setAccountAuditPage] = useState(0);
  const [lineDialog, setLineDialog] = useState<LineDialog>(null);
  const [decisionDialog, setDecisionDialog] = useState<DecisionDialog>(null);
  const [reason, setReason] = useState('');

  const rolesQuery = useQuery<DailyV2AppRole[]>({
    queryKey: ['daily-v2', 'roles', user?.id],
    queryFn: getCurrentUserDailyV2Roles,
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  });
  const roles = rolesQuery.data ?? [];
  const isAdmin = roles.includes('admin');
  const canDeposit = isAdmin || roles.includes('manager');
  const canReadStaging = canDeposit;
  const canReadCanonical = isAdmin || roles.includes('auditor');
  const canReadAudit = canReadCanonical;
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
    enabled: isAdmin && requestedMode === 'backfill' && Boolean(accountRegistryId),
  });

  const resetPrepared = useCallback(() => {
    setPrepared(null);
    setPrepareErrors([]);
    setDepositResult(null);
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    setFile(accepted[0] ?? null);
    setReferenceDate('');
    setBackfillGrantId('');
    resetPrepared();
  }, [resetPrepared]);

  const dropzone = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  });

  const prepareMutation = useMutation<PrepareDailyV2BrowserResult, Error, void>({
    mutationFn: async () => {
      if (!file) throw new DailyV2ServiceError('Sélectionnez un fichier structuré CSV ou Excel.');
      if (requestedMode === 'backfill' && !isAdmin) {
        throw new DailyV2ServiceError('Le backfill est réservé au rôle admin.');
      }
      return prepareDailyV2BrowserDeposit({
        file,
        bank,
        currency,
        accountFingerprint: selectedAccount ? getDailyV2AccountOpaqueIdentity(selectedAccount) : '',
        accountRegistryId: selectedAccount?.id ?? '',
        registeredAccountNumberMasked: selectedAccount?.account_number_masked,
        exportReferenceDate: referenceDate.trim() || undefined,
        requestedMode,
        backfillGrantId: backfillGrantId || undefined,
      });
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

  const depositMutation = useMutation<DailyV2PreIngestResponse, Error, void>({
    mutationFn: async () => {
      if (!prepared) throw new DailyV2ServiceError('Aucun payload validé à déposer.');
      return preIngestDailyV2(prepared.payload);
    },
    onSuccess: async (result) => {
      setDepositResult(result);
      setPrepared(null);
      setFile(null);
      setReferenceDate('');
      setBackfillGrantId('');
      await invalidateDailyV2(queryClient);
      toast.success('Dépôt Daily v2 terminé');
    },
    onError: (error) => showSafeError(error, 'Dépôt impossible.'),
  });

  const provisionAccountMutation = useMutation({
    mutationFn: () => provisionDailyV2Account({
      bank,
      currency,
      safeAlias: newAccountAlias,
      accountNumberMasked: newAccountMasked || undefined,
    }),
    onSuccess: async (account) => {
      setNewAccountAlias('');
      setNewAccountMasked('');
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'accounts'] });
      setAccountRegistryId(account.id);
      toast.success('Compte Daily v2 provisionné');
    },
    onError: (error) => showSafeError(error, 'Provisionnement impossible.'),
  });

  const deactivateAccountMutation = useMutation({
    mutationFn: () => deactivateDailyV2Account({
      accountRegistryId,
      reason: accountDeactivationReason,
    }),
    onSuccess: async () => {
      setAccountRegistryId('');
      setAccountDeactivationReason('');
      resetPrepared();
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'accounts'] });
      toast.success('Compte Daily v2 désactivé');
    },
    onError: (error) => showSafeError(error, 'Désactivation impossible.'),
  });

  const issueGrantMutation = useMutation({
    mutationFn: () => issueDailyV2BackfillGrant({
      accountRegistryId,
      periodStart: grantPeriodStart,
      periodEnd: grantPeriodEnd,
      maxUnits: Number(grantMaxUnits),
      expiresAt: new Date(grantExpiresAt).toISOString(),
    }),
    onSuccess: async (grant) => {
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'backfill-grants'] });
      setRequestedMode('backfill');
      setBackfillGrantId(grant.id);
      resetPrepared();
      toast.success('Autorisation backfill provisionnée');
    },
    onError: (error) => showSafeError(error, 'Création du grant impossible.'),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: () => revokeDailyV2BackfillGrant({
      backfillGrantId,
      reason: grantRevocationReason,
    }),
    onSuccess: async () => {
      setBackfillGrantId('');
      setGrantRevocationReason('');
      resetPrepared();
      await queryClient.invalidateQueries({ queryKey: ['daily-v2', 'backfill-grants'] });
      toast.success('Autorisation backfill révoquée');
    },
    onError: (error) => showSafeError(error, 'Révocation du grant impossible.'),
  });

  const stagingQuery = useQuery<DailyV2Page<DailyV2StagingUnitRow>>({
    queryKey: ['daily-v2', 'staging', stagingPage, stagingStatus, stagingReview],
    queryFn: () => listDailyV2StagingUnits({
      page: stagingPage,
      pageSize: PAGE_SIZE,
      status: stagingStatus,
      review: stagingReview,
    }),
    enabled: canReadStaging,
  });
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
    mutationFn: ({ unit, approvalReason }: { unit: DailyV2StagingUnitRow; approvalReason?: string }) =>
      promoteDailyV2Unit(unit.id, approvalReason),
    onSuccess: async (result) => {
      closeDecision();
      await invalidateDailyV2(queryClient);
      toast.success(`Promotion : ${result.outcome}`);
    },
    onError: (error) => showSafeError(error, 'Promotion impossible.'),
  });

  const supersedeMutation = useMutation<
    DailyV2SupersedeResponse,
    Error,
    { unit: DailyV2StagingUnitRow; supersedeReason: string }
  >({
    mutationFn: async ({ unit, supersedeReason }: { unit: DailyV2StagingUnitRow; supersedeReason: string }) => {
      const active = await getActiveDailyV2CanonicalUnit(unit.day_unit_id);
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
      toast.success(`Supersede : ${result.outcome}`);
    },
    onError: (error) => showSafeError(error, 'Supersede impossible.'),
  });

  const closeDecision = () => {
    setDecisionDialog(null);
    setReason('');
  };
  const reasonRequired = decisionDialog?.kind === 'supersede' ||
    (decisionDialog?.kind === 'promote' &&
      (decisionDialog.unit.validation_status === 'needs_review' ||
       decisionDialog.unit.aggregates_status === 'unavailable' ||
       decisionDialog.unit.review_reason_codes.length > 0));
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

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Session requise</Badge>
        <Badge variant="secondary">Rôles : {rolesQuery.isLoading ? 'chargement…' : roles.join(', ') || 'aucun'}</Badge>
      </div>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="staging">Staging</TabsTrigger>
          <TabsTrigger value="canonical">Canonical</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="reporting">Reporting</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          {!canDeposit ? <AccessDenied text="Dépôt réservé aux rôles admin et manager." /> : (
            <>
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
                      <Select value={bank} onValueChange={(value: DailyV2SupportedBank) => { setBank(value); setAccountRegistryId(''); setReferenceDate(''); setRequestedMode('daily'); setBackfillGrantId(''); resetPrepared(); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                        <SelectTrigger><SelectValue placeholder={accountsQuery.isLoading ? 'Chargement…' : 'Choisir un compte actif'} /></SelectTrigger>
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
                      <Input value={referenceDate} onChange={(e) => { setReferenceDate(e.target.value); resetPrepared(); }} placeholder={bank === 'ORA' ? 'Recommandée pour ORA' : 'Optionnelle'} />
                    </Field>
                    <Field label="Mode de dépôt">
                      <Select value={requestedMode} onValueChange={(value: DailyV2BrowserRequestedMode) => { setRequestedMode(value); setBackfillGrantId(''); resetPrepared(); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily — 45 jours maximum</SelectItem>
                          {isAdmin && bank === 'BIS' && <SelectItem value="backfill">Backfill BIS admin — 4000 jours maximum</SelectItem>}
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
                  <div className="flex gap-2">
                    <Button onClick={() => prepareMutation.mutate()} disabled={!file || !selectedAccount || (requestedMode === 'backfill' && !backfillGrantId) || prepareMutation.isPending}>
                      {prepareMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Préparer
                    </Button>
                    <Button variant="outline" onClick={() => { setFile(null); setAccountRegistryId(''); setReferenceDate(''); setBackfillGrantId(''); resetPrepared(); }}>Réinitialiser</Button>
                  </div>
                </CardContent>
              </Card>

              {isAdmin && (
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
                        disabled={!newAccountAlias.trim() || provisionAccountMutation.isPending}
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
                            disabled={!accountDeactivationReason.trim() || deactivateAccountMutation.isPending}
                          >Désactiver ce compte</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Autorisation backfill BIS</CardTitle>
                      <CardDescription>Grant serveur à usage unique, borné par compte, période, volume et expiration.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!selectedAccount || bank !== 'BIS' ? (
                        <p className="text-sm text-muted-foreground">Sélectionnez un compte BIS actif pour provisionner un grant.</p>
                      ) : (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Début autorisé"><Input type="date" value={grantPeriodStart} onChange={(event) => setGrantPeriodStart(event.target.value)} /></Field>
                            <Field label="Fin autorisée"><Input type="date" value={grantPeriodEnd} onChange={(event) => setGrantPeriodEnd(event.target.value)} /></Field>
                            <Field label="Unités maximum"><Input type="number" min="1" max="4000" value={grantMaxUnits} onChange={(event) => setGrantMaxUnits(event.target.value)} /></Field>
                            <Field label="Expiration"><Input type="datetime-local" value={grantExpiresAt} onChange={(event) => setGrantExpiresAt(event.target.value)} /></Field>
                          </div>
                          <Button
                            onClick={() => issueGrantMutation.mutate()}
                            disabled={!grantPeriodStart || !grantPeriodEnd || !grantExpiresAt || !grantMaxUnits || issueGrantMutation.isPending}
                          >Créer un grant</Button>
                          {backfillGrantId && (
                            <div className="space-y-3 rounded border p-3">
                              <Field label="Raison de révocation">
                                <Textarea value={grantRevocationReason} maxLength={200} onChange={(event) => setGrantRevocationReason(event.target.value)} />
                              </Field>
                              <Button
                                variant="destructive"
                                onClick={() => revokeGrantMutation.mutate()}
                                disabled={!grantRevocationReason.trim() || revokeGrantMutation.isPending}
                              >Révoquer le grant sélectionné</Button>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

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
                    </div>
                    {prepared.diagnostic.reviewReasonCodes.length > 0 && (
                      <Alert>
                        <AlertTitle>Revue humaine requise</AlertTitle>
                        <AlertDescription className="mt-2">
                          <ReviewReasonList codes={prepared.diagnostic.reviewReasonCodes} />
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button onClick={() => depositMutation.mutate()} disabled={depositMutation.isPending}>
                      {depositMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Déposer via RPC
                    </Button>
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
            <ListCard title="Unités staging" loading={stagingQuery.isLoading} error={stagingQuery.isError} onRefresh={() => stagingQuery.refetch()}>
              <div className="mb-4 grid max-w-2xl gap-3 sm:grid-cols-2">
                <Select value={stagingStatus} onValueChange={(value: 'all' | DailyV2StagingStatus) => { setStagingStatus(value); setStagingPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGING_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={stagingReview} onValueChange={(value: 'all' | 'required' | 'clear') => { setStagingReview(value); setStagingPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les revues</SelectItem>
                    <SelectItem value="required">Revue requise</SelectItem>
                    <SelectItem value="clear">Sans revue technique</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <StagingTable rows={stagingQuery.data?.rows ?? []} isAdmin={isAdmin} onLines={(unit) => setLineDialog({ kind: 'staging', id: unit.id, title: `${unit.bank} ${unit.accounting_date}` })} onDecision={(kind, unit) => setDecisionDialog({ kind, unit })} />
              <Pager page={stagingPage} count={stagingQuery.data?.count ?? 0} onChange={setStagingPage} />
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

      <Dialog open={decisionDialog !== null} onOpenChange={(open) => !open && closeDecision()}>
        <DialogContent><DialogHeader><DialogTitle>{decisionDialog?.kind === 'supersede' ? 'Supersede canonical' : 'Promouvoir l’unité'}</DialogTitle><DialogDescription>Décision admin auditée. Les conflits ne sont jamais promus automatiquement.</DialogDescription></DialogHeader>
          {decisionDialog && decisionDialog.unit.review_reason_codes.length > 0 && (
            <Alert>
              <AlertTitle>Motifs à examiner avant décision</AlertTitle>
              <AlertDescription className="mt-2"><ReviewReasonList codes={decisionDialog.unit.review_reason_codes} /></AlertDescription>
            </Alert>
          )}
          {reasonRequired && <Field label="Raison obligatoire"><Textarea value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>}
          <DialogFooter><Button variant="outline" onClick={closeDecision}>Annuler</Button><Button disabled={Boolean(reasonRequired && !reason.trim()) || promoteMutation.isPending || supersedeMutation.isPending} onClick={() => {
            if (!decisionDialog) return;
            if (decisionDialog.kind === 'promote') promoteMutation.mutate({ unit: decisionDialog.unit, approvalReason: reason.trim() || undefined });
            else supersedeMutation.mutate({ unit: decisionDialog.unit, supersedeReason: reason });
          }}>Confirmer</Button></DialogFooter>
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
