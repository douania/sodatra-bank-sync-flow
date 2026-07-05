import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileSpreadsheet, ShieldCheck, AlertTriangle, XCircle, DatabaseZap } from 'lucide-react';
import type { CollectionImportReview as CollectionImportReviewData, CollectionProposedStatus } from '@/types/processing';

// ⭐ PACK-C — Review humaine du staging Collection Report.
// Ce composant n'effectue AUCUNE écriture DB : il affiche le staging en mémoire
// et délègue la promotion (action explicite) au parent via onPromote.

interface CollectionImportReviewProps {
  review: CollectionImportReviewData;
  promoting: boolean;
  promotionDone: boolean;
  onPromote: (reviewWithSelection: CollectionImportReviewData) => void;
}

const formatNumber = (num: number) => new Intl.NumberFormat('fr-FR').format(num);

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'XOF',
    minimumFractionDigits: 0,
  }).format(amount);

const statusBadge = (status?: CollectionProposedStatus) => {
  if (status === 'NEW') {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">NEW</Badge>;
  }
  if (status === 'EXISTS_COMPLETE') {
    return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">EXISTS_COMPLETE</Badge>;
  }
  if (status === 'EXISTS_INCOMPLETE') {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">EXISTS_INCOMPLETE</Badge>;
  }
  return <Badge variant="outline">indisponible</Badge>;
};

const CollectionImportReview: React.FC<CollectionImportReviewProps> = ({
  review,
  promoting,
  promotionDone,
  onPromote,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(review.acceptedRows.filter(r => r.selected).map(r => r.rowId))
  );

  // Nouvelle review préparée → réinitialiser la sélection sur son état initial.
  useEffect(() => {
    setSelectedIds(new Set(review.acceptedRows.filter(r => r.selected).map(r => r.rowId)));
  }, [review.preparedAt, review.acceptedRows]);

  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === review.acceptedRows.length && review.acceptedRows.length > 0;

  const totalSelectedAmount = useMemo(
    () =>
      review.acceptedRows
        .filter(r => selectedIds.has(r.rowId))
        .reduce((sum, r) => sum + (r.collection.collectionAmount || 0), 0),
    [review.acceptedRows, selectedIds]
  );

  const toggleRow = (rowId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(review.acceptedRows.map(r => r.rowId)) : new Set());
  };

  const handlePromoteClick = () => {
    onPromote({
      ...review,
      acceptedRows: review.acceptedRows.map(row => ({
        ...row,
        selected: selectedIds.has(row.rowId),
      })),
    });
  };

  const promotionBlocked = !review.reviewReady || selectedCount === 0 || promoting || promotionDone;

  return (
    <Card className="mb-8 border-blue-300">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileSpreadsheet className="h-5 w-5 text-blue-600" />
          <span>Review de l'import Collection (staging)</span>
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            Aucune écriture DB avant promotion
          </Badge>
        </CardTitle>
        <CardDescription>
          Vérifiez les lignes extraites, puis promouvez explicitement les lignes validées.
          Fichier(s) : {review.files.join(', ') || '—'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Compteurs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <p className="text-sm text-gray-500">Fichiers analysés</p>
              <p className="text-xl font-bold">{formatNumber(review.counters.files_processed)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Lignes acceptées</p>
              <p className="text-xl font-bold text-green-600">{formatNumber(review.counters.accepted_rows)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Lignes rejetées</p>
              <p className={`text-xl font-bold ${review.counters.rejected_rows > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatNumber(review.counters.rejected_rows)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Rejets globaux fichier</p>
              <p className={`text-xl font-bold ${review.counters.file_level_rejections > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatNumber(review.counters.file_level_rejections)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Warnings</p>
              <p className={`text-xl font-bold ${review.counters.warnings > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                {formatNumber(review.counters.warnings)}
              </p>
            </div>
          </div>

          {/* Rejets globaux fichier */}
          {review.fileLevelErrors.length > 0 && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Rejet global de fichier</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {review.fileLevelErrors.map((issue, index) => (
                    <div key={index} className="text-xs">
                      {issue.file} — {issue.message}
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Lignes rejetées */}
          {review.rejectedRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700 mb-1">
                Lignes rejetées ({formatNumber(review.rejectedRows.length)}) — non promouvables
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {review.rejectedRows.map((issue, index) => (
                  <div key={index} className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                    {issue.file} — {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {review.warnings.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-700 mb-1">
                Warnings ({formatNumber(review.warnings.length)})
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {review.warnings.map((issue, index) => (
                  <div key={index} className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    {issue.file} — {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tableau des lignes acceptées */}
          {review.acceptedRows.length > 0 ? (
            <div className="border rounded-lg max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={checked => toggleAll(checked === true)}
                        disabled={promoting || promotionDone}
                        aria-label="Tout sélectionner"
                      />
                    </TableHead>
                    <TableHead>Fichier / ligne</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Banque</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Statut proposé</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {review.acceptedRows.map(row => (
                    <TableRow key={row.rowId}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(row.rowId)}
                          onCheckedChange={checked => toggleRow(row.rowId, checked === true)}
                          disabled={promoting || promotionDone}
                          aria-label={`Valider la ligne ${row.collection.excelSourceRow}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {row.collection.excelFilename} · L{row.collection.excelSourceRow}
                      </TableCell>
                      <TableCell className="text-xs">{row.collection.reportDate}</TableCell>
                      <TableCell className="text-xs font-medium">{row.collection.clientCode}</TableCell>
                      <TableCell className="text-xs">{row.collection.bankName || '—'}</TableCell>
                      <TableCell className="text-xs text-right">
                        {formatCurrency(row.collection.collectionAmount || 0)}
                      </TableCell>
                      <TableCell>{statusBadge(row.proposedStatus)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Aucune ligne acceptée : la promotion est impossible. Corrigez le fichier source
                puis relancez l'analyse.
              </AlertDescription>
            </Alert>
          )}

          {/* Barre d'action promotion */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center space-x-2 text-sm text-blue-800">
              <ShieldCheck className="h-4 w-4" />
              <span>
                {promotionDone
                  ? 'Écriture DB effectuée après validation.'
                  : `${formatNumber(selectedCount)} ligne(s) validée(s) sur ${formatNumber(review.acceptedRows.length)} — montant sélectionné : ${formatCurrency(totalSelectedAmount)}. Aucune écriture DB avant promotion.`}
              </span>
            </div>
            <Button
              onClick={handlePromoteClick}
              disabled={promotionBlocked}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <DatabaseZap className="mr-2 h-4 w-4" />
              {promotionDone
                ? 'Promotion effectuée'
                : promoting
                  ? 'Promotion en cours...'
                  : `Promouvoir ${formatNumber(selectedCount)} ligne(s) validée(s)`}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CollectionImportReview;
