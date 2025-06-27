/*
  # Fix unique index for excel traceability
  
  1. Changes
    - Drops existing constraint if it exists
    - Drops existing index if it exists
    - Creates a new unique index with a different name to avoid conflicts
    - Creates a constraint that uses the new index
*/

-- First drop the constraint that depends on the index
ALTER TABLE public.collection_report DROP CONSTRAINT IF EXISTS unique_excel_upsert_fixed;

-- Now we can safely drop the index
DROP INDEX IF EXISTS unique_excel_upsert_fixed;

-- Create a new unique index with a different name to avoid conflicts
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_upsert_constraint ON public.collection_report (excel_filename, excel_source_row) 
WHERE (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL);

-- Create a constraint that uses the index
ALTER TABLE public.collection_report 
ADD CONSTRAINT check_excel_traceability_not_null
CHECK ((excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) OR (excel_filename IS NULL AND excel_source_row IS NULL));