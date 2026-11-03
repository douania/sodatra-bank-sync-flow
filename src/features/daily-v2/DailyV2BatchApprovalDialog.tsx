import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ReviewReasonList } from './DailyV2Tables';
import {
  dailyV2DecisionCommandKeys,
  getDailyV2ExportAttempt,
  listDailyV2ActiveCanonicalUnits,
  listDailyV2AttemptAttestations,
  listDailyV2AttemptsUnits,
  promoteDailyV2AttemptUnits,
} from './dailyV2SupabaseService';
import { useDailyV2ScopedMutation as useMutation } from './session/dailyV2SessionScope';
import { computeDailyV2BatchPlan, DAILY_V2_BATCH_MAX_DAYS, type DailyV2BatchExpected } from './dailyV2Types';

// Approbation groupée par fichier (C8). La liste admissible est calculée comme
// le serveur la calcule (computeDailyV2BatchPlan, miroir de
// daily_stmt_batch_candidates), puis transmise à l'identique : le serveur la
// recalcule sous verrou et refuse tout écart. Chaque journée passe par la
// promotion existante, inchangée ; tout ou rien.

export function DailyV2BatchApprovalDialog({ attemptId, onClose, canDecide, onChanged }: {
  attemptId: string | null;
  onClose: () => void;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const attemptQuery = useQuery({
    queryKey: ['daily-v2', 'batch-attempt', attemptId],
    queryFn: () => getDailyV2ExportAttempt(attemptId!),
    enabled: attemptId !== null,
  });
  const unitsQuery = useQuery({
    queryKey: ['daily-v2', 'batch-units', attemptId],
    queryFn: () => listDailyV2AttemptsUnits([attemptId!]),
    enabled: attemptId !== null,
  });
  const dayIds = Array.from(new Set((unitsQuery.data ?? []).map((unit) => unit.day_unit_id))).sort();
  const canonicalsQuery = useQuery({
    queryKey: ['daily-v2', 'batch-canonicals', dayIds],
    queryFn: () => listDailyV2ActiveCanonicalUnits(dayIds),
    enabled: dayIds.length > 0,
  });
  const attestationsQuery = useQuery({
    queryKey: ['daily-v2', 'batch-attestations', attemptId],
    queryFn: () => listDailyV2AttemptAttestations([attemptId!]),
    enabled: attemptId !== null,
  });
  const plan = attemptQuery.data && unitsQuery.data && canonicalsQuery.data && attestationsQuery.data
    ? computeDailyV2BatchPlan({ attempt: attemptQuery.data, units: unitsQuery.data,
      activeCanonicals: canonicalsQuery.data, attestations: attestationsQuery.data })
    : null;

  const approve = useMutation<unknown, Error, { attemptId: string; expected: DailyV2BatchExpected; reason: string }>({
    mutationFn: async (variables) => {
      const key = dailyV2DecisionCommandKeys.keyFor(JSON.stringify(['batch', variables.attemptId, variables.expected, variables.reason]));
      const result = await promoteDailyV2AttemptUnits(key, variables);
      dailyV2DecisionCommandKeys.succeeded(key);
      return result;
    },
    onSuccess: () => {
      setMessage('Journées approuvées.');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['daily-v2'] });
      onChanged();
    },
    onError: (error) => setMessage(error.message),
  });

  const close = () => {
    setReason('');
    setMessage(null);
    onClose();
  };
  const tooLarge = (plan?.admissible.length ?? 0) > DAILY_V2_BATCH_MAX_DAYS;

  return (
    <Dialog open={attemptId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Approbation groupée du fichier</DialogTitle>
          <DialogDescription>
            Chaque journée admissible passe par la promotion existante. La liste ci-dessous est transmise telle quelle : si
            elle a changé depuis l’affichage, rien n’est approuvé.
          </DialogDescription>
        </DialogHeader>
        {plan && (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto text-sm">
            <section aria-label="Journées admissibles">
              <div className="font-medium">Journées admissibles ({plan.admissible.length})</div>
              <ul className="mt-1 space-y-1">
                {plan.admissible.map((unit) => (
                  <li key={unit.id} className="flex flex-wrap items-center gap-2">
                    <span>{unit.accounting_date}</span>
                    <Badge variant="outline">{unit.validation_status}</Badge>
                    <ReviewReasonList codes={unit.review_reason_codes} />
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-xs text-muted-foreground">
                Attestations prises en compte : {plan.expected.attestation_ids.length}
              </div>
            </section>
            <section aria-label="Journées inadmissibles">
              <div className="font-medium">Journées inadmissibles ({plan.inadmissible.length})</div>
              <ul className="mt-1 space-y-1">
                {plan.inadmissible.map(({ unit, reason: cause }) => (
                  <li key={unit.id}>{unit.accounting_date} — {cause}</li>
                ))}
              </ul>
            </section>
            {tooLarge && (
              <p role="alert" className="text-destructive">
                Plus de {DAILY_V2_BATCH_MAX_DAYS} journées admissibles : le serveur refusera l’approbation groupée.
              </p>
            )}
          </div>
        )}
        <Textarea aria-label="Raison de l’approbation groupée" placeholder="Raison (obligatoire)" value={reason}
          onChange={(event) => setReason(event.target.value)} />
        {message && <p role="status" className="text-sm">{message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Annuler</Button>
          <Button disabled={!canDecide || !plan || plan.admissible.length === 0 || tooLarge || reason.trim() === ''
            || approve.isPending}
          onClick={() => plan && attemptId && approve.mutate({ attemptId, expected: plan.expected, reason })}>
            Confirmer l’approbation des {plan?.admissible.length ?? 0} journée(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
