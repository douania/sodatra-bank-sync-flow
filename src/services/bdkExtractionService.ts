// Service d'extraction spécialisé pour les relevés BDK
export interface BDKOpeningBalance {
  date: string;
  amount: number;
}

export interface BDKDeposit {
  dateOperation: string;
  dateValeur: string;
  description: string;
  vendor: string;
  client: string;
  amount: number;
}

export interface BDKCheck {
  date: string;
  checkNumber: string;
  description: string;
  client?: string;
  reference?: string;
  amount: number;
}

export interface BDKFacility {
  name: string;
  dateEcheance?: string;
  limit: number;
  used: number;
  balance: number;
}

export interface BDKImpaye {
  date: string;
  reference: string;
  type: string;
  bank: string;
  client: string;
  description: string;
  amount: number;
}

export interface BDKParsedData {
  accountNumber?: string;
  reportDate: string;
  openingBalance: BDKOpeningBalance;
  deposits: BDKDeposit[];
  totalDeposits: number;
  totalBalanceA: number;
  checks: BDKCheck[];
  totalChecks: number;
  closingBalance: number;
  facilities: BDKFacility[];
  totalFacilities: {
    totalLimit: number;
    totalUsed: number;
    totalBalance: number;
  };
  impayes: BDKImpaye[];
  validation: {
    calculatedClosing: number;
    isValid: boolean;
    discrepancy: number;
  };
}

export class BDKExtractionService {
  
  /**
   * Parse un montant avec espaces (format BDK: "78 615 440")
   */
  private parseAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    
    try {
      // Nettoyer : garder seulement chiffres et espaces, puis supprimer espaces
      const cleaned = amountStr
        .toString()
        .replace(/[^\d\s]/g, '') // Garder chiffres et espaces
        .replace(/\s+/g, ''); // Supprimer tous les espaces
      
      const result = parseInt(cleaned, 10) || 0;
      console.log(`💰 Montant parsé: "${amountStr}" -> ${result.toLocaleString()}`);
      return result;
    } catch (error) {
      console.error('❌ Erreur parsing montant:', amountStr, error);
      return 0;
    }
  }

  /**
   * Extrait le solde d'ouverture
   */
  private extractOpeningBalance(textContent: string): BDKOpeningBalance {
    console.log('🔍 Extraction solde d\'ouverture BDK...');
    
    // Pattern: OPENING BALANCE 24/06/2025   78 615 440
    const openingPattern = /OPENING\s+BALANCE\s+(\d{2}\/\d{2}\/\d{4})\s+([\d\s]+)/i;
    const match = textContent.match(openingPattern);
    
    if (match) {
      const result = {
        date: match[1],
        amount: this.parseAmount(match[2])
      };
      console.log(`✅ Solde d'ouverture: ${result.date} - ${result.amount.toLocaleString()} FCFA`);
      return result;
    }
    
    console.log('❌ Solde d\'ouverture non trouvé');
    return { date: '', amount: 0 };
  }

  /**
   * Extrait les dépôts à partir d'une longue ligne concaténée
   */
  private extractDeposits(textContent: string): { deposits: BDKDeposit[], total: number } {
    console.log('🔍 Extraction dépôts non crédités BDK...');
    
    const deposits: BDKDeposit[] = [];
    let totalDeposits = 0;
    
    // Chercher le total des dépôts d'abord
    const totalDepositMatch = textContent.match(/TOTAL\s+DEPOSIT\s+([\d\s]+)/i);
    if (totalDepositMatch) {
      totalDeposits = this.parseAmount(totalDepositMatch[1]);
      console.log(`✅ Total dépôts trouvé: ${totalDeposits.toLocaleString()} FCFA`);
    }
    
    // Extraire la section des dépôts entre "ADD : DEPOSIT NOT YET CLEARED" et "TOTAL DEPOSIT"
    const depositSectionMatch = textContent.match(/ADD\s*:\s*DEPOSIT\s+NOT\s+YET\s+CLEARED\s+(.*?)\s+TOTAL\s+DEPOSIT/si);
    
    if (depositSectionMatch) {
      const depositSection = depositSectionMatch[1];
      console.log(`📝 Section dépôts extraite (${depositSection.length} caractères)`);
      
      // Pattern pour chaque dépôt: Date1 Date2 Description Vendor Client Montant
      // 19/06/2025   18/08/2025   REGLEMENT FACTURE   ECOBANK   UNITED SOLAR   3 000 000
      const depositPattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Z\s]+?)\s+([A-Z\s]+?)\s+([A-Z\s]+?)\s+([\d\s]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|$)/g;
      
      let match;
      while ((match = depositPattern.exec(depositSection)) !== null) {
        const deposit: BDKDeposit = {
          dateOperation: match[1].trim(),
          dateValeur: match[2].trim(),
          description: match[3].trim(),
          vendor: match[4].trim(),
          client: match[5].trim(),
          amount: this.parseAmount(match[6])
        };
        
        if (deposit.amount > 0) {
          deposits.push(deposit);
          console.log(`✅ Dépôt: ${deposit.dateOperation} - ${deposit.client} - ${deposit.amount.toLocaleString()} FCFA`);
        }
      }
      
      // Si pas de match avec le pattern complexe, essayer une approche plus simple
      if (deposits.length === 0) {
        console.log('🔄 Tentative avec pattern simplifié...');
        const lines = depositSection.split(/\s+/);
        
        // Identifier les indices des dates (format DD/MM/YYYY)
        const dateIndices: number[] = [];
        lines.forEach((item, index) => {
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(item)) {
            dateIndices.push(index);
          }
        });
        
        console.log(`📍 ${dateIndices.length} dates trouvées dans la section dépôts`);
        
        // Traiter chaque groupe entre deux dates
        for (let i = 0; i < dateIndices.length - 1; i += 2) {
          const startIdx = dateIndices[i];
          const endIdx = dateIndices[i + 2] || lines.length;
          
          if (startIdx + 1 < dateIndices.length && dateIndices[startIdx + 1] === startIdx + 1) {
            // Nous avons deux dates consécutives
            const dateOp = lines[startIdx];
            const dateVal = lines[startIdx + 1];
            
            // Chercher le montant (dernier élément numérique avant la prochaine date)
            let amount = 0;
            let amountIdx = -1;
            
            for (let j = endIdx - 1; j > startIdx + 1; j--) {
              const parsed = this.parseAmount(lines[j]);
              if (parsed > 1000) { // Seuil minimum pour un montant valide
                amount = parsed;
                amountIdx = j;
                break;
              }
            }
            
            if (amount > 0 && amountIdx > startIdx + 1) {
              // Extraire description, vendor, client
              const middleParts = lines.slice(startIdx + 2, amountIdx);
              const description = middleParts.slice(0, Math.floor(middleParts.length / 3)).join(' ');
              const vendor = middleParts.slice(Math.floor(middleParts.length / 3), Math.floor(2 * middleParts.length / 3)).join(' ');
              const client = middleParts.slice(Math.floor(2 * middleParts.length / 3)).join(' ');
              
              const deposit: BDKDeposit = {
                dateOperation: dateOp,
                dateValeur: dateVal,
                description: description || 'N/A',
                vendor: vendor || 'N/A',
                client: client || 'N/A',
                amount: amount
              };
              
              deposits.push(deposit);
              console.log(`✅ Dépôt (méthode 2): ${deposit.dateOperation} - ${deposit.client} - ${deposit.amount.toLocaleString()} FCFA`);
            }
          }
        }
      }
    }
    
    console.log(`✅ ${deposits.length} dépôts extraits, Total déclaré: ${totalDeposits.toLocaleString()} FCFA`);
    return { deposits, total: totalDeposits };
  }

  /**
   * Extrait les chèques à partir de la section LESS : CHECK Not yet cleared
   */
  private extractChecks(textContent: string): { checks: BDKCheck[], total: number } {
    console.log('🔍 Extraction chèques non débités BDK...');
    
    const checks: BDKCheck[] = [];
    let totalChecks = 0;
    
    // Chercher le total des chèques
    const totalCheckMatch = textContent.match(/TOTAL\s+\(B\)\s+([\d\s]+)/i);
    if (totalCheckMatch) {
      totalChecks = this.parseAmount(totalCheckMatch[1]);
      console.log(`✅ Total chèques trouvé: ${totalChecks.toLocaleString()} FCFA`);
    }
    
    // Extraire la section des chèques entre "LESS : CHECK Not yet cleared" et "TOTAL (B)"
    const checkSectionMatch = textContent.match(/LESS\s*:\s*CHECK\s+Not\s+yet\s+cleared\s+(.*?)\s+TOTAL\s+\(B\)/si);
    
    if (checkSectionMatch) {
      const checkSection = checkSectionMatch[1];
      console.log(`📝 Section chèques extraite (${checkSection.length} caractères)`);
      
      // Split en mots et chercher les patterns de chèques
      const words = checkSection.split(/\s+/);
      
      // Identifier les dates pour structurer les chèques
      const dateIndices: number[] = [];
      words.forEach((word, index) => {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(word)) {
          dateIndices.push(index);
        }
      });
      
      console.log(`📍 ${dateIndices.length} dates trouvées dans la section chèques`);
      
      // Traiter chaque groupe commençant par une date
      for (let i = 0; i < dateIndices.length; i++) {
        const startIdx = dateIndices[i];
        const endIdx = dateIndices[i + 1] || words.length;
        
        if (endIdx - startIdx >= 3) { // Au minimum: date, numéro, description
          const date = words[startIdx];
          const checkNumber = words[startIdx + 1];
          
          // Extraire tous les éléments entre la date et la fin du groupe
          const groupWords = words.slice(startIdx + 2, endIdx);
          console.log(`🔍 Groupe chèque ${checkNumber}: [${groupWords.join(' | ')}]`);
          
          // Chercher la colonne AMOUNT - reconstituée à partir des nombres dispersés
          let amount = 0;
          let description = '';
          
          // Identifier tous les éléments numériques dans le groupe
          const numericElements: number[] = [];
          const nonNumericElements: string[] = [];
          
          groupWords.forEach(word => {
            const parsed = this.parseAmount(word);
            if (parsed > 0) {
              numericElements.push(parsed);
            } else if (word.toLowerCase() !== 'fcfa' && word.toLowerCase() !== 'cfa') {
              nonNumericElements.push(word);
            }
          });
          
          // Si on a des éléments numériques, essayer de reconstituer le montant
          if (numericElements.length > 0) {
            if (numericElements.length === 1) {
              // Un seul montant trouvé
              amount = numericElements[0];
            } else {
              // Plusieurs nombres - essayer de les concaténer intelligemment
              // Pattern: "45 053" + "436" = 45053436
              // Pattern: "100334" + "71" = 10033471 (but should be 71176)
              
              // Stratégie 1: Concaténer tous les nombres
              const concatenated = numericElements.join('');
              amount = parseInt(concatenated);
              
              // Stratégie 2: Si le dernier nombre est plus petit, il peut être le montant principal
              if (numericElements.length === 2) {
                const [first, second] = numericElements;
                
                // Si le deuxième nombre a moins de 4 chiffres et le premier plus de 4,
                // le vrai montant pourrait être "second + first"
                if (second < 10000 && first > 10000) {
                  const alternative = parseInt(second.toString() + first.toString());
                  console.log(`🔍 Montant alternatif possible: ${alternative.toLocaleString()} FCFA (${second} + ${first})`);
                  
                  // Pour les cas comme "100334 71" -> 71176, on prend la version alternative
                  if (first.toString().length >= 6) {
                    amount = alternative;
                  }
                }
              }
              
              console.log(`🔢 Éléments numériques: [${numericElements.join(', ')}] -> ${amount.toLocaleString()} FCFA`);
            }
          }
          
          // La description est constituée des éléments non-numériques
          description = nonNumericElements.join(' ').trim() || 'N/A';
          
          // Si aucun montant trouvé (colonne AMOUNT vide), le montant est 0
          if (amount === 0) {
            console.log(`⚠️ Aucun montant trouvé pour le chèque ${checkNumber} - colonne AMOUNT probablement vide`);
          }
          
          const check: BDKCheck = {
            date: date,
            checkNumber: checkNumber,
            description: description,
            amount: amount
          };
          
          checks.push(check);
          console.log(`✅ Chèque: ${check.date} - ${check.checkNumber} - ${check.amount.toLocaleString()} FCFA - "${check.description}"`);
        }
      }
    }
    
    console.log(`✅ ${checks.length} chèques extraits, Total déclaré: ${totalChecks.toLocaleString()} FCFA`);
    return { checks, total: totalChecks };
  }

  /**
   * Extrait le solde de clôture - CORRECTION DU BUG
   */
  private extractClosingBalance(textContent: string): number {
    console.log('🔍 Extraction solde de clôture BDK...');
    
    // Pattern corrigé : prendre seulement les chiffres et espaces, sans les caractères suivants
    const closingPattern = /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)\s+([\d\s]+)/i;
    const match = textContent.match(closingPattern);
    
    if (match) {
      // Nettoyer le montant - prendre seulement les chiffres et espaces, ignorer le reste
      const rawAmount = match[1];
      // Séparer au premier caractère non-numérique/non-espace
      const cleanAmount = rawAmount.split(/[^\d\s]/)[0].trim();
      
      const amount = this.parseAmount(cleanAmount);
      if (amount > 0) {
        console.log(`✅ Solde de clôture: ${amount.toLocaleString()} FCFA (raw: "${rawAmount}", clean: "${cleanAmount}")`);
        return amount;
      }
    }
    
    console.log('❌ Solde de clôture non trouvé');
    return 0;
  }

  /**
   * Fonction principale d'extraction et validation
   */
  public extractBDKData(textContent: string): BDKParsedData {
    console.log('🏦 Début extraction complète BDK');
    console.log(`📄 Taille du contenu: ${textContent.length} caractères`);
    
    try {
      // Extraire la date du rapport
      const dateMatch = textContent.match(/(\d{2}\/\d{2}\/\d{4})\s+BDK/);
      const reportDate = dateMatch?.[1] || new Date().toLocaleDateString('fr-FR');
      
      // Extraction de toutes les sections
      const openingBalance = this.extractOpeningBalance(textContent);
      const { deposits, total: totalDeposits } = this.extractDeposits(textContent);
      const { checks, total: totalChecks } = this.extractChecks(textContent);
      const closingBalance = this.extractClosingBalance(textContent);
      const { facilities, totals: totalFacilities } = this.extractFacilities(textContent);
      const impayes = this.extractImpayes(textContent);
      
      // Calcul du solde total A (Opening + Deposits)
      const totalBalanceA = openingBalance.amount + totalDeposits;
      
      // Validation mathématique
      const calculatedClosing = totalBalanceA - totalChecks;
      const isValid = Math.abs(calculatedClosing - closingBalance) < 1000; // Tolérance de 1000 FCFA
      const discrepancy = calculatedClosing - closingBalance;
      
      const result: BDKParsedData = {
        reportDate,
        openingBalance,
        deposits,
        totalDeposits,
        totalBalanceA,
        checks,
        totalChecks,
        closingBalance,
        facilities,
        totalFacilities,
        impayes,
        validation: {
          calculatedClosing,
          isValid,
          discrepancy
        }
      };
      
      console.log('✅ Extraction BDK terminée avec succès');
      console.log(`📊 Validation: ${isValid ? '✅ VALIDE' : '❌ ERREUR'} (Écart: ${discrepancy.toLocaleString()} FCFA)`);
      console.log(`📈 Résumé: ${deposits.length} dépôts, ${checks.length} chèques, ${facilities.length} facilités, ${impayes.length} impayés`);
      console.log(`🧮 Calcul: ${openingBalance.amount.toLocaleString()} + ${totalDeposits.toLocaleString()} - ${totalChecks.toLocaleString()} = ${calculatedClosing.toLocaleString()} (déclaré: ${closingBalance.toLocaleString()})`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'extraction BDK:', error);
      throw error;
    }
  }

  /**
   * Extrait les facilités bancaires
   */
  private extractFacilities(textContent: string): { facilities: BDKFacility[], totals: any } {
    console.log('🔍 Extraction facilités bancaires BDK...');
    
    const facilities: BDKFacility[] = [];
    const lines = textContent.split('\n');
    
    let inFacilitiesSection = false;
    let totalLimit = 0, totalUsed = 0, totalBalance = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/BANK\s+FACILITY/i) && line.includes('Limit') && line.includes('Used')) {
        inFacilitiesSection = true;
        console.log('✅ Section facilités trouvée');
        continue;
      }
      
      // Ligne de totaux
      if (inFacilitiesSection && line.match(/^[\d\s]+\s+[\d\s]+\s+[\d\s]+$/)) {
        const parts = line.split(/\s+/).filter(p => p.length > 0);
        if (parts.length === 3) {
          totalLimit = this.parseAmount(parts[0]);
          totalUsed = this.parseAmount(parts[1]);
          totalBalance = this.parseAmount(parts[2]);
          console.log(`✅ Totaux facilités: Limite ${totalLimit.toLocaleString()}, Utilisé ${totalUsed.toLocaleString()}`);
          break;
        }
      }
      
      // Parser les lignes de facilités
      if (inFacilitiesSection && line.length > 10) {
        // Pattern: 27/06/2025   SPN   25 000 000   12 901 283   12 098 717
        const facilityPattern = /(?:(\d{2}\/\d{2}\/\d{4})\s+)?([A-Z\s]+?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)$/;
        const match = line.match(facilityPattern);
        
        if (match) {
          const facility: BDKFacility = {
            name: match[2].trim(),
            dateEcheance: match[1] || undefined,
            limit: this.parseAmount(match[3]),
            used: this.parseAmount(match[4]),
            balance: this.parseAmount(match[5])
          };
          
          if (facility.limit > 0 || facility.used > 0) {
            facilities.push(facility);
            console.log(`✅ Facilité: ${facility.name} - Limite ${facility.limit.toLocaleString()}`);
          }
        }
      }
    }
    
    console.log(`✅ ${facilities.length} facilités extraites`);
    return {
      facilities,
      totals: { totalLimit, totalUsed, totalBalance }
    };
  }

  /**
   * Extrait les impayés
   */
  private extractImpayes(textContent: string): BDKImpaye[] {
    console.log('🔍 Extraction impayés BDK...');
    
    const impayes: BDKImpaye[] = [];
    const lines = textContent.split('\n');
    
    let inImpayesSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/IMPAYE/i) && !line.match(/REGUL\s+IMPAYE/i)) {
        inImpayesSection = true;
        console.log('✅ Section impayés trouvée');
      }
      
      // Parser les lignes d'impayés
      if (inImpayesSection && line.length > 20) {
        // Pattern: 22/04/2025   3361178   IMPAYE   CORIS   CHAFIC AZAR & Cie   REGUL IMPAYE + FRAIS   2 000 000
        const impayePattern = /(\d{2}\/\d{2}\/\d{4})\s+([\d]+)\s+(IMPAYE)\s+([A-Z]+)\s+([A-Z\s&]+?)\s+([A-Z\s+]+?)\s+([\d\s]+)$/;
        const match = line.match(impayePattern);
        
        if (match) {
          const impaye: BDKImpaye = {
            date: match[1],
            reference: match[2],
            type: match[3],
            bank: match[4],
            client: match[5].trim(),
            description: match[6].trim(),
            amount: this.parseAmount(match[7])
          };
          
          impayes.push(impaye);
          console.log(`✅ Impayé: ${impaye.client} - ${impaye.amount.toLocaleString()} FCFA`);
        }
      }
    }
    
    console.log(`✅ ${impayes.length} impayés extraits`);
    return impayes;
  }
}

export const bdkExtractionService = new BDKExtractionService();
