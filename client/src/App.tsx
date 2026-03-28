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

// --- IMPORTAÇÃO DO AGENTE (CORRIGIDA PARA PASTA LIB) ---
import { initAgent } from "./lib/agentOrchestrator";

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

  // ALTERAÇÃO DEFINITIVA: Força o controle de acesso a começar desativado (false)
  const [accessEnabled, setAccessEnabled] = useState(false); 
  const [session, setSession]             = useState(getSession);

  // ── INICIALIZAÇÃO DO AGENTE IA ──
  useEffect(() => {
    const setupIA = async () => {
      // Tenta ler do localStorage, depois da variável de ambiente do Vercel, ou usa "proxy" como fallback
      const token = localStorage.getItem("github_token") || process.env.NEXT_PUBLIC_GITHUB_TOKEN || "proxy";

      try {
          await initAgent({
            githubToken: token,
            model: "openai/gpt-4o-mini",
            businessContext: "Domínio Pro - Sistema de gestão para barbearias e salões. Especializado em agendamentos, controle de caixa e relatórios.",
            llmAsFallback: true,
            fetchSystemData: async (intent, entities) => {
              try {
                const {
                  appointmentsStore,
                  clientsStore,
                  servicesStore,
                  cashEntriesStore,
                } = await import("./lib/store");

                const today = new Date().toISOString().split("T")[0];

                if (intent.includes("agendamento") || intent.includes("agenda") || intent.includes("agendar")) {
                  let dateFilter = today;
                  if (entities.date === "amanha") {
                    dateFilter = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                  } else if (entities.date && /^\d{4}-\d{2}-\d{2}$/.test(entities.date)) {
                    dateFilter = entities.date;
                  }
                  
                  const appts = entities.date === "semana"
                    ? appointmentsStore.list()
                    : appointmentsStore.list({ date: dateFilter });
                  return `Agendamentos (${appts.length}): ${JSON.stringify(
                    appts.slice(0, 15).map(a => ({
                      id: a.id,
                      cliente: a.clientName,
                      data: a.startTime.split("T")[0],
                      hora: a.startTime.split("T")[1]?.slice(0, 5),
                      status: a.status,
                      servicos: a.services?.map(s => s.name).join(", "),
                    }))
                  )}`;
                }

                if (intent.includes("cliente")) {
                  const q = entities.clientName?.toLowerCase() ?? "";
                  const clients = q
                    ? clientsStore.list().filter(c => c.name?.toLowerCase().includes(q))
                    : clientsStore.list().slice(0, 15);
                  return `Clientes (${clients.length}): ${JSON.stringify(
                    clients.map(c => ({ id: c.id, nome: c.name, telefone: c.phone }))
                  )}`;
                }

                if (intent.includes("servico")) {
                  return `Servicos: ${JSON.stringify(
                    servicesStore.list().map(s => ({ id: s.id, nome: s.name, preco: s.price, duracao: s.durationMinutes }))
                  )}`;
                }

                if (intent.includes("financeiro") || intent.includes("relatorio") || intent.includes("caixa")) {
                  const entries = cashEntriesStore?.list?.() ?? [];
                  const todayEntries = entries.filter((e) => e.createdAt?.startsWith(today));
                  const total = todayEntries.reduce((s, e) => s + (e.amount ?? 0), 0);
                  return `Caixa hoje: total R$ ${total.toFixed(2)}, lancamentos: ${todayEntries.length}`;
                }

                return "";
              } catch (e) {
                console.error("[fetchSystemData] Erro:", e);
                return "";
              }
            },
            executeToolAction: async (toolId, params) => {
              try {
                const {
                  appointmentsStore,
                  clientsStore,
                  servicesStore,
                  employeesStore,
                } = await import("./lib/store");

                const normalizeTime = (raw: string) => {
                  if (!raw) return null;
                  let t = raw.toLowerCase().replace(/h/i, ":").replace(/\s+/g, "").trim();
                  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2, '0')}:00`;
                  if (/^\d{1,2}:\d{2}$/.test(t)) {
                    const [h, m] = t.split(":");
                    return `${h.padStart(2, '0')}:${m}`;
                  }
                  return null;
                };

                if (toolId === "agendar") {
                  const clientName = params.clientName ?? params.client ?? "Cliente";
                  const serviceName = params.serviceName ?? params.service ?? params.servico ?? "Servico";
                  const employeeName = params.employeeName ?? params.funcionario ?? params.profissional;
                  const dateRaw = params.date ?? params.data;
                  const timeRaw = params.time ?? params.horario ?? params.hora;

                  if (!dateRaw || !timeRaw) {
                    return `Faltam informações: ${!dateRaw ? "data " : ""}${!timeRaw ? "horário" : ""}`.trim();
                  }

                  let resolvedDate = dateRaw;
                  if (dateRaw === "hoje") {
                    resolvedDate = new Date().toISOString().split("T")[0];
                  } else if (dateRaw === "amanha") {
                    resolvedDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                  }

                  const resolvedTime = normalizeTime(timeRaw);
                  if (!resolvedTime) {
                    return `Horário "${timeRaw}" inválido. Por favor, use o formato HH:MM (ex: 14:30).`;
                  }

                  const services = servicesStore.list(true);
                  const svc = params.serviceId
                    ? services.find(s => String(s.id) === String(params.serviceId))
                    : services.find(s =>
                        s.name.toLowerCase().includes(serviceName.toLowerCase()) ||
                        serviceName.toLowerCase().includes(s.name.toLowerCase())
                      );

                  if (!svc) {
                    const available = services.map(s => s.name).join(", ");
                    return `Serviço "${serviceName}" não encontrado. Serviços disponíveis: ${available || "nenhum cadastrado"}`;
                  }

                  const employees = employeesStore.list(true);
                  if (employees.length === 0) return "Nenhum funcionário ativo cadastrado.";
                  
                  let emp = employees[0];
                  if (employeeName) {
                    const foundEmp = employees.find(e => e.name.toLowerCase().includes(employeeName.toLowerCase()));
                    if (foundEmp) emp = foundEmp;
                    else return `Funcionário "${employeeName}" não encontrado ou inativo.`;
                  } else if (employees.length > 1) {
                    return `Por favor, especifique o profissional. Profissionais disponíveis: ${employees.map(e => e.name).join(", ")}`;
                  }

                  const durationMs = (svc.durationMinutes ?? 60) * 60 * 1000;
                  const startTime = `${resolvedDate}T${resolvedTime}:00`;
                  const startDt = new Date(startTime);
                  const endDt = new Date(startDt.getTime() + durationMs);
                  const endTime = endDt.toISOString().slice(0, 16) + ":00";

                  const existing = appointmentsStore.list({ date: resolvedDate }).filter(a => a.employeeId === emp.id && a.status !== 'cancelled');
                  const hasConflict = existing.some(a => {
                    const aStart = new Date(a.startTime).getTime();
                    const aEnd = new Date(a.endTime).getTime();
                    const reqStart = startDt.getTime();
                    const reqEnd = endDt.getTime();
                    return (reqStart < aEnd && reqEnd > aStart);
                  });

                  if (hasConflict) {
                    return `O profissional ${emp.name} já possui um agendamento nesse horário (${resolvedTime}). Por favor, escolha outro horário ou profissional.`;
                  }

                  const allClients = clientsStore.list();
                  // ... restante do código original ...
                }
              } catch (e) {
                console.error("[executeToolAction] Erro:", e);
                return "Erro ao executar ação.";
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
              setLocation(getDefaultRoute(p));
            }} />
          </Route>
          
          <Route path="/">
            {!session ? <Redirect to="/login" /> : <Redirect to={getDefaultRoute(session)} />}
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
