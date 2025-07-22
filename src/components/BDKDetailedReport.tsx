import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, AlertCircle, Calculator, TrendingUp, TrendingDown, Database, Info } from 'lucide-react';
import { BDKParsedData } from '@/services/bdkExtractionService';

interface BDKDetailedReportProps {
  data: BDKParsedData;
}

export const BDKDetailedReport: React.FC<BDKDetailedReportProps> = ({ data }) => {
  console.log('🖥️ [BDKDetailedReport] Rendu avec données:', {
    deposits: data.deposits.length,
    checks: data.checks.length,
    facilities: data.facilities.length,
    impayes: data.impayes.length,
    validation: data.validation,
    timestamp: new Date().toISOString()
  });

  const formatAmount = (amount: number) => amount.toLocaleString() + ' FCFA';

  const ValidationBadge = ({ isValid, discrepancy }: { isValid: boolean; discrepancy: number }) => (
    <div className="flex items-center space-x-2">
      {isValid ? (
        <Badge className="bg-green-100 text-green-800 flex items-center space-x-1">
          <CheckCircle className="h-3 w-3" />
          <span>Validé</span>
        </Badge>
      ) : (
        <Badge className="bg-red-100 text-red-800 flex items-center space-x-1">
          <AlertCircle className="h-3 w-3" />
          <span>Écart: {formatAmount(Math.abs(discrepancy))}</span>
        </Badge>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* En-tête avec validation et informations sur la source des données */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Relevé BDK - {data.reportDate}</CardTitle>
              <CardDescription>Analyse complète avec validation automatique (Extraction Positionnelle)</CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="flex items-center space-x-1">
                <Database className="h-3 w-3" />
                <span>Données Positionnelles</span>
              </Badge>
              <ValidationBadge isValid={data.validation.isValid} discrepancy={data.validation.discrepancy} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Panneau d'informations sur la source des données */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">Source des Données</span>
            </div>
            <div className="text-sm text-blue-700">
              <p>Les données affichées proviennent de l'extraction positionnelle calibrée. Les montants sont strictement séparés des numéros de référence.</p>
              <p className="mt-1">
                <strong>Dépôts:</strong> {data.deposits.length} lignes extraites | 
                <strong> Chèques:</strong> {data.checks.length} lignes extraites | 
                <strong> Validation:</strong> {data.validation.isValid ? 'Équilibrée' : 'Écart détecté'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-800">Solde d'ouverture</span>
              </div>
              <p className="text-lg font-bold text-blue-900 mt-1">
                {formatAmount(data.openingBalance.amount)}
              </p>
              <p className="text-xs text-blue-600">{data.openingBalance.date}</p>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-green-800">Total Dépôts</span>
              </div>
              <p className="text-lg font-bold text-green-900 mt-1">
                {formatAmount(data.totalDeposits)}
              </p>
              <p className="text-xs text-green-600">{data.deposits.length} dépôts</p>
            </div>
            
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <TrendingDown className="h-5 w-5 text-orange-600" />
                <span className="text-sm font-medium text-orange-800">Total Chèques</span>
              </div>
              <p className="text-lg font-bold text-orange-900 mt-1">
                {formatAmount(data.totalChecks)}
              </p>
              <p className="text-xs text-orange-600">{data.checks.length} chèques</p>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <Calculator className="h-5 w-5 text-purple-600" />
                <span className="text-sm font-medium text-purple-800">Solde de clôture</span>
              </div>
              <p className="text-lg font-bold text-purple-900 mt-1">
                {formatAmount(data.closingBalance)}
              </p>
              <p className="text-xs text-purple-600">
                Calculé: {formatAmount(data.validation.calculatedClosing)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation mathématique */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5" />
            <span>Validation Mathématique</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="space-y-2 font-mono text-sm">
              <div className="flex justify-between">
                <span>Solde d'ouverture:</span>
                <span className="font-bold">{formatAmount(data.openingBalance.amount)}</span>
              </div>
              <div className="flex justify-between text-green-700">
                <span>+ Dépôts non crédités:</span>
                <span className="font-bold">+ {formatAmount(data.totalDeposits)}</span>
              </div>
              <div className="border-t pt-2">
                <div className="flex justify-between">
                  <span>= Total Balance (A):</span>
                  <span className="font-bold">{formatAmount(data.totalBalanceA)}</span>
                </div>
              </div>
              <div className="flex justify-between text-red-700">
                <span>- Chèques non débités:</span>
                <span className="font-bold">- {formatAmount(data.totalChecks)}</span>
              </div>
              <div className="border-t pt-2 border-black">
                <div className="flex justify-between text-lg font-bold">
                  <span>= Solde calculé:</span>
                  <span>{formatAmount(data.validation.calculatedClosing)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Solde déclaré:</span>
                  <span>{formatAmount(data.closingBalance)}</span>
                </div>
                {!data.validation.isValid && (
                  <div className="flex justify-between text-red-600 font-bold">
                    <span>Écart:</span>
                    <span>{formatAmount(data.validation.discrepancy)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dépôts non crédités */}
      <Card>
        <CardHeader>
          <CardTitle>Dépôts Non Crédités ({data.deposits.length})</CardTitle>
          <CardDescription>
            Total: {formatAmount(data.totalDeposits)} - Extraction positionnelle par colonnes calibrées
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date Opération</TableHead>
                <TableHead>Date Valeur</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Montant (FCFA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.deposits.map((deposit, index) => (
                <TableRow key={index}>
                  <TableCell>{deposit.dateOperation}</TableCell>
                  <TableCell>{deposit.dateValeur}</TableCell>
                  <TableCell>{deposit.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {deposit.vendor}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{deposit.client}</TableCell>
                  <TableCell className="text-right font-bold text-green-700">
                    {formatAmount(deposit.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Chèques non débités */}
      <Card>
        <CardHeader>
          <CardTitle>Chèques Non Débités ({data.checks.length})</CardTitle>
          <CardDescription>
            Total: {formatAmount(data.totalChecks)} - Séparation stricte numéros/montants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>N° Chèque</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead className="text-right">Montant (FCFA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.checks.map((check, index) => (
                <TableRow key={index} className={new Date(check.date.split('/').reverse().join('-')) < new Date('2020-01-01') ? 'bg-yellow-50' : ''}>
                  <TableCell>{check.date}</TableCell>
                  <TableCell className="font-mono text-blue-600">{check.checkNumber}</TableCell>
                  <TableCell>{check.description}</TableCell>
                  <TableCell>{check.client}</TableCell>
                  <TableCell className="font-mono text-gray-600">{check.reference}</TableCell>
                  <TableCell className="text-right font-bold text-red-700">
                    {formatAmount(check.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {data.checks.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>Aucun chèque non débité détecté</p>
              <p className="text-xs mt-1">Vérifiez que la section "CHECK Not yet cleared" est présente dans le document</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Facilités bancaires */}
      <Card>
        <CardHeader>
          <CardTitle>Facilités Bancaires ({data.facilities.length})</CardTitle>
          <CardDescription>
            Total Limite: {formatAmount(data.totalFacilities.totalLimit)} | 
            Utilisé: {formatAmount(data.totalFacilities.totalUsed)} | 
            Disponible: {formatAmount(data.totalFacilities.totalBalance)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facilité</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead className="text-right">Limite</TableHead>
                <TableHead className="text-right">Utilisé</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Utilisation %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.facilities.map((facility, index) => {
                const utilizationRate = facility.limit > 0 ? (facility.used / facility.limit * 100) : 0;
                return (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{facility.name}</TableCell>
                    <TableCell>{facility.dateEcheance || 'N/A'}</TableCell>
                    <TableCell className="text-right">{formatAmount(facility.limit)}</TableCell>
                    <TableCell className="text-right">{formatAmount(facility.used)}</TableCell>
                    <TableCell className="text-right">{formatAmount(facility.balance)}</TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        variant={utilizationRate > 80 ? "destructive" : utilizationRate > 50 ? "secondary" : "outline"}
                        className="text-xs"
                      >
                        {utilizationRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Impayés */}
      {data.impayes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-700">Impayés ({data.impayes.length})</CardTitle>
            <CardDescription>
              Total: {formatAmount(data.impayes.reduce((sum, imp) => sum + imp.amount, 0))}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>Banque</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.impayes.map((impaye, index) => (
                  <TableRow key={index} className="bg-red-50">
                    <TableCell>{impaye.date}</TableCell>
                    <TableCell className="font-mono">{impaye.reference}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {impaye.bank}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{impaye.client}</TableCell>
                    <TableCell>{impaye.description}</TableCell>
                    <TableCell className="text-right font-bold text-red-700">
                      {formatAmount(impaye.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BDKDetailedReport;
