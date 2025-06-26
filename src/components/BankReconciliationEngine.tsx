
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress'; 
import { AlertTriangle, CheckCircle, Clock, MapPin, ArrowRight, FileText, FileCheck } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { CollectionReport, BankReport, DepositNotCleared } from '@/types/banking';
import { specializedMatchingService, MatchResult } from '@/services/specializedMatchingService';

interface MatchResult {
  collection: CollectionReport;
  deposit?: DepositNotCleared;
  impaye?: any;
  confidence: number;
  status: 'perfect' | 'partial' | 'unmatched';
  reasons: string[];
  matchType: 'effet' | 'cheque' | 'generic' | 'none';
}

const BankReconciliationEngine: React.FC = () => {
  const [collections, setCollections] = useState<CollectionReport[]>([]);
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [collectionsData, bankData] = await Promise.all([
        databaseService.getCollectionReports(),
        databaseService.getLatestBankReports()
      ]);
      
      setCollections(collectionsData.filter(c => c.status === 'pending'));
      setBankReports(bankData);
      console.log('📊 Données chargées:', { collections: collectionsData.length, banks: bankData.length });
    } catch (error) {
      console.error('❌ Erreur chargement données:', error);
    } finally {
      setLoading(false);
    }
  };

  const performMatching = async () => {
    if (collections.length === 0 || bankReports.length === 0) {
      console.warn('⚠️ Pas assez de données pour le rapprochement');
      return;
    }

    setLoading(true);
    setProgress(0);
    const results: MatchResult[] = [];
    
    // Créer une liste plate de tous les dépôts non crédités
    const allDeposits: (DepositNotCleared & { bankName: string })[] = [];
    bankReports.forEach(report => {
      report.depositsNotCleared.forEach(deposit => {
        allDeposits.push({ ...deposit, bankName: report.bank });
      });
    });
    
    // Créer une liste plate de tous les impayés
    const allImpayes: (any & { bankName: string })[] = [];
    bankReports.forEach(report => {
      report.impayes.forEach(impaye => {
        allImpayes.push({ ...impaye, bankName: report.bank });
      });
    });

    console.log('🔍 Début du rapprochement:', { collections: collections.length, deposits: allDeposits.length });

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      setProgress((i / collections.length) * 100);

      // Utiliser le service de rapprochement spécialisé
      const matchResult = specializedMatchingService.matchCollection(
        collection,
        allDeposits,
        allImpayes
      );
      
      results.push(matchResult);
    }

    setMatchResults(results);
    setProgress(100);
    setLoading(false);
    
    console.log('✅ Rapprochement terminé:', {
      perfect: results.filter(r => r.status === 'perfect').length,
      partial: results.filter(r => r.status === 'partial').length,
      unmatched: results.filter(r => r.status === 'unmatched').length
    });
  };

  const applyMatches = async () => {
    const perfectMatches = matchResults.filter(r => r.status === 'perfect');
    
    for (const match of perfectMatches) {
      if (match.deposit?.dateValeur) {
        await databaseService.updateCollectionDateOfValidity(
          match.collection.id!,
          match.deposit.dateValeur
        );
      }
    }

    // Recharger les données
    await loadData();
    setMatchResults([]);
    console.log(`✅ ${perfectMatches.length} rapprochements parfaits appliqués`);
  };

  const perfectMatches = matchResults.filter(r => r.status === 'perfect').length;
  const partialMatches = matchResults.filter(r => r.status === 'partial').length;
  const unmatchedCount = matchResults.filter(r => r.status === 'unmatched').length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Moteur de Rapprochement Bancaire
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{collections.length}</div>
              <div className="text-sm text-blue-800">Collections en attente</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {bankReports.reduce((sum, r) => sum + r.depositsNotCleared.length, 0)}
              </div>
              <div className="text-sm text-green-800">Dépôts non crédités</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">{perfectMatches}</div>
              <div className="text-sm text-purple-800">Rapprochements parfaits</div>
            </div>
          </div>

          <div className="flex gap-4">
            <Button 
              onClick={performMatching} 
              disabled={loading || collections.length === 0}
              className="flex items-center gap-2"
            >
              <Clock className="h-4 w-4" />
              Lancer le Rapprochement
            </Button>
            
            {perfectMatches > 0 && (
              <Button 
                onClick={applyMatches}
                variant="outline"
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Appliquer les Rapprochements Parfaits ({perfectMatches})
              </Button>
            )}
          </div>

          {loading && (
            <div className="mt-4">
              <Progress value={progress} className="mb-2" />
              <p className="text-sm text-muted-foreground">Analyse en cours... {Math.round(progress)}%</p>
            </div>
          )}
        </CardContent>
      </Card>

      {matchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats du Rapprochement</CardTitle>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                Parfait: {perfectMatches}
              </span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                Partiel: {partialMatches}
              </span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                Non rapproché: {unmatchedCount}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {matchResults.map((result, index) => (
                <div key={index} className={`p-4 border rounded-lg ${
                  result.status === 'perfect' ? 'border-green-200 bg-green-50' :
                  result.status === 'partial' ? 'border-yellow-200 bg-yellow-50' :
                  'border-red-200 bg-red-50'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={
                        result.status === 'perfect' ? 'default' :
                        result.status === 'partial' ? 'secondary' : 'destructive'
                      }>
                        {result.confidence}% confiance
                      </Badge>
                      <span className="font-medium">{result.collection.factureNo}</span>
                    </div>
                    <div>Banque: {result.collection.bankName || 'Non spécifiée'}</div>
                    <div>Type: {result.collection.collectionType || 'Non spécifié'} {
                      result.collection.collectionType === 'EFFET' ? 
                        `(Échéance: ${result.collection.effetEcheanceDate || 'N/A'})` : 
                      result.collection.collectionType === 'CHEQUE' ? 
                        `(N°: ${result.collection.chequeNumber || 'N/A'})` : 
                        ''
                    }</div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium">Collection:</div>
                      <div>Client: {result.collection.clientCode}</div>
                      <div>Montant: {result.collection.collectionAmount.toLocaleString()} FCFA</div>
                      <div>Banque: {result.collection.bankName}</div>
                    </div>
                    
                    {result.deposit && (
                      <div>
                        <div className="font-medium">Dépôt correspondant:</div>
                        <div>Montant: {result.deposit.montant.toLocaleString()} FCFA</div>
                        <div>Date: {result.deposit.dateValeur || result.deposit.dateDepot}</div>
                        <div>Réf: {result.deposit.reference}</div>
                      </div>
                    )}
                  </div>
                  
                  {result.reasons.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Critères: {result.reasons.join(', ')}
                      <div>Type: {result.deposit.typeReglement || 'Non spécifié'}</div>
                    </div>
                  )}
                  
                  {result.impaye && (
                    <div>
                      <div className="font-medium text-red-600">Impayé correspondant:</div>
                      <div>Montant: {result.impaye.montant.toLocaleString()} FCFA</div>
                      <div>Date: {result.impaye.dateEcheance}</div>
                      <div>Description: {result.impaye.description || 'Non spécifiée'}</div>
                    </div>
                  )}
                  
                  <div className="mt-2 text-xs">
                    <div className="flex items-center gap-1 mb-1">
                      <Badge className={
                        result.matchType === 'effet' ? 'bg-purple-100 text-purple-800' :
                        result.matchType === 'cheque' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }>
                        {result.matchType === 'effet' ? (
                          <>
                            <FileText className="h-3 w-3 mr-1" />
                            Effet
                          </>
                        ) : result.matchType === 'cheque' ? (
                          <>
                            <FileCheck className="h-3 w-3 mr-1" />
                            Chèque
                          </>
                        ) : (
                          'Générique'
                        )}
                      </Badge>
                      <span className="text-muted-foreground">
                        {result.confidence}% confiance
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Critères: {result.reasons.join(', ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BankReconciliationEngine;
