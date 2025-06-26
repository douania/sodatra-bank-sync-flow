/*
  # Fix upsert constraint for collection_report table

  1. Database Changes
    - Add unique constraint for excel_filename and excel_source_row combination
    - This enables proper upsert operations in the intelligent sync service

  2. Security
    - No changes to existing RLS policies
    - Maintains data integrity with proper constraints
*/

-- Add unique constraint for upsert operations
-- This constraint allows the upsert operation to work properly
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_upsert_constraint 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;