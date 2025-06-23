
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Clock, MapPin, ArrowRight } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { CollectionReport, BankReport, DepositNotCleared } from '@/types/banking';

interface MatchResult {
  collection: CollectionReport;
  deposit?: DepositNotCleared;
  confidence: number;
  status: 'perfect' | 'partial' | 'unmatched';
  reasons: string[];
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

    console.log('🔍 Début du rapprochement:', { collections: collections.length, deposits: allDeposits.length });

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      setProgress((i / collections.length) * 100);

      // Algorithme de rapprochement amélioré
      let bestMatch: (DepositNotCleared & { bankName: string }) | undefined;
      let maxConfidence = 0;
      const reasons: string[] = [];

      for (const deposit of allDeposits) {
        let confidence = 0;
        const matchReasons: string[] = [];

        // 1. Correspondance exacte du montant (50 points)
        if (Math.abs(collection.collectionAmount - deposit.montant) < 1) {
          confidence += 50;
          matchReasons.push('Montant exact');
        } else if (Math.abs(collection.collectionAmount - deposit.montant) / collection.collectionAmount < 0.05) {
          confidence += 30;
          matchReasons.push('Montant proche (±5%)');
        }

        // 2. Correspondance de la banque (30 points)
        if (collection.bankName && deposit.bankName.toLowerCase().includes(collection.bankName.toLowerCase())) {
          confidence += 30;
          matchReasons.push('Banque correspondante');
        }

        // 3. Correspondance de la date (20 points)
        if (collection.dateOfValidity && deposit.dateValeur) {
          const dateDiff = Math.abs(new Date(collection.dateOfValidity).getTime() - new Date(deposit.dateValeur).getTime());
          const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
          
          if (daysDiff <= 1) {
            confidence += 20;
            matchReasons.push('Date exacte');
          } else if (daysDiff <= 3) {
            confidence += 10;
            matchReasons.push('Date proche');
          }
        }

        // 4. Correspondance du code client ou référence
        if (collection.clientCode && (deposit.clientCode === collection.clientCode || deposit.reference?.includes(collection.clientCode))) {
          confidence += 15;
          matchReasons.push('Code client/référence');
        }

        if (confidence > maxConfidence) {
          maxConfidence = confidence;
          bestMatch = deposit;
          reasons.length = 0;
          reasons.push(...matchReasons);
        }
      }

      // Déterminer le statut basé sur la confiance
      let status: 'perfect' | 'partial' | 'unmatched' = 'unmatched';
      if (maxConfidence >= 80) status = 'perfect';
      else if (maxConfidence >= 50) status = 'partial';

      results.push({
        collection,
        deposit: bestMatch,
        confidence: maxConfidence,
        status,
        reasons
      });
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
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
                    </div>
                  )}
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
