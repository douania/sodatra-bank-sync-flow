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
  type PrepareDailyV2BrowserResult,
} from '@/features/daily-v2/dailyV2BrowserPipeline';
import {
  DailyV2ServiceError,
  getActiveDailyV2CanonicalUnit,
  getCurrentUserDailyV2Roles,
  listDailyV2AuditEvents,
  listDailyV2CanonicalLines,
  listDailyV2CanonicalUnits,
  listDailyV2StagingLines,
  listDailyV2StagingUnits,
  preIngestDailyV2,
  promoteDailyV2Unit,
  supersedeDailyV2Unit,
} from '@/features/daily-v2/dailyV2SupabaseService';
import type {
  DailyV2AppRole,
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
  AuditTable,
  CanonicalTable,
  ErrorList,
  Fact,
  Field,
  LinesTable,
  ListCard,
  Pager,
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
  const [bank, setBank] = useState<'BDK' | 'ORA'>('BDK');
  const [currency, setCurrency] = useState('XOF');
  const [fingerprint, setFingerprint] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [prepared, setPrepared] = useState<Extract<PrepareDailyV2BrowserResult, { success: true }> | null>(null);
  const [prepareErrors, setPrepareErrors] = useState<string[]>([]);
  const [depositResult, setDepositResult] = useState<DailyV2PreIngestResponse | null>(null);
  const [stagingPage, setStagingPage] = useState(0);
  const [stagingStatus, setStagingStatus] = useState<'all' | DailyV2StagingStatus>('all');
  const [canonicalPage, setCanonicalPage] = useState(0);
  const [canonicalStatus, setCanonicalStatus] = useState<'all' | 'ingested' | 'superseded'>('all');
  const [auditPage, setAuditPage] = useState(0);
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

  const resetPrepared = useCallback(() => {
    setPrepared(null);
    setPrepareErrors([]);
    setDepositResult(null);
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    setFile(accepted[0] ?? null);
    setFingerprint('');
    setReferenceDate('');
    resetPrepared();
  }, [resetPrepared]);

  const dropzone = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  });

  const prepareMutation = useMutation<PrepareDailyV2BrowserResult, Error, void>({
    mutationFn: async () => {
      if (!file) throw new DailyV2ServiceError('Sélectionnez un fichier CSV.');
      return prepareDailyV2BrowserDeposit({
        file,
        bank,
        currency,
        accountFingerprint: fingerprint,
        exportReferenceDate: referenceDate.trim() || undefined,
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
      setFingerprint('');
      setReferenceDate('');
      await invalidateDailyV2(queryClient);
      toast.success('Dépôt Daily v2 terminé');
    },
    onError: (error) => showSafeError(error, 'Dépôt impossible.'),
  });

  const stagingQuery = useQuery<DailyV2Page<DailyV2StagingUnitRow>>({
    queryKey: ['daily-v2', 'staging', stagingPage, stagingStatus],
    queryFn: () => listDailyV2StagingUnits({ page: stagingPage, pageSize: PAGE_SIZE, status: stagingStatus }),
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
      (decisionDialog.unit.validation_status === 'needs_review' || decisionDialog.unit.aggregates_status === 'unavailable'));
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
          Aucun CSV brut, numéro complet ou IBAN n’est envoyé en base. Les actions restent soumises à Auth, RLS et rôles serveur.
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
                  <CardTitle>Préparer un CSV structuré</CardTitle>
                  <CardDescription>BDK ou ORA, 10 MB maximum. Le fingerprint doit être pré-provisionné.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div {...dropzone.getRootProps()} className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center">
                    <input {...dropzone.getInputProps()} />
                    <Upload className="mx-auto h-8 w-8" />
                    <p className="mt-2 font-medium">{file?.name ?? 'Déposez un CSV'}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Banque">
                      <Select value={bank} onValueChange={(value: 'BDK' | 'ORA') => { setBank(value); setFingerprint(''); setReferenceDate(''); resetPrepared(); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="BDK">BDK</SelectItem><SelectItem value="ORA">ORABANK</SelectItem></SelectContent>
                      </Select>
                    </Field>
                    <Field label="Devise">
                      <Input value={currency} maxLength={8} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setFingerprint(''); resetPrepared(); }} />
                    </Field>
                    <Field label="Account fingerprint pré-provisionné">
                      <Input type="password" autoComplete="off" value={fingerprint} onChange={(e) => { setFingerprint(e.target.value); resetPrepared(); }} />
                    </Field>
                    <Field label="Date de référence export (DD/MM/YYYY)">
                      <Input value={referenceDate} onChange={(e) => { setReferenceDate(e.target.value); resetPrepared(); }} placeholder={bank === 'ORA' ? 'Recommandée pour ORA' : 'Optionnelle'} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => prepareMutation.mutate()} disabled={!file || !fingerprint.trim() || prepareMutation.isPending}>
                      {prepareMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Préparer
                    </Button>
                    <Button variant="outline" onClick={() => { setFile(null); setFingerprint(''); setReferenceDate(''); resetPrepared(); }}>Réinitialiser</Button>
                  </div>
                </CardContent>
              </Card>

              {prepareErrors.length > 0 && <ErrorList title="Préparation refusée" errors={prepareErrors} />}

              {prepared && (
                <Card>
                  <CardHeader><CardTitle>Payload prêt</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4 text-sm">
                      <Fact label="Banque" value={prepared.diagnostic.bank} />
                      <Fact label="Devise" value={prepared.diagnostic.currency} />
                      <Fact label="Compte masqué" value={prepared.diagnostic.accountNumberMasked ?? 'N/A'} />
                      <Fact label="Validation" value={prepared.diagnostic.parserValidationStatus} />
                      <Fact label="Période" value={`${prepared.diagnostic.periodStart} → ${prepared.diagnostic.periodEnd}`} />
                      <Fact label="Unités" value={String(prepared.diagnostic.unitsCount)} />
                      <Fact label="Lignes" value={String(prepared.diagnostic.lineCount)} />
                      <Fact label="Provisional" value={String(prepared.diagnostic.provisionalUnitsCount)} />
                    </div>
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
              <div className="mb-4 max-w-xs">
                <Select value={stagingStatus} onValueChange={(value: 'all' | DailyV2StagingStatus) => { setStagingStatus(value); setStagingPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGING_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
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

        <TabsContent value="audit">
          {!canReadAudit ? <AccessDenied text="Audit réservé aux rôles admin et auditor." /> : (
            <ListCard title="Audit trail" loading={auditQuery.isLoading} error={auditQuery.isError} onRefresh={() => auditQuery.refetch()}>
              <AuditTable rows={auditQuery.data?.rows ?? []} />
              <Pager page={auditPage} count={auditQuery.data?.count ?? 0} onChange={setAuditPage} />
            </ListCard>
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
