/*
  # Fix deferrable unique constraint for upsert operations

  1. Changes
    - Drop the existing deferrable unique constraint `unique_excel_upsert`
    - Create a new non-deferrable unique constraint for excel traceability
    - Ensure upsert operations work correctly with ON CONFLICT

  2. Security
    - Maintain data integrity with proper unique constraints
    - No changes to RLS policies needed
*/

-- Drop the existing deferrable constraint that's causing issues with upsert
DROP INDEX IF EXISTS unique_excel_upsert;

-- Create a new non-deferrable unique constraint for excel traceability
CREATE UNIQUE INDEX unique_excel_upsert_fixed 
ON public.collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;