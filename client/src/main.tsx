import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { supabase } from "./lib/supabase";

async function bootstrap() {
  // Garante sessão autenticada antes de renderizar
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    await supabase.auth.signInAnonymously();
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

bootstrap();

// ── Service Worker — detecta nova versão e recarrega automaticamente ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((registration) => {

    // Verifica updates periodicamente (a cada 60s enquanto o app está aberto)
    setInterval(() => registration.update(), 60_000);

    // Quando um novo SW está esperando, manda sinal para ativar imediatamente
    const awaitingWorker = registration.waiting;
    if (awaitingWorker) {
      awaitingWorker.postMessage("SKIP_WAITING");
    }

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        // Novo SW instalado e aguardando — ativa e recarrega
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          newWorker.postMessage("SKIP_WAITING");
        }
      });
    });

  }).catch(console.error);

  // Recarrega a página quando o SW novo assumir o controle
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
