/*
  # Fix Excel traceability constraints
  
  1. Changes
    - Adds a check constraint to ensure excel_filename and excel_source_row are either both present or both absent
    - Skips creating the unique index since it already exists
*/

-- Check if the unique index already exists and skip creation if it does
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_excel_traceability'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX unique_excel_traceability 
             ON collection_report (excel_filename, excel_source_row) 
             WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL';
    RAISE NOTICE 'Created unique_excel_traceability index';
  ELSE
    RAISE NOTICE 'unique_excel_traceability index already exists, skipping creation';
  END IF;
END $$;

-- Check if the constraint already exists and skip creation if it does
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_excel_traceability_not_null'
  ) THEN
    ALTER TABLE collection_report 
    ADD CONSTRAINT check_excel_traceability_not_null 
    CHECK (
      (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) 
      OR 
      (excel_filename IS NULL AND excel_source_row IS NULL)
    );
    RAISE NOTICE 'Added check_excel_traceability_not_null constraint';
  ELSE
    RAISE NOTICE 'check_excel_traceability_not_null constraint already exists, skipping creation';
  END IF;
END $$;

-- Verify the constraints were processed
DO $$
BEGIN
  RAISE NOTICE 'Excel traceability constraints processing completed';
END $$;