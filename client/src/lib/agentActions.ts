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
 * - "Agenda um corte para Ana Maria na sexta as 14h com a Joana"
 * - "Marca um horario para o Joao amanha as 10h, escova progressiva"
 * - "Cria um agendamento para hoje as 16h para Maria, manicure com Carla"
 */

import {
  appointmentsStore,
  clientsStore,
  employeesStore,
  servicesStore,
} from "./store";

// ─── Tipos ─────────────────────────────────────────────────

export type ActionType =
  | "move_appointments"        // mover agendamentos de uma data para outra
  | "cancel_appointments"      // cancelar agendamentos
  | "reschedule_single"        // reagendar um agendamento especifico
  | "change_employee"          // trocar funcionario de agendamentos
  | "create_appointment"       // criar novo agendamento
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
  // Para criacao de agendamento
  serviceName?: string;
  duration?: number;             // minutos
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

let idCounter = 0;
function genActionId(): string {
  return `action_${Date.now()}_${++idCounter}`;
}

function savePendingActions(actions: PendingAction[]): void {
  try {
    localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(actions.slice(-20)));
  } catch { /* ignore */ }
}

function loadPendingActions(): PendingAction[] {
  try {
    const raw = localStorage.getItem(PENDING_ACTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── Helpers de data ───────────────────────────────────────

const DAY_NAMES_PT = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const DAY_NAMES_FULL = ["domingo", "segunda-feira", "terca-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sabado"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    let year = now.getFullYear();

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

  // Dia da semana: "segunda", "sabado", etc.
  for (let i = 0; i < DAY_NAMES_PT.length; i++) {
    if (q.includes(DAY_NAMES_PT[i])) {
      // Calcula proxima ocorrencia desse dia
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

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatDatePT(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

// ─── Busca de clientes/funcionarios por nome ───────────────

function findClientByName(name: string): { id: number; name: string } | null {
  const clients = clientsStore.list();
  const norm = normalize(name);

  // Busca exata
  let found = clients.find(c => normalize(c.name) === norm);
  if (found) return { id: found.id, name: found.name };

  // Busca parcial
  found = clients.find(c => normalize(c.name).includes(norm));
  if (found) return { id: found.id, name: found.name };

  // Busca por partes do nome
  const nameParts = norm.split(" ").filter(p => p.length > 2);
  found = clients.find(c => {
    const cNorm = normalize(c.name);
    return nameParts.every(p => cNorm.includes(p));
  });
  if (found) return { id: found.id, name: found.name };

  return null;
}

function findEmployeeByName(name: string): { id: number; name: string } | null {
  const employees = employeesStore.list(false);
  const norm = normalize(name);

  let found = employees.find(e => normalize(e.name) === norm);
  if (found) return { id: found.id, name: found.name };

  found = employees.find(e => normalize(e.name).includes(norm));
  if (found) return { id: found.id, name: found.name };

  const nameParts = norm.split(" ").filter(p => p.length > 2);
  found = employees.find(e => {
    const eNorm = normalize(e.name);
    return nameParts.every(p => eNorm.includes(p));
  });
  if (found) return { id: found.id, name: found.name };

  return null;
}

// ─── Busca de servico por nome ─────────────────────────────

function findServiceByName(name: string): { id: number; name: string; duration: number; price: number } | null {
  const services = servicesStore.list();
  const norm = normalize(name);

  // Busca exata
  let found = services.find(s => normalize(s.name) === norm);
  if (found) return { id: found.id, name: found.name, duration: found.duration ?? 60, price: found.price ?? 0 };

  // Busca parcial
  found = services.find(s => normalize(s.name).includes(norm));
  if (found) return { id: found.id, name: found.name, duration: found.duration ?? 60, price: found.price ?? 0 };

  // Busca por parte do nome
  found = services.find(s => norm.includes(normalize(s.name)));
  if (found) return { id: found.id, name: found.name, duration: found.duration ?? 60, price: found.price ?? 0 };

  // Busca fuzzy por palavras
  const nameParts = norm.split(" ").filter(p => p.length > 2);
  if (nameParts.length > 0) {
    found = services.find(s => {
      const sNorm = normalize(s.name);
      return nameParts.some(p => sNorm.includes(p));
    });
    if (found) return { id: found.id, name: found.name, duration: found.duration ?? 60, price: found.price ?? 0 };
  }

  return null;
}

// ─── Deteccao de intencao de acao na agenda ────────────────

export function isAgendaActionCommand(text: string): boolean {
  const q = normalize(text);
  const patterns = [
    // Mover/transferir
    /troqu?e?\s+.*agendamento/,
    /mov[ae]\s+.*agendamento/,
    /transfer[ei]\s+.*agendamento/,
    /reagend[ae]/,
    /mude?\s+.*agendamento/,
    /pass[ae]\s+.*agendamento/,
    // Cancelar
    /cancel[ae]\s+.*agendamento/,
    /desmarqu?e?\s+.*agendamento/,
    // Mover horario
    /troqu?e?\s+.*horario/,
    /mov[ae]\s+.*horario/,
    /transfer[ei]\s+.*horario/,
    // Com datas
    /agendamento.*para\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|dia\s+\d)/,
    /troque?\s+.*d[aoe]\s+\w+.*para\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|dia\s+\d)/,
    /mov[ae]\s+.*d[aoe]\s+\w+.*para/,
    /transfer[ei]\s+.*d[aoe]\s+\w+.*para/,
    // Trocar funcionario
    /troqu?e?\s+o\s+funcionario/,
    /mude?\s+o\s+profissional/,
    // NOVO: Criar agendamento
    /agend[ae]\s+(um|uma|o|a)?/,
    /marc[ae]\s+(um|uma|o|a)?\s*(horario|agendamento|atendimento)/,
    /marc[ae]\s+(um|uma)\s/,
    /cri[ae]\s+(um|uma)?\s*(agendamento|horario|atendimento)/,
    /faz\s+(um|uma)?\s*(agendamento|horario)/,
    /marqu?e?\s+(um|uma)?\s*(horario|agendamento)/,
    /coloc[ae]\s+(um|uma)?\s*(agendamento|horario)/,
    /encaix[ae]/,
    /agenda\s+para/,
    /marca\s+para/,
    /agendar\s/,
    /marcar\s+(um|uma)?\s/,
  ];
  return patterns.some(p => p.test(q));
}

// ─── Parser de acao na agenda ──────────────────────────────

export function parseAgendaAction(text: string): ActionParams | null {
  const q = normalize(text);

  // ── Cancelar agendamentos ──
  if (/cancel[ae]|desmarqu?e?/.test(q) && !isCreateIntent(q)) {
    const clientName = extractClientName(q);
    const { date: sourceDate } = parseDateFromText(q, "source");

    return {
      actionType: "cancel_appointments",
      clientName: clientName ?? undefined,
      sourceDate: sourceDate ?? undefined,
    };
  }

  // ── Trocar funcionario ──
  if (/troqu?e?\s+o\s+(funcionario|profissional)/.test(q)) {
    const names = extractTwoNames(q);
    const { date: sourceDate } = parseDateFromText(q, "source");

    return {
      actionType: "change_employee",
      employeeName: names?.from ?? undefined,
      targetEmployeeName: names?.to ?? undefined,
      sourceDate: sourceDate ?? undefined,
    };
  }

  // ── NOVO: Criar agendamento ──
  if (isCreateIntent(q)) {
    return parseCreateAppointment(q);
  }

  // ── Mover/transferir/trocar/reagendar agendamentos ──
  if (/troqu?e?|mov[ae]|transfer[ei]|reagend[ae]|pass[ae]|mude?/.test(q)) {
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

    // Extrair horario alvo
    const timeMatch = q.match(/(?:as?\s+)?(\d{1,2}):(\d{2})|(?:as?\s+)?(\d{1,2})\s*h\s*(\d{2})?/);
    let targetTime: string | undefined;
    if (timeMatch) {
      const h = parseInt(timeMatch[1] ?? timeMatch[3], 10);
      const m = parseInt(timeMatch[2] ?? timeMatch[4] ?? "0", 10);
      if (h >= 0 && h <= 23) {
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

// ─── Deteccao de intencao de criacao ───────────────────────

function isCreateIntent(q: string): boolean {
  return /agend[ae]\s+(um|uma|o|a)?|marc[ae]\s+(um|uma)|cri[ae]\s+(um|uma)?\s*(agendamento|horario|atendimento)|faz\s+(um|uma)?\s*(agendamento|horario)|marqu?e?\s+(um|uma)|coloc[ae]\s+(um|uma)|encaix[ae]|agenda\s+para|marca\s+para|agendar\s|marcar\s/.test(q);
}

// ─── Parser para criacao de agendamento ────────────────────

function parseCreateAppointment(q: string): ActionParams {
  // Extrair cliente
  const clientName = extractClientNameForCreation(q) ?? extractClientName(q);

  // Extrair funcionario
  const employeeName = extractEmployeeNameForCreation(q) ?? extractEmployeeName(q);

  // Extrair servico
  const serviceName = extractServiceName(q);

  // Extrair data
  const { date: targetDate } = parseDateFromText(q, "target");

  // Extrair horario
  let targetTime: string | undefined;
  // Tentar varios padroes de horario
  const timePatterns = [
    /(?:as?|para\s+as?)\s+(\d{1,2}):(\d{2})/,
    /(?:as?|para\s+as?)\s+(\d{1,2})\s*h\s*(\d{2})?/,
    /(\d{1,2}):(\d{2})/,
    /(\d{1,2})\s*h\s*(\d{2})?/,
  ];
  for (const pattern of timePatterns) {
    const match = q.match(pattern);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2] ?? "0", 10);
      if (h >= 6 && h <= 22) { // horarios razoaveis para salao
        targetTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        break;
      }
    }
  }

  return {
    actionType: "create_appointment",
    clientName: clientName ?? undefined,
    employeeName: employeeName ?? undefined,
    serviceName: serviceName ?? undefined,
    targetDate: targetDate ?? toDateStr(new Date()), // default: hoje
    targetTime,
  };
}

// ─── Extratores de nome para criacao ───────────────────────

function extractClientNameForCreation(q: string): string | null {
  // Padroes: "para [NOME]", "da/do/de [NOME]"
  const patterns = [
    /(?:para|pra|pro)\s+(?:a\s+|o\s+)?([A-Za-z\u00C0-\u024F][\w\s\u00C0-\u024F]+?)(?:\s+(?:na|no|em|as?|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|dia|,|$))/i,
    /(?:d[aoe])\s+([A-Za-z\u00C0-\u024F][\w\s\u00C0-\u024F]+?)(?:\s+(?:na|no|em|as?|para|pro|pra|hoje|amanha|,|$))/i,
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Verificar se e um cliente cadastrado
      const client = findClientByName(name);
      if (client) return client.name;
    }
  }

  // Busca ampla por nome de cliente no texto
  const clients = clientsStore.list();
  for (const client of clients) {
    const clientNorm = normalize(client.name);
    if (q.includes(clientNorm)) return client.name;
    const parts = clientNorm.split(" ").filter(p => p.length > 2);
    if (parts.length >= 2 && parts.filter(p => q.includes(p)).length >= 2) return client.name;
  }

  return null;
}

function extractEmployeeNameForCreation(q: string): string | null {
  // Padroes: "com [NOME]", "com a/o [NOME]"
  const match = q.match(/com\s+(?:a\s+|o\s+)?([A-Za-z\u00C0-\u024F][\w\s\u00C0-\u024F]+?)(?:\s*$|\s+(?:na|no|as?|em|,))/i);
  if (match && match[1]) {
    const name = match[1].trim();
    const emp = findEmployeeByName(name);
    if (emp) return emp.name;
  }
  return extractEmployeeName(q);
}

function extractServiceName(q: string): string | null {
  // Tentar busca direta nos servicos cadastrados
  const services = servicesStore.list();
  for (const svc of services) {
    const svcNorm = normalize(svc.name);
    if (q.includes(svcNorm)) return svc.name;
    // Busca parcial
    const parts = svcNorm.split(" ").filter(p => p.length > 3);
    if (parts.length > 0 && parts.some(p => q.includes(p))) return svc.name;
  }

  // Padroes comuns: "um corte", "uma escova", "manicure"
  const servicePatterns = [
    /(?:agend[ae]|marc[ae]|cri[ae]|faz|marqu?e?|coloc[ae])\s+(?:um|uma)\s+([\w\s\u00C0-\u024F]+?)(?:\s+(?:para|pra|pro|com|na|no|as?|em|hoje|amanha)|,|$)/i,
    /,\s*([\w\s\u00C0-\u024F]+?)(?:\s+(?:com|na|no|as?)|$)/i,
  ];
  for (const pattern of servicePatterns) {
    const match = q.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      const svc = findServiceByName(name);
      if (svc) return svc.name;
    }
  }

  return null;
}

// ─── Extratores de nome ────────────────────────────────────

function extractClientName(q: string): string | null {
  // Padroes: "agendamentos de/da/do [NOME]", "de [NOME] de/da"
  const patterns = [
    /agendamentos?\s+d[aoe]\s+([A-Za-z\u00C0-\u024F][\w\s\u00C0-\u024F]+?)(?:\s+(?:de|da|do|para|pro|pra|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo))/i,
    /d[aoe]\s+([A-Za-z\u00C0-\u024F][\w\s\u00C0-\u024F]{2,})(?:\s+(?:de|da|do|para|pro|pra|hoje|amanha))/i,
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

  // Tentar com busca mais ampla — qualquer nome proprio no texto
  const clients = clientsStore.list();
  for (const client of clients) {
    const clientNorm = normalize(client.name);
    const nameParts = clientNorm.split(" ").filter(p => p.length > 2);
    // Se pelo menos 2 partes do nome aparecem no texto
    if (nameParts.length >= 2) {
      const matchCount = nameParts.filter(p => q.includes(p)).length;
      if (matchCount >= 2) return client.name;
    }
    // Se nome completo aparece
    if (q.includes(clientNorm)) return client.name;
  }

  return null;
}

function extractEmployeeName(q: string): string | null {
  const employees = employeesStore.list(false);
  for (const emp of employees) {
    const empNorm = normalize(emp.name);
    if (q.includes(empNorm)) return emp.name;
    const parts = empNorm.split(" ").filter(p => p.length > 2);
    if (parts.length >= 2) {
      const matchCount = parts.filter(p => q.includes(p)).length;
      if (matchCount >= 2) return emp.name;
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
    if (q.includes(DAY_NAMES_PT[i])) {
      const daysUntil = ((i - now.getDay()) + 7) % 7 || 7;
      const d = new Date(now);
      d.setDate(d.getDate() + (daysUntil === 7 && dates.length === 0 ? 0 : daysUntil));
      dates.push(toDateStr(d));
    }
  }

  const dayMatch = q.match(/dia\s+(\d{1,2})/g);
  if (dayMatch) {
    for (const dm of dayMatch) {
      const day = parseInt(dm.replace("dia ", ""), 10);
      if (day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), now.getMonth(), day);
        if (d < now) d.setMonth(d.getMonth() + 1);
        dates.push(toDateStr(d));
      }
    }
  }

  return dates;
}

// ─── Preparacao de acao (preview) ──────────────────────────

export function prepareAction(params: ActionParams): ActionResult {
  // ── Criar novo agendamento (fluxo especial) ──
  if (params.actionType === "create_appointment") {
    return prepareCreateAppointment(params);
  }

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

  // Filtrar por data de origem
  if (params.sourceDate) {
    filtered = filtered.filter(a => {
      const apptDate = new Date(a.startTime).toISOString().split("T")[0];
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
    const serviceNames = (a.services ?? []).map((s: { name: string }) => s.name).join(", ");
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
      if (params.targetTime) details += ` as ${params.targetTime}`;
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

// ─── Preparar criacao de agendamento (preview) ─────────────

function prepareCreateAppointment(params: ActionParams): ActionResult {
  // Validar campos obrigatorios
  const missing: string[] = [];
  if (!params.clientName) missing.push("cliente (ex: para Ana Maria)");
  if (!params.targetTime) missing.push("horario (ex: as 14h)");

  if (missing.length > 0) {
    return {
      success: false,
      message: `Para criar um agendamento, preciso de mais informacoes:\n\n` +
        missing.map(m => `- **${m}**`).join("\n") +
        `\n\nExemplo: "Agenda um corte para Ana Maria na sexta as 14h com a Joana"`,
    };
  }

  // Buscar cliente
  const client = findClientByName(params.clientName!);
  if (!client) {
    return {
      success: false,
      message: `Nao encontrei o cliente "${params.clientName}". Verifique o nome e tente novamente.`,
    };
  }

  // Buscar funcionario (opcional)
  let employee: { id: number; name: string } | null = null;
  if (params.employeeName) {
    employee = findEmployeeByName(params.employeeName);
    if (!employee) {
      return {
        success: false,
        message: `Nao encontrei o profissional "${params.employeeName}". Verifique o nome e tente novamente.`,
      };
    }
  } else {
    // Pegar primeiro funcionario ativo como padrao
    const emps = employeesStore.list(false);
    if (emps.length > 0) employee = { id: emps[0].id, name: emps[0].name };
  }

  // Buscar servico (opcional)
  let service: { id: number; name: string; duration: number; price: number } | null = null;
  if (params.serviceName) {
    service = findServiceByName(params.serviceName);
  }

  // Data e horario
  const targetDate = params.targetDate ?? toDateStr(new Date());
  const targetTime = params.targetTime!;
  const dateLabel = formatDatePT(targetDate);

  // Duracao
  const duration = service?.duration ?? params.duration ?? 60;

  // Calcular horarios
  const [h, m] = targetTime.split(":").map(Number);
  const [year, month, day] = targetDate.split("-").map(Number);
  const startTime = new Date(year, month - 1, day, h, m, 0, 0);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

  // Construir descricao do preview
  const description = `Criar agendamento para ${client.name}`;
  let details = `**Novo agendamento:**\n\n`;
  details += `- **Cliente:** ${client.name}\n`;
  if (service) {
    details += `- **Servico:** ${service.name} (${duration} min — R$ ${service.price.toFixed(2)})\n`;
  } else {
    details += `- **Servico:** Nao especificado (${duration} min)\n`;
  }
  details += `- **Profissional:** ${employee?.name ?? "A definir"}\n`;
  details += `- **Data:** ${dateLabel}\n`;
  details += `- **Horario:** ${targetTime} - ${endTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}\n`;

  const pendingAction: PendingAction = {
    id: genActionId(),
    type: "create_appointment",
    description,
    details,
    affectedCount: 1,
    affectedAppointments: [{
      id: 0, // sera criado
      clientName: client.name,
      employeeName: employee?.name ?? "A definir",
      serviceName: service?.name ?? "Servico geral",
      startTime: targetTime,
      date: dateLabel,
    }],
    params: {
      ...params,
      clientName: client.name,
      employeeName: employee?.name ?? undefined,
      serviceName: service?.name ?? undefined,
      targetDate,
      targetTime,
      duration,
    },
    status: "pending_confirmation",
    createdAt: Date.now(),
  };

  // Salvar acao pendente
  const pending = loadPendingActions();
  pending.push(pendingAction);
  savePendingActions(pending);

  return {
    success: true,
    message: `${details}\n**Deseja confirmar este agendamento?** Responda "sim" ou "confirma" para criar, ou "nao" para cancelar.`,
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

  const params = action.params;

  try {
    switch (params.actionType) {
      case "move_appointments": {
        if (!params.targetDate) {
          return { success: false, message: "Data de destino nao especificada." };
        }

        let movedCount = 0;
        for (const affected of action.affectedAppointments) {
          const appt = appointmentsStore.get(affected.id);
          if (!appt) continue;

          const oldStart = new Date(appt.startTime);
          const oldEnd = new Date(appt.endTime);
          const duration = oldEnd.getTime() - oldStart.getTime();

          const [year, month, day] = params.targetDate.split("-").map(Number);
          const newStart = new Date(year, month - 1, day, oldStart.getHours(), oldStart.getMinutes());

          // Se tem horario especifico
          if (params.targetTime) {
            const [h, m] = params.targetTime.split(":").map(Number);
            newStart.setHours(h, m, 0, 0);
          }

          const newEnd = new Date(newStart.getTime() + duration);

          appointmentsStore.update(affected.id, {
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
          });
          movedCount++;
        }

        action.status = "executed";
        savePendingActions(pending);

        return {
          success: true,
          message: `Pronto! ${movedCount} agendamento(s) movido(s) para ${formatDatePT(params.targetDate)}${params.targetTime ? ` as ${params.targetTime}` : ""}.`,
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

      case "create_appointment": {
        // Buscar entidades
        const client = params.clientName ? findClientByName(params.clientName) : null;
        if (!client) {
          return { success: false, message: "Cliente nao encontrado para criar o agendamento." };
        }

        const employee = params.employeeName ? findEmployeeByName(params.employeeName) : null;
        const service = params.serviceName ? findServiceByName(params.serviceName) : null;
        const duration = params.duration ?? service?.duration ?? 60;
        const targetDate = params.targetDate ?? toDateStr(new Date());
        const targetTime = params.targetTime ?? "09:00";

        const [h, m] = targetTime.split(":").map(Number);
        const [year, month, day] = targetDate.split("-").map(Number);
        const startTime = new Date(year, month - 1, day, h, m, 0, 0);
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

        // Montar dados do agendamento
        const appointmentData: Record<string, unknown> = {
          clientId: client.id,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          status: "scheduled",
        };

        if (employee) {
          appointmentData.employeeId = employee.id;
        }

        if (service) {
          appointmentData.services = [{
            id: service.id,
            name: service.name,
            price: service.price,
            duration: service.duration,
          }];
          appointmentData.totalPrice = service.price;
        }

        // Criar o agendamento
        appointmentsStore.create(appointmentData);

        action.status = "executed";
        savePendingActions(pending);

        const dateLabel = formatDatePT(targetDate);
        let msg = `Pronto! Agendamento criado com sucesso:\n\n`;
        msg += `- **Cliente:** ${client.name}\n`;
        if (service) msg += `- **Servico:** ${service.name}\n`;
        if (employee) msg += `- **Profissional:** ${employee.name}\n`;
        msg += `- **Data:** ${dateLabel} as ${targetTime}\n`;
        msg += `- **Duracao:** ${duration} min`;

        return { success: true, message: msg };
      }

      default:
        return { success: false, message: "Tipo de acao nao suportado." };
    }
  } catch (err) {
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
  const active = pending.filter(a => a.status === "pending_confirmation");
  return active.length > 0 ? active[active.length - 1] : null;
}

// ─── Verificar se texto e confirmacao ──────────────────────

export function isConfirmation(text: string): boolean {
  const q = normalize(text);
  return /^(sim|confirma|confirmo|pode|ok|faz|executa|vai|manda|bora|claro|com certeza|pode sim|sim pode|confirmar)$/.test(q);
}

export function isDenial(text: string): boolean {
  const q = normalize(text);
  return /^(nao|cancela|cancelar|nao quero|deixa|para|nao pode|negativo|nao faz)$/.test(q);
}
