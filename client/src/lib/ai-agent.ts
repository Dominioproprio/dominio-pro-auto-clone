import {
  appointmentsStore,
  cashSessionsStore,
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

type Intent =
  | "schedule"
  | "cancel"
  | "reschedule"
  | "query_schedule"
  | "query_finance"
  | "query_client"
  | "query_available"
  | "unknown";

interface DraftState {
  flow: "schedule";
  client?: Client;
  clientQuery?: string;
  date?: string;
  time?: string;
  service?: Service;
  serviceQuery?: string;
  employee?: Employee;
  employeeQuery?: string;
  awaitingConfirmation?: boolean;
  updatedAt: number;
}

const DRAFT_KEY = "dominio_pro_ai_agent_draft_v2";
const TZ = "America/Sao_Paulo";

const YES =
  /^(sim|s|ok|confirmo|confirmar|pode|isso|isso mesmo|pode confirmar|confirmado)[.! ]*$/i;

const NO_ONLY =
  /^(nao|não|cancelar|cancela|deixa|deixa pra la|deixa pra lá|negativo)[.! ]*$/i;

const NO_WITH_TEXT = /^(nao|não)[,.:;! ]+(.+)$/i;

const STOPWORDS = new Set([
  "quero",
  "preciso",
  "pode",
  "pra",
  "para",
  "com",
  "cliente",
  "agendar",
  "agenda",
  "marcar",
  "marca",
  "novo",
  "horario",
  "horário",
  "amanha",
  "amanhã",
  "hoje",
  "depois",
  "de",
  "do",
  "da",
  "das",
  "dos",
  "na",
  "no",
  "as",
  "às",
  "um",
  "uma",
  "remarcar",
  "reagendar",
  "cancelar",
  "desmarcar",
  "mover",
  "horas",
  "hora",
]);

const WEEKDAY_SHORT: Record<string, number> = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  "segunda-feira": 1,
  ter: 2,
  terca: 2,
  terça: 2,
  "terca-feira": 2,
  "terça-feira": 2,
  qua: 3,
  quarta: 3,
  "quarta-feira": 3,
  qui: 4,
  quinta: 4,
  "quinta-feira": 4,
  sex: 5,
  sexta: 5,
  "sexta-feira": 5,
  sab: 6,
  sabado: 6,
  sábado: 6,
};

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getStorage(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function loadDraft(): DraftState | null {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (!parsed?.updatedAt || Date.now() - parsed.updatedAt > 30 * 60_000) {
      storage?.removeItem(DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(draft: DraftState | null): void {
  const storage = getStorage();
  if (!storage) return;
  if (!draft) {
    storage.removeItem(DRAFT_KEY);
    return;
  }
  draft.updatedAt = Date.now();
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
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

  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick(
      "minute",
    )}:${pick("second")}`,
  );
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
  return parseYMD(dateStr).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: TZ,
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTime(raw: string): string | undefined {
  const match = raw.match(/\b(\d{1,2})(?::|h)?(\d{2})?\b/);
  if (!match) return undefined;

  const hh = Number(match[1]);
  const mm = Number(match[2] ?? 0);

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function resolveDateFromText(
  raw: string,
  allowPast = false,
): string | undefined {
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
  return dateStr < ymd(getLocalNow());
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function detectIntent(msg: string): Intent {
  const n = normalizar(msg);

  if (
    /(remarcar|remarca|reagendar|reagenda|mudar horario|mudar horário|mover horario|mover horário|mover agendamento)/.test(
      n,
    )
  ) {
    return "reschedule";
  }

  if (
    /(cancelar agendamento|cancelar horario|cancelar horário|desmarcar|cancelar)/.test(
      n,
    )
  ) {
    return "cancel";
  }

  if (
    /(agenda de hoje|agenda de amanha|agenda de amanhã|agendamentos|lista da agenda|agenda hoje)/.test(
      n,
    )
  ) {
    return "query_schedule";
  }

  if (/(faturamento|caixa|receita|financeiro)/.test(n)) {
    return "query_finance";
  }

  if (/(buscar cliente|dados do cliente|telefone do cliente|email do cliente)/.test(n)) {
    return "query_client";
  }

  if (/(disponiveis|disponíveis|livres|quem esta livre|quem está livre)/.test(n)) {
    return "query_available";
  }

  if (/(agendar|marcar|novo agendamento|encaixar|encaixe)/.test(n)) {
    return "schedule";
  }

  return "unknown";
}

async function ensureBaseLoaded(): Promise<void> {
  await Promise.allSettled([
    clientsStore.ensureLoaded(),
    Promise.resolve(
      servicesStore.list(true).length || servicesStore.fetchAll(),
    ),
    Promise.resolve(
      employeesStore.list(true).length || employeesStore.fetchAll(),
    ),
    Promise.resolve(
      appointmentsStore.list().length || appointmentsStore.fetchAll(),
    ),
    Promise.resolve(
      cashSessionsStore.list().length || cashSessionsStore.fetchAll(),
    ),
  ]);
}

function tokenizeText(value: string): string[] {
  return normalizar(value)
    .replace(/[.,;!?()[\]{}"'`´“”]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreByTokens(haystack: string, candidate: string): number {
  const h = normalizar(haystack);
  const c = normalizar(candidate);

  if (!c) return 0;
  if (h === c) return 1;
  if (h.includes(c)) return 0.92;

  const tokens = c.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;

  const hits = tokens.filter((token) => h.includes(token)).length;
  if (!hits) return 0;

  const ratio = hits / tokens.length;
  return ratio >= 1 ? 0.88 : ratio * 0.8;
}

function getActiveServices(): Service[] {
  return servicesStore.list(true).filter((service) => service.active);
}

function getActiveEmployees(): Employee[] {
  return employeesStore.list(true).filter((employee) => employee.active);
}

function resolveBestService(msg: string): {
  service?: Service;
  ambiguous?: string[];
} {
  const services = getActiveServices();

  const scored = services
    .map((service) => ({
      service,
      score: scoreByTokens(msg, service.name),
    }))
    .filter((item) => item.score >= 0.72)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.service.name.localeCompare(b.service.name, "pt-BR"),
    );

  if (!scored.length) return {};
  if (scored.length === 1) return { service: scored[0].service };

  const top = scored[0];
  const second = scored[1];

  if (top.score >= 0.9 && second.score <= 0.74) {
    return { service: top.service };
  }

  const normalizedMsg = normalizar(msg);
  const exact = scored.filter((item) =>
    normalizedMsg.includes(normalizar(item.service.name)),
  );
  if (exact.length === 1) return { service: exact[0].service };

  return { ambiguous: scored.slice(0, 5).map((item) => item.service.name) };
}

function resolveBestEmployee(msg: string): {
  employee?: Employee;
  ambiguous?: string[];
} {
  const employees = getActiveEmployees();

  const scored = employees
    .map((employee) => ({
      employee,
      score: scoreByTokens(msg, employee.name),
    }))
    .filter((item) => item.score >= 0.72)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.employee.name.localeCompare(b.employee.name, "pt-BR"),
    );

  if (!scored.length) return {};
  if (scored.length === 1) return { employee: scored[0].employee };

  const top = scored[0];
  const second = scored[1];

  if (top.score >= 0.9 && second.score <= 0.74) {
    return { employee: top.employee };
  }

  const normalizedMsg = normalizar(msg);
  const exact = scored.filter((item) =>
    normalizedMsg.includes(normalizar(item.employee.name)),
  );
  if (exact.length === 1) return { employee: exact[0].employee };

  return {
    ambiguous: scored.slice(0, 5).map((item) => item.employee.name),
  };
}

function stripKnownEntities(
  msg: string,
  service?: Service,
  employee?: Employee,
): string {
  let text = normalizar(msg);

  const replacements = [
    service?.name,
    employee?.name,
    "quero",
    "preciso",
    "agendar",
    "marcar",
    "novo agendamento",
    "encaixar",
    "encaixe",
    "com",
    "para",
    "pra",
    "amanha",
    "amanhã",
    "hoje",
    "depois de amanha",
    "depois de amanhã",
  ].filter(Boolean) as string[];

  for (const part of replacements) {
    const rx = new RegExp(`\\b${escapeRegex(normalizar(part))}\\b`, "gi");
    text = text.replace(rx, " ");
  }

  text = text.replace(/\b\d{1,2}(?::|h)?\d{0,2}\b/g, " ");
  text = text.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, " ");
  text = text.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, " ");

  const weekdayKeys = Object.keys(WEEKDAY_SHORT).sort((a, b) => b.length - a.length);
  for (const key of weekdayKeys) {
    const rx = new RegExp(`\\b${escapeRegex(normalizar(key))}\\b`, "gi");
    text = text.replace(rx, " ");
  }

  const cleaned = tokenizeText(text).filter((token) => !STOPWORDS.has(token));
  return cleaned.join(" ").trim();
}

async function resolveBestClient(
  msg: string,
  service?: Service,
  employee?: Employee,
): Promise<{
  client?: Client;
  ambiguous?: string[];
  query?: string;
}> {
  const explicitQuoted = msg.match(/[\"“”'`](.{2,60})[\"“”'`]/)?.[1]?.trim();

  const directCandidate = explicitQuoted
    ? normalizar(explicitQuoted)
    : stripKnownEntities(msg, service, employee);

  const candidate = directCandidate.trim();
  if (!candidate || candidate.length < 2) return {};

  const found = await clientsStore.search(candidate, { limit: 10 });
  if (!found.length) return { query: candidate };

  const scored = found
    .map((client) => ({
      client,
      score: scoreByTokens(candidate, client.name),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.client.name.localeCompare(b.client.name, "pt-BR"),
    );

  const top = scored[0];
  const second = scored[1];

  if (!second && top.score >= 0.72) {
    return { client: top.client, query: candidate };
  }

  if (top.score >= 0.94 && (second?.score ?? 0) <= 0.72) {
    return { client: top.client, query: candidate };
  }

  if (top.score === 1 && second && second.score < 0.75) {
    return { client: top.client, query: candidate };
  }

  return {
    ambiguous: scored.slice(0, 5).map((item) => item.client.name),
    query: candidate,
  };
}

function getWeekdayKey(dateStr: string): string {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][
    parseYMD(dateStr).getDay()
  ]!;
}

function isWithinWorkingHours(
  employee: Employee,
  dateStr: string,
  startTime: string,
  endTime: string,
): boolean {
  const key = getWeekdayKey(dateStr);
  const slot = employee.workingHours?.[key];
  if (!slot?.active) return false;

  return (
    timeToMinutes(startTime) >= timeToMinutes(slot.start) &&
    timeToMinutes(endTime) <= timeToMinutes(slot.end)
  );
}

function isEmployeeCompatible(employee: Employee, service: Service): boolean {
  if (!employee.specialties?.length) return true;

  const serviceName = normalizar(service.name);

  return employee.specialties.some((specialty) => {
    const s = normalizar(specialty);
    return serviceName.includes(s) || s.includes(serviceName);
  });
}

function buildAppointmentPayload(
  draft: DraftState,
): Omit<Appointment, "id" | "createdAt"> {
  const startTime = new Date(`${draft.date}T${draft.time}:00`).toISOString();
  const end = new Date(
    new Date(`${draft.date}T${draft.time}:00`).getTime() +
      (draft.service?.durationMinutes ?? 0) * 60_000,
  );
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

  return appointmentsStore
    .list({ date: draft.date, employeeId: draft.employee!.id })
    .some((appointment) => {
      if (appointment.status === "cancelled") return false;

      const appointmentStart = new Date(appointment.startTime).getTime();
      const appointmentEnd = new Date(appointment.endTime).getTime();

      return start < appointmentEnd && end > appointmentStart;
    });
}

function summarizeDraft(draft: DraftState): string {
  return [
    `Cliente: ${draft.client?.name ?? "—"}`,
    `Data: ${draft.date ? formatDateLong(draft.date) : "—"}`,
    `Horário: ${draft.time ?? "—"}`,
    `Serviço: ${draft.service?.name ?? "—"}`,
    `Profissional: ${draft.employee?.name ?? "—"}`,
  ].join("\n");
}

function nextQuestion(draft: DraftState): string {
  if (!draft.client) {
    return draft.clientQuery
      ? `Não encontrei o cliente "${draft.clientQuery}" no cadastro real. Qual é o cliente?`
      : "Qual é o cliente?";
  }

  if (!draft.date) return "Qual é a data?";
  if (!draft.time) return "Qual é o horário?";

  if (!draft.service) {
    return draft.serviceQuery
      ? `Não identifiquei o serviço "${draft.serviceQuery}". Qual é o serviço?`
      : "Qual é o serviço?";
  }

  if (!draft.employee) {
    return draft.employeeQuery
      ? `Não identifiquei o profissional "${draft.employeeQuery}". Qual é o profissional?`
      : "Qual é o profissional?";
  }

  return `Confirma?\n${summarizeDraft(draft)}`;
}

async function applyExtractedEntities(
  draft: DraftState,
  msg: string,
  allowOverride = false,
): Promise<DraftState> {
  const date = resolveDateFromText(msg, false);
  const time = extractTime(msg);
  const serviceResolution = resolveBestService(msg);
  const employeeResolution = resolveBestEmployee(msg);
  const clientResolution = await resolveBestClient(
    msg,
    serviceResolution.service,
    employeeResolution.employee,
  );

  if (clientResolution.client && (!draft.client || allowOverride)) {
    draft.client = clientResolution.client;
    draft.clientQuery = undefined;
  } else if (clientResolution.ambiguous?.length && !draft.client) {
    draft.clientQuery = clientResolution.query;
  } else if (clientResolution.query && !draft.client) {
    draft.clientQuery = clientResolution.query;
  }

  if (date && (!draft.date || allowOverride)) {
    draft.date = date;
  }

  if (time && (!draft.time || allowOverride)) {
    draft.time = time;
  }

  if (serviceResolution.service && (!draft.service || allowOverride)) {
    draft.service = serviceResolution.service;
    draft.serviceQuery = undefined;
  } else if (serviceResolution.ambiguous?.length && !draft.service) {
    draft.serviceQuery = msg.trim();
  }

  if (employeeResolution.employee && (!draft.employee || allowOverride)) {
    draft.employee = employeeResolution.employee;
    draft.employeeQuery = undefined;
  } else if (employeeResolution.ambiguous?.length && !draft.employee) {
    draft.employeeQuery = msg.trim();
  }

  return draft;
}

function buildAmbiguityPrompt(label: string, options: string[]): string {
  return `Encontrei mais de um ${label} parecido. Qual é o correto?\n- ${options.join("\n- ")}`;
}

async function handleScheduleFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();

  const trimmed = msg.trim();
  const normalized = normalizar(trimmed);
  let draft =
    loadDraft() ??
    ({
      flow: "schedule",
      updatedAt: Date.now(),
    } as DraftState);

  if (
    /\be\b/.test(normalized) &&
    /( e |,)/.test(normalized) &&
    /(corte|escova|hidr|sobrancelha|unha|servico|serviço)/.test(normalized)
  ) {
    return {
      texto:
        "Serviço múltiplo ainda não está fechado. Me passe um serviço por vez.",
    };
  }

  if (draft.awaitingConfirmation) {
    if (YES.test(trimmed)) {
      if (
        !draft.client ||
        !draft.date ||
        !draft.time ||
        !draft.service ||
        !draft.employee
      ) {
        draft.awaitingConfirmation = false;
        saveDraft(draft);
        return { texto: nextQuestion(draft) };
      }

      if (!isEmployeeCompatible(draft.employee, draft.service)) {
        draft.awaitingConfirmation = false;
        draft.employee = undefined;
        saveDraft(draft);
        return {
          texto: `O profissional selecionado não está compatível com o serviço ${draft.service.name}. Qual é o profissional?`,
        };
      }

      const endMinutes =
        timeToMinutes(draft.time) + draft.service.durationMinutes;
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(
        2,
        "0",
      )}:${String(endMinutes % 60).padStart(2, "0")}`;

      if (!isWithinWorkingHours(draft.employee, draft.date, draft.time, endTime)) {
        draft.awaitingConfirmation = false;
        draft.time = undefined;
        saveDraft(draft);
        return {
          texto: `${draft.employee.name} não atende nesse horário. Me passe outro horário.`,
        };
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

    const noWithText = trimmed.match(NO_WITH_TEXT);

    if (noWithText?.[2]) {
      draft.awaitingConfirmation = false;
      draft = await applyExtractedEntities(draft, noWithText[2], true);
    } else if (NO_ONLY.test(trimmed)) {
      saveDraft(null);
      return { texto: "Ok. Não executei nada." };
    } else {
      draft.awaitingConfirmation = false;
      draft = await applyExtractedEntities(draft, trimmed, true);
    }
  } else {
    draft = await applyExtractedEntities(draft, trimmed, false);
  }

  if (draft.clientQuery && !draft.client) {
    const clientResolution = await resolveBestClient(
      trimmed,
      draft.service,
      draft.employee,
    );
    if (clientResolution.ambiguous?.length) {
      saveDraft(draft);
      return {
        texto: buildAmbiguityPrompt("cliente", clientResolution.ambiguous),
      };
    }
  }

  const serviceResolution = resolveBestService(trimmed);
  if (!draft.service && serviceResolution.ambiguous?.length) {
    saveDraft(draft);
    return {
      texto: buildAmbiguityPrompt("serviço", serviceResolution.ambiguous),
    };
  }

  const employeeResolution = resolveBestEmployee(trimmed);
  if (!draft.employee && employeeResolution.ambiguous?.length) {
    saveDraft(draft);
    return {
      texto: buildAmbiguityPrompt("profissional", employeeResolution.ambiguous),
    };
  }

  if (draft.date && isPastDate(draft.date)) {
    draft.date = undefined;
    saveDraft(draft);
    return { texto: "Não posso agendar em data passada. Qual é a data?" };
  }

  if (draft.client && draft.date && draft.time && draft.service && draft.employee) {
    if (!isEmployeeCompatible(draft.employee, draft.service)) {
      draft.employee = undefined;
      saveDraft(draft);
      return {
        texto: `O serviço ${draft.service.name} não está compatível com esse profissional. Qual é o profissional?`,
      };
    }

    const endMinutes = timeToMinutes(draft.time) + draft.service.durationMinutes;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(
      2,
      "0",
    )}:${String(endMinutes % 60).padStart(2, "0")}`;

    if (!isWithinWorkingHours(draft.employee, draft.date, draft.time, endTime)) {
      draft.time = undefined;
      saveDraft(draft);
      return {
        texto: `${draft.employee.name} não atende nesse horário. Qual é o horário?`,
      };
    }

    if (hasConflict(draft)) {
      draft.time = undefined;
      saveDraft(draft);
      return { texto: "Há conflito nesse horário. Qual é o horário?" };
    }

    draft.awaitingConfirmation = true;
    saveDraft(draft);
    return { texto: `Confirma?\n${summarizeDraft(draft)}` };
  }

  saveDraft(draft);
  return { texto: nextQuestion(draft) };
}

function getDateForQuery(msg: string): string {
  return resolveDateFromText(msg, true) ?? ymd(getLocalNow());
}

function querySchedule(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg);

  const list = appointmentsStore
    .list({ date })
    .filter((appointment) => appointment.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 20);

  if (!list.length) {
    return { texto: `Sem agendamentos para ${formatDateLong(date)}.` };
  }

  const lines = list.map((appointment) => {
    const time = new Date(appointment.startTime).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const employee =
      employeesStore
        .list(true)
        .find((item) => item.id === appointment.employeeId)?.name ??
      `ID ${appointment.employeeId}`;

    const service = appointment.services[0]?.name ?? "—";
    return `${time} — ${appointment.clientName ?? "—"} — ${service} — ${employee}`;
  });

  return { texto: `${formatDateLong(date)}\n${lines.join("\n")}` };
}

async function queryClient(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();

  const query = stripKnownEntities(msg) || msg.trim();
  const found = await clientsStore.search(query, { limit: 10 });

  if (!found.length) {
    return { texto: `Não encontrei cliente para "${query}".` };
  }

  const lines = found
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, 10)
    .map(
      (client) =>
        `${client.name}${client.phone ? ` — ${client.phone}` : ""}${
          client.email ? ` — ${client.email}` : ""
        }`,
    );

  return { texto: lines.join("\n") };
}

function queryAvailable(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg);
  const time = extractTime(msg);
  const employees = getActiveEmployees();

  const free = time
    ? employees.filter((employee) => {
        const dayAppointments = appointmentsStore.list({
          date,
          employeeId: employee.id,
        });

        return !dayAppointments.some((appointment) => {
          if (appointment.status === "cancelled") return false;
          const start = new Date(appointment.startTime).toLocaleTimeString(
            "pt-BR",
            { hour: "2-digit", minute: "2-digit" },
          );
          return start === time;
        });
      })
    : employees;

  return {
    texto: free.length
      ? `Livres: ${free.map((employee) => employee.name).join(", ")}`
      : "Nenhum profissional livre nesse horário.",
  };
}

function queryFinance(msg: string): ResultadoAgente {
  const date = getDateForQuery(msg);
  const current = cashSessionsStore.getCurrent();

  const completed = appointmentsStore
    .list({ date })
    .filter((appointment) => appointment.status === "completed");

  const total = completed.reduce(
    (sum, appointment) => sum + Number(appointment.totalPrice ?? 0),
    0,
  );

  if (/caixa/.test(normalizar(msg))) {
    return { texto: current ? "Caixa aberto." : "Caixa fechado." };
  }

  return {
    texto: `Faturamento de ${formatDateLong(date)}: R$ ${total.toFixed(2)}`,
  };
}

function buildSystemPrompt(userMessage: string): string {
  const services = getActiveServices().sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  const employees = getActiveEmployees().sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  const clientQuery = stripKnownEntities(userMessage) || userMessage.trim();

  const clients = clientsStore
    .list()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const matchingClients = clientQuery
    ? clients
        .filter((client) =>
          normalizar(client.name).includes(normalizar(clientQuery)),
        )
        .slice(0, 20)
    : [];

  return [
    "Você é o assistente do salão Domínio Pro.",
    "Responda em pt-BR, curto e direto.",
    "Nunca invente dados.",
    "Não execute ações do sistema.",
    "FONTES DE VERDADE:",
    "- Cliente: cadastro real de clientes.",
    "- Agendamento: agenda real.",
    "- Profissional: cadastro de profissionais.",
    "- Serviço: cadastro de serviços.",
    "- Financeiro: caixa e agendamentos concluídos.",
    "Nunca use agenda como substituta da lista de clientes.",
    "",
    "SERVIÇOS CADASTRADOS:",
    services.map((service) => `- ${service.name}`).join("\n") || "- nenhum",
    "",
    "PROFISSIONAIS CADASTRADOS:",
    employees.map((employee) => `- ${employee.name}`).join("\n") || "- nenhum",
    "",
    "CLIENTES DO CADASTRO REAL ENCONTRADOS PARA A BUSCA:",
    matchingClients.map((client) => `- ${client.name}`).join("\n") ||
      "- nenhum",
  ].join("\n");
}

async function answerWithLLM(
  mensagemUsuario: string,
  historicoConversa: MensagemConversa[],
): Promise<ResultadoAgente> {
  const body = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: buildSystemPrompt(mensagemUsuario) },
      ...historicoConversa.slice(-6),
      { role: "user", content: mensagemUsuario },
    ],
    temperature: 0.2,
    max_tokens: 300,
  });

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(`Groq ${response.status}`);
  }

  const data = await response.json();
  const texto =
    data.choices?.[0]?.message?.content?.trim() ||
    "Não consegui responder agora.";

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

    const draft = loadDraft();
    if (draft?.flow === "schedule") {
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
      case "cancel":
      case "reschedule":
        return {
          texto:
            "Esse fluxo ainda não foi refeito nesta versão do agente. Foquei primeiro em corrigir o agendamento.",
        };
      default:
        return await answerWithLLM(msg, historicoConversa);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("401")) {
      return { texto: "Chave da IA inválida.", erro: message };
    }

    if (message.includes("429")) {
      return {
        texto: "Muitas requisições. Tente de novo em instantes.",
        erro: message,
      };
    }
