/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID: string;
  readonly VITE_COLLECTIONS_CORE_LOCAL_ENABLED?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_ENABLED?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_CAMPAIGN_ID?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_GRANTOR_ID?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_OPERATOR_ID?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_CONTROLLER_ID?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_BASE64?: string;
  readonly VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_SHA256?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
