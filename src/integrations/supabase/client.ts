// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://leakcdbbawzysfqyqsnr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlYWtjZGJiYXd6eXNmcXlxc25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0Njc1MDYsImV4cCI6MjA2NjA0MzUwNn0.zLVhHBNTovKRP0CZohIvpkxamA04kiPdL6qIQ7-ZemM";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);