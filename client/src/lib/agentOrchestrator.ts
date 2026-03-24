/**
 * agentOrchestrator.ts — Orquestrador principal do agente.
 * Conecta todos os módulos (Context, NLU, LLM, Actions) num fluxo unificado.
 *
 * Fluxo de processamento:
 *   1. Recebe mensagem do usuário
 *   2. Detecta follow-up e resolve referências pronominais (agentContext)
 *   3. Tenta classificar com NLU local (regex — rápido, sem custo)
 *   4. Se NLU local falhar ou confiança for baixa, usa LLM (GitHub Models)
 *   5. Executa a ação correspondente (tools, agenda actions)
 *   6. Gera resposta — NLU local para respostas simples, LLM para naturais
 *   7. Atualiza contexto (turnos, entidades, tópico)
 *
 * O LLM é usado como FALLBACK inteligente, não como rota primária.
 * Isso economiza chamadas à API e mantém o agente funcional offline.
 *
 * Uso:
 *   import { handleUserMessage, initAgent } from "./agentOrchestrator";
 *
 *   initAgent({ githubToken: "ghp_xxx" });
 *   const response = await handleUserMessage("Quais agendamentos de hoje?");
 */

import {
  addUserTurn,
  addAgentTurn,
  detectFollowUp,
  resolveReferences,
  mergeEntities,
  getRelevantEntities,
  getActiveTopic,
  getPendingQuestion,
  clearPendingQuestion,
  getPendingConfirmation,
  clearPendingConfirmation,
  getSlotFillingState,
  fillSlot,
  clearSlotFilling,
  startSlotFilling,
  recordAction,
  getContextSummaryForPrompt,
  setCurrentPage,
  hasRecentConversation,
  resetConversation,
  type ConversationTopic,
  type SlotFillingState,
} from "./agentContext";

import {
  configureLLM,
  isLLMConfigured,
  sendToLLM,
  classifyIntent,
  generateResponse,
  testConnection,
  type LLMResponse,
  type IntentClassification,
} from "./agentLLM";

import { isScheduleCommand, processCommand } from "./agentCommands";

// ─── Tipos ─────────────────────────────────────────────────

export interface AgentConfig {
  /** GitHub PAT com scope models:read */
  githubToken: string;
  /** Modelo a usar (default: "openai/gpt-4o-mini") */
  model?: string;
  /** Contexto de negócio (nome do salão, serviços, etc.) */
  businessContext?: string;
  /** Se true, sempre usa LLM (mais natural, mais lento) */
  alwaysUseLLM?: boolean;
  /** Se true, usa LLM apenas para fallback (default: true) */
  llmAsFallback?: boolean;
  /** Callback para buscar dados do sistema (agendamentos, clientes, etc.) */
  fetchSystemData?: (intent: string, entities: Record<string, string>) => Promise<string>;
  /** Callback para executar ações (agendar, cancelar, etc.) */
  executeToolAction?: (toolId: string, params: Record<string, string>) => Promise<string>;
}

export interface AgentResponse {
  /** Texto da resposta para exibir ao usuário */
  text: string;
  /** Intent detectado */
  intent: string;
  /** Entidades extraídas */
  entities: Record<string, string>;
  /** Se uma ação foi executada */
  actionExecuted: boolean;
  /** Se está aguardando confirmação do usuário */
  awaitingConfirmation: boolean;
  /** Se está aguardando mais informações */
  awaitingInput: boolean;
  /** Parâmetro faltante (se awaitingInput) */
  missingParam?: string;
  /** Origem da resposta: "nlu" (local) ou "llm" (GitHub Models) */
  source: "nlu" | "llm" | "fallback";
  /** Confiança na classificação (0-1) */
  confidence: number;
}

// ─── Estado do orquestrador ────────────────────────────────

let agentConfig: AgentConfig | null = null;
let isInitialized = false;

// ─── Inicialização ─────────────────────────────────────────

/**
 * Inicializa o agente com as configurações fornecidas.
 * Deve ser chamado antes de usar handleUserMessage().
 */
export async function initAgent(config: AgentConfig): Promise<{ ok: boolean; message: string }> {
  agentConfig = config;

  // Configurar LLM
  configureLLM({
    apiToken: config.githubToken,
    model: config.model ?? "openai/gpt-4o-mini",
    temperature: 0.4,
    maxTokens: 800,
  });

  // Testar conexão
  const test = await testConnection();
  isInitialized = test.ok;

  if (!test.ok) {
    console.warn("[agentOrchestrator] LLM não disponível, usando apenas NLU local:", test.message);
    // Ainda funciona — apenas sem LLM
    isInitialized = true;
    return {
      ok: true,
      message: `Agente iniciado (modo offline — NLU local apenas). Motivo: ${test.message}`,
    };
  }

  return {
    ok: true,
    message: `Agente iniciado com sucesso! Modelo: ${test.model}`,
  };
}

/** Verifica se o agente está pronto */
export function isAgentReady(): boolean {
  return isInitialized;
}

// ─── Handler principal ─────────────────────────────────────

/**
 * Processa uma mensagem do usuário e retorna a resposta do agente.
 * Este é o ponto de entrada principal — orquestra todo o fluxo.
 */
export async function handleUserMessage(userMessage: string): Promise<AgentResponse> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return emptyResponse("Não entendi. Pode repetir?");
  }

  // ─── 1. Detectar follow-up e resolver referências ────────
  const followUp = detectFollowUp(trimmed);
  const resolvedRefs = resolveReferences(trimmed);

  // Se é follow-up, mesclar referências resolvidas
  if (followUp.isFollowUp && Object.keys(resolvedRefs).length > 0) {
    mergeEntities(resolvedRefs);
  }

  // ─── 2. Verificar estados pendentes ──────────────────────

  // 2a. Pergunta pendente (slot-filling ou parâmetro faltante)
  const pendingQ = getPendingQuestion();
  if (pendingQ) {
    return await handlePendingQuestionResponse(trimmed, pendingQ);
  }

  // 2b. Confirmação pendente
  const pendingC = getPendingConfirmation();
  if (pendingC) {
    return await handleConfirmationResponse(trimmed, pendingC);
  }

  // 2c. Slot-filling ativo
  const slotState = getSlotFillingState();
  if (slotState) {
    return await handleSlotFillingResponse(trimmed, slotState);
  }

  // ─── 2.5. Verificar se é comando de agendamento recorrente ──
  if (isScheduleCommand(trimmed)) {
    const cmdResult = processCommand(trimmed);
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

  // ─── 3. Classificar intent ──────────────────────────────

  let intent: string = "outro";
  let entities: Record<string, string> = {};
  let confidence = 0;
  let source: "nlu" | "llm" | "fallback" = "nlu";

  // 3a. Tentar NLU local primeiro (rápido, sem custo)
  const localResult = classifyLocally(trimmed);
  intent = localResult.intent;
  entities = localResult.entities;
  confidence = localResult.confidence;

  // 3b. Se confiança baixa e LLM disponível, usar LLM
  const shouldUseLLM =
    agentConfig?.alwaysUseLLM ||
    (confidence < 0.6 && isLLMConfigured() && agentConfig?.llmAsFallback !== false);

  if (shouldUseLLM && isLLMConfigured()) {
    try {
      const llmResult = await classifyIntent(trimmed);
      // Usar resultado do LLM se tiver mais confiança
      if (llmResult.confidence > confidence) {
        intent = llmResult.intent;
        entities = llmResult.entities;
        confidence = llmResult.confidence;
        source = "llm";
      }
    } catch (err) {
      console.warn("[agentOrchestrator] LLM classification failed, using local:", err);
    }
  }

  // Se é follow-up, herdar entidades do tópico ativo que não foram mencionadas
  if (followUp.isFollowUp) {
    const topicEntities = getRelevantEntities(0.2);
    entities = { ...topicEntities, ...resolvedRefs, ...entities };
  }

  // ─── 4. Registrar turno do usuário ──────────────────────
  addUserTurn(trimmed, intent, entities);

  // ─── 5. Gerar resposta ─────────────────────────────────

  let response: AgentResponse;

  // Se tem ação a executar
  if (isActionIntent(intent)) {
    response = await handleActionIntent(intent, entities, trimmed, source, confidence);
  }
  // Se é conversação / pergunta
  else {
    response = await handleConversationalIntent(intent, entities, trimmed, source, confidence);
  }

  // ─── 6. Registrar turno do agente ──────────────────────
  addAgentTurn(response.text, intent);

  return response;
}

// ─── NLU Local (regex-based) ───────────────────────────────

interface LocalClassification {
  intent: string;
  entities: Record<string, string>;
  confidence: number;
}

function classifyLocally(text: string): LocalClassification {
  const q = normalize(text);

  // Saudações
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|fala|hey|hi)\b/.test(q)) {
    return { intent: "saudacao", entities: {}, confidence: 0.95 };
  }

  // Despedidas
  if (/^(tchau|ate mais|ate logo|falou|vlw|valeu|obrigad)\b/.test(q)) {
    return { intent: "despedida", entities: {}, confidence: 0.95 };
  }

  // Confirmação
  if (/^(sim|confirma|confirmo|pode|ok|faz|executa|vai|manda|bora|claro|com certeza|pode sim|sim pode|confirmar)$/
    .test(q)) {
    return { intent: "confirmar", entities: {}, confidence: 0.95 };
  }

  // Negação
  if (/^(nao|cancela|cancelar|nao quero|deixa|para|nao pode|negativo|nao faz)$/.test(q)) {
    return { intent: "negar", entities: {}, confidence: 0.95 };
  }

  // Ajuda
  if (/^(ajuda|help|o que voce faz|como funciona|quais comandos)\b/.test(q)) {
    return { intent: "ajuda", entities: {}, confidence: 0.9 };
  }

  // Ver agendamentos
  if (/agendamento|agenda|horario|marcad|compromisso/.test(q)) {
    const entities: Record<string, string> = {};

    if (q.includes("hoje")) entities.date = "hoje";
    else if (q.includes("amanha")) entities.date = "amanha";
    else if (q.includes("semana")) entities.date = "semana";

    // Detectar se é ação ou consulta
    if (/cancel[ae]|desmarqu?e?/.test(q)) {
      return { intent: "cancelar_agendamento", entities, confidence: 0.85 };
    }
    if (/mov[ae]|troqu?e?|transfer[ei]|reagend[ae]|pass[ae]|remarqu?e?/.test(q)) {
      return { intent: "mover_agendamento", entities, confidence: 0.85 };
    }
    if (/agend[ae]|marc[ae]|nov[ao]\s+agendamento/.test(q)) {
      return { intent: "agendar", entities, confidence: 0.85 };
    }

    return { intent: "ver_agendamentos", entities, confidence: 0.8 };
  }

  // Cancelar (sem mencionar agendamento explicitamente)
  if (/cancel[ae]|desmarqu?e?/.test(q)) {
    return { intent: "cancelar_agendamento", entities: {}, confidence: 0.7 };
  }

  // Reagendar/mover (sem mencionar agendamento explicitamente)
  if (/reagend[ae]|mov[ae].*para|troqu?e?.*para|transfer[ei]/.test(q)) {
    return { intent: "mover_agendamento", entities: {}, confidence: 0.7 };
  }

  // Agendar novo
  if (/agend[ae]|marc[ae]|quero\s+marcar|preciso\s+marcar|reserv[ae]/.test(q)) {
    return { intent: "agendar", entities: {}, confidence: 0.75 };
  }

  // Clientes
  if (/cliente|clientes/.test(q)) {
    if (/busc|procur|encontr|ach/.test(q)) {
      return { intent: "buscar_cliente", entities: {}, confidence: 0.8 };
    }
    return { intent: "ver_clientes", entities: {}, confidence: 0.8 };
  }

  // Serviços
  if (/servico|servicos|preco|valor|tabela/.test(q)) {
    return { intent: "ver_servicos", entities: {}, confidence: 0.8 };
  }

  // Funcionários
  if (/funcionario|profissional|quem trabalha|equipe|colaborador/.test(q)) {
    return { intent: "ver_funcionarios", entities: {}, confidence: 0.8 };
  }

  // Financeiro
  if (/faturamento|financeiro|ganho|receita|comiss[ao]|relatorio/.test(q)) {
    return { intent: "ver_financeiro", entities: {}, confidence: 0.8 };
  }

  // Não classificado
  return { intent: "outro", entities: {}, confidence: 0.2 };
}

// ─── Handlers de intent ────────────────────────────────────

function isActionIntent(intent: string): boolean {
  return [
    "cancelar_agendamento",
    "mover_agendamento",
    "reagendar",
    "agendar",
  ].includes(intent);
}

async function handleActionIntent(
  intent: string,
  entities: Record<string, string>,
  userMessage: string,
  source: "nlu" | "llm" | "fallback",
  confidence: number,
): Promise<AgentResponse> {
  // Verificar se temos os parâmetros necessários
  const required = getRequiredParams(intent);
  const missing = required.filter(p => !(p.key in entities) || !entities[p.key]);

  // Se faltam parâmetros, iniciar slot-filling
  if (missing.length > 0) {
    const filledSlots: Record<string, string> = {};
    const missingSlots: Record<string, string> = {};

    for (const param of required) {
      if (entities[param.key]) {
        filledSlots[param.key] = entities[param.key];
      } else {
        missingSlots[param.key] = param.prompt;
      }
    }

    startSlotFilling(intent, intent, filledSlots, missingSlots);

    // Perguntar o primeiro parâmetro faltante
    const firstMissing = missing[0];
    let promptText = firstMissing.prompt;

    // Se LLM disponível, gerar prompt mais natural
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

  // Todos os parâmetros presentes — executar via callback ou pedir confirmação
  if (agentConfig?.executeToolAction) {
    // Para ações destrutivas, pedir confirmação
    if (isDestructiveAction(intent)) {
      const description = buildActionDescription(intent, entities);

      // Usar LLM para gerar preview mais natural, se disponível
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

      // Salvar confirmação pendente no contexto
      const { setPendingConfirmation } = await import("./agentContext");
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

    // Ação não destrutiva — executar direto
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

  // Sem callback de execução — apenas informar
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

  // Respostas locais para intents simples
  switch (intent) {
    case "saudacao": {
      const hour = new Date().getHours();
      let greeting = "Olá";
      if (hour < 12) greeting = "Bom dia";
      else if (hour < 18) greeting = "Boa tarde";
      else greeting = "Boa noite";

      let text = `${greeting}! Como posso ajudar com a agenda?`;

      // Se LLM disponível, resposta mais natural
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

    case "confirmar":
    case "negar": {
      // Se não há nada pendente
      return makeResponse(
        "Não há nenhuma ação pendente no momento. O que gostaria de fazer?",
        intent, entities, source, confidence,
      );
    }

    default: {
      // Para intents de consulta ou não classificados — usar LLM se disponível
      if (isLLMConfigured() && agentConfig) {
        try {
          // Buscar dados do sistema se callback disponível
          let systemData: string | undefined;
          if (agentConfig.fetchSystemData) {
            systemData = await agentConfig.fetchSystemData(intent, entities);
          }

          const llmResponse = await generateResponse(
            userMessage,
            systemData,
            agentConfig.businessContext,
          );

          return makeResponse(llmResponse, intent, entities, "llm", confidence);
        } catch (err) {
          console.warn("[agentOrchestrator] LLM response failed:", err);
        }
      }

      // Fallback local para consultas comuns
      return handleLocalQuery(intent, entities, userMessage);
    }
  }
}

// ─── Handlers de estados pendentes ─────────────────────────

async function handlePendingQuestionResponse(
  text: string,
  pending: { toolId: string; missingParam: string; collectedParams: Record<string, string> },
): Promise<AgentResponse> {
  // A resposta do usuário é o valor do parâmetro faltante
  clearPendingQuestion();

  const updatedParams = { ...pending.collectedParams, [pending.missingParam]: text };

  // Verificar se há slot-filling ativo
  const slotState = getSlotFillingState();
  if (slotState) {
    const remaining = fillSlot(pending.missingParam, text);

    if (Object.keys(remaining).length > 0) {
      // Ainda faltam slots
      const nextSlot = Object.entries(remaining)[0];

      addUserTurn(text, pending.toolId, { [pending.missingParam]: text });

      const promptText = nextSlot[1]; // prompt do próximo slot
      addAgentTurn(promptText, pending.toolId);

      return {
        text: promptText,
        intent: pending.toolId,
        entities: updatedParams,
        actionExecuted: false,
        awaitingConfirmation: false,
        awaitingInput: true,
        missingParam: nextSlot[0],
        source: "nlu",
        confidence: 0.9,
      };
    }

    // Todos os slots preenchidos — executar
    clearSlotFilling();
    const allParams = { ...slotState.filledSlots, [pending.missingParam]: text };

    addUserTurn(text, pending.toolId, { [pending.missingParam]: text });

    // Re-processar como se tivesse todos os parâmetros
    return await handleActionIntent(pending.toolId, allParams, text, "nlu", 0.9);
  }

  // Sem slot-filling — simplesmente re-processar
  addUserTurn(text, pending.toolId, { [pending.missingParam]: text });
  return await handleActionIntent(pending.toolId, updatedParams, text, "nlu", 0.9);
}

async function handleConfirmationResponse(
  text: string,
  pending: { toolId: string; params: Record<string, string>; description: string },
): Promise<AgentResponse> {
  const q = normalize(text);
  clearPendingConfirmation();

  // Verificar se é confirmação
  if (/\b(sim|confirma|confirmo|pode|ok|faz|executa|vai|manda|bora|claro)\b/.test(q)) {
    addUserTurn(text, "confirmar", {});

    // Executar a ação
    if (agentConfig?.executeToolAction) {
      try {
        const result = await agentConfig.executeToolAction(pending.toolId, pending.params);
        recordAction(pending.toolId, pending.description, pending.params, result);

        addAgentTurn(result, pending.toolId);
        return {
          text: result,
          intent: pending.toolId,
          entities: pending.params,
          actionExecuted: true,
          awaitingConfirmation: false,
          awaitingInput: false,
          source: "nlu",
          confidence: 1.0,
        };
      } catch (err) {
        const errorMsg = `Erro ao executar: ${err instanceof Error ? err.message : String(err)}`;
        addAgentTurn(errorMsg, pending.toolId);
        return makeResponse(errorMsg, pending.toolId, pending.params, "nlu", 1.0);
      }
    }

    return makeResponse("Ação confirmada.", pending.toolId, pending.params, "nlu", 1.0);
  }

  // Negação
  if (/\b(nao|cancela|cancelar|nao quero|deixa|para|negativo)\b/.test(q)) {
    addUserTurn(text, "negar", {});
    const msg = "Ok, ação cancelada. Nenhuma alteração foi feita.";
    addAgentTurn(msg, "negar");
    return makeResponse(msg, "negar", {}, "nlu", 1.0);
  }

  // Resposta ambígua — perguntar de novo
  addUserTurn(text, "outro", {});
  const msg = `Não entendi. Você quer confirmar a ação: "${pending.description}"? Responda "sim" ou "não".`;
  addAgentTurn(msg, pending.toolId);

  // Re-salvar a confirmação pendente
  const { setPendingConfirmation } = await import("./agentContext");
  setPendingConfirmation(pending.toolId, pending.params, pending.description);

  return {
    text: msg,
    intent: pending.toolId,
    entities: pending.params,
    actionExecuted: false,
    awaitingConfirmation: true,
    awaitingInput: false,
    source: "nlu",
    confidence: 0.5,
  };
}

async function handleSlotFillingResponse(
  text: string,
  slotState: SlotFillingState,
): Promise<AgentResponse> {
  // Verificar se o usuário quer cancelar o fluxo
  const q = normalize(text);
  if (/\b(cancela|cancelar|deixa|para|esquece|desiste)\b/.test(q)) {
    clearSlotFilling();
    addUserTurn(text, "negar", {});
    const msg = "Ok, fluxo cancelado.";
    addAgentTurn(msg, "negar");
    return makeResponse(msg, "negar", {}, "nlu", 1.0);
  }

  // Determinar qual slot está sendo preenchido
  const missingEntries = Object.entries(slotState.missingSlots);
  if (missingEntries.length === 0) {
    // Todos preenchidos — executar
    clearSlotFilling();
    addUserTurn(text, slotState.flowId, {});
    return await handleActionIntent(slotState.flowId, slotState.filledSlots, text, "nlu", 0.9);
  }

  // Validar se a resposta bate com o tipo de slot esperado
  const [slotName, slotPrompt] = missingEntries[0];

  // Se está esperando um horário mas recebeu algo que não parece hora → repetir pergunta
  if ((slotName === "time" || slotName === "targetTime") && !/\d/.test(text)) {
    const msg = `Não entendi o horário. Por favor, informe no formato "14h" ou "14:00".`;
    addUserTurn(text, slotState.flowId, {});
    addAgentTurn(msg, slotState.flowId);
    return {
      text: msg,
      intent: slotState.flowId,
      entities: { ...slotState.filledSlots },
      actionExecuted: false,
      awaitingConfirmation: false,
      awaitingInput: true,
      missingParam: slotName,
      source: "nlu",
      confidence: 0.9,
    };
  }

  // Se está esperando data mas recebeu algo que não parece data → repetir pergunta
  if ((slotName === "date" || slotName === "sourceDate" || slotName === "targetDate") &&
      !/\d|hoje|amanha|amanhã|segunda|terca|quarta|quinta|sexta|sabado|domingo|proxim|semana/i.test(text)) {
    const msg = `Não entendi a data. Pode informar assim: "hoje", "amanhã" ou "25/06"?`;
    addUserTurn(text, slotState.flowId, {});
    addAgentTurn(msg, slotState.flowId);
    return {
      text: msg,
      intent: slotState.flowId,
      entities: { ...slotState.filledSlots },
      actionExecuted: false,
      awaitingConfirmation: false,
      awaitingInput: true,
      missingParam: slotName,
      source: "nlu",
      confidence: 0.9,
    };
  }

  // Preencher o slot com a resposta do usuário
  const remaining = fillSlot(slotName, text);

  addUserTurn(text, slotState.flowId, { [slotName]: text });

  if (Object.keys(remaining).length > 0) {
    const nextEntry = Object.entries(remaining)[0];
    const [nextSlotName, nextSlotPrompt] = nextEntry;

    // Gerar prompt contextual com o que já foi coletado
    let promptText = nextSlotPrompt as string;
    if (isLLMConfigured() && agentConfig) {
      try {
        const filled = { ...slotState.filledSlots, [slotName]: text };
        const filledDesc = Object.entries(filled).map(([k, v]) => `${k}="${v}"`).join(", ");
        promptText = await generateResponse(
          `Coletando dados para "${slotState.flowId}". Já temos: ${filledDesc}. Agora precisa de "${nextSlotName}". Pergunta curta e natural:`,
          undefined,
          agentConfig.businessContext,
        );
      } catch { /* usar prompt padrão */ }
    }

    addAgentTurn(promptText, slotState.flowId);

    return {
      text: promptText,
      intent: slotState.flowId,
      entities: { ...slotState.filledSlots, [slotName]: text },
      actionExecuted: false,
      awaitingConfirmation: false,
      awaitingInput: true,
      missingParam: nextSlotName,
      source: "nlu",
      confidence: 0.9,
    };
  }

  // Todos preenchidos agora
  clearSlotFilling();
  const allParams = { ...slotState.filledSlots, [slotName]: text };
  return await handleActionIntent(slotState.flowId, allParams, text, "nlu", 0.9);
}

// ─── Helpers ───────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeResponse(
  text: string,
  intent: string,
  entities: Record<string, string>,
  source: "nlu" | "llm" | "fallback",
  confidence: number,
): AgentResponse {
  return {
    text,
    intent,
    entities,
    actionExecuted: false,
    awaitingConfirmation: false,
    awaitingInput: false,
    source,
    confidence,
  };
}

function emptyResponse(text: string): AgentResponse {
  return makeResponse(text, "outro", {}, "fallback", 0);
}

function isDestructiveAction(intent: string): boolean {
  return ["cancelar_agendamento", "mover_agendamento", "reagendar"].includes(intent);
}

interface RequiredParam {
  key: string;
  label: string;
  prompt: string;
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
      return [
        { key: "date", label: "Data", prompt: "Cancelar agendamentos de qual data?" },
      ];
    case "mover_agendamento":
    case "reagendar":
      return [
        { key: "sourceDate", label: "Data de origem", prompt: "Mover de qual data?" },
        { key: "targetDate", label: "Data de destino", prompt: "Para qual data?" },
      ];
    default:
      return [];
  }
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
      if (entities.sourceDate) parts.push(`de ${entities.sourceDate}`);
      if (entities.targetDate) parts.push(`para ${entities.targetDate}`);
      if (entities.targetTime) parts.push(`às ${entities.targetTime}`);
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

function handleLocalQuery(
  intent: string,
  entities: Record<string, string>,
  userMessage: string,
): AgentResponse {
  // Respostas genéricas para intents de consulta sem LLM
  switch (intent) {
    case "ver_agendamentos":
      return makeResponse(
        "Consultando agendamentos... (conecte a função fetchSystemData para ver dados reais)",
        intent, entities, "fallback", 0.5,
      );
    case "ver_clientes":
    case "buscar_cliente":
      return makeResponse(
        "Consultando clientes... (conecte a função fetchSystemData para ver dados reais)",
        intent, entities, "fallback", 0.5,
      );
    case "ver_servicos":
      return makeResponse(
        "Consultando serviços... (conecte a função fetchSystemData para ver dados reais)",
        intent, entities, "fallback", 0.5,
      );
    case "ver_funcionarios":
      return makeResponse(
        "Consultando funcionários... (conecte a função fetchSystemData para ver dados reais)",
        intent, entities, "fallback", 0.5,
      );
    default:
      return makeResponse(
        "Desculpe, não entendi bem. Pode reformular? Tente algo como: 'Quais agendamentos de hoje?' ou 'Cancela o horário das 14h'.",
        intent, entities, "fallback", 0.2,
      );
  }
}

// ─── Exportações extras ────────────────────────────────────

/** Reseta o agente (limpa conversa e estado) */
export function resetAgent(): void {
  resetConversation();
}

/** Atualiza a página atual no contexto */
export function updateCurrentPage(page: string): void {
  setCurrentPage(page);
}

/** Retorna o resumo do contexto (para debug) */
export function getDebugContext(): string {
  return getContextSummaryForPrompt();
}
