/*
  # Fix Collection Report Constraints and Indexes

  1. Changes
     - Drops and recreates the unique index for Excel traceability
     - Ensures the constraint is only created if it doesn't exist
  
  2. Purpose
     - Fixes issues with duplicate constraints
     - Maintains data integrity for Excel imports
*/

-- First drop the constraint that depends on the index
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_excel_upsert_fixed' AND conrelid = 'collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report DROP CONSTRAINT unique_excel_upsert_fixed;
  END IF;
END $$;

-- Now we can safely drop the index
DROP INDEX IF EXISTS unique_excel_upsert_fixed;

-- Create a new unique index with a different name to avoid conflicts
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_upsert_constraint ON public.collection_report (excel_filename, excel_source_row) 
WHERE (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL);

-- Create a constraint that uses the index, but only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_excel_traceability_not_null' AND conrelid = 'collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report 
    ADD CONSTRAINT check_excel_traceability_not_null
    CHECK ((excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) OR (excel_filename IS NULL AND excel_source_row IS NULL));
  END IF;
END $$;