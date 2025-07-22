
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES } from '@/services/bdkColumnDetectionService';

interface ValidationMatrixProps {
  columns: Column[];
}

export const ValidationMatrix: React.FC<ValidationMatrixProps> = ({
  columns
}) => {
  const getValidationStats = (column: Column, index: number) => {
    const template = BDK_COLUMN_TEMPLATES[index];
    if (!template) return { valid: 0, invalid: 0, rate: 0 };
    
    // Pour la colonne AMOUNT (index 6), traiter "N/A" comme valide
    const validItems = column.texts.filter(item => {
      if (index === 6) {
        // Dans la colonne AMOUNT, "N/A" est considéré comme valide (correction automatique)
        const trimmed = item.text.trim();
        if (trimmed === 'N/A') return true;
        // Les vrais montants doivent aussi être valides
        return template.validation(item.text);
      } else {
        // Pour les autres colonnes, utiliser la validation standard
        return template.validation(item.text);
      }
    });
    
    const valid = validItems.length;
    const invalid = column.texts.length - valid;
    const rate = column.texts.length > 0 ? (valid / column.texts.length) * 100 : 0;
    
    return { valid, invalid, rate };
  };

  const getOverallValidation = () => {
    let totalItems = 0;
    let totalValid = 0;
    
    columns.slice(0, 7).forEach((column, index) => {
      const stats = getValidationStats(column, index);
      totalItems += column.texts.length;
      totalValid += stats.valid;
    });
    
    return totalItems > 0 ? (totalValid / totalItems) * 100 : 0;
  };

  const overallRate = getOverallValidation();

  return (
    <div className="space-y-6">
      {/* Overall Validation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Validation Globale (Corrigée)</span>
            <Badge 
              className={
                overallRate >= 80 ? 'bg-green-100 text-green-800' :
                overallRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }
            >
              {overallRate.toFixed(1)}%
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={overallRate} className="h-3" />
            <div className="flex items-center justify-center space-x-4 text-sm">
              {overallRate >= 80 ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-600 font-medium">Excellent</span>
                </>
              ) : overallRate >= 60 ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <span className="text-yellow-600 font-medium">Acceptable</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  <span className="text-red-600 font-medium">Nécessite des ajustements</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Column-by-Column Validation */}
      <Card>
        <CardHeader>
          <CardTitle>Validation par Colonne</CardTitle>
          <p className="text-sm text-muted-foreground">
            Analyse de la qualité avec corrections automatiques appliquées (N/A = valide pour AMOUNT)
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {columns.slice(0, 7).map((column, index) => {
              const template = BDK_COLUMN_TEMPLATES[index];
              const stats = getValidationStats(column, index);
              
              // Calculer les éléments "N/A" pour la colonne AMOUNT
              const naElements = index === 6 ? 
                column.texts.filter(item => item.text.trim() === 'N/A').length : 0;
              
              return (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Badge variant="outline">
                        Col {index + 1}
                      </Badge>
                      <span className="font-medium">
                        {template?.name || `Colonne ${index + 1}`}
                      </span>
                      <Badge className="text-xs">
                        {template?.contentType || 'unknown'}
                      </Badge>
                      {index === 6 && naElements > 0 && (
                        <Badge className="text-xs bg-purple-100 text-purple-800">
                          {naElements} N/A
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">
                        {stats.valid}/{column.texts.length}
                      </span>
                      <Badge 
                        className={
                          stats.rate >= 80 ? 'bg-green-100 text-green-800' :
                          stats.rate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }
                      >
                        {stats.rate.toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                  
                  <Progress value={stats.rate} className="h-2" />
                  
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-green-600">
                      ✓ Valides: {stats.valid}
                      {index === 6 && naElements > 0 && (
                        <span className="text-purple-600"> (dont {naElements} N/A)</span>
                      )}
                    </div>
                    <div className="text-red-600">
                      ✗ Invalides: {stats.invalid}
                    </div>
                    <div className="text-gray-600">
                      Total: {column.texts.length}
                    </div>
                  </div>
                  
                  {/* Show some sample invalid items (excluding N/A for AMOUNT) */}
                  {stats.invalid > 0 && template && (
                    <div className="mt-2 p-2 bg-red-50 rounded-lg">
                      <div className="text-xs font-medium text-red-800 mb-1">
                        Échantillon d'éléments invalides:
                      </div>
                      <div className="space-y-1">
                        {column.texts
                          .filter(item => {
                            if (index === 6) {
                              // Pour AMOUNT, exclure "N/A" des invalides affichés
                              return item.text.trim() !== 'N/A' && !template.validation(item.text);
                            } else {
                              return !template.validation(item.text);
                            }
                          })
                          .slice(0, 3)
                          .map((item, i) => (
                            <div key={i} className="text-xs text-red-700 font-mono bg-white p-1 rounded">
                              "{item.text}" (x: {item.x.toFixed(0)}, y: {item.y.toFixed(0)})
                            </div>
                          ))}
                        {stats.invalid > 3 && (
                          <div className="text-xs text-red-600">
                            +{stats.invalid - 3} autres...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommandations d'Amélioration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {columns.slice(0, 7).map((column, index) => {
              const template = BDK_COLUMN_TEMPLATES[index];
              const stats = getValidationStats(column, index);
              
              if (stats.rate >= 80) return null;
              
              return (
                <div key={index} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span className="font-medium text-yellow-800">
                      {template?.name || `Colonne ${index + 1}`}
                    </span>
                  </div>
                  <div className="text-sm text-yellow-700">
                    {index === 6 ? (
                      "Les éléments N/A sont des corrections automatiques valides. Vérifiez si de vrais montants sont mal positionnés."
                    ) : stats.rate < 50 ? (
                      "Ajustez les limites de la colonne pour inclure plus d'éléments valides."
                    ) : stats.rate < 80 ? (
                      "Affinez les limites pour exclure les éléments en bordure de colonne."
                    ) : (
                      "Validation acceptable mais peut être améliorée."
                    )}
                  </div>
                </div>
              );
            })}
            
            {overallRate >= 80 && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-800">
                    Configuration Optimale
                  </span>
                </div>
                <div className="text-sm text-green-700 mt-1">
                  La détection des colonnes est excellente. Les corrections automatiques fonctionnent parfaitement.
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ValidationMatrix;
