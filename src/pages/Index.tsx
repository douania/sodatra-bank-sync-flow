
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  Upload, 
  FileText, 
  AlertTriangle, 
  BarChart3, 
  Clock,
  CheckCircle,
  ArrowRight
} from 'lucide-react';

const Index = () => {
  const features = [
    {
      icon: Upload,
      title: 'Upload Automatisé',
      description: 'Réception automatique des fichiers par email ou upload manuel des relevés bancaires, Collection Reports et rapports de rapprochement.',
      link: '/upload'
    },
    {
      icon: FileText,
      title: 'Extraction Intelligente',
      description: 'Extraction automatique des données depuis les PDFs bancaires et fichiers Excel avec reconnaissance des patterns bancaires.',
      link: '/upload'
    },
    {
      icon: BarChart3,
      title: 'Rapprochement Croisé',
      description: 'Rapprochement automatisé multi-critères avec scoring intelligent et détection d\'écarts.',
      link: '/reconciliation'
    },
    {
      icon: AlertTriangle,
      title: 'Alertes Temps Réel',
      description: 'Système d\'alertes automatique pour les écarts, impayés, anomalies et fichiers manquants.',
      link: '/alerts'
    }
  ];

  const stats = [
    { label: 'Banques Supportées', value: '4', description: 'SGS, BDK, BICIS, UBA' },
    { label: 'Taux de Précision', value: '98%', description: 'Rapprochement automatique' },
    { label: 'Gain de Temps', value: '85%', description: 'Par rapport au manuel' },
    { label: 'Alertes/Jour', value: '<5', description: 'Anomalies détectées' }
  ];

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <Building2 className="h-16 w-16 text-blue-600" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">
          SODATRA Bank Control
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Solution d'automatisation complète pour l'audit et le rapprochement bancaire quotidien. 
          Traitement intelligent des relevés PDF, Collection Reports Excel et rapports de position de fonds.
        </p>
        <div className="flex justify-center space-x-4">
          <Link to="/dashboard">
            <Button size="lg" className="px-8">
              Accéder au Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link to="/upload">
            <Button variant="outline" size="lg" className="px-8">
              Commencer l'Upload
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <Card key={index} className="text-center">
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-blue-600 mb-2">{stat.value}</div>
              <div className="font-medium text-gray-900 mb-1">{stat.label}</div>
              <div className="text-sm text-gray-600">{stat.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Features Section */}
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Fonctionnalités Principales
          </h2>
          <p className="text-lg text-gray-600">
            Une suite complète d'outils pour automatiser votre contrôle bancaire
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-3">
                    <Icon className="h-6 w-6 text-blue-600" />
                    <span>{feature.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">{feature.description}</p>
                  <Link to={feature.link}>
                    <Button variant="outline" size="sm">
                      En savoir plus
                      <ArrowRight className="ml-2 h-3 w-3" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Workflow Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-center text-2xl">Workflow de Traitement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                <Upload className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="font-semibold">1. Réception</h3>
              <p className="text-sm text-gray-600">Upload ou réception automatique des fichiers par email</p>
            </div>
            
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <FileText className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="font-semibold">2. Extraction</h3>
              <p className="text-sm text-gray-600">Extraction automatique des données PDF et Excel</p>
            </div>
            
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
                <BarChart3 className="h-6 w-6 text-purple-600" />
              </div>
              <h3 className="font-semibold">3. Rapprochement</h3>
              <p className="text-sm text-gray-600">Analyse croisée et rapprochement multi-critères</p>
            </div>
            
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="h-6 w-6 text-orange-600" />
              </div>
              <h3 className="font-semibold">4. Reporting</h3>
              <p className="text-sm text-gray-600">Génération de rapports et alertes automatiques</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions Rapides</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/dashboard" className="block">
              <Button variant="outline" className="w-full h-16 flex-col space-y-2">
                <BarChart3 className="h-5 w-5" />
                <span>Voir le Dashboard</span>
              </Button>
            </Link>
            
            <Link to="/upload" className="block">
              <Button variant="outline" className="w-full h-16 flex-col space-y-2">
                <Upload className="h-5 w-5" />
                <span>Uploader des Fichiers</span>
              </Button>
            </Link>
            
            <Link to="/alerts" className="block">
              <Button variant="outline" className="w-full h-16 flex-col space-y-2">
                <AlertTriangle className="h-5 w-5" />
                <span>Voir les Alertes</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;
