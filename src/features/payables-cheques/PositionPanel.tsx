import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { readAccountPositions, readInvoiceOverview } from './payablesChequesService';
import {
  balanceDisplay,
  circulationDisplay,
  displayText,
  groupInvoicesByDue,
  indicativeDisplay,
  positionDates,
  positionKindLabel,
  reasonLabel,
} from './operationalPositionModel';
import type { PayablesAccess } from './payablesChequesTypes';
import { Amount, Field, hasReadCapability, PAYABLES_QUERY_ROOT, today } from './payablesUi';

function BankPositions() {
  const [asOf, setAsOf] = useState(today());
  const positions = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'positions', asOf], queryFn: () => readAccountPositions(asOf) });
  const historical = asOf < today();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position opérationnelle par compte</CardTitle>
        <CardDescription>
          Chaque colonne porte sa date. Solde au dernier relevé (jamais un relevé plus ancien) ; position indicative à la
          date demandée = solde du relevé − chèques non reflétés dans ce solde (y compris ceux émis après le relevé) ;
          couverture prouvée par la chaîne des soldes. La disponibilité nette en date de valeur n’est pas calculée ici ;
          les virements restent à part.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Date de la position" htmlFor="position-as-of">
          <Input id="position-as-of" type="date" max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value || today())} />
        </Field>
        {historical && (
          <Alert>
            <AlertDescription>
              Position historique au {asOf} : elle ne représente pas le disponible actuel.
            </AlertDescription>
          </Alert>
        )}
        {positions.error && <Alert variant="destructive"><AlertDescription>{(positions.error as Error).message}</AlertDescription></Alert>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Compte</TableHead>
              <TableHead>Solde bancaire</TableHead>
              <TableHead>Chèques en circulation</TableHead>
              <TableHead>Chèques non reflétés dans le solde</TableHead>
              <TableHead>Engagés non débités</TableHead>
              <TableHead>Virements déclarés en attente</TableHead>
              <TableHead>Position</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(positions.data ?? []).map((row) => {
              const indicative = indicativeDisplay(row);
              const dates = positionDates(row);
              return (
                <TableRow key={row.account_id} data-testid="position-row">
                  <TableCell>
                    <div className="font-medium">{row.bank} — {row.account_alias}</div>
                    <div className="text-xs text-muted-foreground">{row.currency}</div>
                    {row.coverage_status && (
                      <div className="text-xs text-muted-foreground">
                        Couverture : {row.coverage_status === 'PROVEN' ? 'prouvée par la chaîne des soldes'
                          : reasonLabel(`COVERAGE_${row.coverage_status}`)}
                        {row.coverage_issue_date ? ` (à partir du ${row.coverage_issue_date})` : ''}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {displayText(balanceDisplay(row))}
                    <div className="text-xs text-muted-foreground">{dates.balance}</div>
                  </TableCell>
                  <TableCell>
                    {row.circulation_count} — {displayText(circulationDisplay(row))}
                    <div className="text-xs text-muted-foreground">{dates.circulation}</div>
                    {row.circulation_unknown_count > 0 && (
                      <div className="text-xs text-destructive">{row.circulation_unknown_count} montant(s) inconnu(s)</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.unreflected_cheques_count} — {row.unreflected_cheques_amount === null
                      ? `Indisponible — ${reasonLabel('AMOUNT_UNKNOWN')}` : <Amount value={row.unreflected_cheques_amount} />}
                    <div className="text-xs text-muted-foreground">au {row.as_of}, hors relevé du {row.last_statement_date ?? '—'}</div>
                  </TableCell>
                  <TableCell>
                    <Amount value={row.engaged_not_debited_amount} />
                    <div className="text-xs text-muted-foreground">{dates.current}</div>
                  </TableCell>
                  <TableCell>
                    {row.transfers_pending_count} — <Amount value={row.transfers_pending_amount} />
                    <div className="text-xs text-muted-foreground">{dates.current}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{positionKindLabel(row)}</div>
                    {indicative.kind === 'value'
                      ? <Badge variant={row.is_historical ? 'outline' : 'secondary'}><Amount value={indicative.value} /></Badge>
                      : <span className="text-sm text-muted-foreground">{displayText(indicative)}</span>}
                    <div className="text-xs text-muted-foreground">{dates.indicative}</div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function PositionPanel({ access }: { access: PayablesAccess }) {
  const asOf = today();
  const invoices = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'invoices'], queryFn: readInvoiceOverview });
  const groups = invoices.data ? groupInvoicesByDue(invoices.data, asOf) : [];

  return (
    <div className="space-y-6">
      {hasReadCapability(access, 'BANK_READ') ? <BankPositions /> : (
        <Alert>
          <AlertDescription>
            Les soldes, relevés et rapprochements exigent l’habilitation bancaire du module (BANK_READ).
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Factures restant à engager</CardTitle>
          <CardDescription>
            Regroupées par échéance au {asOf}. Une facture couverte par un paiement engagé n’apparaît que pour son restant ;
            une facture bloquée n’affiche aucun restant disponible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoices.error && <Alert variant="destructive"><AlertDescription>{(invoices.error as Error).message}</AlertDescription></Alert>}
          {groups.length === 0 && !invoices.isLoading && !invoices.error && (
            <p className="text-sm text-muted-foreground">Aucune facture à engager.</p>
          )}
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
