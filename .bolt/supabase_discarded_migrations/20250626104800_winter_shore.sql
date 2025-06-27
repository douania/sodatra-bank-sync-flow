/*
  # Fix unique constraint for excel traceability

  1. Changes
    - Drop existing constraint that depends on the index
    - Drop existing index
    - Create a new unique index with proper partial condition syntax
    - Create a new unique constraint based on the index
*/

-- First drop the constraint that depends on the index
ALTER TABLE public.collection_report DROP CONSTRAINT IF EXISTS unique_excel_upsert;

-- Now we can safely drop the index
DROP INDEX IF EXISTS unique_excel_upsert;

-- Create a new unique index with the condition as part of the statement
CREATE UNIQUE INDEX unique_excel_upsert_fixed ON public.collection_report (excel_filename, excel_source_row) 
WHERE (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL);

-- Create a constraint that uses the index
ALTER TABLE public.collection_report 
ADD CONSTRAINT unique_excel_upsert_fixed 
UNIQUE USING INDEX unique_excel_upsert_fixed;