/**
 * agentOrchestrator.ts — Orquestrador principal do agente.
 * Conecta todos os módulos (Context, NLU, LLM, Actions) num fluxo unificado.
 */

import {
  addUserTurn,
  addAgentTurn,
  detectFollowUp,
  resolveReferences,
  mergeEntities,
  getRelevantEntities,
  getPendingQuestion,
  getPendingConfirmation,
  setPendingConfirmation,
  getSlotFillingState,
  fillSlot,
  clearSlotFilling,
  recordAction,
  getContextSummaryForPrompt,
  setCurrentPage,
  resetConversation,
  type SlotFillingState,
} from "./agentContext";

import {
  configureLLM,
  isLLMConfigured,
  classifyIntent,
  generateResponse,
  testConnection,
} from "./agentLLM";

import { isScheduleCommand, processCommand } from "./agentCommands";
import { extractEntities as extractNLUEntities } from "./agentNLU";
import { servicesStore, clientsStore, appointmentsStore } from "./store";

// ─── Tipos ─────────────────────────────────────────────────

export interface AgentConfig {
  githubToken: string;
  model?: string;
  businessContext?: string;
  alwaysUseLLM?: boolean;
  llmAsFallback?: boolean;
  fetchSystemData?: (intent: string, entities: Record<string, string>) => Promise<string>;
  executeToolAction?: (toolId: string, params: Record<string, string>) => Promise<string>;
}

export interface AgentResponse {
  text: string;
  intent: string;
  entities: Record<string, string>;
  actionExecuted: boolean;
  awaitingConfirmation: boolean;
  awaitingInput: boolean;
  missingParam?: string;
  source: "nlu" | "llm" | "fallback";
  confidence: number;
  navigateTo?: string;
}

// ─── Estado do orquestrador ────────────────────────────────

let agentConfig: AgentConfig | null = null;
let isInitialized = false;

// ─── Inicialização ─────────────────────────────────────────

export async function initAgent(config: AgentConfig): Promise<{ ok: boolean; message: string }> {
  agentConfig = config;

  configureLLM({
    apiToken: config.githubToken,
    model: config.model ?? "openai/gpt-4o-mini",
    temperature: 0.4,
    maxTokens: 800,
  });

  const test = await testConnection();
  isInitialized = test.ok;

  if (!test.ok) {
    console.warn("[agentOrchestrator] LLM não disponível, usando apenas NLU local:", test.message);
    isInitialized = true;
    return {
      ok: true,
      message: "Agente iniciado com sucesso!",
    };
  }

  return {
    ok: true,
    message: "Agente iniciado com sucesso!",
  };
}

export async function handleUserMessage(userMessage: string): Promise<AgentResponse> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return emptyResponse("Não entendi. Pode repetir?");
  }

  const followUp = detectFollowUp(trimmed);
  const resolvedRefs = resolveReferences(trimmed);

  if (followUp.isFollowUp && Object.keys(resolvedRefs).length > 0) {
    mergeEntities(resolvedRefs);
  }

  const pendingQ = getPendingQuestion();
  if (pendingQ) {
    return await handlePendingQuestionResponse(trimmed, pendingQ);
  }

  const pendingC = getPendingConfirmation();
  if (pendingC) {
    return await handleConfirmationResponse(trimmed, pendingC);
  }

  const slotState = getSlotFillingState();
  if (slotState) {
    return await handleSlotFillingResponse(trimmed, slotState);
  }

  if (isScheduleCommand(trimmed)) {
    const cmdResult = processCommand(trimmed);
    if (cmdResult.understood) {
      addUserTurn(trimmed, "schedule_command", {});
      addAgentTurn(cmdResult.message, "schedule_command");
      return {
        text: cmdResult.message,
        intent: "schedule_command",
        entities: {},
        actionExecuted: cmdResult.type === "task_created" || cmdResult.type === "task_removed",
        awaitingConfirmation: false,
        awaitingInput: false,
        source: "nlu",
        confidence: 1.0,
      };
    }
  }

  let intent: string = "outro";
  let entities: Record<string, string> = {};
  let confidence = 0;
  let source: "nlu" | "llm" | "fallback" = "nlu";

  const localResult = classifyLocally(trimmed);
  intent = localResult.intent;
  entities = localResult.entities;
  confidence = localResult.confidence;

  if (isActionIntent(intent)) {
    const nluEntities = extractNLUEntities(trimmed);
    if (nluEntities.nome && !entities.clientName) {
      entities.clientName = nluEntities.nome;
    }
    if (nluEntities.hora && !entities.time) {
      entities.time = nluEntities.hora;
    }
    if (nluEntities.data && !entities.date) {
      entities.date = nluEntities.data;
    }
    if (!entities.serviceName) {
      const serviceName = extractServiceFromText(trimmed);
      if (serviceName) entities.serviceName = serviceName;
    }

    if (intent === "agendar") {
      validateAndResolveClient(entities);
      validateAndResolveService(entities);

      if (entities.clientId && !entities.serviceName) {
        const lastSvc = getLastServiceForClient(parseInt(entities.clientId));
        if (lastSvc) {
          const svcActive = servicesStore.list(true).find(s => s.id === lastSvc.serviceId);
          if (svcActive) {
            entities.serviceName = svcActive.name;
            entities.serviceId = String(svcActive.id);
          }
        }
      }
    }
  }

  const shouldUseLLM =
    agentConfig?.alwaysUseLLM ||
    (confidence < 0.6 && isLLMConfigured() && agentConfig?.llmAsFallback !== false);

  if (shouldUseLLM && isLLMConfigured()) {
    try {
      const llmResult = await classifyIntent(trimmed);
      if (llmResult.confidence > confidence && llmResult.confidence > 0.3) {
        intent = llmResult.intent;
        entities = { ...entities, ...llmResult.entities };
        confidence = llmResult.confidence;
        source = "llm";
      }
    } catch (err) {
      console.warn("[agentOrchestrator] LLM classification failed, using local NLU:", err);
    }
  }

  if (confidence < 0.4 && (trimmed.toLowerCase().includes("agenda") || trimmed.toLowerCase().includes("marca"))) {
    if (intent === "outro") {
      intent = "agendar";
      confidence = 0.5;
    }
  }

  if (followUp.isFollowUp) {
    const topicEntities = getRelevantEntities(0.2);
    entities = { ...topicEntities, ...resolvedRefs, ...entities };
  }

  addUserTurn(trimmed, intent, entities);

  let response: AgentResponse;
  if (isActionIntent(intent)) {
    response = await handleActionIntent(intent, entities, trimmed, source, confidence);
  } else {
    response = await handleConversationalIntent(intent, entities, trimmed, source, confidence);
  }

  addAgentTurn(response.text, intent);
  return response;
}

// ─── Handlers de Fluxo ─────────────────────────────────────

async function handleActionIntent(
  intent: string,
  entities: Record<string, string>,
  userMessage: string,
  source: "nlu" | "llm" | "fallback",
  confidence: number,
): Promise<AgentResponse> {
  const required = getRequiredParams(intent);
  const missing = required.filter(p => !entities[p.key]);

  if (missing.length > 0) {
    const firstMissing = missing[0];
    let promptText = firstMissing.prompt;

    if (intent === "agendar") {
      if (firstMissing.key === "serviceName") {
        const services = servicesStore.list(true);
        if (services.length > 0 && services.length <= 15) {
          promptText = `Qual serviço deseja agendar? Temos: ${services.map(s => s.name).join(", ")}`;
        }
      } else if (firstMissing.key === "clientName") {
        const clients = clientsStore.list();
        if (clients.length > 0 && clients.length <= 20) {
          promptText = `Para qual cliente? Cadastrados: ${clients.map(c => c.name).join(", ")}`;
        }
      }
    }

    if (isLLMConfigured() && agentConfig) {
      try {
        promptText = await generateResponse(
          `O usuário quer "${intent}" mas faltou informar: ${firstMissing.label}. Pergunte de forma natural e breve.`,
          undefined,
          agentConfig.businessContext,
        );
      } catch { /* usar prompt padrão */ }
    }

    return {
      text: promptText,
      intent,
      entities,
      actionExecuted: false,
      awaitingConfirmation: false,
      awaitingInput: true,
      missingParam: firstMissing.key,
      source,
      confidence,
    };
  }

  if (agentConfig?.executeToolAction) {
    if (isDestructiveAction(intent)) {
      const description = buildActionDescription(intent, entities);
      let confirmText = `${description}\n\nDeseja confirmar? Responda "sim" ou "não".`;
      
      if (isLLMConfigured() && agentConfig) {
        try {
          confirmText = await generateResponse(
            `O usuário quer ${intent}. Parâmetros: ${JSON.stringify(entities)}. Descreva o que será feito e peça confirmação. Seja breve.`,
            undefined,
            agentConfig.businessContext,
          );
          if (!/confirm|certeza|sim|nao/.test(confirmText.toLowerCase())) {
            confirmText += '\n\nDeseja confirmar?';
          }
        } catch { /* usar texto padrão */ }
      }

      setPendingConfirmation(intent, entities, description);

      return {
        text: confirmText,
        intent,
        entities,
        actionExecuted: false,
        awaitingConfirmation: true,
        awaitingInput: false,
        source,
        confidence,
      };
    }

    try {
      const result = await agentConfig.executeToolAction(intent, entities);
      recordAction(intent, buildActionDescription(intent, entities), entities, result);

      return {
        text: result,
        intent,
        entities,
        actionExecuted: true,
        awaitingConfirmation: false,
        awaitingInput: false,
        source,
        confidence,
      };
    } catch (err) {
      return {
        text: `Erro ao executar a ação: ${err instanceof Error ? err.message : String(err)}`,
        intent,
        entities,
        actionExecuted: false,
        awaitingConfirmation: false,
        awaitingInput: false,
        source,
        confidence,
      };
    }
  }

  return {
    text: buildActionDescription(intent, entities),
    intent,
    entities,
    actionExecuted: false,
    awaitingConfirmation: false,
    awaitingInput: false,
    source,
    confidence,
  };
}

async function handleConversationalIntent(
  intent: string,
  entities: Record<string, string>,
  userMessage: string,
  source: "nlu" | "llm" | "fallback",
  confidence: number,
): Promise<AgentResponse> {
  switch (intent) {
    case "saudacao": {
      const hour = new Date().getHours();
      let greeting = "Olá";
      if (hour < 12) greeting = "Bom dia";
      else if (hour < 18) greeting = "Boa tarde";
      else greeting = "Boa noite";

      let text = `${greeting}! Como posso ajudar com a agenda?`;

      if (isLLMConfigured() && agentConfig?.alwaysUseLLM) {
        try {
          text = await generateResponse(userMessage, undefined, agentConfig.businessContext);
          source = "llm";
        } catch { /* usar resposta local */ }
      }

      return makeResponse(text, intent, entities, source, confidence);
    }

    case "despedida": {
      return makeResponse(
        "Até mais! Qualquer coisa é só chamar. 👋",
        intent, entities, source, confidence,
      );
    }

    case "ajuda": {
      return makeResponse(
        `Posso ajudar com:\n` +
        `• **Agendamentos** — ver, agendar, mover, cancelar\n` +
        `• **Clientes** — buscar, ver histórico\n` +
        `• **Serviços** — listar, ver preços\n` +
        `• **Funcionários** — ver escala, trocar profissional\n` +
        `• **Financeiro** — faturamento, comissões\n\n` +
        `Basta me dizer o que precisa! Ex: "Quais agendamentos de hoje?" ou "Cancela o horário das 14h"`,
        intent, entities, source, confidence,
      );
    }

    default: {
      if (isLLMConfigured() && agentConfig) {
        try {
          const text = await generateResponse(userMessage, undefined, agentConfig.businessContext);
          return makeResponse(text, intent, entities, "llm", 0.8);
        } catch { /* fallback */ }
      }
      return handleLocalQuery(intent, entities, userMessage);
    }
  }
}

// ─── Helpers Internos ──────────────────────────────────────

function validateAndResolveClient(entities: Record<string, string>) {
  if (entities.clientName && !entities.clientId) {
    const resolved = resolveClientFromStore(entities.clientName);
    if (resolved) {
      entities.clientName = resolved.name;
      entities.clientId = String(resolved.id);
    }
  }
}

function validateAndResolveService(entities: Record<string, string>) {
  if (entities.serviceName && !entities.serviceId) {
    const resolved = resolveServiceFromStore(entities.serviceName);
    if (resolved) {
      entities.serviceName = resolved.name;
      entities.serviceId = String(resolved.id);
    } else {
      delete entities.serviceName;
    }
  }
}

function classifyLocally(text: string): { intent: string; entities: Record<string, string>; confidence: number } {
  const { getBestIntent: localClassify } = require("./agentNLU");
  const result = localClassify(text);
  
  if (!result) return { intent: "outro", entities: {}, confidence: 0 };
  
  return {
    intent: result.intent,
    entities: {},
    confidence: result.confidence === "high" ? 0.9 : result.confidence === "medium" ? 0.6 : 0.3,
  };
}

function isActionIntent(intent: string): boolean {
  return ["agendar", "cancelar_agendamento", "mover_agendamento", "reagendar", "criar_cliente", "editar_cliente", "abrir_caixa", "fechar_caixa", "registar_pagamento"].includes(intent);
}

function buildActionDescription(intent: string, entities: Record<string, string>): string {
  switch (intent) {
    case "cancelar_agendamento": {
      const parts = ["Cancelar agendamento(s)"];
      if (entities.clientName) parts.push(`de ${entities.clientName}`);
      if (entities.date) parts.push(`em ${entities.date}`);
      return parts.join(" ");
    }
    case "mover_agendamento":
    case "reagendar": {
      const parts = ["Mover agendamento(s)"];
      if (entities.clientName) parts.push(`de ${entities.clientName}`);
      if (entities.sourceDate || entities.date) parts.push(`de ${entities.sourceDate || entities.date}`);
      if (entities.targetDate) parts.push(`para ${entities.targetDate}`);
      if (entities.targetTime || entities.time) parts.push(`às ${entities.targetTime || entities.time}`);
      return parts.join(" ");
    }
    case "agendar": {
      const parts = ["Agendar"];
      if (entities.serviceName) parts.push(entities.serviceName);
      if (entities.clientName) parts.push(`para ${entities.clientName}`);
      if (entities.date) parts.push(`em ${entities.date}`);
      if (entities.time) parts.push(`às ${entities.time}`);
      return parts.join(" ");
    }
    default:
      return `Executar ${intent}`;
  }
}

function extractServiceFromText(text: string): string | null {
  const q = normalize(text);
  const services = servicesStore.list(true);
  if (services.length === 0) return null;

  for (const svc of services) {
    const svcNorm = normalize(svc.name);
    if (q.includes(svcNorm)) return svc.name;
  }

  for (const svc of services) {
    const svcNorm = normalize(svc.name);
    const parts = svcNorm.split(" ").filter(p => p.length > 3);
    if (parts.length > 0 && parts.some(p => q.includes(p))) return svc.name;
  }

  const serviceKeywords = ["corte", "barba", "sobrancelha", "escova", "progressiva", "manicure", "pedicure", "tintura", "luzes"];
  for (const keyword of serviceKeywords) {
    if (q.includes(keyword)) {
      for (const svc of services) {
        const svcNorm = normalize(svc.name);
        if (svcNorm.includes(keyword)) return svc.name;
      }
    }
  }
  return null;
}

function resolveClientFromStore(name: string): { id: number; name: string } | null {
  const clients = clientsStore.list();
  const norm = normalize(name);
  for (const c of clients) {
    if (normalize(c.name) === norm) return { id: c.id, name: c.name };
  }
  for (const c of clients) {
    const cNorm = normalize(c.name);
    if (cNorm.includes(norm) || norm.includes(cNorm)) return { id: c.id, name: c.name };
  }
  const parts = norm.split(" ").filter(p => p.length > 2);
  if (parts.length > 0) {
    for (const c of clients) {
      const cNorm = normalize(c.name);
      if (parts.every(p => cNorm.includes(p))) return { id: c.id, name: c.name };
    }
  }
  return null;
}

function resolveServiceFromStore(name: string): { id: number; name: string; durationMinutes: number; price: number } | null {
  const services = servicesStore.list(true);
  const norm = normalize(name);
  for (const s of services) {
    if (normalize(s.name) === norm) return { id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price };
  }
  for (const s of services) {
    const sNorm = normalize(s.name);
    if (sNorm.includes(norm) || norm.includes(sNorm)) return { id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price };
  }
  return null;
}

function getLastServiceForClient(clientId: number): { serviceId: number; name: string } | null {
  const allAppts = appointmentsStore.list({});
  const clientAppts = allAppts
    .filter(a => a.clientId === clientId && a.services && a.services.length > 0)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  if (clientAppts.length > 0 && clientAppts[0].services.length > 0) {
    const lastSvc = clientAppts[0].services[0];
    return { serviceId: lastSvc.serviceId, name: lastSvc.name };
  }
  return null;
}

function handleLocalQuery(intent: string, entities: Record<string, string>, userMessage: string): AgentResponse {
  const msg = "Desculpe, não entendi bem. Pode reformular? Tente algo como: 'Quais agendamentos de hoje?' ou 'Agendar corte para amanhã'.";
  return makeResponse(msg, intent, entities, "fallback", 0.2);
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
}

function makeResponse(text: string, intent: string, entities: Record<string, string>, source: "nlu" | "llm" | "fallback", confidence: number): AgentResponse {
  return { text, intent, entities, actionExecuted: false, awaitingConfirmation: false, awaitingInput: false, source, confidence };
}

function emptyResponse(text: string): AgentResponse {
  return makeResponse(text, "outro", {}, "fallback", 0);
}

function isDestructiveAction(intent: string): boolean {
  return ["cancelar_agendamento", "mover_agendamento", "reagendar"].includes(intent);
}

function getRequiredParams(intent: string): RequiredParam[] {
  switch (intent) {
    case "agendar":
      return [
        { key: "clientName", label: "Cliente", prompt: "Para qual cliente deseja agendar?" },
        { key: "serviceName", label: "Serviço", prompt: "Qual serviço?" },
        { key: "date", label: "Data", prompt: "Para qual data?" },
        { key: "time", label: "Horário", prompt: "Qual horário?" },
      ];
    case "cancelar_agendamento":
      return [{ key: "date", label: "Data", prompt: "Cancelar agendamentos de qual data?" }];
    case "mover_agendamento":
    case "reagendar":
      return [
        { key: "date", label: "Data", prompt: "De qual data?" },
        { key: "targetDate", label: "Data de destino", prompt: "Para qual data?" },
        { key: "time", label: "Horário", prompt: "Qual horário?" },
      ];
    default:
      return [];
  }
}

export function resetAgent(): void { resetConversation(); }
export function updateCurrentPage(page: string): void { setCurrentPage(page); }

interface RequiredParam {
  key: string;
  label: string;
  prompt: string;
}
