/**
 * agentMemory.ts — Sistema de aprendizado do Agente IA
 *
 * 4 mecanismos:
 *  1. Memória de preferências  — padrões automáticos por cliente/profissional/horário
 *  2. Regras explícitas        — o usuário ensina o agente com linguagem natural
 *  3. Padrões por histórico    — inferidos dos agendamentos reais do banco
 *  4. Feedback explícito       — 👍/👎 nas respostas, molda comportamento futuro
 */

import { appointmentsStore, clientsStore, servicesStore, employeesStore } from "./store";

// ─── Tipos ────────────────────────────────────────────────

export interface ExplicitRule {
  id: string;
  raw: string;       // texto original do usuário
  created: number;
}

export interface FeedbackEntry {
  id: string;
  userMessage: string;
  agentResponse: string;
  rating: "good" | "bad";
  created: number;
}

export interface ClientPreference {
  clientId: number;
  clientName: string;
  favoriteServiceId?: number;
  favoriteServiceName?: string;
  favoriteEmployeeId?: number;
  favoriteEmployeeName?: string;
  favoriteHour?: string;   // "09:00"
  visitCount: number;
  lastVisit?: string;      // "2026-03-30"
}

// ─── Chaves localStorage ──────────────────────────────────

const RULES_KEY     = "agent_explicit_rules";
const FEEDBACK_KEY  = "agent_feedback";
const PREFS_KEY     = "agent_client_prefs";

// ─── 1. Memória de preferências (automática) ──────────────

/** Recalcula preferências a partir dos agendamentos reais. Chamado sob demanda. */
export function computeClientPreferences(): ClientPreference[] {
  const appts = appointmentsStore.list({});
  const clients = clientsStore.list();
  const emps = employeesStore.list(true);

  const map: Record<number, {
    counts: { svcId: number; empId: number; hour: string }[];
  }> = {};

  for (const a of appts) {
    if (!a.clientId || a.status === "cancelled") continue;
    const hour = a.startTime?.split("T")[1]?.slice(0, 5) ?? "";
    const svcId = a.services?.[0]?.serviceId ?? 0;
    if (!map[a.clientId]) map[a.clientId] = { counts: [] };
    map[a.clientId].counts.push({ svcId, empId: a.employeeId, hour });
  }

  const prefs: ClientPreference[] = [];

  for (const [clientIdStr, data] of Object.entries(map)) {
    const clientId = Number(clientIdStr);
    const client = clients.find(c => c.id === clientId);
    if (!client) continue;

    const { counts } = data;

    // Serviço mais frequente
    const svcFreq: Record<number, number> = {};
    for (const c of counts) svcFreq[c.svcId] = (svcFreq[c.svcId] ?? 0) + 1;
    const topSvcId = Object.entries(svcFreq).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Profissional mais frequente
    const empFreq: Record<number, number> = {};
    for (const c of counts) empFreq[c.empId] = (empFreq[c.empId] ?? 0) + 1;
    const topEmpId = Object.entries(empFreq).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Horário mais frequente (arredondado para hora cheia)
    const hourFreq: Record<string, number> = {};
    for (const c of counts) {
      const h = c.hour.split(":")[0] + ":00";
      hourFreq[h] = (hourFreq[h] ?? 0) + 1;
    }
    const topHour = Object.entries(hourFreq).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Última visita
    const clientAppts = appts
      .filter(a => a.clientId === clientId && a.status !== "cancelled")
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
    const lastVisit = clientAppts[0]?.startTime?.split("T")[0];

    const svc = topSvcId ? servicesStore.list(true).find(s => s.id === Number(topSvcId)) : undefined;
    const emp = topEmpId ? emps.find(e => e.id === Number(topEmpId)) : undefined;

    prefs.push({
      clientId,
      clientName: client.name,
      favoriteServiceId: svc?.id,
      favoriteServiceName: svc?.name,
      favoriteEmployeeId: emp?.id,
      favoriteEmployeeName: emp?.name,
      favoriteHour: topHour,
      visitCount: counts.length,
      lastVisit,
    });
  }

  // Salvar no localStorage para acesso rápido
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  return prefs;
}

export function loadClientPreferences(): ClientPreference[] {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Retorna preferências formatadas para injetar no system prompt */
export function getPreferencesPrompt(): string {
  const prefs = loadClientPreferences().filter(p => p.visitCount >= 2);
  if (prefs.length === 0) return "";

  // Limitar aos 20 clientes mais frequentes
  const top = prefs.sort((a, b) => b.visitCount - a.visitCount).slice(0, 20);

  const lines = top.map(p => {
    const parts: string[] = [`${p.clientName} (${p.visitCount}x)`];
    if (p.favoriteServiceName) parts.push(`serviço preferido: ${p.favoriteServiceName}`);
    if (p.favoriteEmployeeName) parts.push(`profissional preferido: ${p.favoriteEmployeeName}`);
    if (p.favoriteHour) parts.push(`horário preferido: ${p.favoriteHour}`);
    if (p.lastVisit) parts.push(`última visita: ${p.lastVisit}`);
    return `  - ${parts.join(" | ")}`;
  });

  return `Preferências aprendidas de clientes frequentes:\n${lines.join("\n")}`;
}

// ─── 2. Regras explícitas ─────────────────────────────────

export function loadRules(): ExplicitRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRules(rules: ExplicitRule[]) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules.slice(-50))); } catch {}
}

export function addRule(raw: string): ExplicitRule {
  const rules = loadRules();
  const rule: ExplicitRule = { id: `r_${Date.now()}`, raw: raw.trim(), created: Date.now() };
  rules.push(rule);
  saveRules(rules);
  return rule;
}

export function removeRule(id: string) {
  saveRules(loadRules().filter(r => r.id !== id));
}

/** Detecta se a mensagem do usuário é um comando de ensino */
export function detectTeachingIntent(msg: string): string | null {
  const m = msg.trim();
  const patterns = [
    /^lembra(?:r)?(?:-se)?\s+que\s+(.+)/i,
    /^quando\s+eu\s+disser?\s+.+,?\s+(?:é|e|significa?|quer dizer)\s+(.+)/i,
    /^sempre\s+que\s+(.+)/i,
    /^regra[:\s]+(.+)/i,
    /^aprende?\s+(?:isso|que)\s*:?\s*(.+)/i,
    /^anota\s+(?:isso|que)\s*:?\s*(.+)/i,
    /^salva?\s+(?:isso|que|a regra)\s*:?\s*(.+)/i,
  ];
  for (const p of patterns) {
    const match = m.match(p);
    if (match) return m; // retorna a frase completa para salvar
  }
  return null;
}

/** Retorna regras formatadas para o system prompt */
export function getRulesPrompt(): string {
  const rules = loadRules();
  if (rules.length === 0) return "";
  return `Regras ensinadas pelo usuário (seguir sempre):\n${rules.map(r => `  - ${r.raw}`).join("\n")}`;
}

// ─── 3. Padrões por histórico ─────────────────────────────

/** Gera insights do histórico para injetar no prompt */
export function getHistoryInsightsPrompt(): string {
  const appts = appointmentsStore.list({});
  if (appts.length < 5) return "";

  const insights: string[] = [];

  // Horário de pico
  const hourCount: Record<string, number> = {};
  for (const a of appts) {
    if (a.status === "cancelled") continue;
    const h = a.startTime?.split("T")[1]?.slice(0, 2);
    if (h) hourCount[h] = (hourCount[h] ?? 0) + 1;
  }
  const peakHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0];
  if (peakHour) insights.push(`Horário de maior movimento: ${peakHour[0]}h`);

  // Dia da semana mais movimentado
  const dayCount: Record<string, number> = {};
  const dayNames = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  for (const a of appts) {
    if (a.status === "cancelled") continue;
    const d = new Date(a.startTime).getDay();
    const name = dayNames[d];
    dayCount[name] = (dayCount[name] ?? 0) + 1;
  }
  const peakDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
  if (peakDay) insights.push(`Dia mais movimentado: ${peakDay[0]}`);

  // Serviço mais agendado
  const svcCount: Record<string, number> = {};
  for (const a of appts) {
    if (a.status === "cancelled") continue;
    for (const s of (a.services ?? [])) {
      svcCount[s.name] = (svcCount[s.name] ?? 0) + 1;
    }
  }
  const topSvc = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0];
  if (topSvc) insights.push(`Serviço mais agendado: ${topSvc[0]} (${topSvc[1]}x)`);

  // Taxa de cancelamento
  const total = appts.length;
  const cancelled = appts.filter(a => a.status === "cancelled").length;
  if (total > 10) {
    const rate = Math.round((cancelled / total) * 100);
    if (rate > 10) insights.push(`Taxa de cancelamento: ${rate}% (atenção)`);
  }

  if (insights.length === 0) return "";
  return `Padrões aprendidos do histórico:\n${insights.map(i => `  - ${i}`).join("\n")}`;
}

// ─── 4. Feedback explícito ────────────────────────────────

export function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFeedback(entries: FeedbackEntry[]) {
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries.slice(-100))); } catch {}
}

export function addFeedback(userMessage: string, agentResponse: string, rating: "good" | "bad"): void {
  const entries = loadFeedback();
  entries.push({
    id: `f_${Date.now()}`,
    userMessage,
    agentResponse,
    rating,
    created: Date.now(),
  });
  saveFeedback(entries);
}

/** Retorna exemplos de feedback ruim para o prompt (o agente evita repetir) */
export function getFeedbackPrompt(): string {
  const entries = loadFeedback();
  const bad = entries.filter(e => e.rating === "bad").slice(-10);
  if (bad.length === 0) return "";

  const lines = bad.map(e =>
    `  - Quando usuário disse "${e.userMessage.slice(0, 60)}", esta resposta foi ruim: "${e.agentResponse.slice(0, 80)}..."`
  );
  return `Respostas anteriores mal avaliadas pelo usuário (evitar padrões similares):\n${lines.join("\n")}`;
}

// ─── Prompt completo de memória ───────────────────────────

/** Monta todo o bloco de memória para injetar no system prompt */
export function buildMemoryPrompt(): string {
  const parts: string[] = [];

  const prefs = getPreferencesPrompt();
  if (prefs) parts.push(prefs);

  const rules = getRulesPrompt();
  if (rules) parts.push(rules);

  const history = getHistoryInsightsPrompt();
  if (history) parts.push(history);

  const feedback = getFeedbackPrompt();
  if (feedback) parts.push(feedback);

  if (parts.length === 0) return "";
  return `\n=== MEMÓRIA DO AGENTE ===\n${parts.join("\n\n")}\n=== FIM DA MEMÓRIA ===`;
}

/** Atualiza preferências em background (chamar após cada agendamento criado) */
export function refreshPreferences() {
  try { computeClientPreferences(); } catch {}
}
