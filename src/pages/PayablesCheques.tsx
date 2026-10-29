import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePayablesChequesGate } from '@/features/payables-cheques/PayablesChequesGate';
import { PositionPanel } from '@/features/payables-cheques/PositionPanel';
import { WorkQueuePanel } from '@/features/payables-cheques/WorkQueuePanel';
import { InvoicesPanel } from '@/features/payables-cheques/InvoicesPanel';
import { ChequesPanel } from '@/features/payables-cheques/ChequesPanel';
import { BankFollowupPanel } from '@/features/payables-cheques/BankFollowupPanel';
import { ExceptionsPanel } from '@/features/payables-cheques/ExceptionsPanel';
import { TakeoverPanel } from '@/features/payables-cheques/TakeoverPanel';
import { ParametersPanel } from '@/features/payables-cheques/ParametersPanel';

export default function PayablesCheques() {
  const { gate } = usePayablesChequesGate();
  if (gate.status !== 'allowed') return null;
  const { access } = gate;
  // Administration seule (production) : seul le panneau d'administration est
  // monté ; aucun autre panneau n'est rendu, donc aucune de ses lectures n'est lancée.
  if (gate.mode !== 'full') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Administration du module chèques</h1>
          <p className="text-sm text-muted-foreground">
            Personnes, rattachements, habilitations et paramètres, décidés par l’administrateur désigné.
          </p>
        </div>
        <Alert>
          <AlertDescription>
            Production : administration seule. Factures, chèques, suivi bancaire et exports restent fermés ;
            chaque décision est vérifiée par le serveur.
          </AlertDescription>
        </Alert>
        <ParametersPanel access={access} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Factures, engagements et chèques émis</h1>
        <p className="text-sm text-muted-foreground">
          Facture → paiement réservé → impression → signature hors application → émission confirmée → suivi bancaire.
          Impression ≠ émission ; aucune signature reproduite ; aucun ordre bancaire émis.
        </p>
      </div>
      {!access.business_writes_enabled && (
        <Alert><AlertDescription>Le serveur est fermé en écriture : consultation seule.</AlertDescription></Alert>
      )}
      <Tabs defaultValue="position">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="position">Position</TabsTrigger>
          <TabsTrigger value="queue">File de travail</TabsTrigger>
          <TabsTrigger value="invoices">Factures</TabsTrigger>
          <TabsTrigger value="cheques">Chèques</TabsTrigger>
          <TabsTrigger value="bank">Suivi bancaire</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="takeover">Reprise</TabsTrigger>
          <TabsTrigger value="parameters">Paramètres</TabsTrigger>
        </TabsList>
        <TabsContent value="position"><PositionPanel access={access} /></TabsContent>
        <TabsContent value="queue"><WorkQueuePanel userId={access.user_id} /></TabsContent>
        <TabsContent value="invoices"><InvoicesPanel access={access} /></TabsContent>
        <TabsContent value="cheques"><ChequesPanel access={access} /></TabsContent>
        <TabsContent value="bank"><BankFollowupPanel access={access} /></TabsContent>
        <TabsContent value="exceptions"><ExceptionsPanel access={access} /></TabsContent>
        <TabsContent value="takeover"><TakeoverPanel access={access} /></TabsContent>
        <TabsContent value="parameters"><ParametersPanel access={access} /></TabsContent>
      </Tabs>
    </div>
  );
}
