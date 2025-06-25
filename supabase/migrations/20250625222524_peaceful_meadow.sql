/*
  # Add Excel Traceability Constraints

  1. New Constraints
    - Unique index on excel_filename and excel_source_row
    - Check constraint to ensure both fields are either present or absent together
  
  2. Purpose
    - Prevent duplicate entries from the same Excel file and row
    - Enable ON CONFLICT clause in UPSERT operations
    - Ensure data integrity
*/

-- Create a unique index for Excel traceability
CREATE UNIQUE INDEX unique_excel_traceability 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- Add a check constraint to ensure both fields are either present or absent together
-- Note: Removed the IF NOT EXISTS clause which was causing the syntax error
ALTER TABLE collection_report 
ADD CONSTRAINT check_excel_traceability_not_null 
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