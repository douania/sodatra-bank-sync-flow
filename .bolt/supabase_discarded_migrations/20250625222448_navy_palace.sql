/*
  # Add Excel Traceability Constraint

  1. New Constraints
    - `unique_excel_traceability`: Unique index on (excel_filename, excel_source_row) to prevent duplicates
    - `check_excel_traceability_not_null`: Check constraint to ensure both fields are either present or absent together
  
  2. Purpose
    - Enables UPSERT operations with ON CONFLICT clause
    - Prevents duplicate imports of the same Excel row
    - Maintains data integrity for Excel traceability
*/

-- Create a unique index for Excel traceability
CREATE UNIQUE INDEX IF NOT EXISTS unique_excel_traceability 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- Add a check constraint to ensure both fields are either present or absent together
ALTER TABLE collection_report 
ADD CONSTRAINT IF NOT EXISTS check_excel_traceability_not_null 
CHECK (
  (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) 
  OR 
  (excel_filename IS NULL AND excel_source_row IS NULL)
);

-- Verify the constraints were created
DO $$
BEGIN
  RAISE NOTICE 'Excel traceability constraints added successfully';
END $$;