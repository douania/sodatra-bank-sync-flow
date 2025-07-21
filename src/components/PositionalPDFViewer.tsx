import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Eye, Grid, Table, FileText, Zap } from 'lucide-react';
import { positionalExtractionService, PositionalData, TextItem, TableData, Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES, bdkColumnDetectionService } from '@/services/bdkColumnDetectionService';
import BDKDebugPanel from './BDKDebugPanel';

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
  const [isBDKDocument, setIsBDKDocument] = useState(false);
  const [adjustedColumns, setAdjustedColumns] = useState<Column[]>([]);

  useEffect(() => {
    extractPositionalData();
  }, [file]);

  const extractPositionalData = async () => {
    setIsProcessing(true);
    try {
      const data = await positionalExtractionService.extractPositionalData(file);
      setPositionalData(data);
      
      // Détecter si c'est un document BDK
      if (data.length > 0) {
        const isBDK = bdkColumnDetectionService.isBDKDocument(data[0].items);
        setIsBDKDocument(isBDK);
      }
      
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
      table.columns.map((column, columnIndex) => {
        // Couleurs spéciales pour les colonnes BDK
        const isValidBDKColumn = isBDKDocument && columnIndex < BDK_COLUMN_TEMPLATES.length;
        const template = isValidBDKColumn ? BDK_COLUMN_TEMPLATES[columnIndex] : null;
        
        let backgroundColor = `rgba(${columnIndex * 60 % 255}, ${(columnIndex * 90) % 255}, ${(columnIndex * 120) % 255}, 0.1)`;
        let borderColor = 'rgba(0, 0, 255, 0.3)';
        
        if (isValidBDKColumn) {
          // Couleurs spécifiques pour les colonnes BDK
          const bdkColors = [
            'rgba(255, 100, 100, 0.15)', // Date - Rouge clair
            'rgba(100, 255, 100, 0.15)', // CH.NO - Vert clair
            'rgba(100, 100, 255, 0.15)', // Description - Bleu clair
            'rgba(255, 255, 100, 0.15)', // Vendor - Jaune clair
            'rgba(255, 100, 255, 0.15)', // Client - Magenta clair
            'rgba(100, 255, 255, 0.15)', // TR No - Cyan clair
            'rgba(255, 150, 100, 0.15)'  // Amount - Orange clair
          ];
          backgroundColor = bdkColors[columnIndex] || backgroundColor;
          borderColor = 'rgba(0, 128, 0, 0.5)';
        }
        
        return (
          <div
            key={`col-${tableIndex}-${columnIndex}`}
            style={{
              position: 'absolute',
              left: `${column.xStart * scale}px`,
              top: '0px',
              width: `${(column.xEnd - column.xStart) * scale}px`,
              height: `${currentPage.pageHeight * scale}px`,
              backgroundColor,
              border: `1px dashed ${borderColor}`,
              zIndex: 5
            }}
            title={template ? `${template.name} (${column.texts.length} éléments)` : `Colonne ${columnIndex}`}
          >
            {/* Label de la colonne */}
            <div 
              style={{
                position: 'absolute',
                top: '2px',
                left: '2px',
                fontSize: '10px',
                fontWeight: 'bold',
                color: borderColor,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                padding: '1px 3px',
                borderRadius: '2px'
              }}
            >
              {template ? template.name : `Col ${columnIndex}`}
            </div>
          </div>
        );
      })
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
          <h4 className="font-medium">
            Table {index + 1}
            {isBDKDocument && (
              <Badge className="ml-2 bg-green-100 text-green-800">BDK Format</Badge>
            )}
          </h4>
          <Badge variant="outline">
            {table.columns.length} cols × {table.rows.length} rows
          </Badge>
        </div>
        
        {/* Affichage spécial pour les tables BDK */}
        {isBDKDocument && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <Grid className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-800">Configuration BDK (7 colonnes)</span>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {BDK_COLUMN_TEMPLATES.map((template, i) => {
                const column = table.columns[i];
                const elementCount = column?.texts.length || 0;
                return (
                  <div key={i} className="p-1 bg-white rounded border text-center">
                    <div className="font-medium text-gray-800">{template.name}</div>
                    <div className="text-gray-500">{elementCount} items</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                {table.headers.map((header, i) => (
                  <th key={i} className="px-2 py-1 text-left border-r">
                    {isBDKDocument && i < BDK_COLUMN_TEMPLATES.length 
                      ? BDK_COLUMN_TEMPLATES[i].name 
                      : (header || `Col ${i + 1}`)
                    }
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

  const handleColumnsChanged = (newColumns: Column[]) => {
    setAdjustedColumns(newColumns);
    
    // Update the current page's table data
    if (positionalData[selectedPage]) {
      const updatedPositionalData = [...positionalData];
      if (updatedPositionalData[selectedPage].tables.length > 0) {
        updatedPositionalData[selectedPage].tables[0].columns = newColumns;
      }
      setPositionalData(updatedPositionalData);
      
      // Notify parent about the updated tables
      if (onTableDetected) {
        const allTables = updatedPositionalData.flatMap(page => page.tables);
        onTableDetected(allTables);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Grid className="h-5 w-5" />
          <span>Extraction Positionnelle PDF</span>
          {isBDKDocument && (
            <Badge className="bg-green-100 text-green-800">Document BDK Détecté</Badge>
          )}
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
            {isBDKDocument && (
              <TabsTrigger value="bdk-debug">Debug BDK</TabsTrigger>
            )}
            {isBDKDocument && (
              <TabsTrigger value="bdk-advanced">Debug Avancé</TabsTrigger>
            )}
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

          {isBDKDocument && (
            <TabsContent value="bdk-debug" className="space-y-4">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Debug Détection BDK</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-medium mb-2">Configuration Attendue</h4>
                      <div className="space-y-1 text-sm">
                        {BDK_COLUMN_TEMPLATES.map((template, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{template.name}:</span>
                            <span className="text-muted-foreground">{template.contentType}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-medium mb-2">Colonnes Détectées</h4>
                      <div className="space-y-1 text-sm">
                        {currentPage?.tables[0]?.columns.map((col, i) => (
                          <div key={i} className="flex justify-between">
                            <span>Col {i}:</span>
                            <span className="text-muted-foreground">{col.texts.length} éléments</span>
                          </div>
                        )) || <span className="text-muted-foreground">Aucune colonne détectée</span>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                
                {currentPage?.tables[0] && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Échantillon de Données par Colonne</h4>
                    <div className="grid grid-cols-7 gap-2 text-xs">
                      {currentPage.tables[0].columns.slice(0, 7).map((column, i) => (
                        <div key={i} className="space-y-1">
                          <div className="font-medium p-2 bg-gray-100 rounded text-center">
                            {BDK_COLUMN_TEMPLATES[i]?.name || `Col ${i}`}
                          </div>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {column.texts.slice(0, 5).map((item, j) => (
                              <div key={j} className="p-1 bg-gray-50 rounded text-center">
                                {item.text.substring(0, 15)}{item.text.length > 15 ? '...' : ''}
                              </div>
                            ))}
                            {column.texts.length > 5 && (
                              <div className="text-center text-gray-500">
                                +{column.texts.length - 5} autres
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {isBDKDocument && (
            <TabsContent value="bdk-advanced" className="space-y-4">
              <BDKDebugPanel
                positionalData={positionalData}
                onColumnsChanged={handleColumnsChanged}
              />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PositionalPDFViewer;
