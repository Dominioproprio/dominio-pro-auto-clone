/**
 * agentV2.ts - Agente IA v2 para Dominio Pro (Reformulado)
 * Arquitetura LLM-First: o modelo decide tudo com dados reais do sistema.
 *
 * Correcoes e melhorias:
 * - Agendamento funcional com validacao de horario de trabalho
 * - Resolucao de conflitos robusta (forcar agendamento apos confirmacao)
 * - Selecao de profissional pendente com retomada automatica
 * - Sugestao do ultimo servico para clientes recorrentes
 * - Deteccao robusta de datas (dia da semana, DD/MM, etc.)
 * - Acoes pendentes via localStorage (sem markers no historico)
 */

import {
  clientsStore,
  servicesStore,
  employeesStore,
  appointmentsStore,
} from "./store";
import {
  buildMemoryPrompt,
  detectTeachingIntent,
  addRule,
  addFeedback,
  refreshPreferences,
} from "./agentMemory";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentV2Config {
  apiToken: string;
  model?: string;
  businessContext?: string;
  salonName?: string;
}

export interface AgentV2Response {
  text: string;
  actionExecuted?: boolean;
  navigateTo?: string;
  messageId?: string;
  userMessage?: string;
}

// ─── Historico ────────────────────────────────────────────

const HISTORY_KEY = "agentv2_history";

function loadHistory(): AgentMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(h: AgentMessage[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-20))); } catch {}
}

function addToHistory(role: "user" | "assistant", content: string) {
  const h = loadHistory();
  h.push({ role, content });
  saveHistory(h);
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  clearPendingAction();
}

// ─── Acoes Pendentes (conflito / profissional) ────────────
// Usa localStorage separado em vez de markers no historico.
// Isso evita o bug onde o marker era sobrescrito pela mensagem visivel.

const PENDING_KEY = "agentv2_pending";

interface PendingAction {
  action: any;
  type: "conflict" | "professional";
  timestamp: number;
}

function savePendingAction(action: any, type: "conflict" | "professional") {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ action, type, timestamp: Date.now() })
    );
  } catch {}
}

function loadPendingAction(): PendingAction | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const data: PendingAction = JSON.parse(raw);
    // Expira apos 10 minutos
    if (Date.now() - data.timestamp > 10 * 60_000) {
      clearPendingAction();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearPendingAction() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

// ─── Helpers de data/hora ─────────────────────────────────

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  let t = raw.toLowerCase().replace(/h/gi, ":").replace(/\s+/g, "").trim();
  // Remove trailing ":" se ficou "14:" de "14h"
  t = t.replace(/:$/, "");
  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2, "0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    const hh = parseInt(h);
    const mm = parseInt(m);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${h.padStart(2, "0")}:${m}`;
  }
  return null;
}

function resolveDate(raw: string): string {
  const today = new Date();
  const r = (raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (!r || r === "hoje") return today.toISOString().split("T")[0];

  if (r === "amanha") {
    const d = new Date(today);
    d.setDate(today.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  // Dia da semana
  const dayMap: Record<string, number> = {
    "domingo": 0, "segunda": 1, "terca": 2,
    "quarta": 3, "quinta": 4, "sexta": 5, "sabado": 6,
    "segunda-feira": 1, "terca-feira": 2,
    "quarta-feira": 3, "quinta-feira": 4, "sexta-feira": 5,
  };
  if (dayMap[r] !== undefined) {
    const target = dayMap[r];
    const current = today.getDay();
    let diff = target - current;
    if (diff <= 0) diff += 7;
    const d = new Date(today);
    d.setDate(today.getDate() + diff);
    return d.toISOString().split("T")[0];
  }

  // DD/MM ou DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}/.test(r)) {
    const [dd, mm, yy] = r.split("/");
    return `${yy ?? today.getFullYear()}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // Apenas dia do mes
  if (/^\d{1,2}$/.test(r)) {
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${r.padStart(2, "0")}`;
  }

  // YYYY-MM-DD ja formatado
  if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return r;

  return r;
}

// ─── Validacao de horario de trabalho ─────────────────────

function isWithinWorkingHours(
  emp: any,
  dateStr: string,
  timeStr: string,
): { ok: boolean; message?: string } {
  const wh = emp.workingHours;
  if (!wh || Object.keys(wh).length === 0) return { ok: true };

  const dayOfWeek = getDayOfWeek(dateStr);
  const dayConfig = wh[String(dayOfWeek)];

  if (!dayConfig || !dayConfig.active) {
    const dayNames = [
      "domingo", "segunda-feira", "terca-feira", "quarta-feira",
      "quinta-feira", "sexta-feira", "sabado",
    ];
    return {
      ok: false,
      message: `${emp.name} nao trabalha ${dayNames[dayOfWeek]}.`,
    };
  }

  const startMin = timeToMinutes(dayConfig.start);
  const endMin = timeToMinutes(dayConfig.end);
  const reqMin = timeToMinutes(timeStr);

  if (reqMin < startMin || reqMin >= endMin) {
    return {
      ok: false,
      message: `${emp.name} trabalha das ${dayConfig.start} as ${dayConfig.end} neste dia. O horario ${timeStr} esta fora do expediente.`,
    };
  }

  return { ok: true };
}

// ─── Dados do sistema ─────────────────────────────────────

function getTodayData(): string {
  const today = getTodayStr();
  const appts = appointmentsStore.list({ date: today });
  const emps = employeesStore.list(true);
  if (appts.length === 0) return `Hoje (${today}): nenhum agendamento.`;
  const lines = appts.map((a: any) => {
    const emp = emps.find((e: any) => e.id === a.employeeId);
    const hora = a.startTime?.split("T")[1]?.slice(0, 5) ?? "";
    const horaFim = a.endTime?.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  - ${hora}-${horaFim} | ${a.clientName} | ${svcs} | Prof: ${emp?.name ?? "?"} | ${a.status} | ID:${a.id}`;
  });
  return `Agendamentos hoje (${today}):\n${lines.join("\n")}`;
}

function getServicesData(): string {
  const svcs = servicesStore.list(true);
  if (svcs.length === 0) return "Nenhum servico cadastrado.";
  return `Servicos disponiveis:\n${svcs.map((s: any) =>
    `  - ID:${s.id} | ${s.name} | R$${s.price?.toFixed(2)} | ${s.durationMinutes}min`
  ).join("\n")}`;
}

function getEmployeesData(): string {
  const emps = employeesStore.list(true);
  if (emps.length === 0) return "Nenhum profissional ativo.";
  return `Profissionais ativos:\n${emps.map((e: any) => {
    const wh = e.workingHours;
    let hoursInfo = "";
    if (wh && Object.keys(wh).length > 0) {
      const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
      const activeDays = Object.entries(wh)
        .filter(([, v]: [string, any]) => v && (v as any).active)
        .map(([k, v]: [string, any]) => `${dayNames[Number(k)] ?? k}: ${v.start}-${v.end}`)
        .join(", ");
      if (activeDays) hoursInfo = ` | Horarios: ${activeDays}`;
    }
    return `  - ID:${e.id} | ${e.name}${hoursInfo}`;
  }).join("\n")}`;
}

function getApptsByDate(dateStr: string): string {
  const date = resolveDate(dateStr);
  const appts = appointmentsStore.list({ date });
  const emps = employeesStore.list(true);
  if (appts.length === 0) return `Nenhum agendamento em ${date}.`;
  return `Agendamentos ${date}:\n${appts.map((a: any) => {
    const emp = emps.find((e: any) => e.id === a.employeeId);
    const hora = a.startTime?.split("T")[1]?.slice(0, 5) ?? "";
    const horaFim = a.endTime?.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  - ${hora}-${horaFim} | ${a.clientName} | ${svcs} | ${emp?.name ?? "?"} | ${a.status} | ID:${a.id}`;
  }).join("\n")}`;
}

// ─── Busca de clientes com historico ─────────────────────

function normalizeStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

async function getClientWithHistory(query: string): Promise<string> {
  const q = query.trim();
  console.log(`[agentV2] getClientWithHistory: query="${q}"`);

  if (!q) {
    const all = await clientsStore.ensureLoaded();
    console.log(`[agentV2] getClientWithHistory: query vazia, total=${all.length}`);
    return `Total clientes: ${all.length}`;
  }

  const ql = normalizeStr(q);
  const all = await clientsStore.ensureLoaded();
  console.log(`[agentV2] getClientWithHistory: cache tem ${all.length} clientes, buscando "${ql}"`);

  // Busca no cache com normalização NFD (ignora acentos e case)
  let found = all.filter((c: any) =>
    normalizeStr(c.name ?? "").includes(ql) || c.phone?.includes(q)
  );
  console.log(`[agentV2] getClientWithHistory: ${found.length} resultado(s) no cache`);

  // Fallback: busca no Supabase com ILIKE (suporta acentos nativamente via collation)
  if (found.length === 0) {
    console.log(`[agentV2] getClientWithHistory: cache zerou → ILIKE no Supabase para "${q}"`);
    try {
      found = await clientsStore.search(q);
      console.log(`[agentV2] getClientWithHistory: Supabase retornou ${found.length} resultado(s)`);
    } catch (err) {
      console.error("[agentV2] getClientWithHistory: ERRO Supabase:", err);
    }
  }

  if (found.length === 0) {
    return `Nenhum cliente encontrado com "${query}". Total no sistema: ${all.length}.`;
  }

  const results = found.slice(0, 15);
  const lines: string[] = [];

  for (const c of results) {
    let line = `  - ID:${c.id} | ${c.name}`;
    if (c.phone) line += ` | ${c.phone}`;

    // Buscar ultimo agendamento deste cliente para sugestao
    const clientAppts = appointmentsStore
      .list({})
      .filter((a: any) => a.clientId === c.id && a.status !== "cancelled")
      .sort((a: any, b: any) => b.startTime.localeCompare(a.startTime));

    if (clientAppts.length > 0) {
      const last = clientAppts[0];
      const lastSvc = last.services?.[0]?.name ?? "";
      const lastDate = last.startTime?.split("T")[0] ?? "";
      line += ` | Ultimo servico: ${lastSvc} em ${lastDate}`;
    }

    lines.push(line);
  }

  let text = `Clientes encontrados (${found.length}):\n${lines.join("\n")}`;
  if (found.length > 15) {
    text += `\n(Exibindo 15 de ${found.length}. Seja mais especifico para refinar.)`;
  }
  return text;
}

// ─── Execucao de acoes ────────────────────────────────────

async function executeAction(action: any): Promise<string> {
  const { type, params } = action;
  try {
    if (type === "agendar") {
      return await executeSchedule(params);
    }

    if (type === "cancelar") {
      const apptId = params.appointmentId;
      const appt = appointmentsStore
        .list({})
        .find((a: any) => String(a.id) === String(apptId));
      if (!appt) return `Agendamento ID:${apptId} nao encontrado.`;
      if (appt.status === "cancelled") return `Agendamento ID:${apptId} ja esta cancelado.`;
      await appointmentsStore.update(apptId, { status: "cancelled" });
      window.dispatchEvent(new Event("store_updated"));
      const hora = appt.startTime?.split("T")[1]?.slice(0, 5) ?? "";
      return `Agendamento ID:${apptId} cancelado com sucesso.\nCliente: ${appt.clientName}\nHorario: ${hora}`;
    }

    if (type === "mover") {
      const appt = appointmentsStore
        .list({})
        .find((a: any) => String(a.id) === String(params.appointmentId));
      if (!appt) return `Agendamento ID:${params.appointmentId} nao encontrado.`;

      const resolvedDate = resolveDate(params.newDate);
      const resolvedTime = normalizeTime(params.newTime);
      if (!resolvedTime) return `Horario invalido: "${params.newTime}". Use HH:MM.`;

      const durMs =
        new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
      const newStart = `${resolvedDate}T${resolvedTime}:00`;
      const newEnd = new Date(
        new Date(newStart).getTime() + durMs
      ).toISOString().slice(0, 19);

      // Validar horario de trabalho
      const emp = employeesStore
        .list(true)
        .find((e: any) => e.id === appt.employeeId);
      if (emp) {
        const whCheck = isWithinWorkingHours(emp, resolvedDate, resolvedTime);
        if (!whCheck.ok) return whCheck.message!;
      }

      // Verificar conflito no novo horario
      const conflict = appointmentsStore
        .list({ date: resolvedDate })
        .find((a: any) => {
          if (
            a.id === appt.id ||
            a.employeeId !== appt.employeeId ||
            a.status === "cancelled"
          )
            return false;
          const aS = new Date(a.startTime).getTime();
          const aE = new Date(a.endTime).getTime();
          const rS = new Date(newStart).getTime();
          const rE = new Date(newEnd).getTime();
          return rS < aE && rE > aS;
        });

      if (conflict && !params.forceConflict) {
        const cHora = conflict.startTime?.split("T")[1]?.slice(0, 5);
        const cFim = conflict.endTime?.split("T")[1]?.slice(0, 5);
        const pendingAct = {
          type: "mover",
          params: { ...params, forceConflict: true },
        };
        savePendingAction(pendingAct, "conflict");
        return `CONFLITO:${emp?.name ?? "Profissional"} ja tem agendamento das ${cHora} as ${cFim} (${conflict.clientName ?? "cliente"}). Para forcar, confirme explicitamente.`;
      }

      await appointmentsStore.update(appt.id, {
        startTime: newStart,
        endTime: newEnd,
      });
      window.dispatchEvent(new Event("store_updated"));
      return `Agendamento movido com sucesso!\nCliente: ${appt.clientName}\nNovo horario: ${resolvedDate} as ${resolvedTime}`;
    }

    if (type === "concluir") {
      const appt = appointmentsStore
        .list({})
        .find((a: any) => String(a.id) === String(params.appointmentId));
      if (!appt) return `Agendamento ID:${params.appointmentId} nao encontrado.`;
      await appointmentsStore.update(params.appointmentId, {
        status: "completed",
      });
      window.dispatchEvent(new Event("store_updated"));
      return `Agendamento ID:${params.appointmentId} concluido!\nCliente: ${appt.clientName}`;
    }

    return `Acao desconhecida: "${type}".`;
  } catch (err) {
    console.error("[AgentV2] Erro em executeAction:", { type, params, err });
    const errMsg = err instanceof Error ? err.message : String(err);
    const errDetails: string[] = [`Erro ao executar "${type}": ${errMsg}`];
    if (err && typeof err === "object") {
      const e = err as any;
      if (e.code) errDetails.push(`Codigo: ${e.code}`);
      if (e.details) errDetails.push(`Detalhes: ${e.details}`);
      if (e.hint) errDetails.push(`Dica: ${e.hint}`);
    }
    return errDetails.join("\n");
  }
}

async function executeSchedule(params: any): Promise<string> {
  const {
    clientId,
    serviceId,
    employeeId,
    date,
    time,
    clientName: paramClientName,
  } = params;

  const resolvedDate = resolveDate(date);
  const resolvedTime = normalizeTime(time);
  if (!resolvedTime)
    return `Horario invalido: "${time}". Use formato HH:MM (ex: 14:00, 9:30).`;

  // 1. Localizar cliente ──────────────────────────────────
  const allClients = await clientsStore.ensureLoaded();
  let client: any = null;

  // Por ID exato
  if (clientId) {
    client =
      allClients.find((c: any) => String(c.id) === String(clientId)) ?? null;
  }

  // Por nome exato (com NFD — ignora acentos)
  if (!client && paramClientName) {
    const nameNorm = normalizeStr(paramClientName);
    console.log(`[agentV2] executeSchedule: buscando cliente por nome exato norm="${nameNorm}"`);
    client = allClients.find((c: any) => normalizeStr(c.name) === nameNorm) ?? null;
    if (client) console.log(`[agentV2] executeSchedule: match exato → id=${client.id}`);
  }

  // Por nome parcial (com NFD)
  if (!client && paramClientName) {
    const nameNorm = normalizeStr(paramClientName);
    client = allClients.find((c: any) => {
      const cn = normalizeStr(c.name);
      return cn.includes(nameNorm) || nameNorm.includes(cn);
    }) ?? null;
    if (client) console.log(`[agentV2] executeSchedule: match parcial → id=${client.id}`);
  }

  // Por primeiro nome (unico resultado) com NFD
  if (!client && paramClientName) {
    const firstName = normalizeStr(paramClientName).split(" ")[0];
    if (firstName.length > 2) {
      const matches = allClients.filter((c: any) =>
        normalizeStr(c.name).includes(firstName)
      );
      if (matches.length === 1) {
        client = matches[0];
      } else if (matches.length > 1) {
        const names = matches
          .slice(0, 5)
          .map((c: any) => `${c.name} (ID:${c.id})`)
          .join(", ");
        return `Encontrei varios clientes com "${paramClientName}": ${names}. Qual deles?`;
      }
    }
  }

  // Último recurso: ILIKE direto no Supabase (independe do cache)
  if (!client && paramClientName) {
    console.log(`[agentV2] executeSchedule: cache falhou → ILIKE Supabase para "${paramClientName}"`);
    try {
      const supabaseResults = await clientsStore.search(paramClientName);
      console.log(`[agentV2] executeSchedule: Supabase retornou ${supabaseResults.length} resultado(s)`);
      if (supabaseResults.length === 1) {
        client = supabaseResults[0];
        console.log(`[agentV2] executeSchedule: cliente resolvido via Supabase → id=${client.id}`);
      } else if (supabaseResults.length > 1) {
        const names = supabaseResults.slice(0, 5).map((c: any) => `${c.name} (ID:${c.id})`).join(", ");
        return `Encontrei varios clientes com "${paramClientName}": ${names}. Qual deles?`;
      }
    } catch (err) {
      console.error(`[agentV2] executeSchedule: ERRO Supabase search:`, err);
    }
  }

  if (!client) {
    const similar = allClients
      .filter(
        (c: any) =>
          paramClientName &&
          normalizeStr(c.name).includes(normalizeStr(paramClientName.split(" ")[0]))
      )
      .slice(0, 3)
      .map((c: any) => c.name)
      .join(", ");
    return `Cliente "${paramClientName ?? clientId}" nao encontrado.${
      similar ? ` Similares: ${similar}` : " Verifique o cadastro."
    }`;
  }

  // 2. Localizar servico ──────────────────────────────────
  const svc = servicesStore
    .list(true)
    .find((s: any) => String(s.id) === String(serviceId));
  if (!svc) {
    const svcs = servicesStore.list(true);
    if (svcs.length === 0) return "Nenhum servico cadastrado no sistema.";
    const lista = svcs
      .map((s: any) => `${s.name} (ID:${s.id})`)
      .join(", ");
    return `Servico ID:${serviceId} nao encontrado. Disponiveis: ${lista}`;
  }

  // 3. Localizar profissional ─────────────────────────────
  const emps = employeesStore.list(true);
  if (emps.length === 0) return "Nenhum profissional ativo no sistema.";

  let emp: any = null;
  if (employeeId) {
    emp =
      emps.find((e: any) => String(e.id) === String(employeeId)) ?? null;
  }
  if (!emp && emps.length === 1) {
    emp = emps[0];
  }
  if (!emp) {
    // Salvar acao pendente para retomar quando usuario escolher
    const pendingAct = { type: "agendar", params: { ...params } };
    savePendingAction(pendingAct, "professional");
    const lista = emps
      .map((e: any) => `${e.name} (ID:${e.id})`)
      .join(", ");
    return `AGUARDANDO_PROFISSIONAL:${lista}`;
  }

  // 4. Validar horario de trabalho ────────────────────────
  const whCheck = isWithinWorkingHours(emp, resolvedDate, resolvedTime);
  if (!whCheck.ok) return whCheck.message!;

  // 5. Calcular horarios ──────────────────────────────────
  const durationMinutes =
    svc.durationMinutes && svc.durationMinutes > 0 ? svc.durationMinutes : 60;
  const startTime = `${resolvedDate}T${resolvedTime}:00`;
  const endTime = new Date(
    new Date(startTime).getTime() + durationMinutes * 60_000
  )
    .toISOString()
    .slice(0, 19);

  // 6. Verificar conflito de horario ──────────────────────
  const conflict = appointmentsStore
    .list({ date: resolvedDate })
    .find((a: any) => {
      if (a.employeeId !== emp.id || a.status === "cancelled") return false;
      const aS = new Date(a.startTime).getTime();
      const aE = new Date(a.endTime).getTime();
      const rS = new Date(startTime).getTime();
      const rE = new Date(endTime).getTime();
      return rS < aE && rE > aS;
    });

  if (conflict && !params.forceConflict) {
    const conflictHour = conflict.startTime?.split("T")[1]?.slice(0, 5);
    const conflictEnd = conflict.endTime?.split("T")[1]?.slice(0, 5);

    // Salvar acao pendente COM forceConflict para retomada
    const pendingAct = {
      type: "agendar",
      params: { ...params, forceConflict: true },
    };
    savePendingAction(pendingAct, "conflict");

    return `CONFLITO:${emp.name} ja tem agendamento das ${conflictHour} as ${conflictEnd} (${conflict.clientName ?? "cliente"}). Para forcar mesmo assim, confirme explicitamente.`;
  }

  // 7. Criar agendamento ── com try/catch para capturar erros reais do banco
  const createPayload = {
    clientName: client.name,
    clientId: client.id,
    employeeId: emp.id,
    startTime,
    endTime,
    status: "scheduled" as const,
    totalPrice: svc.price,
    notes: null,
    paymentStatus: null,
    groupId: null,
    services: [
      {
        serviceId: svc.id,
        name: svc.name,
        price: svc.price,
        durationMinutes: svc.durationMinutes ?? 60,
        color: svc.color ?? "#ec4899",
        materialCostPercent: svc.materialCostPercent ?? 0,
      },
    ],
  };
  console.log(`[agentV2] executeSchedule: enviando para Supabase →`, JSON.stringify({
    clientId: createPayload.clientId,
    clientName: createPayload.clientName,
    employeeId: createPayload.employeeId,
    startTime: createPayload.startTime,
    endTime: createPayload.endTime,
    serviceId: createPayload.services[0].serviceId,
  }));

  let created: any;
  try {
    created = await appointmentsStore.create(createPayload);
    console.log(`[agentV2] executeSchedule: SUCESSO → id=${created?.id}`);
  } catch (err: any) {
    console.error(`[agentV2] executeSchedule: ERRO ao persistir no banco:`, err);
    const detail = err?.message ?? err?.details ?? err?.code ?? "erro desconhecido";
    return `Erro ao criar agendamento no banco: ${detail}. O agendamento NÃO foi salvo. Verifique o console para detalhes.`;
  }

  if (!created || !created.id) {
    console.error(`[agentV2] executeSchedule: create retornou vazio/sem id`, created);
    return `Erro ao criar agendamento: banco não retornou confirmação. O agendamento pode não ter sido salvo.`;
  }

  window.dispatchEvent(new Event("store_updated"));
  refreshPreferences();

  return [
    `Agendamento criado com sucesso!`,
    `ID: ${created.id}`,
    `Cliente: ${client.name}`,
    `Servico: ${svc.name} (${durationMinutes}min)`,
    `Data: ${resolvedDate} as ${resolvedTime}`,
    `Profissional: ${emp.name}`,
  ].join("\n");
}

// ─── System Prompt ────────────────────────────────────────

function buildSystemPrompt(config: AgentV2Config): string {
  const dateStr = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return `Voce e o Agente IA do ${config.salonName ?? "Dominio Pro"}.
Data atual: ${dateStr}
${config.businessContext ?? ""}

Voce gerencia agendamentos, clientes, servicos e profissionais.
Dados reais do sistema sao fornecidos em cada mensagem — use-os com precisao.

REGRAS CRITICAS:
1. Responda em portugues brasileiro, direto e natural
2. Voce TEM ACESSO COMPLETO a clientes, servicos, profissionais e agendamentos — os dados sao fornecidos em cada mensagem
3. Nunca diga que nao tem acesso a dados ou que o usuario precisa fornecer IDs — use os nomes para localizar os IDs nos dados
4. DISTINCAO CRITICA: a lista de "Profissionais" e a lista de "Clientes" sao SEPARADAS — um nome na lista de Profissionais NAO e um cliente, e vice-versa
5. Para agendar: o CLIENTE e quem recebe o servico (esta na lista de Clientes); o PROFISSIONAL e quem executa (esta na lista de Profissionais)
6. Quando o usuario mencionar um nome que esta na lista de Profissionais, trate como profissional — NAO busque esse nome na lista de Clientes
7. Se houver mais de um profissional e o usuario nao informou qual, SEMPRE pergunte antes de agendar
8. Se houver apenas um profissional, use-o automaticamente sem perguntar
9. Mantenha o contexto da conversa — se o cliente ja foi identificado em uma mensagem anterior, nao peca novamente
10. SEMPRE que um cliente recorrente for identificado nos dados e o usuario nao disse qual servico, SUGIRA o ultimo servico que ele fez (mostrado como "Ultimo servico" nos dados)
11. NAO invente regras de horario. Os horarios de trabalho dos profissionais estao nos dados — use-os. Se nao houver horarios configurados, aceite qualquer horario.
12. Quando o usuario perguntar a duracao de um servico, use o campo "min" dos dados do servico

INSTRUCOES DE ACAO — MUITO IMPORTANTE:
- Quando o usuario quer uma acao (agendar, cancelar, mover, concluir), SEMPRE inclua o bloco de acao JSON
- NAO verifique conflitos voce mesmo — o SISTEMA faz isso automaticamente. Sua unica tarefa e montar o bloco action com os dados corretos
- NAO recuse agendamentos por motivos que voce supoe — deixe o sistema validar horarios e conflitos
- SEMPRE inclua o bloco action quando o usuario pede uma acao, MESMO que voce ache que possa haver problema
- Se falta informacao (cliente, servico, horario), pergunte APENAS o que falta — NAO inclua bloco action nesse caso
- Se o usuario pediu para agendar e voce tem TODOS os dados necessarios (cliente, servico, horario, data), INCLUA o bloco action imediatamente

COMO USAR OS DADOS DE CLIENTES:
- Os dados do sistema incluem linhas no formato: "ID:123 | Nome do Cliente | telefone | Ultimo servico: X em YYYY-MM-DD"
- O numero apos "ID:" e o clientId — use ESSE numero exato no bloco action
- NUNCA invente um clientId — sempre use o ID que aparece nos dados fornecidos
- Se o cliente nao aparece nos dados, diga que nao encontrou e peca para confirmar o nome
- Se aparecerem varios clientes com nome similar, liste-os e pergunte qual e o correto

ACOES — inclua ao final da resposta APENAS quando necessario:
\`\`\`action
{"type":"agendar","params":{"clientId":123,"clientName":"Nome","serviceId":45,"employeeId":2,"date":"hoje","time":"14:00"}}
\`\`\`
Tipos: agendar | cancelar | mover | concluir
- agendar: {clientId, clientName, serviceId, employeeId, date, time} — date pode ser "hoje", "amanha", "DD/MM", dia da semana, ou YYYY-MM-DD. SEMPRE inclua clientName alem do clientId.
- cancelar: {appointmentId}
- mover: {appointmentId, newDate, newTime}
- concluir: {appointmentId}

REGRAS ADICIONAIS:
13. Para cancelar/mover: confirme antes de executar
14. Peca apenas o dado que falta — nunca peca o ID, voce mesmo descobre nos dados
15. Se o usuario diz apenas um horario (ex: "as 14"), use a data de hoje
16. Se o usuario diz um nome que e de profissional, NAO busque como cliente
17. Quando o sistema retornar um conflito ou erro, informe o usuario de forma clara
18. NUNCA diga "nao encontrei" se os dados do sistema mostram o cliente — leia os dados com atencao antes de responder
${buildMemoryPrompt()}`;
}

// ─── Dados contextuais ────────────────────────────────────

async function gatherData(msg: string): Promise<string> {
  const q = msg.toLowerCase();
  const parts: string[] = [getTodayData(), getEmployeesData(), getServicesData()];

  // ── Estratégia de extração de nome do cliente ────────────────────────────
  // Prioridade 1: padrão explícito "cliente X" ou "para o cliente X"
  // Prioridade 2: padrão "procurar/buscar X"
  // Prioridade 3: heurística por palavras (fallback)
  // Em todos os casos: busca com NFD normalizado + ILIKE fallback

  let searchTerm: string | null = null;

  // Prioridade 1 — "cliente Eduardo", "para a cliente Soraia Marcela"
  const clienteMatch = msg.match(
    /(?:^|\s)(?:o\s+cliente|a\s+cliente|cliente)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s]{1,49})(?=\s+(?:amanhã|amanha|hoje|às|as|para|com|no|na|$)|$)/i
  );
  if (clienteMatch?.[1]) {
    searchTerm = clienteMatch[1].trim();
    console.log(`[agentV2] gatherData: padrão "cliente X" → "${searchTerm}"`);
  }

  // Prioridade 2 — "procurar/buscar X", "procure por X", "quem é X"
  if (!searchTerm) {
    const buscaMatch = msg.match(
      /(?:procure?(?:\s+por)?|buscar?|busque|encontre?|quem\s+[eé])\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s]{1,49})(?=[,.]|\s+(?:no\s+sistema|cadastrado|$)|$)/i
    );
    if (buscaMatch?.[1]) {
      searchTerm = buscaMatch[1].trim();
      console.log(`[agentV2] gatherData: padrão "buscar X" → "${searchTerm}"`);
    }
  }

  // Prioridade 3 — heurística por palavras (mantida como fallback, mas com NFD)
  if (!searchTerm) {
    const empNames = new Set(
      employeesStore.list(true).flatMap((e: any) => normalizeStr(e.name).split(" "))
    );
    const svcNames = new Set(
      servicesStore.list(true).flatMap((s: any) => normalizeStr(s.name).split(" "))
    );
    const stopWords = new Set([
      "que", "nao", "sim", "para", "com", "uma", "uns", "umas", "por",
      "quero", "agendar", "marcar", "cliente", "preciso", "cancelar",
      "mover", "agenda", "hoje", "amanha", "hora", "servico", "horario",
      "consegue", "executar", "agendamento", "voce", "fazer", "nome",
      "qual", "quais", "pode", "como", "quanto", "tempo", "duracao",
      "confirma", "confirmar", "mesmo", "assim", "deixa", "esquece",
      "concluir", "fechar", "abrir", "buscar", "procurar", "liste",
      "listar", "ultimos", "ultimas", "sistema", "agora", "cadastrado",
      "cadastrados", "tenho", "temos", "informacoes", "informacao",
    ]);

    const words = msg
      .split(/\s+/)
      .filter((w) => w.length > 2 && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w));

    const candidates = words.filter((w) => {
      const wNorm = normalizeStr(w);
      return !stopWords.has(wNorm) && !empNames.has(wNorm) && !svcNames.has(wNorm);
    });

    console.log(`[agentV2] gatherData: heurística candidateNames=`, candidates);

    if (candidates.length > 0) {
      searchTerm = candidates.join(" ");
      console.log(`[agentV2] gatherData: heurística → "${searchTerm}"`);
    }
  }

  // ── Executar busca ───────────────────────────────────────────────────────
  if (searchTerm) {
    console.log(`[agentV2] gatherData: buscando cliente com termo="${searchTerm}"`);
    parts.push(await getClientWithHistory(searchTerm));
  } else {
    const all = await clientsStore.ensureLoaded();
    console.log(`[agentV2] gatherData: sem termo de busca, cache=${all.length} clientes`);
    parts.push(
      `Total clientes cadastrados: ${all.length}. Use busca por nome para localizar clientes especificos.`
    );
  }

  // ── Data específica ──────────────────────────────────────────────────────
  const dateMatch = q.match(
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|amanha|amanhã|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/i
  );
  if (dateMatch) parts.push(getApptsByDate(dateMatch[1]));

  return parts.join("\n\n");
}

// ─── API ──────────────────────────────────────────────────

const ENDPOINT = "https://models.github.ai/inference/chat/completions";

async function callLLM(
  system: string,
  history: AgentMessage[],
  userMsg: string,
  data: string,
  config: AgentV2Config,
): Promise<string> {
  if (!config.apiToken || config.apiToken === "proxy")
    throw new Error("Token nao configurado.");

  const messages = [
    { role: "system", content: system },
    {
      role: "system",
      content: `=== DADOS DO SISTEMA ===\n${data}\n=== FIM DOS DADOS ===`,
    },
    ...history,
    { role: "user", content: userMsg },
  ];

  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), 25_000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        model: config.model ?? "openai/gpt-4o-mini",
        messages,
        temperature: 0.2,
        max_tokens: 1200,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tmr);

    if (!res.ok) {
      if (res.status === 401)
        throw new Error(
          "Token invalido. Verifique seu GitHub PAT em: github.com/settings/tokens"
        );
      if (res.status === 429)
        throw new Error("Limite de requisicoes atingido. Aguarde alguns segundos.");
      throw new Error(`Erro ${res.status}`);
    }

    const data2 = await res.json();
    return data2?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    clearTimeout(tmr);
    if (err instanceof DOMException && err.name === "AbortError")
      throw new Error("Timeout — tente novamente.");
    throw err;
  }
}

// ─── Exportacoes publicas ─────────────────────────────────

let cfg: AgentV2Config | null = null;

export function initAgentV2(config: AgentV2Config) {
  cfg = config;
}

export async function handleMessageV2(
  userMessage: string,
): Promise<AgentV2Response> {
  if (!cfg) return { text: "Agente nao configurado." };

  const msgTrimmed = userMessage.trim();

  // ── 1. Verificar acao pendente (conflito ou profissional) ──
  const pending = loadPendingAction();
  if (pending) {
    // ─ Conflito: usuario confirmando ─
    if (pending.type === "conflict") {
      if (
        /forç|forcar|força|mesmo\s*assim|pode|sim|confirma|confirmar|ok|claro|vai|manda|force|agendar/i.test(
          msgTrimmed
        )
      ) {
        clearPendingAction();
        addToHistory("user", msgTrimmed);
        const forceResult = await executeAction(pending.action);

        // Se deu outro erro (ex: profissional), tratar
        if (forceResult.startsWith("AGUARDANDO_PROFISSIONAL:")) {
          const lista = forceResult.replace("AGUARDANDO_PROFISSIONAL:", "");
          const aviso = `Com qual profissional deseja agendar? Disponiveis: ${lista}`;
          addToHistory("assistant", aviso);
          return {
            text: aviso,
            messageId: `m_${Date.now()}`,
            userMessage: msgTrimmed,
          };
        }

        addToHistory("assistant", forceResult);
        const isSuccess =
          forceResult.includes("criado com sucesso") ||
          forceResult.includes("movido com sucesso");
        return {
          text: forceResult,
          actionExecuted: isSuccess,
          navigateTo: isSuccess ? "/agenda" : undefined,
          messageId: `m_${Date.now()}`,
          userMessage: msgTrimmed,
        };
      }

      // Usuario negou ou mudou de assunto — limpar pendencia
      if (/nao|não|cancela|deixa|esquece|outro|nada/i.test(msgTrimmed)) {
        clearPendingAction();
        addToHistory("user", msgTrimmed);
        const cancelMsg =
          "Ok, agendamento nao realizado. Como posso ajudar?";
        addToHistory("assistant", cancelMsg);
        return {
          text: cancelMsg,
          messageId: `m_${Date.now()}`,
          userMessage: msgTrimmed,
        };
      }

      // Nao reconheceu como confirmacao nem negacao — limpar e seguir fluxo normal
      clearPendingAction();
    }

    // ─ Profissional: usuario escolhendo ─
    if (pending.type === "professional") {
      const emps = employeesStore.list(true);
      const empName = msgTrimmed.toLowerCase();

      // Tentar encontrar profissional pelo nome informado
      const emp =
        emps.find(
          (e: any) =>
            e.name.toLowerCase() === empName ||
            e.name.toLowerCase().includes(empName) ||
            empName.includes(e.name.toLowerCase())
        ) ?? null;

      if (emp) {
        clearPendingAction();
        addToHistory("user", msgTrimmed);
        const updatedAction = {
          ...pending.action,
          params: { ...pending.action.params, employeeId: emp.id },
        };
        const result = await executeAction(updatedAction);

        // Se resultou em conflito, o savePendingAction ja foi chamado dentro de executeSchedule
        if (result.startsWith("CONFLITO:")) {
          const detalhe = result.replace("CONFLITO:", "");
          const aviso = `Conflito de horario: ${detalhe}\nDeseja agendar mesmo assim? Responda "forcar agendamento" para confirmar.`;
          addToHistory("assistant", aviso);
          return {
            text: aviso,
            messageId: `m_${Date.now()}`,
            userMessage: msgTrimmed,
          };
        }

        if (result.startsWith("AGUARDANDO_PROFISSIONAL:")) {
          const lista = result.replace("AGUARDANDO_PROFISSIONAL:", "");
          const aviso = `Com qual profissional deseja agendar? Disponiveis: ${lista}`;
          addToHistory("assistant", aviso);
          return {
            text: aviso,
            messageId: `m_${Date.now()}`,
            userMessage: msgTrimmed,
          };
        }

        addToHistory("assistant", result);
        const isSuccess = result.includes("criado com sucesso");
        return {
          text: result,
          actionExecuted: isSuccess,
          navigateTo: isSuccess ? "/agenda" : undefined,
          messageId: `m_${Date.now()}`,
          userMessage: msgTrimmed,
        };
      }

      // Nao encontrou profissional — pode ter mudado de assunto, limpar e seguir
      clearPendingAction();
    }
  }

  // ── 2. Detectar comando de ensino (regra explicita) ──────
  const teachIntent = detectTeachingIntent(msgTrimmed);
  if (teachIntent) {
    const rule = addRule(teachIntent);
    const confirmation = `Entendido! Vou lembrar disso sempre:\n"${rule.raw}"`;
    addToHistory("user", msgTrimmed);
    addToHistory("assistant", confirmation);
    return { text: confirmation };
  }

  // ── 3. Fluxo normal: LLM + execucao de acao ─────────────
  addToHistory("user", msgTrimmed);
  const history = loadHistory().slice(0, -1); // sem a msg atual
  const systemData = await gatherData(msgTrimmed);

  let raw: string;
  try {
    raw = await callLLM(
      buildSystemPrompt(cfg),
      history,
      msgTrimmed,
      systemData,
      cfg,
    );
  } catch (err) {
    const errText = `Erro: ${err instanceof Error ? err.message : "Tente novamente."}`;
    return { text: errText };
  }

  // Extrair e executar acao
  let text = raw;
  let actionExecuted = false;
  let navigateTo: string | undefined;

  const match = raw.match(/```action\s*([\s\S]*?)```/);
  if (match) {
    try {
      const act = JSON.parse(match[1]);
      const result = await executeAction(act);

      if (result.startsWith("AGUARDANDO_PROFISSIONAL:")) {
        // savePendingAction ja foi chamado dentro de executeSchedule
        const lista = result.replace("AGUARDANDO_PROFISSIONAL:", "");
        text = `Com qual profissional deseja agendar? Disponiveis: ${lista}`;
      } else if (result.startsWith("CONFLITO:")) {
        // savePendingAction ja foi chamado dentro de executeSchedule
        const detalhe = result.replace("CONFLITO:", "");
        text = `Conflito de horario: ${detalhe}\nDeseja agendar mesmo assim? Responda "forcar agendamento" para confirmar.`;
      } else {
        text = result;
        actionExecuted =
          result.includes("criado com sucesso") ||
          result.includes("cancelado com sucesso") ||
          result.includes("movido com sucesso") ||
          result.includes("concluido");
        if (actionExecuted && act.type === "agendar") navigateTo = "/agenda";
        if (actionExecuted && act.type === "mover") navigateTo = "/agenda";
      }
    } catch (err) {
      text = `Erro ao processar acao: ${err instanceof Error ? err.message : "Desconhecido"}`;
      console.error("[AgentV2] Erro ao processar acao:", err);
    }
  }

  addToHistory("assistant", text);
  const msgId = `m_${Date.now()}`;
  return { text, actionExecuted, navigateTo, messageId: msgId, userMessage: msgTrimmed };
}

export { addFeedback };

export async function testAgentV2Connection(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "OK" }],
        max_tokens: 5,
      }),
    });
    if (!res.ok)
      return {
        ok: false,
        message: res.status === 401 ? "Token invalido." : `Erro ${res.status}`,
      };
    return { ok: true, message: "Conexao OK! Agente IA ativado." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro de rede.",
    };
  }
}
