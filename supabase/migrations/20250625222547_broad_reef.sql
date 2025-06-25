-- Check if the index already exists before creating it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_excel_traceability'
  ) THEN
    -- Create a unique index for Excel traceability
    EXECUTE 'CREATE UNIQUE INDEX unique_excel_traceability 
    ON collection_report (excel_filename, excel_source_row) 
    WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL';
    
    RAISE NOTICE 'Created unique_excel_traceability index';
  ELSE
    RAISE NOTICE 'unique_excel_traceability index already exists, skipping creation';
  END IF;
END $$;

-- Check if the constraint already exists before adding it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_excel_traceability_not_null'
  ) THEN
    -- Add a check constraint to ensure both fields are either present or absent together
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