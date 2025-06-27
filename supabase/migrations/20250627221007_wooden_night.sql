/*
  # Update client_reconciliation table

  1. Changes
    - Add trigger to automatically update client_reconciliation from impayes
    - Add function to calculate impayes amount by client
    
  2. Security
    - Maintains existing RLS policies
*/

-- Function to calculate impayes amount by client
CREATE OR REPLACE FUNCTION calculate_client_impayes()
RETURNS TRIGGER AS $$
DECLARE
  client_code_var TEXT;
  impayes_amount_var BIGINT;
  today_date DATE := CURRENT_DATE;
BEGIN
  -- For each client with impayes, calculate total amount
  FOR client_code_var, impayes_amount_var IN
    SELECT 
      i.client_code, 
      SUM(i.montant) AS total_impayes
    FROM 
      impayes i
    WHERE 
      i.client_code IS NOT NULL
    GROUP BY 
      i.client_code
  LOOP
    -- Insert or update client_reconciliation
    INSERT INTO client_reconciliation (
      id, 
      report_date, 
      client_code, 
      client_name, 
      impayes_amount, 
      created_at
    ) VALUES (
      gen_random_uuid(), 
      today_date, 
      client_code_var, 
      'Client ' || client_code_var, 
      impayes_amount_var, 
      now()
    )
    ON CONFLICT (client_code, report_date) 
    DO UPDATE SET
      impayes_amount = impayes_amount_var,
      created_at = now();
  END LOOP;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update client_reconciliation when impayes change
DROP TRIGGER IF EXISTS update_client_reconciliation ON impayes;
CREATE TRIGGER update_client_reconciliation
AFTER INSERT OR UPDATE OR DELETE ON impayes
FOR EACH STATEMENT
EXECUTE FUNCTION calculate_client_impayes();

-- Add unique constraint on client_code and report_date if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'client_reconciliation_client_code_report_date_key'
  ) THEN
    ALTER TABLE client_reconciliation 
    ADD CONSTRAINT client_reconciliation_client_code_report_date_key 
    UNIQUE (client_code, report_date);
  END IF;
END $$;

-- Run the function once to populate existing data
SELECT calculate_client_impayes();