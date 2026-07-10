import type { ReactNode } from 'react';
import { AlertCircle, Eye, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  DailyV2AuditEventRow,
  DailyV2CanonicalLineRow,
  DailyV2CanonicalUnitRow,
  DailyV2StagingLineRow,
  DailyV2StagingUnitRow,
} from './dailyV2Types';

const PAGE_SIZE = 20;

export const Field = ({ label, children }: { label: string; children?: ReactNode }) => (
  <div className="space-y-2"><Label>{label}</Label>{children}</div>
);

export const Fact = ({ label, value }: { label: string; value: string }) => (
  <div><div className="text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>
);

export const AccessDenied = ({ text }: { text: string }) => (
  <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Accès limité</AlertTitle><AlertDescription>{text}</AlertDescription></Alert>
);

export const ErrorList = ({ title, errors }: { title: string; errors: string[] }) => (
  <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>{title}</AlertTitle><AlertDescription><ul className="list-disc pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul></AlertDescription></Alert>
);

export const ListCard = ({ title, loading, error, onRefresh, children }: {
  title: string;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) => (
  <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>{title}</CardTitle><Button variant="outline" size="sm" onClick={onRefresh}>Actualiser</Button></div></CardHeader><CardContent>{loading ? <Loading /> : error ? <AccessDenied text="Lecture impossible ou non autorisée." /> : children}</CardContent></Card>
);

export const StagingTable = ({ rows, isAdmin, onLines, onDecision }: {
  rows: DailyV2StagingUnitRow[];
  isAdmin: boolean;
  onLines: (unit: DailyV2StagingUnitRow) => void;
  onDecision: (kind: 'promote' | 'supersede', unit: DailyV2StagingUnitRow) => void;
}) => (
  <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Banque</TableHead><TableHead>Statut</TableHead><TableHead>Validation</TableHead><TableHead>Lignes</TableHead><TableHead>Débits</TableHead><TableHead>Crédits</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((unit) => <TableRow key={unit.id}><TableCell>{formatDate(unit.accounting_date)}</TableCell><TableCell>{unit.bank} / {unit.currency}</TableCell><TableCell><StatusBadge status={unit.status} /></TableCell><TableCell>{unit.validation_status} / {unit.aggregates_status}</TableCell><TableCell>{unit.line_count}</TableCell><TableCell>{formatMoney(unit.day_total_debits, unit.currency)}</TableCell><TableCell>{formatMoney(unit.day_total_credits, unit.currency)}</TableCell><TableCell><div className="flex gap-2">{isAdmin && unit.status !== 'duplicate' && <Button variant="outline" size="sm" onClick={() => onLines(unit)}><Eye className="mr-1 h-4 w-4" />Lignes</Button>}{isAdmin && unit.status === 'staged' && <Button size="sm" onClick={() => onDecision('promote', unit)}>Promouvoir</Button>}{isAdmin && unit.status === 'conflict' && <Button variant="destructive" size="sm" onClick={() => onDecision('supersede', unit)}>Supersede</Button>}</div></TableCell></TableRow>)}</TableBody>
  </Table></div>
);

export const CanonicalTable = ({ rows, onLines }: {
  rows: DailyV2CanonicalUnitRow[];
  onLines: (unit: DailyV2CanonicalUnitRow) => void;
}) => (
  <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Banque</TableHead><TableHead>Cycle</TableHead><TableHead>Validation</TableHead><TableHead>Lignes</TableHead><TableHead>Débits</TableHead><TableHead>Crédits</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((unit) => <TableRow key={unit.id}><TableCell>{formatDate(unit.accounting_date)}</TableCell><TableCell>{unit.bank} / {unit.currency}</TableCell><TableCell><StatusBadge status={unit.status === 'ingested' ? 'active' : 'superseded'} /></TableCell><TableCell>{unit.validation_status} / {unit.aggregates_status}</TableCell><TableCell>{unit.line_count}</TableCell><TableCell>{formatMoney(unit.day_total_debits, unit.currency)}</TableCell><TableCell>{formatMoney(unit.day_total_credits, unit.currency)}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => onLines(unit)}><Eye className="mr-1 h-4 w-4" />Lignes</Button></TableCell></TableRow>)}</TableBody>
  </Table></div>
);

export const AuditTable = ({ rows }: { rows: DailyV2AuditEventRow[] }) => (
  <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Événement</TableHead><TableHead>Transition</TableHead><TableHead>Message</TableHead><TableHead>Détails</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.created_at).toLocaleString('fr-FR')}</TableCell><TableCell>{event.event_type}</TableCell><TableCell>{event.previous_status ?? '—'} → {event.new_status ?? '—'}</TableCell><TableCell>{event.safe_message ?? '—'}</TableCell><TableCell><code className="text-xs break-all">{safeJson(event.safe_details)}</code></TableCell></TableRow>)}</TableBody>
  </Table></div>
);

export const LinesTable = ({ rows, loading }: {
  rows: Array<DailyV2StagingLineRow | DailyV2CanonicalLineRow>;
  loading: boolean;
}) => loading ? <Loading /> : (
  <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Valeur</TableHead><TableHead>Libellé normalisé</TableHead><TableHead>Débit</TableHead><TableHead>Crédit</TableHead><TableHead>Solde</TableHead><TableHead>État</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((line) => <TableRow key={line.id}><TableCell>{formatDate(line.accounting_date)}</TableCell><TableCell>{line.value_date ? formatDate(line.value_date) : '—'}</TableCell><TableCell className="max-w-md break-words">{line.description_sanitized}</TableCell><TableCell>{line.debit_amount === null ? '—' : formatMoney(line.debit_amount, line.currency)}</TableCell><TableCell>{line.credit_amount === null ? '—' : formatMoney(line.credit_amount, line.currency)}</TableCell><TableCell>{line.running_balance === null ? '—' : formatMoney(line.running_balance, line.currency)}</TableCell><TableCell>{'is_active' in line ? (line.is_active ? 'active' : 'inactive') : line.direction}</TableCell></TableRow>)}</TableBody>
  </Table></div>
);

export const Pager = ({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) => {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">Page {page + 1}/{pages} — {count} élément(s)</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>Précédent</Button><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Suivant</Button></div></div>;
};

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={status === 'conflict' || status === 'promotion_failed' ? 'destructive' : 'secondary'}>{status}</Badge>
);

const Loading = () => <div className="flex items-center justify-center py-8"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>;

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}
function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
}
function safeJson(value: unknown) { try { return value === null ? '—' : JSON.stringify(value); } catch { return '—'; } }
