
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Save, RotateCcw, Download, Settings, Eye } from 'lucide-react';
import { PositionalData, TextItem, Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES } from '@/services/bdkColumnDetectionService';
import ColumnAdjuster from './ColumnAdjuster';
import DataViewer from './DataViewer';
import ValidationMatrix from './ValidationMatrix';

interface BDKDebugPanelProps {
  positionalData: PositionalData[];
  onColumnsChanged?: (columns: Column[]) => void;
}

interface ColumnConfig {
  xStart: number;
  xEnd: number;
  enabled: boolean;
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

  const recalculateColumns = () => {
    if (!currentPage) return;

    const newColumns: Column[] = columnConfigs.map((config, index) => ({
      xStart: config.xStart,
      xEnd: config.xEnd,
      index,
      texts: []
    }));

    // Redistribute items to columns
    currentPage.items.forEach(item => {
      let bestColumn = 0;
      let minDistance = Infinity;

      for (let i = 0; i < newColumns.length; i++) {
        if (!columnConfigs[i].enabled) continue;
        
        const column = newColumns[i];
        const columnCenter = (column.xStart + column.xEnd) / 2;
        const distance = Math.abs(item.x - columnCenter);

        if (distance < minDistance) {
          minDistance = distance;
          bestColumn = i;
        }
      }

      newColumns[bestColumn].texts.push(item);
    });

    setAdjustedColumns(newColumns);
    onColumnsChanged?.(newColumns);
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

  const saveConfiguration = () => {
    const config = {
      pageWidth,
      columns: columnConfigs,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('bdk-column-config', JSON.stringify(config));
    alert('Configuration sauvegardée !');
  };

  const exportData = () => {
    const exportData = {
      pages: positionalData.length,
      currentPage: selectedPage,
      columns: adjustedColumns.map((col, index) => ({
        name: BDK_COLUMN_TEMPLATES[index]?.name || `Column ${index}`,
        elements: col.texts.length,
        xStart: col.xStart,
        xEnd: col.xEnd,
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
            <span>Debug BDK Avancé</span>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">
                Page {selectedPage + 1} / {positionalData.length}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800">
                {currentPage.items.length} éléments
              </Badge>
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
                Reset
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
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="adjuster">Ajustement</TabsTrigger>
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
