import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { TreasuryBalancesView } from '@/features/treasury/TreasuryBalancesView';
import { TreasuryInventoryAdmin } from '@/features/treasury/TreasuryInventoryAdmin';
import { TreasuryVerifiedStartAdmin } from '@/features/treasury/TreasuryVerifiedStartAdmin';
import { defaultAsOf, TreasuryError } from '@/features/treasury/treasuryModel';
import { treasuryBalancesQuery } from '@/features/treasury/treasuryService';

// Vue « Soldes à date » : couche « solde » seule (Lot 1). Aucune donnée de
// paiement, de facture, de remise ou de facilité n'est lue ici.
export default function TreasuryBalances() {
  const { user } = useAuth();
  const [draft, setDraft] = useState(() => defaultAsOf(new Date()));
  const [asOf, setAsOf] = useState(draft);
  const [showAdmin, setShowAdmin] = useState(false);
  const query = useQuery(treasuryBalancesQuery(user?.id ?? null, asOf));
  // Après un refus, aucune donnée antérieure n'est montrée à côté de l'erreur.
  const data = query.error ? undefined : query.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Soldes à date</h1>
        <p className="text-sm text-muted-foreground">
          Première vue en date comptable : solde bancaire de chaque compte attendu à la date D, avec sa couverture,
          sa fraîcheur et ses sources. Les comptes non couverts restent listés ; aucun montant absent n’est remplacé par zéro.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => { event.preventDefault(); setAsOf(draft); }}
      >
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Date comptable D</span>
          <Input type="date" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Date comptable D" />
        </label>
        <Button type="submit" size="sm">Lire</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdmin((value) => !value)}>
          {showAdmin ? 'Masquer l’inventaire' : 'Inventaire des comptes attendus'}
        </Button>
      </form>
      {query.isLoading && <p className="text-sm text-muted-foreground">Lecture des soldes…</p>}
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {query.error instanceof TreasuryError ? query.error.message : 'La lecture des soldes a été refusée.'}
          </AlertDescription>
        </Alert>
      )}
      {data && <TreasuryBalancesView result={data} />}
      {data && showAdmin && <TreasuryInventoryAdmin result={data} onChanged={() => { void query.refetch(); }} />}
      {data && showAdmin && <TreasuryVerifiedStartAdmin result={data} onChanged={() => { void query.refetch(); }} />}
    </div>
  );
}
