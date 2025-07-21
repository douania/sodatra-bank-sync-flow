
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Target, AlertCircle, CheckCircle, TrendingUp, Eye } from 'lucide-react';
import { Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES } from '@/services/bdkColumnDetectionService';

interface BDKCalibrationInsightsProps {
  columns: Column[];
  pageWidth: number;
}

export const BDKCalibrationInsights: React.FC<BDKCalibrationInsightsProps> = ({
  columns,
  pageWidth
}) => {
  // Calculer les métriques de calibration
  const getCalibrationMetrics = () => {
    const referencePage = 850;
    const scaleFactor = pageWidth / referencePage;
    
    const metrics = columns.map((column, index) => {
      const template = BDK_COLUMN_TEMPLATES[index];
      if (!template) return null;
      
      const expectedStart = template.zone.xMin * scaleFactor;
      const expectedEnd = template.zone.xMax * scaleFactor;
      
      const startDeviation = Math.abs(column.xStart - expectedStart);
      const endDeviation = Math.abs(column.xEnd - expectedEnd);
      const totalDeviation = startDeviation + endDeviation;
      
      const calibrationScore = Math.max(0, 100 - (totalDeviation / (pageWidth / 100)) * 10);
      
      const validItems = column.texts.filter(item => template.validation(item.text));
      const contentScore = column.texts.length > 0 ? (validItems.length / column.texts.length) * 100 : 100;
      
      return {
        columnName: template.name,
        calibrationScore,
        contentScore,
        itemCount: column.texts.length,
        startDeviation,
        endDeviation,
        expectedStart,
        expectedEnd,
        actualStart: column.xStart,
        actualEnd: column.xEnd
      };
    }).filter(Boolean);
    
    return metrics;
  };

  const calibrationMetrics = getCalibrationMetrics();
  const overallCalibration = calibrationMetrics.reduce((sum, metric) => sum + metric!.calibrationScore, 0) / calibrationMetrics.length;
  const overallContent = calibrationMetrics.reduce((sum, metric) => sum + metric!.contentScore, 0) / calibrationMetrics.length;

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreIcon = (score: number) => {
    if (score >= 90) return <CheckCircle className="h-3 w-3 text-green-600" />;
    if (score >= 70) return <AlertCircle className="h-3 w-3 text-yellow-600" />;
    return <AlertCircle className="h-3 w-3 text-red-600" />;
  };

  return (
    <div className="space-y-4">
      {/* Scores Globaux */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Target className="h-5 w-5" />
            <span>Analyse de Calibration</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Calibration Zones</span>
                <div className="flex items-center space-x-2">
                  {getScoreIcon(overallCalibration)}
                  <span className={`text-sm font-bold ${getScoreColor(overallCalibration)}`}>
                    {overallCalibration.toFixed(0)}%
                  </span>
                </div>
              </div>
              <Progress value={overallCalibration} className="h-2" />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Validation Contenu</span>
                <div className="flex items-center space-x-2">
                  {getScoreIcon(overallContent)}
                  <span className={`text-sm font-bold ${getScoreColor(overallContent)}`}>
                    {overallContent.toFixed(0)}%
                  </span>
                </div>
              </div>
              <Progress value={overallContent} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Détails par Colonne */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Détails de Calibration par Colonne</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {calibrationMetrics.map((metric, index) => (
              <div key={index} className="border rounded-lg p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{metric!.columnName}</span>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="text-xs">
                      {metric!.itemCount} éléments
                    </Badge>
                    <div className="flex items-center space-x-1">
                      {getScoreIcon(metric!.calibrationScore)}
                      <span className={`text-xs ${getScoreColor(metric!.calibrationScore)}`}>
                        {metric!.calibrationScore.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-600">Début:</span>
                    <span className="ml-1 font-mono">
                      {metric!.actualStart.toFixed(0)} 
                      <span className="text-gray-500">(prévu: {metric!.expectedStart.toFixed(0)})</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Fin:</span>
                    <span className="ml-1 font-mono">
                      {metric!.actualEnd.toFixed(0)}
                      <span className="text-gray-500">(prévu: {metric!.expectedEnd.toFixed(0)})</span>
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 mt-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-600 mb-1">Calibration</div>
                    <Progress value={metric!.calibrationScore} className="h-1" />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-600 mb-1">Contenu</div>
                    <Progress value={metric!.contentScore} className="h-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recommandations d'Amélioration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-sm">
            <TrendingUp className="h-4 w-4" />
            <span>Recommandations d'Amélioration</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {calibrationMetrics.map((metric, index) => {
              const issues = [];
              
              if (metric!.calibrationScore < 70) {
                issues.push(`Ajuster les limites de la colonne ${metric!.columnName}`);
              }
              
              if (metric!.contentScore < 60) {
                issues.push(`Validation du contenu faible pour ${metric!.columnName}`);
              }
              
              if (metric!.itemCount === 0) {
                issues.push(`Aucun élément détecté dans ${metric!.columnName} - Zone trop restrictive?`);
              }
              
              return issues.map((issue, issueIndex) => (
                <div key={`${index}-${issueIndex}`} className="flex items-start space-x-2 p-2 bg-yellow-50 rounded border-l-4 border-yellow-400">
                  <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <span className="text-yellow-800">{issue}</span>
                </div>
              ));
            }).flat()}
            
            {calibrationMetrics.every(m => m!.calibrationScore >= 70 && m!.contentScore >= 60) && (
              <div className="flex items-center space-x-2 p-2 bg-green-50 rounded border-l-4 border-green-400">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-green-800">Calibration optimale atteinte!</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BDKCalibrationInsights;
