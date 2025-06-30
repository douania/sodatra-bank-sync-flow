import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BankReport } from '@/types/banking';

interface BankReportDetailedViewProps {
  bankReport: BankReport;
}

const BankReportDetailedView: React.FC<BankReportDetailedViewProps> = ({ bankReport }) => {
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleDateString('fr-FR');
    } catch (error) {
      return dateString;
    }
  };

  const getUtilizationColor = (percentage: number): string => {
    if (percentage > 90) return 'text-red-600';
    if (percentage > 70) return 'text-orange-600';
    if (percentage > 50) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="space-y-6">
      {/* Soldes et Calculs */}
      <Card>
        <CardHeader>
          <CardTitle>Rapport Bancaire: {bankReport.bank}</CardTitle>
          <CardDescription>Date: {formatDate(bankReport.date)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold">Soldes</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Solde d'ouverture:</span>
                  <span className="font-mono">{formatCurrency(bankReport.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Solde de clôture:</span>
                  <span className="font-mono">{formatCurrency(bankReport.closingBalance)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Mouvement:</span>
                  <span className={`font-mono ${
                    (bankReport.closingBalance - bankReport.openingBalance) >= 0 
                      ? 'text-green-600' 
                      : 'text-red-600'
                  }`}>
                    {formatCurrency(bankReport.closingBalance - bankReport.openingBalance)}
                  </span>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold">Statistiques</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Dépôts non crédités:</span>
                  <span>{bankReport.depositsNotCleared.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Chèques non débités:</span>
                  <span>{bankReport.checksNotCleared?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Facilités bancaires:</span>
                  <span>{bankReport.bankFacilities.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Impayés:</span>
                  <span>{bankReport.impayes.length}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dépôts Non Crédités */}
      {bankReport.depositsNotCleared.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dépôts Non Crédités</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Dépôt</TableHead>
                    <TableHead>Date Valeur</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankReport.depositsNotCleared.map((deposit, index) => (
                    <TableRow key={index}>
                      <TableCell>{formatDate(deposit.dateDepot)}</TableCell>
                      <TableCell>{formatDate(deposit.dateValeur)}</TableCell>
                      <TableCell>{deposit.typeReglement}</TableCell>
                      <TableCell>{deposit.clientCode || '-'}</TableCell>
                      <TableCell>{deposit.reference || '-'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(deposit.montant)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={5} className="font-semibold text-right">Total:</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.depositsNotCleared.reduce((sum, d) => sum + d.montant, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chèques Non Débités */}
      {bankReport.checksNotCleared && bankReport.checksNotCleared.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Chèques Non Débités</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Émission</TableHead>
                    <TableHead>N° Chèque</TableHead>
                    <TableHead>Bénéficiaire</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankReport.checksNotCleared.map((check, index) => (
                    <TableRow key={index}>
                      <TableCell>{formatDate(check.dateEmission)}</TableCell>
                      <TableCell>{check.numeroCheque}</TableCell>
                      <TableCell>{check.beneficiaire || '-'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(check.montant)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold text-right">Total:</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.checksNotCleared.reduce((sum, c) => sum + c.montant, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Facilités Bancaires */}
      {bankReport.bankFacilities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Facilités Bancaires</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type de Facilité</TableHead>
                    <TableHead className="text-right">Limite</TableHead>
                    <TableHead className="text-right">Utilisé</TableHead>
                    <TableHead className="text-right">Disponible</TableHead>
                    <TableHead className="text-right">Taux d'Utilisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankReport.bankFacilities.map((facility, index) => {
                    const utilizationRate = facility.limitAmount > 0 
                      ? (facility.usedAmount / facility.limitAmount) * 100 
                      : 0;
                    
                    return (
                      <TableRow key={index}>
                        <TableCell>{facility.facilityType}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(facility.limitAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(facility.usedAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(facility.availableAmount)}
                        </TableCell>
                        <TableCell className={`text-right ${getUtilizationColor(utilizationRate)}`}>
                          {utilizationRate.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={1} className="font-semibold text-right">Totaux:</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.bankFacilities.reduce((sum, f) => sum + f.availableAmount, 0))}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Impayés */}
      {bankReport.impayes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Impayés</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Échéance</TableHead>
                    <TableHead>Date Retour</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankReport.impayes.map((impaye, index) => (
                    <TableRow key={index}>
                      <TableCell>{formatDate(impaye.dateEcheance)}</TableCell>
                      <TableCell>{formatDate(impaye.dateRetour)}</TableCell>
                      <TableCell>{impaye.clientCode}</TableCell>
                      <TableCell>{impaye.description || '-'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(impaye.montant)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="font-semibold text-right">Total:</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(bankReport.impayes.reduce((sum, i) => sum + i.montant, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BankReportDetailedView;