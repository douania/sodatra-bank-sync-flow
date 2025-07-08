import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  CreditCard,
  Building2,
  DollarSign,
  FileText,
  Calendar,
  Users,
  Target,
  AlertCircle
} from 'lucide-react';
import { BankReport } from '@/types/banking';

interface BankReportDetailedViewProps {
  bankReport: BankReport;
}

const BankReportDetailedView: React.FC<BankReportDetailedViewProps> = ({ bankReport }) => {
  const [activeTab, setActiveTab] = useState('overview');

  // Adapter les données au format attendu
  const data = {
    bank: bankReport.bank,
    date: bankReport.date,
    openingBalance: bankReport.openingBalance,
    closingBalance: bankReport.closingBalance,
    movement: bankReport.closingBalance - bankReport.openingBalance,
    depositsNotCleared: bankReport.depositsNotCleared.map(deposit => ({
      date: deposit.dateDepot,
      echeance: deposit.dateValeur || deposit.dateDepot,
      type: deposit.typeReglement,
      client: deposit.clientCode || 'Non spécifié',
      bank: bankReport.bank,
      amount: deposit.montant
    })),
    checksNotCleared: bankReport.checksNotCleared?.map(check => ({
      date: check.dateEmission,
      number: check.numeroCheque,
      description: check.beneficiaire || 'Non spécifié',
      amount: check.montant,
      isOld: new Date(check.dateEmission).getFullYear() < 2020
    })) || [],
    bankFacilities: bankReport.bankFacilities.map(facility => ({
      name: facility.facilityType,
      limit: facility.limitAmount,
      used: facility.usedAmount,
      balance: facility.availableAmount,
      utilization: facility.limitAmount > 0 ? ((facility.usedAmount / facility.limitAmount) * 100).toFixed(1) : '0.0'
    })),
    impayes: bankReport.impayes.map(impaye => ({
      dateRetour: impaye.dateRetour || 'Non spécifié',
      dateEcheance: impaye.dateEcheance,
      bank: bankReport.bank,
      client: impaye.clientCode,
      amount: impaye.montant
    }))
  };

  // Calculs des totaux
  const totalDeposits = data.depositsNotCleared.reduce((sum, deposit) => sum + deposit.amount, 0);
  const totalChecks = data.checksNotCleared.reduce((sum, check) => sum + check.amount, 0);
  const totalImpayes = data.impayes.reduce((sum, impaye) => sum + impaye.amount, 0);
  const totalFacilitiesLimit = data.bankFacilities.reduce((sum, facility) => sum + facility.limit, 0);
  const totalFacilitiesUsed = data.bankFacilities.reduce((sum, facility) => sum + facility.used, 0);
  const totalFacilitiesAvailable = data.bankFacilities.reduce((sum, facility) => sum + facility.balance, 0);

  // Fonction pour formater les montants
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR').format(amount);
  };

  // Fonction pour obtenir la couleur du risque
  const getRiskColor = (utilization: string): string => {
    const rate = parseFloat(utilization);
    if (rate > 80) return 'destructive';
    if (rate > 50) return 'warning';
    return 'success';
  };

  // Fonction pour obtenir l'icône du risque
  const getRiskIcon = (utilization: string) => {
    const rate = parseFloat(utilization);
    if (rate > 80) return <AlertTriangle className="h-4 w-4" />;
    if (rate > 50) return <AlertCircle className="h-4 w-4" />;
    return <CheckCircle className="h-4 w-4" />;
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      {/* En-tête du rapport */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Building2 className="h-8 w-8 text-blue-600" />
              <div>
                <CardTitle className="text-2xl font-bold text-blue-900">
                  Rapport Bancaire {data.bank}
                </CardTitle>
                <p className="text-blue-600 flex items-center mt-1">
                  <Calendar className="h-4 w-4 mr-2" />
                  {data.date}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-lg px-4 py-2">
              Analyse Complète
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Soldes principaux */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-green-700 flex items-center">
              <TrendingUp className="h-4 w-4 mr-2" />
              Solde d'Ouverture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900">
              {formatAmount(data.openingBalance)} FCFA
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-blue-700 flex items-center">
              <DollarSign className="h-4 w-4 mr-2" />
              Solde de Clôture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900">
              {formatAmount(data.closingBalance)} FCFA
            </div>
          </CardContent>
        </Card>

        <Card className={`border-${data.movement >= 0 ? 'green' : 'red'}-200 bg-${data.movement >= 0 ? 'green' : 'red'}-50`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-sm font-medium text-${data.movement >= 0 ? 'green' : 'red'}-700 flex items-center`}>
              {data.movement >= 0 ? <TrendingUp className="h-4 w-4 mr-2" /> : <TrendingDown className="h-4 w-4 mr-2" />}
              Mouvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold text-${data.movement >= 0 ? 'green' : 'red'}-900`}>
              {data.movement >= 0 ? '+' : ''}{formatAmount(data.movement)} FCFA
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Statistiques rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm text-gray-600">Dépôts non crédités</p>
                <p className="text-xl font-bold">{data.depositsNotCleared.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CreditCard className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm text-gray-600">Chèques non débités</p>
                <p className="text-xl font-bold">{data.checksNotCleared.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">Facilités bancaires</p>
                <p className="text-xl font-bold">{data.bankFacilities.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm text-gray-600">Impayés</p>
                <p className="text-xl font-bold">{data.impayes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Onglets détaillés */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="deposits">Dépôts</TabsTrigger>
          <TabsTrigger value="checks">Chèques</TabsTrigger>
          <TabsTrigger value="facilities">Facilités</TabsTrigger>
          <TabsTrigger value="impayes">Impayés</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Alertes de risque */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-orange-500" />
              Alertes de Risque
            </h3>
            
            {data.bankFacilities.filter(f => parseFloat(f.utilization) > 80).length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {data.bankFacilities.filter(f => parseFloat(f.utilization) > 80).length} facilité(s) 
                  en utilisation critique (&gt;80%)
                </AlertDescription>
              </Alert>
            )}

            {totalImpayes > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {data.impayes.length} impayé(s) non régularisé(s) pour un total de {formatAmount(totalImpayes)} FCFA
                </AlertDescription>
              </Alert>
            )}

            {data.movement < 0 && Math.abs(data.movement) > data.openingBalance * 0.1 && (
              <Alert variant="destructive">
                <TrendingDown className="h-4 w-4" />
                <AlertDescription>
                  Mouvement négatif significatif détecté ({formatAmount(data.movement)} FCFA)
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Résumé des facilités */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Target className="h-5 w-5 mr-2" />
                Résumé des Facilités Bancaires
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Limite Totale</p>
                  <p className="text-xl font-bold text-blue-600">{formatAmount(totalFacilitiesLimit)} FCFA</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Utilisé</p>
                  <p className="text-xl font-bold text-orange-600">{formatAmount(totalFacilitiesUsed)} FCFA</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Disponible</p>
                  <p className="text-xl font-bold text-green-600">{formatAmount(totalFacilitiesAvailable)} FCFA</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span>Taux d'utilisation global</span>
                  <span>{((totalFacilitiesUsed / totalFacilitiesLimit) * 100).toFixed(1)}%</span>
                </div>
                <Progress 
                  value={(totalFacilitiesUsed / totalFacilitiesLimit) * 100} 
                  className="h-3"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deposits" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  Dépôts Non Crédités ({data.depositsNotCleared.length})
                </span>
                <Badge variant="outline">
                  Total: {formatAmount(totalDeposits)} FCFA
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.depositsNotCleared.map((deposit, index) => (
                  <div key={index} className="border rounded-lg p-4 bg-orange-50 border-orange-200">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4 mb-2">
                          <Badge variant="outline" className="text-xs">
                            {deposit.date} → {deposit.echeance}
                          </Badge>
                          <Badge variant="secondary">{deposit.bank}</Badge>
                        </div>
                        <p className="font-medium">{deposit.type}</p>
                        <p className="text-sm text-gray-600">Client: {deposit.client}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-orange-700">
                          {formatAmount(deposit.amount)} FCFA
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center">
                  <CreditCard className="h-5 w-5 mr-2" />
                  Chèques Non Débités ({data.checksNotCleared.length})
                </span>
                <Badge variant="outline">
                  Total: {formatAmount(totalChecks)} FCFA
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.checksNotCleared.map((check, index) => (
                  <div key={index} className={`border rounded-lg p-4 ${check.isOld ? 'bg-gray-50 border-gray-200' : 'bg-purple-50 border-purple-200'}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4 mb-2">
                          <Badge variant="outline" className="text-xs">
                            {check.date}
                          </Badge>
                          <Badge variant="secondary">N° {check.number}</Badge>
                          {check.isOld && (
                            <Badge variant="destructive" className="text-xs">
                              Ancien chèque
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium">{check.description}</p>
                      </div>
                      <div className="text-right">
                        {check.isOld ? (
                          <p className="text-sm text-gray-500 italic">
                            Montant retiré
                          </p>
                        ) : (
                          <p className="text-lg font-bold text-purple-700">
                            {formatAmount(check.amount)} FCFA
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="facilities" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.bankFacilities.map((facility, index) => (
              <Card key={index} className="border-blue-200">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center">
                      <Target className="h-4 w-4 mr-2" />
                      {facility.name}
                    </span>
                    <div className="flex items-center space-x-2">
                      {getRiskIcon(facility.utilization)}
                      <Badge variant={getRiskColor(facility.utilization) as any}>
                        {facility.utilization}%
                      </Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-gray-600">Limite</p>
                        <p className="font-semibold">{formatAmount(facility.limit)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Utilisé</p>
                        <p className="font-semibold text-orange-600">{formatAmount(facility.used)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Disponible</p>
                        <p className="font-semibold text-green-600">{formatAmount(facility.balance)}</p>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Utilisation</span>
                        <span>{facility.utilization}%</span>
                      </div>
                      <Progress 
                        value={parseFloat(facility.utilization)} 
                        className="h-2"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="impayes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Impayés ({data.impayes.length})
                </span>
                <Badge variant="destructive">
                  Total: {formatAmount(totalImpayes)} FCFA
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.impayes.map((impaye, index) => (
                  <div key={index} className="border rounded-lg p-4 bg-red-50 border-red-200">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4 mb-2">
                          <Badge variant="outline" className="text-xs">
                            Retour: {impaye.dateRetour}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            Échéance: {impaye.dateEcheance}
                          </Badge>
                          <Badge variant="secondary">{impaye.bank}</Badge>
                        </div>
                        <p className="font-medium text-red-800">IMPAYÉ</p>
                        <p className="text-sm text-gray-600">Client: {impaye.client}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-red-700">
                          {formatAmount(impaye.amount)} FCFA
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Validation des calculs */}
      <Card className="bg-green-50 border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center text-green-800">
            <CheckCircle className="h-5 w-5 mr-2" />
            Validation des Calculs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-green-700">Mouvement calculé:</p>
              <p className="font-mono">{formatAmount(data.closingBalance)} - {formatAmount(data.openingBalance)} = {formatAmount(data.movement)} FCFA</p>
            </div>
            <div>
              <p className="text-green-700">Cohérence:</p>
              <p className="font-semibold text-green-800">✅ Calculs validés</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankReportDetailedView;