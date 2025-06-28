import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileUp, Upload, X, AlertTriangle, CheckCircle, FileText, Building2, DollarSign, Users } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { enhancedFileProcessingService, FileDetectionResult, ProcessingResult } from '@/services/enhancedFileProcessingService';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const DocumentUnderstanding = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setAnalysisResult(null); // Clear previous results
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls', '.xlsx'],
      'application/pdf': ['.pdf'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  const handleAnalyze = async () => {
    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: "No file selected",
        description: "Please select a file to analyze.",
      });
      return;
    }

    setLoading(true);
    setAnalysisResult(null);

    try {
      const result = await enhancedFileProcessingService.analyzeSingleFileForDebug(selectedFile);
      setAnalysisResult(result);

      if (result.success) {
        toast({
          title: "Analysis complete",
          description: `File type detected: ${result.detectedType}`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Analysis failed",
          description: result.errors?.join(', ') || "An unknown error occurred during analysis.",
        });
      }
    } catch (error) {
      console.error("Error during analysis:", error);
      toast({
        variant: "destructive",
        title: "Critical error",
        description: `A critical error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const renderParsedData = (data: any, type: string) => {
    if (!data) return null;

    switch (type) {
      case 'collectionReport':
        return (
          <CardContent>
            <h3 className="text-lg font-semibold mb-4">Collections ({data.length})</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Code</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Report Date</TableHead>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Facture No</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((col: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{col.clientCode}</TableCell>
                    <TableCell>{col.collectionAmount?.toLocaleString()}</TableCell>
                    <TableCell>{col.reportDate}</TableCell>
                    <TableCell>{col.bankName}</TableCell>
                    <TableCell>{col.factureNo || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        );
      case 'bankAnalysis':
      case 'bankStatement':
        return (
          <CardContent>
            <h3 className="text-lg font-semibold mb-4">Bank Report ({data.bank})</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>Report Date:</strong> {data.date}</div>
              <div><strong>Opening Balance:</strong> {data.openingBalance?.toLocaleString()}</div>
              <div><strong>Closing Balance:</strong> {data.closingBalance?.toLocaleString()}</div>
            </div>
            <h4 className="text-md font-semibold mt-4 mb-2">Deposits Not Cleared ({data.depositsNotCleared?.length || 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date Depot</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Client Code</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.depositsNotCleared?.map((dep: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{dep.dateDepot}</TableCell>
                    <TableCell>{dep.montant?.toLocaleString()}</TableCell>
                    <TableCell>{dep.typeReglement}</TableCell>
                    <TableCell>{dep.clientCode || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h4 className="text-md font-semibold mt-4 mb-2">Impayés ({data.impayes?.length || 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date Echeance</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Client Code</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.impayes?.map((imp: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{imp.dateEcheance}</TableCell>
                    <TableCell>{imp.montant?.toLocaleString()}</TableCell>
                    <TableCell>{imp.clientCode}</TableCell>
                    <TableCell>{imp.description || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h4 className="text-md font-semibold mt-4 mb-2">Bank Facilities ({data.bankFacilities?.length || 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bankFacilities?.map((fac: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{fac.facilityType}</TableCell>
                    <TableCell>{fac.limitAmount?.toLocaleString()}</TableCell>
                    <TableCell>{fac.usedAmount?.toLocaleString()}</TableCell>
                    <TableCell>{fac.availableAmount?.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        );
      case 'fundsPosition':
        return (
          <CardContent>
            <h3 className="text-lg font-semibold mb-4">Fund Position</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>Report Date:</strong> {data.reportDate}</div>
              <div><strong>Total Fund Available:</strong> {data.totalFundAvailable?.toLocaleString()}</div>
              <div><strong>Collections Not Deposited:</strong> {data.collectionsNotDeposited?.toLocaleString()}</div>
              <div><strong>Grand Total:</strong> {data.grandTotal?.toLocaleString()}</div>
            </div>
            <h4 className="text-md font-semibold mt-4 mb-2">Details by Bank ({data.details?.length || 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Net Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.details?.map((det: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{det.bankName}</TableCell>
                    <TableCell>{det.balance?.toLocaleString()}</TableCell>
                    <TableCell>{det.netBalance?.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h4 className="text-md font-semibold mt-4 mb-2">Hold Collections ({data.holdCollections?.length || 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Cheque Number</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.holdCollections?.map((hold: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{hold.clientName}</TableCell>
                    <TableCell>{hold.amount?.toLocaleString()}</TableCell>
                    <TableCell>{hold.chequeNumber || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        );
      case 'clientReconciliation':
        return (
          <CardContent>
            <h3 className="text-lg font-semibold mb-4">Client Reconciliation ({data.length})</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Code</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Impayes Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((client: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{client.clientCode}</TableCell>
                    <TableCell>{client.clientName}</TableCell>
                    <TableCell>{client.impayesAmount?.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        );
      default:
        return (
          <CardContent>
            <h3 className="text-lg font-semibold mb-4">Parsed Data</h3>
            <pre className="bg-gray-100 p-4 rounded-md text-sm overflow-auto max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
          </CardContent>
        );
    }
  };

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Document Understanding</h1>
      <p className="text-gray-600 mb-8">
        Upload a single document to see how the application detects its type, extracts raw text, and parses structured data.
      </p>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-6 w-6" />
            <span>Upload Document for Analysis</span>
          </CardTitle>
          <CardDescription>
            Drag and drop your file here, or click to select. Supported formats: Excel (.xlsx, .xls), PDF (.pdf), CSV (.csv).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragActive 
                ? 'border-blue-400 bg-blue-50' 
                : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
            }`}
          >
            <input {...getInputProps()} />
            <FileUp className={`h-10 w-10 mb-3 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
            {isDragActive ? (
              <p className="text-blue-600 text-lg font-medium">Drop the file here...</p>
            ) : (
              <>
                <p className="text-gray-600 text-lg font-medium mb-1">
                  Drag & drop a file here
                </p>
                <p className="text-gray-500 text-sm">
                  or click to select a file
                </p>
              </>
            )}
          </div>
          {selectedFile && (
            <div className="mt-4 flex items-center justify-between p-3 border rounded-md bg-gray-50">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-gray-600" />
                <span className="font-medium text-gray-800">{selectedFile.name}</span>
                <span className="text-sm text-gray-500">({(selectedFile.size / 1024).toFixed(2)} KB)</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)}>
                <X className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          )}
          <Button 
            onClick={handleAnalyze} 
            disabled={!selectedFile || loading}
            className="mt-6 w-full"
          >
            {loading ? 'Analyzing...' : 'Analyze Document'}
          </Button>
        </CardContent>
      </Card>

      {analysisResult && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span>Analysis Results</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Detected Type</h3>
                  <Badge className="text-md px-3 py-1">
                    {analysisResult.detectedType} {analysisResult.bankType && `(${analysisResult.bankType})`}
                  </Badge>
                  <p className="text-sm text-gray-600 mt-2">Confidence: {analysisResult.confidence}</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">Processing Status</h3>
                  <Badge variant={analysisResult.success ? 'default' : 'destructive'} className="text-md px-3 py-1">
                    {analysisResult.success ? 'Success' : 'Failed'}
                  </Badge>
                  {analysisResult.errors && analysisResult.errors.length > 0 && (
                    <div className="text-red-600 text-sm mt-2">
                      <AlertTriangle className="inline-block h-4 w-4 mr-1" />
                      Errors: {analysisResult.errors.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw Extracted Text</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-100 p-4 rounded-md text-sm overflow-auto max-h-96">
                {analysisResult.rawTextContent || 'No raw text extracted.'}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parsed Structured Data</CardTitle>
            </CardHeader>
            {renderParsedData(analysisResult.parsedData, analysisResult.detectedType)}
          </Card>
        </div>
      )}
    </div>
  );
};

export default DocumentUnderstanding;