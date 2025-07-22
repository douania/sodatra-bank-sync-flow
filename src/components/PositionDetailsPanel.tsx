
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, AlignLeft, AlignRight, AlignCenter, CheckCircle } from 'lucide-react';
import { TextItem, Column } from '@/services/positionalExtractionService';

interface PositionDetailsPanelProps {
  items: TextItem[];
  columns: Column[];
  isBDKDocument?: boolean;
}

const PositionDetailsPanel: React.FC<PositionDetailsPanelProps> = ({
  items,
  columns,
  isBDKDocument = false
}) => {
  // Déterminer le type d'alignement basé sur la distribution des positions X
  const getAlignmentType = (column: Column): 'left' | 'right' | 'center' => {
    if (column.texts.length === 0) return 'left';
    
    const positions = column.texts.map(t => t.x);
    const minX = Math.min(...positions);
    const maxX = Math.max(...positions);
    const range = maxX - minX;
    
    // Si les positions sont très proches du début de la colonne -> alignement à gauche
    if (range < 10 && minX <= column.xStart + 10) return 'left';
    
    // Si les positions sont très proches de la fin de la colonne -> alignement à droite
    if (range < 10 && maxX >= column.xEnd - 10) return 'right';
    
    // Si la variance est importante -> alignement à droite (montants qui varient selon la longueur)
    if (range > 20) return 'right';
    
    return 'center';
  };

  const getAlignmentIcon = (alignment: 'left' | 'right' | 'center') => {
    switch (alignment) {
      case 'left': return <AlignLeft className="h-4 w-4 text-blue-600" />;
      case 'right': return <AlignRight className="h-4 w-4 text-orange-600" />;
      case 'center': return <AlignCenter className="h-4 w-4 text-green-600" />;
    }
  };

  const getAlignmentColor = (alignment: 'left' | 'right' | 'center') => {
    switch (alignment) {
      case 'left': return 'bg-blue-100 text-blue-800';
      case 'right': return 'bg-orange-100 text-orange-800';
      case 'center': return 'bg-green-100 text-green-800';
    }
  };

  const isElementInCorrectZone = (item: TextItem, column: Column): boolean => {
    return item.x >= column.xStart && item.x <= column.xEnd;
  };

  const getDistanceToRightEdge = (item: TextItem, column: Column): number => {
    return column.xEnd - item.x;
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Section d'explication */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Info className="h-5 w-5 text-blue-600" />
              <span>Comprendre les Positions et Alignements</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center space-x-2">
                <AlignLeft className="h-4 w-4 text-blue-600" />
                <div>
                  <div className="font-medium">Alignement à Gauche</div>
                  <div className="text-gray-600">Position X constante au début</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <AlignRight className="h-4 w-4 text-orange-600" />
                <div>
                  <div className="font-medium">Alignement à Droite</div>
                  <div className="text-gray-600">Position X varie selon la longueur</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <AlignCenter className="h-4 w-4 text-green-600" />
                <div>
                  <div className="font-medium">Centré</div>
                  <div className="text-gray-600">Position X au milieu de la zone</div>
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="text-sm text-yellow-800">
                <strong>Note importante :</strong> Dans les colonnes de montants (alignement à droite), 
                la position X varie car les nombres sont alignés sur leur bord droit. 
                Un montant de "1,000" commencera plus à droite qu'un montant de "10,000,000".
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Détails par colonne */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {columns.map((column, index) => {
            const alignment = getAlignmentType(column);
            const columnName = isBDKDocument && index < 7 ? 
              ['Date', 'CH.NO', 'Description', 'Vendor Provider', 'Client', 'TR No/FACT.No', 'Amount'][index] :
              `Colonne ${index + 1}`;

            return (
              <Card key={index}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>{columnName}</span>
                    <div className="flex items-center space-x-2">
                      <Badge className={getAlignmentColor(alignment)}>
                        {getAlignmentIcon(alignment)}
                        <span className="ml-1 capitalize">{alignment}</span>
                      </Badge>
                      <Badge variant="outline">
                        {column.texts.length} éléments
                      </Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs text-gray-600">
                    Zone: {column.xStart.toFixed(1)} → {column.xEnd.toFixed(1)} 
                    (largeur: {(column.xEnd - column.xStart).toFixed(1)}px)
                  </div>
                  
                  {column.texts.length > 0 && (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {column.texts.slice(0, 8).map((item, itemIndex) => {
                        const inCorrectZone = isElementInCorrectZone(item, column);
                        const distanceToRight = getDistanceToRightEdge(item, column);
                        
                        return (
                          <Tooltip key={itemIndex}>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-between text-xs p-1 rounded hover:bg-gray-50">
                                <div className="flex items-center space-x-2">
                                  {inCorrectZone ? (
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                  ) : (
                                    <div className="h-3 w-3 rounded-full bg-red-400" />
                                  )}
                                  <span className="truncate max-w-20">
                                    {item.text.substring(0, 12)}{item.text.length > 12 ? '...' : ''}
                                  </span>
                                </div>
                                <div className="text-gray-500">
                                  X:{item.x.toFixed(0)}
                                  {alignment === 'right' && (
                                    <span className="ml-1 text-orange-600">
                                      (→{distanceToRight.toFixed(0)})
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-1">
                                <div><strong>Texte:</strong> {item.text}</div>
                                <div><strong>Position:</strong> X:{item.x.toFixed(1)}, Y:{item.y.toFixed(1)}</div>
                                <div><strong>Zone colonne:</strong> {column.xStart.toFixed(1)} - {column.xEnd.toFixed(1)}</div>
                                {alignment === 'right' && (
                                  <div><strong>Distance bord droit:</strong> {distanceToRight.toFixed(1)}px</div>
                                )}
                                <div><strong>Alignement:</strong> {alignment}</div>
                                {alignment === 'right' && (
                                  <div className="text-sm text-orange-600">
                                    Position X varie car aligné à droite
                                  </div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      {column.texts.length > 8 && (
                        <div className="text-center text-xs text-gray-500">
                          +{column.texts.length - 8} autres éléments
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default PositionDetailsPanel;
