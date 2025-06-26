/*
  # Fix upsert constraint for collection_report

  1. Database Changes
    - Add proper unique constraint for excel_filename and excel_source_row combination
    - This will allow the upsert operation to work correctly in the intelligent sync service

  2. Security
    - No changes to existing RLS policies
    - Maintains data integrity with proper constraints
*/

-- Add unique constraint for upsert operations
-- This constraint allows the upsert operation to work with excel_filename and excel_source_row
ALTER TABLE collection_report 
ADD CONSTRAINT unique_excel_upsert 
UNIQUE (excel_filename, excel_source_row) 
DEFERRABLE INITIALLY DEFERRED;

-- Add partial unique constraint to handle NULL values properly
-- This ensures we can still insert records without excel tracking
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_upsert_partial
ON collection_report (excel_filename, excel_source_row)
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;