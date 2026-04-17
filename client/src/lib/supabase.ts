import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "❌ Variáveis de ambiente Supabase não configuradas.\n" +
      "Crie um arquivo .env na raiz do projeto com:\n" +
      "VITE_SUPABASE_URL=https://xxxx.supabase.co\n" +
      "VITE_SUPABASE_ANON_KEY=eyJxxx...",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

let sessionInitPromise: Promise<void> | null = null;

export async function ensureAnonymousSession(): Promise<void> {
  if (!sessionInitPromise) {
    sessionInitPromise = (async () => {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (session) {
        return;
      }

      const { error: signInError } = await supabase.auth.signInAnonymously();

      if (signInError) {
        throw signInError;
      }
    })().catch((error) => {
      sessionInitPromise = null;
      throw error;
    });
  }

  return sessionInitPromise;
}

// Exportado para que o app possa aguardar antes de carregar dados.
export const sessionReady: Promise<void> = ensureAnonymousSession();
