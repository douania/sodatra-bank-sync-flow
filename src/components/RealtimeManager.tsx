import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  Wifi, 
  WifiOff, 
  Users, 
  Clock, 
  Zap,
  RefreshCw,
  Bell,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RealtimeEvent {
  id: string;
  type: 'report_uploaded' | 'evolution_detected' | 'alert_generated' | 'user_activity';
  timestamp: string;
  data: any;
  user?: string;
}

interface UserPresence {
  userId: string;
  userName: string;
  lastSeen: string;
  status: 'online' | 'away' | 'offline';
  currentPage?: string;
}

const RealtimeManager: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [userPresence, setUserPresence] = useState<UserPresence[]>([]);
  const [channel, setChannel] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    initializeRealtime();
    return () => {
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, []);

  const initializeRealtime = async () => {
    try {
      // Créer un canal pour les événements bancaires en temps réel
      const bankingChannel = supabase.channel('banking_events', {
        config: {
          presence: {
            key: crypto.randomUUID(),
          },
        },
      });

      // Écouter les changements dans les rapports bancaires
      bankingChannel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'universal_bank_reports'
          },
          (payload) => {
            const newEvent: RealtimeEvent = {
              id: crypto.randomUUID(),
              type: 'report_uploaded',
              timestamp: new Date().toISOString(),
              data: payload.new,
              user: 'Système'
            };
            
            setEvents(prev => [newEvent, ...prev.slice(0, 19)]); // Garder les 20 derniers
            
            toast({
              title: "Nouveau rapport détecté",
              description: `Rapport ${payload.new.bank_name} du ${payload.new.report_date}`,
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'bank_evolution_tracking'
          },
          (payload) => {
            const newEvent: RealtimeEvent = {
              id: crypto.randomUUID(),
              type: 'evolution_detected',
              timestamp: new Date().toISOString(),
              data: payload.new,
              user: 'Système'
            };
            
            setEvents(prev => [newEvent, ...prev.slice(0, 19)]);
            
            toast({
              title: "Évolution détectée",
              description: `${payload.new.evolution_type} - ${payload.new.bank_name}`,
            });
          }
        )
        .on('presence', { event: 'sync' }, () => {
          const presenceState = bankingChannel.presenceState();
          const users = Object.keys(presenceState).map(userId => {
            const presence = presenceState[userId][0] as any;
            return {
              userId,
              userName: presence?.userName || 'Utilisateur inconnu',
              lastSeen: presence?.lastSeen || new Date().toISOString(),
              status: presence?.status || 'online',
              currentPage: presence?.currentPage
            };
          });
          setUserPresence(users);
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          console.log('Nouvel utilisateur connecté:', newPresences);
        })
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          console.log('Utilisateur déconnecté:', leftPresences);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setChannel(bankingChannel);
            
            // Envoyer notre présence
            await bankingChannel.track({
              userName: 'Utilisateur Banking',
              lastSeen: new Date().toISOString(),
              status: 'online',
              currentPage: '/banking/dashboard'
            });
            
            toast({
              title: "Connexion temps réel active",
              description: "Vous recevrez les notifications en temps réel",
            });
          } else {
            setIsConnected(false);
          }
        });

      // Simuler quelques événements pour la démo
      setTimeout(() => simulateEvents(), 3000);
      
    } catch (error) {
      console.error('Erreur initialisation temps réel:', error);
      setIsConnected(false);
    }
  };

  const simulateEvents = () => {
    const mockEvents: RealtimeEvent[] = [
      {
        id: '1',
        type: 'report_uploaded',
        timestamp: new Date(Date.now() - 300000).toISOString(), // 5 min ago
        data: { bank_name: 'BDK', report_date: '2025-06-25' },
        user: 'Jean Dupont'
      },
      {
        id: '2',
        type: 'evolution_detected',
        timestamp: new Date(Date.now() - 600000).toISOString(), // 10 min ago
        data: { evolution_type: 'cheque_debite', bank_name: 'SGS', amount: 750000 },
        user: 'Système'
      },
      {
        id: '3',
        type: 'alert_generated',
        timestamp: new Date(Date.now() - 900000).toISOString(), // 15 min ago
        data: { type: 'critique', message: 'Impayé détecté', bank_name: 'BICIS' },
        user: 'Système'
      }
    ];

    setEvents(mockEvents);
    
    const mockUsers: UserPresence[] = [
      {
        userId: 'user1',
        userName: 'Jean Dupont',
        lastSeen: new Date().toISOString(),
        status: 'online',
        currentPage: '/banking/dashboard'
      },
      {
        userId: 'user2',
        userName: 'Marie Martin',
        lastSeen: new Date(Date.now() - 120000).toISOString(),
        status: 'away',
        currentPage: '/banking/reports'
      }
    ];

    setUserPresence(mockUsers);
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'report_uploaded': return <RefreshCw className="h-4 w-4 text-blue-600" />;
      case 'evolution_detected': return <Zap className="h-4 w-4 text-yellow-600" />;
      case 'alert_generated': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'user_activity': return <Users className="h-4 w-4 text-green-600" />;
      default: return <CheckCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getEventDescription = (event: RealtimeEvent) => {
    switch (event.type) {
      case 'report_uploaded':
        return `Nouveau rapport ${event.data.bank_name} du ${event.data.report_date}`;
      case 'evolution_detected':
        return `${event.data.evolution_type} détecté - ${event.data.bank_name}`;
      case 'alert_generated':
        return `${event.data.type}: ${event.data.message} (${event.data.bank_name})`;
      case 'user_activity':
        return `Activité utilisateur: ${event.data.action}`;
      default:
        return 'Événement système';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `${diffMins} min`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
    return `${Math.floor(diffMins / 1440)}j`;
  };

  return (
    <div className="space-y-6">
      {/* Statut de connexion */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center space-x-2">
            {isConnected ? (
              <Wifi className="h-5 w-5 text-green-600" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-600" />
            )}
            <span>Statut Temps Réel</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
              <span className={`font-medium ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                {isConnected ? 'Connecté' : 'Déconnecté'}
              </span>
              {isConnected && (
                <Badge variant="outline" className="text-xs">
                  {userPresence.length} utilisateur(s) en ligne
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={initializeRealtime}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reconnecter
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Événements temps réel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bell className="h-5 w-5" />
              <span>Événements Temps Réel</span>
            </CardTitle>
            <CardDescription>Derniers événements du système bancaire</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  Aucun événement récent
                </p>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                    {getEventIcon(event.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {getEventDescription(event)}
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        <p className="text-xs text-muted-foreground">
                          Par {event.user}
                        </p>
                        <span className="text-xs text-muted-foreground">•</span>
                        <p className="text-xs text-muted-foreground">
                          {formatTimeAgo(event.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Présence utilisateurs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Users className="h-5 w-5" />
              <span>Utilisateurs Connectés</span>
            </CardTitle>
            <CardDescription>Activité des utilisateurs en temps réel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {userPresence.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  Aucun utilisateur connecté
                </p>
              ) : (
                userPresence.map((user) => (
                  <div key={user.userId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600">
                            {user.userName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(user.status)}`}></div>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{user.userName}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.currentPage && `Sur ${user.currentPage}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-xs">
                        {user.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatTimeAgo(user.lastSeen)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertes temps réel */}
      {!isConnected && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            La connexion temps réel est inactive. Certaines fonctionnalités peuvent ne pas être à jour.
            <Button variant="link" className="p-0 h-auto ml-2" onClick={initializeRealtime}>
              Réessayer la connexion
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default RealtimeManager;