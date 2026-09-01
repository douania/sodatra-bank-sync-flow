\set ON_ERROR_STOP on

SELECT test.assert(
  has_function_privilege(
    'authenticated',
    'public.import_collection_report_atomic_v1(uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated must execute the atomic import RPC'
);
SELECT test.assert(
  NOT has_function_privilege(
    'anon',
    'public.import_collection_report_atomic_v1(uuid,jsonb)',
    'EXECUTE'
  ),
  'anon must not execute the atomic import RPC'
);
SELECT test.assert(
  NOT has_function_privilege(
    'service_role',
    'public.import_collection_report_atomic_v1(uuid,jsonb)',
    'EXECUTE'
  ),
  'service_role must not execute the atomic import RPC'
);
SELECT test.assert(
  NOT has_schema_privilege('authenticated', 'collection_import_private', 'USAGE'),
  'authenticated must not access the private schema'
);

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT test.assert(
  public.collection_report_promotion_enabled_v1() = false,
  'initial scope must be fail-closed'
);

DO $$ BEGIN
  BEGIN
    INSERT INTO public.collection_report(
      report_date, client_code, collection_amount, bank_name,
      excel_filename, excel_source_row
    ) VALUES (
      '2026-09-01', 'DIRECT-BLOCKED', 100, 'SYNTH BANK', 'DIRECT.xlsx', 2
    );
    RAISE EXCEPTION 'TEST_FAILED: direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED' THEN RAISE; END IF;
  END;
END $$;

-- Un paramètre de session forgé ne constitue jamais une capacité d'écriture.
-- Cette régression couvre explicitement le contournement des guards basés sur
-- current_setting()/set_config().
DO $$ BEGIN
  BEGIN
    PERFORM set_config('sodatra.collection_import_authorized', 'v1', true);
    INSERT INTO public.collection_report(
      report_date, client_code, collection_amount, bank_name,
      excel_filename, excel_source_row
    ) VALUES (
      '2026-09-01', 'FORGED-GUC-BLOCKED', 100, 'SYNTH BANK', 'FORGED.xlsx', 2
    );
    RAISE EXCEPTION 'TEST_FAILED: forged GUC insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.import_collection_report_atomic_v1(
      '10000000-0000-4000-8000-000000000001',
      '[]'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAILED: empty payload unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_PAYLOAD_INVALID_OR_LIMIT_EXCEEDED' THEN RAISE; END IF;
  END;
END $$;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  BEGIN
    PERFORM public.import_collection_report_atomic_v1(
      '10000000-0000-4000-8000-000000000010',
      '[]'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAILED: plain user unexpectedly reached atomic import';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_FORBIDDEN' THEN RAISE; END IF;
  END;
END $$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
RESET ROLE;

DO $$ BEGIN
  BEGIN
    UPDATE collection_import_private.runtime_control
    SET promotion_scope_enabled = true,
        enabled_until = statement_timestamp() - interval '1 minute',
        change_reason = 'Reject synthetic expired Collection qualification window'
    WHERE singleton = true;
    RAISE EXCEPTION 'TEST_FAILED: expired scope unexpectedly opened';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_RUNTIME_CONTROL_EXPIRY_INVALID' THEN RAISE; END IF;
  END;
END $$;
SELECT test.assert(
  public.collection_report_promotion_enabled_v1() = false,
  'rejected expired scope must remain fail-closed'
);

UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = true,
    enabled_until = statement_timestamp() + interval '30 minutes',
    change_reason = 'Open synthetic atomic Collection qualification window'
WHERE singleton = true;

SET ROLE authenticated;
SELECT test.assert(
  public.collection_report_promotion_enabled_v1() = true,
  'enabled unexpired scope must be readable as true'
);

SELECT public.import_collection_report_atomic_v1(
  '10000000-0000-4000-8000-000000000002',
  '[
    {
      "report_date":"2026-09-01","client_code":"CLIENT-A","collection_amount":1000,
      "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
      "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
      "excel_filename":"COLLECTION-SYNTH.xlsx","excel_source_row":2,"date_of_validity":null,
      "facture_no":"FA-1","no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
      "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
      "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
      "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
    },
    {
      "report_date":"2026-09-01","client_code":"CLIENT-B","collection_amount":2000,
      "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
      "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
      "excel_filename":"COLLECTION-SYNTH.xlsx","excel_source_row":3,"date_of_validity":null,
      "facture_no":"FA-2","no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
      "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
      "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
      "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
    }
  ]'::jsonb
) AS result \gset first_
RESET ROLE;

SELECT test.assert((SELECT count(*) = 2 FROM public.collection_report), 'atomic import lost rows');
SELECT test.assert((:'first_result'::jsonb->>'inserted_rows')::integer = 2, 'insert count mismatch');
SELECT test.assert(
  (SELECT count(*) = 2 FROM collection_import_private.row_audit),
  'private row audit must contain one record per changed trace'
);
SELECT test.assert(
  (SELECT count(*) = 1 FROM collection_import_private.commands WHERE completed_at IS NOT NULL),
  'command ledger must contain one completed command'
);
SELECT test.assert(
  (SELECT count(*) = 0 FROM collection_import_private.write_contexts),
  'transaction write capability must be removed before RPC completion'
);

SET ROLE authenticated;
SELECT public.import_collection_report_atomic_v1(
  '10000000-0000-4000-8000-000000000002',
  '[
    {
      "report_date":"2026-09-01","client_code":"CLIENT-A","collection_amount":1000,
      "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
      "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
      "excel_filename":"COLLECTION-SYNTH.xlsx","excel_source_row":2,"date_of_validity":null,
      "facture_no":"FA-1","no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
      "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
      "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
      "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
    },
    {
      "report_date":"2026-09-01","client_code":"CLIENT-B","collection_amount":2000,
      "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
      "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
      "excel_filename":"COLLECTION-SYNTH.xlsx","excel_source_row":3,"date_of_validity":null,
      "facture_no":"FA-2","no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
      "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
      "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
      "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
    }
  ]'::jsonb
) AS result \gset replay_
RESET ROLE;
SELECT test.assert(:'replay_result'::jsonb = :'first_result'::jsonb, 'replay result changed');
SELECT test.assert((SELECT count(*) = 2 FROM public.collection_report), 'replay duplicated rows');
SELECT test.assert((SELECT count(*) = 2 FROM collection_import_private.row_audit), 'replay duplicated audit');

SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.import_collection_report_atomic_v1(
      '10000000-0000-4000-8000-000000000003',
      '[{
        "report_date":"2026-09-01","client_code":"INVALID-ZERO","collection_amount":0,
        "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
        "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
        "excel_filename":"INVALID.xlsx","excel_source_row":2,"date_of_validity":null,
        "facture_no":null,"no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
        "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
        "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
        "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
      }]'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAILED: zero amount unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_ROW_VALUES_INVALID' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT test.assert(
  (SELECT count(*) = 0 FROM collection_import_private.commands
   WHERE command_key = '10000000-0000-4000-8000-000000000003'),
  'failed transaction retained its command ledger row'
);
SELECT test.assert(
  (SELECT count(*) = 0 FROM public.collection_report WHERE excel_filename = 'INVALID.xlsx'),
  'failed transaction retained a collection row'
);

SET ROLE authenticated;
DO $$
DECLARE
  v_seed jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'report_date','2026-09-01','client_code','SHIFT-BASE-' || n,'collection_amount',1000 + n,
    'bank_name','SYNTH BANK','status','pending','collection_type','UNKNOWN',
    'effet_echeance_date',NULL,'effet_status',NULL,'cheque_number',NULL,'cheque_status',NULL,
    'excel_filename','SHIFT-SYNTH.xlsx','excel_source_row',n,'date_of_validity',NULL,
    'facture_no','SHIFT-FA-' || n,'no_chq_bd',NULL,'bank_name_display',NULL,'depo_ref',NULL,
    'nj',NULL,'taux',NULL,'interet',NULL,'commission',NULL,'tob',NULL,
    'frais_escompte',NULL,'bank_commission',NULL,'sg_or_fa_no',NULL,'d_n_amount',NULL,
    'income',NULL,'date_of_impay',NULL,'reglement_impaye',NULL,'remarques',NULL
  )) INTO v_seed
  FROM generate_series(10,14) AS n;

  PERFORM public.import_collection_report_atomic_v1(
    '10000000-0000-4000-8000-000000000004',
    v_seed
  );
END;
$$;

DO $$
DECLARE
  v_shifted jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'report_date','2026-09-01','client_code','SHIFT-DIVERGENT-' || n,'collection_amount',9000 + n,
    'bank_name','SYNTH OTHER BANK','status','pending','collection_type','UNKNOWN',
    'effet_echeance_date',NULL,'effet_status',NULL,'cheque_number',NULL,'cheque_status',NULL,
    'excel_filename','SHIFT-SYNTH.xlsx','excel_source_row',n,'date_of_validity',NULL,
    'facture_no','SHIFT-CHANGED-' || n,'no_chq_bd',NULL,'bank_name_display',NULL,'depo_ref',NULL,
    'nj',NULL,'taux',NULL,'interet',NULL,'commission',NULL,'tob',NULL,
    'frais_escompte',NULL,'bank_commission',NULL,'sg_or_fa_no',NULL,'d_n_amount',NULL,
    'income',NULL,'date_of_impay',NULL,'reglement_impaye',NULL,'remarques',NULL
  )) INTO v_shifted
  FROM generate_series(10,14) AS n;

  BEGIN
    PERFORM public.import_collection_report_atomic_v1(
      '10000000-0000-4000-8000-000000000005',
      v_shifted
    );
    RAISE EXCEPTION 'TEST_FAILED: mass row shift unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'COLLECTION_IMPORT_MASS_ROW_SHIFT_DETECTED:%' THEN RAISE; END IF;
  END;
END;
$$;

DO $$ BEGIN
  BEGIN
    UPDATE public.collection_report
    SET collection_amount = collection_amount + 1
    WHERE excel_filename = 'COLLECTION-SYNTH.xlsx' AND excel_source_row = 2;
    RAISE EXCEPTION 'TEST_FAILED: direct stable update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT test.assert(
  (SELECT count(*) = 5 FROM public.collection_report
   WHERE excel_filename = 'SHIFT-SYNTH.xlsx' AND client_code LIKE 'SHIFT-BASE-%'),
  'mass-shift rejection changed existing rows'
);
SELECT test.assert(
  (SELECT count(*) = 0 FROM collection_import_private.commands
   WHERE command_key = '10000000-0000-4000-8000-000000000005'),
  'mass-shift rejection retained its command'
);

UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = false,
    enabled_until = NULL,
    change_reason = 'Relock synthetic Collection qualification window'
WHERE singleton = true;

SET ROLE authenticated;
SELECT test.assert(
  public.collection_report_promotion_enabled_v1() = false,
  'relocked scope must read false'
);
RESET ROLE;
SELECT test.assert(
  (SELECT count(*) = 2 FROM collection_import_private.runtime_control_events),
  'unlock and relock must both be audited'
);

SELECT 'COLLECTION_REPORT_CONTROLLED_ACTIVATION_PASS' AS result;
