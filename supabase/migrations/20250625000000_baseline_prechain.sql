-- ============================================================================
-- 0M-E — BASELINE PRÉ-CHAÎNE (reproductibilité from-scratch)
-- ============================================================================
-- La chaîne de migrations active commence à 20250625211827_yellow_frog.sql,
-- qui présuppose un schéma créé historiquement HORS chaîne (bootstrap Bolt,
-- fichiers archivés dans .bolt/supabase_discarded_migrations/). Cette baseline
-- reconstruit cet état pré-chaîne exact sur une base vierge :
--   - tables    : bootstrap 20250623173851
--   - colonnes  : + 20250623222515 (collection_report), + 20250624164607
--                 (traçabilité excel), collection_amount en numeric
--                 (20250624185128)
--   - contrainte check_excel_traceability_not_null + index
--                 unique_excel_traceability / idx_collection_excel_source
--                 (20250624164607 / 20250624175518)
--
-- Idempotente et NO-OP sur une base déjà initialisée (prod incluse) :
-- uniquement CREATE ... IF NOT EXISTS et DO-guards. Zéro donnée. Zéro policy.
--
-- Notes de conception (lot 0M-E, arbitrage CTO) :
--   * fund_position est créée SANS deposit_for_day/payment_for_day : ces
--     colonnes sont ajoutées par yellow_frog (ALTER non idempotent).
--   * fund_position_detail / fund_position_hold ne sont PAS créées ici :
--     yellow_frog les crée (ses CREATE INDEX/POLICY ne sont pas gardés).
--   * unique_excel_traceability est créée en text SIMPLE (anachronisme
--     documenté DB_TRUTH.md) : la colonne n'existait pas strictement avant la
--     chaîne, mais sa présence fait skipper le guard de shiny_waterfall qui
--     la créerait GENERATED ALWAYS — forme interdite (DB_TRUTH §7) et
--     divergente de la prod réelle (text simple, is_generated = NEVER).
--   * unique_collection_entry (bootstrap 20250623222515) n'est PAS recréée :
--     absente de la vérité prod actuelle (DB_TRUTH §2) et référencée par
--     aucune migration active — la recréer introduirait une divergence.
--   * RLS activée d'emblée sur les 7 tables, sans policy : les policies
--     permissives historiques du bootstrap sont toutes droppées par nom plus
--     loin dans la chaîne (20251021, 20260430) ; les omettre donne le même
--     état final sans fenêtre permissive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables bootstrap
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bank_reports (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_name       TEXT NOT NULL,
  report_date     DATE NOT NULL,
  opening_balance BIGINT NOT NULL,
  closing_balance BIGINT NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deposits_not_cleared (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id UUID REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  date_depot     DATE NOT NULL,
  date_valeur    DATE,
  type_reglement TEXT NOT NULL,
  client_code    TEXT,
  reference      TEXT,
  montant        BIGINT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_facilities (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id   UUID REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  facility_type    TEXT NOT NULL,
  limit_amount     BIGINT NOT NULL,
  used_amount      BIGINT NOT NULL,
  available_amount BIGINT NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.impayes (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id UUID REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  date_echeance  DATE NOT NULL,
  date_retour    DATE,
  client_code    TEXT NOT NULL,
  description    TEXT,
  montant        BIGINT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SANS deposit_for_day / payment_for_day (ajoutés par yellow_frog).
CREATE TABLE IF NOT EXISTS public.fund_position (
  id                        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date               DATE NOT NULL,
  total_fund_available      BIGINT NOT NULL,
  collections_not_deposited BIGINT NOT NULL,
  grand_total               BIGINT NOT NULL,
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_reconciliation (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date    DATE NOT NULL,
  client_code    TEXT NOT NULL,
  client_name    TEXT,
  impayes_amount BIGINT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- État pré-chaîne complet : base bootstrap + 20250623222515 + 20250624164607,
-- collection_amount déjà en numeric (20250624185128). Les colonnes
-- collection_type / effet_* / cheque_* sont ajoutées par la chaîne
-- (fierce_waterfall) — ne pas les créer ici. Types VARCHAR historiques
-- conservés : 20260505113550 les convertit en text.
CREATE TABLE IF NOT EXISTS public.collection_report (
  id                        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date               DATE NOT NULL,
  client_code               TEXT NOT NULL,
  collection_amount         NUMERIC NOT NULL,
  bank_name                 TEXT,
  status                    TEXT DEFAULT 'pending',
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- 20250623222515
  date_of_validity          DATE,
  facture_no                VARCHAR(50),
  no_chq_bd                 VARCHAR(50),
  bank_name_display         VARCHAR(100),
  depo_ref                  VARCHAR(50),
  nj                        INTEGER,
  taux                      DECIMAL(8,4),
  interet                   DECIMAL(15,2),
  commission                DECIMAL(15,2),
  tob                       DECIMAL(15,2),
  frais_escompte            DECIMAL(15,2),
  bank_commission           DECIMAL(15,2),
  sg_or_fa_no               VARCHAR(50),
  d_n_amount                DECIMAL(15,2),
  income                    DECIMAL(15,2),
  date_of_impay             DATE,
  reglement_impaye          DATE,
  remarques                 TEXT,
  credited_date             DATE,
  processing_status         VARCHAR(20) DEFAULT 'NEW',
  matched_bank_deposit_id   UUID,
  match_confidence          DECIMAL(3,2),
  match_method              VARCHAR(50),
  processed_at              TIMESTAMP,
  -- 20250624164607
  excel_source_row          INTEGER,
  excel_filename            TEXT,
  excel_processed_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  -- Anachronisme documenté (voir en-tête) : text simple, JAMAIS GENERATED.
  unique_excel_traceability TEXT
);

-- ---------------------------------------------------------------------------
-- 2. Index pré-chaîne
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_bank_reports_date            ON public.bank_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_bank_reports_bank            ON public.bank_reports(bank_name);
CREATE INDEX IF NOT EXISTS idx_client_reconciliation_date   ON public.client_reconciliation(report_date);
CREATE INDEX IF NOT EXISTS idx_fund_position_date           ON public.fund_position(report_date);

CREATE INDEX IF NOT EXISTS idx_collection_report_date_of_validity ON public.collection_report(date_of_validity);
CREATE INDEX IF NOT EXISTS idx_collection_report_status_date      ON public.collection_report(status, report_date);
CREATE INDEX IF NOT EXISTS idx_collection_report_facture          ON public.collection_report(facture_no);
CREATE INDEX IF NOT EXISTS idx_collection_report_matching         ON public.collection_report(bank_name, collection_amount, date_of_validity, status);

-- Index canonique d'idempotence métier (DB_TRUTH §3). Note : azure_forest
-- (20250628115225) le droppe pendant le rejeu ; DB-FREEZE-1B
-- (20260707000000) le recrée en fin de chaîne — comme la prod réelle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_excel_source
  ON public.collection_report (excel_filename, excel_source_row)
  WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_excel_filename
  ON public.collection_report (excel_filename);

-- Forme pré-chaîne historique (20250624175518) : index unique partiel sur la
-- paire, portant le NOM unique_excel_traceability. Les guards de broad_reef →
-- sunny_trail et white_meadow s'appuient sur ce nom. DB-FREEZE-1B remplace en
-- fin de chaîne cet artefact par la contrainte UNIQUE prod sur la colonne.
CREATE UNIQUE INDEX IF NOT EXISTS unique_excel_traceability
  ON public.collection_report (excel_filename, excel_source_row)
  WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Contrainte pré-chaîne (20250624175518)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_excel_traceability_not_null'
      AND conrelid = 'public.collection_report'::regclass
  ) THEN
    ALTER TABLE public.collection_report
      ADD CONSTRAINT check_excel_traceability_not_null
      CHECK (
        (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL)
        OR (excel_filename IS NULL AND excel_source_row IS NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS : activée d'emblée, zéro policy (voir en-tête)
-- ---------------------------------------------------------------------------

ALTER TABLE public.bank_reports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits_not_cleared  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_facilities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impayes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_report     ENABLE ROW LEVEL SECURITY;
