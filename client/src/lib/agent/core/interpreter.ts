import type { AgentInterpretation, AgentIntent } from "../types";

const TZ = "America/Sao_Paulo";
const WEEKDAY_SHORT: Record<string, number> = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1, "segunda-feira": 1,
  ter: 2, terca: 2, terça: 2, "terca-feira": 2, "terça-feira": 2,
  qua: 3, quarta: 3, "quarta-feira": 3,
  qui: 4, quinta: 4, "quinta-feira": 4,
  sex: 5, sexta: 5, "sexta-feira": 5,
  sab: 6, sabado: 6, sábado: 6,
};

export const YES = /^(sim|s|ok|confirmo|confirmar|pode|isso|isso mesmo|pode confirmar|confirmado)[.! ]*$/i;
export const NO = /^(nao|não|cancelar|cancela|deixa|deixa pra la|deixa pra lá|negativo)[.! ]*$/i;

export function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return new Date(`${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`);
}

export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function formatDateLong(dateStr: string): string {
  return parseYMD(dateStr).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: TZ,
  });
}

export function extractTime(raw: string): string | undefined {
  const m = raw.match(/\b(\d{1,2})(?::|h)?(\d{2})?\b/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function resolveDateFromText(raw: string, allowPast = false): string | undefined {
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

export function isPastDate(dateStr: string): boolean {
  return dateStr < ymd(getLocalNow());
}

export function extractLikelyClientTerm(msg: string): string | undefined {
  const raw = msg.trim();
  const after = raw.match(/(?:cliente|pra|para|da|do)\s+([A-ZÀ-Ú][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ú][\wÀ-ÿ'’-]+){0,3})/);
  if (after?.[1]) return after[1].trim();

  const capitals = raw.match(/\b([A-ZÀ-Ú][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ú][\wÀ-ÿ'’-]+){0,3})\b/g);
  if (capitals?.length) return capitals[0].trim();
  return undefined;
}

export function detectIntent(msg: string): AgentIntent {
  const n = normalizar(msg);
  if (/(remarcar|remarca|reagendar|reagenda|mover horario|mudar horario)/.test(n)) return "reschedule";
  if (/(cancelar agendamento|cancelar horario|desmarcar|cancela a agenda|cancelar a agenda)/.test(n)) return "cancel";
  if (/(cadastrar cliente|criar cliente|novo cliente|cadastro de cliente)/.test(n)) return "create_client";
  if (/(quais agendamentos|agenda de hoje|agenda de amanha|agenda de amanhã|como esta a agenda|como está a agenda|listar agenda|lista da agenda|agendamentos de hoje|agendamentos de amanha|agendamentos de amanhã)/.test(n)) return "query_schedule";
  if (/(livres|disponiveis|disponíveis|equipe livre|funcionarios livres|funcionários livres)/.test(n)) return "query_available";
  if (/(faturamento|caixa|receita|entrou|financeiro)/.test(n)) return "query_finance";
  if (/(buscar cliente|telefone do cliente|cpf do cliente|email do cliente|dados do cliente)/.test(n)) return "query_client";
  if (/(agendar|novo agendamento|marcar horario|marcar horário|marcar|agenda|encaixar|encaixe)/.test(n)) return "schedule";
  return "unknown";
}

export function interpretMessage(msg: string): AgentInterpretation {
  const normalized = normalizar(msg);
  return {
    intent: detectIntent(msg),
    raw: msg,
    normalized,
    date: resolveDateFromText(msg, false),
    time: extractTime(msg),
    clientHint: extractLikelyClientTerm(msg),
    explicitCreateClient: /(cadastrar cliente|criar cliente|pode cadastrar|cadastre o cliente)/.test(normalized),
  };
}
