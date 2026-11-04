import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildRawBytesHash } from './dailyV2BrowserPipeline';
import {
  attestDailyV2Attempt,
  dailyV2DecisionCommandKeys,
  getActiveDailyV2CanonicalUnit,
  getDailyV2RefutationStatus,
  listDailyV2AttemptAttestations,
  listDailyV2AttemptsUnits,
  listDailyV2DayDeliveries,
  listDailyV2VersionRefutations,
  rejectDailyV2Unit,
  refuteDailyV2Version,
  revokeDailyV2AttemptAttestation,
  revokeDailyV2VersionRefutation,
  supersedeDailyV2UnitBalances,
} from './dailyV2SupabaseService';
import { useDailyV2ScopedMutation as useMutation } from './session/dailyV2SessionScope';
import {
  activeAttestations,
  canonicalVersionFacts,
  COMPARISON_LABELS,
  DAILY_V2_ATTESTABLE_CODES,
  DAILY_V2_PENDING_STATUSES,
  DAILY_V2_PIECE_MENTION,
  dailyV2FreshDeliveryBound,
  dailyV2PieceRequirements,
  dailyV2SourceVerdicts,
  dailyV2VersionKey,
  describeDailyV2RefutationEffect,
  groupDailyV2DayVersions,
  isBalanceCorrectionCandidate,
  isDailyV2AmountText,
  isRefutable,
  stagingVersionFacts,
  type DailyV2AttemptAttestationRow,
  type DailyV2AttestationType,
  type DailyV2CanonicalUnitRow,
  type DailyV2DayVersion,
  type DailyV2ExportAttemptRow,
  type DailyV2RefutationProof,
  type DailyV2StagingUnitRow,
  type DailyV2VersionRefutationRow,
} from './dailyV2Types';

// Lot 1 opérationnel (R6 § 5) : versions d'une journée, issues de comparaison
// et décisions de l'administrateur. Les règles de version (clé, cohérence,
// comparaison, sources, justification) sont les fonctions pures de
// dailyV2Types ; le serveur les recalcule sous verrou et refuse tout écart avec
// l'état affiché (« STALE »). Rien n'est décidé ici. Une réfutation est
// affichée en deux temps (P2 de la contre-revue CTO de la PR #156) : la
// décision enregistrée, puis son effectivité actuelle telle que le serveur la
// rend (effective, partielle, suspendue, ou non vérifiable) ; aucune
// effectivité n'est déduite dans le navigateur. Une lecture en échec ou
// incomplète suspend les décisions qui en dépendent.

function amount(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}

type Action =
  | { kind: 'reject'; unit: DailyV2StagingUnitRow }
  | { kind: 'balances'; unit: DailyV2StagingUnitRow }
  | { kind: 'refute'; version: DailyV2DayVersion }
  | { kind: 'revoke-refutation'; refutation: DailyV2VersionRefutationRow }
  | { kind: 'attest'; attempt: DailyV2ExportAttemptRow; type: DailyV2AttestationType }
  | { kind: 'revoke-attestation'; attestation: DailyV2AttemptAttestationRow };

export function DailyV2DayDecisionsDialog({ unit, onClose, canDecide, canAdminister, onBatch, onChanged }: {
  unit: DailyV2StagingUnitRow | null;
  onClose: () => void;
  /** Rôle admin ET capacité promote : écartement, correction des soldes, réfutation, approbation groupée. */
  canDecide: boolean;
  /** Rôle admin ET capacité admin : attestations de fichier. */
  canAdminister: boolean;
  onBatch: (attemptId: string) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const dayUnitId = unit?.day_unit_id ?? null;
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const deliveriesQuery = useQuery({
    queryKey: ['daily-v2', 'day-deliveries', dayUnitId],
    queryFn: () => listDailyV2DayDeliveries(dayUnitId!),
    enabled: dayUnitId !== null,
  });
  const activeQuery = useQuery({
    queryKey: ['daily-v2', 'day-active', dayUnitId],
    queryFn: () => getActiveDailyV2CanonicalUnit(dayUnitId!),
    enabled: dayUnitId !== null,
  });
  const refutationsQuery = useQuery({
    queryKey: ['daily-v2', 'day-refutations', dayUnitId],
    queryFn: () => listDailyV2VersionRefutations(dayUnitId!),
    enabled: dayUnitId !== null,
  });
  const attemptIds = (deliveriesQuery.data?.attempts ?? []).map((attempt) => attempt.id).sort();
  const attestationsQuery = useQuery({
    queryKey: ['daily-v2', 'attestations', attemptIds],
    queryFn: () => listDailyV2AttemptAttestations(attemptIds),
    enabled: attemptIds.length > 0,
  });
  const hasRecordedRefutation = (refutationsQuery.data?.refutations ?? []).some((row) => row.action === 'REFUTE');
  const refutationStatusQuery = useQuery({
    queryKey: ['daily-v2', 'refutation-status', dayUnitId],
    queryFn: () => getDailyV2RefutationStatus(dayUnitId!),
    enabled: dayUnitId !== null && hasRecordedRefutation,
  });

  // Lecture en échec ou incomplète : signalée, et les décisions qui en dépendent
  // sont suspendues (aucune version n'est construite sur une base partielle).
  const failedRead = [deliveriesQuery, activeQuery, refutationsQuery].find((query) => query.isError);
  const readError = failedRead?.error instanceof Error ? failedRead.error.message
    : failedRead ? 'Lecture impossible.' : null;
  const attestationsError = attestationsQuery.isError
    ? (attestationsQuery.error instanceof Error ? attestationsQuery.error.message : 'Lecture des attestations impossible.')
    : null;
  const active = activeQuery.data ?? null;
  const retainedFacts = active ? canonicalVersionFacts(active) : null;
  let versions: DailyV2DayVersion[] = [];
  let versionError: string | null = null;
  if (readError === null && deliveriesQuery.data && refutationsQuery.data && !activeQuery.isLoading) {
    try {
      versions = groupDailyV2DayVersions({
        units: deliveriesQuery.data.units, attempts: deliveriesQuery.data.attempts, active,
        refutations: refutationsQuery.data.refutations,
      });
    } catch {
      versionError = 'Versions non calculables localement (montant hors plage exacte ou contexte manquant) : aucune décision possible.';
    }
  }
  // Une lecture en cours ou en échec ne réutilise jamais un statut précédent :
  // l'effectivité est alors « non vérifiable » (revue indépendante, F1).
  const refutationStatusError = refutationStatusQuery.isError
    ? (refutationStatusQuery.error instanceof Error ? refutationStatusQuery.error.message : 'Lecture impossible.')
    : null;
  const refutationEffect = (refutationId: string) => (refutationStatusQuery.isFetching
    ? { state: 'NOT_VERIFIABLE' as const, label: 'Effectivité actuelle : vérification en cours sur le serveur.', newProofNeeded: false }
    : describeDailyV2RefutationEffect(refutationId, refutationStatusError === null ? refutationStatusQuery.data ?? null : null));
  const unitAttempt = deliveriesQuery.data?.attempts.find((attempt) => attempt.id === unit?.attempt_id) ?? null;
  const attestations = (attestationsQuery.data ?? []).filter((row) => row.attempt_id === unitAttempt?.id);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['daily-v2'] });
    onChanged();
  };

  const decision = useMutation<unknown, Error, { signature: unknown[]; run: (key: string) => Promise<unknown>; done: string }>({
    mutationFn: async ({ signature, run }) => {
      const key = dailyV2DecisionCommandKeys.keyFor(JSON.stringify(signature));
      const result = await run(key);
      dailyV2DecisionCommandKeys.succeeded(key);
      return result;
    },
    onSuccess: (_data, variables) => {
      setMessage(variables.done);
      setAction(null);
      setReason('');
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  const close = () => {
    setAction(null);
    setReason('');
    setMessage(null);
    onClose();
  };

  return (
    <Dialog open={unit !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Versions et décisions — {unit?.bank} {unit?.accounting_date}</DialogTitle>
          <DialogDescription>
            Livraisons regroupées par identité des mouvements et version financière. Le serveur revérifie chaque décision
            sous verrou et refuse tout écart avec cet affichage.
          </DialogDescription>
        </DialogHeader>
        {readError && (
          <p role="alert" className="text-sm text-destructive">{readError} Les décisions de la journée sont suspendues.</p>
        )}
        {versionError && <p role="alert" className="text-sm text-destructive">{versionError}</p>}
        {refutationStatusError && (
          <p role="alert" className="text-sm text-destructive">
            {refutationStatusError} L’effectivité actuelle des réfutations n’est pas vérifiable.
          </p>
        )}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm" aria-label="Versions de la journée">
          {versions.map((version) => (
            <div key={version.key} className="rounded border p-3" data-version-retained={version.retained}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={version.retained ? 'default' : 'secondary'}>{version.retained ? 'Version retenue' : 'Autre version'}</Badge>
                {version.comparison && !version.retained && (
                  <Badge variant={version.comparison === 'CONTRADICTION' ? 'destructive' : 'outline'}>
                    {COMPARISON_LABELS[version.comparison]}
                  </Badge>
                )}
                {version.refutation && (
                  <Badge variant="outline">
                    Réfutation enregistrée le {version.refutation.created_at.slice(0, 10)} —{' '}
                    {version.refutation.proof_kind === 'BANK_PIECE' ? 'pièce corrective' : 'livraison fraîche'}
                    {' '}(borne {version.refutation.proof_bound_day})
                  </Badge>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs md:grid-cols-6">
                <span>Agrégats : {version.facts.aggregates}</span>
                <span>Ouverture : {amount(version.facts.opening)}</span>
                <span>Clôture : {amount(version.facts.closing)}</span>
                <span>Débits : {amount(version.facts.debits)}</span>
                <span>Crédits : {amount(version.facts.credits)}</span>
                <span>Mouvements : <span className="font-mono">{shortHash(version.facts.hash)}</span></span>
              </div>
              {version.refutation?.proof_kind === 'BANK_PIECE' && <p className="mt-1 text-xs">{DAILY_V2_PIECE_MENTION}</p>}
              {version.refutation && (() => {
                const effect = refutationEffect(version.refutation.id);
                return (
                  <p className={`mt-1 text-xs ${effect.state === 'EFFECTIVE' ? '' : 'text-destructive'}`}
                    data-refutation-effect={effect.state} aria-label="Effectivité actuelle de la réfutation">
                    {effect.label}
                  </p>
                );
              })()}
              <ul className="mt-2 space-y-1 text-xs">
                {version.deliveries.map((delivery) => (
                  <li key={delivery.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{delivery.status}</Badge>
                    <span>déposée le {delivery.created_at.slice(0, 10)}</span>
                    {canDecide && (DAILY_V2_PENDING_STATUSES as readonly string[]).includes(delivery.status) && (
                      <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'reject', unit: delivery })}>Écarter</Button>
                    )}
                    {canDecide && isBalanceCorrectionCandidate(delivery, active) && (
                      <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'balances', unit: delivery })}>
                        Corriger les seuls soldes
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {canDecide && isRefutable(version, retainedFacts) && (
                  <Button size="sm" variant="destructive" onClick={() => setAction({ kind: 'refute', version })}>
                    Réfuter cette version
                  </Button>
                )}
                {canDecide && version.refutation && (
                  <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'revoke-refutation', refutation: version.refutation! })}>
                    Révoquer la réfutation
                  </Button>
                )}
              </div>
            </div>
          ))}
          {attestationsError && (
            <p role="alert" className="text-sm text-destructive">
              {attestationsError} Les attestations et l’approbation groupée sont suspendues.
            </p>
          )}
          {unitAttempt && readError === null && (
            <FileSection attempt={unitAttempt} attestations={attestations}
              canAdminister={canAdminister && attestationsError === null && !attestationsQuery.isLoading}
              canDecide={canDecide && attestationsError === null && !attestationsQuery.isLoading}
              onAttest={(type) => setAction({ kind: 'attest', attempt: unitAttempt, type })}
              onRevoke={(attestation) => setAction({ kind: 'revoke-attestation', attestation })}
              onBatch={() => onBatch(unitAttempt.id)} />
          )}
        </div>
        {action && (
          <div className="space-y-2 rounded border bg-muted/30 p-3 text-sm" aria-label="Décision en cours">
            {action.kind === 'reject' && (
              <p>Écarter la livraison du {action.unit.accounting_date} ({action.unit.status}). Un écartement sort une livraison de
                l’attente ; il ne lève ni une contradiction ni une incertitude.</p>
            )}
            {action.kind === 'balances' && (
              <p>Adopter les soldes de cette livraison (mêmes mouvements) comme version retenue. Ses lignes conservées doivent
                être complètes et conformes ; sinon redéposez le fichier.</p>
            )}
            {action.kind === 'revoke-refutation' && <p>Révoquer la réfutation : la version redevient une contradiction ou une incertitude.</p>}
            {action.kind === 'revoke-attestation' && <p>Révoquer l’attestation {action.attestation.attestation_type}.</p>}
            {action.kind === 'refute' && active && deliveriesQuery.data && (
              <RefuteForm version={action.version} active={active} deliveries={deliveriesQuery.data}
                reason={reason} pending={decision.isPending}
                onSubmit={(proof) => decision.mutate({
                  signature: ['refute', action.version.key, proof, reason],
                  run: (key) => refuteDailyV2Version(key, {
                    dayUnitId: active.day_unit_id, refutedVersionKey: action.version.key,
                    expectedRetainedVersionKey: dailyV2VersionKey(canonicalVersionFacts(active)),
                    expectedSources: action.version.sources.map(({ raw_text_hash, account_registry_id, first_seen_at }) =>
                      ({ raw_text_hash, account_registry_id, first_seen_at })),
                    proof, reason,
                  }),
                  done: 'Version réfutée.',
                })} />
            )}
            {action.kind === 'attest' && (
              <AttestForm attempt={action.attempt} type={action.type} reason={reason} pending={decision.isPending}
                onSubmit={(rawTextHash, evidenceRef, currency) => decision.mutate({
                  signature: ['attest', action.attempt.id, action.type, rawTextHash, evidenceRef, currency, reason],
                  run: (key) => attestDailyV2Attempt(key, {
                    attemptId: action.attempt.id, attestationType: action.type, rawTextHash,
                    accountRegistryId: action.attempt.account_registry_id ?? '', currency, evidenceRef, reason,
                  }),
                  done: 'Attestation enregistrée.',
                })} />
            )}
            <Textarea aria-label="Raison de la décision" placeholder="Raison (obligatoire, 200 caractères au plus)" value={reason}
              onChange={(event) => setReason(event.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAction(null)}>Annuler</Button>
              {(action.kind === 'reject' || action.kind === 'balances' || action.kind === 'revoke-refutation'
                || action.kind === 'revoke-attestation') && (
                <Button size="sm" disabled={reason.trim() === '' || decision.isPending} onClick={() => {
                  if (action.kind === 'reject') {
                    decision.mutate({ signature: ['reject', action.unit.id, action.unit.status, active?.id ?? null,
                      active?.active_day_content_hash ?? null, reason],
                    run: (key) => rejectDailyV2Unit(key, { unit: action.unit, activeCanonical: active, reason }),
                    done: 'Livraison écartée.' });
                  } else if (action.kind === 'balances' && active) {
                    const versionKey = dailyV2VersionKey(stagingVersionFacts(action.unit));
                    decision.mutate({ signature: ['balances', active.id, action.unit.id, versionKey, reason],
                      run: (key) => supersedeDailyV2UnitBalances(key, { canonicalUnitId: active.id,
                        correctiveStagingUnitId: action.unit.id, expectedCorrectiveVersionKey: versionKey, reason }),
                      done: 'Soldes corrigés.' });
                  } else if (action.kind === 'revoke-refutation') {
                    decision.mutate({ signature: ['revoke-refutation', action.refutation.id, reason],
                      run: (key) => revokeDailyV2VersionRefutation(key, action.refutation.id, reason),
                      done: 'Réfutation révoquée.' });
                  } else if (action.kind === 'revoke-attestation') {
                    decision.mutate({ signature: ['revoke-attestation', action.attestation.id, reason],
                      run: (key) => revokeDailyV2AttemptAttestation(key, action.attestation.id, reason),
                      done: 'Attestation révoquée.' });
                  }
                }}>Confirmer</Button>
              )}
            </div>
          </div>
        )}
        {message && <p role="status" className="text-sm">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}

function FileSection({ attempt, attestations, canAdminister, canDecide, onAttest, onRevoke, onBatch }: {
  attempt: DailyV2ExportAttemptRow;
  attestations: DailyV2AttemptAttestationRow[];
  canAdminister: boolean;
  canDecide: boolean;
  onAttest: (type: DailyV2AttestationType) => void;
  onRevoke: (attestation: DailyV2AttemptAttestationRow) => void;
  onBatch: () => void;
}) {
  const active = activeAttestations(attestations);
  const excel = attempt.source_format === 'structured_bank_statement_xls' || attempt.source_format === 'structured_bank_statement_xlsx';
  const needs = (type: DailyV2AttestationType) => excel
    && (attempt.review_reason_codes as string[]).includes(DAILY_V2_ATTESTABLE_CODES[type])
    && !active.some((row) => row.attestation_type === type)
    && (type !== 'ACCOUNT_IDENTITY' || attempt.account_number_masked === null);
  return (
    <div className="rounded border p-3" aria-label="Fichier de la livraison">
      <div className="font-medium">Fichier déposé le {attempt.created_at.slice(0, 10)} — {attempt.source_format}</div>
      <ul className="mt-1 space-y-1 text-xs">
        {attestations.filter((row) => row.action === 'ATTEST').map((row) => {
          const isActive = active.some((candidate) => candidate.id === row.id);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={isActive ? 'default' : 'outline'}>
                {row.attestation_type === 'ACCOUNT_IDENTITY' ? 'Identité attestée' : 'Devise attestée'}{isActive ? '' : ' (révoquée)'}
              </Badge>
              <span>preuve : {row.evidence_ref}</span>
              {canAdminister && isActive && <Button size="sm" variant="outline" onClick={() => onRevoke(row)}>Révoquer</Button>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {canAdminister && needs('ACCOUNT_IDENTITY') && (
          <Button size="sm" variant="outline" onClick={() => onAttest('ACCOUNT_IDENTITY')}>Attester l’identité du compte</Button>
        )}
        {canAdminister && needs('TRUSTED_CURRENCY') && (
          <Button size="sm" variant="outline" onClick={() => onAttest('TRUSTED_CURRENCY')}>Attester la devise</Button>
        )}
        {canDecide && <Button size="sm" onClick={onBatch}>Approuver le fichier en groupe</Button>}
      </div>
    </div>
  );
}

function AttestForm({ attempt, type, reason, pending, onSubmit }: {
  attempt: DailyV2ExportAttemptRow;
  type: DailyV2AttestationType;
  reason: string;
  pending: boolean;
  onSubmit: (rawTextHash: string, evidenceRef: string, currency: string | null) => void;
}) {
  const [hash, setHash] = useState<string | null>(null);
  const [evidence, setEvidence] = useState('');
  const [currency, setCurrency] = useState('');
  const matches = hash !== null && hash === attempt.raw_text_hash;
  return (
    <div className="space-y-2">
      <p>Resélectionnez le fichier déposé : son empreinte est recalculée localement, sans téléversement.</p>
      <Input type="file" aria-label="Fichier à resélectionner" accept=".xls,.xlsx" onChange={async (event) => {
        const file = event.target.files?.[0];
        setHash(file ? await buildRawBytesHash(await file.arrayBuffer()) : null);
      }} />
      {hash !== null && !matches && <p role="alert" className="text-destructive">Ce fichier n’est pas celui du dépôt.</p>}
      {type === 'TRUSTED_CURRENCY' && (
        <Input aria-label="Devise lue sur le relevé" placeholder="Devise lue sur le relevé (ex. XOF)" value={currency}
          onChange={(event) => setCurrency(event.target.value)} />
      )}
      <Input aria-label="Référence de preuve" placeholder="Référence de preuve" value={evidence}
        onChange={(event) => setEvidence(event.target.value)} />
      <Button size="sm" disabled={!matches || evidence.trim() === '' || reason.trim() === '' || pending
        || (type === 'TRUSTED_CURRENCY' && currency.trim() === '')}
      onClick={() => onSubmit(hash!, evidence, type === 'TRUSTED_CURRENCY' ? currency.trim().toUpperCase() : null)}>
        Attester
      </Button>
    </div>
  );
}

function RefuteForm({ version, active, deliveries, reason, pending, onSubmit }: {
  version: DailyV2DayVersion;
  active: DailyV2CanonicalUnitRow;
  deliveries: { units: DailyV2StagingUnitRow[]; attempts: DailyV2ExportAttemptRow[] };
  reason: string;
  pending: boolean;
  onSubmit: (proof: DailyV2RefutationProof) => void;
}) {
  const [kind, setKind] = useState<'FRESH_DELIVERY' | 'BANK_PIECE'>('FRESH_DELIVERY');
  const [freshId, setFreshId] = useState('');
  const [pieceHash, setPieceHash] = useState<string | null>(null);
  const [pieceReference, setPieceReference] = useState('');
  const [archiveReference, setArchiveReference] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [values, setValues] = useState({ opening: '', closing: '', debits: '', credits: '' });
  const [archived, setArchived] = useState(false);
  const retainedKey = dailyV2VersionKey(canonicalVersionFacts(active));
  // Seules les livraisons de la version retenue sont proposées comme preuve fraîche.
  const candidates = deliveries.units.filter((unit) => (unit.status === 'promoted' || unit.status === 'duplicate')
    && dailyV2VersionKey(stagingVersionFacts(unit)) === retainedKey);
  const candidateAttemptIds = Array.from(new Set(candidates.map((unit) => unit.attempt_id))).sort();
  const boundsQuery = useQuery({
    queryKey: ['daily-v2', 'fresh-bounds', candidateAttemptIds],
    queryFn: () => listDailyV2AttemptsUnits(candidateAttemptIds),
    enabled: candidateAttemptIds.length > 0,
  });
  // Bornes lues seulement sur une lecture complète et à jour (jamais une donnée périmée).
  const bounds = boundsQuery.isError || boundsQuery.isFetching ? null : boundsQuery.data ?? null;
  const boundOf = (unit: DailyV2StagingUnitRow) => {
    const attempt = deliveries.attempts.find((row) => row.id === unit.attempt_id);
    return attempt && bounds ? dailyV2FreshDeliveryBound(attempt, bounds) : null;
  };
  const boundsError = boundsQuery.isError
    ? (boundsQuery.error instanceof Error ? boundsQuery.error.message : 'Lecture des journées du fichier impossible.')
    : null;
  const fresh = candidates.find((unit) => unit.id === freshId) ?? null;
  const bound = kind === 'FRESH_DELIVERY' ? (fresh ? boundOf(fresh) : null) : (issuedOn || null);
  const verdicts = dailyV2SourceVerdicts(version.sources, bound);
  const allJustified = verdicts.length > 0 && verdicts.every((verdict) => verdict.justified);
  const needs = version.comparison
    ? dailyV2PieceRequirements(version.facts, canonicalVersionFacts(active), version.comparison)
    : { balances: true, totals: false };
  const pieceReady = pieceHash !== null && pieceReference.trim() !== '' && archiveReference.trim() !== '' && archived
    && /^\d{4}-\d{2}-\d{2}$/.test(issuedOn)
    && (!needs.balances || (isDailyV2AmountText(values.opening) && isDailyV2AmountText(values.closing)))
    && (!needs.totals || (isDailyV2AmountText(values.debits) && isDailyV2AmountText(values.credits)));
  const ready = allJustified && reason.trim() !== '' && !pending
    && (kind === 'FRESH_DELIVERY' ? fresh !== null : pieceReady);
  const valueOrNull = (text: string, needed: boolean) => (needed && text.trim() !== '' ? text.trim() : null);

  return (
    <div className="space-y-2">
      <div>Sources de la version ({version.sources.length}) :</div>
      <ul className="space-y-1 text-xs" aria-label="Sources et verdicts">
        {verdicts.map((verdict) => (
          <li key={`${verdict.source.raw_text_hash}|${verdict.source.account_registry_id}`}>
            <span className="font-mono">{shortHash(verdict.source.raw_text_hash)}</span> — première apparition le {verdict.firstSeenDay}
            {' '}({verdict.source.deliveries} livraison(s)) : {bound === null ? 'preuve à choisir'
              : verdict.justified ? 'justifiée' : 'non justifiée (preuve pas strictement postérieure)'}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" variant={kind === 'FRESH_DELIVERY' ? 'default' : 'outline'} onClick={() => setKind('FRESH_DELIVERY')}>
          Livraison fraîche
        </Button>
        <Button size="sm" variant={kind === 'BANK_PIECE' ? 'default' : 'outline'} onClick={() => setKind('BANK_PIECE')}>
          Pièce corrective
        </Button>
      </div>
      {kind === 'FRESH_DELIVERY' && boundsError && (
        <p role="alert" className="text-destructive">{boundsError} Aucune livraison fraîche ne peut être retenue comme preuve.</p>
      )}
      {kind === 'FRESH_DELIVERY' && (
        <select aria-label="Livraison fraîche de la version retenue" className="w-full rounded border px-2 py-1"
          value={freshId} onChange={(event) => setFreshId(event.target.value)}>
          <option value="">Livraison de la version retenue…</option>
          {candidates.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.status} — déposée le {unit.created_at.slice(0, 10)} — fin de fenêtre indicative : {boundOf(unit) ?? 'inconnue'}
            </option>
          ))}
        </select>
      )}
      {kind === 'BANK_PIECE' && (
        <div className="space-y-2">
          <p className="text-xs">{DAILY_V2_PIECE_MENTION}. Le fichier de la pièce reste chez SODATRA : seule son empreinte est
            calculée localement, sans téléversement.</p>
          <Input type="file" aria-label="Fichier de la pièce corrective" onChange={async (event) => {
            const file = event.target.files?.[0];
            setPieceHash(file ? await buildRawBytesHash(await file.arrayBuffer()) : null);
          }} />
          <Input aria-label="Référence de la pièce" placeholder="Référence de la pièce" value={pieceReference}
            onChange={(event) => setPieceReference(event.target.value)} />
          <Input aria-label="Référence d’archivage" placeholder="Référence d’archivage" value={archiveReference}
            onChange={(event) => setArchiveReference(event.target.value)} />
          <Input type="date" aria-label="Date d’émission" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
          {needs.balances && (
            <div className="flex gap-2">
              <Input aria-label="Ouverture lue sur la pièce" placeholder="Ouverture lue" value={values.opening}
                onChange={(event) => setValues({ ...values, opening: event.target.value })} />
              <Input aria-label="Clôture lue sur la pièce" placeholder="Clôture lue" value={values.closing}
                onChange={(event) => setValues({ ...values, closing: event.target.value })} />
            </div>
          )}
          {needs.totals && (
            <div className="flex gap-2">
              <Input aria-label="Total des débits lu sur la pièce" placeholder="Débits lus" value={values.debits}
                onChange={(event) => setValues({ ...values, debits: event.target.value })} />
              <Input aria-label="Total des crédits lu sur la pièce" placeholder="Crédits lus" value={values.credits}
                onChange={(event) => setValues({ ...values, credits: event.target.value })} />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
            J’atteste que cette pièce est archivée par SODATRA sous la référence indiquée.
          </label>
        </div>
      )}
      <Button size="sm" variant="destructive" disabled={!ready} onClick={() => onSubmit(kind === 'FRESH_DELIVERY'
        ? { kind: 'FRESH_DELIVERY', staging_unit_id: fresh!.id }
        : {
          kind: 'BANK_PIECE', piece_sha256: pieceHash!, piece_reference: pieceReference.trim(),
          archive_reference: archiveReference.trim(), issued_on: issuedOn, archive_attested: true,
          opening: valueOrNull(values.opening, needs.balances), closing: valueOrNull(values.closing, needs.balances),
          debits: valueOrNull(values.debits, needs.totals), credits: valueOrNull(values.credits, needs.totals),
        })}>
        Réfuter (toutes les sources doivent être justifiées)
      </Button>
    </div>
  );
}
