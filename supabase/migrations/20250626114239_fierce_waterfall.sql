/*
  # Ajout de la logique métier pour effets et chèques

  1. Nouvelles Colonnes
    - `collection_type` (text) - Type de collection ('EFFET' ou 'CHEQUE')
    - `effet_echeance_date` (date) - Date d'échéance pour les effets
    - `effet_status` (text) - Statut des effets ('PENDING', 'PAID', 'IMPAYE')
    - `cheque_number` (text) - Numéro de chèque
    - `cheque_status` (text) - Statut des chèques ('PENDING', 'CLEARED', 'BOUNCED')
  
  2. Index
    - Index sur le type de collection
    - Index sur la date d'échéance des effets
    - Index sur le numéro de chèque
    - Index sur les statuts
*/

-- Ajout des nouvelles colonnes pour la logique métier effet/chèque
DO $$ 
BEGIN
  -- Colonne pour le type de collection
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'collection_report' AND column_name = 'collection_type') THEN
    ALTER TABLE collection_report ADD COLUMN collection_type text;
  END IF;

  -- Colonnes spécifiques aux effets
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'collection_report' AND column_name = 'effet_echeance_date') THEN
    ALTER TABLE collection_report ADD COLUMN effet_echeance_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'collection_report' AND column_name = 'effet_status') THEN
    ALTER TABLE collection_report ADD COLUMN effet_status text;
  END IF;

  -- Colonnes spécifiques aux chèques
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'collection_report' AND column_name = 'cheque_number') THEN
    ALTER TABLE collection_report ADD COLUMN cheque_number text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'collection_report' AND column_name = 'cheque_status') THEN
    ALTER TABLE collection_report ADD COLUMN cheque_status text;
  END IF;
END $$;

-- Création des index pour optimiser les requêtes
DO $$ 
BEGIN
  -- Index sur le type de collection
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_collection_type') THEN
    CREATE INDEX idx_collection_type ON collection_report(collection_type);
  END IF;

  -- Index sur la date d'échéance des effets (avec condition)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_effet_echeance_date') THEN
    CREATE INDEX idx_effet_echeance_date ON collection_report(effet_echeance_date) 
    WHERE collection_type = 'EFFET';
  END IF;

  -- Index sur le numéro de chèque (avec condition)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cheque_number') THEN
    CREATE INDEX idx_cheque_number ON collection_report(cheque_number) 
    WHERE collection_type = 'CHEQUE';
  END IF;

  -- Index sur le statut des effets
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_effet_status') THEN
    CREATE INDEX idx_effet_status ON collection_report(effet_status) 
    WHERE collection_type = 'EFFET';
  END IF;

  -- Index sur le statut des chèques
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cheque_status') THEN
    CREATE INDEX idx_cheque_status ON collection_report(cheque_status) 
    WHERE collection_type = 'CHEQUE';
  END IF;
END $$;

-- Fonction pour détecter automatiquement le type de collection
CREATE OR REPLACE FUNCTION detect_collection_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Si no_chq_bd est une date (format YYYY-MM-DD), c'est un effet
  IF NEW.no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' OR NEW.no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN
    NEW.collection_type := 'EFFET';
    
    -- Convertir la date au format ISO si nécessaire
    IF NEW.no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN
      NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'DD/MM/YYYY');
    ELSE
      NEW.effet_echeance_date := NEW.no_chq_bd::date;
    END IF;
    
    NEW.effet_status := 'PENDING';
    NEW.cheque_number := NULL;
    NEW.cheque_status := NULL;
  
  -- Si no_chq_bd est un nombre, c'est un chèque
  ELSIF NEW.no_chq_bd ~ '^\d+$' THEN
    NEW.collection_type := 'CHEQUE';
    NEW.cheque_number := NEW.no_chq_bd;
    NEW.cheque_status := 'PENDING';
    NEW.effet_echeance_date := NULL;
    NEW.effet_status := NULL;
  
  -- Sinon, on ne peut pas déterminer
  ELSE
    NEW.collection_type := 'UNKNOWN';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour la détection automatique
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_detect_collection_type') THEN
    CREATE TRIGGER trg_detect_collection_type
    BEFORE INSERT OR UPDATE OF no_chq_bd ON collection_report
    FOR EACH ROW
    EXECUTE FUNCTION detect_collection_type();
  END IF;
END $$;

-- Mettre à jour les données existantes
UPDATE collection_report
SET 
  collection_type = 
    CASE 
      WHEN no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' OR no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN 'EFFET'
      WHEN no_chq_bd ~ '^\d+$' THEN 'CHEQUE'
      ELSE 'UNKNOWN'
    END,
  effet_echeance_date = 
    CASE 
      WHEN no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' THEN no_chq_bd::date
      WHEN no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(no_chq_bd, 'DD/MM/YYYY')
      ELSE NULL
    END,
  effet_status = 
    CASE 
      WHEN (no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' OR no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$') THEN 
        CASE 
          WHEN date_of_validity IS NOT NULL THEN 'PAID'
          WHEN date_of_impay IS NOT NULL THEN 'IMPAYE'
          ELSE 'PENDING'
        END
      ELSE NULL
    END,
  cheque_number = 
    CASE 
      WHEN no_chq_bd ~ '^\d+$' THEN no_chq_bd
      ELSE NULL
    END,
  cheque_status = 
    CASE 
      WHEN no_chq_bd ~ '^\d+$' THEN 
        CASE 
          WHEN date_of_validity IS NOT NULL THEN 'CLEARED'
          WHEN date_of_impay IS NOT NULL THEN 'BOUNCED'
          ELSE 'PENDING'
        END
      ELSE NULL
    END
WHERE no_chq_bd IS NOT NULL;

-- Commentaires sur les nouvelles colonnes
COMMENT ON COLUMN collection_report.collection_type IS 'Type de collection: EFFET, CHEQUE ou UNKNOWN';
COMMENT ON COLUMN collection_report.effet_echeance_date IS 'Date d''échéance pour les effets à l''escompte';
COMMENT ON COLUMN collection_report.effet_status IS 'Statut des effets: PENDING, PAID ou IMPAYE';
COMMENT ON COLUMN collection_report.cheque_number IS 'Numéro de chèque pour les collections de type CHEQUE';
COMMENT ON COLUMN collection_report.cheque_status IS 'Statut des chèques: PENDING, CLEARED ou BOUNCED';