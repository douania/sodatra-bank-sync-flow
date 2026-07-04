import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, FileSearch, ShieldCheck } from 'lucide-react';
import type { StructuredBankStatementCsvDiagnostic } from '@/services/structuredBankStatementCsvRuntimeDiagnosticService';

/**
 * Read-only review of a structured bank statement CSV diagnostic.
 *
 * This component renders ONLY the safe summary returned by
 * `runStructuredBankStatementCsvDiagnostic`: no raw CSV content, no full
 * transaction lines, and no ingestion action of any kind (diagnostic only,
 * no DB write is possible from this surface).
 */

interface StructuredBankStatementCsvDiagnosticReviewProps {
  diagnostic: StructuredBankStatementCsvDiagnostic;
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  valid: 'bg-green-100 text-green-800',
  needs_review: 'bg-yellow-100 text-yellow-800',
  invalid: 'bg-red-100 text-red-800',
  unsupported: 'bg-gray-100 text-gray-800'
};

const STATUS_LABELS: Record<string, string> = {
  valid: 'valid',
  needs_review: 'needs_review',
  invalid: 'invalid',
  unsupported: 'unsupported'
};

function formatOptionalText(value: string | undefined): string {
  return value && value.length > 0 ? value : 'N/A';
}

function formatBoolean(value: boolean): string {
  return value ? 'oui' : 'non';
}

function formatOptionalBoolean(value: boolean | undefined): string {
  return typeof value === 'boolean' ? formatBoolean(value) : 'N/A';
}

function formatOptionalAmount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : 'N/A';
}

function formatDelimiter(delimiter: string | undefined): string {
  if (!delimiter) return 'N/A';
  return delimiter === '\t' ? 'tabulation' : `« ${delimiter} »`;
}

const StructuredBankStatementCsvDiagnosticReview = ({
  diagnostic
}: StructuredBankStatementCsvDiagnosticReviewProps) => {
  const statusKey = diagnostic.status ?? null;
  const statusLabel = statusKey ? STATUS_LABELS[statusKey] : 'rejeté';
  const statusClasses = statusKey
    ? STATUS_BADGE_CLASSES[statusKey]
    : 'bg-red-100 text-red-800';

  const generalFacts: Array<{ label: string; value: string }> = [
    { label: 'Banque détectée', value: formatOptionalText(diagnostic.bankHint) },
    { label: 'Délimiteur détecté', value: formatDelimiter(diagnostic.detectedDelimiter) },
    { label: 'Devise', value: formatOptionalText(diagnostic.currency) },
    { label: 'Compte (masqué)', value: formatOptionalText(diagnostic.accountNumberMasked) },
    {
      label: 'Période',
      value: `${diagnostic.periodStart ?? '—'} → ${diagnostic.periodEnd ?? '—'}`
    },
    { label: 'Date du relevé', value: formatOptionalText(diagnostic.statementDate) },
    { label: 'Lignes', value: String(diagnostic.lineCount) },
    {
      label: 'Débit / Crédit / Inconnu',
      value: `${diagnostic.debitLineCount} / ${diagnostic.creditLineCount} / ${diagnostic.unknownLineCount}`
    }
  ];

  const validationFacts: Array<{ label: string; value: string }> = [
    { label: 'Solde d\'ouverture trouvé', value: formatBoolean(diagnostic.openingBalanceFound) },
    { label: 'Solde de clôture trouvé', value: formatBoolean(diagnostic.closingBalanceFound) },
    { label: 'Totaux déclarés trouvés', value: formatBoolean(diagnostic.declaredTotalsFound) },
    {
      label: 'Totaux déclarés = lignes',
      value: formatOptionalBoolean(diagnostic.declaredTotalsMatchLines)
    },
    {
      label: 'Soldes ligne à ligne cohérents',
      value: formatOptionalBoolean(diagnostic.lineBalancesConsistent)
    },
    {
      label: 'Clôture calculée',
      value: formatOptionalAmount(diagnostic.computedClosingBalance)
    },
    {
      label: 'Écart de clôture',
      value: formatOptionalAmount(diagnostic.closingBalanceDiscrepancy)
    }
  ];

  return (
    <Card className="mt-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <FileSearch className="h-5 w-5" />
            <span>Diagnostic CSV Structuré</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            {diagnostic.bankHint && diagnostic.bankHint !== 'UNKNOWN' && (
              <Badge variant="outline">{diagnostic.bankHint}</Badge>
            )}
            {diagnostic.detectedDelimiter && (
              <Badge variant="outline">
                délimiteur {formatDelimiter(diagnostic.detectedDelimiter)}
              </Badge>
            )}
            <Badge className={statusClasses}>{statusLabel}</Badge>
          </div>
        </div>
        <CardDescription>Fichier : {diagnostic.sourceFileName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Diagnostic uniquement — aucune ingestion DB</AlertTitle>
          <AlertDescription>
            Le contenu brut du CSV est caché : seul un résumé agrégé est affiché,
            sans aucune ligne transactionnelle complète. Aucune écriture en base
            n'est autorisée dans ce lot.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-green-300 text-green-800">
            CSV brut caché : {formatBoolean(diagnostic.rawContentHidden)}
          </Badge>
          <Badge variant="outline" className="border-green-300 text-green-800">
            Ingestion autorisée : {formatBoolean(diagnostic.ingestionAllowed)}
          </Badge>
          <Badge variant="outline" className="border-green-300 text-green-800">
            Diagnostic complété : {formatBoolean(diagnostic.diagnosticCompleted)}
          </Badge>
          <Badge variant="outline" className="border-green-300 text-green-800">
            Aucune écriture DB
          </Badge>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">Résumé du relevé</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {generalFacts.map((fact) => (
              <div key={fact.label}>
                <div className="text-gray-500">{fact.label}</div>
                <div className="font-medium">{fact.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">Contrôles de cohérence</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {validationFacts.map((fact) => (
              <div key={fact.label}>
                <div className="text-gray-500">{fact.label}</div>
                <div className="font-medium">{fact.value}</div>
              </div>
            ))}
          </div>
        </div>

        {diagnostic.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="font-medium text-red-800">Erreurs</span>
            </div>
            <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
              {diagnostic.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {diagnostic.warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <span className="font-medium text-yellow-800">Avertissements</span>
            </div>
            <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
              {diagnostic.warnings.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StructuredBankStatementCsvDiagnosticReview;
