/*
  # Fix deferrable constraint for upsert operations
  
  1. Changes
    - Drop the existing deferrable constraint that's causing issues with upsert operations
    - Create a new non-deferrable unique constraint for excel traceability
    
  This migration fixes the issue with ON CONFLICT operations failing due to
  the constraint being defined as DEFERRABLE INITIALLY DEFERRED.
*/

-- First drop the constraint that depends on the index
ALTER TABLE public.collection_report DROP CONSTRAINT IF EXISTS unique_excel_upsert;

-- Now we can safely drop the index
DROP INDEX IF EXISTS unique_excel_upsert;

-- Create a new non-deferrable unique constraint for excel traceability
ALTER TABLE public.collection_report 
ADD CONSTRAINT unique_excel_upsert_fixed 
UNIQUE (excel_filename, excel_source_row)
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;