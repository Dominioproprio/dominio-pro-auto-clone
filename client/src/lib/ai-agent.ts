/**
 * ai-agent.ts — agente oficial do app
 *
 * Regras implementadas:
 * - não agenda com conflito
 * - não cria cliente automático
 * - não edita cadastro sem pedido explícito
 * - agenda é a fonte de verdade
 * - em qualquer ambiguidade, pergunta sempre
 * - coleta em ordem: cliente -> data -> horário -> serviço -> profissional -> confirmação
 * - não assume serviço múltiplo; pede esclarecimento
 */

import {
  appointmentsStore,
  cashEntriesStore,
  clientsStore,
  employeesStore,
  servicesStore,
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

type Intento =
  | "criar_agendamento"
  | "consultar_agenda"
  | "consultar_financeiro"
  | "buscar_cliente"
  | "consultar_equipe_livre"
  | "outro";

interface DraftAgendamento {
  client?: Client;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  service?: Service;
  employee?: Employee;
}

interface PendingChoice<T> {
  kind: "client" | "service" | "employee";
  options: T[];
}

interface AgentState {
  intent: Intento | null;
  draft: DraftAgendamento;
  awaitingConfirmation: boolean;
  pendingChoice: PendingChoice<Client | Service | Employee> | null;
  blockedReason: "multiple_services" | null;
}

const state: AgentState = {
  intent: null,
  draft: {},
  awaitingConfirmation: false,
  pendingChoice: null,
  blockedReason: null,
};

const STOPWORDS = new Set([
  "quero","qual","quais","como","quando","onde","porque","para","pra","fazer",
  "buscar","agendar","cancelar","remarcar","confirmar","verificar","checar",
  "preciso","gostaria","poderia","pode","consigo","tenho","temos","tem",
  "voce","você","minha","meu","meus","minhas","uma","uns","umas","esse",
  "essa","este","esta","isso","aquilo","aquele","aquela","dele","dela",
  "cliente","clientes","servico","serviço","serviços","agenda","agendamento",
  "agendamentos","horario","horário","horarios","funcionario","funcionário","funcionarios","funcionários",
  "hoje","ontem","amanha","amanhã","semana","faturamento","caixa","relatorio","relatório",
  "agora","depois","antes","durante","junto","mais","menos","muito","pouco",
  "favor","obrigado","obrigada","boa","bom","ola","olá","com","as","às","dia",
  "de","do","da","no","na","um","uma","e","por","favor",
]);

const WEEKDAY_ALIASES: Array<{ names: string[]; dayIndex: number }> = [
  { names: ["domingo", "dom"], dayIndex: 0 },
  { names: ["segunda", "segunda feira", "segunda-feira", "seg"], dayIndex: 1 },
  { names: ["terca", "terça", "terca feira", "terça feira", "terca-feira", "terça-feira", "ter"], dayIndex: 2 },
  { names: ["quarta", "quarta feira", "quarta-feira", "qua"], dayIndex: 3 },
  { names: ["quinta", "quinta feira", "quinta-feira", "qui"], dayIndex: 4 },
  { names: ["sexta", "sexta feira", "sexta-feira", "sex"], dayIndex: 5 },
  { names: ["sabado", "sábado", "sab"], dayIndex: 6 },
];

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s:@/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resetState(): void {
  state.intent = null;
  state.draft = {};
  state.awaitingConfirmation = false;
  state.pendingChoice = null;
  state.blockedReason = null;
}

function isYes(text: string): boolean {
  const t = normalizar(text);
  return ["sim", "confirmar", "pode", "ok", "certo", "isso", "perfeito", "confirmo"].some(v => t === v || t.startsWith(`${v} `) || t.includes(` ${v}`));
}

function isNo(text: string): boolean {
  const t = normalizar(text);
  return ["nao", "não", "cancelar", "cancela", "errado", "nega", "negativo"].some(v => t === v || t.startsWith(`${v} `) || t.includes(` ${v}`));
}

function makeLocalDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function localDateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return makeLocalDate(y, m, d);
}

function currentDateParts(): { today: string; now: Date } {
  const now = new Date();
  return { today: localDateToIso(now), now };
}

function addDaysToIso(base: Date, amount: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
  d.setDate(d.getDate() + amount);
  return localDateToIso(d);
}

function weekdayLabelFromIso(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(isoToLocalDate(isoDate));
}

function formatDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateWithWeekday(isoDate: string): string {
  return `${formatDateBR(isoDate)} (${weekdayLabelFromIso(isoDate)})`;
}

function formatDateTimeBR(iso: string): string {
  const dt = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function isPastDate(isoDate: string): boolean {
  return isoDate < currentDateParts().today;
}

function nextQuestion(): string | null {
  if (!state.draft.client) return "Qual é o cliente?";
  if (!state.draft.date) return `Qual é a data para ${state.draft.client.name}?`;
  if (!state.draft.time) return `Qual é o horário para ${state.draft.client.name} em ${formatDateBR(state.draft.date)}?`;
  if (!state.draft.service) return "Qual é o serviço?";
  if (!state.draft.employee) return "Qual é o profissional?";
  return null;
}

function buildConfirmationText(): string {
  const { client, date, time, service, employee } = state.draft;
  return [
    "Confirmar agendamento?",
    `Cliente: ${client?.name ?? "—"}`,
    `Data: ${date ? formatDateWithWeekday(date) : "—"}`,
    `Horário: ${time ?? "—"}`,
    `Serviço: ${service?.name ?? "—"}`,
    `Profissional: ${employee?.name ?? "—"}`,
  ].join("\n");
}

function parseTime(message: string): string | undefined {
  const text = normalizar(message);
  const match = text.match(/(?:^|\s)(?:as|a)?\s*(\d{1,2})(?::|h)?(\d{2})?(?:\s|$)/i);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function matchWeekday(text: string): number | null {
  for (const entry of WEEKDAY_ALIASES) {
    for (const name of entry.names) {
      const pattern = new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (pattern.test(text)) return entry.dayIndex;
    }
  }
  return null;
}

function parseDate(message: string): string | undefined {
  const text = normalizar(message);
  const { now, today } = currentDateParts();

  if (/\bontem\b/.test(text)) return addDaysToIso(now, -1);
  if (/depois de amanha/.test(text)) return addDaysToIso(now, 2);
  if (/\bamanha\b/.test(text)) return addDaysToIso(now, 1);
  if (/\bhoje\b/.test(text)) return today;

  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    let year = brMatch[3] ? Number(brMatch[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return localDateToIso(makeLocalDate(year, month, day));
    }
  }

  const requestedWeekday = matchWeekday(text);
  if (requestedWeekday !== null) {
    const hasNextWeekHint = /(proxima|proximo|próxima|próximo|que vem)/.test(text);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    const currentWeekday = base.getDay();
    let diff = (requestedWeekday - currentWeekday + 7) % 7;
    if (hasNextWeekHint) {
      diff = diff === 0 ? 7 : diff + 7;
    }
    const target = new Date(base);
    target.setDate(target.getDate() + diff);
    return localDateToIso(target);
  }

  return undefined;
}

function detectIntent(message: string): Intento {
  const text = normalizar(message);
  if (/(agendar|agendamento|marcar|agenda pra|agenda para|novo agendamento)/.test(text)) return "criar_agendamento";
  if (/(agenda hoje|agenda de hoje|agenda amanha|quais agendamentos|agendamentos de hoje|agendamentos de amanha|agendamentos de amanhã|agenda de ontem|agenda ontem)/.test(text)) return "consultar_agenda";
  if (/(faturamento|receita|quanto vendeu|vendas|financeiro|caixa hoje|caixa ontem)/.test(text)) return "consultar_financeiro";
  if (/(funcionarios livres|funcionários livres|equipe livre|quem esta livre|quem está livre)/.test(text)) return "consultar_equipe_livre";
  if (/(buscar cliente|procurar cliente|dados do cliente|informacoes do cliente|informações do cliente|cliente)/.test(text)) return "buscar_cliente";
  return "outro";
}

function isAppointmentFlowMessage(message: string): boolean {
  if (state.intent === "criar_agendamento") return true;
  return detectIntent(message) === "criar_agendamento";
}

function detectServiceMatches(message: string, services: Service[]): Service[] {
  const text = normalizar(message);
  return services.filter(service => {
    const name = normalizar(service.name);
    return name.length >= 3 && text.includes(name);
  });
}

function detectEmployeeMatches(message: string, employees: Employee[]): Employee[] {
  const text = normalizar(message);
  return employees.filter(employee => {
    const name = normalizar(employee.name);
    return name.length >= 3 && text.includes(name);
  });
}

function extractClientCandidate(message: string): string | undefined {
  const raw = message.trim();
  const text = normalizar(raw);

  const pattern = /(?:cliente|para|pra)\s+([a-zà-ú\s]{3,})/i;
  const hit = raw.match(pattern);
  if (hit?.[1]) {
    const cleaned = hit[1]
      .replace(/\b(hoje|ontem|amanha|amanhã|depois de amanha|depois de amanhã|as|às|com|servico|serviço|dia|na|no|quarta|quinta|sexta|segunda|terca|terça|sabado|sábado|domingo)\b.*$/i, "")
      .trim();
    if (cleaned.length >= 3) return cleaned;
  }

  if (!/[0-9]/.test(raw) && !/(hoje|ontem|amanha|amanhã|depois|servico|serviço|com|as|às)/.test(text)) {
    const tokens = raw
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => !STOPWORDS.has(normalizar(t)));
    if (tokens.length >= 1) return tokens.join(" ");
  }

  const capitalized = raw.match(/\b([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,4})\b/);
  return capitalized?.[1]?.trim();
}

function chooseFromPending<T extends Client | Service | Employee>(message: string, pending: PendingChoice<T>): T | null {
  const text = normalizar(message);
  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    const byId = pending.options.find((item: any) => item.id === Number(idMatch[1]));
    if (byId) return byId;
  }

  const exact = pending.options.find((item: any) => normalizar(item.name) === text);
  if (exact) return exact;

  const partial = pending.options.find((item: any) => normalizar(item.name).includes(text) || text.includes(normalizar(item.name)));
  return partial ?? null;
}

function listOptionsText<T extends Client | Service | Employee>(title: string, options: T[]): string {
  return [
    title,
    ...options.map((item: any) => `[${item.id}] ${item.name}`),
    "Qual é o certo?",
  ].join("\n");
}

function mergeDraft(data: Partial<DraftAgendamento>): void {
  state.draft = { ...state.draft, ...data };
}

function askForSingleServiceOnly(): ResultadoAgente {
  state.blockedReason = "multiple_services";
  return {
    texto: "Vi mais de um serviço. Como essa regra ainda não está fechada, diga um serviço por vez ou diga explicitamente que quer múltiplos agendamentos.",
  };
}

function hasMultipleAppointmentRequest(message: string): boolean {
  const text = normalizar(message);
  return text.includes("multiplos agendamentos") || text.includes("múltiplos agendamentos");
}

async function resolveClientStep(message: string): Promise<ResultadoAgente | null> {
  if (state.draft.client) return null;

  if (state.pendingChoice?.kind === "client") {
    const chosen = chooseFromPending(message, state.pendingChoice as PendingChoice<Client>);
    if (!chosen) {
      return { texto: listOptionsText("Encontrei mais de um cliente.", state.pendingChoice.options as Client[]) };
    }
    state.pendingChoice = null;
    mergeDraft({ client: chosen });
    return null;
  }

  const candidate = extractClientCandidate(message);
  if (!candidate) return { texto: "Qual é o cliente?" };

  const results = await clientsStore.search(candidate, { limit: 5 });
  if (results.length === 0) {
    return {
      texto: `Não encontrei cliente para \"${candidate}\". Não posso criar cliente automaticamente. Me diga o nome correto ou peça cadastro explicitamente.`,
    };
  }
  if (results.length > 1) {
    state.pendingChoice = { kind: "client", options: results };
    return { texto: listOptionsText("Encontrei mais de um cliente.", results) };
  }

  mergeDraft({ client: results[0] });
  return null;
}

function resolveDateStep(message: string): ResultadoAgente | null {
  if (!state.draft.client || state.draft.date) return null;
  const date = parseDate(message);
  if (!date) return { texto: `Qual é a data para ${state.draft.client.name}?` };
  if (isPastDate(date)) {
    return { texto: `Essa data já passou. Me diga uma data de hoje em diante para ${state.draft.client.name}.` };
  }
  mergeDraft({ date });
  return null;
}

function resolveTimeStep(message: string): ResultadoAgente | null {
  if (!state.draft.client || !state.draft.date || state.draft.time) return null;
  const time = parseTime(message);
  if (!time) {
    return { texto: `Qual é o horário para ${state.draft.client.name} em ${formatDateBR(state.draft.date)}?` };
  }
  mergeDraft({ time });
  return null;
}

function resolveServiceStep(message: string): ResultadoAgente | null {
  if (!state.draft.client || !state.draft.date || !state.draft.time || state.draft.service) return null;

  if (state.pendingChoice?.kind === "service") {
    const chosen = chooseFromPending(message, state.pendingChoice as PendingChoice<Service>);
    if (!chosen) {
      return { texto: listOptionsText("Encontrei mais de um serviço.", state.pendingChoice.options as Service[]) };
    }
    state.pendingChoice = null;
    mergeDraft({ service: chosen });
    return null;
  }

  const services = servicesStore.list(true);
  const matches = detectServiceMatches(message, services);
  if (matches.length > 1) return askForSingleServiceOnly();
  if (matches.length === 0) return { texto: "Qual é o serviço?" };
  mergeDraft({ service: matches[0] });
  return null;
}

function resolveEmployeeStep(message: string): ResultadoAgente | null {
  if (!state.draft.client || !state.draft.date || !state.draft.time || !state.draft.service || state.draft.employee) return null;

  if (state.pendingChoice?.kind === "employee") {
    const chosen = chooseFromPending(message, state.pendingChoice as PendingChoice<Employee>);
    if (!chosen) {
      return { texto: listOptionsText("Encontrei mais de um profissional.", state.pendingChoice.options as Employee[]) };
    }
    state.pendingChoice = null;
    mergeDraft({ employee: chosen });
    return null;
  }

  const employees = employeesStore.list(true);
  const matches = detectEmployeeMatches(message, employees);
  if (matches.length > 1) {
    state.pendingChoice = { kind: "employee", options: matches };
    return { texto: listOptionsText("Encontrei mais de um profissional.", matches) };
  }
  if (matches.length === 0) return { texto: "Qual é o profissional?" };
  mergeDraft({ employee: matches[0] });
  return null;
}

function calculateStartEnd(date: string, time: string, durationMinutes: number): { startTime: string; endTime: string } {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const start = new Date(year, month - 1, day, hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function findConflict(employeeId: number, date: string, startIso: string, endIso: string): Appointment | null {
  const list = appointmentsStore
    .list({ date, employeeId })
    .filter(item => item.status !== "cancelled" && item.status !== "no_show");

  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  return list.find(item => {
    const existingStart = new Date(item.startTime).getTime();
    const existingEnd = new Date(item.endTime).getTime();
    return start < existingEnd && end > existingStart;
  }) ?? null;
}

async function finalizeAppointment(): Promise<ResultadoAgente> {
  const { client, date, time, service, employee } = state.draft;
  if (!client || !date || !time || !service || !employee) {
    return { texto: nextQuestion() ?? "Ainda faltam dados." };
  }

  const { startTime, endTime } = calculateStartEnd(date, time, service.durationMinutes);
  const conflict = findConflict(employee.id, date, startTime, endTime);
  if (conflict) {
    state.awaitingConfirmation = false;
    mergeDraft({ time: undefined });
    return {
      texto: `Conflito para ${employee.name} nesse horário. Já existe agendamento em ${formatDateTimeBR(conflict.startTime)}. Me diga outro horário.`,
    };
  }

  const serviceItem: AppointmentService = {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes,
    color: service.color,
    materialCostPercent: service.materialCostPercent,
  };

  const created = await appointmentsStore.create({
    clientName: client.name,
    clientId: client.id,
    employeeId: employee.id,
    startTime,
    endTime,
    status: "scheduled",
    totalPrice: service.price,
    notes: "Criado via Assistente IA",
    paymentStatus: null,
    groupId: null,
    services: [serviceItem],
  });

  window.dispatchEvent(new Event("store_updated"));
  window.dispatchEvent(new Event("appointment_created"));
  resetState();

  return {
    texto: `Agendado: ${client.name}, ${service.name}, ${employee.name}, ${formatDateWithWeekday(date)} às ${time}.`,
    agendamentoCriado: created,
  };
}

function formatAgendaForDate(date: string): string {
  const appointments = appointmentsStore
    .list({ date })
    .filter(item => item.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (appointments.length === 0) {
    return `Sem agendamentos em ${formatDateWithWeekday(date)}.`;
  }

  const lines = appointments.slice(0, 30).map(item => {
    const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.startTime));
    const serviceNames = item.services.map(service => service.name).join(", ") || "—";
    const employee = employeesStore.list().find(emp => emp.id === item.employeeId);
    return `${time} | ${item.clientName ?? "Cliente"} | ${employee?.name ?? `Profissional #${item.employeeId}`} | ${serviceNames} | ${item.status}`;
  });

  return [`Agenda de ${formatDateWithWeekday(date)}:`, ...lines].join("\n");
}

function formatFreeEmployeesNow(): string {
  const { now, today } = currentDateParts();
  const employees = employeesStore.list(true);
  const busyIds = new Set(
    appointmentsStore
      .list({ date: today })
      .filter(item => item.status !== "cancelled" && item.status !== "no_show")
      .filter(item => now >= new Date(item.startTime) && now < new Date(item.endTime))
      .map(item => item.employeeId),
  );
  const free = employees.filter(employee => !busyIds.has(employee.id));
  if (free.length === 0) return "Nenhum profissional livre agora.";
  return ["Profissionais livres agora:", ...free.map(item => item.name)].join("\n");
}

function formatRevenueForDate(date: string): string {
  const entries = cashEntriesStore.list().filter(entry => entry.createdAt.slice(0, 10) === date);
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

  if (entries.length === 0) {
    return `Sem lançamentos em ${formatDateWithWeekday(date)}.`;
  }

  const lines = entries.slice(0, 20).map(entry => `${entry.clientName} | ${entry.description} | R$ ${entry.amount.toFixed(2)}`);
  return [`Faturamento de ${formatDateWithWeekday(date)}: R$ ${total.toFixed(2)}`, ...lines].join("\n");
}

async function formatClientSearch(message: string): Promise<string> {
  const candidate = extractClientCandidate(message) ?? message.trim();
  const results = await clientsStore.search(candidate, { limit: 5 });
  if (results.length === 0) {
    return `Não encontrei cliente para \"${candidate}\".`;
  }
  const lines = results.map(client => `${client.id} | ${client.name}${client.phone ? ` | ${client.phone}` : ""}${client.email ? ` | ${client.email}` : ""}`);
  return ["Clientes encontrados:", ...lines].join("\n");
}

async function callGroqForGeneralHelp(message: string): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    return "Consigo ajudar com agenda, clientes, equipe livre e faturamento. Para respostas gerais por IA, configure VITE_GROQ_API_KEY.";
  }

  const today = currentDateParts().today;
  const context = [
    `Hoje: ${formatDateWithWeekday(today)}`,
    `Serviços ativos: ${servicesStore.list(true).slice(0, 30).map(item => item.name).join(", ") || "nenhum"}`,
    `Equipe ativa: ${employeesStore.list(true).slice(0, 20).map(item => item.name).join(", ") || "nenhuma"}`,
    `Agenda hoje: ${appointmentsStore.list({ date: today }).length} agendamento(s)`,
  ].join("\n");

  const body = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Você é o assistente do sistema Domínio Pro. Responda em português do Brasil, de forma curta, direta e operacional. Não invente dados. Quando não souber, diga que não encontrou no sistema.",
      },
      { role: "system", content: context },
      { role: "user", content: message },
    ],
    temperature: 0.2,
    max_tokens: 300,
  });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Groq ${response.status}: ${bodyText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Não consegui responder agora.";
}

async function continueAppointmentFlow(message: string): Promise<ResultadoAgente> {
  if (state.blockedReason === "multiple_services") {
    if (hasMultipleAppointmentRequest(message)) {
      state.blockedReason = null;
      resetState();
      return { texto: "Múltiplos agendamentos ainda não estão fechados. Vamos um por vez. Qual é o cliente do primeiro agendamento?" };
    }
    state.blockedReason = null;
  }

  if (state.awaitingConfirmation) {
    if (isYes(message)) return finalizeAppointment();
    if (isNo(message)) {
      state.awaitingConfirmation = false;
      return { texto: "Ok. Não executei nada. O que quer ajustar?" };
    }
    return { texto: "Responda com sim ou não." };
  }

  const serviceMatches = detectServiceMatches(message, servicesStore.list(true));
  if (serviceMatches.length > 1) return askForSingleServiceOnly();

  const clientStep = await resolveClientStep(message);
  if (clientStep) return clientStep;

  const dateStep = resolveDateStep(message);
  if (dateStep) return dateStep;

  const timeStep = resolveTimeStep(message);
  if (timeStep) return timeStep;

  const serviceStep = resolveServiceStep(message);
  if (serviceStep) return serviceStep;

  const employeeStep = resolveEmployeeStep(message);
  if (employeeStep) return employeeStep;

  const question = nextQuestion();
  if (question) return { texto: question };

  state.awaitingConfirmation = true;
  return { texto: buildConfirmationText() };
}

async function ensureContextLoaded(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (servicesStore.list(true).length === 0) tasks.push(servicesStore.fetchAll());
  if (employeesStore.list(true).length === 0) tasks.push(employeesStore.fetchAll());
  if (appointmentsStore.list().length === 0) tasks.push(appointmentsStore.fetchAll());
  if (cashEntriesStore.list().length === 0) tasks.push(cashEntriesStore.fetchAll());
  tasks.push(clientsStore.ensureLoaded());
  await Promise.all(tasks);
}

export async function executarAgente(
  mensagemUsuario: string,
  historicoConversa: MensagemConversa[] = [],
): Promise<ResultadoAgente> {
  void historicoConversa;
  try {
    await ensureContextLoaded();

    const mensagem = mensagemUsuario.trim();
    if (!mensagem) return { texto: "Escreva sua solicitação." };

    const normalized = normalizar(mensagem);

    if (isNo(normalized) && !state.awaitingConfirmation && state.intent) {
      resetState();
      return { texto: "Ok. Zerei o fluxo atual. Me diga de novo o que quer fazer." };
    }

    if (isAppointmentFlowMessage(mensagem)) {
      if (!state.intent) state.intent = "criar_agendamento";
      return continueAppointmentFlow(mensagem);
    }

    const intent = detectIntent(mensagem);

    if (intent === "consultar_agenda") {
      const date = parseDate(mensagem) ?? currentDateParts().today;
      return { texto: formatAgendaForDate(date) };
    }

    if (intent === "consultar_financeiro") {
      const date = parseDate(mensagem) ?? currentDateParts().today;
      return { texto: formatRevenueForDate(date) };
    }

    if (intent === "consultar_equipe_livre") {
      return { texto: formatFreeEmployeesNow() };
    }

    if (intent === "buscar_cliente") {
      return { texto: await formatClientSearch(mensagem) };
    }

    if (/(criar cliente|cadastrar cliente)/.test(normalized)) {
      return {
        texto: "Não posso criar cliente automaticamente. Se quiser cadastrar, me dê a ordem explícita e os dados do cliente.",
      };
    }

    if (/(editar cliente|atualizar cliente|editar cadastro|corrigir cadastro)/.test(normalized)) {
      return {
        texto: "Só posso editar cadastro com pedido explícito e com o cliente corretamente identificado. Diga qual cliente e qual campo quer alterar.",
      };
    }

    if (/(cancelar agendamento|remarcar|mover agendamento|trocar cliente)/.test(normalized)) {
      return {
        texto: "Essa operação ainda não foi endurecida neste agente. Por enquanto, eu opero com segurança consultas, busca e criação de agendamento simples com confirmação obrigatória.",
      };
    }

    const fallback = await callGroqForGeneralHelp(mensagem);
    return { texto: fallback };
  } catch (error) {
    console.error("[AI Agent] Erro geral:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401")) {
      return { texto: "❌ Chave da API inválida. Verifique VITE_GROQ_API_KEY.", erro: msg };
    }
    if (msg.includes("429")) {
      return { texto: "⏳ Muitas requisições. Aguarde alguns segundos e tente novamente.", erro: msg };
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return { texto: "📡 Sem conexão com o servidor. Verifique sua internet.", erro: msg };
    }
    return {
      texto: "❌ Erro inesperado no agente. Verifique o console para detalhes.",
      erro: msg,
    };
  }
}
