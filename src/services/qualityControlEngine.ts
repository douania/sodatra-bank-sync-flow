
import {
  QualityError,
  QualityReport,
  QualityEvaluation,
  SaisieError,
  OmissionError,
  IncohérenceError,
  BankTransaction,
  BankMatchResult,
  ExcelMatchResult,
  SuggestedCollection
} from '@/types/qualityControl';

/**
 * PACK 0 — contrôle qualité consultatif.
 *
 * - Le moteur ne persiste rien : les méthodes de correction refusent
 *   explicitement (`QualityControlNotImplementedError`).
 * - Seuls les crédits bancaires explicites constituent une preuve
 *   d'encaissement. Les dépôts non crédités (`depositsNotCleared`) ne sont
 *   jamais utilisés comme preuve : ils sont, par définition, non encaissés.
 * - Sans ligne Excel ou sans preuve de crédit exploitable, le rapport est
 *   `NOT_EVALUABLE` : aucune anomalie n'est comptée, aucun score n'est
 *   fabriqué. L'écran ne peut pas distinguer une base vide d'une erreur de
 *   lecture masquée par le service de données ; il ne prétend pas le faire.
 */
export const QUALITY_CONTROL_NOT_EVALUABLE_MESSAGE =
  'Contrôle non évaluable — données absentes ou indisponibles.';

export class QualityControlNotImplementedError extends Error {
  readonly action: string;

  constructor(action: string) {
    super(`QUALITY_CONTROL_CORRECTION_NOT_IMPLEMENTED:${action}`);
    this.name = 'QualityControlNotImplementedError';
    this.action = action;
  }
}

export class QualityControlEngine {

  async analyzeQuality(
    excelData: any[],
    bankStatements: any[]
  ): Promise<QualityReport> {
    const rows = Array.isArray(excelData) ? excelData : [];
    const statements = Array.isArray(bankStatements) ? bankStatements : [];
    const errors: QualityError[] = [];
    const reportId = this.generateReportId();

    // Seules les preuves de crédit explicites sont retenues.
    const allBankTransactions = this.extractCreditTransactions(statements);
    const evaluation = this.evaluateAvailability(rows, statements, allBankTransactions);

    if (evaluation.status === 'NOT_EVALUABLE') {
      return this.generateQualityReport(reportId, errors, rows.length, evaluation);
    }

    // 1️⃣ DÉTECTER LES ERREURS DE SAISIE
    const saisieErrors = await this.detectSaisieErrors(rows, allBankTransactions);
    errors.push(...saisieErrors);

    // 2️⃣ DÉTECTER LES OMISSIONS
    const omissionErrors = await this.detectOmissions(rows, allBankTransactions);
    errors.push(...omissionErrors);

    // 3️⃣ DÉTECTER LES INCOHÉRENCES
    const incohérenceErrors = await this.detectIncohérences(rows, allBankTransactions);
    errors.push(...incohérenceErrors);

    // 4️⃣ GÉNÉRER LE RAPPORT (consultatif)
    return this.generateQualityReport(reportId, errors, rows.length, evaluation);
  }

  private evaluateAvailability(
    rows: readonly unknown[],
    statements: readonly unknown[],
    creditEvidence: readonly BankTransaction[],
  ): QualityEvaluation {
    const base = {
      excel_rows: rows.length,
      bank_reports: statements.length,
      credit_evidence: creditEvidence.length,
    };
    if (rows.length === 0 || creditEvidence.length === 0) {
      return { status: 'NOT_EVALUABLE', reason: QUALITY_CONTROL_NOT_EVALUABLE_MESSAGE, ...base };
    }
    return {
      status: 'EVALUABLE',
      reason: 'Comparaison consultative des lignes Excel aux crédits bancaires explicites disponibles.',
      ...base,
    };
  }

  /**
   * Extrait les seules preuves de crédit explicites. Les champs sont acceptés
   * en camelCase (mapping applicatif) comme en snake_case (lignes brutes),
   * afin qu'une divergence de nommage ne dégrade plus silencieusement la
   * comparaison. `depositsNotCleared` est volontairement ignoré.
   */
  private extractCreditTransactions(bankStatements: any[]): BankTransaction[] {
    const transactions: BankTransaction[] = [];

    for (const statement of bankStatements) {
      if (!statement || !Array.isArray(statement.transactions)) continue;
      const statementBank = statement.bank ?? statement.bank_name ?? statement.bankName ?? '';

      for (const transaction of statement.transactions) {
        if (!transaction) continue;
        const amount = Number(transaction.amount ?? transaction.montant);
        const explicitType = typeof transaction.type === 'string' ? transaction.type.toUpperCase() : undefined;
        const isCredit = explicitType ? explicitType === 'CREDIT' : Number.isFinite(amount) && amount > 0;
        if (!isCredit || !Number.isFinite(amount) || amount <= 0) continue;

        transactions.push({
          id: transaction.id,
          date: transaction.date ?? transaction.dateValeur ?? transaction.date_valeur ?? transaction.dateOperation ?? transaction.date_operation ?? '',
          description: String(transaction.description ?? transaction.libelle ?? transaction.reference ?? ''),
          amount,
          bank: String(transaction.bank ?? statementBank ?? ''),
          reference: transaction.reference,
          client_code: transaction.client_code ?? transaction.clientCode,
          type: 'CREDIT'
        });
      }
    }

    return transactions;
  }
  
  private async detectSaisieErrors(
    excelData: any[], 
    bankTransactions: BankTransaction[]
  ): Promise<SaisieError[]> {
    
    const errors: SaisieError[] = [];
    
    for (const excelRow of excelData) {
      // 🔍 CHERCHER LA MEILLEURE CORRESPONDANCE BANCAIRE
      const bankMatch = await this.findBestBankMatch(excelRow, bankTransactions);
      
      if (bankMatch && bankMatch.confidence > 0.8) {
        
        // ⚠️ VÉRIFIER ÉCART DE MONTANT
        const amountDiff = Math.abs(excelRow.collectionAmount - bankMatch.transaction.amount);
        if (amountDiff > 1000) {
          errors.push({
            id: this.generateErrorId(),
            type: 'SAISIE_ERROR',
            subtype: 'MONTANT_INCORRECT',
            collection_excel: excelRow,
            bank_transaction: bankMatch.transaction,
            error_description: `Écart de montant: ${amountDiff.toLocaleString()} FCFA`,
            suggested_correction: { 
              collectionAmount: bankMatch.transaction.amount,
              dateOfValidity: bankMatch.transaction.date 
            },
            confidence: bankMatch.confidence,
            reasoning: [
              `Excel: ${excelRow.collectionAmount?.toLocaleString()} FCFA`,
              `Banque: ${bankMatch.transaction.amount?.toLocaleString()} FCFA`,
              `Écart: ${amountDiff.toLocaleString()} FCFA`,
              'Relevé bancaire = source fiable',
              ...bankMatch.reasoning
            ],
            status: 'PENDING',
            created_at: new Date().toISOString()
          });
        }
        
        // ⚠️ VÉRIFIER BANQUE INCORRECTE
        if (excelRow.bankName && 
            excelRow.bankName.toUpperCase() !== bankMatch.transaction.bank.toUpperCase()) {
          errors.push({
            id: this.generateErrorId(),
            type: 'SAISIE_ERROR',
            subtype: 'BANQUE_INCORRECTE',
            collection_excel: excelRow,
            bank_transaction: bankMatch.transaction,
            error_description: `Banque incorrecte dans Excel`,
            suggested_correction: { 
              bankName: bankMatch.transaction.bank 
            },
            confidence: bankMatch.confidence,
            reasoning: [
              `Excel: ${excelRow.bankName}`,
              `Banque réelle: ${bankMatch.transaction.bank}`,
              'Transaction trouvée dans relevé de la banque correcte',
              ...bankMatch.reasoning
            ],
            status: 'PENDING',
            created_at: new Date().toISOString()
          });
        }
        
        // ⚠️ VÉRIFIER DATE INCORRECTE (si écart > 7 jours)
        const excelDate = new Date(excelRow.reportDate);
        const bankDate = new Date(bankMatch.transaction.date);
        const daysDiff = Math.abs((excelDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff > 7) {
          errors.push({
            id: this.generateErrorId(),
            type: 'SAISIE_ERROR',
            subtype: 'DATE_INCORRECTE',
            collection_excel: excelRow,
            bank_transaction: bankMatch.transaction,
            error_description: `Écart de date: ${Math.round(daysDiff)} jours`,
            suggested_correction: { 
              reportDate: bankMatch.transaction.date,
              dateOfValidity: bankMatch.transaction.date 
            },
            confidence: bankMatch.confidence * 0.9, // Réduire confiance pour écart de date
            reasoning: [
              `Excel: ${excelRow.reportDate}`,
              `Banque: ${bankMatch.transaction.date}`,
              `Écart: ${Math.round(daysDiff)} jours`,
              'Date du relevé bancaire plus fiable'
            ],
            status: 'PENDING',
            created_at: new Date().toISOString()
          });
        }
      }
    }
    
    return errors;
  }
  
  private async detectOmissions(
    excelData: any[], 
    bankTransactions: BankTransaction[]
  ): Promise<OmissionError[]> {
    
    const errors: OmissionError[] = [];
    
    // 🔍 CHERCHER LES TRANSACTIONS BANCAIRES NON PRÉSENTES DANS EXCEL
    for (const transaction of bankTransactions) {
      
      // Ignorer les petits montants (probablement des frais)
      if (transaction.amount < 50000) continue;
      
      // Ignorer les transactions qui ressemblent à des frais bancaires
      if (this.isBankFee(transaction)) continue;
      
      // 🔍 CHERCHER CORRESPONDANCE DANS EXCEL
      const excelMatch = await this.findExcelMatch(transaction, excelData);
      
      if (!excelMatch || excelMatch.confidence < 0.7) {
        // ⚠️ COLLECTION POTENTIELLEMENT MANQUANTE
        const suggestedCollection = await this.extractCollectionFromTransaction(transaction);
        
        if (suggestedCollection.confidence > 0.7) {
          errors.push({
            id: this.generateErrorId(),
            type: 'OMISSION_ERROR',
            subtype: 'COLLECTION_MANQUANTE',
            bank_transaction: transaction,
            missing_in_excel: true,
            suggested_addition: suggestedCollection.collection,
            error_description: `Collection manquante dans Excel`,
            confidence: suggestedCollection.confidence,
            reasoning: [
              `Transaction trouvée dans relevé ${transaction.bank}`,
              `Montant: ${transaction.amount?.toLocaleString()} FCFA`,
              `Date: ${transaction.date}`,
              'Aucune collection correspondante dans Excel',
              ...suggestedCollection.reasoning
            ],
            status: 'PENDING',
            created_at: new Date().toISOString()
          });
        }
      }
    }
    
    return errors;
  }
  
  private async detectIncohérences(
    excelData: any[], 
    bankTransactions: BankTransaction[]
  ): Promise<IncohérenceError[]> {
    
    const errors: IncohérenceError[] = [];
    
    for (const excelRow of excelData) {
      
      // ⚠️ VÉRIFIER DATE OF VALIDITY MANQUANTE
      if (!excelRow.dateOfValidity) {
        const bankMatch = await this.findBestBankMatch(excelRow, bankTransactions);
        
        if (bankMatch && bankMatch.confidence > 0.8) {
          errors.push({
            id: this.generateErrorId(),
            type: 'INCOHÉRENCE_ERROR',
            subtype: 'DATE_VALIDITY_INCORRECTE',
            collection_excel: excelRow,
            bank_evidence: [bankMatch.transaction],
            inconsistency_description: 'Date of validity manquante',
            error_description: 'Date of validity manquante dans Excel',
            suggested_correction: { 
              dateOfValidity: bankMatch.transaction.date 
            },
            confidence: bankMatch.confidence,
            reasoning: [
              'Date of validity non renseignée dans Excel',
              `Date de crédit bancaire: ${bankMatch.transaction.date}`,
              'Relevé bancaire confirme la date de crédit',
              ...bankMatch.reasoning
            ],
            status: 'PENDING',
            created_at: new Date().toISOString()
          });
        }
      }
    }
    
    return errors;
  }
  
  private async findBestBankMatch(
    excelRow: any, 
    bankTransactions: BankTransaction[]
  ): Promise<BankMatchResult | null> {
    
    let bestMatch: BankMatchResult | null = null;
    let bestScore = 0;
    
    for (const transaction of bankTransactions) {
      const score = this.calculateMatchScore(excelRow, transaction);
      
      if (score.confidence > bestScore && score.confidence > 0.6) {
        bestScore = score.confidence;
        bestMatch = {
          transaction,
          confidence: score.confidence,
          reasoning: score.reasoning
        };
      }
    }
    
    return bestMatch;
  }
  
  private calculateMatchScore(excelRow: any, transaction: BankTransaction): { confidence: number; reasoning: string[] } {
    let score = 0;
    const reasoning: string[] = [];
    
    // Correspondance de montant (poids: 40%)
    const amountDiff = Math.abs(excelRow.collectionAmount - transaction.amount);
    const amountMatch = Math.max(0, 1 - (amountDiff / transaction.amount));
    score += amountMatch * 0.4;
    
    if (amountMatch > 0.95) {
      reasoning.push('Montant quasi identique');
    } else if (amountMatch > 0.8) {
      reasoning.push(`Montant similaire (écart: ${amountDiff.toLocaleString()} FCFA)`);
    }
    
    // Correspondance de banque (poids: 20%)
    if (excelRow.bankName && 
        excelRow.bankName.toUpperCase().includes(transaction.bank.toUpperCase())) {
      score += 0.2;
      reasoning.push('Banque correspondante');
    }
    
    // Correspondance de date (poids: 20%)
    const excelDate = new Date(excelRow.reportDate);
    const bankDate = new Date(transaction.date);
    const daysDiff = Math.abs((excelDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 1) {
      score += 0.2;
      reasoning.push('Date identique ou proche');
    } else if (daysDiff <= 7) {
      score += 0.1;
      reasoning.push(`Date proche (${Math.round(daysDiff)} jours d'écart)`);
    }
    
    // Correspondance de client (poids: 20%)
    if (excelRow.clientCode && transaction.client_code &&
        excelRow.clientCode === transaction.client_code) {
      score += 0.2;
      reasoning.push('Code client identique');
    } else if (excelRow.clientCode && transaction.description &&
               transaction.description.toUpperCase().includes(excelRow.clientCode.toUpperCase())) {
      score += 0.1;
      reasoning.push('Client mentionné dans description');
    }
    
    return { confidence: Math.min(score, 1.0), reasoning };
  }
  
  private async findExcelMatch(
    transaction: BankTransaction, 
    excelData: any[]
  ): Promise<ExcelMatchResult | null> {
    
    let bestMatch: ExcelMatchResult | null = null;
    let bestScore = 0;
    
    for (const excelRow of excelData) {
      const score = this.calculateMatchScore(excelRow, transaction);
      
      if (score.confidence > bestScore) {
        bestScore = score.confidence;
        bestMatch = {
          collection: excelRow,
          confidence: score.confidence,
          reasoning: score.reasoning
        };
      }
    }
    
    return bestMatch;
  }
  
  private async extractCollectionFromTransaction(transaction: BankTransaction): Promise<SuggestedCollection> {
    const reasoning: string[] = [];
    let confidence = 0.5; // Score de base
    
    // Extraire informations de la description
    const description = transaction.description.toUpperCase();
    
    // Détecter patterns de collection
    if (description.includes('REGLEMENT') || description.includes('FACTURE')) {
      confidence += 0.2;
      reasoning.push('Pattern "REGLEMENT/FACTURE" détecté');
    }
    
    if (description.includes('VIR') || description.includes('VIREMENT')) {
      confidence += 0.1;
      reasoning.push('Virement détecté');
    }
    
    // Extraire numéro de facture
    const factureMatch = description.match(/(?:FACTURE|FAC|F)\s*(\d+)/i);
    let factureNo = null;
    if (factureMatch) {
      factureNo = factureMatch[1];
      confidence += 0.1;
      reasoning.push(`Numéro facture extrait: ${factureNo}`);
    }
    
    // Extraire nom du client (approximatif)
    let clientName = transaction.client_code || 'CLIENT_EXTRAIT';
    if (transaction.description.length > 10) {
      // Prendre les premiers mots significatifs
      const words = transaction.description.split(' ').filter(w => w.length > 2);
      if (words.length > 0) {
        clientName = words.slice(0, 2).join(' ');
        confidence += 0.1;
        reasoning.push(`Nom client extrait: ${clientName}`);
      }
    }
    
    const suggestedCollection = {
      reportDate: transaction.date,
      clientCode: transaction.client_code || clientName.substring(0, 10),
      collectionAmount: transaction.amount,
      bankName: transaction.bank,
      dateOfValidity: transaction.date,
      factureNo: factureNo,
      status: 'detected',
      remarques: `Détecté automatiquement depuis relevé ${transaction.bank}`,
      processingStatus: 'QUALITY_DETECTED'
    };
    
    return {
      collection: suggestedCollection,
      confidence: Math.min(confidence, 1.0),
      reasoning
    };
  }
  
  private isBankFee(transaction: BankTransaction): boolean {
    const description = transaction.description.toUpperCase();
    const feeKeywords = [
      'COMMISSION', 'FRAIS', 'AGIOS', 'INTERET', 'CHARGES',
      'COTISATION', 'ABONNEMENT', 'TENUE DE COMPTE', 'CARTES'
    ];
    
    return feeKeywords.some(keyword => description.includes(keyword));
  }
  
  private generateQualityReport(
    reportId: string,
    errors: QualityError[],
    totalAnalyzed: number,
    evaluation: QualityEvaluation,
  ): QualityReport {
    const saisieErrors = errors.filter(e => e.type === 'SAISIE_ERROR').length;
    const omissions = errors.filter(e => e.type === 'OMISSION_ERROR').length;
    const incohérences = errors.filter(e => e.type === 'INCOHÉRENCE_ERROR').length;

    // Aucun score artificiel : sans anomalie fondée, il n'y a pas de confiance
    // à afficher. Le score n'existe que comme moyenne des anomalies détectées.
    const confidenceScore = evaluation.status === 'EVALUABLE' && errors.length > 0
      ? Math.round((errors.reduce((sum, e) => sum + e.confidence, 0) / errors.length) * 100 * 100) / 100
      : null;

    return {
      id: reportId,
      analysis_date: new Date().toISOString(),
      evaluation,
      summary: {
        total_collections_analyzed: totalAnalyzed,
        errors_detected: errors.length,
        error_rate: evaluation.status === 'EVALUABLE' && totalAnalyzed > 0
          ? Math.round((errors.length / totalAnalyzed) * 100 * 100) / 100
          : 0,
        confidence_score: confidenceScore
      },
      errors_by_type: {
        saisie_errors: saisieErrors,
        omissions: omissions,
        incohérences: incohérences
      },
      errors: errors,
      pending_validations: errors.filter(e => e.status === 'PENDING'),
      validated_corrections: errors.filter(e => e.status === 'VALIDATED'),
      rejected_suggestions: errors.filter(e => e.status === 'REJECTED')
    };
  }
  
  private generateReportId(): string {
    return `QR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private generateErrorId(): string {
    return `QE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // PACK 0 — aucune correction n'est implémentée ni persistée. Les appels
  // refusent explicitement au lieu de simuler un succès.
  async validateError(_errorId: string): Promise<never> {
    throw new QualityControlNotImplementedError('validate');
  }

  async rejectError(_errorId: string, _reason: string): Promise<never> {
    throw new QualityControlNotImplementedError('reject');
  }

  async applyCorrection(_errorId: string, _correction: any): Promise<never> {
    throw new QualityControlNotImplementedError('apply');
  }
}

export const qualityControlEngine = new QualityControlEngine();
