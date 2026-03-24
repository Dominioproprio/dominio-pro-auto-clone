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

  const [accessEnabled, setAccessEnabled] = useState(isAccessControlEnabled);
  const [session, setSession]             = useState(getSession);

  // ── INICIALIZAÇÃO DO AGENTE IA (ETAPA 2b) ──
  useEffect(() => {
    const setupIA = async () => {
      let token = localStorage.getItem("github_token");
      if (!token) {
        token = prompt("🤖 Bem-vindo! Cole seu GitHub Token (PAT) para ativar a IA:");
        if (token) localStorage.setItem("github_token", token);
      }

      if (token) {
        try {
          await initAgent({
            githubToken: token,
            model: "openai/gpt-4o-mini",
            businessContext: "Domínio Pro - Sistema de gestão para barbearias e salões. Especializado em agendamentos, controle de caixa e relatórios.",
            llmAsFallback: true,
            // ── Fornece dados reais do sistema para o LLM ──────────
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
                      servicos: a.services?.map(s => s.serviceName).join(", "),
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

            // ── Executa acoes reais no sistema ──────────────────────
            executeToolAction: async (toolId, params) => {
              try {
                const {
                  appointmentsStore,
                  clientsStore,
                  servicesStore,
                  employeesStore,
                } = await import("./lib/store");

                if (toolId === "agendar") {
                  const clientName = params.clientName ?? params.client ?? "Cliente";
                  const serviceName = params.serviceName ?? params.service ?? params.servico ?? "Servico";
                  const dateRaw = params.date ?? params.data;
                  const timeRaw = params.time ?? params.horario ?? params.hora;

                  if (!dateRaw || !timeRaw) {
                    return `Faltam informacoes: ${!dateRaw ? "data " : ""}${!timeRaw ? "horario" : ""}`.trim();
                  }

                  let resolvedDate = dateRaw;
                  if (dateRaw === "hoje") {
                    resolvedDate = new Date().toISOString().split("T")[0];
                  } else if (dateRaw === "amanha") {
                    resolvedDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                  }

                  let resolvedTime = timeRaw.replace(/h/i, ":").trim();
                  if (/^\d{1,2}$/.test(resolvedTime)) resolvedTime = `${resolvedTime}:00`;
                  if (!/^\d{1,2}:\d{2}$/.test(resolvedTime)) resolvedTime = "09:00";

                  const services = servicesStore.list();
                  const svc = services.find(s =>
                    s.name.toLowerCase().includes(serviceName.toLowerCase()) ||
                    serviceName.toLowerCase().includes(s.name.toLowerCase())
                  ) ?? services[0];

                  const employees = employeesStore.list(true);
                  if (employees.length === 0) return "Nenhum funcionario cadastrado.";
                  const emp = employees[0];

                  const durationMs = (svc?.durationMinutes ?? 60) * 60 * 1000;
                  const startTime = `${resolvedDate}T${resolvedTime}:00`;
                  const endTime = new Date(new Date(startTime).getTime() + durationMs)
                    .toISOString().slice(0, 16) + ":00";

                  const allClients = clientsStore.list();
                  const foundClient = allClients.find(c =>
                    c.name?.toLowerCase().includes(clientName.toLowerCase())
                  );

                  const newAppt = await appointmentsStore.create({
                    clientName,
                    clientId: foundClient?.id ?? null,
                    employeeId: emp.id,
                    startTime,
                    endTime,
                    status: "scheduled",
                    totalPrice: svc?.price ?? null,
                    notes: null,
                    paymentStatus: null,
                    groupId: null,
                    services: svc ? [{
                      serviceId: svc.id,
                      serviceName: svc.name,
                      price: svc.price,
                      durationMinutes: svc.durationMinutes,
                      employeeId: emp.id,
                    }] : [],
                  });

                  window.dispatchEvent(new Event("store_updated"));
                  return `Agendamento criado!\nCliente: ${clientName}\nServico: ${svc?.name ?? serviceName}\nData: ${resolvedDate} as ${resolvedTime}\nFuncionario: ${emp.name}`;
                }

                if (toolId === "cancelar_agendamento") {
                  const dateRaw = params.date ?? params.sourceDate;
                  let resolvedDate = dateRaw;
                  if (dateRaw === "hoje") resolvedDate = new Date().toISOString().split("T")[0];
                  else if (dateRaw === "amanha") {
                    resolvedDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                  }
                  const clientFilter = params.clientName?.toLowerCase();
                  const targets = appointmentsStore.list(resolvedDate ? { date: resolvedDate } : undefined).filter(a => {
                    const matchClient = clientFilter ? a.clientName?.toLowerCase().includes(clientFilter) : true;
                    return matchClient && a.status !== "cancelled";
                  });
                  if (targets.length === 0) return "Nenhum agendamento encontrado para cancelar.";
                  for (const appt of targets) {
                    await appointmentsStore.update(appt.id, { status: "cancelled" });
                  }
                  window.dispatchEvent(new Event("store_updated"));
                  return `${targets.length} agendamento(s) cancelado(s).`;
                }

                if (toolId === "mover_agendamento" || toolId === "reagendar") {
                  const srcDate = params.sourceDate === "hoje"
                    ? new Date().toISOString().split("T")[0]
                    : params.sourceDate;
                  const appts = appointmentsStore.list(srcDate ? { date: srcDate } : undefined);
                  const appt = appts.find(a =>
                    !params.clientName || a.clientName?.toLowerCase().includes(params.clientName.toLowerCase())
                  );
                  if (!appt) return "Agendamento de origem nao encontrado.";

                  const tgtDate = params.targetDate === "amanha"
                    ? new Date(Date.now() + 86400000).toISOString().split("T")[0]
                    : (params.targetDate ?? appt.startTime.split("T")[0]);
                  let tgtTime = (params.targetTime ?? params.time ?? appt.startTime.split("T")[1]?.slice(0, 5) ?? "09:00")
                    .replace(/h/i, ":").trim();
                  if (/^\d{1,2}$/.test(tgtTime)) tgtTime = `${tgtTime}:00`;

                  const durationMs = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
                  const newStart = `${tgtDate}T${tgtTime}:00`;
                  const newEnd = new Date(new Date(newStart).getTime() + durationMs).toISOString().slice(0, 19);
                  await appointmentsStore.update(appt.id, { startTime: newStart, endTime: newEnd });
                  window.dispatchEvent(new Event("store_updated"));
                  return `Agendamento reagendado para ${tgtDate} as ${tgtTime}.`;
                }

                return "Acao reconhecida, mas nao implementada.";
              } catch (e) {
                console.error("[executeToolAction] Erro:", e);
                return `Erro ao executar a acao: ${e instanceof Error ? e.message : String(e)}`;
              }
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
