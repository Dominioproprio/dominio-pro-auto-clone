import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DominioLayout from "./components/DominioLayout";
import DashboardPage from "./pages/DashboardPage";
import AgendaPage from "./pages/AgendaPage";
import ClientesPage from "./pages/ClientesPage";
import FuncionariosPage from "./pages/FuncionariosPage";
import ServicosPage from "./pages/ServicosPage";
import CaixaPage from "./pages/CaixaPage";
import DashboardCaixaPage from "./pages/DashboardCaixaPage";
import RelatoriosPage from "./pages/RelatoriosPage";
import HistoricoPage from "./pages/HistoricoPage";
import HistoricoAgendamentosPage from "./pages/HistoricoAgendamentosPage";
import BackupPage from "./pages/BackupPage";
import ConfiguracoesPage from "./pages/ConfiguracoesPage";
import FerramentasClientesPage from "./pages/FerramentasClientesPage";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { fetchAllData, autoOpenCashIfNeeded } from "./lib/store";
import { getSession, isAccessControlEnabled, canAccess, getDefaultRoute } from "./lib/access";
import ProfileSelector from "./components/ProfileSelector";
import AgentChat from "./components/AgentChat";

// --- IMPORTAÇÃO DO AGENTE (PASSO 2b) ---
import { initAgent } from "./agentOrchestrator";

function getAccent() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function AppContent() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [, setLocation]           = useLocation();
  const [location]                = useLocation();
  const accent = getAccent();

  const [accessEnabled, setAccessEnabled] = useState(isAccessControlEnabled);
  const [session, setSession]             = useState(getSession);

  // ── INICIALIZAÇÃO DO AGENTE IA (ETAPA 2b) ──
  useEffect(() => {
    const setupIA = async () => {
      // Recupera o token de forma segura (Opção B do guia)
      let token = localStorage.getItem("github_token");
      if (!token) {
        token = prompt("🤖 Bem-vindo! Cole seu GitHub Token (PAT) para ativar a IA:");
        if (token) localStorage.setItem("github_token", token);
      }

      if (token) {
        try {
          await initAgent({
            githubToken: token,
            model: "openai/gpt-4o-mini", // Recomendado pelo guia
            businessContext: "Domínio Pro - Sistema de gestão para barbearias e salões. Especializado em agendamentos, controle de caixa e relatórios.",
            llmAsFallback: true, //

            // Integração com os dados do seu sistema
            fetchSystemData: async (intent, entities) => {
              console.log("IA solicitou dados:", intent, entities);
              // Exemplo: Integrar com fetchAllData ou stores específicos no futuro
              return "";
            },

            // Execução de ferramentas na agenda
            executeToolAction: async (toolId, params) => {
              console.log("IA executando ação:", toolId, params);
              return "Ação processada no sistema.";
            },
          });
        } catch (e) {
          console.error("Erro ao inicializar Agente IA:", e);
        }
      }
    };

    setupIA();
  }, []);

  useEffect(() => {
    const onUpdate = () => {
      setAccessEnabled(isAccessControlEnabled());
      setSession(getSession());
    };
    window.addEventListener("salon_config_updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("salon_config_updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  useEffect(() => {
    if (session && accessEnabled && !canAccess(session.role, location)) {
      setLocation(getDefaultRoute(session.role));
    }
  }, [session, accessEnabled, location, setLocation]);

  useEffect(() => {
    fetchAllData()
      .then(async () => {
        setLoading(false);
        try {
          const opened = await autoOpenCashIfNeeded();
          if (opened) {
            toast.success("Caixa aberto automaticamente para hoje!", {
              description: "Configure em Configurações > Automação",
              duration: 5000,
            });
          }
        } catch (e) {
          console.error("Erro ao abrir caixa automaticamente:", e);
        }
      })
      .catch(err => {
        console.error("Erro ao carregar dados:", err);
        setError("Não foi possível conectar ao banco de dados.");
        setLoading(false);
      });
  }, []);

  const handleNewAppt = useCallback(() => {
    setLocation("/agenda");
    setTimeout(() => window.dispatchEvent(new CustomEvent("dominio:open_new_appt")), 100);
  }, [setLocation]);

  if (!loading && accessEnabled && !session) {
    return <ProfileSelector />;
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: "#08080f" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: `${accent}20`, border: `1px solid ${accent}40` }}>
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: accent, borderTopColor: "transparent" }} />
        </div>
        <p className="text-sm text-white/30">Carregando Domínio Pro...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-screen p-6" style={{ background: "#08080f" }}>
      <div className="text-center space-y-4 max-w-md">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-bold text-red-400">Erro de conexão</h2>
        <p className="text-sm text-white/50">{error}</p>
        <button onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: accent }}>
          Tentar novamente
        </button>
      </div>
    </div>
  );

  return (
    <DominioLayout onNewAppt={handleNewAppt}>
      <Switch>
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/agenda" component={AgendaPage} />
        <Route path="/clientes" component={ClientesPage} />
        <Route path="/ferramentas-clientes" component={FerramentasClientesPage} />
        <Route path="/funcionarios" component={FuncionariosPage} />
        <Route path="/servicos" component={ServicosPage} />
        <Route path="/caixa" component={CaixaPage} />
        <Route path="/caixa/dashboard" component={DashboardCaixaPage} />
        <Route path="/relatorios" component={RelatoriosPage} />
        <Route path="/historico" component={HistoricoPage} />
        <Route path="/historico/agendamentos" component={HistoricoAgendamentosPage} />
        <Route path="/backup" component={BackupPage} />
        <Route path="/configuracoes" component={ConfiguracoesPage} />
        <Route component={NotFound} />
      </Switch>
      <AgentChat />
    </DominioLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
