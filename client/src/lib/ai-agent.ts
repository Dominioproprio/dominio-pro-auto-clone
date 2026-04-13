import {
  clientsStore,
  servicesStore,
  employeesStore,
  appointmentsStore,
  cashSessionsStore,
  type Employee,
  type Service,
  type Appointment,
  type AppointmentService,
} from "./store";
import {
  calcPeriodStats,
  calcRevenueByEmployee,
  calcPopularServices,
  getAppointmentsInPeriod,
  getPeriodDates,
} from "./analytics";

export interface MensagemConversa {
  role: "user" | "assistant";
  content: string;
}

export interface ResultadoAgente {
  texto: string;
  agendamentoCriado?: Appointment;
  erro?: string;
}

type ActionType =
  | "agendar"
  | "cancelar"
  | "mover"
  | "concluir"
  | "criar_cliente"
  | "trocar_cliente";

interface ActionPayload {
  type: ActionType;
  params: Record<string, unknown>;
}

interface PendingAction {
  action: ActionPayload;
  type: "conflict" | "professional";
  timestamp: number;
}

interface FeedbackItem {
  id: string;
  rating: "good" | "bad";
  userMessage: string;
  agentResponse: string;
  createdAt: string;
}

const HISTORY_KEY = "ai_agent_llm_history_v1";
const PENDING_KEY = "ai_agent_llm_pending_v1";
const FEEDBACK_KEY = "ai_agent_feedback_v1";
const LLM_PROXY = "/api/llm";
const GITHUB_LLM_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const HISTORY_LIMIT = 20;
const TZ = "America/Sao_Paulo";


async function ensureBaseLoaded(): Promise<void> {
  await Promise.allSettled([
    clientsStore.ensureLoaded(),
    Promise.resolve(
      servicesStore.list(true).length
        ? servicesStore.list(true)
        : servicesStore.fetchAll(),
    ),
    Promise.resolve(
      employeesStore.list(true).length
        ? employeesStore.list(true)
        : employeesStore.fetchAll(),
    ),
    Promise.resolve(
      appointmentsStore.list().length
        ? appointmentsStore.list()
        : appointmentsStore.fetchAll(),
    ),
    Promise.resolve(
      cashSessionsStore.list().length
        ? cashSessionsStore.list()
        : cashSessionsStore.fetchAll(),
    ),
  ]);
}

function getStorage(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function loadHistory(): MensagemConversa[] {
  try {
    const raw = getStorage()?.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as MensagemConversa[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: MensagemConversa[]): void {
  try {
    getStorage()?.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // ignore
  }
}

function addToHistory(role: "user" | "assistant", content: string): void {
  const history = loadHistory();
  history.push({ role, content });
  saveHistory(history);
}

export function clearHistory(): void {
  try {
    getStorage()?.removeItem(HISTORY_KEY);
    clearPendingAction();
  } catch {
    // ignore
  }
}

function savePendingAction(action: ActionPayload, type: "conflict" | "professional"): void {
  try {
    const payload: PendingAction = { action, type, timestamp: Date.now() };
    getStorage()?.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function loadPendingAction(): PendingAction | null {
  try {
    const raw = getStorage()?.getItem(PENDING_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PendingAction;
    if (Date.now() - data.timestamp > 10 * 60_000) {
      clearPendingAction();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearPendingAction(): void {
  try {
    getStorage()?.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

function normalizeText(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  let t = raw.toLowerCase().replace(/h/gi, ":").replace(/\s+/g, "").trim();
  t = t.replace(/:$/, "");
  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2, "0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    const hh = Number(h);
    const mm = Number(m);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${h.padStart(2, "0")}:${m}`;
  }
  return null;
}

function resolveDate(raw: string): string {
  const today = new Date();
  const r = normalizeText(raw);

  if (!r || r === "hoje") return today.toISOString().split("T")[0];

  if (r === "amanha") {
    const d = new Date(today);
    d.setDate(today.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  const dayMap: Record<string, number> = {
    domingo: 0,
    segunda: 1,
    terca: 2,
    terça: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
    sábado: 6,
    "segunda-feira": 1,
    "terca-feira": 2,
    "terça-feira": 2,
    "quarta-feira": 3,
    "quinta-feira": 4,
    "sexta-feira": 5,
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

  if (/^\d{1,2}\/\d{1,2}$/.test(r)) {
    const [dd, mm] = r.split("/");
    return `${today.getFullYear()}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(r)) {
    const [dd, mm, yy] = r.split("/");
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return r;
  return r;
}

function safeLocalTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isWithinWorkingHours(
  emp: Employee,
  dateStr: string,
  timeStr: string,
): { ok: boolean; message?: string } {
  const wh = emp.workingHours;
  if (!wh || Object.keys(wh).length === 0) return { ok: true };
  if (Object.keys(wh).length === 1) return { ok: true };

  const dayOfWeek = getDayOfWeek(dateStr);
  const ptKeys: Record<number, string[]> = {
    0: ["dom", "domingo"],
    1: ["seg", "segunda", "segunda-feira"],
    2: ["ter", "terca", "terça", "terca-feira", "terça-feira"],
    3: ["qua", "quarta", "quarta-feira"],
    4: ["qui", "quinta", "quinta-feira"],
    5: ["sex", "sexta", "sexta-feira"],
    6: ["sab", "sabado", "sábado"],
  };

  const possibleKeys = [String(dayOfWeek), ...(ptKeys[dayOfWeek] ?? [])];
  const matchedKey = possibleKeys.find((k) => wh[k] !== undefined);
  const dayConfig = matchedKey ? wh[matchedKey] : undefined;

  if (!dayConfig || !dayConfig.active) {
    const dayNames = [
      "domingo",
      "segunda-feira",
      "terça-feira",
      "quarta-feira",
      "quinta-feira",
      "sexta-feira",
      "sábado",
    ];
    return {
      ok: false,
      message: `${emp.name} não trabalha ${dayNames[dayOfWeek]}.`,
    };
  }

  const startMin = timeToMinutes(dayConfig.start);
  const endMin = timeToMinutes(dayConfig.end);
  const reqMin = timeToMinutes(timeStr);

  if (reqMin < startMin || reqMin >= endMin) {
    return {
      ok: false,
      message: `${emp.name} trabalha das ${dayConfig.start} às ${dayConfig.end} neste dia. O horário ${timeStr} está fora do expediente.`,
    };
  }

  return { ok: true };
}

function extractCandidateNames(message: string, history: MensagemConversa[]): string[] {
  const recentHistory = history.slice(-6).map((item) => item.content).join(" ");
  const fullContext = `${message} ${recentHistory}`;

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const employeesLower = new Set(
    employeesStore.list(true).flatMap((e) => e.name.split(" ").map(normalize)),
  );
  const servicesLower = new Set(
    servicesStore.list(true).flatMap((s) => s.name.split(" ").map(normalize)),
  );

  const stopWords = new Set([
    "com",
    "sem",
    "por",
    "ate",
    "das",
    "dos",
    "num",
    "uma",
    "uns",
    "ela",
    "ele",
    "elas",
    "eles",
    "seu",
    "sua",
    "seus",
    "suas",
    "quero",
    "agendar",
    "marcar",
    "cliente",
    "para",
    "preciso",
    "cancelar",
    "mover",
    "agenda",
    "hoje",
    "amanha",
    "hora",
    "servico",
    "horario",
    "consegue",
    "executar",
    "agendamento",
    "voce",
    "fazer",
    "nome",
    "tenho",
    "qual",
    "quais",
    "pode",
    "como",
    "quanto",
    "tempo",
    "duracao",
    "corte",
    "escova",
    "tintura",
    "manicure",
    "pedicure",
    "barba",
    "hidratacao",
    "hidratação",
    "profunda",
    "progressiva",
    "termica",
    "térmica",
    "relaxamento",
    "botox",
    "coloracao",
    "coloração",
    "luzes",
    "alisamento",
    "massagem",
    "unhas",
    "masculino",
    "feminino",
    "selagem",
    "reflexo",
    "mechas",
    "penteado",
    "sobrancelha",
    "sim",
    "nao",
    "não",
    "forcar",
    "forçar",
    "confirma",
    "confirmar",
    "forca",
    "força",
    "mesmo",
    "assim",
    "deixa",
    "esquece",
    "cancelado",
    "mova",
    "mude",
    "concluir",
    "fechar",
    "abrir",
    "buscar",
    "procurar",
    "faturamento",
    "financeiro",
    "receita",
    "comissao",
    "comissão",
    "relatorio",
    "relatório",
    "rendimento",
    "lucro",
    "ganho",
    "caixa",
    "semana",
    "mes",
    "mês",
  ]);

  const words = fullContext
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, ""))
    .filter((w) => w.length > 2);

  return words.filter((w) => {
    const wl = normalize(w);
    return !stopWords.has(wl) && !employeesLower.has(wl) && !servicesLower.has(wl);
  });
}

function getTodayData(): string {
  const today = getTodayStr();
  const appointments = appointmentsStore.list({ date: today });
  const employees = employeesStore.list(true);
  if (appointments.length === 0) return `Hoje (${today}): nenhum agendamento.`;

  const lines = appointments.map((appointment) => {
    const employee = employees.find((item) => item.id === appointment.employeeId);
    const services = appointment.services?.map((s) => s.name).join(", ") ?? "";
    const start = safeLocalTime(appointment.startTime);
    const end = safeLocalTime(appointment.endTime);
    return `  - ${start}-${end} | ${appointment.clientName} | ${services} | Prof: ${employee?.name ?? "?"} | ${appointment.status} | ID:${appointment.id}`;
  });

  return `Agendamentos hoje (${today}):\n${lines.join("\n")}`;
}

function getServicesData(): string {
  const services = servicesStore.list(true);
  if (services.length === 0) return "Nenhum serviço cadastrado.";
  return `Serviços disponíveis:\n${services
    .map((service) => `  - ID:${service.id} | ${service.name} | R$${service.price.toFixed(2)} | ${service.durationMinutes}min`)
    .join("\n")}`;
}

function getEmployeesData(): string {
  const employees = employeesStore.list(true);
  if (employees.length === 0) return "Nenhum profissional ativo.";

  return `Profissionais ativos:\n${employees
    .map((employee) => {
      const wh = employee.workingHours;
      let hoursInfo = "";

      if (wh && Object.keys(wh).length > 1) {
        const keyToLabel: Record<string, string> = {
          "0": "Dom",
          dom: "Dom",
          domingo: "Dom",
          "1": "Seg",
          seg: "Seg",
          segunda: "Seg",
          "2": "Ter",
          ter: "Ter",
          terca: "Ter",
          terça: "Ter",
          "3": "Qua",
          qua: "Qua",
          quarta: "Qua",
          "4": "Qui",
          qui: "Qui",
          quinta: "Qui",
          "5": "Sex",
          sex: "Sex",
          sexta: "Sex",
          "6": "Sab",
          sab: "Sab",
          sabado: "Sab",
          sábado: "Sab",
        };
        const activeDays = Object.entries(wh)
          .filter(([, value]) => value && value.active)
          .map(([key, value]) => `${keyToLabel[key.toLowerCase()] ?? key}: ${value.start}-${value.end}`)
          .join(", ");
        if (activeDays) hoursInfo = ` | Horários: ${activeDays}`;
      } else if (wh && Object.keys(wh).length === 1) {
        hoursInfo = " | Horários: Seg-Sáb: 07:00-18:00";
      }

      return `  - ID:${employee.id} | ${employee.name} | Comissão: ${employee.commissionPercent}%${hoursInfo}`;
    })
    .join("\n")}`;
}

function getApptsByDate(dateStr: string): string {
  const date = resolveDate(dateStr);
  const appointments = appointmentsStore.list({ date });
  const employees = employeesStore.list(true);
  if (appointments.length === 0) return `Nenhum agendamento em ${date}.`;

  const byEmployee = new Map<number, Appointment[]>();
  for (const appointment of appointments) {
    if (!byEmployee.has(appointment.employeeId)) byEmployee.set(appointment.employeeId, []);
    byEmployee.get(appointment.employeeId)?.push(appointment);
  }

  const lines: string[] = [
    `Agendamentos de ${date} por profissional (ATENÇÃO: conflito só bloqueia o profissional específico):`,
  ];

  for (const [employeeId, employeeAppointments] of byEmployee.entries()) {
    const employee = employees.find((item) => item.id === employeeId);
    lines.push(`  [${employee?.name ?? "?"}]:`);
    for (const appointment of employeeAppointments) {
      if (appointment.status === "cancelled") continue;
      const start = safeLocalTime(appointment.startTime);
      const end = safeLocalTime(appointment.endTime);
      const services = appointment.services?.map((s) => s.name).join(", ") ?? "";
      lines.push(`    - ${start}-${end} OCUPADO: ${appointment.clientName} | ${services} | ID:${appointment.id}`);
    }
  }

  return lines.join("\n");
}

async function getClientWithHistory(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) {
    let totalStr = "(indisponível)";
    try {
      totalStr = String(await clientsStore.count());
    } catch {
      // ignore
    }
    return `Total clientes: ${totalStr}`;
  }

  let found: Awaited<ReturnType<typeof clientsStore.search>> = [];
  try {
    found = await clientsStore.search(trimmed, { limit: 15 });
  } catch (err) {
    console.warn("[ai-agent] busca de clientes falhou:", err);
  }

  if (found.length === 0) {
    let totalStr = "(indisponível)";
    try {
      totalStr = String(await clientsStore.count());
    } catch {
      // ignore
    }
    return `Nenhum cliente encontrado com "${query}". Total no sistema: ${totalStr}.`;
  }

  let recentAppointments: Appointment[] = [];
  try {
    recentAppointments = await appointmentsStore.fetchByClientIds(found.map((client) => client.id));
  } catch {
    // ignore
  }

  const lastByClient = new Map<number, Appointment>();
  for (const appointment of recentAppointments) {
    if (appointment.clientId && !lastByClient.has(appointment.clientId)) {
      lastByClient.set(appointment.clientId, appointment);
    }
  }

  const lines = found.map((client) => {
    let line = `  - ID:${client.id} | ${client.name}`;
    if (client.phone) line += ` | ${client.phone}`;
    const last = lastByClient.get(client.id);
    if (last) {
      const lastService = last.services?.[0]?.name ?? "";
      const lastDate = last.startTime?.split("T")[0] ?? "";
      line += ` | Último serviço: ${lastService} em ${lastDate}`;
    }
    return line;
  });

  return `Clientes encontrados (${found.length}):\n${lines.join("\n")}`;
}

function getFinancialSummary(scope: "dia" | "semana" | "mes"): string {
  const periodMap: Record<"dia" | "semana" | "mes", "hoje" | "semana" | "mes"> = {
    dia: "hoje",
    semana: "semana",
    mes: "mes",
  };

  const { start, end } = getPeriodDates(periodMap[scope]);
  const employees = employeesStore.list(false);
  const appointments = getAppointmentsInPeriod(start, end);
  const stats = calcPeriodStats(appointments, employees);
  const byEmployee = calcRevenueByEmployee(appointments, employees);
  const popular = calcPopularServices(appointments);

  const lines: string[] = [
    `Financeiro (${scope}):`,
    `  Faturamento bruto: R$ ${stats.totalRevenue.toFixed(2)}`,
    `  Custos de material: R$ ${stats.totalMaterial.toFixed(2)}`,
    `  Comissões: R$ ${stats.totalCommissions.toFixed(2)}`,
    `  Líquido: R$ ${stats.netRevenue.toFixed(2)}`,
    `  Atendimentos: ${stats.count}`,
    `  Ticket médio: R$ ${stats.avgTicket.toFixed(2)}`,
    `  Cancelamentos: ${stats.cancelCount} (${stats.cancelRate.toFixed(1)}%)`,
  ];

  if (byEmployee.length > 0) {
    lines.push("  Comissões por profissional:");
    for (const employee of byEmployee.slice(0, 5)) {
      lines.push(
        `    - ${employee.name}: R$ ${employee.revenue.toFixed(2)} faturado | R$ ${employee.commission.toFixed(2)} comissão (${employee.commissionPercent}%) | ${employee.count} atend.`,
      );
    }
  }

  if (popular.length > 0) {
    lines.push("  Serviços mais rentáveis:");
    for (const service of popular.slice(0, 5)) {
      lines.push(`    - ${service.name}: ${service.count}x | R$ ${service.revenue.toFixed(2)}`);
    }
  }

  const currentCash = cashSessionsStore.getCurrent();
  if (!currentCash) {
    lines.push("  ⚠ ALERTA: Caixa NÃO está aberto!");
  } else {
    lines.push(`  Caixa: aberto desde ${new Date(currentCash.openedAt).toLocaleString("pt-BR")}`);
  }

  return lines.join("\n");
}

async function gatherData(message: string, history: MensagemConversa[] = []): Promise<string> {
  const lower = normalizeText(message);
  const parts: string[] = [getTodayData(), getEmployeesData(), getServicesData()];

  const candidateNames = extractCandidateNames(message, history);
  if (candidateNames.length > 0) {
    let clientData = "";
    for (const candidate of candidateNames.slice(0, 3)) {
      const result = await getClientWithHistory(candidate);
      if (!result.startsWith("Nenhum cliente") && !result.startsWith("Total")) {
        clientData = result;
        break;
      }
    }
    if (!clientData && candidateNames.length > 1) {
      clientData = await getClientWithHistory(candidateNames.slice(0, 2).join(" "));
    }
    if (!clientData) {
      clientData = await getClientWithHistory(candidateNames[0]);
    }
    parts.push(clientData);
  } else {
    let totalStr = "(indisponível)";
    try {
      totalStr = String(await clientsStore.count());
    } catch {
      // ignore
    }
    parts.push(`Total clientes cadastrados: ${totalStr}. Use busca por nome para localizar.`);
  }

  const fullContext = `${message} ${history.slice(-6).map((item) => item.content).join(" ")}`;
  const dateMatch = fullContext.match(
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|amanha|amanhã|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/i,
  );
  if (dateMatch) parts.push(getApptsByDate(dateMatch[1]));

  if (/faturamento|financeiro|receita|comiss[aã]o|rendimento|lucro|ganho|caixa/.test(lower)) {
    let scope: "dia" | "semana" | "mes" = "dia";
    if (/semana/.test(lower)) scope = "semana";
    else if (/mes|mês/.test(lower)) scope = "mes";
    parts.push(getFinancialSummary(scope));
  }

  return parts.join("\n\n");
}

function buildSystemPrompt(): string {
  const dateStr = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return `Você é o Agente IA do Domínio Pro.
Data atual: ${dateStr}

Você gerencia agendamentos, clientes, serviços, profissionais e financeiro.
Dados reais do sistema são fornecidos em cada mensagem — use-os com precisão.

REGRAS:
1. Responda em português brasileiro, direto e natural.
2. Você TEM ACESSO aos dados reais do sistema injetados no prompt.
3. Nunca diga que não tem acesso aos dados se eles estiverem no contexto.
4. Não confunda lista de clientes com lista de profissionais.
5. Para agendar: CLIENTE recebe o serviço; PROFISSIONAL executa.
6. Se houver mais de um profissional e o usuário não informou qual, pergunte.
7. Se houver apenas um profissional ativo, você pode usar esse automaticamente.
8. Mantenha contexto — se o cliente já foi identificado, não peça novamente.
9. Quando cliente recorrente é identificado e serviço não foi informado, você pode sugerir o último serviço.
10. Use os horários de trabalho dos profissionais fornecidos nos dados.
11. Quando o usuário perguntar sobre financeiro, use os dados financeiros fornecidos.
12. Se o caixa não estiver aberto e o usuário perguntar sobre financeiro, mencione isso. Nunca bloqueie agendamentos por causa do caixa.
13. HORÁRIOS OCUPADOS: cada agendamento bloqueia apenas o profissional daquele agendamento.
14. Nunca anuncie execução antes do retorno do sistema.
15. Se tiver todos os dados necessários, inclua o bloco action imediatamente.
16. Se faltar informação, pergunte objetivamente o que falta.
17. Não invente clientId nem employeeId; use os IDs reais dos dados injetados.
18. Nunca use a agenda como substituta do cadastro de clientes.

AÇÕES — inclua ao final da resposta quando executar operação:
\`\`\`action
{"type":"agendar","params":{"clientName":"Nome Exato","serviceId":45,"employeeId":2,"date":"hoje","time":"14:00"}}
\`\`\`

Tipos: agendar | cancelar | mover | concluir | criar_cliente | trocar_cliente
- agendar: {clientName, serviceId, employeeId, date, time}
- cancelar: {appointmentId}
- mover: {appointmentId, newDate, newTime}
- concluir: {appointmentId}
- criar_cliente: {name, phone?}
- trocar_cliente: {appointmentId, newClientName}

IMPORTANTE:
- Use o nome EXATO do cliente como aparece nos dados.
- Se houver múltiplos clientes com o mesmo nome, pergunte qual deles.
- Se cliente não existe no sistema, use criar_cliente antes de agendar.
- O sistema verifica conflito automaticamente, mas você deve respeitar os dados para sugerir horários.
- Não inclua bloco action se faltarem dados.`;
}

async function callLLM(
  systemPrompt: string,
  history: MensagemConversa[],
  userMessage: string,
  data: string,
): Promise<string> {
  const proxyToken = import.meta.env.VITE_GITHUB_MODELS_TOKEN as string | undefined;
  const groqToken = import.meta.env.VITE_GROQ_API_KEY as string | undefined;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "system", content: `=== DADOS DO SISTEMA ===\n${data}\n=== FIM DOS DADOS ===` },
    ...history,
    { role: "user", content: userMessage },
  ];

  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), 25_000);

  try {
    let response: Response;

    if (groqToken) {
      response = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          temperature: 0.2,
          max_tokens: 1200,
        }),
        signal: ctrl.signal,
      });
    } else {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (proxyToken) headers["x-github-token"] = proxyToken;

      response = await fetch(proxyToken ? LLM_PROXY : GITHUB_LLM_ENDPOINT, {
        method: "POST",
        headers: proxyToken
          ? headers
          : {
              ...headers,
              Authorization: `Bearer ${proxyToken ?? ""}`,
            },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages,
          temperature: 0.2,
          max_tokens: 1200,
        }),
        signal: ctrl.signal,
      });
    }

    clearTimeout(tmr);

    if (!response.ok) {
      if (response.status === 401) throw new Error("Token inválido da IA.");
      if (response.status === 429) throw new Error("Limite de requisições atingido. Aguarde alguns segundos.");
      throw new Error(`Erro ${response.status}`);
    }

    const json = await response.json();
    return json?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    clearTimeout(tmr);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timeout — tente novamente.");
    }
    throw err;
  }
}

async function findClientByName(paramClientName: string | null): Promise<Awaited<ReturnType<typeof clientsStore.ensureLoaded>>[number] | null> {
  if (!paramClientName) return null;

  const allClients = await clientsStore.ensureLoaded();
  const nameLower = paramClientName.toLowerCase().trim();

  let client = allClients.find((c) => c.name.toLowerCase() === nameLower) ?? null;

  if (!client) {
    client =
      allClients.find((c) => {
        const cn = c.name.toLowerCase();
        return cn.includes(nameLower) || nameLower.includes(cn);
      }) ?? null;
  }

  if (!client) {
    const firstName = nameLower.split(" ")[0];
    if (firstName.length > 2) {
      const matches = allClients.filter((c) => c.name.toLowerCase().includes(firstName));
      if (matches.length === 1) {
        client = matches[0];
      } else if (matches.length > 1) {
        return null;
      }
    }
  }

  if (!client) {
    try {
      const found = await clientsStore.search(paramClientName, { limit: 10 });
      if (found.length === 1) client = found[0];
    } catch {
      // ignore
    }
  }

  return client;
}

async function executeCreateClient(params: Record<string, unknown>): Promise<string> {
  const name = params.name ? String(params.name).trim() : null;
  if (!name) return "Nome do cliente é obrigatório para criar o cadastro.";

  const allClients = await clientsStore.ensureLoaded();
  const exists = allClients.find((client) => client.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    return `Cliente "${exists.name}" já existe no sistema (ID:${exists.id}). Use este cliente para agendar.`;
  }

  const phone = params.phone ? String(params.phone).trim() : null;
  const created = await clientsStore.create({
    name,
    phone: phone || null,
    email: null,
    birthDate: null,
    cpf: null,
    address: null,
    notes: null,
  });

  window.dispatchEvent(new Event("store_updated"));
  return `Cliente "${created.name}" criado com sucesso! ID:${created.id}. Agora pode agendar normalmente.`;
}

async function executeSwapClient(params: Record<string, unknown>): Promise<string> {
  const appointmentId = Number(params.appointmentId);
  const newClientName = params.newClientName ? String(params.newClientName).trim() : null;
  if (!newClientName) return "Nome do novo cliente é obrigatório.";

  const appointment = appointmentsStore.list({}).find((item) => item.id === appointmentId);
  if (!appointment) return `Agendamento ID:${appointmentId} não encontrado.`;

  const allClients = await clientsStore.ensureLoaded();
  const lower = newClientName.toLowerCase();
  let client = allClients.find((c) => c.name.toLowerCase() === lower) ?? null;

  if (!client) {
    client =
      allClients.find((c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())) ?? null;
  }

  if (!client) {
    try {
      const found = await clientsStore.search(newClientName, { limit: 5 });
      if (found.length === 1) {
        client = found[0];
      } else if (found.length > 1) {
        const names = found.slice(0, 5).map((c) => `${c.name} (ID:${c.id})`).join(", ");
        return `Encontrei vários clientes com "${newClientName}": ${names}. Qual deles?`;
      }
    } catch {
      // ignore
    }
  }

  if (!client) return `Cliente "${newClientName}" não encontrado. Verifique o cadastro.`;

  await appointmentsStore.update(appointmentId, {
    clientName: client.name,
    clientId: client.id,
  });
  window.dispatchEvent(new Event("store_updated"));
  return `Cliente trocado com sucesso!\nAgendamento ID:${appointmentId}\nNovo cliente: ${client.name}`;
}

async function executeCancel(params: Record<string, unknown>): Promise<string> {
  const appointmentId = Number(params.appointmentId);
  const appointment = appointmentsStore.list({}).find((item) => item.id === appointmentId);
  if (!appointment) return `Agendamento ID:${appointmentId} não encontrado.`;
  if (appointment.status === "cancelled") return `Agendamento ID:${appointmentId} já está cancelado.`;

  await appointmentsStore.update(appointmentId, { status: "cancelled" });
  window.dispatchEvent(new Event("store_updated"));
  return `Agendamento ID:${appointmentId} cancelado com sucesso.\nCliente: ${appointment.clientName}\nHorário: ${safeLocalTime(appointment.startTime)}`;
}

async function executeMove(params: Record<string, unknown>): Promise<string> {
  const appointmentId = Number(params.appointmentId);
  const appointment = appointmentsStore.list({}).find((item) => item.id === appointmentId);
  if (!appointment) return `Agendamento ID:${appointmentId} não encontrado.`;

  const resolvedDate = resolveDate(String(params.newDate ?? ""));
  const resolvedTime = normalizeTime(String(params.newTime ?? ""));
  if (!resolvedTime) return `Horário inválido: "${params.newTime}". Use HH:MM.`;

  const durationMs = new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime();
  const [year, month, day] = resolvedDate.split("-").map(Number);
  const [hour, minute] = resolvedTime.split(":").map(Number);
  const newStartDt = new Date(year, month - 1, day, hour, minute, 0);
  const newStart = newStartDt.toISOString().slice(0, 19);
  const newEnd = new Date(newStartDt.getTime() + durationMs).toISOString().slice(0, 19);

  const employee = employeesStore.list(true).find((item) => item.id === appointment.employeeId);
  if (employee) {
    const whCheck = isWithinWorkingHours(employee, resolvedDate, resolvedTime);
    if (!whCheck.ok) return whCheck.message!;
  }

  const conflict = appointmentsStore.list({ date: resolvedDate }).find((item) => {
    if (item.id === appointment.id || item.employeeId !== appointment.employeeId || item.status === "cancelled") return false;
    const start = new Date(item.startTime).getTime();
    const end = new Date(item.endTime).getTime();
    const reqStart = new Date(newStart).getTime();
    const reqEnd = new Date(newEnd).getTime();
    return reqStart < end && reqEnd > start;
  });

  if (conflict && !params.forceConflict) {
    savePendingAction({ type: "mover", params: { ...params, forceConflict: true } }, "conflict");
    return `CONFLITO:${employee?.name ?? "Profissional"} já tem agendamento das ${safeLocalTime(conflict.startTime)} às ${safeLocalTime(conflict.endTime)} (${conflict.clientName ?? "cliente"}). Para forçar, confirme explicitamente.`;
  }

  await appointmentsStore.update(appointment.id, { startTime: newStart, endTime: newEnd });
  window.dispatchEvent(new Event("store_updated"));
  return `Agendamento movido com sucesso!\nCliente: ${appointment.clientName}\nNovo horário: ${resolvedDate} às ${resolvedTime}`;
}

async function executeComplete(params: Record<string, unknown>): Promise<string> {
  const appointmentId = Number(params.appointmentId);
  const appointment = appointmentsStore.list({}).find((item) => item.id === appointmentId);
  if (!appointment) return `Agendamento ID:${appointmentId} não encontrado.`;

  await appointmentsStore.update(appointmentId, { status: "completed" });
  window.dispatchEvent(new Event("store_updated"));
  return `Agendamento ID:${appointmentId} concluído!\nCliente: ${appointment.clientName}`;
}

async function executeSchedule(params: Record<string, unknown>): Promise<{ text: string; appointment?: Appointment }> {
  const serviceId = params.serviceId != null ? Number(params.serviceId) : null;
  const employeeId = params.employeeId != null ? Number(params.employeeId) : null;
  const date = String(params.date ?? "hoje");
  const time = String(params.time ?? "");
  const paramClientName = params.clientName ? String(params.clientName) : null;

  const resolvedDate = resolveDate(date);
  const resolvedTime = normalizeTime(time);
  if (!resolvedTime) {
    return { text: `Horário inválido: "${time}". Use formato HH:MM.` };
  }

  const allClients = await clientsStore.ensureLoaded();
  let client = await findClientByName(paramClientName);

  if (!client && paramClientName) {
    const firstName = paramClientName.toLowerCase().trim().split(" ")[0];
    const matches = allClients.filter((c) => c.name.toLowerCase().includes(firstName));
    if (matches.length > 1) {
      const names = matches.slice(0, 5).map((c) => `${c.name} (ID:${c.id})`).join(", ");
      return { text: `Encontrei vários clientes com "${paramClientName}": ${names}. Qual deles?` };
    }
  }

  if (!client) {
    return { text: `Cliente "${paramClientName ?? "desconhecido"}" não encontrado no sistema. Verifique o cadastro.` };
  }

  const service = serviceId ? servicesStore.list(true).find((item) => item.id === serviceId) ?? null : null;
  if (!service) {
    const services = servicesStore.list(true);
    if (services.length === 0) return { text: "Nenhum serviço cadastrado no sistema." };
    return {
      text: `Serviço ID:${serviceId} não encontrado. Disponíveis: ${services.map((item) => `${item.name} (ID:${item.id})`).join(", ")}`,
    };
  }

  const employees = employeesStore.list(true);
  if (employees.length === 0) return { text: "Nenhum profissional ativo no sistema." };

  let employee: Employee | null = employeeId ? employees.find((item) => item.id === employeeId) ?? null : null;
  if (!employee && employees.length === 1) employee = employees[0];
  if (!employee) {
    savePendingAction(
      { type: "agendar", params: { ...params, clientName: client.name } },
      "professional",
    );
    return {
      text: `AGUARDANDO_PROFISSIONAL:${employees.map((item) => `${item.name} (ID:${item.id})`).join(", ")}`,
    };
  }

  const workingHoursCheck = isWithinWorkingHours(employee, resolvedDate, resolvedTime);
  if (!workingHoursCheck.ok) return { text: workingHoursCheck.message! };

  const durationMinutes = service.durationMinutes > 0 ? service.durationMinutes : 60;
  const [year, month, day] = resolvedDate.split("-").map(Number);
  const [hour, minute] = resolvedTime.split(":").map(Number);
  const startDt = new Date(year, month - 1, day, hour, minute, 0);
  const endDt = new Date(startDt.getTime() + durationMinutes * 60_000);
  const startTime = startDt.toISOString().slice(0, 19);
  const endTime = endDt.toISOString().slice(0, 19);

  const conflict = appointmentsStore.list({ date: resolvedDate }).find((item) => {
    if (item.employeeId !== employee!.id || item.status === "cancelled") return false;
    const start = new Date(item.startTime).getTime();
    const end = new Date(item.endTime).getTime();
    const reqStart = new Date(startTime).getTime();
    const reqEnd = new Date(endTime).getTime();
    return reqStart < end && reqEnd > start;
  });

  if (conflict && !params.forceConflict) {
    savePendingAction(
      { type: "agendar", params: { ...params, clientName: client.name, forceConflict: true } },
      "conflict",
    );
    return {
      text: `CONFLITO:${employee.name} já tem agendamento das ${safeLocalTime(conflict.startTime)} às ${safeLocalTime(conflict.endTime)} (${conflict.clientName ?? "cliente"}). Para forçar mesmo assim, confirme explicitamente.`,
    };
  }

  const serviceData: AppointmentService = {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes ?? 60,
    color: service.color ?? "#ec4899",
    materialCostPercent: service.materialCostPercent ?? 0,
  };

  const created = await appointmentsStore.create({
    clientName: client.name,
    clientId: client.id,
    employeeId: employee.id,
    startTime,
    endTime,
    status: "scheduled",
    totalPrice: service.price,
    notes: null,
    paymentStatus: null,
    groupId: null,
    services: [serviceData],
  });

  window.dispatchEvent(new Event("store_updated"));
  return {
    text: [
      "Agendamento criado com sucesso!",
      `ID: ${created.id}`,
      `Cliente: ${client.name}`,
      `Serviço: ${service.name} (${durationMinutes}min)`,
      `Data: ${resolvedDate} às ${resolvedTime}`,
      `Profissional: ${employee.name}`,
    ].join("\n"),
    appointment: created,
  };
}

async function executeAction(action: ActionPayload): Promise<{ text: string; appointment?: Appointment }> {
  try {
    if (action.type === "agendar") return executeSchedule(action.params);
    if (action.type === "cancelar") return { text: await executeCancel(action.params) };
    if (action.type === "mover") return { text: await executeMove(action.params) };
    if (action.type === "concluir") return { text: await executeComplete(action.params) };
    if (action.type === "criar_cliente") return { text: await executeCreateClient(action.params) };
    if (action.type === "trocar_cliente") return { text: await executeSwapClient(action.params) };
    return { text: `Ação desconhecida: "${action.type}".` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Erro ao executar "${action.type}": ${message}` };
  }
}

function isLikelyActionRequest(text: string): boolean {
  return /\b(agendar|marcar|agenda|cancelar|desmarcar|reagendar|mover|remarcar|concluir|finalizar)\b/i.test(text);
}

function claimsActionSuccess(text: string): boolean {
  return /\b(agendei|agendado com sucesso|marquei|cancelei|cancelado com sucesso|movi|reagendei|conclui|concluido com sucesso|concluído com sucesso|feito|realizando o agendamento|vou agendar|agendamento realizado|efetuando|executando|processando o agendamento)\b/i.test(
    text,
  );
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").trim();
}

function extractActionFromResponse(raw: string): ActionPayload | null {
  const match = raw.match(/```action\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as ActionPayload;
  } catch {
    return null;
  }
}

async function forceExtractAction(
  userMessage: string,
  history: MensagemConversa[],
  systemData: string,
): Promise<ActionPayload | null> {
  const recentMsgs = history.slice(-6).map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content}`).join("\n");

  const raw = await callLLM(
    `Você é um extrator de JSON para operações de salão de beleza.
Analise o histórico da conversa e os dados do sistema.
Responda APENAS com JSON puro, sem markdown, sem explicação.
Formato: {"type":"agendar","params":{...}}
Se não houver dados suficientes, responda apenas {}.`,
    [],
    `=== HISTÓRICO RECENTE ===\n${recentMsgs}\n\n=== MENSAGEM ATUAL ===\n${userMessage}\n\n=== DADOS DO SISTEMA ===\n${systemData}`,
    "",
  );

  const cleaned = stripCodeBlocks(raw);
  if (!cleaned || cleaned === "{}") return null;

  try {
    const parsed = JSON.parse(cleaned) as ActionPayload;
    if (!parsed.type || !parsed.params) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function handlePendingAction(pending: PendingAction, userMessage: string): Promise<ResultadoAgente | null> {
  if (pending.type === "conflict") {
    if (/forç|forcar|força|mesmo\s*assim|pode|sim|confirma|confirmar|ok|claro|vai|manda|force|agendar/i.test(userMessage)) {
      clearPendingAction();
      addToHistory("user", userMessage);
      const result = await executeAction(pending.action);
      const text = result.text;
      addToHistory("assistant", text);
      return {
        texto: text,
        agendamentoCriado: result.appointment,
      };
    }

    if (/nao|não|cancela|deixa|esquece|outro|nada/i.test(userMessage)) {
      clearPendingAction();
      addToHistory("user", userMessage);
      const text = "Ok, agendamento não realizado. Como posso ajudar?";
      addToHistory("assistant", text);
      return { texto: text };
    }

    clearPendingAction();
    return null;
  }

  if (pending.type === "professional") {
    const employees = employeesStore.list(true);
    const lower = userMessage.toLowerCase();
    const employee =
      employees.find(
        (item) =>
          item.name.toLowerCase() === lower ||
          item.name.toLowerCase().includes(lower) ||
          lower.includes(item.name.toLowerCase()),
      ) ?? null;

    if (employee) {
      clearPendingAction();
      addToHistory("user", userMessage);
      const updatedAction: ActionPayload = {
        ...pending.action,
        params: { ...pending.action.params, employeeId: employee.id },
      };
      const result = await executeAction(updatedAction);
      let text = result.text;

      if (text.startsWith("CONFLITO:")) {
        text = `Conflito de horário: ${text.replace("CONFLITO:", "")}\nDeseja agendar mesmo assim? Responda \"sim\" para confirmar.`;
      } else if (text.startsWith("AGUARDANDO_PROFISSIONAL:")) {
        text = `Com qual profissional deseja agendar? Disponíveis: ${text.replace("AGUARDANDO_PROFISSIONAL:", "")}`;
      }

      addToHistory("assistant", text);
      return {
        texto: text,
        agendamentoCriado: result.appointment,
      };
    }

    clearPendingAction();
    return null;
  }

  return null;
}



function loadDraft(): null {
  return null;
}

function handleFeedbackMessage(_message: string, _draft: null): ResultadoAgente | null {
  return null;
}

function handlePendingLearningAnswer(_message: string): ResultadoAgente | null {
  return null;
}
export function addFeedback(userMessage: string, agentResponse: string, rating: "good" | "bad"): void {
  try {
    const raw = getStorage()?.getItem(FEEDBACK_KEY);
    const current = raw ? (JSON.parse(raw) as FeedbackItem[]) : [];
    const next: FeedbackItem[] = [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        rating,
        userMessage,
        agentResponse,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 200);
    getStorage()?.setItem(FEEDBACK_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export async function executarAgente(
  mensagemUsuario: string,
  _historicoConversa: MensagemConversa[] = [],
): Promise<ResultadoAgente> {
  try {
    const msgTrimmed = mensagemUsuario.trim();
    if (!msgTrimmed) return { texto: "Envie uma mensagem." };

    await ensureBaseLoaded();

    const pendingFeedback = handleFeedbackMessage(msgTrimmed, loadDraft());
    if (pendingFeedback) return pendingFeedback;

    const pendingLearning = handlePendingLearningAnswer(msgTrimmed);
    if (pendingLearning) return pendingLearning;

    const pending = loadPendingAction();
    if (pending) {
      const pendingResult = await handlePendingAction(pending, msgTrimmed);
      if (pendingResult) return pendingResult;
    }

    addToHistory("user", msgTrimmed);
    const history = loadHistory().slice(0, -1);

    const systemData = await gatherData(msgTrimmed, history);
    const raw = await callLLM(buildSystemPrompt(), history, msgTrimmed, systemData);

    let text = raw;
    let agendamentoCriado: Appointment | undefined;

    let action = extractActionFromResponse(raw);
    if (!action && isLikelyActionRequest(msgTrimmed) && claimsActionSuccess(raw)) {
      try {
        action = await forceExtractAction(msgTrimmed, history, systemData);
      } catch {
        action = null;
      }
    }

    if (action) {
      const result = await executeAction(action);
      text = result.text;
      agendamentoCriado = result.appointment;

      if (text.startsWith("AGUARDANDO_PROFISSIONAL:")) {
        text = `Com qual profissional deseja agendar? Disponíveis: ${text.replace("AGUARDANDO_PROFISSIONAL:", "")}`;
      } else if (text.startsWith("CONFLITO:")) {
        text = `Conflito de horário: ${text.replace("CONFLITO:", "")}\nDeseja agendar mesmo assim? Responda \"sim\" ou \"forçar\" para confirmar.`;
      }
    } else if (isLikelyActionRequest(msgTrimmed)) {
      text = stripCodeBlocks(raw) || "Não consegui gerar a ação. Pode repetir o pedido?";
    } else {
      text = stripCodeBlocks(raw) || raw;
    }

    addToHistory("assistant", text);
    return {
      texto: text,
      agendamentoCriado,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      texto: `Erro ao processar a mensagem: ${message}`,
      erro: message,
    };
  }
}
