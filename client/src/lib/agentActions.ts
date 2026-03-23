/**
 * agentActions.ts — Sistema de acoes de escrita na agenda e dados do app.
 * Permite ao agente executar operacoes como mover, cancelar e reagendar agendamentos.
 *
 * IMPORTANTE: Todas as acoes destrutivas requerem confirmacao do usuario.
 * O fluxo e: parse -> preview -> confirmacao -> execucao.
 *
 * Exemplos:
 * - "Troque todos os agendamentos de Ana Maria de segunda para sabado dia 2"
 * - "Cancela os agendamentos de amanha"
 * - "Reagenda o horario das 14h de hoje para amanha as 15h"
 * - "Move os agendamentos do Joao de hoje para sexta"
 *
 * Ordem de prioridade no parseAgendaAction:
 *   1. cancel_appointments  (cancelar/desmarcar)
 *   2. change_employee      (trocar funcionario/profissional)
 *   3. move_appointments    (mover/transferir/reagendar — regex mais ampla, fica por ultimo)
 */

import {
  appointmentsStore,
  clientsStore,
  employeesStore,
} from "./store";

// ─── Tipos ─────────────────────────────────────────────────

export type ActionType =
  | "move_appointments"        // mover agendamentos de uma data para outra
  | "cancel_appointments"      // cancelar agendamentos
  | "reschedule_single"        // reagendar um agendamento especifico
  | "change_employee"          // trocar funcionario de agendamentos
  | "unknown_action";

export interface PendingAction {
  id: string;
  type: ActionType;
  description: string;           // descricao legivel do que sera feito
  details: string;               // detalhes completos para confirmacao
  affectedCount: number;         // quantos agendamentos serao afetados
  affectedAppointments: Array<{
    id: number;
    clientName: string;
    employeeName: string;
    serviceName: string;
    startTime: string;
    date: string;
  }>;
  params: ActionParams;
  status: "pending_confirmation" | "confirmed" | "executed" | "cancelled";
  createdAt: number;
}

export interface ActionParams {
  // Filtros para encontrar os agendamentos
  clientName?: string;
  employeeName?: string;
  sourceDate?: string;           // YYYY-MM-DD
  sourceDayOfWeek?: number;      // 0-6
  // Destino
  targetDate?: string;           // YYYY-MM-DD
  targetDayOfWeek?: number;      // 0-6
  targetTime?: string;           // HH:mm
  targetEmployeeName?: string;
  // Acao
  actionType: ActionType;
}

export interface ActionResult {
  success: boolean;
  message: string;
  pendingAction?: PendingAction;
}

// ─── Storage ───────────────────────────────────────────────

const PENDING_ACTIONS_KEY = "dominio_agent_pending_actions";

/** Tempo maximo (em ms) para uma acao pendente ser confirmada — 30 minutos */
const MAX_ACTION_AGE_MS = 30 * 60 * 1000;

function genActionId(): string {
  return `action_${Date.now()}_${crypto.randomUUID()}`;
}

function savePendingActions(actions: PendingAction[]): void {
  try {
    localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(actions.slice(-20)));
  } catch (err) {
    console.error("[agentActions] Falha ao salvar acoes pendentes:", err);
  }
}

function loadPendingActions(): PendingAction[] {
  try {
    const raw = localStorage.getItem(PENDING_ACTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("[agentActions] Falha ao carregar acoes pendentes:", err);
    return [];
  }
}

// ─── Helpers de data ───────────────────────────────────────

const DAY_NAMES_PT = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Converte Date para string YYYY-MM-DD usando horario LOCAL (nao UTC).
 * Evita o bug onde 22h em UTC-3 viraria o dia seguinte com toISOString().
 */
function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Extrai a parte YYYY-MM-DD de um ISO datetime usando horario LOCAL.
 */
function toLocalDateStr(isoString: string): string {
  const d = new Date(isoString);
  return toDateStr(d);
}

/**
 * Verifica se o texto normalizado contem um dia da semana como palavra inteira,
 * evitando falsos positivos (ex: nome "Domingos" contendo "domingo").
 */
function containsDayOfWeek(q: string, dayName: string): boolean {
  const regex = new RegExp(`\\b${dayName}\\b`);
  return regex.test(q);
}

function parseDateFromText(q: string, context: "source" | "target"): { date: string | null; dayOfWeek: number | null } {
  const now = new Date();

  // "hoje"
  if (q.includes("hoje")) {
    return { date: toDateStr(now), dayOfWeek: null };
  }

  // "amanha"
  if (q.includes("amanha")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: toDateStr(d), dayOfWeek: null };
  }

  // "dia X" ou "dia X/Y" ou "dia X de mes"
  const dayMonthMatch = q.match(/dia\s+(\d{1,2})(?:\s*(?:\/|de)\s*(\d{1,2}|\w+))?/);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    let month = now.getMonth();
    const year = now.getFullYear();

    if (dayMonthMatch[2]) {
      const monthStr = dayMonthMatch[2];
      const monthNum = parseInt(monthStr, 10);
      if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
        month = monthNum - 1;
      } else {
        const monthNames = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
          "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        const idx = monthNames.findIndex(m => monthStr.includes(m.substring(0, 3)));
        if (idx !== -1) month = idx;
      }
    }

    // Se a data ja passou neste mes, assume proximo mes (para target)
    const target = new Date(year, month, day);
    if (context === "target" && target < now) {
      target.setMonth(target.getMonth() + 1);
    }
    return { date: toDateStr(target), dayOfWeek: null };
  }

  // Dia da semana: "segunda", "sabado", etc. — com word boundary
  for (let i = 0; i < DAY_NAMES_PT.length; i++) {
    if (containsDayOfWeek(q, DAY_NAMES_PT[i])) {
      const targetDay = i;
      const currentDay = now.getDay();
      let daysUntil = targetDay - currentDay;
      if (context === "target") {
        if (daysUntil <= 0) daysUntil += 7;
      } else {
        // source: pode ser esta semana (passado incluso)
        if (daysUntil < 0) daysUntil += 7;
      }
      const d = new Date(now);
      d.setDate(d.getDate() + daysUntil);
      return { date: toDateStr(d), dayOfWeek: i };
    }
  }

  return { date: null, dayOfWeek: null };
}

function formatDatePT(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

// ─── Busca generica por nome ───────────────────────────────

/**
 * Busca generica por nome em uma lista de entidades.
 * Tenta: match exato → match parcial → match por partes do nome.
 */
function findByName<T extends { id: number; name: string }>(
  items: T[],
  name: string,
): { id: number; name: string } | null {
  const norm = normalize(name);

  // Busca exata
  let found = items.find(item => normalize(item.name) === norm);
  if (found) return { id: found.id, name: found.name };

  // Busca parcial
  found = items.find(item => normalize(item.name).includes(norm));
  if (found) return { id: found.id, name: found.name };

  // Busca por partes do nome
  const nameParts = norm.split(" ").filter(p => p.length > 2);
  if (nameParts.length > 0) {
    found = items.find(item => {
      const itemNorm = normalize(item.name);
      return nameParts.every(p => itemNorm.includes(p));
    });
    if (found) return { id: found.id, name: found.name };
  }

  return null;
}

function findClientByName(name: string): { id: number; name: string } | null {
  return findByName(clientsStore.list(), name);
}

function findEmployeeByName(name: string): { id: number; name: string } | null {
  return findByName(employeesStore.list(false), name);
}

// ─── Deteccao de intencao de acao na agenda ────────────────

export function isAgendaActionCommand(text: string): boolean {
  const q = normalize(text);
  const patterns = [
    /troqu?e?\s+.*agendamento/,
    /mov[ae]\s+.*agendamento/,
    /transfer[ei]\s+.*agendamento/,
    /reagend[ae]/,
    /remarqu?e?\s+.*agendamento/,
    /adi[ae]\s+.*agendamento/,
    /antecip[ae]\s+.*agendamento/,
    /mude?\s+.*agendamento/,
    /pass[ae]\s+.*agendamento/,
    /cancel[ae]\s+.*agendamento/,
    /desmarqu?e?\s+.*agendamento/,
    /troqu?e?\s+.*horario/,
    /mov[ae]\s+.*horario/,
    /mude?\s+.*horario/,
    /transfer[ei]\s+.*horario/,
    /antecip[ae]\s+.*horario/,
    /adi[ae]\s+.*horario/,
    /agendamento.*para\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|dia\s+\d)/,
    /troque?\s+.*d[aoe]\s+\w+.*para\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|dia\s+\d)/,
    /mov[ae]\s+.*d[aoe]\s+\w+.*para/,
    /transfer[ei]\s+.*d[aoe]\s+\w+.*para/,
    /troqu?e?\s+o\s+funcionario/,
    /mude?\s+o\s+profissional/,
    /troqu?e?\s+o\s+profissional/,
    /mude?\s+o\s+funcionario/,
  ];
  return patterns.some(p => p.test(q));
}

// ─── Parser de acao na agenda ──────────────────────────────

export function parseAgendaAction(text: string): ActionParams | null {
  const q = normalize(text);

  // ── 1. Cancelar agendamentos (prioridade mais alta) ──
  if (/cancel[ae]|desmarqu?e?/.test(q)) {
    const clientName = extractClientName(q);
    const { date: sourceDate } = parseDateFromText(q, "source");

    return {
      actionType: "cancel_appointments",
      clientName: clientName ?? undefined,
      sourceDate: sourceDate ?? undefined,
    };
  }

  // ── 2. Trocar funcionario ──
  if (/troqu?e?\s+o\s+(funcionario|profissional)|mude?\s+o\s+(funcionario|profissional)/.test(q)) {
    const names = extractTwoNames(q);
    const { date: sourceDate } = parseDateFromText(q, "source");

    return {
      actionType: "change_employee",
      employeeName: names?.from ?? undefined,
      targetEmployeeName: names?.to ?? undefined,
      sourceDate: sourceDate ?? undefined,
    };
  }

  // ── 3. Mover/transferir/trocar agendamentos (regex mais ampla, fica por ultimo) ──
  if (/troqu?e?|mov[ae]|transfer[ei]|reagend[ae]|remarqu?e?|pass[ae]|mude?|adi[ae]|antecip[ae]/.test(q)) {
    const clientName = extractClientName(q);
    const employeeName = extractEmployeeName(q);

    // Separar "de X para Y" para pegar as datas
    const deParaMatch = q.match(/(?:de|da|do)\s+(.+?)\s+(?:para|pro|pra)\s+(.+)/);

    let sourceDate: string | null = null;
    let targetDate: string | null = null;

    if (deParaMatch) {
      const sourcePart = deParaMatch[1];
      const targetPart = deParaMatch[2];

      const sourceResult = parseDateFromText(sourcePart, "source");
      const targetResult = parseDateFromText(targetPart, "target");

      sourceDate = sourceResult.date;
      targetDate = targetResult.date;
    } else {
      // Tentar extrair datas do texto completo
      const dates = extractDatesFromText(q);
      if (dates.length >= 2) {
        sourceDate = dates[0];
        targetDate = dates[1];
      } else if (dates.length === 1) {
        targetDate = dates[0]; // assume que quer mover para essa data
      }
    }

    // Extrair horario alvo — exige prefixo "as/a" ou sufixo "h" para evitar
    // falsos positivos com numeros de dia (ex: "dia 14" nao vira "14:00").
    const timeMatch = q.match(/(?:as?\s+)(\d{1,2}):(\d{2})|(?:as?\s+)(\d{1,2})\s*h\s*(\d{2})?|(\d{1,2})\s*h\s*(\d{2})/);
    let targetTime: string | undefined;
    if (timeMatch) {
      const h = parseInt(timeMatch[1] ?? timeMatch[3] ?? timeMatch[5], 10);
      const m = parseInt(timeMatch[2] ?? timeMatch[4] ?? timeMatch[6] ?? "0", 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        targetTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    }

    return {
      actionType: "move_appointments",
      clientName: clientName ?? undefined,
      employeeName: employeeName ?? undefined,
      sourceDate: sourceDate ?? undefined,
      targetDate: targetDate ?? undefined,
      targetTime,
    };
  }

  return null;
}

// ─── Extratores de nome ────────────────────────────────────

function extractClientName(q: string): string | null {
  // Padroes: "agendamentos de/da/do [NOME]", "de [NOME] de/da"
  // O texto ja esta normalizado (sem acentos), entao usamos apenas [a-z\s]
  const patterns = [
    /agendamentos?\s+d[aoe]\s+([a-z][a-z\s]+?)(?:\s+(?:de|da|do|para|pro|pra|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo))/,
    /d[aoe]\s+([a-z][a-z\s]{2,})(?:\s+(?:de|da|do|para|pro|pra|hoje|amanha))/,
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Verificar se e realmente um nome de cliente
      const client = findClientByName(name);
      if (client) return client.name;
    }
  }

  // Tentar com busca mais ampla — qualquer nome de cliente presente no texto
  const clients = clientsStore.list();
  for (const client of clients) {
    const clientNorm = normalize(client.name);
    // Se nome completo aparece no texto
    if (q.includes(clientNorm)) return client.name;
  }

  // Busca por partes do nome — exige que TODAS as partes (min 2) aparecam
  for (const client of clients) {
    const clientNorm = normalize(client.name);
    const nameParts = clientNorm.split(" ").filter(p => p.length > 2);
    if (nameParts.length >= 2) {
      const allPartsMatch = nameParts.every(p => q.includes(p));
      if (allPartsMatch) return client.name;
    }
  }

  return null;
}

function extractEmployeeName(q: string): string | null {
  const employees = employeesStore.list(false);

  // Match exato do nome completo primeiro
  for (const emp of employees) {
    const empNorm = normalize(emp.name);
    if (q.includes(empNorm)) return emp.name;
  }

  // Depois match por partes — exige que TODAS as partes aparecam
  for (const emp of employees) {
    const empNorm = normalize(emp.name);
    const parts = empNorm.split(" ").filter(p => p.length > 2);
    if (parts.length >= 2) {
      const allPartsMatch = parts.every(p => q.includes(p));
      if (allPartsMatch) return emp.name;
    }
  }

  return null;
}

function extractTwoNames(q: string): { from: string; to: string } | null {
  const match = q.match(/d[aoe]\s+(\w[\w\s]+?)\s+(?:para|por|pelo?)\s+(\w[\w\s]+?)(?:\s|$)/);
  if (match) {
    return { from: match[1].trim(), to: match[2].trim() };
  }
  return null;
}

/**
 * Extrai datas do texto de forma unificada, usando parseDateFromText internamente.
 * Retorna lista ordenada de datas encontradas (sem duplicatas).
 */
function extractDatesFromText(q: string): string[] {
  const dates: string[] = [];
  const now = new Date();

  if (q.includes("hoje")) dates.push(toDateStr(now));

  if (q.includes("amanha")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    dates.push(toDateStr(d));
  }

  for (let i = 0; i < DAY_NAMES_PT.length; i++) {
    if (containsDayOfWeek(q, DAY_NAMES_PT[i])) {
      const currentDay = now.getDay();
      let daysUntil = ((i - currentDay) + 7) % 7;
      // Se e o mesmo dia e ja temos outra data, assume proxima semana
      if (daysUntil === 0 && dates.length > 0) {
        daysUntil = 7;
      }
      const d = new Date(now);
      d.setDate(d.getDate() + daysUntil);
      const dateStr = toDateStr(d);
      if (!dates.includes(dateStr)) {
        dates.push(dateStr);
      }
    }
  }

  const dayMatch = q.match(/dia\s+(\d{1,2})/g);
  if (dayMatch) {
    for (const dm of dayMatch) {
      const day = parseInt(dm.replace("dia ", ""), 10);
      if (day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), now.getMonth(), day);
        if (d < now) d.setMonth(d.getMonth() + 1);
        const dateStr = toDateStr(d);
        if (!dates.includes(dateStr)) {
          dates.push(dateStr);
        }
      }
    }
  }

  return dates;
}

// ─── Preparacao de acao (preview) ──────────────────────────

export function prepareAction(params: ActionParams): ActionResult {
  const allAppts = appointmentsStore.list({});

  // Filtrar agendamentos afetados
  let filtered = allAppts.filter(a => a.status !== "cancelled" && a.status !== "no_show");

  // Filtrar por cliente
  if (params.clientName) {
    const client = findClientByName(params.clientName);
    if (!client) {
      return {
        success: false,
        message: `Nao encontrei nenhum cliente com o nome "${params.clientName}". Verifique o nome e tente novamente.`,
      };
    }
    filtered = filtered.filter(a => a.clientId === client.id);
  }

  // Filtrar por funcionario
  if (params.employeeName) {
    const emp = findEmployeeByName(params.employeeName);
    if (emp) {
      filtered = filtered.filter(a => a.employeeId === emp.id);
    }
  }

  // Filtrar por data de origem — usando horario LOCAL
  if (params.sourceDate) {
    filtered = filtered.filter(a => {
      const apptDate = toLocalDateStr(a.startTime);
      return apptDate === params.sourceDate;
    });
  }

  if (filtered.length === 0) {
    let details = "Nao encontrei agendamentos";
    if (params.clientName) details += ` de ${params.clientName}`;
    if (params.sourceDate) details += ` em ${formatDatePT(params.sourceDate)}`;
    details += ". Verifique os filtros e tente novamente.";
    return { success: false, message: details };
  }

  // Construir descricao
  const clients = clientsStore.list();
  const employees = employeesStore.list(false);

  const affectedAppointments = filtered.map(a => {
    const client = clients.find(c => c.id === a.clientId);
    const emp = employees.find(e => e.id === a.employeeId);
    const serviceNames = (a.services ?? [])
      .map((s: { name?: string }) => s.name ?? "Sem nome")
      .join(", ");
    const apptDate = new Date(a.startTime);
    return {
      id: a.id,
      clientName: client?.name ?? "Cliente desconhecido",
      employeeName: emp?.name ?? "Funcionario desconhecido",
      serviceName: serviceNames || "Servico",
      startTime: apptDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      date: apptDate.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }),
    };
  });

  let description = "";
  let details = "";

  switch (params.actionType) {
    case "move_appointments": {
      const targetLabel = params.targetDate ? formatDatePT(params.targetDate) : "data nao especificada";
      description = `Mover ${filtered.length} agendamento(s) para ${targetLabel}`;
      if (params.clientName) description = `Mover agendamentos de ${params.clientName} para ${targetLabel}`;

      details = `**Agendamentos que serao movidos:**\n\n`;
      affectedAppointments.forEach((a, i) => {
        details += `${i + 1}. ${a.clientName} — ${a.serviceName} (${a.date} ${a.startTime}) com ${a.employeeName}\n`;
      });
      details += `\n**Destino:** ${targetLabel}`;
      if (params.targetTime) {
        details += ` as ${params.targetTime}`;
        if (affectedAppointments.length > 1) {
          details += `\n\n⚠️ **Atencao:** O horario ${params.targetTime} sera aplicado apenas ao primeiro agendamento. Os demais serao distribuidos sequencialmente para evitar sobreposicao.`;
        }
      }
      break;
    }

    case "cancel_appointments": {
      description = `Cancelar ${filtered.length} agendamento(s)`;
      if (params.clientName) description = `Cancelar agendamentos de ${params.clientName}`;

      details = `**Agendamentos que serao cancelados:**\n\n`;
      affectedAppointments.forEach((a, i) => {
        details += `${i + 1}. ${a.clientName} — ${a.serviceName} (${a.date} ${a.startTime}) com ${a.employeeName}\n`;
      });
      break;
    }

    case "change_employee": {
      const targetEmpName = params.targetEmployeeName ?? "nao especificado";
      description = `Trocar funcionario para ${targetEmpName} em ${filtered.length} agendamento(s)`;

      details = `**Agendamentos afetados:**\n\n`;
      affectedAppointments.forEach((a, i) => {
        details += `${i + 1}. ${a.clientName} — ${a.serviceName} (${a.date} ${a.startTime})\n`;
      });
      details += `\n**Novo funcionario:** ${targetEmpName}`;
      break;
    }

    default:
      return { success: false, message: "Tipo de acao nao reconhecido." };
  }

  const pendingAction: PendingAction = {
    id: genActionId(),
    type: params.actionType,
    description,
    details,
    affectedCount: filtered.length,
    affectedAppointments,
    params,
    status: "pending_confirmation",
    createdAt: Date.now(),
  };

  // Salvar acao pendente
  const pending = loadPendingActions();
  pending.push(pendingAction);
  savePendingActions(pending);

  return {
    success: true,
    message: `${details}\n\n**Deseja confirmar esta acao?** Responda "sim" ou "confirma" para executar, ou "nao" para cancelar.`,
    pendingAction,
  };
}

// ─── Execucao de acao confirmada ───────────────────────────

export function executeAction(actionId: string): ActionResult {
  const pending = loadPendingActions();
  const action = pending.find(a => a.id === actionId);

  if (!action) {
    return { success: false, message: "Acao nao encontrada." };
  }

  if (action.status !== "pending_confirmation") {
    return { success: false, message: "Esta acao ja foi processada." };
  }

  // Verificar se a acao expirou
  if (Date.now() - action.createdAt > MAX_ACTION_AGE_MS) {
    action.status = "cancelled";
    savePendingActions(pending);
    return {
      success: false,
      message: "Esta acao expirou (mais de 30 minutos). Por favor, solicite novamente.",
    };
  }

  const params = action.params;

  try {
    switch (params.actionType) {
      case "move_appointments": {
        if (!params.targetDate) {
          return { success: false, message: "Data de destino nao especificada." };
        }

        // Verificar conflitos de horario no destino
        const allAppts = appointmentsStore.list({});
        const targetDateAppts = allAppts.filter(a => {
          if (a.status === "cancelled" || a.status === "no_show") return false;
          const apptDate = toLocalDateStr(a.startTime);
          return apptDate === params.targetDate;
        });
        const affectedIds = new Set(action.affectedAppointments.map(a => a.id));
        const existingTargetAppts = targetDateAppts.filter(a => !affectedIds.has(a.id));

        // Ordenar agendamentos afetados por horario original
        const sortedAffected = [...action.affectedAppointments].sort((a, b) => {
          const timeA = a.startTime;
          const timeB = b.startTime;
          return timeA.localeCompare(timeB);
        });

        let movedCount = 0;
        let nextAvailableTime: Date | null = null;

        for (const affected of sortedAffected) {
          const appt = appointmentsStore.get(affected.id);
          if (!appt) continue;

          const oldStart = new Date(appt.startTime);
          const oldEnd = new Date(appt.endTime);
          const duration = oldEnd.getTime() - oldStart.getTime();

          const [year, month, day] = params.targetDate.split("-").map(Number);
          const newStart = new Date(year, month - 1, day, oldStart.getHours(), oldStart.getMinutes());

          // Se tem horario especifico
          if (params.targetTime) {
            if (movedCount === 0) {
              // Primeiro agendamento: usa o horario especificado
              const [h, m] = params.targetTime.split(":").map(Number);
              newStart.setHours(h, m, 0, 0);
            } else if (nextAvailableTime) {
              // Agendamentos subsequentes: distribui sequencialmente
              newStart.setTime(nextAvailableTime.getTime());
            }
          }

          const newEnd = new Date(newStart.getTime() + duration);

          // Verificar conflito com agendamentos existentes no destino
          const hasConflict = existingTargetAppts.some(existing => {
            const existStart = new Date(existing.startTime).getTime();
            const existEnd = new Date(existing.endTime).getTime();
            return newStart.getTime() < existEnd && newEnd.getTime() > existStart;
          });

          if (hasConflict) {
            // Se ha conflito, nao mover e avisar
            action.status = "cancelled";
            savePendingActions(pending);
            return {
              success: false,
              message: `Conflito de horario detectado para ${affected.clientName} no destino (${newStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}). Nenhum agendamento foi movido. Escolha outro horario ou data.`,
            };
          }

          appointmentsStore.update(affected.id, {
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
          });

          // Preparar proximo horario disponivel
          nextAvailableTime = newEnd;

          movedCount++;
        }

        action.status = "executed";
        savePendingActions(pending);

        return {
          success: true,
          message: `Pronto! ${movedCount} agendamento(s) movido(s) para ${formatDatePT(params.targetDate)}${params.targetTime ? ` a partir das ${params.targetTime}` : ""}.`,
        };
      }

      case "cancel_appointments": {
        let cancelledCount = 0;
        for (const affected of action.affectedAppointments) {
          appointmentsStore.update(affected.id, { status: "cancelled" });
          cancelledCount++;
        }

        action.status = "executed";
        savePendingActions(pending);

        return {
          success: true,
          message: `Pronto! ${cancelledCount} agendamento(s) cancelado(s).`,
        };
      }

      case "change_employee": {
        if (!params.targetEmployeeName) {
          return { success: false, message: "Nome do novo funcionario nao especificado." };
        }

        const newEmp = findEmployeeByName(params.targetEmployeeName);
        if (!newEmp) {
          return { success: false, message: `Funcionario "${params.targetEmployeeName}" nao encontrado.` };
        }

        let changedCount = 0;
        for (const affected of action.affectedAppointments) {
          appointmentsStore.update(affected.id, { employeeId: newEmp.id });
          changedCount++;
        }

        action.status = "executed";
        savePendingActions(pending);

        return {
          success: true,
          message: `Pronto! ${changedCount} agendamento(s) transferido(s) para ${newEmp.name}.`,
        };
      }

      default:
        return { success: false, message: "Tipo de acao nao suportado." };
    }
  } catch (err) {
    console.error("[agentActions] Erro ao executar acao:", err);
    return { success: false, message: `Erro ao executar acao: ${String(err)}` };
  }
}

// ─── Cancelar acao pendente ────────────────────────────────

export function cancelPendingAction(actionId: string): ActionResult {
  const pending = loadPendingActions();
  const action = pending.find(a => a.id === actionId);
  if (!action) {
    return { success: false, message: "Acao nao encontrada." };
  }

  action.status = "cancelled";
  savePendingActions(pending);

  return { success: true, message: "Acao cancelada. Nenhuma alteracao foi feita." };
}

// ─── Obter acao pendente mais recente ──────────────────────

export function getLatestPendingAction(): PendingAction | null {
  const pending = loadPendingActions();
  const active = pending.filter(a => {
    if (a.status !== "pending_confirmation") return false;
    // Ignorar acoes expiradas
    if (Date.now() - a.createdAt > MAX_ACTION_AGE_MS) return false;
    return true;
  });
  return active.length > 0 ? active[active.length - 1] : null;
}

// ─── Verificar se texto e confirmacao ──────────────────────

export function isConfirmation(text: string): boolean {
  const q = normalize(text);
  return /\b(sim|confirma|confirmo|pode|ok|faz|executa|vai|manda|bora|claro|com certeza|pode sim|sim pode|confirmar)\b/.test(q);
}

export function isDenial(text: string): boolean {
  const q = normalize(text);
  return /\b(nao|cancela|cancelar|nao quero|deixa|para|nao pode|negativo|nao faz)\b/.test(q);
}
