import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Save, RotateCcw, Download, Target, AlertTriangle, CheckCircle, Eye } from 'lucide-react';
import { PositionalData, Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES, bdkColumnDetectionService } from '@/services/bdkColumnDetectionService';
import ColumnAdjuster from './ColumnAdjuster';
import DataViewer from './DataViewer';
import ValidationMatrix from './ValidationMatrix';
import BDKCalibrationInsights from './BDKCalibrationInsights';

interface BDKDebugPanelProps {
  positionalData: PositionalData[];
  onColumnsChanged?: (columns: Column[]) => void;
}

interface ColumnConfig {
  xStart: number;
  xEnd: number;
  enabled: boolean;
}

interface DetectionQuality {
  overallScore: number;
  columnScores: number[];
  recommendations: string[];
}

interface AmountAnalysis {
  totalElements: number;
  validAmounts: number;
  emptyOrZero: number;
  missingPositions: number;
  qualityScore: number;
  syntheticElements: number;
  realAmounts: number;
}

export const BDKDebugPanel: React.FC<BDKDebugPanelProps> = ({
  positionalData,
  onColumnsChanged
}) => {
  const [selectedPage, setSelectedPage] = useState(0);
  const [columnConfigs, setColumnConfigs] = useState<ColumnConfig[]>([]);
  const [adjustedColumns, setAdjustedColumns] = useState<Column[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoRecalculate, setAutoRecalculate] = useState(true);
  const [detectionQuality, setDetectionQuality] = useState<DetectionQuality | null>(null);
  const [amountAnalysis, setAmountAnalysis] = useState<AmountAnalysis | null>(null);

  const currentPage = positionalData[selectedPage];
  const pageWidth = currentPage?.pageWidth || 800;

  // Initialize column configurations
  useEffect(() => {
    if (currentPage && currentPage.tables.length > 0) {
      const initialConfigs = currentPage.tables[0].columns.slice(0, 7).map(col => ({
        xStart: col.xStart,
        xEnd: col.xEnd,
        enabled: true
      }));
      
      // Fill missing columns
      while (initialConfigs.length < 7) {
        const index = initialConfigs.length;
        const columnWidth = pageWidth / 7;
        initialConfigs.push({
          xStart: index * columnWidth,
          xEnd: (index + 1) * columnWidth,
          enabled: true
        });
      }
      
      setColumnConfigs(initialConfigs);
    }
  }, [currentPage, pageWidth]);

  // Recalculate columns when config changes
  useEffect(() => {
    if (autoRecalculate && currentPage && columnConfigs.length === 7) {
      recalculateColumns();
    }
  }, [columnConfigs, autoRecalculate, currentPage]);

  // Analyze AMOUNT column specifically
  const analyzeAmountColumn = (columns: Column[]) => {
    const amountColumn = columns[6];
    if (!amountColumn) return null;

    const totalElements = amountColumn.texts.length;
    
    // Séparer les éléments synthétiques (N/A) des vrais montants
    const syntheticElements = amountColumn.texts.filter(item => 
      item.text.trim() === 'N/A'
    ).length;
    
    // Vrais montants : éléments numériques non-zéro et non "N/A"
    const realAmounts = amountColumn.texts.filter(item => {
      const trimmed = item.text.trim();
      if (trimmed === 'N/A' || trimmed === '') return false;
      const num = parseInt(trimmed.replace(/\s/g, ''));
      return !isNaN(num) && num > 0;
    }).length;
    
    // Éléments vides ou zéro (hors N/A)
    const emptyOrZero = amountColumn.texts.filter(item => {
      const trimmed = item.text.trim();
      return trimmed === '' || trimmed === '0';
    }).length;

    // Estimer les positions manquantes en comparant avec d'autres colonnes
    const otherColumnsMaxItems = Math.max(...columns.slice(0, 6).map(col => col.texts.length));
    const missingPositions = Math.max(0, otherColumnsMaxItems - totalElements);

    // Score de qualité basé sur les vrais montants par rapport aux éléments attendus
    const expectedRealAmounts = totalElements - syntheticElements;
    const qualityScore = expectedRealAmounts > 0 ? (realAmounts / expectedRealAmounts) * 100 : 
                        syntheticElements > 0 ? 100 : 0; // 100% si tout est N/A (correct)

    return {
      totalElements,
      validAmounts: realAmounts, // Seuls les vrais montants
      emptyOrZero,
      missingPositions,
      qualityScore,
      syntheticElements,
      realAmounts
    };
  };

  const recalculateColumns = () => {
    if (!currentPage) return;

    const newColumns: Column[] = columnConfigs.map((config, index) => ({
      xStart: config.xStart,
      xEnd: config.xEnd,
      index,
      texts: []
    }));

    // Use the enhanced BDK detection service
    const enhancedColumns = bdkColumnDetectionService.detectBDKColumns(currentPage.items, pageWidth);
    
    // Update with enhanced results
    setAdjustedColumns(enhancedColumns);
    
    // Analyze detection quality
    const quality = bdkColumnDetectionService.analyzeDetectionQuality(enhancedColumns);
    setDetectionQuality(quality);
    
    // Analyze AMOUNT column specifically
    const amountAnalysis = analyzeAmountColumn(enhancedColumns);
    setAmountAnalysis(amountAnalysis);
    
    onColumnsChanged?.(enhancedColumns);
  };

  const handleColumnConfigChange = (index: number, field: 'xStart' | 'xEnd', value: number) => {
    const newConfigs = [...columnConfigs];
    newConfigs[index] = { ...newConfigs[index], [field]: value };
    setColumnConfigs(newConfigs);
  };

  const resetToDefault = () => {
    if (currentPage && currentPage.tables.length > 0) {
      const defaultConfigs = currentPage.tables[0].columns.slice(0, 7).map(col => ({
        xStart: col.xStart,
        xEnd: col.xEnd,
        enabled: true
      }));
      setColumnConfigs(defaultConfigs);
    }
  };

  const resetToCalibratedZones = () => {
    // Reset to the enhanced calibrated zones from the service
    const referencePage = 850;
    const scaleFactor = pageWidth / referencePage;
    
    const calibratedConfigs = BDK_COLUMN_TEMPLATES.map(template => ({
      xStart: template.zone.xMin * scaleFactor,
      xEnd: template.zone.xMax * scaleFactor,
      enabled: true
    }));
    
    setColumnConfigs(calibratedConfigs);
  };

  const saveConfiguration = () => {
    const config = {
      pageWidth,
      columns: columnConfigs,
      detectionQuality,
      amountAnalysis,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('bdk-column-config', JSON.stringify(config));
    alert('Configuration sauvegardée !');
  };

  const exportData = () => {
    const exportData = {
      pages: positionalData.length,
      currentPage: selectedPage,
      detectionQuality,
      amountAnalysis,
      columns: adjustedColumns.map((col, index) => ({
        name: BDK_COLUMN_TEMPLATES[index]?.name || `Column ${index}`,
        elements: col.texts.length,
        xStart: col.xStart,
        xEnd: col.xEnd,
        validationScore: detectionQuality?.columnScores[index] || 0,
        data: col.texts.map(item => ({
          text: item.text,
          x: item.x,
          y: item.y,
          fontSize: item.fontSize
        }))
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bdk-debug-page-${selectedPage + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getQualityColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQualityIcon = (score: number) => {
    if (score >= 90) return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (score >= 70) return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <AlertTriangle className="h-4 w-4 text-red-600" />;
  };

  if (!currentPage) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground">Aucune donnée disponible</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Debug BDK Renforcé (Montants Fixes)</span>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">
                Page {selectedPage + 1} / {positionalData.length}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800">
                {currentPage.items.length} éléments
              </Badge>
              {detectionQuality && (
                <div className="flex items-center space-x-1">
                  {getQualityIcon(detectionQuality.overallScore)}
                  <Badge className={`${getQualityColor(detectionQuality.overallScore)} bg-gray-100`}>
                    {detectionQuality.overallScore.toFixed(0)}% qualité
                  </Badge>
                </div>
              )}
            </div>
          </CardTitle>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label htmlFor="auto-recalc">Recalcul auto</Label>
                <Switch
                  id="auto-recalc"
                  checked={autoRecalculate}
                  onCheckedChange={setAutoRecalculate}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Label htmlFor="show-advanced">Mode Expert</Label>
                <Switch
                  id="show-advanced"
                  checked={showAdvanced}
                  onCheckedChange={setShowAdvanced}
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={resetToDefault}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset Détecté
              </Button>
              <Button variant="outline" size="sm" onClick={resetToCalibratedZones}>
                <Target className="h-4 w-4 mr-1" />
                Zones Renforcées
              </Button>
              <Button variant="outline" size="sm" onClick={saveConfiguration}>
                <Save className="h-4 w-4 mr-1" />
                Sauver
              </Button>
              <Button variant="outline" size="sm" onClick={exportData}>
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
              {!autoRecalculate && (
                <Button size="sm" onClick={recalculateColumns}>
                  Recalculer
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* AMOUNT Column Analysis Panel */}
      {amountAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Target className="h-5 w-5" />
              <span>Analyse Colonne AMOUNT (Corrigée)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{amountAnalysis.totalElements}</div>
                <div className="text-sm text-muted-foreground">Éléments Total</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{amountAnalysis.realAmounts}</div>
                <div className="text-sm text-muted-foreground">Vrais Montants</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{amountAnalysis.syntheticElements}</div>
                <div className="text-sm text-muted-foreground">Éléments N/A</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{amountAnalysis.emptyOrZero}</div>
                <div className="text-sm text-muted-foreground">Zéros/Vides</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${amountAnalysis.missingPositions > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {amountAnalysis.missingPositions}
                </div>
                <div className="text-sm text-muted-foreground">Positions Manquantes</div>
              </div>
            </div>
            
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Qualité Colonne AMOUNT</span>
                <span className={`text-sm font-bold ${getQualityColor(amountAnalysis.qualityScore)}`}>
                  {amountAnalysis.qualityScore.toFixed(0)}%
                </span>
              </div>
              <Progress value={amountAnalysis.qualityScore} className="h-2" />
            </div>
            
            {/* Affichage informatif des corrections appliquées */}
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">
                  Corrections Appliquées Automatiquement
                </span>
              </div>
              <div className="text-xs text-green-600 mt-1">
                • {amountAnalysis.syntheticElements} cellules vides remplies avec "N/A"
                • Les numéros de facture restent dans leurs colonnes d'origine
                • Seuls les vrais montants sont comptabilisés
              </div>
            </div>
            
            {amountAnalysis.qualityScore < 70 && amountAnalysis.realAmounts > 0 && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-medium text-yellow-800">
                    Qualité AMOUNT peut être améliorée - Vérifiez le calibrage
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detection Quality Panel */}
      {detectionQuality && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Target className="h-5 w-5" />
              <span>Qualité de Détection Globale</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Score Global</span>
                <div className="flex items-center space-x-2">
                  <Progress value={detectionQuality.overallScore} className="w-32" />
                  <span className={`text-sm font-bold ${getQualityColor(detectionQuality.overallScore)}`}>
                    {detectionQuality.overallScore.toFixed(0)}%
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-7 gap-2">
                {detectionQuality.columnScores.map((score, index) => (
                  <div key={index} className="text-center">
                    <div className="text-xs font-medium mb-1">
                      {BDK_COLUMN_TEMPLATES[index]?.name.slice(0, 8)}...
                    </div>
                    <div className="flex items-center justify-center space-x-1">
                      {getQualityIcon(score)}
                      <span className={`text-xs ${getQualityColor(score)}`}>
                        {score.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              
              {detectionQuality.recommendations.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-yellow-800 mb-2">Recommandations</h4>
                  <ul className="text-xs text-yellow-700 space-y-1">
                    {detectionQuality.recommendations.map((rec, index) => (
                      <li key={index}>• {rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Page Navigation */}
      {positionalData.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <Label>Navigation Pages:</Label>
              <div className="flex items-center space-x-2">
                {positionalData.map((_, index) => (
                  <Button
                    key={index}
                    variant={selectedPage === index ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedPage(index)}
                  >
                    {index + 1}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Debug Interface */}
      <Tabs defaultValue="adjuster" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="adjuster">Ajustement</TabsTrigger>
          <TabsTrigger value="calibration">Calibration</TabsTrigger>
          <TabsTrigger value="data">Données</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="overview">Vue Globale</TabsTrigger>
        </TabsList>
        
        <TabsContent value="adjuster">
          <ColumnAdjuster
            columnConfigs={columnConfigs}
            pageWidth={pageWidth}
            showAdvanced={showAdvanced}
            onConfigChange={handleColumnConfigChange}
          />
        </TabsContent>
        
        <TabsContent value="calibration">
          <BDKCalibrationInsights
            columns={adjustedColumns.length > 0 ? adjustedColumns : currentPage.tables[0]?.columns || []}
            pageWidth={pageWidth}
          />
        </TabsContent>
        
        <TabsContent value="data">
          <DataViewer
            columns={adjustedColumns.length > 0 ? adjustedColumns : currentPage.tables[0]?.columns || []}
            showAdvanced={showAdvanced}
          />
        </TabsContent>
        
        <TabsContent value="validation">
          <ValidationMatrix
            columns={adjustedColumns.length > 0 ? adjustedColumns : currentPage.tables[0]?.columns || []}
          />
        </TabsContent>
        
        <TabsContent value="overview">
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Vue d'Ensemble Multi-Pages</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {positionalData.map((page, index) => (
                <Card key={index} className={selectedPage === index ? 'border-blue-500' : ''}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Page {index + 1}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs space-y-1">
                      <div>Éléments: {page.items.length}</div>
                      <div>Tables: {page.tables.length}</div>
                      <div>Colonnes: {page.tables[0]?.columns.length || 0}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={() => setSelectedPage(index)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Voir
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BDKDebugPanel;
