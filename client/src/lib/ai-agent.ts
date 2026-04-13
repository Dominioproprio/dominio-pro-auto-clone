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
  | "query_schedule"
  | "query_finance"
  | "query_client"
  | "query_available"
  | "cancel"
  | "reschedule"
  | "unknown";

type SlotName = "client" | "date" | "time" | "service" | "employee";

interface DraftState {
  flow: "schedule";
  client?: Client;
  clientQuery?: string;
  clientOptions?: string[];

  date?: string;
  time?: string;

  service?: Service;
  serviceQuery?: string;
  serviceOptions?: string[];

  employee?: Employee;
  employeeQuery?: string;
  employeeOptions?: string[];

  awaitingConfirmation?: boolean;
  updatedAt: number;
}

interface LearningSettings {
  preferCurrentSlotOnShortReply: boolean;
  preferCorrectionAfterNo: boolean;
}

interface PendingLearningApproval {
  key: keyof LearningSettings;
  prompt: string;
  createdAt: number;
}

interface FeedbackRecord {
  id: string;
  kind: "like" | "dislike";
  reason?: string;
  createdAt: string;
  draftSnapshot?: string;
}

const DRAFT_KEY = "dominio_pro_ai_agent_schedule_draft_v6";
const LEARNING_KEY = "dominio_pro_ai_agent_learning_v1";
const PENDING_LEARNING_KEY = "dominio_pro_ai_agent_pending_learning_v1";
const FEEDBACK_KEY = "dominio_pro_ai_agent_feedback_v1";

const TZ = "America/Sao_Paulo";

const YES =
  /^(sim|s|ok|confirmo|confirmar|pode|isso|isso mesmo|pode confirmar|confirmado)[.! ]*$/i;

const NO_ONLY =
  /^(nao|não|negativo|corrigir|corrige|errado|nao mesmo|não mesmo)[.! ]*$/i;

const NO_WITH_TEXT =
  /^(nao|não|negativo|corrigir|corrige|errado)[,.:;! ]+(.+)$/i;

const LEARN_YES =
  /^(sim aprender|aprender sim|sim, aprender|pode aprender|sim, pode aprender)[.! ]*$/i;

const LEARN_NO =
  /^(nao aprender|não aprender|nao, aprender nao|não, aprender não|nao, obrigado|não, obrigado)[.! ]*$/i;

const LIKE_ONLY = /^(like|👍)$/i;
const DISLIKE_ONLY = /^(dislike|deslike|👎)$/i;
const LIKE_WITH_REASON = /^(like|👍)\s*[:\-]\s*(.+)$/i;
const DISLIKE_WITH_REASON = /^(dislike|deslike|👎)\s*[:\-]\s*(.+)$/i;

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

const CORE_STOPWORDS = new Set([
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
  "servico",
  "serviço",
  "profissional",
  "dia",
  "data",
]);

function normalizar(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function summarizeDraft(draft: DraftState | null): string | undefined {
  if (!draft) return undefined;

  return [
    `Cliente: ${draft.client?.name ?? "—"}`,
    `Data: ${draft.date ?? "—"}`,
    `Horário: ${draft.time ?? "—"}`,
    `Serviço: ${draft.service?.name ?? "—"}`,
    `Profissional: ${draft.employee?.name ?? "—"}`,
  ].join(" | ");
}

function addFeedback(
  kind: "like" | "dislike",
  reason?: string,
  draft?: DraftState | null,
): void {
  try {
    const storage = getStorage();
    if (!storage) return;

    const raw = storage.getItem(FEEDBACK_KEY);
    const current = raw ? (JSON.parse(raw) as FeedbackRecord[]) : [];

    const next: FeedbackRecord[] = [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        reason,
        createdAt: new Date().toISOString(),
        draftSnapshot: summarizeDraft(draft),
      },
      ...current,
    ].slice(0, 200);

    storage.setItem(FEEDBACK_KEY, JSON.stringify(next));
  } catch {
    // não quebra o fluxo
  }
}

function handleFeedbackMessage(msg: string, draft: DraftState | null): ResultadoAgente | null {
  const trimmed = msg.trim();

  if (LIKE_WITH_REASON.test(trimmed)) {
    const reason = trimmed.match(LIKE_WITH_REASON)?.[2]?.trim();
    addFeedback("like", reason, draft);
    return {
      texto: "Like registrado com motivo. Vou usar isso como referência de avaliação do agente.",
    };
  }

  if (DISLIKE_WITH_REASON.test(trimmed)) {
    const reason = trimmed.match(DISLIKE_WITH_REASON)?.[2]?.trim();
    addFeedback("dislike", reason, draft);
    return {
      texto: "Dislike registrado com motivo. Vou tratar isso como falha observada do agente.",
    };
  }

  if (LIKE_ONLY.test(trimmed)) {
    addFeedback("like", undefined, draft);
    return {
      texto: 'Like registrado. Se quiser detalhar, mande por exemplo: "like: entendeu o cliente certo".',
    };
  }

  if (DISLIKE_ONLY.test(trimmed)) {
    addFeedback("dislike", undefined, draft);
    return {
      texto:
        'Dislike registrado. Se quiser detalhar, mande por exemplo: "dislike: repetiu pergunta do profissional".',
    };
  }

  return null;
}

function getLearningSettings(): LearningSettings {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(LEARNING_KEY);

    if (!raw) {
      return {
        preferCurrentSlotOnShortReply: false,
        preferCorrectionAfterNo: false,
      };
    }

    const parsed = JSON.parse(raw) as Partial<LearningSettings>;
    return {
      preferCurrentSlotOnShortReply: Boolean(parsed.preferCurrentSlotOnShortReply),
      preferCorrectionAfterNo: Boolean(parsed.preferCorrectionAfterNo),
    };
  } catch {
    return {
      preferCurrentSlotOnShortReply: false,
      preferCorrectionAfterNo: false,
    };
  }
}

function saveLearningSettings(settings: LearningSettings): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LEARNING_KEY, JSON.stringify(settings));
}

function loadPendingLearning(): PendingLearningApproval | null {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(PENDING_LEARNING_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingLearningApproval;
    if (!parsed?.createdAt || Date.now() - parsed.createdAt > 30 * 60_000) {
      storage?.removeItem(PENDING_LEARNING_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function savePendingLearning(value: PendingLearningApproval | null): void {
  const storage = getStorage();
  if (!storage) return;

  if (!value) {
    storage.removeItem(PENDING_LEARNING_KEY);
    return;
  }

  storage.setItem(PENDING_LEARNING_KEY, JSON.stringify(value));
}

function maybeOfferLearning(
  key: keyof LearningSettings,
  prompt: string,
): string {
  const settings = getLearningSettings();
  if (settings[key]) return "";

  savePendingLearning({
    key,
    prompt,
    createdAt: Date.now(),
  });

  return `\n\n${prompt} Responda: "sim aprender" ou "não aprender".`;
}

function handlePendingLearningAnswer(msg: string): ResultadoAgente | null {
  const pending = loadPendingLearning();
  if (!pending) return null;

  if (LEARN_YES.test(msg.trim())) {
    const settings = getLearningSettings();
    settings[pending.key] = true;
    saveLearningSettings(settings);
    savePendingLearning(null);
    return {
      texto:
        "Aprendizado aprovado. Vou usar isso como referência futura sem quebrar as regras do sistema.",
    };
  }

  if (LEARN_NO.test(msg.trim())) {
    savePendingLearning(null);
    return {
      texto:
        "Certo. Corrijo o caso atual quando necessário, mas não vou usar isso como referência futura.",
    };
  }

  return null;
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

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function detectIntent(msg: string): Intent {
  const n = normalizar(msg);

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

  if (
    /(cancelar agendamento|cancelar horario|cancelar horário|desmarcar|cancelar)/.test(
      n,
    )
  ) {
    return "cancel";
  }

  if (
    /(remarcar|remarca|reagendar|reagenda|mudar horario|mudar horário|mover horario|mover horário|mover agendamento)/.test(
      n,
    )
  ) {
    return "reschedule";
  }

  if (/(agendar|marcar|novo agendamento|encaixar|encaixe)/.test(n)) {
    return "schedule";
  }

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

function tokenize(value: string): string[] {
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
  if (h.includes(c)) return 0.93;

  const tokens = c.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;

  const hits = tokens.filter((token) => h.includes(token)).length;
  if (!hits) return 0;

  const ratio = hits / tokens.length;
  return ratio >= 1 ? 0.88 : ratio * 0.8;
}

function getActiveServices(): Service[] {
  return servicesStore.list(true);
}

function getActiveEmployees(): Employee[] {
  return employeesStore.list(true);
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

function extractStructuredField(
  text: string,
  labels: string[],
  stopLabels: string[],
): string | undefined {
  const cleanText = text.replace(/\n/g, " ");
  const stopPattern = stopLabels.map((item) => escapeRegex(item)).join("|");

  for (const label of labels) {
    const rx = new RegExp(
      `(?:^|\\b)${escapeRegex(label)}\\b\\s*[:=-]?\\s*(.+?)(?=(?:\\b(?:${stopPattern})\\b\\s*[:=-]?|$))`,
      "i",
    );

    const match = cleanText.match(rx);
    const value = match?.[1]?.trim();
    if (value) return value;
  }

  return undefined;
}

function isLikelyFullSentence(text: string): boolean {
  const n = normalizar(text);
  return (
    /(agendar|marcar|cliente|servico|serviço|profissional|com|amanha|amanhã|hoje)/.test(n) ||
    /\b\d{1,2}(?::|h)?\d{0,2}\b/.test(n)
  );
}

function isProfessionalsListQuery(text: string): boolean {
  const n = normalizar(text);
  return /(lista de profissionais|quais profissionais|quem sao os profissionais|quem são os profissionais|profissionais disponiveis|profissionais disponíveis)/.test(
    n,
  );
}

function isServicesListQuery(text: string): boolean {
  const n = normalizar(text);
  return /(lista de servicos|lista de serviços|quais servicos|quais serviços|servicos disponiveis|serviços disponíveis)/.test(
    n,
  );
}

function formatProfessionalsList(): string {
  const employees = getActiveEmployees().sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  if (!employees.length) return "Não encontrei profissionais cadastrados.";

  return `Profissionais cadastrados:\n- ${employees.map((item) => item.name).join("\n- ")}`;
}

function formatServicesList(): string {
  const services = getActiveServices().sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  if (!services.length) return "Não encontrei serviços cadastrados.";

  return `Serviços cadastrados:\n- ${services.map((item) => item.name).join("\n- ")}`;
}

function stripForClientCandidate(text: string): string {
  let out = normalizar(text);

  for (const service of getActiveServices()) {
    const rx = new RegExp(`\\b${escapeRegex(normalizar(service.name))}\\b`, "gi");
    out = out.replace(rx, " ");
  }

  for (const employee of getActiveEmployees()) {
    const rx = new RegExp(`\\b${escapeRegex(normalizar(employee.name))}\\b`, "gi");
    out = out.replace(rx, " ");
  }

  out = out.replace(/\bcom\s+[a-zà-ÿ]+(?:\s+[a-zà-ÿ]+){0,2}\b/gi, " ");
  out = out.replace(/\b\d{1,2}(?::|h)?\d{0,2}\b/g, " ");
  out = out.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, " ");
  out = out.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, " ");

  const weekdayKeys = Object.keys(WEEKDAY_SHORT).sort((a, b) => b.length - a.length);
  for (const key of weekdayKeys) {
    const rx = new RegExp(`\\b${escapeRegex(normalizar(key))}\\b`, "gi");
    out = out.replace(rx, " ");
  }

  const tokens = tokenize(out).filter((token) => !CORE_STOPWORDS.has(token));
  return tokens.slice(0, 4).join(" ").trim();
}

function resolveBestService(text: string): {
  service?: Service;
  ambiguous?: string[];
} {
  const base = getActiveServices();

  const scored = base
    .map((service) => ({
      service,
      score: scoreByTokens(text, service.name),
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

  const normalizedText = normalizar(text);
  const exact = scored.filter((item) =>
    normalizedText.includes(normalizar(item.service.name)),
  );
  if (exact.length === 1) {
    return { service: exact[0].service };
  }

  return {
    ambiguous: scored.slice(0, 5).map((item) => item.service.name),
  };
}

function resolveBestEmployee(text: string): {
  employee?: Employee;
  ambiguous?: string[];
} {
  const explicit =
    extractStructuredField(
      text,
      ["profissional", "com"],
      ["cliente", "servico", "serviço", "horario", "horário", "data", "dia"],
    ) ?? text;

  const base = getActiveEmployees();

  const scored = base
    .map((employee) => ({
      employee,
      score: scoreByTokens(explicit, employee.name),
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

  const normalizedText = normalizar(explicit);
  const exact = scored.filter((item) =>
    normalizedText.includes(normalizar(item.employee.name)),
  );
  if (exact.length === 1) {
    return { employee: exact[0].employee };
  }

  return {
    ambiguous: scored.slice(0, 5).map((item) => item.employee.name),
  };
}

async function resolveBestClient(text: string): Promise<{
  client?: Client;
  query?: string;
  ambiguous?: string[];
}> {
  const explicit = extractStructuredField(
    text,
    ["cliente", "nome do cliente"],
    ["servico", "serviço", "horario", "horário", "data", "dia", "profissional", "com"],
  );

  const candidate = explicit ? normalizar(explicit) : stripForClientCandidate(text);
  if (!candidate || candidate.length < 2) return {};

  const found = await clientsStore.search(candidate, { limit: 8 });
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

  if (top.score >= 0.94 && (second?.score ?? 0) <= 0.74) {
    return { client: top.client, query: candidate };
  }

  if (top.score === 1 && second && second.score < 0.75) {
    return { client: top.client, query: candidate };
  }

  return {
    query: candidate,
    ambiguous: scored.slice(0, 5).map((item) => item.client.name),
  };
}

function getCurrentMissingSlot(draft: DraftState): SlotName | null {
  if (!draft.client) return "client";
  if (!draft.date) return "date";
  if (!draft.time) return "time";
  if (!draft.service) return "service";
  if (!draft.employee) return "employee";
  return null;
}

function clearSlot(draft: DraftState, slot: SlotName): void {
  if (slot === "client") {
    draft.client = undefined;
    draft.clientQuery = undefined;
    draft.clientOptions = undefined;
  }
  if (slot === "date") {
    draft.date = undefined;
  }
  if (slot === "time") {
    draft.time = undefined;
  }
  if (slot === "service") {
    draft.service = undefined;
    draft.serviceQuery = undefined;
    draft.serviceOptions = undefined;
  }
  if (slot === "employee") {
    draft.employee = undefined;
    draft.employeeQuery = undefined;
    draft.employeeOptions = undefined;
  }
}

function nextQuestion(draft: DraftState): string {
  const missing = getCurrentMissingSlot(draft);

  if (missing === "client") {
    if (draft.clientOptions?.length) {
      return `Encontrei mais de um cliente parecido. Digite o nome completo.\n- ${draft.clientOptions.join("\n- ")}`;
    }
    if (draft.clientQuery) {
      return `Não encontrei o cliente "${draft.clientQuery}" no cadastro real. Qual é o cliente?`;
    }
    return "Qual é o cliente?";
  }

  if (missing === "date") return "Qual é a data?";
  if (missing === "time") return "Qual é o horário?";

  if (missing === "service") {
    if (draft.serviceOptions?.length) {
      return `Encontrei mais de um serviço parecido. Digite o nome completo do serviço.\n- ${draft.serviceOptions.join("\n- ")}`;
    }
    if (draft.serviceQuery) {
      return `Não identifiquei o serviço "${draft.serviceQuery}". Qual é o serviço?`;
    }
    return "Qual é o serviço?";
  }

  if (missing === "employee") {
    if (draft.employeeOptions?.length) {
      return `Encontrei mais de um profissional parecido. Digite o nome completo do profissional.\n- ${draft.employeeOptions.join("\n- ")}`;
    }
    if (draft.employeeQuery) {
      return `Não identifiquei o profissional "${draft.employeeQuery}". Qual é o profissional?`;
    }
    return "Qual é o profissional?";
  }

  return `Confirma?\n${summarizeDraft(draft)}`;
}

async function fillClientOnly(
  draft: DraftState,
  text: string,
): Promise<string | null> {
  const resolution = await resolveBestClient(text);

  if (resolution.client) {
    draft.client = resolution.client;
    draft.clientQuery = undefined;
    draft.clientOptions = undefined;
    return null;
  }

  if (resolution.ambiguous?.length) {
    draft.clientQuery = resolution.query;
    draft.clientOptions = resolution.ambiguous;
    return `Encontrei mais de um cliente parecido. Digite o nome completo.\n- ${resolution.ambiguous.join("\n- ")}`;
  }

  if (resolution.query) {
    draft.clientQuery = resolution.query;
    return `Não encontrei o cliente "${resolution.query}" no cadastro real. Qual é o cliente?`;
  }

  return "Qual é o cliente?";
}

function fillDateOnly(draft: DraftState, text: string): string | null {
  const date = resolveDateFromText(text, false);
  if (!date) return "Qual é a data?";
  if (isPastDate(date)) return "Não posso agendar em data passada. Qual é a data?";
  draft.date = date;
  return null;
}

function fillTimeOnly(draft: DraftState, text: string): string | null {
  const time = extractTime(text);
  if (!time) return "Qual é o horário?";
  draft.time = time;
  return null;
}

function fillServiceOnly(draft: DraftState, text: string): string | null {
  const resolution = resolveBestService(text);

  if (resolution.service) {
    draft.service = resolution.service;
    draft.serviceQuery = undefined;
    draft.serviceOptions = undefined;
    return null;
  }

  if (resolution.ambiguous?.length) {
    draft.serviceQuery = text.trim();
    draft.serviceOptions = resolution.ambiguous;
    return `Encontrei mais de um serviço parecido. Digite o nome completo do serviço.\n- ${resolution.ambiguous.join("\n- ")}`;
  }

  draft.serviceQuery = text.trim();
  return "Qual é o serviço?";
}

function fillEmployeeOnly(draft: DraftState, text: string): string | null {
  const resolution = resolveBestEmployee(text);

  if (resolution.employee) {
    draft.employee = resolution.employee;
    draft.employeeQuery = undefined;
    draft.employeeOptions = undefined;
    return null;
  }

  if (resolution.ambiguous?.length) {
    draft.employeeQuery = text.trim();
    draft.employeeOptions = resolution.ambiguous;
    return `Encontrei mais de um profissional parecido. Digite o nome completo do profissional.\n- ${resolution.ambiguous.join("\n- ")}`;
  }

  draft.employeeQuery = text.trim();
  return "Qual é o profissional?";
}

async function fillCurrentMissingSlot(
  draft: DraftState,
  text: string,
): Promise<string | null> {
  const missing = getCurrentMissingSlot(draft);
  if (!missing) return null;

  const n = normalizar(text);
  if (YES.test(text) || NO_ONLY.test(text) || n === "ok") {
    return nextQuestion(draft);
  }

  if (missing === "client") return fillClientOnly(draft, text);
  if (missing === "date") return fillDateOnly(draft, text);
  if (missing === "time") return fillTimeOnly(draft, text);
  if (missing === "service") return fillServiceOnly(draft, text);
  return fillEmployeeOnly(draft, text);
}

async function applyExtraction(
  draft: DraftState,
  text: string,
  allowOverride: boolean,
): Promise<string | null> {
  const explicitClient = extractStructuredField(
    text,
    ["cliente", "nome do cliente"],
    ["servico", "serviço", "horario", "horário", "data", "dia", "profissional", "com"],
  );

  const explicitService = extractStructuredField(
    text,
    ["servico", "serviço"],
    ["cliente", "horario", "horário", "data", "dia", "profissional", "com"],
  );

  const explicitEmployee = extractStructuredField(
    text,
    ["profissional", "com"],
    ["cliente", "servico", "serviço", "horario", "horário", "data", "dia"],
  );

  const explicitDate = extractStructuredField(
    text,
    ["data", "dia"],
    ["cliente", "servico", "serviço", "horario", "horário", "profissional", "com"],
  );

  const explicitTime = extractStructuredField(
    text,
    ["horario", "horário"],
    ["cliente", "servico", "serviço", "data", "dia", "profissional", "com"],
  );

  if (explicitClient && (!draft.client || allowOverride)) {
    clearSlot(draft, "client");
    const error = await fillClientOnly(draft, explicitClient);
    if (error) return error;
  } else if (!draft.client && isLikelyFullSentence(text)) {
    const resolution = await resolveBestClient(text);
    if (resolution.client) {
      draft.client = resolution.client;
      draft.clientQuery = undefined;
      draft.clientOptions = undefined;
    } else if (resolution.ambiguous?.length) {
      draft.clientQuery = resolution.query;
      draft.clientOptions = resolution.ambiguous;
    } else if (resolution.query) {
      draft.clientQuery = resolution.query;
    }
  }

  if (explicitDate && (!draft.date || allowOverride)) {
    const error = fillDateOnly(draft, explicitDate);
    if (error) return error;
  } else if (!draft.date && isLikelyFullSentence(text)) {
    const date = resolveDateFromText(text, false);
    if (date && !isPastDate(date)) draft.date = date;
  }

  if (explicitTime && (!draft.time || allowOverride)) {
    const error = fillTimeOnly(draft, explicitTime);
    if (error) return error;
  } else if (!draft.time && isLikelyFullSentence(text)) {
    const time = extractTime(text);
    if (time) draft.time = time;
  }

  if (explicitService && (!draft.service || allowOverride)) {
    clearSlot(draft, "service");
    const error = fillServiceOnly(draft, explicitService);
    if (error) return error;
  } else if (!draft.service && isLikelyFullSentence(text)) {
    const resolution = resolveBestService(text);
    if (resolution.service) {
      draft.service = resolution.service;
      draft.serviceQuery = undefined;
      draft.serviceOptions = undefined;
    } else if (resolution.ambiguous?.length) {
      draft.serviceQuery = text.trim();
      draft.serviceOptions = resolution.ambiguous;
    }
  }

  if (explicitEmployee && (!draft.employee || allowOverride)) {
    clearSlot(draft, "employee");
    const error = fillEmployeeOnly(draft, explicitEmployee);
    if (error) return error;
  } else if (!draft.employee && isLikelyFullSentence(text)) {
    const resolution = resolveBestEmployee(text);
    if (resolution.employee) {
      draft.employee = resolution.employee;
      draft.employeeQuery = undefined;
      draft.employeeOptions = undefined;
    } else if (resolution.ambiguous?.length) {
      draft.employeeQuery = text.trim();
      draft.employeeOptions = resolution.ambiguous;
    }
  }

  return null;
}

function getWeekdayKey(dateStr: string): string {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][parseYMD(dateStr).getDay()]!;
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
      const aStart = new Date(appointment.startTime).getTime();
      const aEnd = new Date(appointment.endTime).getTime();
      return start < aEnd && end > aStart;
    });
}

async function validateAndMaybeConfirm(draft: DraftState): Promise<ResultadoAgente | null> {
  if (!draft.client || !draft.date || !draft.time || !draft.service || !draft.employee) {
    return null;
  }

  if (!isEmployeeCompatible(draft.employee, draft.service)) {
    clearSlot(draft, "employee");
    saveDraft(draft);
    return {
      texto: `O serviço ${draft.service.name} não está compatível com esse profissional. Qual é o profissional?`,
    };
  }

  const endMinutes = timeToMinutes(draft.time) + draft.service.durationMinutes;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
    endMinutes % 60,
  ).padStart(2, "0")}`;

  if (!isWithinWorkingHours(draft.employee, draft.date, draft.time, endTime)) {
    clearSlot(draft, "time");
    saveDraft(draft);
    return {
      texto: `${draft.employee.name} não atende nesse horário. Qual é o horário?`,
    };
  }

  if (hasConflict(draft)) {
    clearSlot(draft, "time");
    saveDraft(draft);
    return { texto: "Há conflito nesse horário. Qual é o horário?" };
  }

  draft.awaitingConfirmation = true;
  saveDraft(draft);
  return { texto: `Confirma?\n${summarizeDraft(draft)}` };
}

function getInFlowSideQueryResponse(draft: DraftState, msg: string): string | null {
  if (isProfessionalsListQuery(msg)) {
    return `${formatProfessionalsList()}\n\nVoltando ao agendamento: ${nextQuestion(draft)}`;
  }

  if (isServicesListQuery(msg)) {
    return `${formatServicesList()}\n\nVoltando ao agendamento: ${nextQuestion(draft)}`;
  }

  return null;
}

async function handleScheduleFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();

  const trimmed = msg.trim();
  const normalized = normalizar(trimmed);
  const learning = getLearningSettings();

  let draft =
    loadDraft() ??
    ({
      flow: "schedule",
      updatedAt: Date.now(),
    } as DraftState);

  const sideQuery = getInFlowSideQueryResponse(draft, trimmed);
  if (sideQuery) {
    return { texto: sideQuery };
  }

  if (
    /\be\b/.test(normalized) &&
    /( e |,)/.test(normalized) &&
    /(corte|escova|hidr|hidrat|sobrancelha|unha|servico|serviço)/.test(normalized)
  ) {
    return {
      texto: "Serviço múltiplo ainda não está fechado. Me passe um serviço por vez.",
    };
  }

  if (draft.awaitingConfirmation) {
    if (YES.test(trimmed)) {
      if (!draft.client || !draft.date || !draft.time || !draft.service || !draft.employee) {
        draft.awaitingConfirmation = false;
        saveDraft(draft);
        return { texto: nextQuestion(draft) };
      }

      const validation = await validateAndMaybeConfirm(draft);
      if (validation) {
        if (draft.awaitingConfirmation) {
          const created = await appointmentsStore.create(buildAppointmentPayload(draft));
          saveDraft(null);
          return {
            texto: `Agendamento confirmado.\n${summarizeDraft(draft)}`,
            agendamentoCriado: created,
          };
        }
        return validation;
      }
    }

    const noWithText = trimmed.match(NO_WITH_TEXT);

    if (noWithText?.[2]) {
      draft.awaitingConfirmation = false;
      const correctionText = noWithText[2].trim();

      const error = await applyExtraction(draft, correctionText, true);
      saveDraft(draft);

      if (error) return { texto: error };

      const afterCorrection = await validateAndMaybeConfirm(draft);
      if (afterCorrection) {
        const learnText = maybeOfferLearning(
          "preferCorrectionAfterNo",
          "Percebi que você corrigiu um campo com 'não + correção'. Quer que eu use esse padrão como referência futura?",
        );
        return { texto: `${afterCorrection.texto}${learnText}` };
      }

      return { texto: nextQuestion(draft) };
    }

    if (NO_ONLY.test(trimmed)) {
      draft.awaitingConfirmation = false;
      saveDraft(draft);
      return {
        texto:
          "O que você quer corrigir? Pode me mandar direto, por exemplo: cliente Edvaldo, horário 10:00, serviço corte masculino ou profissional Ricardo Braga.",
      };
    }

    draft.awaitingConfirmation = false;
    const correctionError = await applyExtraction(draft, trimmed, true);
    saveDraft(draft);

    if (correctionError) return { texto: correctionError };

    const afterCorrection = await validateAndMaybeConfirm(draft);
    if (afterCorrection) return afterCorrection;

    return { texto: nextQuestion(draft) };
  }

  const missing = getCurrentMissingSlot(draft);

  if (
    missing &&
    !isLikelyFullSentence(trimmed) &&
    (learning.preferCurrentSlotOnShortReply || trimmed.split(/\s+/).length <= 4)
  ) {
    const fillError = await fillCurrentMissingSlot(draft, trimmed);
    saveDraft(draft);

    if (fillError) {
      const learnText = maybeOfferLearning(
        "preferCurrentSlotOnShortReply",
        "Percebi que você respondeu com texto curto para completar a etapa atual. Quer que eu trate esse padrão como referência futura?",
      );
      return { texto: `${fillError}${learnText}` };
    }

    const maybeConfirm = await validateAndMaybeConfirm(draft);
    if (maybeConfirm) return maybeConfirm;

    return { texto: nextQuestion(draft) };
  }

  const extractionError = await applyExtraction(draft, trimmed, false);
  saveDraft(draft);

  if (draft.date && isPastDate(draft.date)) {
    clearSlot(draft, "date");
    saveDraft(draft);
    return { texto: "Não posso agendar em data passada. Qual é a data?" };
  }

  if (extractionError) {
    return { texto: extractionError };
  }

  const maybeConfirm = await validateAndMaybeConfirm(draft);
  if (maybeConfirm) return maybeConfirm;

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
      employeesStore.list(true).find((item) => item.id === appointment.employeeId)?.name ??
      `ID ${appointment.employeeId}`;

    const service = appointment.services[0]?.name ?? "—";
    return `${time} — ${appointment.clientName ?? "—"} — ${service} — ${employee}`;
  });

  return { texto: `${formatDateLong(date)}\n${lines.join("\n")}` };
}

async function queryClient(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();

  const query = stripForClientCandidate(msg).trim() || msg.trim();
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
          const start = new Date(appointment.startTime).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });
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

  const clientQuery = stripForClientCandidate(userMessage).trim() || userMessage.trim();

  const clients = clientsStore.list().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const matchingClients = clientQuery
    ? clients
        .filter((client) => normalizar(client.name).includes(normalizar(clientQuery)))
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
    matchingClients.map((client) => `- ${client.name}`).join("\n") || "- nenhum",
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

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Groq ${response.status}`);
  }

  const data = await response.json();
  const texto =
    data.choices?.[0]?.message?.content?.trim() || "Não consegui responder agora.";

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

    const currentDraft = loadDraft();

    const feedbackResult = handleFeedbackMessage(msg, currentDraft);
    if (feedbackResult) return feedbackResult;

    const pendingLearningAnswer = handlePendingLearningAnswer(msg);
    if (pendingLearningAnswer) return pendingLearningAnswer;

    if (currentDraft?.flow === "schedule") {
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

    return {
      texto: "Erro ao processar a mensagem.",
      erro: message,
    };
  }
    }
