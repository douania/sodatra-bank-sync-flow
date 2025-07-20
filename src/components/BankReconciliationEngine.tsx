
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  GitMerge, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  DollarSign,
  Users,
  FileText,
  Activity,
  TrendingUp
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ReconciliationResult {
  id: string;
  collectionId: string;
  bankTransactionId: string;
  matchType: 'exact' | 'fuzzy' | 'manual';
  confidence: number;
  status: 'matched' | 'pending' | 'rejected';
  discrepancies: string[];
  amount: number;
  date: string;
  clientCode: string;
  bankName: string;
}

interface ReconciliationStats {
  totalCollections: number;
  totalBankTransactions: number;
  matchedCount: number;
  pendingCount: number;
  unmatchedCount: number;
  matchingRate: number;
  totalAmount: number;
  matchedAmount: number;
}

export function BankReconciliationEngine() {
  const [reconciliationResults, setReconciliationResults] = useState<ReconciliationResult[]>([]);
  const [stats, setStats] = useState<ReconciliationStats>({
    totalCollections: 0,
    totalBankTransactions: 0,
    matchedCount: 0,
    pendingCount: 0,
    unmatchedCount: 0,
    matchingRate: 0,
    totalAmount: 0,
    matchedAmount: 0
  });
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>('all');

  useEffect(() => {
    loadReconciliationData();
  }, [selectedBank]);

  const loadReconciliationData = async () => {
    try {
      setLoading(true);
      
      // Charger les données de réconciliation
      const { data: collections, error: collectionsError } = await supabase
        .from('collection_report')
        .select('*')
        .eq(selectedBank !== 'all' ? 'bank_name' : 'id', selectedBank !== 'all' ? selectedBank : undefined)
        .order('created_at', { ascending: false })
        .limit(100);

      if (collectionsError) throw collectionsError;

      // Simuler des résultats de réconciliation
      const mockResults: ReconciliationResult[] = collections?.map((collection, index) => ({
        id: `rec-${collection.id}`,
        collectionId: collection.id,
        bankTransactionId: `bank-tx-${index}`,
        matchType: index % 3 === 0 ? 'exact' : index % 3 === 1 ? 'fuzzy' : 'manual',
        confidence: index % 3 === 0 ? 100 : index % 3 === 1 ? 85 : 65,
        status: index % 4 === 0 ? 'matched' : index % 4 === 1 ? 'pending' : 'matched',
        discrepancies: index % 5 === 0 ? ['Montant différent: 5000 FCFA'] : [],
        amount: collection.collection_amount || 0,
        date: collection.report_date,
        clientCode: collection.client_code,
        bankName: collection.bank_name || 'Unknown'
      })) || [];

      setReconciliationResults(mockResults);

      // Calculer les statistiques
      const totalAmount = mockResults.reduce((sum, r) => sum + r.amount, 0);
      const matchedResults = mockResults.filter(r => r.status === 'matched');
      const matchedAmount = matchedResults.reduce((sum, r) => sum + r.amount, 0);

      setStats({
        totalCollections: collections?.length || 0,
        totalBankTransactions: (collections?.length || 0) + 10, // Simulation
        matchedCount: matchedResults.length,
        pendingCount: mockResults.filter(r => r.status === 'pending').length,
        unmatchedCount: mockResults.filter(r => r.status === 'rejected').length,
        matchingRate: mockResults.length > 0 ? (matchedResults.length / mockResults.length) * 100 : 0,
        totalAmount,
        matchedAmount
      });

    } catch (error) {
      console.error('Erreur lors du chargement des données de réconciliation:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const runReconciliation = async () => {
    try {
      setProcessing(true);
      toast.info('Lancement de la réconciliation automatique...');
      
      // Simuler un processus de réconciliation
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      await loadReconciliationData();
      toast.success('Réconciliation terminée avec succès');
      
    } catch (error) {
      console.error('Erreur lors de la réconciliation:', error);
      toast.error('Erreur lors de la réconciliation');
    } finally {
      setProcessing(false);
    }
  };

  const validateMatch = async (resultId: string) => {
    try {
      // Simuler la validation
      setReconciliationResults(prev => 
        prev.map(r => 
          r.id === resultId 
            ? { ...r, status: 'matched' as const }
            : r
        )
      );
      toast.success('Rapprochement validé');
    } catch (error) {
      toast.error('Erreur lors de la validation');
    }
  };

  const rejectMatch = async (resultId: string) => {
    try {
      // Simuler le rejet
      setReconciliationResults(prev => 
        prev.map(r => 
          r.id === resultId 
            ? { ...r, status: 'rejected' as const }
            : r
        )
      );
      toast.success('Rapprochement rejeté');
    } catch (error) {
      toast.error('Erreur lors du rejet');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'matched': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'pending': return <Clock className="h-4 w-4 text-warning" />;
      case 'rejected': return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched': return <Badge variant="default">Rapproché</Badge>;
      case 'pending': return <Badge variant="secondary">En attente</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejeté</Badge>;
      default: return <Badge variant="outline">Inconnu</Badge>;
    }
  };

  const getMatchTypeBadge = (matchType: string) => {
    switch (matchType) {
      case 'exact': return <Badge variant="default">Exact</Badge>;
      case 'fuzzy': return <Badge variant="secondary">Approximatif</Badge>;
      case 'manual': return <Badge variant="outline">Manuel</Badge>;
      default: return <Badge variant="outline">Inconnu</Badge>;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'text-success';
    if (confidence >= 70) return 'text-warning';
    return 'text-destructive';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold flex items-center gap-2">
          <GitMerge className="h-8 w-8" />
          Moteur de Réconciliation
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            className="px-3 py-2 border rounded-md"
          >
            <option value="all">Toutes les banques</option>
            <option value="BDK">BDK</option>
            <option value="SGS">SGS</option>
            <option value="BICIS">BICIS</option>
            <option value="ATB">ATB</option>
            <option value="ORA">ORA</option>
            <option value="BIS">BIS</option>
          </select>
          <Button 
            onClick={runReconciliation}
            disabled={processing}
            className="flex items-center gap-2"
          >
            <Activity className="h-4 w-4" />
            {processing ? 'Traitement...' : 'Lancer Réconciliation'}
          </Button>
        </div>
      </div>

      {processing && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p>Réconciliation en cours...</p>
              <Progress value={75} className="mt-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taux de Rapprochement</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats.matchingRate.toFixed(1)}%</div>
            <Progress value={stats.matchingRate} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {stats.matchedCount} sur {stats.totalCollections}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Montant Rapproché</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats.matchedAmount / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">
              sur {(stats.totalAmount / 1000000).toFixed(1)}M FCFA
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Attente</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.pendingCount}</div>
            <p className="text-xs text-muted-foreground">
              Nécessitent validation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Non Rapprochés</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.unmatchedCount}</div>
            <p className="text-xs text-muted-foreground">
              Nécessitent attention
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="results" className="space-y-4">
        <TabsList>
          <TabsTrigger value="results">Résultats de Réconciliation</TabsTrigger>
          <TabsTrigger value="pending">En Attente ({stats.pendingCount})</TabsTrigger>
          <TabsTrigger value="unmatched">Non Rapprochés ({stats.unmatchedCount})</TabsTrigger>
          <TabsTrigger value="rules">Règles de Rapprochement</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="space-y-4">
          <div className="space-y-4">
            {reconciliationResults.map((result) => (
              <Card key={result.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(result.status)}
                        <span className="font-semibold">{result.clientCode}</span>
                        {getStatusBadge(result.status)}
                        {getMatchTypeBadge(result.matchType)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span>Banque: {result.bankName}</span>
                        <span className="mx-2">•</span>
                        <span>Date: {new Date(result.date).toLocaleDateString()}</span>
                        <span className="mx-2">•</span>
                        <span className={getConfidenceColor(result.confidence)}>
                          Confiance: {result.confidence}%
                        </span>
                      </div>
                      {result.discrepancies.length > 0 && (
                        <div className="text-sm text-warning">
                          Écarts détectés: {result.discrepancies.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">
                        {result.amount.toLocaleString()} FCFA
                      </div>
                      {result.status === 'pending' && (
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            onClick={() => validateMatch(result.id)}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Valider
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rejectMatch(result.id)}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Rejeter
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <div className="space-y-4">
            {reconciliationResults
              .filter(r => r.status === 'pending')
              .map((result) => (
                <Card key={result.id}>
                  <CardContent className="pt-4">
                    <Alert>
                      <Clock className="h-4 w-4" />
                      <AlertDescription>
                        <div className="flex items-center justify-between">
                          <div>
                            <strong>{result.clientCode}</strong> - {result.amount.toLocaleString()} FCFA
                            <br />
                            <span className="text-sm">
                              Confiance: {result.confidence}% | Banque: {result.bankName}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => validateMatch(result.id)}
                            >
                              Valider
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => rejectMatch(result.id)}
                            >
                              Rejeter
                            </Button>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="unmatched" className="space-y-4">
          <div className="space-y-4">
            {reconciliationResults
              .filter(r => r.status === 'rejected')
              .map((result) => (
                <Card key={result.id}>
                  <CardContent className="pt-4">
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>{result.clientCode}</strong> - {result.amount.toLocaleString()} FCFA
                        <br />
                        <span className="text-sm">
                          Banque: {result.bankName} | Nécessite intervention manuelle
                        </span>
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Règles de Rapprochement Automatique</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold">Critères de Rapprochement Exact</h4>
                <ul className="text-sm text-muted-foreground space-y-1 mt-2">
                  <li>• Montant identique (±0%)</li>
                  <li>• Code client exact</li>
                  <li>• Date dans la plage de ±2 jours</li>
                  <li>• Banque correspondante</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">Critères de Rapprochement Approximatif</h4>
                <ul className="text-sm text-muted-foreground space-y-1 mt-2">
                  <li>• Montant similaire (±5%)</li>
                  <li>• Code client similaire (score de similarité > 80%)</li>
                  <li>• Date dans la plage de ±5 jours</li>
                  <li>• Banque correspondante</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">Seuils de Confiance</h4>
                <ul className="text-sm text-muted-foreground space-y-1 mt-2">
                  <li>• Validation automatique: ≥95%</li>
                  <li>• Validation manuelle: 70-94%</li>
                  <li>• Rejet automatique: &lt;70%</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


