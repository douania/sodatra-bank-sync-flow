
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, BarChart3, AlertTriangle, FileText, Users, TrendingUp, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            SODATRA - Système de Gestion Financière Multi-Banques
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Plateforme de surveillance et d'analyse consolidée des positions bancaires en temps réel
          </p>
        </div>

        {/* Main Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-blue-600">
                <BarChart3 className="h-6 w-6" />
                <span>Dashboard Principal</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Vue d'ensemble des positions bancaires avec analyses détaillées par banque
              </p>
              <Link to="/dashboard">
                <Button className="w-full">
                  Accéder au Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow border-2 border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-green-600">
                <Building2 className="h-6 w-6" />
                <span>Vue Consolidée</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Analyse cross-bank avancée avec détection automatique des risques multi-banques
              </p>
              <Link to="/consolidated">
                <Button variant="outline" className="w-full border-green-600 text-green-600 hover:bg-green-50">
                  Vue Consolidée Multi-Banques
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-purple-600">
                <AlertTriangle className="h-6 w-6" />
                <span>Alertes Critiques</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Surveillance des alertes et incidents nécessitant une attention immédiate
              </p>
              <Link to="/alerts">
                <Button variant="outline" className="w-full border-purple-600 text-purple-600 hover:bg-purple-50">
                  Voir les Alertes
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-orange-600">
                <FileText className="h-6 w-6" />
                <span>Import de Données</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Upload et traitement automatique des rapports bancaires Excel
              </p>
              <div className="flex flex-col space-y-2">
                <Link to="/upload">
                  <Button variant="outline" className="w-full border-orange-600 text-orange-600 hover:bg-orange-50">
                    Importer des Fichiers
                  </Button>
                </Link>
                <Link to="/upload-bulk">
                  <Button variant="outline" className="w-full border-blue-600 text-blue-600 hover:bg-blue-50">
                    Importation en Masse
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow border-2 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-blue-600">
                <Upload className="h-6 w-6" />
                <span>Importation en Masse</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Importation intelligente avec détection automatique des types de fichiers
              </p>
              <Link to="/upload-bulk">
                <Button variant="outline" className="w-full border-blue-600 text-blue-600 hover:bg-blue-50">
                  Nouvelle Interface
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-teal-600">
                <Users className="h-6 w-6" />
                <span>Réconciliation</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Réconciliation des comptes clients et vérification des soldes
              </p>
              <Link to="/reconciliation">
                <Button variant="outline" className="w-full border-teal-600 text-teal-600 hover:bg-teal-50">
                  Réconciliation Clients
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Key Features */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="h-6 w-6 text-blue-600" />
              <span>Fonctionnalités Clés du Système</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center p-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Building2 className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="font-semibold mb-2">Multi-Banques</h3>
                <p className="text-sm text-gray-600">Surveillance simultanée de toutes vos banques</p>
              </div>
              
              <div className="text-center p-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="font-semibold mb-2">Alertes Intelligentes</h3>
                <p className="text-sm text-gray-600">Détection automatique des risques cross-bank</p>
              </div>
              
              <div className="text-center p-4">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <BarChart3 className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="font-semibold mb-2">Analyses Avancées</h3>
                <p className="text-sm text-gray-600">Métriques consolidées et tableaux de bord</p>
              </div>
              
              <div className="text-center p-4">
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <FileText className="h-6 w-6 text-orange-600" />
                </div>
                <h3 className="font-semibold mb-2">Import Automatique</h3>
                <p className="text-sm text-gray-600">Traitement intelligent des fichiers Excel</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats Preview */}
        <div className="text-center">
          <p className="text-gray-500 mb-4">Système opérationnel - Prêt pour l'analyse en temps réel</p>
          <Link to="/consolidated">
            <Button size="lg" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              🚀 Accéder à la Vue Consolidée Multi-Banques
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Index;
