import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export let sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Recreates the client with the session token attached as a header,
   so RLS policies on the API side can validate it. */
export function setSessionToken(token) {
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, token
    ? { global: { headers: { 'x-session-token': token } } }
    : undefined);
}
