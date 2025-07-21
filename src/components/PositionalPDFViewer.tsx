
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Eye, Grid, Table, FileText, Zap } from 'lucide-react';
import { positionalExtractionService, PositionalData, TextItem, TableData } from '@/services/positionalExtractionService';

interface PositionalPDFViewerProps {
  file: File;
  onTableDetected?: (tables: TableData[]) => void;
}

export const PositionalPDFViewer: React.FC<PositionalPDFViewerProps> = ({
  file,
  onTableDetected
}) => {
  const [positionalData, setPositionalData] = useState<PositionalData[]>([]);
  const [selectedPage, setSelectedPage] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [showColumns, setShowColumns] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [highlightedTable, setHighlightedTable] = useState<number | null>(null);

  useEffect(() => {
    extractPositionalData();
  }, [file]);

  const extractPositionalData = async () => {
    setIsProcessing(true);
    try {
      const data = await positionalExtractionService.extractPositionalData(file);
      setPositionalData(data);
      
      // Notify parent about detected tables
      if (onTableDetected && data.length > 0) {
        const allTables = data.flatMap(page => page.tables);
        onTableDetected(allTables);
      }
    } catch (error) {
      console.error('Erreur extraction positionnelle:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const currentPage = positionalData[selectedPage];
  const scale = 0.5; // Facteur d'échelle pour l'affichage

  const renderTextItem = (item: TextItem, index: number) => {
    const style = {
      position: 'absolute' as const,
      left: `${item.x * scale}px`,
      top: `${item.y * scale}px`,
      fontSize: `${Math.max(item.fontSize * scale, 8)}px`,
      fontFamily: 'monospace',
      whiteSpace: 'nowrap' as const,
      backgroundColor: showCoordinates ? 'rgba(255, 255, 0, 0.2)' : 'transparent',
      border: showCoordinates ? '1px solid rgba(255, 0, 0, 0.3)' : 'none',
      padding: '1px',
      zIndex: 10
    };

    return (
      <div
        key={index}
        style={style}
        className="select-text cursor-text"
        title={showCoordinates ? `x:${item.x.toFixed(1)}, y:${item.y.toFixed(1)}` : undefined}
      >
        {item.text}
      </div>
    );
  };

  const renderColumns = () => {
    if (!currentPage || !showColumns) return null;

    return currentPage.tables.flatMap((table, tableIndex) =>
      table.columns.map((column, columnIndex) => (
        <div
          key={`col-${tableIndex}-${columnIndex}`}
          style={{
            position: 'absolute',
            left: `${column.xStart * scale}px`,
            top: '0px',
            width: `${(column.xEnd - column.xStart) * scale}px`,
            height: `${currentPage.pageHeight * scale}px`,
            backgroundColor: `rgba(${columnIndex * 60 % 255}, ${(columnIndex * 90) % 255}, ${(columnIndex * 120) % 255}, 0.1)`,
            border: '1px dashed rgba(0, 0, 255, 0.3)',
            zIndex: 5
          }}
        />
      ))
    );
  };

  const renderGrid = () => {
    if (!currentPage || !showGrid) return null;

    const gridSize = 50;
    const lines = [];

    // Lignes verticales
    for (let x = 0; x < currentPage.pageWidth * scale; x += gridSize) {
      lines.push(
        <div
          key={`v-${x}`}
          style={{
            position: 'absolute',
            left: `${x}px`,
            top: '0px',
            width: '1px',
            height: `${currentPage.pageHeight * scale}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            zIndex: 1
          }}
        />
      );
    }

    // Lignes horizontales
    for (let y = 0; y < currentPage.pageHeight * scale; y += gridSize) {
      lines.push(
        <div
          key={`h-${y}`}
          style={{
            position: 'absolute',
            left: '0px',
            top: `${y}px`,
            width: `${currentPage.pageWidth * scale}px`,
            height: '1px',
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            zIndex: 1
          }}
        />
      );
    }

    return lines;
  };

  const renderTableData = (table: TableData, index: number) => {
    return (
      <div key={index} className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Table {index + 1}</h4>
          <Badge variant="outline">
            {table.columns.length} cols × {table.rows.length} rows
          </Badge>
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                {table.headers.map((header, i) => (
                  <th key={i} className="px-2 py-1 text-left border-r">
                    {header || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.data.slice(0, 10).map((row, i) => (
                <tr key={i} className="border-t">
                  {row.map((cell, j) => (
                    <td key={j} className="px-2 py-1 border-r">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.data.length > 10 && (
            <div className="p-2 bg-muted text-xs text-center">
              +{table.data.length - 10} autres lignes
            </div>
          )}
        </div>
      </div>
    );
  };

  if (isProcessing) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex items-center space-x-2">
            <Zap className="h-5 w-5 animate-spin" />
            <span>Extraction positionnelle en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!currentPage) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Aucune donnée positionnelle disponible</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Grid className="h-5 w-5" />
          <span>Extraction Positionnelle PDF</span>
        </CardTitle>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="show-grid">Grille</Label>
            <Switch
              id="show-grid"
              checked={showGrid}
              onCheckedChange={setShowGrid}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="show-columns">Colonnes</Label>
            <Switch
              id="show-columns"
              checked={showColumns}
              onCheckedChange={setShowColumns}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="show-coordinates">Coordonnées</Label>
            <Switch
              id="show-coordinates"
              checked={showCoordinates}
              onCheckedChange={setShowCoordinates}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="visual" className="space-y-4">
          <TabsList>
            <TabsTrigger value="visual">Vue Visuelle</TabsTrigger>
            <TabsTrigger value="tables">Tables Détectées</TabsTrigger>
            <TabsTrigger value="stats">Statistiques</TabsTrigger>
          </TabsList>
          
          <TabsContent value="visual" className="space-y-4">
            {positionalData.length > 1 && (
              <div className="flex items-center space-x-2">
                <Label>Page:</Label>
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
            )}
            
            <div className="border rounded-lg bg-white overflow-auto max-h-96">
              <div
                className="relative"
                style={{
                  width: `${currentPage.pageWidth * scale}px`,
                  height: `${currentPage.pageHeight * scale}px`,
                  backgroundColor: '#fff'
                }}
              >
                {renderGrid()}
                {renderColumns()}
                {currentPage.items.map((item, index) => renderTextItem(item, index))}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="tables" className="space-y-4">
            {currentPage.tables.length > 0 ? (
              <div className="space-y-4">
                {currentPage.tables.map((table, index) => renderTableData(table, index))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Table className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Aucune table détectée sur cette page</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="stats" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {currentPage.items.length}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Éléments de texte
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {currentPage.tables.length}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Tables détectées
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {currentPage.tables.reduce((acc, table) => acc + table.columns.length, 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Colonnes totales
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <h4 className="font-medium">Dimensions de la page</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Largeur:</span>
                  <span className="ml-2 font-mono">{currentPage.pageWidth.toFixed(1)}px</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Hauteur:</span>
                  <span className="ml-2 font-mono">{currentPage.pageHeight.toFixed(1)}px</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PositionalPDFViewer;
