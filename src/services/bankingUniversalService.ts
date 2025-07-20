import { supabase } from "@/integrations/supabase/client";
import { 
  RapportBancaire, 
  BankType, 
  ComparaisonRapport, 
  Evolution, 
  Alerte,
  UniversalBankReportDB,
  BankEvolutionDB,
  BankAuditLogDB,
  RapportConsolide
} from "@/types/banking-universal";

export class BankingUniversalService {
  
  /**
   * Sauvegarde un rapport bancaire dans Supabase
   */
  async saveReport(rapport: RapportBancaire, rawData: any): Promise<{ success: boolean; error?: string }> {
    try {
      // Récupérer l'utilisateur connecté
      const { data: { user } } = await supabase.auth.getUser();
      
      // Convertir la date au format ISO si nécessaire
      const reportDate = this.convertDateToISO(rapport.dateRapport);
      
      // Audit log (sans user_id si pas connecté)
      await this.logAction('save_report', rapport.banque, reportDate, {
        checksum: rapport.metadata.checksum
      });

      const { data, error } = await supabase
        .from('universal_bank_reports')
        .upsert({
          bank_name: rapport.banque,
          report_date: reportDate,
          raw_data: rawData as any,
          processed_data: rapport as any,
          checksum: rapport.metadata.checksum,
          parser_version: rapport.metadata.versionParser,
          user_id: user?.id || null
        }, {
          onConflict: 'bank_name,report_date,checksum'
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Erreur sauvegarde rapport:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
      
      // Messages d'erreur plus explicites
      if (errorMessage.includes('42501')) {
        return { success: false, error: 'Erreur de permissions. Veuillez vous connecter.' };
      }
      if (errorMessage.includes('22008')) {
        return { success: false, error: 'Format de date invalide. Veuillez vérifier le format des dates.' };
      }
      
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Récupère les rapports d'une banque pour une période
   */
  async getReports(banque: BankType, dateDebut?: string, dateFin?: string): Promise<RapportBancaire[]> {
    try {
      let query = supabase
        .from('universal_bank_reports')
        .select('*')
        .eq('bank_name', banque)
        .order('report_date', { ascending: false });

      if (dateDebut) query = query.gte('report_date', dateDebut);
      if (dateFin) query = query.lte('report_date', dateFin);

      const { data, error } = await query;
      
      if (error) throw error;
      
      return data?.map((item: any) => this.mapDbToRapport(item)) || [];
    } catch (error) {
      console.error('Erreur récupération rapports:', error);
      return [];
    }
  }

  /**
   * Récupère le dernier rapport d'une banque
   */
  async getLatestReport(banque: BankType): Promise<RapportBancaire | null> {
    try {
      const { data, error } = await supabase
        .from('universal_bank_reports')
        .select('*')
        .eq('bank_name', banque)
        .order('report_date', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      
      return data ? this.mapDbToRapport(data) : null;
    } catch (error) {
      console.error('Erreur récupération dernier rapport:', error);
      return null;
    }
  }

  /**
   * Compare deux rapports et détecte les évolutions
   */
  async compareReports(banque: BankType, dateActuelle: string): Promise<ComparaisonRapport | null> {
    try {
      // Récupérer les deux derniers rapports
      const { data, error } = await supabase
        .from('universal_bank_reports')
        .select('*')
        .eq('bank_name', banque)
        .lte('report_date', dateActuelle)
        .order('report_date', { ascending: false })
        .limit(2);

      if (error || !data || data.length < 2) return null;

      const rapportActuel = this.mapDbToRapport(data[0] as any);
      const rapportPrecedent = this.mapDbToRapport(data[1] as any);

      const evolutions = this.detectEvolutions(rapportPrecedent, rapportActuel);
      const alertes = this.generateAlertes(evolutions);

      // Sauvegarder les évolutions
      await this.saveEvolutions(banque, dateActuelle, evolutions);

      return {
        rapportPrecedent,
        rapportActuel,
        evolutions,
        nouveauxElements: this.detectNouveauxElements(rapportPrecedent, rapportActuel),
        elementsDisparus: this.detectElementsDisparus(rapportPrecedent, rapportActuel),
        alertes
      };
    } catch (error) {
      console.error('Erreur comparaison rapports:', error);
      return null;
    }
  }

  /**
   * Génère un rapport consolidé multi-banques
   */
  async generateConsolidatedReport(banques: BankType[], date: string): Promise<RapportConsolide> {
    try {
      const rapports: RapportBancaire[] = [];
      
      for (const banque of banques) {
        const rapport = await this.getLatestReport(banque);
        if (rapport) rapports.push(rapport);
      }

      const totaux = this.calculateTotaux(rapports);
      const alertesGlobales = await this.getAlertesGlobales(banques, date);
      const tendances = await this.calculateTendances(banques, date);

      return {
        dateGeneration: new Date().toISOString(),
        periode: { debut: date, fin: date },
        banques: rapports,
        totaux,
        alertesGlobales,
        recommandations: this.generateRecommandations(rapports, alertesGlobales),
        tendances
      };
    } catch (error) {
      console.error('Erreur génération rapport consolidé:', error);
      throw error;
    }
  }

  /**
   * Récupère les évolutions récentes
   */
  async getEvolutions(banque?: BankType, limit: number = 50): Promise<any[]> {
    try {
      let query = supabase
        .from('bank_evolution_tracking')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (banque) query = query.eq('bank_name', banque);

      const { data, error } = await query;
      if (error) throw error;
      
      return data || [];
    } catch (error) {
      console.error('Erreur récupération évolutions:', error);
      return [];
    }
  }

  // Méthodes privées

  private mapDbToRapport(data: any): RapportBancaire {
    return data.processed_data as RapportBancaire;
  }

  private detectEvolutions(precedent: RapportBancaire, actuel: RapportBancaire): Evolution[] {
    const evolutions: Evolution[] = [];

    // Chèques débités
    const chequesDebites = precedent.chequesNonDebites.filter(cheque => 
      !actuel.chequesNonDebites.find(c => c.reference === cheque.reference)
    );

    chequesDebites.forEach(cheque => {
      evolutions.push({
        type: 'cheque_debite',
        element: cheque,
        description: `Chèque ${cheque.reference} débité`,
        impact: 'negatif'
      });
    });

    // Dépôts crédités
    const depotsCredites = precedent.depotsNonCredites.filter(depot => 
      !actuel.depotsNonCredites.find(d => d.reference === depot.reference)
    );

    depotsCredites.forEach(depot => {
      evolutions.push({
        type: 'depot_credite',
        element: depot,
        description: `Dépôt ${depot.reference} crédité`,
        impact: 'positif'
      });
    });

    // Nouveaux impayés
    const nouveauxImpayes = actuel.impayes.filter(impaye => 
      !precedent.impayes.find(i => i.reference === impaye.reference)
    );

    nouveauxImpayes.forEach(impaye => {
      evolutions.push({
        type: 'nouvel_impaye',
        element: impaye as any,
        description: `Nouvel impayé: ${impaye.description}`,
        impact: 'negatif'
      });
    });

    return evolutions;
  }

  private generateAlertes(evolutions: Evolution[]): Alerte[] {
    const alertes: Alerte[] = [];

    evolutions.forEach(evolution => {
      if (evolution.type === 'nouvel_impaye') {
        alertes.push({
          type: 'critique',
          message: 'Nouvel impayé détecté',
          details: evolution.description,
          banque: 'BDK', // À adapter selon le contexte
          dateDetection: new Date().toISOString()
        });
      }
    });

    return alertes;
  }

  private detectNouveauxElements(precedent: RapportBancaire, actuel: RapportBancaire): any[] {
    return actuel.depotsNonCredites.filter(depot => 
      !precedent.depotsNonCredites.find(d => d.reference === depot.reference)
    );
  }

  private detectElementsDisparus(precedent: RapportBancaire, actuel: RapportBancaire): any[] {
    return precedent.chequesNonDebites.filter(cheque => 
      !actuel.chequesNonDebites.find(c => c.reference === cheque.reference)
    );
  }

  private async saveEvolutions(banque: BankType, date: string, evolutions: Evolution[]): Promise<void> {
    for (const evolution of evolutions) {
      await supabase.from('bank_evolution_tracking').insert({
        bank_name: banque,
        report_date: date,
        evolution_type: evolution.type,
        reference: (evolution.element as any).reference || (evolution.element as any).id,
        amount: 'montant' in evolution.element ? evolution.element.montant : undefined,
        description: evolution.description,
        current_status: 'detected'
      });
    }
  }

  private calculateTotaux(rapports: RapportBancaire[]) {
    return {
      liquiditeDisponible: rapports.reduce((sum, r) => sum + r.soldeCloture, 0),
      facilitesUtilisees: rapports.reduce((sum, r) => 
        sum + r.facilitesBancaires.reduce((s, f) => s + f.montantUtilise, 0), 0),
      montantRisque: rapports.reduce((sum, r) => 
        sum + r.impayes.reduce((s, i) => s + i.montant, 0), 0),
      depotsEnAttente: rapports.reduce((sum, r) => 
        sum + r.depotsNonCredites.reduce((s, d) => s + d.montant, 0), 0)
    };
  }

  private async getAlertesGlobales(banques: BankType[], date: string): Promise<Alerte[]> {
    // Implementation basique - à enrichir selon les besoins
    return [];
  }

  private async calculateTendances(banques: BankType[], date: string) {
    // Implementation basique - récupérer les 7 derniers jours
    return {
      liquidite: [100, 105, 98, 110, 115, 108, 111],
      facilites: [800, 805, 810, 815, 809, 812, 809],
      dates: ['19/06', '20/06', '21/06', '22/06', '23/06', '24/06', '25/06']
    };
  }

  private generateRecommandations(rapports: RapportBancaire[], alertes: Alerte[]): string[] {
    const recommendations: string[] = [];
    
    if (alertes.some(a => a.type === 'critique')) {
      recommendations.push('Traiter les alertes critiques en priorité');
    }
    
    const totalImpayes = rapports.reduce((sum, r) => 
      sum + r.impayes.reduce((s, i) => s + i.montant, 0), 0);
    
    if (totalImpayes > 0) {
      recommendations.push(`Régulariser les impayés (${totalImpayes.toLocaleString()} FCFA)`);
    }

    return recommendations;
  }

  private async logAction(action: string, banque?: BankType, date?: string, details?: any): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      await supabase.from('bank_audit_log').insert({
        user_id: user?.id || null,
        action,
        bank_name: banque,
        report_date: date ? this.convertDateToISO(date) : null,
        details
      });
    } catch (error) {
      console.error('Erreur audit log:', error);
    }
  }

  /**
   * Convertit une date du format DD/MM/YYYY vers YYYY-MM-DD pour PostgreSQL
   */
  private convertDateToISO(dateString: string): string {
    // Si déjà au format ISO, retourner tel quel
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }
    
    // Convertir DD/MM/YYYY vers YYYY-MM-DD
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
      const [day, month, year] = dateString.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Essayer d'autres formats si nécessaire
    try {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      console.warn('Format de date non reconnu:', dateString);
    }
    
    return dateString; // Retourner tel quel si conversion impossible
  }
}

export const bankingUniversalService = new BankingUniversalService();