
import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { Eye, EyeOff, Copy, Search, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

interface PDFTextViewerProps {
  rawText: string;
  fileName?: string;
  onHighlight?: (text: string) => void;
}

const PDFTextViewer: React.FC<PDFTextViewerProps> = ({ 
  rawText, 
  fileName = "Document", 
  onHighlight 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedText, setHighlightedText] = useState('');
  const { toast } = useToast();

  // Statistics about the text
  const stats = {
    lines: rawText.split('\n').length,
    words: rawText.split(/\s+/).filter(word => word.length > 0).length,
    characters: rawText.length,
    size: new Blob([rawText]).size
  };

  // Copy text to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      toast({
        title: "Copié",
        description: "Le texte a été copié dans le presse-papiers",
      });
    } catch (error) {
      console.error('Erreur copie:', error);
      toast({
        title: "Erreur",
        description: "Impossible de copier le texte",
        variant: "destructive",
      });
    }
  };

  // Highlight search term in text
  const highlightText = (text: string, term: string) => {
    if (!term.trim()) return text;
    
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200 text-yellow-900 px-1 rounded">$1</mark>');
  };

  // Handle search
  const handleSearch = (term: string) => {
    setSearchTerm(term);
    if (term.trim()) {
      setHighlightedText(highlightText(rawText, term));
      onHighlight?.(term);
    } else {
      setHighlightedText('');
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <CardTitle>Texte Brut du PDF</CardTitle>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline">{fileName}</Badge>
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm">
                  {isOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {isOpen ? 'Masquer' : 'Afficher'}
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          </div>
        </div>
        <CardDescription>
          Visualisez le texte brut extrait du PDF pour comprendre le parsing des données
        </CardDescription>
      </CardHeader>
      
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Statistics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold text-primary">{stats.lines.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Lignes</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold text-primary">{stats.words.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Mots</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold text-primary">{stats.characters.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Caractères</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold text-primary">{(stats.size / 1024).toFixed(1)} KB</div>
                <div className="text-sm text-muted-foreground">Taille</div>
              </div>
            </div>

            {/* Search and actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Rechercher dans le texte..."
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button 
                onClick={copyToClipboard}
                variant="outline"
                size="sm"
                className="flex items-center space-x-2"
              >
                <Copy className="h-4 w-4" />
                <span>Copier</span>
              </Button>
            </div>

            {/* Text content */}
            <div className="border rounded-lg p-4 bg-muted/50">
              <div 
                className="text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
                dangerouslySetInnerHTML={{ 
                  __html: DOMPurify.sanitize(highlightedText || rawText.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
                }}
              />
            </div>

            {/* Search results info */}
            {searchTerm && (
              <div className="text-sm text-muted-foreground">
                {(() => {
                  const matches = rawText.match(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
                  return matches ? `${matches.length} résultat(s) trouvé(s)` : 'Aucun résultat trouvé';
                })()}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default PDFTextViewer;
