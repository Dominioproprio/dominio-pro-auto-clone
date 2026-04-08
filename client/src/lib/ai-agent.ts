/**
 * ai-agent.ts — Agente oficial do clone, reforçado com protocolo operacional.
 *
 * Mantém a interface pública do app:
 * - exporta executarAgente()
 * - usa stores reais do sistema
 * - não cria outro agente paralelo
 *
 * Regras aplicadas:
 * - não agenda com conflito
 * - não cria cliente automático
 * - não edita cadastro sem pedido explícito
 * - agenda é a fonte de verdade
 * - em ambiguidade, pergunta sempre
 * - uma etapa por vez: cliente -> data -> horário -> serviço -> profissional -> confirmação
 * - não assume serviço múltiplo
 */

import { supabase } from "./supabase";
import {
  servicesStore,
  employeesStore,
  clientsStore,
  appointmentsStore,
  cashSessionsStore,
  type Appointment,
  type AppointmentService,
  type Client,
  type Employee,
  type Service,
} from "./store";

export interface MensagemConversa {
  role: "user" | "assistant";
  content: string;
}

export interface ResultadoAgente {
  texto: string;
  agendamentoCriado?: Appointment;
  erro?: string;
}

type Intent = "schedule" | "query_schedule" | "query_finance" | "query_client" | "query_available" | "unknown";

interface DraftState {
  intent: "schedule";
  client?: Client;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  service?: Service;
  employee?: Employee;
  awaitingConfirmation?: boolean;
  updatedAt: number;
}

const DRAFT_KEY = "dominio_pro_ai_agent_draft_v1";
const TZ = "America/Sao_Paulo";
const WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;
const WEEKDAY_SHORT: Record<string, number> = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1, "segunda-feira": 1,
  ter: 2, terca: 2, terça: 2, "terca-feira": 2, "terça-feira": 2,
  qua: 3, quarta: 3, "quarta-feira": 3,
  qui: 4, quinta: 4, "quinta-feira": 4,
  sex: 5, sexta: 5, "sexta-feira": 5,
  sab: 6, sabado: 6, sábado: 6,
};
const YES = /^(sim|s|ok|confirmo|confirmar|pode|isso|isso mesmo|pode confirmar)[.! ]*$/i;
const NO = /^(nao|não|cancelar|cancela|deixa|deixa pra la|deixa pra lá)[.! ]*$/i;

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (!parsed?.updatedAt || Date.now() - parsed.updatedAt > 30 * 60_000) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(draft: DraftState | null): void {
  if (!draft) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }
  draft.updatedAt = Date.now();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function getLocalNow(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return new Date(`${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`);
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatDateLong(dateStr: string): string {
  const d = parseYMD(dateStr);
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: TZ,
  });
}

function getWeekdayName(dateStr: string): string {
  return WEEKDAY_LONG[parseYMD(dateStr).getDay()];
}

function extractTime(raw: string): string | undefined {
  const m = raw.match(/\b(\d{1,2})(?::|h)?(\d{2})?\b/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function resolveDateFromText(raw: string, allowPast = false): string | undefined {
  const input = normalizar(raw);
  if (!input) return undefined;

  const today = getLocalNow();
  today.setHours(12, 0, 0, 0);

  if (/\bhoje\b/.test(input)) return ymd(today);
  if (/\bontem\b/.test(input)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return allowPast ? ymd(d) : undefined;
  }
  if (/\bdepois de amanha\b|\bdepois de amanhã\b/.test(input)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return ymd(d);
  }
  if (/\bamanha\b|\bamanhã\b/.test(input)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return ymd(d);
  }

  const iso = input.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = input.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3] ?? today.getFullYear());
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day, 12, 0, 0);
      return ymd(d);
    }
  }

  const keys = Object.keys(WEEKDAY_SHORT).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const rx = new RegExp(`\\b${escapeRegex(key)}\\b`, "i");
    if (!rx.test(input)) continue;
    const target = WEEKDAY_SHORT[key];
    const current = today.getDay();
    let diff = target - current;
    if (diff <= 0) diff += 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return ymd(d);
  }

  return undefined;
}

function isPastDate(dateStr: string): boolean {
  const today = ymd(getLocalNow());
  return dateStr < today;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isScheduleIntent(msg: string): boolean {
  const n = normalizar(msg);
  return /(agendar|agenda|marcar|marca|horario|horário|encaixar|encaixe|desmarcar|remarcar|reagendar)/.test(n);
}

function detectIntent(msg: string): Intent {
  const n = normalizar(msg);
  if (isScheduleIntent(msg)) return "schedule";
  if (/(agenda|agendamentos|quem esta|quem está|horarios livres|horários livres)/.test(n)) return "query_schedule";
  if (/(faturamento|caixa|receita|entrou|financeiro)/.test(n)) return "query_finance";
  if (/(buscar cliente|cliente|telefone|cpf|email)/.test(n)) return "query_client";
  if (/(livres|disponiveis|disponíveis|equipe livre|funcionarios livres|funcionários livres)/.test(n)) return "query_available";
  return "unknown";
}

async function ensureBaseLoaded(): Promise<void> {
  await Promise.allSettled([
    clientsStore.ensureLoaded(),
    Promise.resolve(servicesStore.list(true).length || servicesStore.fetchAll()),
    Promise.resolve(employeesStore.list(true).length || employeesStore.fetchAll()),
    Promise.resolve(appointmentsStore.list().length || appointmentsStore.fetchAll()),
    Promise.resolve(cashSessionsStore.list().length || cashSessionsStore.fetchAll()),
  ]);
}

function findServiceInMessage(msg: string): Service | undefined {
  const n = normalizar(msg);
  const services = servicesStore.list(true);
  return services
    .map(service => ({ service, score: scoreNameMatch(n, service.name) }))
    .filter(x => x.score > 0.75)
    .sort((a, b) => b.score - a.score)[0]?.service;
}

function findEmployeeInMessage(msg: string): Employee | undefined {
  const n = normalizar(msg);
  const employees = employeesStore.list(true);
  return employees
    .map(employee => ({ employee, score: scoreNameMatch(n, employee.name) }))
    .filter(x => x.score > 0.75)
    .sort((a, b) => b.score - a.score)[0]?.employee;
}

function scoreNameMatch(haystack: string, candidate: string): number {
  const c = normalizar(candidate);
  if (!c) return 0;
  if (haystack.includes(c)) return 1;
  const tokens = c.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every(t => haystack.includes(t))) return 0.9;
  const intersect = tokens.filter(t => haystack.includes(t)).length;
  return intersect / Math.max(tokens.length, 1);
}

function extractLikelyClientTerm(msg: string): string | undefined {
  const raw = msg.trim();
  const after = raw.match(/(?:cliente|pra|para|da|do)\s+([A-ZÀ-Ú][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ú][\wÀ-ÿ'’-]+){0,3})/);
  if (after?.[1]) return after[1].trim();

  const capitals = raw.match(/\b([A-ZÀ-Ú][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ú][\wÀ-ÿ'’-]+){0,3})\b/g);
  if (capitals?.length) return capitals[0].trim();
  return undefined;
}

async function resolveClient(msg: string): Promise<{ client?: Client; error?: string }> {
  const term = extractLikelyClientTerm(msg);
  if (!term) return {};
  const found = await clientsStore.search(term, { limit: 5 });
  if (found.length === 1) return { client: found[0] };
  if (found.length > 1) {
    return { error: `Encontrei mais de um cliente para "${term}". Seja mais específico.` };
  }
  return { error: `Não encontrei cliente para "${term}". Não posso criar cliente automaticamente.` };
}

function summarizeDraft(draft: DraftState): string {
  return [
    `Cliente: ${draft.client?.name}`,
    `Data: ${draft.date ? formatDateLong(draft.date) : "—"}`,
    `Horário: ${draft.time ?? "—"}`,
    `Serviço: ${draft.service?.name ?? "—"}`,
    `Profissional: ${draft.employee?.name ?? "—"}`,
  ].join("\n");
}

function nextQuestion(draft: DraftState): string {
  if (!draft.client) return "Qual é o cliente?";
  if (!draft.date) return "Qual é a data?";
  if (!draft.time) return "Qual é o horário?";
  if (!draft.service) return "Qual é o serviço?";
  if (!draft.employee) return "Qual é o profissional?";
  return `Confirma?\n${summarizeDraft(draft)}`;
}

function buildAppointmentPayload(draft: DraftState): Omit<Appointment, "id" | "createdAt"> {
  const startTime = new Date(`${draft.date}T${draft.time}:00`).toISOString();
  const end = new Date(new Date(`${draft.date}T${draft.time}:00`).getTime() + (draft.service?.durationMinutes ?? 0) * 60_000);
  const endTime = end.toISOString();
  const serviceItem: AppointmentService = {
    serviceId: draft.service!.id,
    name: draft.service!.name,
    price: draft.service!.price,
    durationMinutes: draft.service!.durationMinutes,
    color: draft.service!.color,
    materialCostPercent: draft.service!.materialCostPercent,
  };
  return {
    clientName: draft.client!.name,
    clientId: draft.client!.id,
    employeeId: draft.employee!.id,
    startTime,
    endTime,
    status: "scheduled",
    totalPrice: draft.service!.price,
    notes: "Criado via Agente IA",
    paymentStatus: null,
    groupId: null,
    services: [serviceItem],
  };
}

function hasConflict(draft: DraftState): boolean {
  const payload = buildAppointmentPayload(draft);
  const start = new Date(payload.startTime).getTime();
  const end = new Date(payload.endTime).getTime();
  return appointmentsStore.list({ date: draft.date, employeeId: draft.employee!.id }).some(a => {
    if (a.status === "cancelled") return false;
    const aStart = new Date(a.startTime).getTime();
    const aEnd = new Date(a.endTime).getTime();
    return start < aEnd && end > aStart;
  });
}

async function handleScheduleFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();
  const n = normalizar(msg);
  let draft = loadDraft() ?? { intent: "schedule", updatedAt: Date.now() } as DraftState;

  if (/\be\b/.test(n) && /( e |,)/.test(n) && /(servico|serviço|corte|escova|hidr|sobrancelha|unha)/.test(n)) {
    return { texto: "Serviço múltiplo ainda não está fechado. Me passe um serviço por vez." };
  }

  if (draft.awaitingConfirmation) {
    if (YES.test(msg.trim())) {
      if (!draft.client || !draft.date || !draft.time || !draft.service || !draft.employee) {
        draft.awaitingConfirmation = false;
        saveDraft(draft);
        return { texto: nextQuestion(draft) };
      }
      if (hasConflict(draft)) {
        draft.awaitingConfirmation = false;
        draft.time = undefined;
        saveDraft(draft);
        return { texto: "Há conflito nesse horário. Me passe outro horário." };
      }
      const created = await appointmentsStore.create(buildAppointmentPayload(draft));
      saveDraft(null);
      return {
        texto: `Agendamento confirmado.\n${summarizeDraft(draft)}`,
        agendamentoCriado: created,
      };
    }
    if (NO.test(msg.trim())) {
      saveDraft(null);
      return { texto: "Ok. Não executei nada." };
    }
    // allow corrections while awaiting confirmation
    draft.awaitingConfirmation = false;
  }

  if (!draft.client) {
    const resolved = await resolveClient(msg);
    if (resolved.error) return { texto: resolved.error };
    if (resolved.client) draft.client = resolved.client;
  }
  if (draft.client && !draft.date) {
    const date = resolveDateFromText(msg, false);
    if (date) {
      if (isPastDate(date)) return { texto: "Não posso agendar em data passada." };
      draft.date = date;
    }
  }
  if (draft.client && draft.date && !draft.time) {
    const time = extractTime(msg);
    if (time) draft.time = time;
  }
  if (draft.client && draft.date && draft.time && !draft.service) {
    const service = findServiceInMessage(msg);
    if (service) draft.service = service;
  }
  if (draft.client && draft.date && draft.time && draft.service && !draft.employee) {
    const employee = findEmployeeInMessage(msg);
    if (employee) draft.employee = employee;
  }

  if (draft.client && draft.date && draft.time && draft.service && draft.employee) {
    if (hasConflict(draft)) {
      draft.time = undefined;
      saveDraft(draft);
      return { texto: "Há conflito nesse horário. Me passe outro horário." };
    }
    draft.awaitingConfirmation = true;
    saveDraft(draft);
    return { texto: `Confirma?\n${summarizeDraft(draft)}` };
  }

  saveDraft(draft);
  return { texto: nextQuestion(draft) };
}

function getDateForQuery(msg: string, allowPast = true): string {
  return resolveDateFromText(msg, allowPast) ?? ymd(getLocalNow());
}

function querySchedule(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg, true);
  const list = appointmentsStore
    .list({ date })
    .filter(a => a.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 20);
  if (!list.length) return { texto: `Sem agendamentos para ${formatDateLong(date)}.` };
  const lines = list.map(a => {
    const time = new Date(a.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const employee = employeesStore.list().find(e => e.id === a.employeeId)?.name ?? `ID ${a.employeeId}`;
    const service = a.services[0]?.name ?? "—";
    return `${time} — ${a.clientName ?? "—"} — ${service} — ${employee}`;
  });
  return { texto: `${formatDateLong(date)}\n${lines.join("\n")}` };
}

async function queryClient(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();
  const term = extractLikelyClientTerm(msg) ?? msg;
  const found = await clientsStore.search(term, { limit: 5 });
  if (!found.length) return { texto: `Não encontrei cliente para "${term}".` };
  const c = found[0];
  return { texto: `${c.name}${c.phone ? ` — ${c.phone}` : ""}${c.email ? ` — ${c.email}` : ""}` };
}

function queryAvailable(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg, true);
  const time = extractTime(msg);
  const employees = employeesStore.list(true);
  const free = time
    ? employees.filter(emp => !appointmentsStore.list({ date, employeeId: emp.id }).some(a => {
        if (a.status === "cancelled") return false;
        const start = new Date(a.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return start === time;
      }))
    : employees;
  return { texto: free.length ? `Livres: ${free.map(e => e.name).join(", ")}` : "Nenhum profissional livre nesse horário." };
}

function queryFinance(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg, true);
  const current = cashSessionsStore.getCurrent();
  const dayEntries = current ? [] : [];
  const completed = appointmentsStore.list({ date }).filter(a => a.status === "completed");
  const total = completed.reduce((sum, a) => sum + Number(a.totalPrice ?? 0), 0);
  if (/caixa/.test(normalizar(msg))) {
    return { texto: current ? `Caixa aberto.` : `Caixa fechado.` };
  }
  return { texto: `Faturamento de ${formatDateLong(date)}: R$ ${total.toFixed(2)}` };
}

async function answerWithLLM(mensagemUsuario: string, historicoConversa: MensagemConversa[]): Promise<ResultadoAgente> {
  const nome = extractLikelyClientTerm(mensagemUsuario);
  const hoje = ymd(getLocalNow());
  const [servicos, funcionarios] = await Promise.all([
    Promise.resolve(servicesStore.list(true).length ? servicesStore.list(true) : servicesStore.fetchAll()),
    Promise.resolve(employeesStore.list(true).length ? employeesStore.list(true) : employeesStore.fetchAll()),
  ]);
  const agendaFutura = appointmentsStore.list({ startDate: hoje });
  let clientesEncontrados: Client[] = [];
  if (nome) {
    try { clientesEncontrados = await clientsStore.search(nome, { limit: 5 }); } catch {}
  }
  const systemPrompt = `Você é o assistente do salão Domínio Pro. Responda em pt-BR, curto e direto. Nunca invente dados. Não execute ações do sistema. Use só os dados abaixo.\n\nServiços:\n${servicos.map(s => `- ${s.name}`).join("\n")}\n\nEquipe:\n${funcionarios.map(f => `- ${f.name}`).join("\n")}\n\nClientes encontrados:\n${clientesEncontrados.map(c => `- ${c.name}`).join("\n") || "- nenhum"}\n\nAgenda futura:\n${agendaFutura.slice(0, 20).map(a => `- ${a.startTime} | ${a.clientName ?? "—"}`).join("\n") || "- vazia"}`;
  const body = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: systemPrompt }, ...historicoConversa.slice(-6), { role: "user", content: mensagemUsuario }],
    temperature: 0.2,
    max_tokens: 300,
  });
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  const texto = data.choices?.[0]?.message?.content?.trim() || "Não consegui responder agora.";
  return { texto };
}

export async function executarAgente(
  mensagemUsuario: string,
  historicoConversa: MensagemConversa[] = [],
): Promise<ResultadoAgente> {
  try {
    await ensureBaseLoaded();
    const msg = mensagemUsuario.trim();
    if (!msg) return { texto: "Envie uma mensagem." };

    const pending = loadDraft();
    if (pending?.intent === "schedule") {
      return await handleScheduleFlow(msg);
    }

    switch (detectIntent(msg)) {
      case "schedule":
        return await handleScheduleFlow(msg);
      case "query_schedule":
        return querySchedule(msg);
      case "query_finance":
        return queryFinance(msg);
      case "query_client":
        return await queryClient(msg);
      case "query_available":
        return queryAvailable(msg);
      default:
        return await answerWithLLM(msg, historicoConversa);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401")) return { texto: "Chave da IA inválida.", erro: msg };
    if (msg.includes("429")) return { texto: "Muitas requisições. Tente de novo em instantes.", erro: msg };
    return { texto: "Erro ao processar a mensagem.", erro: msg };
  }
}
