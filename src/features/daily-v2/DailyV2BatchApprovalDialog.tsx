import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ReviewReasonList } from './DailyV2Tables';
import {
  dailyV2DecisionCommandKeys,
  getDailyV2AttemptBatchPlan,
  promoteDailyV2AttemptUnits,
} from './dailyV2SupabaseService';
import { useDailyV2ScopedMutation as useMutation } from './session/dailyV2SessionScope';
import { DAILY_V2_BATCH_INADMISSIBLE_LABELS, type DailyV2BatchExpected, type DailyV2ReviewReasonCode } from './dailyV2Types';

// Approbation groupée par fichier (C8). La liste admissible et les motifs
// d'inadmissibilité sont lus sur le serveur (daily_v2_attempt_batch_plan_v1,
// même règle que daily_stmt_batch_candidates, lignes stockées conformes
// comprises), puis transmis à l'identique : le serveur les recalcule sous
// verrou et refuse tout écart. Aucun plan n'est recalculé dans le navigateur ;
// si la lecture échoue, aucune approbation n'est proposée.

export function DailyV2BatchApprovalDialog({ attemptId, onClose, canDecide, onChanged }: {
  attemptId: string | null;
  onClose: () => void;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const planQuery = useQuery({
    queryKey: ['daily-v2', 'batch-plan', attemptId],
    queryFn: () => getDailyV2AttemptBatchPlan(attemptId!),
    enabled: attemptId !== null,
  });
  // Plan lu seulement sur une lecture réussie et à jour (jamais un plan périmé).
  const plan = planQuery.isError || planQuery.isFetching ? null : planQuery.data ?? null;

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
  const tooLarge = plan !== null && plan.admissible.length > plan.maxDays;
  // Même condition pour le bouton et son gestionnaire d'envoi (jamais d'envoi sur
  // un plan absent, périmé ou en relecture).
  const confirmable = canDecide && plan !== null && !planQuery.isError && plan.admissible.length > 0 && !tooLarge
    && reason.trim() !== '' && !approve.isPending;

  return (
    <Dialog open={attemptId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Approbation groupée du fichier</DialogTitle>
          <DialogDescription>
            Chaque journée admissible passe par la promotion existante. La liste ci-dessous, établie par le serveur, est
            transmise telle quelle : si elle a changé depuis l’affichage, rien n’est approuvé.
          </DialogDescription>
        </DialogHeader>
        {planQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            {planQuery.error instanceof Error ? planQuery.error.message : 'Lecture du plan impossible.'} Aucune approbation
            n’est proposée.
          </p>
        )}
        {plan && (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto text-sm">
            <section aria-label="Journées admissibles">
              <div className="font-medium">Journées admissibles ({plan.admissible.length})</div>
              <ul className="mt-1 space-y-1">
                {plan.admissible.map((day) => (
                  <li key={day.stagingUnitId} className="flex flex-wrap items-center gap-2">
                    <span>{day.accountingDate}</span>
                    <Badge variant="outline">{day.validationStatus}</Badge>
                    <ReviewReasonList codes={day.reviewReasonCodes as DailyV2ReviewReasonCode[]} />
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
                {plan.inadmissible.map((day) => (
                  <li key={day.stagingUnitId}>
                    {day.accountingDate} — {DAILY_V2_BATCH_INADMISSIBLE_LABELS[day.reason]} ({day.status})
                  </li>
                ))}
              </ul>
            </section>
            {tooLarge && (
              <p role="alert" className="text-destructive">
                Plus de {plan.maxDays} journées admissibles : le serveur refusera l’approbation groupée.
              </p>
            )}
          </div>
        )}
        <Textarea aria-label="Raison de l’approbation groupée" placeholder="Raison (obligatoire)" value={reason}
          onChange={(event) => setReason(event.target.value)} />
        {message && <p role="status" className="text-sm">{message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Annuler</Button>
          <Button disabled={!confirmable}
            onClick={() => confirmable && plan && attemptId && approve.mutate({ attemptId, expected: plan.expected, reason })}>
            Confirmer l’approbation des {plan?.admissible.length ?? 0} journée(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
