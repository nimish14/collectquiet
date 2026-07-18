/**
 * Shared JWT auth for collections API routes.
 */
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';

export type AuthUser = { id: string; email?: string };

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || undefined;
}

/** Prefer legacy anon JWT for Auth API; fall back to publishable / VITE keys. */
function supabaseAnonKey(): string | undefined {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    undefined
  );
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export async function userFromRequest(req: VercelRequest): Promise<AuthUser | null> {
  const auth = req.headers.authorization;
  const jwt =
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!jwt) return null;

  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Pass the JWT explicitly — more reliable than global Authorization header alone.
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}
