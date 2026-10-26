import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { readAccountPositions, readInvoiceOverview } from './payablesChequesService';
import {
  balanceDisplay,
  circulationDisplay,
  displayText,
  groupInvoicesByDue,
  indicativeDisplay,
} from './operationalPositionModel';
import { Amount, PAYABLES_QUERY_ROOT, today } from './payablesUi';

export function PositionPanel() {
  const asOf = today();
  const positions = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'positions', asOf], queryFn: () => readAccountPositions(asOf) });
  const invoices = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'invoices'], queryFn: readInvoiceOverview });
  const groups = invoices.data ? groupInvoicesByDue(invoices.data, asOf) : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Position opérationnelle par compte</CardTitle>
          <CardDescription>
            Solde du dernier relevé (jamais un relevé plus ancien), chèques en circulation et position indicative après
            chèques. La disponibilité nette en date de valeur n’est pas calculée ici ; les virements restent à part.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {positions.error && <Alert variant="destructive"><AlertDescription>{(positions.error as Error).message}</AlertDescription></Alert>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compte</TableHead>
                <TableHead>Dernier relevé</TableHead>
                <TableHead>Solde bancaire</TableHead>
                <TableHead>Chèques en circulation</TableHead>
                <TableHead>Engagés non débités</TableHead>
                <TableHead>Virements déclarés en attente</TableHead>
                <TableHead>Position indicative après chèques</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(positions.data ?? []).map((row) => {
                const indicative = indicativeDisplay(row);
                return (
                  <TableRow key={row.account_id}>
                    <TableCell>
                      <div className="font-medium">{row.bank} — {row.account_alias}</div>
                      <div className="text-xs text-muted-foreground">{row.currency}</div>
                    </TableCell>
                    <TableCell>{row.last_statement_date ?? 'Aucun'}</TableCell>
                    <TableCell>{displayText(balanceDisplay(row))}</TableCell>
                    <TableCell>
                      {row.circulation_count} — {displayText(circulationDisplay(row))}
                      {row.circulation_unknown_count > 0 && (
                        <div className="text-xs text-destructive">{row.circulation_unknown_count} montant(s) inconnu(s)</div>
                      )}
                    </TableCell>
                    <TableCell><Amount value={row.engaged_not_debited_amount} /></TableCell>
                    <TableCell>{row.transfers_pending_count} — <Amount value={row.transfers_pending_amount} /></TableCell>
                    <TableCell>
                      {indicative.kind === 'value'
                        ? <Badge variant="secondary">Indicative : <Amount value={indicative.value} /></Badge>
                        : <span className="text-sm text-muted-foreground">{displayText(indicative)}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factures restant à engager</CardTitle>
          <CardDescription>
            Regroupées par échéance. Une facture couverte par un paiement engagé n’apparaît que pour son restant ; une
            facture bloquée n’affiche aucun restant disponible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoices.error && <Alert variant="destructive"><AlertDescription>{(invoices.error as Error).message}</AlertDescription></Alert>}
          {groups.length === 0 && !invoices.isLoading && <p className="text-sm text-muted-foreground">Aucune facture à engager.</p>}
          {groups.map((group) => (
            <div key={group.bucket}>
              <h3 className="font-semibold">
                {group.label} — {Object.entries(group.remainingByCurrency).map(([currency, total]) =>
                  `${total === null ? 'total indisponible' : new Intl.NumberFormat('fr-FR').format(total)} ${currency}`).join(' ; ')}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fournisseur</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead>Échéance</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Engagé</TableHead>
                    <TableHead>Restant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.invoices.map((invoice) => (
                    <TableRow key={invoice.invoice_id}>
                      <TableCell>{invoice.supplier_name}</TableCell>
                      <TableCell>{invoice.reference_exact}{invoice.collision_ordinal > 0 ? ` (#${invoice.collision_ordinal})` : ''}</TableCell>
                      <TableCell>{invoice.due_date ?? 'Non renseignée'}</TableCell>
                      <TableCell><Amount value={invoice.amount} /></TableCell>
                      <TableCell><Amount value={invoice.engaged_amount + invoice.reserved_amount} /></TableCell>
                      <TableCell>
                        {invoice.blocked ? <Badge variant="destructive">Bloquée</Badge> : <Amount value={invoice.remaining_amount} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
