/*
  # Fix unique constraint for excel traceability

  1. Changes
    - Drop the existing deferrable constraint that's causing issues with upsert
    - Create a new non-deferrable unique index for excel traceability
*/

-- First drop the constraint that depends on the index
ALTER TABLE public.collection_report DROP CONSTRAINT IF EXISTS unique_excel_upsert;

-- Now we can safely drop the index
DROP INDEX IF EXISTS unique_excel_upsert;

-- Create a new non-deferrable unique index for excel traceability
-- Using CREATE UNIQUE INDEX instead of ALTER TABLE ADD CONSTRAINT with WHERE clause
CREATE UNIQUE INDEX unique_excel_upsert_fixed 
ON public.collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;