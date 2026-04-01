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

async function getClientWithHistory(query: string): Promise<string> {
  const q = query.trim();
  if (!q) {
    const total = await clientsStore.count();
    return `Total clientes: ${total}`;
  }

  let found: any[] = [];
  try {
    found = await clientsStore.search(q, { limit: 15 });
    console.log("[agentV2] getClientWithHistory:search", {
      query: q,
      found: found.length,
      ids: found.map((c: any) => c.id),
    });
  } catch (err) {
    console.warn("[agentV2] Busca Supabase falhou:", err);
  }

  if (found.length === 0) {
    const total = await clientsStore.count();
    return `Nenhum cliente encontrado com "${query}". Total no sistema: ${total}.`;
  }

  let recentAppointments: any[] = [];
  try {
    recentAppointments = await appointmentsStore.fetchByClientIds(
      found.map((c: any) => c.id),
    );
  } catch (err) {
    console.warn("[agentV2] Busca de histórico falhou:", err);
  }

  const lastByClient = new Map<string, any>();
  for (const appt of recentAppointments) {
    const key = String(appt.clientId ?? "");
    if (!key || lastByClient.has(key)) continue;
    lastByClient.set(key, appt);
  }

  const lines: string[] = [];
  for (const c of found) {
    let line = `  - ID:${c.id} | ${c.name}`;
    if (c.phone) line += ` | ${c.phone}`;
    const last = lastByClient.get(String(c.id));
    if (last) {
      const lastSvc = last.services?.[0]?.name ?? "";
      const lastDate = last.startTime?.split("T")[0] ?? "";
      line += ` | Ultimo servico: ${lastSvc} em ${lastDate}`;
    }
    lines.push(line);
  }

  return `Clientes encontrados (${found.length}):\n${lines.join("\n")}`;
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

  // Por nome exato
  if (!client && paramClientName) {
    const nameLower = paramClientName.toLowerCase().trim();
    client =
      allClients.find((c: any) => c.name.toLowerCase() === nameLower) ?? null;
  }

  // Por nome parcial
  if (!client && paramClientName) {
    const nameLower = paramClientName.toLowerCase().trim();
    client =
      allClients.find((c: any) => {
        const cn = c.name.toLowerCase();
        return cn.includes(nameLower) || nameLower.includes(cn);
      }) ?? null;
  }

  // Por primeiro nome (unico resultado)
  if (!client && paramClientName) {
    const firstName = paramClientName.toLowerCase().split(" ")[0];
    if (firstName.length > 2) {
      const matches = allClients.filter((c: any) =>
        c.name.toLowerCase().includes(firstName)
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

  if (!client) {
    const similar = allClients
      .filter(
        (c: any) =>
          paramClientName &&
          c.name.toLowerCase().includes(
            paramClientName.toLowerCase().split(" ")[0]
          )
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

  // 7. Criar agendamento ──────────────────────────────────
  const created = await appointmentsStore.create({
    clientName: client.name,
    clientId: client.id,
    employeeId: emp.id,
    startTime,
    endTime,
    status: "scheduled",
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
  });

  if (!created || !created.id) {
    return `Erro ao criar agendamento no banco. Verifique os dados e tente novamente.`;
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
18. NUNCA diga que agendou, cancelou, moveu ou concluiu algo antes do retorno real do sistema/banco
19. Antes do retorno do sistema, use no maximo frases como "vou tentar", "vou verificar" ou "estou processando"
20. Se voce nao conseguir gerar o bloco action, NAO confirme a operacao como concluida
${buildMemoryPrompt()}`;
}

// ─── Dados contextuais ────────────────────────────────────

async function gatherData(msg: string): Promise<string> {
  const q = msg.toLowerCase();
  const parts: string[] = [getTodayData(), getEmployeesData(), getServicesData()];

  // Extrair candidatos a nome de cliente da mensagem
  const empsLower = new Set(
    employeesStore
      .list(true)
      .flatMap((e: any) => e.name.toLowerCase().split(" "))
  );
  const svcsLower = new Set(
    servicesStore
      .list(true)
      .flatMap((s: any) => s.name.toLowerCase().split(" "))
  );

  const stopWords = new Set([
    "quero", "agendar", "marcar", "cliente", "para", "preciso", "cancelar",
    "mover", "agenda", "hoje", "amanha", "hora", "servico", "horario",
    "consegue", "executar", "agendamento", "voce", "fazer", "nome", "tenho",
    "qual", "quais", "pode", "como", "quanto", "tempo", "duracao",
    "compreende", "corte", "escova", "tintura", "manicure", "pedicure",
    "barba", "hidrata", "progressiva", "termica", "relaxamento", "botox",
    "coloracao", "luzes", "alisamento", "massagem", "unhas", "masculino",
    "feminino", "sim", "nao", "forcar", "confirma", "confirmar", "forca",
    "mesmo", "assim", "deixa", "esquece", "cancelado", "mova", "mude",
    "concluir", "fechar", "abrir", "buscar", "procurar",
  ]);

  const words = msg
    .split(/\s+/)
    .filter((w) => w.length > 2 && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w));
  const candidateNames = words.filter((w) => {
    const wl = w.toLowerCase();
    return !stopWords.has(wl) && !empsLower.has(wl) && !svcsLower.has(wl);
  });

  if (candidateNames.length > 0) {
    const searchTerm = candidateNames.join(" ");
    parts.push(await getClientWithHistory(searchTerm));
  } else {
    const total = await clientsStore.count();
    parts.push(
      `Total clientes cadastrados: ${total}. Use busca por nome para localizar.`
    );
  }

  // Se menciona data especifica, buscar agendamentos dessa data
  const dateMatch = q.match(
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|amanha|amanhã|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/i
  );
  if (dateMatch) parts.push(getApptsByDate(dateMatch[1]));

  return parts.join("\n\n");
}

// ─── API ──────────────────────────────────────────────────

const ENDPOINT = "https://models.github.ai/inference/chat/completions";
const PROXY_ENDPOINT = "/api/llm";

function isLikelyActionRequest(text: string): boolean {
  return /\b(agendar|marcar|agenda|cancelar|desmarcar|reagendar|mover|remarcar|concluir|finalizar)\b/i.test(text);
}

function claimsActionSuccess(text: string): boolean {
  return /\b(agendei|agendado com sucesso|marquei|cancelei|cancelado com sucesso|movi|reagendei|conclui|concluido com sucesso|feito)\b/i.test(text);
}

async function callLLM(
  system: string,
  history: AgentMessage[],
  userMsg: string,
  data: string,
  config: AgentV2Config,
): Promise<string> {
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
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const useProxy = !isLocalhost;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (useProxy) {
      if (config.apiToken && config.apiToken !== "proxy") headers["x-github-token"] = config.apiToken;
    } else {
      if (!config.apiToken || config.apiToken === "proxy") {
        throw new Error("Token nao configurado para ambiente local.");
      }
      headers.Authorization = `Bearer ${config.apiToken}`;
    }

    const res = await fetch(useProxy ? PROXY_ENDPOINT : ENDPOINT, {
      method: "POST",
      headers,
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
  } else if (isLikelyActionRequest(msgTrimmed)) {
    if (claimsActionSuccess(raw)) {
      text = "Eu ainda nao confirmei essa operacao no banco. O modelo respondeu sem acionar a funcao corretamente, entao nada foi persistido. Tente repetir com cliente, servico, data e horario.";
    } else {
      text = raw.replace(/```[\s\S]*?```/g, "").trim() || "Nao consegui gerar a acao estruturada para executar no banco. Pode repetir o pedido?";
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

