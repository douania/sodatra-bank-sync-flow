/*
  # Fix Client Names in Reconciliation

  1. Changes
    - Add function to extract clean client names from impaye descriptions
    - Add trigger to automatically update client names in client_reconciliation table
    - Add index on client_code for faster lookups

  2. Security
    - No security changes
*/

-- Function to extract clean client names from descriptions
CREATE OR REPLACE FUNCTION extract_clean_client_name(description TEXT, client_code TEXT)
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

-- Add index on client_code for faster lookups
CREATE INDEX IF NOT EXISTS idx_impayes_client_code ON impayes(client_code);
CREATE INDEX IF NOT EXISTS idx_client_reconciliation_client_code ON client_reconciliation(client_code);

-- Add function to update client names in client_reconciliation
CREATE OR REPLACE FUNCTION update_client_reconciliation_names()
RETURNS TRIGGER AS $$
BEGIN
  -- Update client_name in client_reconciliation based on impaye description
  UPDATE client_reconciliation
  SET client_name = extract_clean_client_name(NEW.description, NEW.client_code)
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