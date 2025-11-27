// Unified Supabase client instance.
// Ensures a single connection pool and consistent configuration across components.
// NOTE: Only expose the anon public key in the browser; service role keys MUST stay server-side.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Basic guard: throw early if variables missing to aid local debugging
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // We don't throw hard here to keep the app usable in demo mode.
  // Instead log a descriptive warning once.
  // eslint-disable-next-line no-console
  console.warn('[supabase] Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY. Features depending on Supabase will degrade.');
}

export const supabase = createClient(SUPABASE_URL || 'https://missing.supabase.co', SUPABASE_ANON_KEY || 'public-anon-key');

// Helper: quick readiness check returning structured info for UI badges
export function getSupabaseStatus() {
  return {
    hasUrl: Boolean(SUPABASE_URL),
    hasKey: Boolean(SUPABASE_ANON_KEY),
    url: SUPABASE_URL || null
  };
}

export default supabase;
