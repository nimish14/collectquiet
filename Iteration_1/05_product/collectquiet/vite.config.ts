import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(appDir, '../../..');

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, rootDir, ['VITE_', 'SUPABASE_']);
  const appEnv = loadEnv(mode, appDir, ['VITE_', 'SUPABASE_']);
  const env = { ...rootEnv, ...appEnv };

  return {
    envPrefix: ['VITE_', 'SUPABASE_'],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
      ),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
        env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_KEY || ''
      ),
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''),
      'import.meta.env.SUPABASE_KEY': JSON.stringify(env.SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY || ''),
    },
  };
});
