/**
 * agentV2.ts — Agente IA de Nova Geração para Domínio Pro
 *
 * Arquitetura: LLM-First com Tool Calling
 * - O modelo GPT-4o-mini decide sozinho o que fazer
 * - Sem NLU regex, sem slot-filling manual, sem orquestrador complexo
 * - Memória de conversa persistida no localStorage
 * - Acesso direto aos dados reais (clientes, agendamentos, serviços)
 * - Executa ações reais no sistema (agendar, cancelar, mover)
 *
 * Para usar: substitui agentOrchestrator + agentLLM + agentNLU + agentContext
 */

import {
  clientsStore,
  servicesStore,
  employeesStore,
  appointmentsStore,
} from "./store";

// ─── Tipos ────────────────────────────────────────────────

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
}

// ─── Estado da conversa ──────────────────────────────────

const HISTORY_KEY = "agentv2_history";
const MAX_HISTORY = 20;

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

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ─── Dados do sistema em tempo real ──────────────────────

function getTodayData(): string {
  const today = new Date().toISOString().split("T")[0];
  const appts = appointmentsStore.list({ date: today });
  const employees = employeesStore.list(true);

  if (appts.length === 0) {
    return `Hoje (${today}): nenhum agendamento.`;
  }

  const lines = appts.map(a => {
    const emp = employees.find(e => e.id === a.employeeId);
    const hora = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  • ${hora} — ${a.clientName} | ${svcs} | Prof: ${emp?.name ?? "?"} | Status: ${a.status}`;
  });

  return `Agendamentos de hoje (${today}):\n${lines.join("\n")}`;
}

function getClientData(query: string): string {
  const q = query.toLowerCase().trim();
  const all = clientsStore.list();

  if (!q) {
    return `Total de clientes cadastrados: ${all.length}`;
  }

  const found = all.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q)
  ).slice(0, 10);

  if (found.length === 0) {
    // Fuzzy: match por parte do nome
    const parts = q.split(" ").filter(p => p.length > 2);
    const fuzzy = all.filter(c =>
      parts.some(p => c.name?.toLowerCase().includes(p))
    ).slice(0, 5);

    if (fuzzy.length > 0) {
      return `Cliente "${query}" não encontrado exato. Similares:\n${fuzzy.map(c => `  • ID:${c.id} ${c.name} | Tel: ${c.phone ?? "—"}`).join("\n")}`;
    }
    return `Nenhum cliente encontrado com "${query}".`;
  }

  return `Clientes encontrados:\n${found.map(c => `  • ID:${c.id} ${c.name} | Tel: ${c.phone ?? "—"}`).join("\n")}`;
}

function getServicesData(): string {
  const svcs = servicesStore.list(true);
  if (svcs.length === 0) return "Nenhum serviço cadastrado.";
  return `Serviços disponíveis:\n${svcs.map(s => `  • ID:${s.id} ${s.name} | R$${s.price?.toFixed(2)} | ${s.durationMinutes}min`).join("\n")}`;
}

function getEmployeesData(): string {
  const emps = employeesStore.list(true);
  if (emps.length === 0) return "Nenhum profissional ativo.";
  return `Profissionais ativos:\n${emps.map(e => `  • ID:${e.id} ${e.name}`).join("\n")}`;
}

function getAppointmentsByDate(dateStr: string): string {
  let date = dateStr;
  const today = new Date();

  if (dateStr === "hoje") {
    date = today.toISOString().split("T")[0];
  } else if (dateStr === "amanhã" || dateStr === "amanha") {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    date = tomorrow.toISOString().split("T")[0];
  } else if (/^\d{1,2}\/\d{1,2}/.test(dateStr)) {
    // formato DD/MM ou DD/MM/YYYY
    const parts = dateStr.split("/");
    const d = parts[0].padStart(2, "0");
    const m = parts[1].padStart(2, "0");
    const y = parts[2] ?? String(today.getFullYear());
    date = `${y}-${m}-${d}`;
  } else if (/^\d{1,2}$/.test(dateStr)) {
    // só o dia
    const d = dateStr.padStart(2, "0");
    const m = String(today.getMonth() + 1).padStart(2, "0");
    date = `${today.getFullYear()}-${m}-${d}`;
  }

  const appts = appointmentsStore.list({ date });
  const employees = employeesStore.list(true);

  if (appts.length === 0) return `Nenhum agendamento em ${date}.`;

  const lines = appts.map(a => {
    const emp = employees.find(e => e.id === a.employeeId);
    const hora = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
    const svcs = a.services?.map((s: any) => s.name).join(", ") ?? "";
    return `  • ${hora} — ${a.clientName} | ${svcs} | Prof: ${emp?.name ?? "?"} | Status: ${a.status} | ID:${a.id}`;
  });

  return `Agendamentos em ${date}:\n${lines.join("\n")}`;
}

// ─── Execução de ações reais ─────────────────────────────

function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  let t = raw.toLowerCase().replace(/h/i, ":").replace(/\s+/g, "").trim();
  if (/^\d{1,2}$/.test(t)) t = `${t.padStart(2, "0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  return null;
}

function resolveDate(raw: string): string {
  const today = new Date();
  if (!raw || raw === "hoje") return today.toISOString().split("T")[0];
  if (raw === "amanhã" || raw === "amanha") {
    const d = new Date(today);
    d.setDate(today.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  if (/^\d{1,2}\/\d{1,2}/.test(raw)) {
    const parts = raw.split("/");
    const d = parts[0].padStart(2, "0");
    const m = parts[1].padStart(2, "0");
    const y = parts[2] ?? String(today.getFullYear());
    return `${y}-${m}-${d}`;
  }
  if (/^\d{1,2}$/.test(raw)) {
    const d = raw.padStart(2, "0");
    const m = String(today.getMonth() + 1).padStart(2, "0");
    return `${today.getFullYear()}-${m}-${d}`;
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
      if (!resolvedTime) return `Horário "${time}" inválido. Use formato HH:MM (ex: 14:30).`;

      const clients = clientsStore.list();
      const client = clients.find(c => String(c.id) === String(clientId));
      if (!client) return `Cliente ID:${clientId} não encontrado.`;

      const services = servicesStore.list(true);
      const svc = services.find(s => String(s.id) === String(serviceId));
      if (!svc) return `Serviço ID:${serviceId} não encontrado.`;

      const employees = employeesStore.list(true);
      const emp = employees.find(e => String(e.id) === String(employeeId)) ?? employees[0];
      if (!emp) return "Nenhum profissional disponível.";

      const startTime = `${resolvedDate}T${resolvedTime}:00`;
      const durationMs = (svc.durationMinutes ?? 60) * 60_000;
      const endTime = new Date(new Date(startTime).getTime() + durationMs).toISOString().slice(0, 19);

      // Verificar conflito
      const existing = appointmentsStore.list({ date: resolvedDate });
      const conflict = existing.find(a => {
        if (a.employeeId !== emp.id || a.status === "cancelled") return false;
        const aS = new Date(a.startTime).getTime();
        const aE = new Date(a.endTime).getTime();
        const rS = new Date(startTime).getTime();
        const rE = new Date(endTime).getTime();
        return rS < aE && rE > aS;
      });

      if (conflict) {
        return `Conflito: ${emp.name} já tem agendamento às ${conflict.startTime.split("T")[1]?.slice(0, 5)} nessa data.`;
      }

      await appointmentsStore.create({
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
        services: [{
          serviceId: svc.id,
          name: svc.name,
          price: svc.price,
          durationMinutes: svc.durationMinutes,
          employeeId: emp.id,
        }],
      });

      window.dispatchEvent(new Event("store_updated"));
      return `✅ Agendamento criado!\nCliente: ${client.name}\nServiço: ${svc.name}\nData: ${resolvedDate} às ${resolvedTime}\nProfissional: ${emp.name}`;
    }

    if (type === "cancelar") {
      const { appointmentId } = params;
      await appointmentsStore.update(appointmentId, { status: "cancelled" });
      window.dispatchEvent(new Event("store_updated"));
      return `✅ Agendamento ID:${appointmentId} cancelado.`;
    }

    if (type === "mover") {
      const { appointmentId, newDate, newTime } = params;
      const appts = appointmentsStore.list({});
      const appt = appts.find(a => String(a.id) === String(appointmentId));
      if (!appt) return `Agendamento ID:${appointmentId} não encontrado.`;

      const resolvedDate = resolveDate(newDate);
      const resolvedTime = normalizeTime(newTime);
      if (!resolvedTime) return `Horário "${newTime}" inválido.`;

      const durationMs = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
      const newStart = `${resolvedDate}T${resolvedTime}:00`;
      const newEnd = new Date(new Date(newStart).getTime() + durationMs).toISOString().slice(0, 19);

      await appointmentsStore.update(appt.id, { startTime: newStart, endTime: newEnd });
      window.dispatchEvent(new Event("store_updated"));
      return `✅ Agendamento movido para ${resolvedDate} às ${resolvedTime}.`;
    }

    if (type === "concluir") {
      const { appointmentId } = params;
      await appointmentsStore.update(appointmentId, { status: "completed" });
      window.dispatchEvent(new Event("store_updated"));
      return `✅ Agendamento ID:${appointmentId} marcado como concluído.`;
    }

    return `Ação "${type}" não reconhecida.`;
  } catch (err) {
    return `Erro ao executar ação: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── System Prompt ────────────────────────────────────────

function buildSystemPrompt(config: AgentV2Config): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

  return `Você é o Agente IA do ${config.salonName ?? "Domínio Pro"}, um sistema de gestão de salão de beleza.

## Contexto
- Data atual: ${dateStr}
- ${config.businessContext ?? "Salão de beleza com agendamentos, clientes e serviços."}

## Sua função
Você ajuda a gerenciar agendamentos, clientes, serviços e profissionais.
Você tem acesso a dados reais do sistema e pode executar ações diretamente.

## Como responder
1. Responda SEMPRE em português brasileiro, de forma direta e natural
2. Para consultas (ver agendamentos, buscar cliente, etc.): use os dados fornecidos e responda claramente
3. Para ações (agendar, cancelar, mover): confirme antes de executar ações destrutivas; para agendar, execute diretamente se tiver todos os dados
4. Se faltar algum dado (cliente, serviço, data, hora), peça apenas o que falta
5. Mantenha o contexto da conversa — lembre do que foi dito antes

## Formato especial para AÇÕES
Quando for executar uma ação, inclua no final da resposta um bloco JSON:
\`\`\`action
{"type": "agendar", "params": {"clientId": 123, "serviceId": 45, "employeeId": 2, "date": "2025-03-28", "time": "14:00"}}
\`\`\`

Tipos de ação disponíveis:
- agendar: {"clientId", "serviceId", "employeeId", "date", "time"}
- cancelar: {"appointmentId"}
- mover: {"appointmentId", "newDate", "newTime"}
- concluir: {"appointmentId"}

Use IDs numéricos exatos dos dados fornecidos. Nunca invente IDs.`;
}

// ─── Chamada à API ────────────────────────────────────────

const ENDPOINT = "https://models.github.ai/inference/chat/completions";

async function callLLM(
  systemPrompt: string,
  history: AgentMessage[],
  userMessage: string,
  systemData: string,
  config: AgentV2Config,
): Promise<string> {
  const token = config.apiToken;
  if (!token || token === "proxy") {
    throw new Error("Token não configurado.");
  }

  const messages: any[] = [
    { role: "system", content: systemPrompt },
  ];

  // Dados do sistema como contexto (antes do histórico)
  if (systemData) {
    messages.push({
      role: "system",
      content: `=== DADOS ATUAIS DO SISTEMA ===\n${systemData}\n=== FIM DOS DADOS ===`,
    });
  }

  // Histórico da conversa (sem a mensagem atual)
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Mensagem atual
  messages.push({ role: "user", content: userMessage });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: config.model ?? "openai/gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("Token inválido. Verifique seu GitHub PAT.");
      if (res.status === 429) throw new Error("Muitas requisições. Aguarde um momento.");
      throw new Error(`Erro ${res.status}: ${body.slice(0, 100)}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timeout — tente novamente.");
    }
    throw err;
  }
}

// ─── Coleta inteligente de dados do sistema ─────────────

function gatherSystemData(userMessage: string): string {
  const q = userMessage.toLowerCase();
  const parts: string[] = [];

  // Sempre incluir dados de hoje e profissionais
  parts.push(getTodayData());
  parts.push(getEmployeesData());

  // Incluir serviços se relevante
  if (/servi[cç]|corte|escova|tintura|manicure|pedicure|barba|hidrata|progressiva|quanto custa|preço|valor/i.test(q)) {
    parts.push(getServicesData());
  }

  // Buscar cliente específico se mencionado
  const clientMatch = q.match(/(?:cliente|para|de|da|do)\s+([a-záàâãéèêíìîóòôõúùûç][a-záàâãéèêíìîóòôõúùûç\s]{1,40})/i);
  if (clientMatch) {
    const name = clientMatch[1].trim();
    parts.push(getClientData(name));
  } else if (/cliente|nome|quem|pessoa/i.test(q)) {
    parts.push(getClientData(""));
  }

  // Data específica mencionada
  const dateMatch = q.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s+de\s+\w+|amanhã|amanha|segunda|terça|quarta|quinta|sexta|sábado|domingo)\b/i);
  if (dateMatch) {
    parts.push(getAppointmentsByDate(dateMatch[1]));
  }

  return parts.join("\n\n");
}

// ─── Ponto de entrada principal ──────────────────────────

let agentConfig: AgentV2Config | null = null;

export function initAgentV2(config: AgentV2Config) {
  agentConfig = config;
}

export async function handleMessageV2(userMessage: string): Promise<AgentV2Response> {
  if (!agentConfig) {
    return { text: "Agente não configurado. Recarregue a página." };
  }

  if (!agentConfig.apiToken || agentConfig.apiToken === "proxy") {
    return { text: "Configure seu GitHub Token nas configurações para ativar o Agente IA." };
  }

  // Salvar mensagem do usuário no histórico
  addToHistory("user", userMessage);

  // Coletar dados relevantes do sistema
  const systemData = gatherSystemData(userMessage);

  // Histórico sem a última mensagem (já adicionamos no callLLM)
  const history = loadHistory().slice(0, -1);

  let rawResponse: string;
  try {
    rawResponse = await callLLM(
      buildSystemPrompt(agentConfig),
      history,
      userMessage,
      systemData,
      agentConfig,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erro desconhecido";
    return { text: `Não consegui processar agora. ${errMsg}` };
  }

  // Extrair e executar ação se houver
  let visibleText = rawResponse;
  let actionExecuted = false;
  let navigateTo: string | undefined;

  const actionMatch = rawResponse.match(/```action\s*([\s\S]*?)```/);
  if (actionMatch) {
    try {
      const actionData = JSON.parse(actionMatch[1]);
      const result = await executeAction(actionData);

      // Substituir bloco action pelo resultado
      visibleText = rawResponse.replace(/```action[\s\S]*?```/g, "").trim();
      visibleText = `${visibleText}\n\n${result}`.trim();
      actionExecuted = true;

      // Navegar para agenda se agendou
      if (actionData.type === "agendar" && result.includes("✅")) {
        navigateTo = "/agenda";
      }
    } catch (e) {
      visibleText = rawResponse.replace(/```action[\s\S]*?```/g, "").trim();
    }
  }

  // Salvar resposta no histórico
  addToHistory("assistant", visibleText);

  return { text: visibleText, actionExecuted, navigateTo };
}

// ─── Teste de conexão ─────────────────────────────────────

export async function testAgentV2Connection(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Responda apenas: OK" }],
        max_tokens: 10,
      }),
    });

    if (!res.ok) {
      if (res.status === 401) return { ok: false, message: "Token inválido ou sem permissão 'models:read'." };
      return { ok: false, message: `Erro ${res.status}` };
    }

    return { ok: true, message: "Conexão OK! Agente IA ativado." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Erro de rede." };
  }
}
