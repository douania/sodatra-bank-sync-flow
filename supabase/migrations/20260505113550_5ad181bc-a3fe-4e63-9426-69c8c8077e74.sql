DROP TRIGGER IF EXISTS trg_detect_collection_type ON public.collection_report;

ALTER TABLE public.collection_report
  ALTER COLUMN facture_no TYPE text,
  ALTER COLUMN no_chq_bd TYPE text,
  ALTER COLUMN bank_name_display TYPE text,
  ALTER COLUMN depo_ref TYPE text,
  ALTER COLUMN sg_or_fa_no TYPE text,
  ALTER COLUMN match_method TYPE text,
  ALTER COLUMN processing_status TYPE text;

CREATE TRIGGER trg_detect_collection_type
BEFORE INSERT OR UPDATE ON public.collection_report
FOR EACH ROW
EXECUTE FUNCTION public.detect_collection_type();