/**
 * agentTracker.ts — Sistema de rastreamento de comportamento do usuario.
 * Observa navegacao, cliques, tempo em cada secao e acoes realizadas.
 * Dados ficam em memoria + localStorage para persistencia entre sessoes.
 */

// ─── Tipos ─────────────────────────────────────────────────

export interface PageVisit {
  path: string;
  enterTime: number;   // timestamp ms
  duration: number;    // ms
}

export interface ActionEvent {
  type: string;        // ex: "click", "create", "update", "delete", "search", "open_modal"
  target: string;      // ex: "appointment", "client", "cash_entry"
  page: string;        // path onde ocorreu
  timestamp: number;
  details?: string;    // info extra
}

export interface UsageSession {
  startTime: number;
  endTime: number;
  pagesVisited: string[];
  actionCount: number;
}

export interface TrackerSnapshot {
  pageVisits: PageVisit[];
  actions: ActionEvent[];
  sessions: UsageSession[];
  featureUsage: Record<string, number>;  // feature -> count
  lastActive: number;
  totalSessions: number;
}

// ─── Storage key ───────────────────────────────────────────

const STORAGE_KEY = "dominio_agent_tracker";
const MAX_VISITS = 500;
const MAX_ACTIONS = 1000;
const MAX_SESSIONS = 50;

// ─── State ─────────────────────────────────────────────────

let pageVisits: PageVisit[] = [];
let actions: ActionEvent[] = [];
let sessions: UsageSession[] = [];
let featureUsage: Record<string, number> = {};

let currentPage = "";
let currentPageEnter = 0;
let sessionStart = Date.now();
let sessionPages: Set<string> = new Set();
let sessionActionCount = 0;

// ─── Persistence ───────────────────────────────────────────

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: TrackerSnapshot = JSON.parse(raw);
    pageVisits = data.pageVisits ?? [];
    actions = data.actions ?? [];
    sessions = data.sessions ?? [];
    featureUsage = data.featureUsage ?? {};
  } catch { /* ignore */ }
}

function saveToStorage(): void {
  try {
    const snapshot: TrackerSnapshot = {
      pageVisits: pageVisits.slice(-MAX_VISITS),
      actions: actions.slice(-MAX_ACTIONS),
      sessions: sessions.slice(-MAX_SESSIONS),
      featureUsage,
      lastActive: Date.now(),
      totalSessions: sessions.length,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* ignore */ }
}

// ─── Tracking API ──────────────────────────────────────────

/** Registra navegacao para nova pagina */
export function trackPageVisit(path: string): void {
  const now = Date.now();

  // Fecha visita anterior
  if (currentPage && currentPageEnter > 0) {
    pageVisits.push({
      path: currentPage,
      enterTime: currentPageEnter,
      duration: now - currentPageEnter,
    });
  }

  currentPage = path;
  currentPageEnter = now;
  sessionPages.add(path);

  // Contabiliza feature usage
  const feature = pathToFeature(path);
  featureUsage[feature] = (featureUsage[feature] ?? 0) + 1;

  saveToStorage();
  window.dispatchEvent(new CustomEvent("agent:page_visit", { detail: { path } }));
}

/** Registra uma acao do usuario */
export function trackAction(type: string, target: string, details?: string): void {
  const event: ActionEvent = {
    type,
    target,
    page: currentPage,
    timestamp: Date.now(),
    details,
  };
  actions.push(event);
  sessionActionCount++;

  // Feature usage para acoes
  const key = `${type}_${target}`;
  featureUsage[key] = (featureUsage[key] ?? 0) + 1;

  saveToStorage();
  window.dispatchEvent(new CustomEvent("agent:action", { detail: event }));
}

/** Finaliza sessao atual (chamado no beforeunload) */
export function endSession(): void {
  // Fecha ultima pagina
  if (currentPage && currentPageEnter > 0) {
    pageVisits.push({
      path: currentPage,
      enterTime: currentPageEnter,
      duration: Date.now() - currentPageEnter,
    });
  }

  sessions.push({
    startTime: sessionStart,
    endTime: Date.now(),
    pagesVisited: Array.from(sessionPages),
    actionCount: sessionActionCount,
  });

  saveToStorage();
}

/** Inicializa o tracker */
export function initTracker(): void {
  loadFromStorage();
  sessionStart = Date.now();
  sessionPages = new Set();
  sessionActionCount = 0;

  window.addEventListener("beforeunload", endSession);
}

// ─── Query API (para o AgentBrain) ─────────────────────────

/** Retorna snapshot completo dos dados de tracking */
export function getTrackerSnapshot(): TrackerSnapshot {
  return {
    pageVisits: [...pageVisits],
    actions: [...actions],
    sessions: [...sessions],
    featureUsage: { ...featureUsage },
    lastActive: Date.now(),
    totalSessions: sessions.length,
  };
}

/** Tempo total gasto em cada pagina (ultimos N dias) */
export function getTimeByPage(days = 30): Record<string, number> {
  const cutoff = Date.now() - days * 86400000;
  const result: Record<string, number> = {};
  for (const visit of pageVisits) {
    if (visit.enterTime < cutoff) continue;
    const feature = pathToFeature(visit.path);
    result[feature] = (result[feature] ?? 0) + visit.duration;
  }
  return result;
}

/** Paginas mais visitadas */
export function getMostVisitedPages(days = 30): { page: string; visits: number; totalTime: number }[] {
  const cutoff = Date.now() - days * 86400000;
  const map: Record<string, { visits: number; totalTime: number }> = {};
  for (const visit of pageVisits) {
    if (visit.enterTime < cutoff) continue;
    const feature = pathToFeature(visit.path);
    if (!map[feature]) map[feature] = { visits: 0, totalTime: 0 };
    map[feature].visits++;
    map[feature].totalTime += visit.duration;
  }
  return Object.entries(map)
    .map(([page, data]) => ({ page, ...data }))
    .sort((a, b) => b.visits - a.visits);
}

/** Acoes recentes por tipo */
export function getRecentActions(limit = 50): ActionEvent[] {
  return actions.slice(-limit);
}

/** Contagem de acoes por tipo+target */
export function getActionCounts(days = 30): Record<string, number> {
  const cutoff = Date.now() - days * 86400000;
  const result: Record<string, number> = {};
  for (const action of actions) {
    if (action.timestamp < cutoff) continue;
    const key = `${action.type}_${action.target}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

/** Features nunca usadas */
export function getUnusedFeatures(): string[] {
  const allFeatures = [
    "dashboard", "agenda", "clientes", "funcionarios", "servicos",
    "caixa", "relatorios", "historico", "backup", "configuracoes",
    "ferramentas-clientes", "caixa/dashboard",
  ];
  return allFeatures.filter(f => !featureUsage[f] || featureUsage[f] < 2);
}

// ─── Tracking de comandos e tarefas agendadas ─────────────

/** Registra uso de comando (agendamento, cancelamento, listagem) */
export function trackCommand(commandType: string, details?: string): void {
  trackAction("command", commandType, details);
}

/** Registra disparo de tarefa agendada */
export function trackScheduledTaskFired(taskId: string, taskLabel: string): void {
  trackAction("scheduled_task_fired", taskId, taskLabel);
}

/** Registra interacao com notificacao */
export function trackNotificationInteraction(notifId: string, action: string): void {
  trackAction("notification", action, notifId);
}

/** Registra pedido de relatorio sob demanda */
export function trackReportRequest(reportType: string, scope: string): void {
  trackAction("report_request", reportType, scope);
}

/** Pagina atual */
export function getCurrentPage(): string {
  return currentPage;
}

/** Duracao da sessao atual em ms */
export function getCurrentSessionDuration(): number {
  return Date.now() - sessionStart;
}

// ─── Helpers ───────────────────────────────────────────────

function pathToFeature(path: string): string {
  const clean = path.replace(/^\/+/, "").split("?")[0];
  return clean || "dashboard";
}
