
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Eye, 
  TrendingUp,
  BarChart3,
  Brain,
  Clock
} from 'lucide-react';
import { QualityReport, QualityError } from '@/types/qualityControl';

interface QualityControlDashboardProps {
  report: QualityReport | null;
  onValidateError: (errorId: string) => void;
  onRejectError: (errorId: string, reason: string) => void;
  onModifyCorrection: (errorId: string, correction: any) => void;
}

const QualityControlDashboard: React.FC<QualityControlDashboardProps> = ({
  report,
  onValidateError,
  onRejectError,
  onModifyCorrection
}) => {
  const [selectedError, setSelectedError] = useState<QualityError | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-6 w-6" />
            <span>Contrôle Qualité</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-gray-500">
            Aucun rapport de qualité disponible. Lancez une analyse pour commencer.
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderQualitySummary = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <div>
              <div className="text-2xl font-bold">{report.summary.total_collections_analyzed}</div>
              <div className="text-sm text-gray-600">Collections analysées</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <div>
              <div className="text-2xl font-bold text-red-600">{report.summary.errors_detected}</div>
              <div className="text-sm text-gray-600">Erreurs détectées</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-yellow-600" />
            <div>
              <div className="text-2xl font-bold text-yellow-600">{report.summary.error_rate}%</div>
              <div className="text-sm text-gray-600">Taux d'erreur</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <Brain className="h-4 w-4 text-green-600" />
            <div>
              <div className="text-2xl font-bold text-green-600">{report.summary.confidence_score}%</div>
              <div className="text-sm text-gray-600">Score de confiance</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderErrorsByType = () => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Répartition des Erreurs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-2">
            <Badge variant="destructive" className="w-3 h-3 p-0 rounded-full"></Badge>
            <span className="text-sm">Erreurs de saisie: {report.errors_by_type.saisie_errors}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className="w-3 h-3 p-0 rounded-full bg-orange-500"></Badge>
            <span className="text-sm">Omissions: {report.errors_by_type.omissions}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="w-3 h-3 p-0 rounded-full bg-yellow-500"></Badge>
            <span className="text-sm">Incohérences: {report.errors_by_type.incohérences}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const getErrorIcon = (error: QualityError) => {
    switch (error.type) {
      case 'SAISIE_ERROR':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'OMISSION_ERROR':
        return <XCircle className="h-4 w-4 text-orange-600" />;
      case 'INCOHÉRENCE_ERROR':
        return <Eye className="h-4 w-4 text-yellow-600" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getErrorTypeLabel = (error: QualityError) => {
    const labels = {
      'SAISIE_ERROR': 'Erreur de saisie',
      'OMISSION_ERROR': 'Omission',
      'INCOHÉRENCE_ERROR': 'Incohérence'
    };
    return labels[error.type] || error.type;
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600';
    if (confidence >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  const renderErrorCard = (error: QualityError) => (
    <Card key={error.id} className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {getErrorIcon(error)}
            <span className="font-semibold">{getErrorTypeLabel(error)}</span>
            <Badge variant="outline" className={getConfidenceColor(error.confidence)}>
              {Math.round(error.confidence * 100)}% confiance
            </Badge>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-500">
              {new Date(error.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Description de l'erreur */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error.error_description}</AlertDescription>
          </Alert>

          {/* Comparaison des données */}
          {error.collection_excel && error.bank_transaction && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-red-50 p-3 rounded">
                <h4 className="font-semibold text-red-800 mb-2">📊 Données Excel</h4>
                <div className="text-sm space-y-1">
                  <div>Client: {error.collection_excel.clientCode}</div>
                  <div>Montant: {error.collection_excel.collectionAmount?.toLocaleString()} FCFA</div>
                  <div>Date: {error.collection_excel.reportDate}</div>
                  <div>Banque: {error.collection_excel.bankName}</div>
                </div>
              </div>
              <div className="bg-green-50 p-3 rounded">
                <h4 className="font-semibold text-green-800 mb-2">🏦 Données Bancaires</h4>
                <div className="text-sm space-y-1">
                  <div>Description: {error.bank_transaction.description}</div>
                  <div>Montant: {error.bank_transaction.amount?.toLocaleString()} FCFA</div>
                  <div>Date: {error.bank_transaction.date}</div>
                  <div>Banque: {error.bank_transaction.bank}</div>
                </div>
              </div>
            </div>
          )}

          {/* Correction suggérée */}
          {error.suggested_correction && (
            <div className="bg-blue-50 p-3 rounded">
              <h4 className="font-semibold text-blue-800 mb-2">💡 Correction suggérée</h4>
              <div className="text-sm">
                {Object.entries(error.suggested_correction).map(([key, value]) => (
                  <div key={key}>
                    <strong>{key}:</strong> {String(value)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raisonnement de l'IA */}
          <div className="bg-gray-50 p-3 rounded">
            <h4 className="font-semibold text-gray-800 mb-2">🤖 Raisonnement IA</h4>
            <ul className="text-sm space-y-1">
              {error.reasoning.map((reason, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="text-gray-500">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Actions de validation */}
          {error.status === 'PENDING' && (
            <div className="flex space-x-2 pt-2">
              <Button 
                onClick={() => onValidateError(error.id)}
                className="bg-green-600 hover:bg-green-700"
                size="sm"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Valider la correction
              </Button>
              <Button 
                onClick={() => setSelectedError(error)}
                variant="outline"
                size="sm"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Rejeter
              </Button>
              <Button 
                onClick={() => onModifyCorrection(error.id, error.suggested_correction)}
                variant="outline"
                size="sm"
              >
                <Eye className="h-4 w-4 mr-2" />
                Modifier
              </Button>
            </div>
          )}

          {error.status === 'VALIDATED' && (
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle className="h-3 w-3 mr-1" />
              Correction validée
            </Badge>
          )}

          {error.status === 'REJECTED' && (
            <Badge className="bg-red-100 text-red-800">
              <XCircle className="h-3 w-3 mr-1" />
              Suggestion rejetée
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center space-x-2">
          <Shield className="h-8 w-8" />
          <span>Contrôle Qualité Intelligent</span>
        </h1>
        <Badge variant="outline" className="text-lg px-3 py-1">
          Rapport du {new Date(report.analysis_date).toLocaleDateString()}
        </Badge>
      </div>

      {renderQualitySummary()}
      {renderErrorsByType()}

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending">
            En attente ({report.pending_validations.length})
          </TabsTrigger>
          <TabsTrigger value="validated">
            Validées ({report.validated_corrections.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejetées ({report.rejected_suggestions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {report.pending_validations.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <div className="text-lg font-semibold text-green-800">
                  Aucune erreur en attente !
                </div>
                <div className="text-gray-600">
                  Toutes les erreurs détectées ont été traitées.
                </div>
              </CardContent>
            </Card>
          ) : (
            report.pending_validations.map(renderErrorCard)
          )}
        </TabsContent>

        <TabsContent value="validated" className="space-y-4">
          {report.validated_corrections.map(renderErrorCard)}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-4">
          {report.rejected_suggestions.map(renderErrorCard)}
        </TabsContent>
      </Tabs>

      {/* Modal de rejet */}
      {selectedError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Rejeter la suggestion</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Raison du rejet:
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full p-2 border rounded"
                    rows={3}
                    placeholder="Expliquez pourquoi vous rejetez cette suggestion..."
                  />
                </div>
                <div className="flex space-x-2">
                  <Button 
                    onClick={() => {
                      onRejectError(selectedError.id, rejectReason);
                      setSelectedError(null);
                      setRejectReason('');
                    }}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Confirmer le rejet
                  </Button>
                  <Button 
                    onClick={() => {
                      setSelectedError(null);
                      setRejectReason('');
                    }}
                    variant="outline"
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default QualityControlDashboard;
