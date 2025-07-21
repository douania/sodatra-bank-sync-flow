
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { BDK_COLUMN_TEMPLATES } from '@/services/bdkColumnDetectionService';

interface ColumnConfig {
  xStart: number;
  xEnd: number;
  enabled: boolean;
}

interface ColumnAdjusterProps {
  columnConfigs: ColumnConfig[];
  pageWidth: number;
  showAdvanced: boolean;
  onConfigChange: (index: number, field: 'xStart' | 'xEnd', value: number) => void;
}

export const ColumnAdjuster: React.FC<ColumnAdjusterProps> = ({
  columnConfigs,
  pageWidth,
  showAdvanced,
  onConfigChange
}) => {
  const handleSliderChange = (index: number, field: 'xStart' | 'xEnd', values: number[]) => {
    onConfigChange(index, field, values[0]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ajustement Manuel des Colonnes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Utilisez les curseurs pour ajuster les limites de chaque colonne. Les changements sont appliqués en temps réel.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {columnConfigs.map((config, index) => {
              const template = BDK_COLUMN_TEMPLATES[index];
              const width = config.xEnd - config.xStart;
              
              return (
                <div key={index} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">
                        Col {index + 1}
                      </Badge>
                      <span className="font-medium">
                        {template?.name || `Colonne ${index + 1}`}
                      </span>
                      {template && (
                        <Badge className="text-xs">
                          {template.contentType}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Largeur: {Math.round(width)}px
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Start Position */}
                    <div className="space-y-2">
                      <Label className="text-sm">
                        Début: {Math.round(config.xStart)}px
                      </Label>
                      <Slider
                        value={[config.xStart]}
                        onValueChange={(values) => handleSliderChange(index, 'xStart', values)}
                        max={pageWidth}
                        min={0}
                        step={1}
                        className="w-full"
                      />
                    </div>
                    
                    {/* End Position */}
                    <div className="space-y-2">
                      <Label className="text-sm">
                        Fin: {Math.round(config.xEnd)}px
                      </Label>
                      <Slider
                        value={[config.xEnd]}
                        onValueChange={(values) => handleSliderChange(index, 'xEnd', values)}
                        max={pageWidth}
                        min={0}
                        step={1}
                        className="w-full"
                      />
                    </div>
                  </div>
                  
                  {showAdvanced && (
                    <div className="bg-gray-50 p-3 rounded-lg text-xs space-y-1">
                      <div>Position X: {config.xStart.toFixed(1)} → {config.xEnd.toFixed(1)}</div>
                      <div>Centre: {((config.xStart + config.xEnd) / 2).toFixed(1)}px</div>
                      <div>Largeur: {width.toFixed(1)}px ({((width / pageWidth) * 100).toFixed(1)}%)</div>
                      {template && (
                        <div>Largeur attendue: {template.expectedWidth}px</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      
      {/* Visual Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Prévisualisation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-20 bg-gray-100 rounded-lg overflow-hidden">
            {columnConfigs.map((config, index) => {
              const template = BDK_COLUMN_TEMPLATES[index];
              const colors = [
                'rgba(255, 100, 100, 0.3)',
                'rgba(100, 255, 100, 0.3)',
                'rgba(100, 100, 255, 0.3)',
                'rgba(255, 255, 100, 0.3)',
                'rgba(255, 100, 255, 0.3)',
                'rgba(100, 255, 255, 0.3)',
                'rgba(255, 150, 100, 0.3)'
              ];
              
              return (
                <div
                  key={index}
                  className="absolute top-0 bottom-0 border-2 border-dashed flex items-center justify-center text-xs font-medium"
                  style={{
                    left: `${(config.xStart / pageWidth) * 100}%`,
                    width: `${((config.xEnd - config.xStart) / pageWidth) * 100}%`,
                    backgroundColor: colors[index],
                    borderColor: colors[index].replace('0.3', '0.8')
                  }}
                >
                  {template?.name || `Col ${index + 1}`}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ColumnAdjuster;
