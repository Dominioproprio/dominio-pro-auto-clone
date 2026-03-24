/**
 * agentBrain.ts — Motor de inteligencia do agente.
 * Analisa dados de tracking + estado do app para gerar sugestoes contextuais.
 * Opera 100% no cliente, sem necessidade de API externa.
 */

import {
  getTimeByPage,
  getMostVisitedPages,
  getActionCounts,
  getUnusedFeatures,
  getCurrentPage,
  getCurrentSessionDuration,
  getTrackerSnapshot,
} from "./agentTracker";
import {
  employeesStore,
  servicesStore,
  clientsStore,
  appointmentsStore,
  cashSessionsStore,
  cashEntriesStore,
} from "./store";
import { calcPeriodStats, getAppointmentsInPeriod, getPeriodDates } from "./analytics";
import { isScheduleCommand, processCommand } from "./agentCommands";
import { generateOnDemandReport } from "./agentReports";

// --- IMPORTAÇÃO CORRIGIDA PARA GITHUB MODELS ---
import { handleUserMessage } from "./agentOrchestrator";

import { setCurrentPage as setContextPage } from "./agentContext";
import {
  isAgendaActionCommand,
  parseAgendaAction,
  prepareAction,
  executeAction,
  cancelPendingAction,
  getLatestPendingAction,
  isConfirmation,
  isDenial,
} from "./agentActions";
import {
  checkDueTasks,
  getUnreadNotifications,
  addNotification,
  sendBrowserNotification,
  listActiveTasks,
  formatTaskDescription,
} from "./agentScheduler";
import { generateReport } from "./agentReports";

// ─── Tipos ─────────────────────────────────────────────────

export interface AgentSuggestion {
  id: string;
  category: "dica" | "alerta" | "melhoria" | "acao" | "insight";
  title: string;
  message: string;
  priority: number;         // 1 (baixa) a 5 (urgente)
  actionLabel?: string;     // texto do botao de acao
  actionRoute?: string;     // rota para navegar
  actionFn?: string;        // nome de funcao executavel
  dismissable: boolean;
  context?: string;         // pagina/contexto onde a dica e relevante
  createdAt: number;
}

export interface AgentMessage {
  id: string;
  role: "agent" | "user";
  content: string;
  timestamp: number;
  suggestions?: AgentSuggestion[];
}

// ─── Storage ───────────────────────────────────────────────

const DISMISSED_KEY = "dominio_agent_dismissed";
const MESSAGES_KEY = "dominio_agent_messages";

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function dismissSuggestion(id: string): void {
  const dismissed = getDismissedIds();
  dismissed.add(id);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissed)));
  } catch { /* ignore */ }
}

export function getSavedMessages(): AgentMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveMessages(messages: AgentMessage[]): void {
  try {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-100)));
  } catch { /* ignore */ }
}

// ─── Gerador de ID ─────────────────────────────────────────

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

// ─── Analise de Dados do App ───────────────────────────────

function getAppStats() {
  const employees = employeesStore.list(false);
  const activeEmployees = employeesStore.list(true);
  const services = servicesStore.list(false);
  const activeServices = servicesStore.list(true);
  const clients = clientsStore.list();
  const allAppts = appointmentsStore.list({});
  const cashSessions = cashSessionsStore.list();
  const currentCash = cashSessionsStore.getCurrent();
  const cashEntries = cashEntriesStore.list();

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const todayAppts = appointmentsStore.list({ date: todayStr });

  const { start: monthStart, end: monthEnd } = getPeriodDates("mes");
  const monthAppts = getAppointmentsInPeriod(monthStart, monthEnd);
  const monthStats = calcPeriodStats(monthAppts, employees);

  const { start: weekStart, end: weekEnd } = getPeriodDates("semana");
  const weekAppts = getAppointmentsInPeriod(weekStart, weekEnd);

  // Clientes sem visita nos ultimos 30 dias
  const cutoff30 = Date.now() - 30 * 86400000;
  const clientLastVisit: Record<number, number> = {};
  for (const a of allAppts) {
    if (a.clientId && a.status !== "cancelled" && a.status !== "no_show") {
      const t = new Date(a.startTime).getTime();
      if (!clientLastVisit[a.clientId] || t > clientLastVisit[a.clientId]) {
        clientLastVisit[a.clientId] = t;
      }
    }
  }
  const inactiveClients = clients.filter(c => {
    const last = clientLastVisit[c.id];
    return !last || last < cutoff30;
  });

  // Agendamentos cancelados este mes
  const cancelledThisMonth = monthAppts.filter(a => a.status === "cancelled" || a.status === "no_show");

  // Funcionarios sem comissao configurada
  const noCommission = activeEmployees.filter(e => e.commissionPercent === 0);

  // Funcionarios sem horarios configurados
  const noWorkingHours = activeEmployees.filter(e => {
    const wh = e.workingHours;
    if (!wh || Object.keys(wh).length === 0) return true;
    return !Object.values(wh).some(d => d.active);
  });

  // Servicos sem custo de material
  const noMaterialCost = activeServices.filter(s => s.materialCostPercent === 0);

  // Clientes sem telefone
  const noPhone = clients.filter(c => !c.phone);

  // Config do salao
  let salonConfig: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem("salon_config");
    if (raw) salonConfig = JSON.parse(raw);
  } catch { /* ignore */ }

  return {
    employees, activeEmployees, services, activeServices,
    clients, allAppts, cashSessions, currentCash, cashEntries,
    todayAppts, monthAppts, monthStats, weekAppts,
    inactiveClients, cancelledThisMonth,
    noCommission, noWorkingHours, noMaterialCost, noPhone,
    salonConfig, todayStr,
  };
}

// ─── Motor de Sugestoes ────────────────────────────────────

export function generateSuggestions(): AgentSuggestion[] {
  const dismissed = getDismissedIds();
  const suggestions: AgentSuggestion[] = [];
  const stats = getAppStats();
  const tracker = getTrackerSnapshot();
  const currentPage = getCurrentPage();

  // ── 1. Dados basicos ausentes ────────────────────────────

  if (stats.activeEmployees.length === 0) {
    suggestions.push({
      id: "setup_employees",
      category: "alerta",
      title: "Cadastre seus funcionarios",
      message: "Voce ainda nao tem funcionarios cadastrados. Sem eles, nao e possivel criar agendamentos. Vamos cadastrar o primeiro?",
      priority: 5,
      actionLabel: "Ir para Funcionarios",
      actionRoute: "/funcionarios",
      dismissable: false,
      context: "global",
      createdAt: Date.now(),
    });
  }

  if (stats.activeServices.length === 0) {
    suggestions.push({
      id: "setup_services",
      category: "alerta",
      title: "Cadastre seus servicos",
      message: "Nenhum servico cadastrado ainda. Cadastre seus servicos (corte, coloracao, etc.) para poder agendar atendimentos.",
      priority: 5,
      actionLabel: "Ir para Servicos",
      actionRoute: "/servicos",
      dismissable: false,
      context: "global",
      createdAt: Date.now(),
    });
  }

  if (stats.clients.length === 0 && stats.activeEmployees.length > 0 && stats.activeServices.length > 0) {
    suggestions.push({
      id: "setup_clients",
      category: "dica",
      title: "Importe seus clientes",
      message: "Voce ja tem funcionarios e servicos cadastrados, mas nenhum cliente. Voce pode importar contatos do celular ou de uma planilha para comecar rapidamente!",
      priority: 4,
      actionLabel: "Ferramentas de Clientes",
      actionRoute: "/ferramentas-clientes",
      dismissable: true,
      context: "global",
      createdAt: Date.now(),
    });
  }

  // ── 2. Configuracao incompleta ───────────────────────────

  if (stats.noCommission.length > 0) {
    const names = stats.noCommission.map(e => e.name).join(", ");
    suggestions.push({
      id: "commission_missing",
      category: "melhoria",
      title: "Comissoes nao configuradas",
      message: `${stats.noCommission.length} funcionario(s) sem comissao definida: ${names}. Configure a porcentagem de comissao para calculos financeiros corretos.`,
      priority: 3,
      actionLabel: "Configurar",
      actionRoute: "/funcionarios",
      dismissable: true,
      context: "funcionarios",
      createdAt: Date.now(),
    });
  }

  if (stats.noWorkingHours.length > 0) {
    suggestions.push({
      id: "working_hours_missing",
      category: "melhoria",
      title: "Horarios de trabalho",
      message: `${stats.noWorkingHours.length} funcionario(s) sem horario de trabalho configurado. Defina os horarios para melhor organizacao da agenda.`,
      priority: 2,
      actionLabel: "Configurar",
      actionRoute: "/funcionarios",
      dismissable: true,
      context: "funcionarios",
      createdAt: Date.now(),
    });
  }

  if (!stats.salonConfig.salonName || stats.salonConfig.salonName === "Salao Bella") {
    suggestions.push({
      id: "salon_name",
      category: "dica",
      title: "Personalize seu salao",
      message: "O nome do salao ainda esta como padrao. Personalize com o nome do seu estabelecimento, adicione seu logo e escolha um tema que combine!",
      priority: 2,
      actionLabel: "Configuracoes",
      actionRoute: "/configuracoes",
      dismissable: true,
      context: "configuracoes",
      createdAt: Date.now(),
    });
  }

  // ── 3. Caixa ─────────────────────────────────────────────

  if (!stats.currentCash && stats.todayAppts.length > 0) {
    suggestions.push({
      id: "cash_not_open",
      category: "alerta",
      title: "Caixa nao aberto",
      message: `Voce tem ${stats.todayAppts.length} agendamento(s) hoje mas o caixa nao esta aberto. Abra o caixa para registrar os pagamentos automaticamente!`,
      priority: 4,
      actionLabel: "Abrir Caixa",
      actionRoute: "/caixa",
      dismissable: true,
      context: "caixa",
      createdAt: Date.now(),
    });
  }

  if (stats.currentCash && !stats.salonConfig.autoOpenCash) {
    suggestions.push({
      id: "enable_auto_cash",
      category: "dica",
      title: "Abertura automatica do caixa",
      message: "Voce abre o caixa manualmente todos os dias. Ative a abertura automatica em Configuracoes > Automacao para nao esquecer!",
      priority: 2,
      actionLabel: "Ativar",
      actionRoute: "/configuracoes",
      actionFn: "enable_auto_cash",
      dismissable: true,
      context: "caixa",
      createdAt: Date.now(),
    });
  }

  // ── 4. Padroes de uso ────────────────────────────────────

  const unusedFeatures = getUnusedFeatures();

  if (unusedFeatures.includes("relatorios") && stats.allAppts.length > 10) {
    suggestions.push({
      id: "try_reports",
      category: "dica",
      title: "Conheca os Relatorios",
      message: "Voce ja tem bastante dados no sistema mas ainda nao explorou os Relatorios. La voce encontra faturamento por periodo, ranking de funcionarios, servicos populares e muito mais!",
      priority: 2,
      actionLabel: "Ver Relatorios",
      actionRoute: "/relatorios",
      dismissable: true,
      context: "dashboard",
      createdAt: Date.now(),
    });
  }

  if (unusedFeatures.includes("backup") && stats.allAppts.length > 20) {
    suggestions.push({
      id: "try_backup",
      category: "alerta",
      title: "Faca um backup!",
      message: `Voce tem ${stats.allAppts.length} agendamentos e ${stats.clients.length} clientes, mas nunca fez backup. Proteja seus dados exportando um backup em JSON.`,
      priority: 3,
      actionLabel: "Fazer Backup",
      actionRoute: "/backup",
      dismissable: true,
      context: "global",
      createdAt: Date.now(),
    });
  }

  if (unusedFeatures.includes("caixa/dashboard") && stats.cashEntries.length > 5) {
    suggestions.push({
      id: "try_financial_dashboard",
      category: "dica",
      title: "Dashboard Financeiro",
      message: "Voce tem lancamentos no caixa mas ainda nao viu o Dashboard Financeiro. Ele mostra faturamento comparativo, tendencias e ranking de funcionarios em tempo real!",
      priority: 2,
      actionLabel: "Ver Dashboard $",
      actionRoute: "/caixa/dashboard",
      dismissable: true,
      context: "caixa",
      createdAt: Date.now(),
    });
  }

  if (unusedFeatures.includes("ferramentas-clientes") && stats.clients.length > 20) {
    suggestions.push({
      id: "try_client_tools",
      category: "dica",
      title: "Ferramentas de Clientes",
      message: `Com ${stats.clients.length} clientes, voce pode ter duplicatas. As Ferramentas de Clientes detectam e mesclam duplicatas automaticamente, alem de importar de CSV/Excel.`,
      priority: 2,
      actionLabel: "Ver Ferramentas",
      actionRoute: "/ferramentas-clientes",
      dismissable: true,
      context: "clientes",
      createdAt: Date.now(),
    });
  }

  // ── 5. Insights de negocio ───────────────────────────────

  if (stats.inactiveClients.length > 3 && stats.clients.length > 5) {
    const pct = Math.round((stats.inactiveClients.length / stats.clients.length) * 100);
    suggestions.push({
      id: "inactive_clients",
      category: "insight",
      title: "Clientes inativos",
      message: `${stats.inactiveClients.length} clientes (${pct}%) nao visitam ha mais de 30 dias. Considere entrar em contato para reativa-los — uma mensagem de "sentimos sua falta" pode trazer ate 20% deles de volta!`,
      priority: 3,
      actionLabel: "Ver Clientes",
      actionRoute: "/clientes",
      dismissable: true,
      context: "clientes",
      createdAt: Date.now(),
    });
  }

  if (stats.cancelledThisMonth.length > 3) {
    const rate = stats.monthStats.cancelRate;
    suggestions.push({
      id: "high_cancel_rate",
      category: "alerta",
      title: "Taxa de cancelamento alta",
      message: `${stats.cancelledThisMonth.length} cancelamentos/faltas este mes (${rate.toFixed(1)}%). Considere enviar lembretes de confirmacao 24h antes ou cobrar sinal antecipado para reduzir no-shows.`,
      priority: 4,
      dismissable: true,
      context: "agenda",
      createdAt: Date.now(),
    });
  }

  if (stats.noPhone.length > 5 && stats.clients.length > 10) {
    suggestions.push({
      id: "clients_no_phone",
      category: "melhoria",
      title: "Clientes sem telefone",
      message: `${stats.noPhone.length} clientes nao tem telefone cadastrado. Atualizar os contatos facilita a comunicacao e permite enviar lembretes de agendamento.`,
      priority: 2,
      actionLabel: "Ver Clientes",
      actionRoute: "/clientes",
      dismissable: true,
      context: "clientes",
      createdAt: Date.now(),
    });
  }

  if (stats.monthStats.totalRevenue > 0 && stats.noMaterialCost.length > 0 && stats.noMaterialCost.length === stats.activeServices.length) {
    suggestions.push({
      id: "material_cost",
      category: "melhoria",
      title: "Custo de material",
      message: "Nenhum servico tem custo de material configurado. Se seus servicos usam produtos (tintas, cremes, etc.), configure o percentual de custo para ter uma visao real do lucro liquido.",
      priority: 2,
      actionLabel: "Configurar Servicos",
      actionRoute: "/servicos",
      dismissable: true,
      context: "servicos",
      createdAt: Date.now(),
    });
  }

  // ── 6. Dicas contextuais por pagina ──────────────────────

  if (currentPage.includes("agenda") && stats.todayAppts.length === 0 && stats.activeEmployees.length > 0) {
    suggestions.push({
      id: "empty_agenda_today",
      category: "dica",
      title: "Agenda vazia hoje",
      message: "Nenhum agendamento para hoje. Que tal entrar em contato com clientes que nao vem ha tempo? Clique em um horario vazio para criar um novo agendamento rapidamente.",
      priority: 1,
      dismissable: true,
      context: "agenda",
      createdAt: Date.now(),
    });
  }

  if (currentPage.includes("dashboard") && stats.monthStats.totalRevenue > 0) {
    const { start: prevStart, end: prevEnd } = getPeriodDates("mes");
    const prevMonthStart = new Date(prevStart);
    prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
    const prevMonthEnd = new Date(prevEnd);
    prevMonthEnd.setMonth(prevMonthEnd.getMonth() - 1);
    const prevAppts = getAppointmentsInPeriod(prevMonthStart, prevMonthEnd);
    const prevStats = calcPeriodStats(prevAppts, stats.employees);

    if (prevStats.totalRevenue > 0) {
      const delta = ((stats.monthStats.totalRevenue - prevStats.totalRevenue) / prevStats.totalRevenue) * 100;
      if (Math.abs(delta) > 10) {
        suggestions.push({
          id: "revenue_trend",
          category: "insight",
          title: delta > 0 ? "Faturamento em alta!" : "Faturamento em queda",
          message: delta > 0
            ? `O faturamento este mes esta ${delta.toFixed(0)}% acima do mes anterior. Otimo trabalho! Continue assim.`
            : `O faturamento este mes esta ${Math.abs(delta).toFixed(0)}% abaixo do mes anterior. Pode ser sazonal, mas vale analisar as causas nos Relatorios.`,
          priority: delta > 0 ? 2 : 3,
          actionLabel: "Ver Relatorios",
          actionRoute: "/relatorios",
          dismissable: true,
          context: "dashboard",
          createdAt: Date.now(),
        });
      }
    }
  }

  // ── 7. Dica de tempo de uso ──────────────────────────────

  const sessionDuration = getCurrentSessionDuration();
  if (sessionDuration > 30 * 60 * 1000) { // 30 min
    const timeByPage = getTimeByPage(1);
    const topPage = Object.entries(timeByPage).sort(([, a], [, b]) => b - a)[0];
    if (topPage) {
      const mins = Math.round(topPage[1] / 60000);
      if (mins > 15) {
        suggestions.push({
          id: "time_on_page",
          category: "insight",
          title: "Tempo na sessao",
          message: `Voce esta ha ${mins} minutos na secao "${featureLabel(topPage[0])}". Se esta encontrando dificuldade, me pergunte — posso ajudar a agilizar!`,
          priority: 1,
          dismissable: true,
          context: topPage[0],
          createdAt: Date.now(),
        });
      }
    }
  }

  // Filtra sugestoes ja descartadas
  return suggestions.filter(s => !dismissed.has(s.id));
}

// ─── Respostas do Agente a perguntas ───────────────────────

/**
 * Versao async que usa o orquestrador do Super Agente.
 */
export async function answerQuestionAsync(question: string): Promise<{ message: string; navigateTo?: string }> {
  try {
    const result = await handleUserMessage(question);
    if (result.handled) {
      return { message: result.text, navigateTo: result.navigateTo };
    }
  } catch {
    // Fallback
  }
  return { message: answerQuestion(question) };
}

export function answerQuestion(question: string): string {
  const q = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // ── 0. Verificar acao pendente ──
  const pendingAction = getLatestPendingAction();
  if (pendingAction) {
    if (isConfirmation(question)) {
      const result = executeAction(pendingAction.id);
      return result.message;
    }
    if (isDenial(question)) {
      const result = cancelPendingAction(pendingAction.id);
      return result.message;
    }
  }

  // ── 1. Comando de agenda ────────
  if (isAgendaActionCommand(question)) {
    const params = parseAgendaAction(question);
    if (params) {
      const result = prepareAction(params);
      return result.message;
    }
    return "Entendi que voce quer mexer na agenda, mas tente ser mais especifico como: 'Marca corte para Maria amanha as 10h'.";
  }

  // ── 2. Comando recorrente ──
  if (isScheduleCommand(question)) {
    const result = processCommand(question);
    if (result.understood) return result.message;
  }

  // ── 3. Relatorio on-demand ─────────────
  const report = generateOnDemandReport(question);
  if (report) return report;

  // ── 4. Tarefas ──────────
  if (/aviso|lembrete|tarefa.*agendad|notificac/.test(q)) {
    const tasks = listActiveTasks();
    if (tasks.length === 0) return "Voce nao tem avisos configurados.";
    const lines = tasks.map((t, i) => `${i + 1}. ${formatTaskDescription(t)}`);
    return `Voce tem **${tasks.length} aviso(s)** ativos:\n\n${lines.join("\n")}`;
  }

  const stats = getAppStats();

  // Faturamento
  if (q.includes("faturamento") || q.includes("receita") || q.includes("faturei")) {
    return `Este mes faturamos R$ ${stats.monthStats.totalRevenue.toFixed(2)}.`;
  }

  // Resposta generica
  return "Posso ajudar com faturamento, agenda e gestao do salao. O que deseja fazer?";
}

// ─── Mensagem de boas-vindas ───────────────────────────────

export function getWelcomeMessage(): AgentMessage {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return {
    id: genId("welcome"),
    role: "agent",
    content: `${greeting}! Sou o **Super Agente**. Posso gerenciar clientes, caixa, agenda e relatorios pelo chat. Como posso te ajudar hoje?`,
    timestamp: Date.now(),
  };
}

// ─── Processador de tarefas agendadas ──────────────────────

export function processScheduledTasks(): AgentMessage[] {
  const dueTasks = checkDueTasks();
  const messages: AgentMessage[] = [];

  for (const task of dueTasks) {
    const reportContent = generateReport(task.reportType, task.periodScope);
    const content = `**Aviso agendado: ${task.label}**\n\n${reportContent}`;
    addNotification(task.id, task.label, reportContent);
    sendBrowserNotification(`Dominio Pro — ${task.label}`, reportContent.substring(0, 100));
    messages.push({ id: genId("scheduled"), role: "agent", content, timestamp: Date.now() });
  }
  return messages;
}

export function getUnreadCount(): number {
  return getUnreadNotifications().length;
}

export function getProactiveSuggestion(): AgentMessage | null {
  const suggestions = generateSuggestions();
  if (suggestions.length === 0) return null;
  const top = suggestions.sort((a, b) => b.priority - a.priority)[0];
  return { id: genId("proactive"), role: "agent", content: `**${top.title}**\n\n${top.message}`, timestamp: Date.now(), suggestions: [top] };
}

export { dismissSuggestion };

/** Atualiza a pagina atual no contexto do agente */
export function updateAgentPage(page: string): void {
  setContextPage(page);
}

// ─── Labels ────────────────────────────────────────────────

function featureLabel(key: string): string {
  const labels: Record<string, string> = {
    "dashboard": "Dashboard",
    "agenda": "Agenda",
    "clientes": "Clientes",
    "caixa": "Caixa",
  };
  return labels[key] ?? key;
                                                    }
