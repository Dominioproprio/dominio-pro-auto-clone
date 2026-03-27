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

  // ── INICIALIZAÇÃO DO AGENTE IA ──
  // O token GitHub é gerenciado pelo proxy server-side (/api/llm).
  // Não é mais necessário pedir o token ao usuário.
  useEffect(() => {
    const setupIA = async () => {
      // Usar token do localStorage se existir (compatibilidade),
      // ou string vazia (o proxy usará GITHUB_TOKEN do Vercel env)
      const token = localStorage.getItem("github_token") || "proxy";

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

            // ── Executa ações reais no sistema ─────────────────────
            executeToolAction: async (toolId, params) => {
              try {
                const {
                  appointmentsStore,
                  clientsStore,
                  servicesStore,
                  employeesStore,
                } = await import("./lib/store");

                // Helper para normalizar horário
                const normalizeTime = (raw: string) => {
                  if (!raw) return null;
                  let t = raw.toLowerCase().replace(/h/i, ":").replace(/\s+/g, "").trim();
                  // Formatos: "9", "09", "9:30", "09:30"
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
                    // Se houver mais de um e não especificou, poderíamos pedir para escolher, 
                    // mas para manter o fluxo, vamos avisar qual foi selecionado ou pedir definição.
                    // O relatório sugere perguntar se houver mais de um.
                    return `Por favor, especifique o profissional. Profissionais disponíveis: ${employees.map(e => e.name).join(", ")}`;
                  }

                  const durationMs = (svc.durationMinutes ?? 60) * 60 * 1000;
                  const startTime = `${resolvedDate}T${resolvedTime}:00`;
                  const startDt = new Date(startTime);
                  const endDt = new Date(startDt.getTime() + durationMs);
                  const endTime = endDt.toISOString().slice(0, 16) + ":00";

                  // Verificação de conflito de horário
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
                  const foundClient = params.clientId
                    ? allClients.find(c => String(c.id) === String(params.clientId))
                    : allClients.find(c => c.name?.toLowerCase().includes(clientName.toLowerCase()));

                  const newAppt = await appointmentsStore.create({
                    clientName: foundClient?.name ?? clientName,
                    clientId: foundClient?.id ?? null,
                    employeeId: emp.id,
                    startTime,
                    endTime,
                    status: "scheduled",
                    totalPrice: svc.price,
                    notes: null,
                    paymentStatus: null,
                    groupId: null,
                    services: [{
                      serviceId: svc.id,
                      name: svc.name,
                      price: svc.price,
                      durationMinutes: svc.durationMinutes,
                      employeeId: emp.id,
                    }],
                  });

                  window.dispatchEvent(new Event("store_updated"));
                  return `Agendamento criado com sucesso!\nCliente: ${foundClient?.name ?? clientName}\nServiço: ${svc.name}\nData: ${resolvedDate} às ${resolvedTime}\nProfissional: ${emp.name}`;
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
                  
                  if (targets.length > 1 && !params.confirmed) {
                    const list = targets.map(a => `- ${a.clientName} às ${a.startTime.split('T')[1].slice(0,5)} (${a.services?.map(s => s.name).join(', ')})`).join('\n');
                    return `Encontrei múltiplos agendamentos. Qual deseja cancelar?\n${list}\n(Por favor, seja mais específico com o horário ou nome)`;
                  }

                  for (const appt of targets) {
                    await appointmentsStore.update(appt.id, { status: "cancelled" });
                  }
                  window.dispatchEvent(new Event("store_updated"));
                  return `${targets.length} agendamento(s) cancelado(s) com sucesso.`;
                }

                if (toolId === "mover_agendamento" || toolId === "reagendar") {
                  const srcDate = params.sourceDate === "hoje"
                    ? new Date().toISOString().split("T")[0]
                    : (params.sourceDate ?? params.date);
                  
                  const clientFilter = params.clientName?.toLowerCase();
                  const appts = appointmentsStore.list(srcDate ? { date: srcDate } : undefined).filter(a => 
                    a.status !== 'cancelled' && (!clientFilter || a.clientName?.toLowerCase().includes(clientFilter))
                  );

                  if (appts.length === 0) return "Agendamento de origem não encontrado.";
                  
                  if (appts.length > 1 && !params.confirmed) {
                    const list = appts.map(a => `- ${a.clientName} às ${a.startTime.split('T')[1].slice(0,5)}`).join('\n');
                    return `Encontrei mais de um agendamento para este cliente/data. Qual deseja mover?\n${list}`;
                  }

                  const appt = appts[0];
                  const tgtDate = params.targetDate === "amanha"
                    ? new Date(Date.now() + 86400000).toISOString().split("T")[0]
                    : (params.targetDate ?? params.date ?? appt.startTime.split("T")[0]);
                  
                  const tgtTime = normalizeTime(params.targetTime ?? params.time ?? appt.startTime.split("T")[1]?.slice(0, 5));
                  if (!tgtTime) return "Horário de destino inválido.";

                  const durationMs = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
                  const newStart = `${tgtDate}T${tgtTime}:00`;
                  const newEnd = new Date(new Date(newStart).getTime() + durationMs).toISOString().slice(0, 19);
                  
                  // Verificar conflito no destino
                  const existing = appointmentsStore.list({ date: tgtDate }).filter(a => a.employeeId === appt.employeeId && a.id !== appt.id && a.status !== 'cancelled');
                  const hasConflict = existing.some(a => {
                    const aStart = new Date(a.startTime).getTime();
                    const aEnd = new Date(a.endTime).getTime();
                    const reqStart = new Date(newStart).getTime();
                    const reqEnd = new Date(newEnd).getTime();
                    return (reqStart < aEnd && reqEnd > aStart);
                  });

                  if (hasConflict) {
                    return `Não foi possível mover: o profissional já tem um agendamento em ${tgtDate} às ${tgtTime}.`;
                  }

                  await appointmentsStore.update(appt.id, { startTime: newStart, endTime: newEnd });
                  window.dispatchEvent(new Event("store_updated"));
                  return `Agendamento reagendado com sucesso para ${tgtDate} às ${tgtTime}.`;
                }

                return "Ação reconhecida, mas não implementada.";
              } catch (e) {
                console.error("[executeToolAction] Erro:", e);
                return `Erro ao executar a ação: ${e instanceof Error ? e.message : String(e)}`;
              }
            },
          });
        } catch (e) {
          console.error("Erro ao inicializar Agente IA:", e);
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
