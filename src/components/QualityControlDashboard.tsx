
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Shield,
  AlertTriangle,
  XCircle,
  Eye,
  TrendingUp,
  BarChart3,
  Brain,
  Clock,
  Info,
} from 'lucide-react';
import { QualityReport, QualityError } from '@/types/qualityControl';

// PACK 0 — tableau de bord consultatif : aucune action de validation, de rejet
// ou de modification. Les anomalies sont présentées « à examiner » ; le
// rapport n'atteste jamais une conformité.

interface QualityControlDashboardProps {
  report: QualityReport | null;
  onReset?: () => void;
}

const QualityControlDashboard: React.FC<QualityControlDashboardProps> = ({ report, onReset }) => {
  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-6 w-6" />
            <span>Contrôle Qualité (consultatif)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-gray-500">
            Aucun rapport disponible. Lancez une analyse consultative pour commencer.
          </div>
        </CardContent>
      </Card>
    );
  }

  const evaluable = report.evaluation.status === 'EVALUABLE';

  const renderEvaluationBanner = () => (
    evaluable ? (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Analyse consultative</AlertTitle>
        <AlertDescription>
          {report.evaluation.reason} Lignes Excel : {report.evaluation.excel_rows} ; rapports bancaires lus :{' '}
          {report.evaluation.bank_reports} ; crédits explicites retenus comme preuve : {report.evaluation.credit_evidence}.
          Aucune correction n'est appliquée ni enregistrée depuis cet écran.
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Contrôle non évaluable</AlertTitle>
        <AlertDescription>
          {report.evaluation.reason} Lignes Excel : {report.evaluation.excel_rows} ; rapports bancaires lus :{' '}
          {report.evaluation.bank_reports} ; crédits explicites disponibles : {report.evaluation.credit_evidence}.
          Aucune anomalie n'est comptée et aucune conformité n'est attestée.
        </AlertDescription>
      </Alert>
    )
  );

  const renderQualitySummary = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <div>
              <div className="text-2xl font-bold">{report.summary.total_collections_analyzed}</div>
              <div className="text-sm text-gray-600">Lignes Excel lues</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <div>
              <div className="text-2xl font-bold text-red-600">{evaluable ? report.summary.errors_detected : '—'}</div>
              <div className="text-sm text-gray-600">Anomalies potentielles</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-yellow-600" />
            <div>
              <div className="text-2xl font-bold text-yellow-600">{evaluable ? `${report.summary.error_rate}%` : '—'}</div>
              <div className="text-sm text-gray-600">Taux d'anomalies potentielles</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <Brain className="h-4 w-4 text-green-600" />
            <div>
              <div className="text-2xl font-bold text-green-600">
                {report.summary.confidence_score === null ? '—' : `${report.summary.confidence_score}%`}
              </div>
              <div className="text-sm text-gray-600">Confiance moyenne des anomalies</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderErrorsByType = () => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Répartition des anomalies potentielles</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-2">
            <Badge variant="destructive" className="w-3 h-3 p-0 rounded-full"></Badge>
            <span className="text-sm">Saisie : {report.errors_by_type.saisie_errors}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className="w-3 h-3 p-0 rounded-full bg-orange-500"></Badge>
            <span className="text-sm">Omissions : {report.errors_by_type.omissions}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="w-3 h-3 p-0 rounded-full bg-yellow-500"></Badge>
            <span className="text-sm">Incohérences : {report.errors_by_type.incohérences}</span>
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
      'SAISIE_ERROR': 'Anomalie de saisie',
      'OMISSION_ERROR': 'Omission possible',
      'INCOHÉRENCE_ERROR': 'Incohérence possible'
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
            <Badge variant="secondary">À examiner</Badge>
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
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error.error_description}</AlertDescription>
          </Alert>

          {error.collection_excel && error.bank_transaction && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-red-50 p-3 rounded">
                <h4 className="font-semibold text-red-800 mb-2">Données Excel</h4>
                <div className="text-sm space-y-1">
                  <div>Client: {error.collection_excel.clientCode}</div>
                  <div>Montant: {error.collection_excel.collectionAmount?.toLocaleString()} FCFA</div>
                  <div>Date: {error.collection_excel.reportDate}</div>
                  <div>Banque: {error.collection_excel.bankName}</div>
                </div>
              </div>
              <div className="bg-green-50 p-3 rounded">
                <h4 className="font-semibold text-green-800 mb-2">Crédit bancaire rapproché</h4>
                <div className="text-sm space-y-1">
                  <div>Description: {error.bank_transaction.description}</div>
                  <div>Montant: {error.bank_transaction.amount?.toLocaleString()} FCFA</div>
                  <div>Date: {error.bank_transaction.date}</div>
                  <div>Banque: {error.bank_transaction.bank}</div>
                </div>
              </div>
            </div>
          )}

          {error.suggested_correction && (
            <div className="bg-blue-50 p-3 rounded">
              <h4 className="font-semibold text-blue-800 mb-2">Piste de correction (non appliquée)</h4>
              <div className="text-sm">
                {Object.entries(error.suggested_correction).map(([key, value]) => (
                  <div key={key}>
                    <strong>{key}:</strong> {String(value)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-50 p-3 rounded">
            <h4 className="font-semibold text-gray-800 mb-2">Raisonnement</h4>
            <ul className="text-sm space-y-1">
              {error.reasoning.map((reason, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="text-gray-500">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center space-x-2">
          <Shield className="h-8 w-8" />
          <span>Contrôle Qualité (consultatif)</span>
        </h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-lg px-3 py-1">
            Rapport du {new Date(report.analysis_date).toLocaleDateString()}
          </Badge>
          {onReset && (
            <Button variant="outline" size="sm" onClick={onReset}>
              Nouvelle analyse
            </Button>
          )}
        </div>
      </div>

      {renderEvaluationBanner()}
      {renderQualitySummary()}
      {evaluable && renderErrorsByType()}

      {evaluable && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Anomalies potentielles à examiner ({report.errors.length})</h2>
          {report.errors.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Info className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <div className="text-lg font-semibold text-gray-800">
                  Aucune anomalie potentielle détectée sur les preuves disponibles.
                </div>
                <div className="text-gray-600">
                  Ce résultat n'est pas une attestation de conformité : il ne porte que sur les crédits bancaires
                  explicites lus lors de cette analyse.
                </div>
              </CardContent>
            </Card>
          ) : (
            report.errors.map(renderErrorCard)
          )}
        </div>
      )}
    </div>
  );
};

export default QualityControlDashboard;
