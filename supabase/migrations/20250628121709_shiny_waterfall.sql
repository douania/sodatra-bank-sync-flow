/*
  # Fix Client Names and Add Collection Type Detection

  1. New Functions
    - `detect_collection_type()`: Automatically detects if a collection is an EFFET or CHEQUE
    - `clean_client_name()`: Cleans client names by removing common keywords and formatting

  2. Triggers
    - Adds trigger to detect collection type when no_chq_bd is updated
    - Adds trigger to update client names in client_reconciliation

  3. Constraints
    - Adds unique constraint for excel traceability (if not exists)
    - Adds generated column for unique excel traceability (if not exists)
*/

-- Function to detect collection type (EFFET or CHEQUE) based on no_chq_bd value
CREATE OR REPLACE FUNCTION detect_collection_type()
RETURNS TRIGGER AS $$
DECLARE
  is_date BOOLEAN;
  is_number BOOLEAN;
BEGIN
  -- Skip if collection_type is already set
  IF NEW.collection_type IS NOT NULL AND NEW.collection_type != 'UNKNOWN' THEN
    RETURN NEW;
  END IF;
  
  -- Skip if no_chq_bd is NULL
  IF NEW.no_chq_bd IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Check if it's a date (for EFFET)
  is_date := NEW.no_chq_bd ~ '^\d{2}[/\-]\d{2}[/\-]\d{4}$' OR 
             NEW.no_chq_bd ~ '^\d{4}[/\-]\d{2}[/\-]\d{2}$';
             
  -- Check if it's a number (for CHEQUE)
  is_number := NEW.no_chq_bd ~ '^\d+$';
  
  IF is_date THEN
    -- It's an EFFET
    NEW.collection_type := 'EFFET';
    
    -- Try to extract the date for effet_echeance_date
    BEGIN
      -- Handle different date formats
      IF NEW.no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN
        -- DD/MM/YYYY format
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'DD/MM/YYYY');
      ELSIF NEW.no_chq_bd ~ '^\d{2}-\d{2}-\d{4}$' THEN
        -- DD-MM-YYYY format
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'DD-MM-YYYY');
      ELSIF NEW.no_chq_bd ~ '^\d{4}/\d{2}/\d{2}$' THEN
        -- YYYY/MM/DD format
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'YYYY/MM/DD');
      ELSIF NEW.no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' THEN
        -- YYYY-MM-DD format
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'YYYY-MM-DD');
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        -- If date parsing fails, don't set the date
        NULL;
    END;
    
    -- Set default effet status if not set
    IF NEW.effet_status IS NULL THEN
      NEW.effet_status := 'PENDING';
    END IF;
    
  ELSIF is_number THEN
    -- It's a CHEQUE
    NEW.collection_type := 'CHEQUE';
    NEW.cheque_number := NEW.no_chq_bd;
    
    -- Set default cheque status if not set
    IF NEW.cheque_status IS NULL THEN
      NEW.cheque_status := 'PENDING';
    END IF;
  ELSE
    -- Unknown type
    NEW.collection_type := 'UNKNOWN';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to clean client names from descriptions
CREATE OR REPLACE FUNCTION clean_client_name(description TEXT, client_code TEXT)
RETURNS TEXT AS $$
DECLARE
  clean_name TEXT;
BEGIN
  -- Return default if description is empty
  IF description IS NULL OR TRIM(description) = '' THEN
    RETURN 'Client ' || client_code;
  END IF;

  -- Clean the description
  clean_name := TRIM(description);
  
  -- Remove common keywords
  clean_name := REGEXP_REPLACE(clean_name, '\b(EFFET|IMPAYE|CHEQUE|IMPAYÉ|BOUNCED|RETURNED|CHQ|FACTURE|INVOICE)\b', '', 'gi');
  
  -- Remove bank codes
  clean_name := REGEXP_REPLACE(clean_name, '\b(BDK|ATB|BICIS|ORA|SGBS|SGS|BIS)\b', '', 'g');
  
  -- Remove dates and numbers
  clean_name := REGEXP_REPLACE(clean_name, '\d{2}/\d{2}/\d{4}', '', 'g');
  clean_name := REGEXP_REPLACE(clean_name, '\b\d+\b', '', 'g');
  
  -- Clean up special characters and multiple spaces
  clean_name := REGEXP_REPLACE(clean_name, '[^\w\s]', ' ', 'g');
  clean_name := REGEXP_REPLACE(clean_name, '\s+', ' ', 'g');
  clean_name := TRIM(clean_name);
  
  -- If nothing meaningful remains, use client code
  IF LENGTH(clean_name) < 3 THEN
    RETURN 'Client ' || client_code;
  END IF;
  
  RETURN clean_name;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to detect collection type when no_chq_bd is updated
DROP TRIGGER IF EXISTS trg_detect_collection_type ON collection_report;
CREATE TRIGGER trg_detect_collection_type
BEFORE INSERT OR UPDATE OF no_chq_bd ON collection_report
FOR EACH ROW
EXECUTE FUNCTION detect_collection_type();

-- Check if constraint exists before adding it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_excel_traceability_not_null' 
    AND conrelid = 'collection_report'::regclass
  ) THEN
    ALTER TABLE collection_report
    ADD CONSTRAINT check_excel_traceability_not_null
    CHECK (
      ((excel_filename IS NOT NULL) AND (excel_source_row IS NOT NULL)) OR
      ((excel_filename IS NULL) AND (excel_source_row IS NULL))
    );
  END IF;
END $$;

-- Add unique excel traceability column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute 
    WHERE attrelid = 'collection_report'::regclass 
    AND attname = 'unique_excel_traceability' 
    AND NOT attisdropped
  ) THEN
    ALTER TABLE collection_report
    ADD COLUMN unique_excel_traceability TEXT GENERATED ALWAYS AS (
      CASE 
        WHEN excel_filename IS NOT NULL AND excel_source_row IS NOT NULL 
        THEN excel_filename || '_' || excel_source_row::text
        ELSE NULL
      END
    ) STORED;
  END IF;
END $$;

-- Add unique constraint for excel traceability if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_excel_traceability'
  ) THEN
    CREATE UNIQUE INDEX unique_excel_traceability
    ON collection_report (unique_excel_traceability)
    WHERE unique_excel_traceability IS NOT NULL;
  END IF;
END $$;

-- Add function to update client names in client_reconciliation
CREATE OR REPLACE FUNCTION update_client_reconciliation_names()
RETURNS TRIGGER AS $$
BEGIN
  -- Update client_name in client_reconciliation based on impaye description
  UPDATE client_reconciliation
  SET client_name = clean_client_name(NEW.description, NEW.client_code)
  WHERE client_code = NEW.client_code;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update client names
DROP TRIGGER IF EXISTS trg_update_client_names ON impayes;
CREATE TRIGGER trg_update_client_names
AFTER INSERT OR UPDATE OF description ON impayes
FOR EACH ROW
EXECUTE FUNCTION update_client_reconciliation_names();