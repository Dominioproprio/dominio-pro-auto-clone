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

// Tente mudar estes caminhos se o erro persistir:
import { getSession, getDefaultRoute } from "./lib/access";
import { fetchAllData, appointmentsStore, clientsStore } from "./lib/store";
import { initAgent } from "./lib/agentOrchestrator";

import ProfileSelector from "./components/ProfileSelector";
import AgentChat from "./components/AgentChat";

function AppContent() {
  const [, setLocation] = useLocation();
  const [session, setSession] = useState(getSession);

  // CARREGAMENTO CRÍTICO DOS DADOS
  useEffect(() => {
    const load = async () => {
      try {
        await fetchAllData();
        console.log("Dados carregados com sucesso");
      } catch (err) {
        console.error("Erro crítico ao carregar banco de dados:", err);
      }
    };
    load();
  }, []);

  // INICIALIZAÇÃO DO AGENTE
  useEffect(() => {
    const token = localStorage.getItem("github_token") || process.env.NEXT_PUBLIC_GITHUB_TOKEN || "proxy";
    initAgent({
      githubToken: token,
      model: "openai/gpt-4o-mini",
      businessContext: "Domínio Pro",
      llmAsFallback: true,
      fetchSystemData: async (intent) => {
        if (intent.includes("cliente")) return JSON.stringify(clientsStore.list().slice(0, 5));
        return "";
      }
    });
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
