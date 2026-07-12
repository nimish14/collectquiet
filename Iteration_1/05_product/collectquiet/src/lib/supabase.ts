import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.SUPABASE_URL ??
  '';
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.SUPABASE_KEY ??
  import.meta.env.SUPABASE_ANON_KEY ??
  '';

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Only call auth/db after checking `isSupabaseConfigured`. */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url, anonKey)
  : (null as unknown as SupabaseClient);
