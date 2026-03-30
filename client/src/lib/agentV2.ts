/**
 * agentV2.ts - Agente IA v2 para Dominio Pro
 * Arquitetura LLM-First: o modelo decide tudo com dados reais do sistema.
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
  messageId?: string;        // para vincular feedback 👍/👎
  userMessage?: string;      // para vincular feedback
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
}

// ─── Dados do sistema ─────────────────────────────────────

function getTodayData(): string {
  const today = new Date().toISOString().split("T")[0];
  const appts = appointmentsStore.list({ date: today });
  const emps = employeesStore.list(true);
  if (appts.length === 0) return `Hoje (${today}): nenhum agendamento.`;
  const lines = appts.map((a: any) => {
    const emp = emps.find((e: any) => e.id === a.employeeId);
    const hora = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  - ${hora} | ${a.clientName} | ${svcs} | Prof: ${emp?.name ?? "?"} | ${a.status} | ID:${a.id}`;
  });
  return `Agendamentos hoje (${today}):\n${lines.join("\n")}`;
}

function getClientData(query: string): string {
  const q = query.toLowerCase().trim();
  const all = clientsStore.list();
  if (!q) return `Total clientes: ${all.length}`;
  const found = all.filter((c: any) =>
    c.name?.toLowerCase().includes(q) || c.phone?.includes(q)
  ).slice(0, 10);
  if (found.length === 0) {
    const parts = q.split(" ").filter((p: string) => p.length > 2);
    const fuzzy = all.filter((c: any) =>
      parts.some((p: string) => c.name?.toLowerCase().includes(p))
    ).slice(0, 5);
    if (fuzzy.length > 0) {
      return `Nao encontrado exato. Similares:\n${fuzzy.map((c: any) => `  - ID:${c.id} ${c.name} | ${c.phone ?? "-"}`).join("\n")}`;
    }
    return `Nenhum cliente com "${query}".`;
  }
  return `Clientes:\n${found.map((c: any) => `  - ID:${c.id} ${c.name} | ${c.phone ?? "-"}`).join("\n")}`;
}

function getServicesData(): string {
  const svcs = servicesStore.list(true);
  if (svcs.length === 0) return "Nenhum servico.";
  return `Servicos:\n${svcs.map((s: any) => `  - ID:${s.id} ${s.name} | R$${s.price?.toFixed(2)} | ${s.durationMinutes}min`).join("\n")}`;
}

function getEmployeesData(): string {
  const emps = employeesStore.list(true);
  if (emps.length === 0) return "Nenhum profissional ativo.";
  return `Profissionais:\n${emps.map((e: any) => `  - ID:${e.id} ${e.name}`).join("\n")}`;
}

function getApptsByDate(dateStr: string): string {
  const today = new Date();
  let date = dateStr;
  if (dateStr === "hoje") date = today.toISOString().split("T")[0];
  else if (dateStr === "amanha") {
    const d = new Date(today); d.setDate(today.getDate() + 1);
    date = d.toISOString().split("T")[0];
  } else if (/^\d{1,2}\/\d{1,2}/.test(dateStr)) {
    const [dd, mm, yy] = dateStr.split("/");
    date = `${yy ?? today.getFullYear()}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  } else if (/^\d{1,2}$/.test(dateStr)) {
    date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${dateStr.padStart(2,"0")}`;
  }
  const appts = appointmentsStore.list({ date });
  const emps = employeesStore.list(true);
  if (appts.length === 0) return `Nenhum agendamento em ${date}.`;
  return `Agendamentos ${date}:\n${appts.map((a: any) => {
    const emp = emps.find((e: any) => e.id === a.employeeId);
    const hora = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  - ${hora} | ${a.clientName} | ${svcs} | ${emp?.name ?? "?"} | ${a.status} | ID:${a.id}`;
  }).join("\n")}`;
}

// ─── Execucao de acoes ────────────────────────────────────

function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  let t = raw.toLowerCase().replace(/h/i, ":").replace(/\s+/g, "").trim();
  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2,"0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    return `${h.padStart(2,"0")}:${m}`;
  }
  return null;
}

function resolveDate(raw: string): string {
  const today = new Date();
  if (!raw || raw === "hoje") return today.toISOString().split("T")[0];
  if (raw === "amanha") {
    const d = new Date(today); d.setDate(today.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  if (/^\d{1,2}\/\d{1,2}/.test(raw)) {
    const [dd, mm, yy] = raw.split("/");
    return `${yy ?? today.getFullYear()}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }
  if (/^\d{1,2}$/.test(raw)) {
    return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${raw.padStart(2,"0")}`;
  }
  return raw;
}

async function executeAction(action: any): Promise<string> {
  const { type, params } = action;
  try {
    if (type === "agendar") {
      const { clientId, serviceId, employeeId, date, time } = params;
      const resolvedDate = resolveDate(date);
      const resolvedTime = normalizeTime(time);
      if (!resolvedTime) return `Horario invalido: "${time}". Use HH:MM.`;

      const allClients = clientsStore.list();
      // 1. Buscar pelo ID exato
      let client = allClients.find((c: any) => String(c.id) === String(clientId)) ?? null;
      // 2. Fallback por clientName exato
      if (!client && params.clientName) {
        const nameLower = params.clientName.toLowerCase().trim();
        client = allClients.find((c: any) => c.name.toLowerCase() === nameLower) ?? null;
      }
      // 3. Fallback por clientName parcial (nome contém ou é contido)
      if (!client && params.clientName) {
        const nameLower = params.clientName.toLowerCase().trim();
        client = allClients.find((c: any) => {
          const cn = c.name.toLowerCase();
          return cn.includes(nameLower) || nameLower.includes(cn);
        }) ?? null;
      }
      // 4. Fallback por primeiro nome
      if (!client && params.clientName) {
        const firstWord = params.clientName.toLowerCase().split(" ")[0];
        if (firstWord.length > 2) {
          const matches = allClients.filter((c: any) => c.name.toLowerCase().includes(firstWord));
          if (matches.length === 1) client = matches[0]; // só usar se único resultado
        }
      }
      if (!client) {
        const similar = allClients
          .filter((c: any) => params.clientName && c.name.toLowerCase().includes(params.clientName.toLowerCase().split(" ")[0]))
          .slice(0, 3)
          .map((c: any) => c.name)
          .join(", ");
        return `Cliente "${params.clientName ?? clientId}" nao encontrado.${similar ? ` Similares: ${similar}` : " Verifique o cadastro."}`;
      }

      const svc = servicesStore.list(true).find((s: any) => String(s.id) === String(serviceId));
      if (!svc) return `Servico ID:${serviceId} nao encontrado.`;

      const emps = employeesStore.list(true);
      if (emps.length === 0) return "Nenhum profissional disponivel.";
      // Tentar localizar pelo employeeId fornecido pelo LLM
      let emp = emps.find((e: any) => String(e.id) === String(employeeId)) ?? null;
      // Se nao achou e ha apenas um profissional, usar ele automaticamente
      if (!emp && emps.length === 1) emp = emps[0];
      // Se nao achou e ha mais de um, bloquear e pedir ao usuario
      if (!emp) {
        const lista = emps.map((e: any) => `${e.name} (ID:${e.id})`).join(", ");
        return `AGUARDANDO_PROFISSIONAL:${lista}`;
      }

      const startTime = `${resolvedDate}T${resolvedTime}:00`;
      // Usar durationMinutes do cadastro — ignorar qualquer valor que o LLM tenha calculado
      const durationMinutes = svc.durationMinutes && svc.durationMinutes > 0 ? svc.durationMinutes : 60;
      const durationMs = durationMinutes * 60_000;
      const endTime = new Date(new Date(startTime).getTime() + durationMs).toISOString().slice(0, 19);

      const conflict = appointmentsStore.list({ date: resolvedDate }).find((a: any) => {
        if (a.employeeId !== emp.id || a.status === "cancelled") return false;
        const aS = new Date(a.startTime).getTime(), aE = new Date(a.endTime).getTime();
        const rS = new Date(startTime).getTime(), rE = new Date(endTime).getTime();
        return rS < aE && rE > aS;
      });
      if (conflict && !params.forceConflict) {
        const conflictHour = conflict.startTime.split("T")[1]?.slice(0,5);
        return `CONFLITO:${emp.name} ja tem agendamento das ${conflictHour} (${conflict.clientName ?? "cliente"}). Para forçar mesmo assim, confirme explicitamente.`;
      }

      const created = await appointmentsStore.create({
        clientName: client.name, clientId: client.id, employeeId: emp.id,
        startTime, endTime, status: "scheduled", totalPrice: svc.price,
        notes: null, paymentStatus: null, groupId: null,
        services: [{ serviceId: svc.id, name: svc.name, price: svc.price, durationMinutes: svc.durationMinutes, employeeId: emp.id }],
      });
      if (!created || !created.id) {
        return `Erro ao criar agendamento no banco. Verifique se o cliente "${client.name}" esta cadastrado corretamente e tente novamente.`;
      }
      window.dispatchEvent(new Event("store_updated"));
      refreshPreferences(); // atualizar preferências aprendidas
      return `Agendamento criado! ID:${created.id}\nCliente: ${client.name}\nServico: ${svc.name}\nData: ${resolvedDate} as ${resolvedTime}\nProfissional: ${emp.name}`;
    }

    if (type === "cancelar") {
      await appointmentsStore.update(params.appointmentId, { status: "cancelled" });
      window.dispatchEvent(new Event("store_updated"));
      return `Agendamento ID:${params.appointmentId} cancelado.`;
    }

    if (type === "mover") {
      const appt = appointmentsStore.list({}).find((a: any) => String(a.id) === String(params.appointmentId));
      if (!appt) return `Agendamento ID:${params.appointmentId} nao encontrado.`;
      const resolvedDate = resolveDate(params.newDate);
      const resolvedTime = normalizeTime(params.newTime);
      if (!resolvedTime) return `Horario invalido: "${params.newTime}".`;
      const durMs = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
      const newStart = `${resolvedDate}T${resolvedTime}:00`;
      const newEnd = new Date(new Date(newStart).getTime() + durMs).toISOString().slice(0, 19);
      await appointmentsStore.update(appt.id, { startTime: newStart, endTime: newEnd });
      window.dispatchEvent(new Event("store_updated"));
      return `Agendamento movido para ${resolvedDate} as ${resolvedTime}.`;
    }

    if (type === "concluir") {
      await appointmentsStore.update(params.appointmentId, { status: "completed" });
      window.dispatchEvent(new Event("store_updated"));
      return `Agendamento ID:${params.appointmentId} concluido.`;
    }

    return `Acao desconhecida: "${type}".`;
  } catch (err) {
    return `Erro: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── System Prompt ────────────────────────────────────────

function buildSystemPrompt(config: AgentV2Config): string {
  const dateStr = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  });
  return `Voce e o Agente IA do ${config.salonName ?? "Dominio Pro"}.
Data atual: ${dateStr}
${config.businessContext ?? ""}

Voce gerencia agendamentos, clientes, servicos e profissionais.
Dados reais do sistema sao fornecidos em cada mensagem — use-os com precisao.

REGRAS:
1. Responda em portugues brasileiro, direto e natural
2. Voce TEM ACESSO COMPLETO a clientes, servicos, profissionais e agendamentos — os dados sao fornecidos em cada mensagem
3. Nunca diga que nao tem acesso a dados ou que o usuario precisa fornecer IDs — use os nomes para localizar os IDs nos dados
4. DISTINCAO CRITICA: a lista de "Profissionais" e a lista de "Clientes" sao SEPARADAS — um nome na lista de Profissionais NAO e um cliente, e vice-versa
5. Para agendar: o CLIENTE e quem recebe o servico (esta na lista de Clientes); o PROFISSIONAL e quem executa (esta na lista de Profissionais)
6. Quando o usuario mencionar um nome que esta na lista de Profissionais, trate como profissional — NAO busque esse nome na lista de Clientes
7. Se houver mais de um profissional e o usuario nao informou qual, SEMPRE pergunte antes de agendar
8. Se houver apenas um profissional, use-o automaticamente sem perguntar
9. Mantenha o contexto da conversa — se o cliente ja foi identificado em uma mensagem anterior, nao peca novamente
7. Para cancelar/mover: confirme antes de executar
8. Peca apenas o dado que falta — nunca peca o ID, voce mesmo descobre
9. Mantenha o contexto da conversa anterior

ACOES — inclua ao final da resposta quando necessario:
\`\`\`action
{"type":"agendar","params":{"clientId":123,"serviceId":45,"employeeId":2,"date":"2025-03-28","time":"14:00"}}
\`\`\`
Tipos: agendar | cancelar | mover | concluir
- agendar: {clientId, clientName, serviceId, employeeId, date, time}  ← incluir clientName sempre
- cancelar: {appointmentId}
- mover: {appointmentId, newDate, newTime}
- concluir: {appointmentId}${buildMemoryPrompt()}`;
}

// ─── Dados contextuais ────────────────────────────────────

function getAllClientsData(): string {
  const all = clientsStore.list();
  if (all.length === 0) return "Nenhum cliente cadastrado.";
  return `Total de clientes cadastrados: ${all.length}. Use busca por nome para localizar um cliente especifico.`;
}

/** Busca clientes por nome com fuzzy match — retorna até 10 resultados */
function searchClientsData(query: string): string {
  const all = clientsStore.list();
  if (all.length === 0) return "Nenhum cliente cadastrado.";
  const q = query.toLowerCase().trim();
  const parts = q.split(" ").filter((p: string) => p.length > 1);

  // Match exato primeiro
  let found = all.filter((c: any) => c.name.toLowerCase() === q);

  // Match parcial se nao achou exato
  if (found.length === 0) {
    found = all.filter((c: any) => {
      const cn = c.name.toLowerCase();
      return cn.includes(q) || q.includes(cn);
    });
  }

  // Match por partes do nome
  if (found.length === 0 && parts.length > 0) {
    found = all.filter((c: any) => {
      const cn = c.name.toLowerCase();
      return parts.some((p: string) => cn.includes(p));
    });
  }

  if (found.length === 0) {
    return `Nenhum cliente encontrado com "${query}". Total cadastrado: ${all.length}.`;
  }

  const results = found.slice(0, 10);
  return `Clientes encontrados para "${query}" (${found.length} resultado(s)):\n${results.map((c: any) => `  - ID:${c.id} | ${c.name}${c.phone ? ` | ${c.phone}` : ""}`).join("\n")}`;
}

function gatherData(msg: string): string {
  const q = msg.toLowerCase();
  const parts: string[] = [getTodayData(), getEmployeesData(), getServicesData()];

  // Extrair candidatos a nome de cliente da mensagem
  // (ignorar profissionais, stopwords e palavras de servico)
  const empsLower = new Set(employeesStore.list(true).flatMap((e: any) =>
    e.name.toLowerCase().split(" ")
  ));
  const stopWords = new Set([
    "quero","agendar","marcar","cliente","para","preciso","cancelar","mover",
    "agenda","hoje","amanha","hora","servico","horario","consegue","executar",
    "agendamento","voce","fazer","nome","tenho","qual","quais","corte","escova",
    "tintura","manicure","pedicure","barba","hidrata","progressiva","termica",
    "relaxamento","botox","coloracao","luzes","alisamento","massagem","unhas"
  ]);

  const words = msg.split(/\s+/).filter(w => w.length > 2 && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w));
  const candidateNames = words.filter(w => {
    const wl = w.toLowerCase();
    return !stopWords.has(wl) && !empsLower.has(wl);
  });

  if (candidateNames.length > 0) {
    // Buscar com o conjunto de palavras candidatas (ex: "bruna" ou "fernanda bruna")
    const searchTerm = candidateNames.join(" ");
    parts.push(searchClientsData(searchTerm));
  } else {
    // Sem nome detectado — apenas informar total
    parts.push(getAllClientsData());
  }

  const dateMatch = q.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i);
  if (dateMatch) parts.push(getApptsByDate(dateMatch[1]));

  return parts.join("\n\n");
}

// ─── API ──────────────────────────────────────────────────

const ENDPOINT = "https://models.github.ai/inference/chat/completions";

async function callLLM(system: string, history: AgentMessage[], userMsg: string, data: string, config: AgentV2Config): Promise<string> {
  if (!config.apiToken || config.apiToken === "proxy") throw new Error("Token nao configurado.");

  const messages = [
    { role: "system", content: system },
    { role: "system", content: `=== DADOS DO SISTEMA ===\n${data}\n=== FIM ===` },
    ...history,
    { role: "user", content: userMsg },
  ];

  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), 20_000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiToken}` },
      body: JSON.stringify({ model: config.model ?? "openai/gpt-4o-mini", messages, temperature: 0.3, max_tokens: 1000 }),
      signal: ctrl.signal,
    });
    clearTimeout(tmr);
    if (!res.ok) {
      if (res.status === 401) throw new Error("Token invalido. Verifique seu GitHub PAT em: github.com/settings/tokens");
      if (res.status === 429) throw new Error("Limite atingido. Aguarde alguns segundos.");
      throw new Error(`Erro ${res.status}`);
    }
    const data2 = await res.json();
    return data2?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    clearTimeout(tmr);
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("Timeout — tente novamente.");
    throw err;
  }
}

// ─── Exportacoes publicas ─────────────────────────────────

let cfg: AgentV2Config | null = null;

export function initAgentV2(config: AgentV2Config) { cfg = config; }

export async function handleMessageV2(userMessage: string): Promise<AgentV2Response> {
  if (!cfg) return { text: "Agente nao configurado." };
  if (!cfg.apiToken || cfg.apiToken === "proxy") return { text: "Configure seu GitHub Token para ativar o Agente IA." };

  // ── Detectar retomada de ação com conflito forçado ─────────
  const history_check = loadHistory();
  const lastAssistant = [...history_check].reverse().find(m => m.role === "assistant");
  if (lastAssistant?.content.startsWith("__PENDING_CONFLICT__") &&
      /forç|forcar|mesmo assim|pode|sim|confirma|ok/i.test(userMessage.trim())) {
    try {
      const pendingAct = JSON.parse(lastAssistant.content.replace("__PENDING_CONFLICT__", ""));
      addToHistory("user", userMessage);
      const forceResult = await executeAction(pendingAct);
      const forceText = forceResult.includes("criado") ? forceResult : `Não foi possível forçar: ${forceResult}`;
      addToHistory("assistant", forceText);
      const msgId2 = `m_${Date.now()}`;
      return { text: forceText, actionExecuted: forceResult.includes("criado"), navigateTo: forceResult.includes("criado") ? "/agenda" : undefined, messageId: msgId2, userMessage };
    } catch { /* continuar fluxo normal */ }
  }

  // ── Detectar comando de ensino (regra explícita) ──────────
  const teachIntent = detectTeachingIntent(userMessage);
  if (teachIntent) {
    const rule = addRule(teachIntent);
    const confirmation = `Entendido! Vou lembrar disso sempre:\n"${rule.raw}"`;
    addToHistory("user", userMessage);
    addToHistory("assistant", confirmation);
    return { text: confirmation };
  }

  addToHistory("user", userMessage);
  const history = loadHistory().slice(0, -1); // sem a msg atual
  const systemData = gatherData(userMessage);

  let raw: string;
  try {
    raw = await callLLM(buildSystemPrompt(cfg), history, userMessage, systemData, cfg);
  } catch (err) {
    return { text: `Erro: ${err instanceof Error ? err.message : "Tente novamente."}` };
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

      // Se executeAction pediu profissional, nao executar — pedir ao usuario
      if (result.startsWith("AGUARDANDO_PROFISSIONAL:")) {
        const lista = result.replace("AGUARDANDO_PROFISSIONAL:", "");
        text = raw.replace(/```action[\s\S]*?```/g, "").trim();
        const aviso = `Com qual profissional? Disponíveis: ${lista}`;
        text = text ? `${text}\n\n${aviso}` : aviso;
        addToHistory("assistant", `__PENDING_ACTION__${JSON.stringify(act)}`);
      } else if (result.startsWith("CONFLITO:")) {
        // Conflito detectado — não executar, avisar e aguardar confirmação explícita
        const detalhe = result.replace("CONFLITO:", "");
        text = raw.replace(/```action[\s\S]*?```/g, "").trim();
        const aviso = `⚠️ Conflito de horário: ${detalhe}\nDeseja agendar mesmo assim? Responda "forçar agendamento" para confirmar.`;
        text = text ? `${text}\n\n${aviso}` : aviso;
        // Guardar action com flag forceConflict para reuso se usuário confirmar
        const pendingAct = { ...act, params: { ...act.params, forceConflict: true } };
        addToHistory("assistant", `__PENDING_CONFLICT__${JSON.stringify(pendingAct)}`);
      } else {
        text = raw.replace(/```action[\s\S]*?```/g, "").trim();
        text = text ? `${text}\n\n${result}` : result;
        actionExecuted = true;
        if (act.type === "agendar" && result.includes("criado")) navigateTo = "/agenda";
      }
    } catch {
      text = raw.replace(/```action[\s\S]*?```/g, "").trim();
    }
  }

  addToHistory("assistant", text);
  const msgId = `m_${Date.now()}`;
  return { text, actionExecuted, navigateTo, messageId: msgId, userMessage };
}

export { addFeedback };

export async function testAgentV2Connection(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "OK" }], max_tokens: 5 }),
    });
    if (!res.ok) return { ok: false, message: res.status === 401 ? "Token invalido." : `Erro ${res.status}` };
    return { ok: true, message: "Conexao OK! Agente IA ativado." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Erro de rede." };
  }
}
