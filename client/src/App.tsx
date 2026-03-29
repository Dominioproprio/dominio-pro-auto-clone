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
import { useState, useEffect } from "react";
import { getSession, getDefaultRoute } from "./lib/access";
import ProfileSelector from "./components/ProfileSelector";
import AgentChat from "./components/AgentChat";

// --- IMPORTAÇÃO DO AGENTE ---
import { initAgent } from "./lib/agentOrchestrator";

function getAccent() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function AppContent() {
  const [, setLocation] = useLocation();
  const [session, setSession] = useState(getSession);

  // ── INICIALIZAÇÃO DO AGENTE IA E CONEXÃO COM DADOS REAIS ──
  useEffect(() => {
    const setupIA = async () => {
      // Prioridade para o token do Vercel
      const token = localStorage.getItem("github_token") || process.env.NEXT_PUBLIC_GITHUB_TOKEN || "proxy";

      try {
        await initAgent({
          githubToken: token,
          model: "openai/gpt-4o-mini",
          businessContext: "Domínio Pro - Sistema de gestão para barbearias e salões. Especializado em agendamentos, controle de caixa e relatórios.",
          llmAsFallback: true,
          
          // ── Conecta o Agente aos dados reais do sistema ──────────
          fetchSystemData: async (intent, entities) => {
            try {
              const { appointmentsStore, clientsStore, servicesStore, cashEntriesStore } = await import("./lib/store");
              const today = new Date().toISOString().split("T")[0];

              // Busca de Agendamentos
              if (intent.includes("agendamento") || intent.includes("agenda")) {
                const appts = appointmentsStore.list({ date: today });
                return `Agendamentos de hoje (${appts.length}): ${JSON.stringify(
                  appts.slice(0, 10).map(a => ({ cliente: a.clientName, hora: a.startTime.split("T")[1]?.slice(0, 5), status: a.status }))
                )}`;
              }

              // Busca de Clientes (Para ele achar a "Fernanda")
              if (intent.includes("cliente")) {
                const q = entities.clientName?.toLowerCase() ?? "";
                const clients = q 
                  ? clientsStore.list().filter(c => c.name?.toLowerCase().includes(q))
                  : clientsStore.list().slice(0, 15);
                return `Clientes encontrados: ${JSON.stringify(clients.map(c => ({ id: c.id, nome: c.name, tel: c.phone })))}`;
              }

              // Busca de Serviços
              if (intent.includes("servico")) {
                const svcs = servicesStore.list(true);
                return `Serviços disponíveis: ${JSON.stringify(svcs.map(s => ({ nome: s.name, preco: s.price })))}`;
              }

              // Financeiro
              if (intent.includes("financeiro") || intent.includes("caixa")) {
                const entries = cashEntriesStore.list() || [];
                const todayTotal = entries.filter(e => e.createdAt?.startsWith(today)).reduce((s, e) => s + (e.amount || 0), 0);
                return `Total em caixa hoje: R$ ${todayTotal.toFixed(2)}`;
              }

              return "";
            } catch (e) {
              console.error("Erro ao buscar dados para o agente:", e);
              return "Erro ao acessar banco de dados.";
            }
          },

          // ── Permite que o Agente execute ações reais ─────────────
          executeToolAction: async (toolId, params) => {
            try {
              const { appointmentsStore, clientsStore, servicesStore, employeesStore } = await import("./lib/store");
              
              if (toolId === "agendar") {
                // Lógica simplificada de agendamento real via Agente
                const clientName = params.clientName || "Cliente";
                const serviceName = params.serviceName || "Serviço";
                const date = params.date || new Date().toISOString().split("T")[0];
                const time = params.time || "10:00";

                // Aqui o agente chamaria a função de criação no store
                console.log(`Agendando: ${clientName} para ${serviceName} em ${date} às ${time}`);
                return `Agendamento solicitado para ${clientName} (${serviceName}) em ${date} às ${time}. Verifique a agenda para confirmar.`;
              }
              return "Ação não suportada no momento.";
            } catch (e) {
              return "Erro ao executar ação no sistema.";
            }
          }
        });
      } catch (err) {
        console.error("Erro ao inicializar agente:", err);
      }
    };
    setupIA();
  }, []);

  return (
    <ThemeProvider>
      <TooltipProvider>
        <Toaster position="top-center" richColors closeButton />
        <Switch>
          <Route path="/login">
            <ProfileSelector onSelect={(p) => {
              setSession(p);
              setLocation(getDefaultRoute(p.role));
            }} />
          </Route>
          
          <Route path="/">
            {!session ? <Redirect to="/login" /> : <Redirect to={getDefaultRoute(session.role)} />}
          </Route>

          <DominioLayout>
            <Switch>
              <Route path="/dashboard" component={DashboardPage} />
              <Route path="/agenda" component={AgendaPage} />
              <Route path="/clientes" component={ClientesPage} />
              <Route path="/funcionarios" component={FuncionariosPage} />
              <Route path="/servicos" component={ServicosPage} />
              <Route path="/caixa" component={CaixaPage} />
              <Route path="/dashboard-caixa" component={DashboardCaixaPage} />
              <Route path="/relatorios" component={RelatoriosPage} />
              <Route path="/historico" component={HistoricoPage} />
              <Route path="/historico-agendamentos" component={HistoricoAgendamentosPage} />
              <Route path="/backup" component={BackupPage} />
              <Route path="/configuracoes" component={ConfiguracoesPage} />
              <Route path="/ferramentas-clientes" component={FerramentasClientesPage} />
              <Route component={NotFound} />
            </Switch>
          </DominioLayout>
        </Switch>
        <AgentChat />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
