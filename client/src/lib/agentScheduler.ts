/**
 * agentScheduler.ts — Sistema de tarefas agendadas/recorrentes.
 * Permite ao usuario configurar avisos e relatorios automaticos.
 * Ex: "me avisa todo sabado o rendimento da semana"
 *
 * Persistencia via localStorage. Verificacao periodica via setInterval.
 */

// ─── Tipos ─────────────────────────────────────────────────

export type TaskFrequency = "diario" | "semanal" | "mensal" | "unico";

export type ReportType =
  | "rendimento_bruto"
  | "rendimento_liquido"
  | "agendamentos"
  | "clientes"
  | "cancelamentos"
  | "servicos_populares"
  | "resumo_completo";

export interface ScheduledTask {
  id: string;
  label: string;                   // descricao legivel (ex: "Rendimento semanal todo sabado")
  frequency: TaskFrequency;
  dayOfWeek?: number;              // 0=Domingo ... 6=Sabado (para semanal)
  dayOfMonth?: number;             // 1-31 (para mensal)
  time: string;                    // "HH:mm" — horario de disparo
  reportType: ReportType;
  periodScope: "dia" | "semana" | "mes" | "mes_anterior";
  lastRun: number | null;          // timestamp do ultimo disparo
  nextRun: number;                 // timestamp do proximo disparo calculado
  active: boolean;
  createdAt: number;
  createdByCommand: string;        // texto original do usuario
}

export interface TaskNotification {
  id: string;
  taskId: string;
  taskLabel: string;
  content: string;                 // conteudo do relatorio gerado
  createdAt: number;
  read: boolean;
}

// ─── Storage Keys ──────────────────────────────────────────

const TASKS_KEY = "dominio_agent_scheduled_tasks";
const NOTIFICATIONS_KEY = "dominio_agent_notifications";

// ─── Helpers ───────────────────────────────────────────────

const DAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

let idCounter = 0;
function genTaskId(): string {
  return `task_${Date.now()}_${++idCounter}`;
}

function genNotifId(): string {
  return `notif_${Date.now()}_${++idCounter}`;
}

// ─── Persistence ───────────────────────────────────────────

export function loadTasks(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: ScheduledTask[]): void {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

export function loadNotifications(): TaskNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveNotifications(notifs: TaskNotification[]): void {
  try {
    // Manter somente as ultimas 100 notificacoes
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifs.slice(-100)));
  } catch { /* ignore */ }
}

// ─── Calculo de proximo disparo ────────────────────────────

export function calcNextRun(task: Pick<ScheduledTask, "frequency" | "dayOfWeek" | "dayOfMonth" | "time">): number {
  const now = new Date();
  const [hours, minutes] = task.time.split(":").map(Number);

  if (task.frequency === "diario") {
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (task.frequency === "semanal" && task.dayOfWeek !== undefined) {
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    const currentDay = target.getDay();
    let daysUntil = task.dayOfWeek - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && target.getTime() <= now.getTime()) daysUntil = 7;
    target.setDate(target.getDate() + daysUntil);
    return target.getTime();
  }

  if (task.frequency === "mensal" && task.dayOfMonth !== undefined) {
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    target.setDate(task.dayOfMonth);
    if (target.getTime() <= now.getTime()) {
      target.setMonth(target.getMonth() + 1);
    }
    return target.getTime();
  }

  // unico — proximo horario possivel
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

// ─── CRUD de tarefas ───────────────────────────────────────

export function createTask(params: {
  label: string;
  frequency: TaskFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  time?: string;
  reportType: ReportType;
  periodScope: "dia" | "semana" | "mes" | "mes_anterior";
  createdByCommand: string;
}): ScheduledTask {
  const time = params.time ?? "09:00";
  const task: ScheduledTask = {
    id: genTaskId(),
    label: params.label,
    frequency: params.frequency,
    dayOfWeek: params.dayOfWeek,
    dayOfMonth: params.dayOfMonth,
    time,
    reportType: params.reportType,
    periodScope: params.periodScope,
    lastRun: null,
    nextRun: calcNextRun({ frequency: params.frequency, dayOfWeek: params.dayOfWeek, dayOfMonth: params.dayOfMonth, time }),
    active: true,
    createdAt: Date.now(),
    createdByCommand: params.createdByCommand,
  };

  const tasks = loadTasks();
  tasks.push(task);
  saveTasks(tasks);

  return task;
}

export function removeTask(taskId: string): boolean {
  const tasks = loadTasks();
  const filtered = tasks.filter(t => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered);
  return true;
}

export function toggleTask(taskId: string): ScheduledTask | null {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.active = !task.active;
  if (task.active) {
    task.nextRun = calcNextRun(task);
  }
  saveTasks(tasks);
  return task;
}

export function listActiveTasks(): ScheduledTask[] {
  return loadTasks().filter(t => t.active);
}

export function listAllTasks(): ScheduledTask[] {
  return loadTasks();
}

// ─── Verificacao de tarefas prontas ────────────────────────

/**
 * Verifica quais tarefas devem disparar agora.
 * Retorna as tarefas que passaram do nextRun.
 * Atualiza lastRun e nextRun automaticamente.
 */
export function checkDueTasks(): ScheduledTask[] {
  const now = Date.now();
  const tasks = loadTasks();
  const dueTasks: ScheduledTask[] = [];

  for (const task of tasks) {
    if (!task.active) continue;
    if (task.nextRun <= now) {
      dueTasks.push({ ...task });
      task.lastRun = now;
      if (task.frequency === "unico") {
        task.active = false;
      } else {
        task.nextRun = calcNextRun(task);
      }
    }
  }

  if (dueTasks.length > 0) {
    saveTasks(tasks);
  }

  return dueTasks;
}

// ─── Notificacoes ──────────────────────────────────────────

export function addNotification(taskId: string, taskLabel: string, content: string): TaskNotification {
  const notif: TaskNotification = {
    id: genNotifId(),
    taskId,
    taskLabel,
    content,
    createdAt: Date.now(),
    read: false,
  };
  const notifs = loadNotifications();
  notifs.push(notif);
  saveNotifications(notifs);
  return notif;
}

export function markNotificationRead(notifId: string): void {
  const notifs = loadNotifications();
  const n = notifs.find(n => n.id === notifId);
  if (n) {
    n.read = true;
    saveNotifications(notifs);
  }
}

export function markAllNotificationsRead(): void {
  const notifs = loadNotifications();
  notifs.forEach(n => { n.read = true; });
  saveNotifications(notifs);
}

export function getUnreadNotifications(): TaskNotification[] {
  return loadNotifications().filter(n => !n.read);
}

export function getRecentNotifications(limit = 20): TaskNotification[] {
  return loadNotifications().slice(-limit);
}

// ─── Browser Notifications ────────────────────────────────

export function requestBrowserNotificationPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function sendBrowserNotification(title: string, body: string): void {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: "dominio-agent",
      });
    } catch { /* ignore — SW required in some browsers */ }
  }
}

// ─── Formatacao ────────────────────────────────────────────

export function formatTaskDescription(task: ScheduledTask): string {
  const freqMap: Record<TaskFrequency, string> = {
    diario: "Todo dia",
    semanal: `Toda ${DAY_NAMES[task.dayOfWeek ?? 0]}`,
    mensal: `Todo dia ${task.dayOfMonth ?? 1}`,
    unico: "Uma vez",
  };

  const reportMap: Record<ReportType, string> = {
    rendimento_bruto: "rendimento bruto",
    rendimento_liquido: "rendimento liquido",
    agendamentos: "resumo de agendamentos",
    clientes: "resumo de clientes",
    cancelamentos: "cancelamentos/faltas",
    servicos_populares: "servicos mais populares",
    resumo_completo: "resumo completo",
  };

  return `${freqMap[task.frequency]} as ${task.time} — ${reportMap[task.reportType]}`;
}

export { DAY_NAMES };
