
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Column } from '@/services/positionalExtractionService';
import { BDK_COLUMN_TEMPLATES } from '@/services/bdkColumnDetectionService';

interface DataViewerProps {
  columns: Column[];
  showAdvanced: boolean;
}

export const DataViewer: React.FC<DataViewerProps> = ({
  columns,
  showAdvanced
}) => {
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 20;

  const currentColumn = columns[selectedColumn];
  const totalItems = currentColumn?.texts.length || 0;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = currentPage * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const currentItems = currentColumn?.texts.slice(startIndex, endIndex) || [];

  const exportColumnData = (columnIndex: number) => {
    const column = columns[columnIndex];
    const template = BDK_COLUMN_TEMPLATES[columnIndex];
    
    const exportData = {
      columnName: template?.name || `Column ${columnIndex}`,
      totalItems: column?.texts.length || 0,
      data: column?.texts.map(item => ({
        text: item.text,
        x: item.x,
        y: item.y,
        fontSize: item.fontSize
      })) || []
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `column-${columnIndex + 1}-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Column Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Visualisation des Données par Colonne</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {columns.slice(0, 7).map((column, index) => {
              const template = BDK_COLUMN_TEMPLATES[index];
              const isSelected = selectedColumn === index;
              
              return (
                <Button
                  key={index}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto p-3"
                  onClick={() => {
                    setSelectedColumn(index);
                    setCurrentPage(0);
                  }}
                >
                  <div className="font-medium text-xs">
                    {template?.name || `Col ${index + 1}`}
                  </div>
                  <Badge variant="secondary" className="mt-1 text-xs">
                    {column.texts.length}
                  </Badge>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Data Display */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              {BDK_COLUMN_TEMPLATES[selectedColumn]?.name || `Colonne ${selectedColumn + 1}`}
            </span>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">
                {totalItems} éléments
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportColumnData(selectedColumn)}
              >
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </div>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Affichage {startIndex + 1} - {endIndex} sur {totalItems} éléments
          </p>
        </CardHeader>
        <CardContent>
          {currentItems.length > 0 ? (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Texte</TableHead>
                    <TableHead>Position X</TableHead>
                    <TableHead>Position Y</TableHead>
                    {showAdvanced && (
                      <>
                        <TableHead>Taille Police</TableHead>
                        <TableHead>Validation</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentItems.map((item, index) => {
                    const template = BDK_COLUMN_TEMPLATES[selectedColumn];
                    const isValid = template?.validation(item.text) || false;
                    
                    return (
                      <TableRow key={startIndex + index}>
                        <TableCell className="font-mono text-sm max-w-xs">
                          <div className="truncate" title={item.text}>
                            {item.text}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.x.toFixed(1)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.y.toFixed(1)}
                        </TableCell>
                        {showAdvanced && (
                          <>
                            <TableCell className="font-mono text-xs">
                              {item.fontSize.toFixed(1)}px
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={isValid ? "default" : "destructive"}
                                className="text-xs"
                              >
                                {isValid ? "✓" : "✗"}
                              </Badge>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setCurrentPage(currentPage - 1)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Précédent
                  </Button>
                  
                  <div className="flex items-center space-x-2">
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      const pageIndex = Math.max(0, currentPage - 2) + i;
                      if (pageIndex >= totalPages) return null;
                      
                      return (
                        <Button
                          key={pageIndex}
                          variant={currentPage === pageIndex ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(pageIndex)}
                        >
                          {pageIndex + 1}
                        </Button>
                      );
                    })}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages - 1}
                    onClick={() => setCurrentPage(currentPage + 1)}
                  >
                    Suivant
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Aucune donnée dans cette colonne
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DataViewer;
