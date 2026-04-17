import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { sessionReady } from "./lib/supabase";

async function bootstrap() {
  try {
    // Aguarda apenas a inicialização centralizada da sessão.
    await sessionReady;
  } catch (error) {
    console.error("[bootstrap] Falha ao inicializar sessão Supabase:", error);
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("Elemento #root não encontrado.");
  }

  createRoot(rootEl).render(<App />);
}

bootstrap().catch((error) => {
  console.error("[bootstrap] Erro fatal ao iniciar app:", error);
});

// ── Service Worker — detecta nova versão e recarrega automaticamente ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      // Verifica updates a cada 60s enquanto o app está aberto
      setInterval(() => registration.update(), 60_000);

      const awaitingWorker = registration.waiting;
      if (awaitingWorker) {
        awaitingWorker.postMessage("SKIP_WAITING");
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            newWorker.postMessage("SKIP_WAITING");
          }
        });
      });
    })
    .catch(console.error);

  // Recarrega quando o SW novo assumir controle
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
