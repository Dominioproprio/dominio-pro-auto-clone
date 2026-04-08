import {
  clientsStore,
  servicesStore,
  employeesStore,
  appointmentsStore,
  cashSessionsStore,
  type Client,
  type Employee,
  type Service,
  type Appointment,
  type AppointmentService,
} from "./store";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentV2Response {
  text: string;
  actionExecuted?: boolean;
  navigateTo?: string;
  messageId?: string;
  userMessage?: string;
}

type Intent =
  | "create_appointment"
  | "create_multiple_appointments"
  | "move_appointment"
  | "cancel_appointment"
  | "complete_appointment"
  | "create_client"
  | "replace_client"
  | "query"
  | "unknown";

type AppointmentDraft = {
  clientName?: string;
  clientId?: number | null;
  serviceName?: string;
  serviceId?: number | null;
  employeeName?: string;
  employeeId?: number | null;
  date?: string;
  time?: string;
};

type MultiAppointmentDraft = {
  clientName?: string;
  clientId?: number | null;
  blocks: AppointmentDraft[];
};

type PendingCommand =
  | { kind: "confirm_single"; draft: AppointmentDraft; originalMessage: string }
  | { kind: "confirm_multiple"; draft: MultiAppointmentDraft; originalMessage: string }
  | {
      kind: "confirm_create_client";
      client: { name: string; phone?: string | null; email?: string | null; notes?: string | null };
      originalMessage: string;
    }
  | {
      kind: "confirm_replace_client";
      appointmentId: number;
      currentClientName: string | null;
      newClientName: string;
      originalMessage: string;
    }
  | { kind: "confirm_move"; appointmentId: number; newDate: string; newTime: string; originalMessage: string }
  | { kind: "confirm_cancel"; appointmentId: number; originalMessage: string }
  | { kind: "confirm_complete"; appointmentId: number; originalMessage: string }
  | {
      kind: "await_client_choice";
      candidates: Client[];
      context:
        | { mode: "single"; draft: AppointmentDraft; originalMessage: string }
        | { mode: "multi"; blockIndex: number; draft: MultiAppointmentDraft; originalMessage: string }
        | { mode: "replace_client"; appointmentId: number; originalMessage: string };
    }
  | {
      kind: "await_employee_choice";
      candidates: Employee[];
      context:
        | { mode: "single"; draft: AppointmentDraft; originalMessage: string }
        | { mode: "multi"; blockIndex: number; draft: MultiAppointmentDraft; originalMessage: string };
    }
  | {
      kind: "await_service_choice";
      candidates: Service[];
      context:
        | { mode: "single"; draft: AppointmentDraft; originalMessage: string }
        | { mode: "multi"; blockIndex: number; draft: MultiAppointmentDraft; originalMessage: string };
    }
  | {
      kind: "await_appointment_choice";
      candidates: Appointment[];
      purpose: "cancel" | "move" | "complete" | "replace_client";
      payload?: Record<string, unknown>;
      originalMessage: string;
    };

type LlmIntentPayload = {
  intent: Intent;
  confidence?: number;
  responseText?: string;
  entities?: {
    clientName?: string;
    date?: string;
    time?: string;
    serviceName?: string;
    employeeName?: string;
    appointmentId?: number;
    newClientName?: string;
    phone?: string;
    email?: string;
    notes?: string;
    multiple?: boolean;
    blocks?: Array<{
      serviceName?: string;
      employeeName?: string;
      date?: string;
      time?: string;
    }>;
  };
};

const HISTORY_KEY = "super_agent_history";
const PENDING_KEY = "super_agent_pending";
const MAX_HISTORY = 24;
const GITHUB_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function loadHistory(): AgentMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: AgentMessage[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {}
}

function addToHistory(role: "user" | "assistant", content: string) {
  const history = loadHistory();
  history.push({ role, content });
  saveHistory(history);
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(PENDING_KEY);
}

function savePending(pending: PendingCommand | null) {
  try {
    if (!pending) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, savedAt: Date.now() }));
  } catch {}
}

function loadPending(): PendingCommand | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - Number(parsed.savedAt ?? 0) > 15 * 60_000) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    delete parsed.savedAt;
    return parsed as PendingCommand;
  } catch {
    return null;
  }
}

function getSalonName(): string {
  try {
    const raw = localStorage.getItem("salon_config");
    if (raw) return JSON.parse(raw).salonName || "Domínio Pro";
  } catch {}
  return "Domínio Pro";
}

function normalizeText(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s:/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function yesIntent(value: string): boolean {
  return /\b(sim|confirmo|confirmar|confirma|pode|ok|claro|isso|exatamente|prosseguir|manda|pode fazer)\b/i.test(normalizeText(value));
}

function noIntent(value: string): boolean {
  return /\b(nao|cancelar|cancela|deixa|pare|parar|volta|esquece|desistir)\b/i.test(normalizeText(value));
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

function normalizeTime(raw?: string): string | null {
  if (!raw) return null;
  let t = normalizeText(raw).replace(/h/g, ":").replace(/:$/, "");
  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2, "0")}:00`;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function resolveDate(raw?: string): string | null {
  if (!raw) return null;
  const base = normalizeText(raw);
  const today = new Date();
  if (base === "hoje") return getTodayStr();
  if (base === "amanha") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const days: Record<string, number> = {
    domingo: 0, segunda: 1, "segunda-feira": 1, terca: 2, "terca-feira": 2,
    quarta: 3, "quarta-feira": 3, quinta: 4, "quinta-feira": 4,
    sexta: 5, "sexta-feira": 5, sabado: 6,
  };
  if (base in days) {
    const wanted = days[base];
    const d = new Date(today);
    let diff = wanted - d.getDay();
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(base)) {
    const [dd, mm, yy] = base.split("/");
    const yyyy = yy ? (yy.length === 2 ? `20${yy}` : yy) : String(today.getFullYear());
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

function buildSystemData(): string {
  const today = getTodayStr();
  const employees = employeesStore.list(true);
  const services = servicesStore.list(true);
  const appointments = appointmentsStore.list({ startDate: today }).slice(0, 80);
  const cash = cashSessionsStore.getCurrent();
  return [
    `SALAO: ${getSalonName()}`,
    `HOJE: ${today}`,
    `CAIXA_ABERTO: ${cash ? "sim" : "nao"}`,
    `PROFISSIONAIS:\n${employees.map((e) => `- ID:${e.id} | ${e.name}`).join("\n") || "- nenhum"}`,
    `SERVICOS:\n${services.map((s) => `- ID:${s.id} | ${s.name} | ${s.durationMinutes}min | R$${s.price.toFixed(2)}`).join("\n") || "- nenhum"}`,
    `AGENDA_FUTURA:\n${appointments.map((a) => `- ID:${a.id} | ${a.startTime.slice(0,16).replace("T"," ")} | ${a.clientName ?? "-"} | emp:${a.employeeId} | ${a.services?.map((s) => s.name).join(", ") || "-"} | ${a.status}`).join("\n") || "- vazia"}`,
  ].join("\n\n");
}

function buildIntentPrompt(userMessage: string, history: AgentMessage[]): string {
  const compactHistory = history.slice(-8).map((m) => `${m.role === "user" ? "USUARIO" : "AGENTE"}: ${m.content}`).join("\n");
  return `Você extrai intenção para um sistema de salão. Responda SOMENTE JSON válido.
Regras duras:
- nunca invente IDs
- não criar cliente se o usuário não pedir claramente
- não editar cadastro se o usuário não pedir claramente
- em ambiguidade, o sistema vai perguntar; apenas extraia o que existir
- se houver vários serviços/profissionais na mesma solicitação, use intent=create_multiple_appointments e blocks
- para troca de cliente use intent=replace_client
- para reagendar use intent=move_appointment
- para cancelar use intent=cancel_appointment
- para concluir use intent=complete_appointment
- se for consulta, use intent=query

JSON:
{
  "intent":"create_appointment|create_multiple_appointments|move_appointment|cancel_appointment|complete_appointment|create_client|replace_client|query|unknown",
  "confidence":0.0,
  "responseText":"resposta curta opcional",
  "entities":{
    "clientName":"",
    "date":"",
    "time":"",
    "serviceName":"",
    "employeeName":"",
    "appointmentId":123,
    "newClientName":"",
    "phone":"",
    "email":"",
    "notes":"",
    "multiple":true,
    "blocks":[{"serviceName":"","employeeName":"","date":"","time":""}]
  }
}

DADOS DO SISTEMA:
${buildSystemData()}

HISTORICO:
${compactHistory || "(sem historico)"}

MENSAGEM DO USUARIO:
${userMessage}`;
}

function getProviderConfig():
  | { provider: "github"; token: string; model: string }
  | { provider: "groq"; token: string; model: string }
  | null {
  const githubToken = import.meta.env.VITE_GITHUB_MODELS_TOKEN || localStorage.getItem("github_models_token") || localStorage.getItem("github_token");
  if (githubToken) return { provider: "github", token: githubToken, model: import.meta.env.VITE_GITHUB_MODELS_MODEL || "openai/gpt-4o-mini" };
  const groqToken = import.meta.env.VITE_GROQ_API_KEY || localStorage.getItem("groq_api_key");
  if (groqToken) return { provider: "groq", token: groqToken, model: import.meta.env.VITE_GROQ_MODEL || "llama-3.3-70b-versatile" };
  return null;
}

async function callLLM(prompt: string): Promise<LlmIntentPayload | null> {
  const provider = getProviderConfig();
  if (!provider) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let endpoint = GROQ_ENDPOINT;
  if (provider.provider === "github") {
    endpoint = GITHUB_ENDPOINT;
    headers.Authorization = `Bearer ${provider.token}`;
  } else {
    headers.Authorization = `Bearer ${provider.token}`;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as LlmIntentPayload;
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as LlmIntentPayload) : null;
  }
}

function fallbackIntent(message: string): LlmIntentPayload {
  const m = normalizeText(message);
  if (/\b(criar cliente|cadastrar cliente|novo cliente)\b/.test(m)) return { intent: "create_client", confidence: 0.55, entities: {} };
  if (/\b(troca cliente|trocar cliente|substituir cliente)\b/.test(m)) return { intent: "replace_client", confidence: 0.6, entities: {} };
  if (/\b(cancelar|desmarcar)\b/.test(m)) return { intent: "cancel_appointment", confidence: 0.7, entities: {} };
  if (/\b(reagendar|remarcar|mover)\b/.test(m)) return { intent: "move_appointment", confidence: 0.7, entities: {} };
  if (/\b(concluir|finalizar)\b/.test(m)) return { intent: "complete_appointment", confidence: 0.7, entities: {} };
  if (/\b(multiplos agendamentos|multiplos|vários agendamentos|varios agendamentos)\b/.test(m)) return { intent: "create_multiple_appointments", confidence: 0.7, entities: { multiple: true, blocks: [] } };
  if (/\b(agendar|marcar|agenda)\b/.test(m)) return { intent: "create_appointment", confidence: 0.7, entities: {} };
  return { intent: "query", confidence: 0.4, entities: {} };
}

async function inferIntent(message: string): Promise<LlmIntentPayload> {
  try {
    const llm = await callLLM(buildIntentPrompt(message, loadHistory()));
    return llm ?? fallbackIntent(message);
  } catch {
    return fallbackIntent(message);
  }
}

async function resolveClientByName(name?: string): Promise<{ exact?: Client; many?: Client[]; none?: true }> {
  if (!name) return { none: true };
  const found = await clientsStore.search(name, { limit: 8 });
  if (found.length === 1) return { exact: found[0] };
  if (found.length > 1) return { many: found };
  return { none: true };
}

function resolveServiceByName(name?: string): { exact?: Service; many?: Service[]; none?: true } {
  if (!name) return { none: true };
  const services = servicesStore.list(true);
  const exact = services.find((s) => slug(s.name) === slug(name));
  if (exact) return { exact };
  const matches = services.filter((s) => slug(s.name).includes(slug(name)) || slug(name).includes(slug(s.name)));
  if (matches.length === 1) return { exact: matches[0] };
  if (matches.length > 1) return { many: matches.slice(0, 8) };
  return { none: true };
}

function resolveEmployeeByName(name?: string): { exact?: Employee; many?: Employee[]; none?: true } {
  if (!name) return { none: true };
  const employees = employeesStore.list(true);
  const exact = employees.find((e) => slug(e.name) === slug(name));
  if (exact) return { exact };
  const matches = employees.filter((e) => slug(e.name).includes(slug(name)) || slug(name).includes(slug(e.name)));
  if (matches.length === 1) return { exact: matches[0] };
  if (matches.length > 1) return { many: matches.slice(0, 8) };
  return { none: true };
}

function buildStartEnd(date: string, time: string, durationMinutes: number): { startTime: string; endTime: string } {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const start = new Date(year, month - 1, day, hour, minute, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startTime: start.toISOString().slice(0, 19), endTime: end.toISOString().slice(0, 19) };
}

function isWithinWorkingHours(emp: Employee, date: string, time: string): { ok: boolean; message?: string } {
  const wh = emp.workingHours;
  if (!wh || Object.keys(wh).length === 0) return { ok: true };
  const day = new Date(`${date}T12:00:00`).getDay();
  const keys: Record<number, string[]> = {
    0: ["0", "dom", "domingo"],
    1: ["1", "seg", "segunda", "segunda-feira"],
    2: ["2", "ter", "terca", "terca-feira"],
    3: ["3", "qua", "quarta", "quarta-feira"],
    4: ["4", "qui", "quinta", "quinta-feira"],
    5: ["5", "sex", "sexta", "sexta-feira"],
    6: ["6", "sab", "sabado", "sábado"],
  };
  const key = keys[day].find((k) => wh[k] !== undefined);
  const cfg = key ? wh[key] : undefined;
  if (!cfg || !cfg.active) return { ok: false, message: `${emp.name} não trabalha nessa data.` };
  const req = timeToMinutes(time);
  if (req < timeToMinutes(cfg.start) || req >= timeToMinutes(cfg.end)) {
    return { ok: false, message: `${emp.name} trabalha das ${cfg.start} às ${cfg.end}.` };
  }
  return { ok: true };
}

function findConflict(employeeId: number, date: string, start: string, end: string, ignoreId?: number): Appointment | null {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return appointmentsStore.list({ date }).find((a) => {
    if (a.id === ignoreId || a.employeeId !== employeeId || a.status === "cancelled") return false;
    const aStart = new Date(a.startTime).getTime();
    const aEnd = new Date(a.endTime).getTime();
    return startMs < aEnd && endMs > aStart;
  }) || null;
}

async function ensureSingleDraftResolved(draft: AppointmentDraft, originalMessage: string): Promise<{ ready?: AppointmentDraft; text?: string; pending?: PendingCommand }> {
  const next = { ...draft };
  if (next.clientName && !next.clientId) {
    const client = await resolveClientByName(next.clientName);
    if (client.exact) {
      next.clientId = client.exact.id;
      next.clientName = client.exact.name;
    } else if (client.many) {
      const pending: PendingCommand = { kind: "await_client_choice", candidates: client.many, context: { mode: "single", draft: next, originalMessage } };
      return { pending, text: `Encontrei mais de um cliente com esse nome:\n${client.many.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}\n\nMe diga qual é o cliente correto.` };
    } else {
      return { text: `Cliente "${next.clientName}" não foi encontrado. Eu não posso criar cliente automaticamente. Se quiser, peça explicitamente para cadastrar.` };
    }
  }
  if (next.serviceName && !next.serviceId) {
    const service = resolveServiceByName(next.serviceName);
    if (service.exact) {
      next.serviceId = service.exact.id;
      next.serviceName = service.exact.name;
    } else if (service.many) {
      const pending: PendingCommand = { kind: "await_service_choice", candidates: service.many, context: { mode: "single", draft: next, originalMessage } };
      return { pending, text: `Encontrei mais de um serviço parecido:\n${service.many.map((s) => `- ${s.name} (ID:${s.id})`).join("\n")}\n\nQual deles é o correto?` };
    } else {
      return { text: `Serviço "${next.serviceName}" não foi encontrado.` };
    }
  }
  if (next.employeeName && !next.employeeId) {
    const employee = resolveEmployeeByName(next.employeeName);
    if (employee.exact) {
      next.employeeId = employee.exact.id;
      next.employeeName = employee.exact.name;
    } else if (employee.many) {
      const pending: PendingCommand = { kind: "await_employee_choice", candidates: employee.many, context: { mode: "single", draft: next, originalMessage } };
      return { pending, text: `Encontrei mais de um profissional parecido:\n${employee.many.map((e) => `- ${e.name} (ID:${e.id})`).join("\n")}\n\nQual deles?` };
    } else {
      return { text: `Profissional "${next.employeeName}" não foi encontrado.` };
    }
  }
  if (!next.clientId) return { text: "Primeiro preciso identificar o cliente com certeza." };
  if (!next.date) return { text: "Agora preciso da data do agendamento." };
  if (!next.time) return { text: "Agora preciso do horário do agendamento." };
  if (!next.serviceId) return { text: "Agora preciso do serviço correto." };
  if (!next.employeeId) return { text: "Agora preciso do profissional correto." };
  return { ready: next };
}

function formatSingleConfirmation(draft: AppointmentDraft, service: Service, employee: Employee): string {
  return [
    "Vou criar este agendamento:",
    `Cliente: ${draft.clientName}`,
    `Data: ${draft.date}`,
    `Hora: ${draft.time}`,
    `Serviço: ${service.name}`,
    `Profissional: ${employee.name}`,
    "",
    "Responda \"sim\" para confirmar.",
  ].join("\n");
}

function formatMultipleConfirmation(draft: MultiAppointmentDraft): string {
  const lines = ["Vou criar estes múltiplos agendamentos:", `Cliente: ${draft.clientName}`];
  draft.blocks.forEach((block, idx) => {
    lines.push(``);
    lines.push(`Bloco ${idx + 1}:`);
    lines.push(`- Data: ${block.date}`);
    lines.push(`- Hora: ${block.time}`);
    lines.push(`- Serviço: ${block.serviceName}`);
    lines.push(`- Profissional: ${block.employeeName}`);
  });
  lines.push("", 'Responda "sim" para confirmar.');
  return lines.join("\n");
}

async function createSingleAppointment(draft: AppointmentDraft): Promise<string> {
  const service = servicesStore.list(true).find((s) => s.id === draft.serviceId)!;
  const employee = employeesStore.list(true).find((e) => e.id === draft.employeeId)!;
  const wh = isWithinWorkingHours(employee, draft.date!, draft.time!);
  if (!wh.ok) return wh.message!;
  const schedule = buildStartEnd(draft.date!, draft.time!, service.durationMinutes || 60);
  const conflict = findConflict(employee.id, draft.date!, schedule.startTime, schedule.endTime);
  if (conflict) {
    const start = conflict.startTime.slice(11, 16);
    const end = conflict.endTime.slice(11, 16);
    return `${employee.name} já tem conflito das ${start} às ${end} com ${conflict.clientName ?? "outro cliente"}. Não posso agendar em conflito.`;
  }
  const serviceData: AppointmentService = {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes,
    color: service.color,
    materialCostPercent: service.materialCostPercent,
  };
  const created = await appointmentsStore.create({
    clientName: draft.clientName!,
    clientId: draft.clientId!,
    employeeId: employee.id,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    status: "scheduled",
    totalPrice: service.price,
    notes: "Criado pelo Super Agente",
    paymentStatus: null,
    groupId: null,
    services: [serviceData],
  });
  window.dispatchEvent(new Event("store_updated"));
  return `Agendamento criado com sucesso!\nID: ${created.id}\nCliente: ${created.clientName}\nData: ${draft.date} às ${draft.time}\nServiço: ${service.name}\nProfissional: ${employee.name}`;
}

async function createMultipleAppointments(draft: MultiAppointmentDraft): Promise<string> {
  const groupId = `grp_${Date.now()}`;
  const createdIds: number[] = [];
  for (const block of draft.blocks) {
    const service = servicesStore.list(true).find((s) => s.id === block.serviceId)!;
    const employee = employeesStore.list(true).find((e) => e.id === block.employeeId)!;
    const wh = isWithinWorkingHours(employee, block.date!, block.time!);
    if (!wh.ok) return `Bloco com ${employee.name}: ${wh.message}`;
    const schedule = buildStartEnd(block.date!, block.time!, service.durationMinutes || 60);
    const conflict = findConflict(employee.id, block.date!, schedule.startTime, schedule.endTime);
    if (conflict) {
      const start = conflict.startTime.slice(11, 16);
      const end = conflict.endTime.slice(11, 16);
      return `Conflito no bloco ${service.name}: ${employee.name} já tem horário das ${start} às ${end}.`;
    }
    const serviceData: AppointmentService = {
      serviceId: service.id,
      name: service.name,
      price: service.price,
      durationMinutes: service.durationMinutes,
      color: service.color,
      materialCostPercent: service.materialCostPercent,
    };
    const created = await appointmentsStore.create({
      clientName: draft.clientName!,
      clientId: draft.clientId!,
      employeeId: employee.id,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      status: "scheduled",
      totalPrice: service.price,
      notes: "Criado pelo Super Agente — múltiplos agendamentos",
      paymentStatus: null,
      groupId,
      services: [serviceData],
    });
    createdIds.push(created.id);
  }
  window.dispatchEvent(new Event("store_updated"));
  return `Múltiplos agendamentos criados com sucesso!\nCliente: ${draft.clientName}\nGroupId: ${groupId}\nIDs: ${createdIds.join(", ")}`;
}

function queryAppointmentsByClientName(name: string): Appointment[] {
  const q = slug(name);
  return appointmentsStore.list({}).filter((a) => slug(a.clientName || "").includes(q));
}

function pickByUserChoice<T extends { id: number; name?: string | null; clientName?: string | null }>(message: string, items: T[]): T | null {
  const num = message.match(/\b(\d+)\b/);
  if (num) {
    const found = items.find((item) => item.id === Number(num[1]));
    if (found) return found;
  }
  const m = slug(message);
  return items.find((item) => slug(String(item.name ?? item.clientName ?? "")).includes(m) || m.includes(slug(String(item.name ?? item.clientName ?? "")))) || null;
}

async function handlePending(message: string): Promise<AgentV2Response | null> {
  const pending = loadPending();
  if (!pending) return null;
  if (noIntent(message) && pending.kind.startsWith("confirm_")) {
    savePending(null);
    const text = "Ok. Não vou executar essa alteração.";
    addToHistory("assistant", text);
    return { text, messageId: `m_${Date.now()}` };
  }
  switch (pending.kind) {
    case "confirm_single": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const text = await createSingleAppointment(pending.draft);
      addToHistory("assistant", text);
      return { text, actionExecuted: text.includes("criado com sucesso"), navigateTo: text.includes("criado com sucesso") ? "/agenda" : undefined, messageId: `m_${Date.now()}` };
    }
    case "confirm_multiple": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const text = await createMultipleAppointments(pending.draft);
      addToHistory("assistant", text);
      return { text, actionExecuted: text.includes("criados com sucesso"), navigateTo: text.includes("criados com sucesso") ? "/agenda" : undefined, messageId: `m_${Date.now()}` };
    }
    case "confirm_create_client": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const created = await clientsStore.create({
        name: pending.client.name,
        email: pending.client.email ?? null,
        phone: pending.client.phone ?? null,
        birthDate: null,
        cpf: null,
        address: null,
        notes: pending.client.notes ?? "Criado pelo Super Agente",
      });
      window.dispatchEvent(new Event("store_updated"));
      const text = `Cliente criado com sucesso!\nID: ${created.id}\nNome: ${created.name}`;
      addToHistory("assistant", text);
      return { text, actionExecuted: true, navigateTo: "/clientes", messageId: `m_${Date.now()}` };
    }
    case "confirm_replace_client": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const resolved = await resolveClientByName(pending.newClientName);
      if (!resolved.exact) {
        const text = resolved.many ? `Encontrei mais de um cliente para substituir:\n${resolved.many.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}` : `Cliente "${pending.newClientName}" não encontrado.`;
        return { text, messageId: `m_${Date.now()}` };
      }
      const updated = await appointmentsStore.update(pending.appointmentId, { clientId: resolved.exact.id, clientName: resolved.exact.name });
      window.dispatchEvent(new Event("store_updated"));
      const text = updated ? `Cliente do agendamento #${pending.appointmentId} substituído com sucesso por ${resolved.exact.name}.` : `Não consegui atualizar o agendamento #${pending.appointmentId}.`;
      addToHistory("assistant", text);
      return { text, actionExecuted: !!updated, navigateTo: updated ? "/agenda" : undefined, messageId: `m_${Date.now()}` };
    }
    case "confirm_move": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const appt = appointmentsStore.get(pending.appointmentId);
      if (!appt) return { text: `Agendamento #${pending.appointmentId} não encontrado.`, messageId: `m_${Date.now()}` };
      const duration = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
      const [y, m, d] = pending.newDate.split("-").map(Number);
      const [hh, mm] = pending.newTime.split(":").map(Number);
      const start = new Date(y, m - 1, d, hh, mm, 0);
      const end = new Date(start.getTime() + duration);
      const employee = employeesStore.list(true).find((e) => e.id === appt.employeeId);
      if (employee) {
        const wh = isWithinWorkingHours(employee, pending.newDate, pending.newTime);
        if (!wh.ok) return { text: wh.message!, messageId: `m_${Date.now()}` };
      }
      const conflict = findConflict(appt.employeeId, pending.newDate, start.toISOString().slice(0,19), end.toISOString().slice(0,19), appt.id);
      if (conflict) return { text: `Conflito detectado. Não posso reagendar em cima de outro horário.`, messageId: `m_${Date.now()}` };
      await appointmentsStore.update(appt.id, { startTime: start.toISOString().slice(0,19), endTime: end.toISOString().slice(0,19) });
      window.dispatchEvent(new Event("store_updated"));
      const text = `Agendamento #${appt.id} reagendado para ${pending.newDate} às ${pending.newTime}.`;
      addToHistory("assistant", text);
      return { text, actionExecuted: true, navigateTo: "/agenda", messageId: `m_${Date.now()}` };
    }
    case "confirm_cancel": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const updated = await appointmentsStore.update(pending.appointmentId, { status: "cancelled" });
      window.dispatchEvent(new Event("store_updated"));
      const text = updated ? `Agendamento #${pending.appointmentId} cancelado com sucesso.` : `Não consegui cancelar o agendamento #${pending.appointmentId}.`;
      addToHistory("assistant", text);
      return { text, actionExecuted: !!updated, navigateTo: updated ? "/agenda" : undefined, messageId: `m_${Date.now()}` };
    }
    case "confirm_complete": {
      if (!yesIntent(message)) return null;
      savePending(null);
      const updated = await appointmentsStore.update(pending.appointmentId, { status: "completed" });
      window.dispatchEvent(new Event("store_updated"));
      const text = updated ? `Agendamento #${pending.appointmentId} concluído com sucesso.` : `Não consegui concluir o agendamento #${pending.appointmentId}.`;
      addToHistory("assistant", text);
      return { text, actionExecuted: !!updated, navigateTo: updated ? "/agenda" : undefined, messageId: `m_${Date.now()}` };
    }
    case "await_client_choice": {
      const chosen = pickByUserChoice(message, pending.candidates);
      if (!chosen) {
        return { text: `Ainda não identifiquei o cliente correto. Escolha um destes:\n${pending.candidates.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}`, messageId: `m_${Date.now()}` };
      }
      savePending(null);
      if (pending.context.mode === "single") {
        const draft = { ...pending.context.draft, clientId: chosen.id, clientName: chosen.name };
        const resolved = await ensureSingleDraftResolved(draft, pending.context.originalMessage);
        if (resolved.pending) savePending(resolved.pending);
        if (resolved.text && !resolved.ready) return { text: resolved.text, messageId: `m_${Date.now()}` };
        const service = servicesStore.list(true).find((s) => s.id === resolved.ready!.serviceId)!;
        const employee = employeesStore.list(true).find((e) => e.id === resolved.ready!.employeeId)!;
        const confirmText = formatSingleConfirmation(resolved.ready!, service, employee);
        savePending({ kind: "confirm_single", draft: resolved.ready!, originalMessage: pending.context.originalMessage });
        return { text: confirmText, messageId: `m_${Date.now()}` };
      }
      if (pending.context.mode === "replace_client") {
        savePending({ kind: "confirm_replace_client", appointmentId: pending.context.appointmentId, currentClientName: null, newClientName: chosen.name, originalMessage: pending.context.originalMessage });
        return { text: `Vou substituir o cliente do agendamento #${pending.context.appointmentId} por ${chosen.name}. Responda "sim" para confirmar.`, messageId: `m_${Date.now()}` };
      }
      const draft = { ...pending.context.draft, clientId: chosen.id, clientName: chosen.name };
      const block = draft.blocks[pending.context.blockIndex];
      const resolved = await ensureSingleDraftResolved({ ...block, clientId: chosen.id, clientName: chosen.name }, pending.context.originalMessage);
      if (resolved.pending) savePending(resolved.pending);
      if (!resolved.ready) return { text: resolved.text || "Ainda preciso confirmar o cliente.", messageId: `m_${Date.now()}` };
      draft.blocks[pending.context.blockIndex] = resolved.ready;
      savePending({ kind: "confirm_multiple", draft, originalMessage: pending.context.originalMessage });
      return { text: formatMultipleConfirmation(draft), messageId: `m_${Date.now()}` };
    }
    case "await_employee_choice": {
      const chosen = pickByUserChoice(message, pending.candidates);
      if (!chosen) return { text: `Escolha o profissional correto:\n${pending.candidates.map((e) => `- ${e.name} (ID:${e.id})`).join("\n")}`, messageId: `m_${Date.now()}` };
      savePending(null);
      if (pending.context.mode === "single") {
        const draft = { ...pending.context.draft, employeeId: chosen.id, employeeName: chosen.name };
        const resolved = await ensureSingleDraftResolved(draft, pending.context.originalMessage);
        if (resolved.pending) savePending(resolved.pending);
        if (!resolved.ready) return { text: resolved.text || "Ainda preciso de mais dados.", messageId: `m_${Date.now()}` };
        const service = servicesStore.list(true).find((s) => s.id === resolved.ready.serviceId)!;
        const employee = employeesStore.list(true).find((e) => e.id === resolved.ready.employeeId)!;
        savePending({ kind: "confirm_single", draft: resolved.ready, originalMessage: pending.context.originalMessage });
        return { text: formatSingleConfirmation(resolved.ready, service, employee), messageId: `m_${Date.now()}` };
      }
      const draft = { ...pending.context.draft };
      draft.blocks[pending.context.blockIndex] = { ...draft.blocks[pending.context.blockIndex], employeeId: chosen.id, employeeName: chosen.name };
      savePending({ kind: "confirm_multiple", draft, originalMessage: pending.context.originalMessage });
      return { text: formatMultipleConfirmation(draft), messageId: `m_${Date.now()}` };
    }
    case "await_service_choice": {
      const chosen = pickByUserChoice(message, pending.candidates);
      if (!chosen) return { text: `Escolha o serviço correto:\n${pending.candidates.map((s) => `- ${s.name} (ID:${s.id})`).join("\n")}`, messageId: `m_${Date.now()}` };
      savePending(null);
      if (pending.context.mode === "single") {
        const draft = { ...pending.context.draft, serviceId: chosen.id, serviceName: chosen.name };
        const resolved = await ensureSingleDraftResolved(draft, pending.context.originalMessage);
        if (resolved.pending) savePending(resolved.pending);
        if (!resolved.ready) return { text: resolved.text || "Ainda preciso de mais dados.", messageId: `m_${Date.now()}` };
        const service = servicesStore.list(true).find((s) => s.id === resolved.ready.serviceId)!;
        const employee = employeesStore.list(true).find((e) => e.id === resolved.ready.employeeId)!;
        savePending({ kind: "confirm_single", draft: resolved.ready, originalMessage: pending.context.originalMessage });
        return { text: formatSingleConfirmation(resolved.ready, service, employee), messageId: `m_${Date.now()}` };
      }
      const draft = { ...pending.context.draft };
      draft.blocks[pending.context.blockIndex] = { ...draft.blocks[pending.context.blockIndex], serviceId: chosen.id, serviceName: chosen.name };
      savePending({ kind: "confirm_multiple", draft, originalMessage: pending.context.originalMessage });
      return { text: formatMultipleConfirmation(draft), messageId: `m_${Date.now()}` };
    }
    case "await_appointment_choice": {
      const chosen = pickByUserChoice(message, pending.candidates);
      if (!chosen) return { text: `Escolha o agendamento correto:\n${pending.candidates.map((a) => `- ID:${a.id} | ${a.clientName ?? "-"} | ${a.startTime.slice(0,16).replace("T"," ")}`).join("\n")}`, messageId: `m_${Date.now()}` };
      savePending(null);
      if (pending.purpose === "cancel") {
        savePending({ kind: "confirm_cancel", appointmentId: chosen.id, originalMessage: pending.originalMessage });
        return { text: `Vou cancelar o agendamento #${chosen.id} de ${chosen.clientName ?? "cliente"}. Responda "sim" para confirmar.`, messageId: `m_${Date.now()}` };
      }
      if (pending.purpose === "complete") {
        savePending({ kind: "confirm_complete", appointmentId: chosen.id, originalMessage: pending.originalMessage });
        return { text: `Vou concluir o agendamento #${chosen.id} de ${chosen.clientName ?? "cliente"}. Responda "sim" para confirmar.`, messageId: `m_${Date.now()}` };
      }
      if (pending.purpose === "move") {
        const date = resolveDate(String(pending.payload?.newDate ?? ""));
        const time = normalizeTime(String(pending.payload?.newTime ?? ""));
        if (!date || !time) return { text: "Ainda preciso da nova data e do novo horário para reagendar.", messageId: `m_${Date.now()}` };
        savePending({ kind: "confirm_move", appointmentId: chosen.id, newDate: date, newTime: time, originalMessage: pending.originalMessage });
        return { text: `Vou reagendar o agendamento #${chosen.id} para ${date} às ${time}. Responda "sim" para confirmar.`, messageId: `m_${Date.now()}` };
      }
      const newClientName = String(pending.payload?.newClientName ?? "").trim();
      if (!newClientName) return { text: "Ainda preciso do nome do novo cliente para fazer a troca.", messageId: `m_${Date.now()}` };
      const resolved = await resolveClientByName(newClientName);
      if (resolved.exact) {
        savePending({ kind: "confirm_replace_client", appointmentId: chosen.id, currentClientName: chosen.clientName, newClientName: resolved.exact.name, originalMessage: pending.originalMessage });
        return { text: `Vou trocar o cliente do agendamento #${chosen.id} de ${chosen.clientName ?? "-"} para ${resolved.exact.name}. Responda "sim" para confirmar.`, messageId: `m_${Date.now()}` };
      }
      if (resolved.many) {
        savePending({ kind: "await_client_choice", candidates: resolved.many, context: { mode: "replace_client", appointmentId: chosen.id, originalMessage: pending.originalMessage } });
        return { text: `Encontrei mais de um cliente para a troca:\n${resolved.many.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}\n\nQual é o cliente correto?`, messageId: `m_${Date.now()}` };
      }
      return { text: `Cliente "${newClientName}" não encontrado. Eu não posso criar cliente automaticamente.`, messageId: `m_${Date.now()}` };
    }
  }
}

function tryQueryResponse(message: string): string | null {
  const m = normalizeText(message);
  if (/\b(agenda hoje|agendamentos hoje|quais agendamentos temos hoje)\b/.test(m)) {
    const today = getTodayStr();
    const appts = appointmentsStore.list({ date: today });
    if (!appts.length) return `Hoje (${today}) não há agendamentos.`;
    return `Agenda de hoje (${today}):\n${appts.map((a) => `- ID:${a.id} | ${a.startTime.slice(11,16)} | ${a.clientName ?? "-"} | ${(a.services ?? []).map((s) => s.name).join(", ") || "-"}`).join("\n")}`;
  }
  if (/\b(faturamento hoje|qual o faturamento de hoje|financeiro hoje)\b/.test(m)) {
    const today = getTodayStr();
    const total = appointmentsStore.list({ date: today }).filter((a) => a.status !== "cancelled").reduce((sum, a) => sum + Number(a.totalPrice ?? 0), 0);
    return `Faturamento bruto previsto para hoje: R$ ${total.toFixed(2)}.`;
  }
  return null;
}

export async function handleMessageV2(userMessage: string): Promise<AgentV2Response> {
  const msg = userMessage.trim();
  if (!msg) return { text: "Escreva sua solicitação.", messageId: `m_${Date.now()}` };
  addToHistory("user", msg);

  const pendingResult = await handlePending(msg);
  if (pendingResult) return pendingResult;

  const quickQuery = tryQueryResponse(msg);
  if (quickQuery) {
    addToHistory("assistant", quickQuery);
    return { text: quickQuery, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  const intentData = await inferIntent(msg);
  const entities = intentData.entities || {};

  if (intentData.intent === "create_client") {
    const clientName = entities.clientName?.trim();
    if (!clientName) {
      const text = "Para cadastrar cliente, eu preciso pelo menos do nome completo.";
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const text = `Vou criar o cliente:\nNome: ${clientName}${entities.phone ? `\nTelefone: ${entities.phone}` : ""}${entities.email ? `\nEmail: ${entities.email}` : ""}\n\nResponda "sim" para confirmar.`;
    savePending({ kind: "confirm_create_client", client: { name: clientName, phone: entities.phone ?? null, email: entities.email ?? null, notes: entities.notes ?? null }, originalMessage: msg });
    addToHistory("assistant", text);
    return { text, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  if (intentData.intent === "replace_client") {
    const apptId = entities.appointmentId;
    const newClientName = entities.newClientName?.trim();
    if (apptId) {
      const appt = appointmentsStore.get(apptId);
      if (!appt) {
        const text = `Agendamento #${apptId} não encontrado.`;
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      if (!newClientName) {
        const text = `Encontrei o agendamento #${apptId}. Agora preciso do nome do novo cliente.`;
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      const resolved = await resolveClientByName(newClientName);
      if (resolved.exact) {
        const text = `Vou trocar o cliente do agendamento #${apptId} de ${appt.clientName ?? "-"} para ${resolved.exact.name}. Responda "sim" para confirmar.`;
        savePending({ kind: "confirm_replace_client", appointmentId: apptId, currentClientName: appt.clientName, newClientName: resolved.exact.name, originalMessage: msg });
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      if (resolved.many) {
        const text = `Encontrei mais de um cliente para a troca:\n${resolved.many.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}\n\nQual é o cliente correto?`;
        savePending({ kind: "await_client_choice", candidates: resolved.many, context: { mode: "replace_client", appointmentId: apptId, originalMessage: msg } });
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      const text = `Cliente "${newClientName}" não encontrado. Eu não posso criar cliente automaticamente.`;
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const candidates = entities.clientName ? queryAppointmentsByClientName(entities.clientName) : appointmentsStore.list({}).slice(-20).reverse();
    if (!candidates.length) {
      const text = "Não encontrei agendamentos para fazer a troca de cliente.";
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const text = `Encontrei estes agendamentos. Qual deles devo alterar?\n${candidates.slice(0, 8).map((a) => `- ID:${a.id} | ${a.clientName ?? "-"} | ${a.startTime.slice(0,16).replace("T"," ")}`).join("\n")}`;
    savePending({ kind: "await_appointment_choice", candidates: candidates.slice(0, 8), purpose: "replace_client", payload: { newClientName: newClientName ?? "" }, originalMessage: msg });
    addToHistory("assistant", text);
    return { text, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  if (intentData.intent === "cancel_appointment" || intentData.intent === "move_appointment" || intentData.intent === "complete_appointment") {
    const appointmentId = entities.appointmentId;
    const purpose = intentData.intent === "cancel_appointment" ? "cancel" : intentData.intent === "move_appointment" ? "move" : "complete";
    if (appointmentId) {
      const appt = appointmentsStore.get(appointmentId);
      if (!appt) {
        const text = `Agendamento #${appointmentId} não encontrado.`;
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      if (purpose === "cancel") {
        const text = `Vou cancelar o agendamento #${appt.id} de ${appt.clientName ?? "cliente"}. Responda "sim" para confirmar.`;
        savePending({ kind: "confirm_cancel", appointmentId: appt.id, originalMessage: msg });
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      if (purpose === "complete") {
        const text = `Vou concluir o agendamento #${appt.id} de ${appt.clientName ?? "cliente"}. Responda "sim" para confirmar.`;
        savePending({ kind: "confirm_complete", appointmentId: appt.id, originalMessage: msg });
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      const date = resolveDate(entities.date);
      const time = normalizeTime(entities.time);
      if (!date || !time) {
        const text = `Encontrei o agendamento #${appt.id}. Agora preciso da nova data e do novo horário.`;
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      const text = `Vou reagendar o agendamento #${appt.id} para ${date} às ${time}. Responda "sim" para confirmar.`;
      savePending({ kind: "confirm_move", appointmentId: appt.id, newDate: date, newTime: time, originalMessage: msg });
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const candidates = entities.clientName ? queryAppointmentsByClientName(entities.clientName) : appointmentsStore.list({}).slice(-20).reverse();
    if (!candidates.length) {
      const text = "Não encontrei agendamentos compatíveis.";
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const text = `Qual destes agendamentos devo alterar?\n${candidates.slice(0, 8).map((a) => `- ID:${a.id} | ${a.clientName ?? "-"} | ${a.startTime.slice(0,16).replace("T"," ")}`).join("\n")}`;
    savePending({ kind: "await_appointment_choice", candidates: candidates.slice(0, 8), purpose, payload: { newDate: entities.date ?? "", newTime: entities.time ?? "" }, originalMessage: msg });
    addToHistory("assistant", text);
    return { text, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  if (intentData.intent === "create_multiple_appointments") {
    const clientName = entities.clientName?.trim();
    if (!clientName) {
      const text = "Para criar múltiplos agendamentos, eu preciso fechar primeiro o cliente.";
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const client = await resolveClientByName(clientName);
    if (client.many) {
      const text = `Encontrei mais de um cliente com esse nome:\n${client.many.map((c) => `- ${c.name} (ID:${c.id})`).join("\n")}\n\nQual é o cliente correto?`;
      savePending({ kind: "await_client_choice", candidates: client.many, context: { mode: "multi", blockIndex: 0, draft: { clientName, clientId: null, blocks: [] }, originalMessage: msg } });
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    if (!client.exact) {
      const text = `Cliente "${clientName}" não foi encontrado. Eu não posso criar cliente automaticamente.`;
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const rawBlocks = entities.blocks?.length ? entities.blocks : [{ serviceName: entities.serviceName, employeeName: entities.employeeName, date: entities.date, time: entities.time }];
    const draft: MultiAppointmentDraft = { clientName: client.exact.name, clientId: client.exact.id, blocks: [] };
    for (const raw of rawBlocks) {
      const block: AppointmentDraft = { clientName: client.exact.name, clientId: client.exact.id, serviceName: raw.serviceName?.trim(), employeeName: raw.employeeName?.trim(), date: resolveDate(raw.date || undefined) || undefined, time: normalizeTime(raw.time || undefined) || undefined };
      const service = resolveServiceByName(block.serviceName);
      if (service.exact) {
        block.serviceId = service.exact.id;
        block.serviceName = service.exact.name;
      }
      const employee = resolveEmployeeByName(block.employeeName);
      if (employee.exact) {
        block.employeeId = employee.exact.id;
        block.employeeName = employee.exact.name;
      }
      if (!block.date || !block.time || !block.serviceId || !block.employeeId) {
        const text = `No modo de múltiplos agendamentos eu preciso fechar cada bloco com data, hora, serviço e profissional. O bloco incompleto foi: ${JSON.stringify(raw)}.`;
        addToHistory("assistant", text);
        return { text, messageId: `m_${Date.now()}`, userMessage: msg };
      }
      draft.blocks.push(block);
    }
    const confirmText = formatMultipleConfirmation(draft);
    savePending({ kind: "confirm_multiple", draft, originalMessage: msg });
    addToHistory("assistant", confirmText);
    return { text: confirmText, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  if (intentData.intent === "create_appointment") {
    const draft: AppointmentDraft = {
      clientName: entities.clientName?.trim(),
      date: resolveDate(entities.date || undefined) || undefined,
      time: normalizeTime(entities.time || undefined) || undefined,
      serviceName: entities.serviceName?.trim(),
      employeeName: entities.employeeName?.trim(),
    };
    const resolved = await ensureSingleDraftResolved(draft, msg);
    if (resolved.pending) savePending(resolved.pending);
    if (!resolved.ready) {
      const text = resolved.text || "Ainda preciso de mais dados para montar o agendamento.";
      addToHistory("assistant", text);
      return { text, messageId: `m_${Date.now()}`, userMessage: msg };
    }
    const service = servicesStore.list(true).find((s) => s.id === resolved.ready!.serviceId)!;
    const employee = employeesStore.list(true).find((e) => e.id === resolved.ready!.employeeId)!;
    const confirmText = formatSingleConfirmation(resolved.ready!, service, employee);
    savePending({ kind: "confirm_single", draft: resolved.ready!, originalMessage: msg });
    addToHistory("assistant", confirmText);
    return { text: confirmText, messageId: `m_${Date.now()}`, userMessage: msg };
  }

  const fallback = intentData.responseText || "Entendi. Posso consultar agenda, criar cliente sob ordem explícita, montar agendamento, reagendar, cancelar, concluir e trocar cliente sem suposição. Diga o que quer fazer com cliente, data, hora, serviço e profissional.";
  addToHistory("assistant", fallback);
  return { text: fallback, messageId: `m_${Date.now()}`, userMessage: msg };
}

export function initAgentV2(): void {
  // Mantido só por compatibilidade. A configuração agora é automática.
}

export function addFeedback(_userMessage: string, _agentResponse: string, _rating: "good" | "bad"): void {
  // Hook preservado para compatibilidade de interface.
}
