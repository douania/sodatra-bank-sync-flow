import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Fact, Field } from './DailyV2Tables';
import { formatDailyV2MinorUnits } from './dailyV2Money';
import { DailyV2ServiceError } from './dailyV2SupabaseService';
import { generateDailyV2Report, type DailyV2SafeReport } from './dailyV2ReportingService';
import {
  downloadDailyV2SummaryCsv,
  downloadDailyV2SummaryXlsx,
} from './dailyV2SummaryExport';

/**
 * Reporting Daily v2 (0O) : agrégats canonical actifs uniquement, montants
 * bigint, alias de compte non sensibles. Aucune ligne transactionnelle,
 * aucune empreinte de compte, aucun identifiant technique n'est affiché
 * ni exporté.
 */
const DailyV2Reporting = () => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState('');
  const [report, setReport] = useState<DailyV2SafeReport | null>(null);

  const generateMutation = useMutation<DailyV2SafeReport, Error, void>({
    mutationFn: () =>
      generateDailyV2Report({
        startDate,
        endDate,
        bank: bank.trim() || undefined,
        currency: currency.trim() || undefined,
      }),
    onSuccess: (result) => {
      setReport(result);
      toast.success('Rapport Daily v2 généré');
    },
    onError: (error) => {
      setReport(null);
      showSafeReportingError(error, 'Génération du rapport impossible.');
    },
  });

  const exportCsv = () => {
    if (!report) return;
    try {
      downloadDailyV2SummaryCsv(report.filters, report.groups);
    } catch (error) {
      showSafeReportingError(error, 'Export CSV impossible.');
    }
  };

  const exportXlsx = async () => {
    if (!report) return;
    try {
      await downloadDailyV2SummaryXlsx(report.filters, report.groups);
    } catch (error) {
      showSafeReportingError(error, 'Export XLSX impossible.');
    }
  };

  const hasRows = report !== null && report.groups.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reporting canonical Daily v2</CardTitle>
          <CardDescription>
            Unités canonical actives uniquement, agrégées par banque, devise et alias de compte.
            Période inclusive limitée à 400 jours et 5 000 unités.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Date de début">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Date de fin">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Banque (optionnelle)">
              <Input value={bank} maxLength={12} placeholder="ex. BDK" onChange={(e) => setBank(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Devise (optionnelle)">
              <Input value={currency} maxLength={12} placeholder="ex. XOF" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!startDate || !endDate || generateMutation.isPending}
          >
            {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Générer le rapport
          </Button>
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Résultat</CardTitle>
                <CardDescription>
                  Période {report.filters.startDate} → {report.filters.endDate}
                  {report.filters.bank ? ` · banque ${report.filters.bank}` : ''}
                  {report.filters.currency ? ` · devise ${report.filters.currency}` : ''}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!hasRows}>
                  <Download className="mr-1 h-4 w-4" />Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!hasRows}>
                  <FileSpreadsheet className="mr-1 h-4 w-4" />Export XLSX
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <Fact label="Unités canonical analysées" value={String(report.sourceUnitCount)} />
              <Fact label="Groupes" value={String(report.groups.length)} />
              <Fact label="Généré le (UTC)" value={report.generatedAt} />
            </div>

            {!hasRows ? (
              <Alert>
                <AlertTitle>Aucune unité</AlertTitle>
                <AlertDescription>
                  Aucune unité canonical active ne correspond à la période et aux filtres demandés.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Banque</TableHead>
                        <TableHead>Devise</TableHead>
                        <TableHead>Alias compte</TableHead>
                        <TableHead>Période</TableHead>
                        <TableHead>Jours</TableHead>
                        <TableHead>Lignes</TableHead>
                        <TableHead>Total débits</TableHead>
                        <TableHead>Total crédits</TableHead>
                        <TableHead>Flux net</TableHead>
                        <TableHead>Ouverture</TableHead>
                        <TableHead>Clôture</TableHead>
                        <TableHead>À revoir</TableHead>
                        <TableHead>Sans agrégats</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.groups.map((group) => (
                        <TableRow key={`${group.currency}-${group.bank}-${group.accountAlias}`}>
                          <TableCell>{group.bank}</TableCell>
                          <TableCell>{group.currency}</TableCell>
                          <TableCell>{group.accountAlias}</TableCell>
                          <TableCell>{group.firstAccountingDate} → {group.lastAccountingDate}</TableCell>
                          <TableCell>{group.dayCount}</TableCell>
                          <TableCell>{group.lineCount}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(group.totalDebitsMinor, group.currency)}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(group.totalCreditsMinor, group.currency)}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(group.netFlowMinor, group.currency)}</TableCell>
                          <TableCell>
                            {group.firstOpeningBalanceMinor === null
                              ? '—'
                              : formatDailyV2MinorUnits(group.firstOpeningBalanceMinor, group.currency)}
                          </TableCell>
                          <TableCell>
                            {group.lastClosingBalanceMinor === null
                              ? '—'
                              : formatDailyV2MinorUnits(group.lastClosingBalanceMinor, group.currency)}
                          </TableCell>
                          <TableCell>{group.needsReviewDayCount}</TableCell>
                          <TableCell>{group.unavailableAggregatesDayCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Devise</TableHead>
                        <TableHead>Groupes</TableHead>
                        <TableHead>Jours</TableHead>
                        <TableHead>Lignes</TableHead>
                        <TableHead>Total débits</TableHead>
                        <TableHead>Total crédits</TableHead>
                        <TableHead>Flux net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.currencySummaries.map((summary) => (
                        <TableRow key={summary.currency}>
                          <TableCell>{summary.currency}</TableCell>
                          <TableCell>{summary.groupCount}</TableCell>
                          <TableCell>{summary.dayCount}</TableCell>
                          <TableCell>{summary.lineCount}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(summary.totalDebitsMinor, summary.currency)}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(summary.totalCreditsMinor, summary.currency)}</TableCell>
                          <TableCell>{formatDailyV2MinorUnits(summary.netFlowMinor, summary.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

function showSafeReportingError(error: unknown, fallback: string) {
  if (error instanceof DailyV2ServiceError) {
    toast.error(error.message, {
      description: error.safeCode ? `Code : ${error.safeCode}` : undefined,
    });
    return;
  }
  if (error instanceof Error && /EXPORT_/.test(error.message)) {
    toast.error(fallback, { description: `Code : ${error.message}` });
    return;
  }
  toast.error(fallback);
}

export default DailyV2Reporting;
