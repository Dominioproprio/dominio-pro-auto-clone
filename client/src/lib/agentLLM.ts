/**
 * agentLLM.ts — Integração com GitHub Models API (gratuito).
 * Transforma o agente rule-based em um assistente com conversação natural
 * usando LLMs via a API compatível com OpenAI do GitHub Models.
 *
 * Requisitos:
 *   - GitHub Personal Access Token (PAT) com scope "models:read"
 *   - Criar em: https://github.com/settings/tokens → Fine-grained → selecionar "Models: Read"
 *
 * Modelos gratuitos recomendados:
 *   - "openai/gpt-4o-mini"   → rápido, barato, ótimo para chat (recomendado)
 *   - "openai/gpt-4o"        → mais inteligente, mais lento
 *   - "meta/llama-3.1-70b"   → open-source, bom desempenho
 *   - "deepseek/deepseek-r1" → bom raciocínio lógico
 *
 * Uso:
 *   import { sendToLLM, classifyIntent, generateResponse } from "./agentLLM";
 */

import {
  getContextSummaryForPrompt,
  getRecentTurns,
  getActiveTopic,
  getRelevantEntities,
  getSlotFillingState,
  getPendingQuestion,
  getPendingConfirmation,
} from "./agentContext";

// ─── Tipos ─────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  /** GitHub PAT com scope models:read */
  apiToken: string;
  /** Modelo a usar (default: "openai/gpt-4o-mini") */
  model?: string;
  /** Temperatura (0-1, default: 0.4) */
  temperature?: number;
  /** Máximo de tokens na resposta (default: 800) */
  maxTokens?: number;
  /** Timeout em ms (default: 15000) */
  timeout?: number;
}

export interface LLMResponse {
  content: string;
  intent?: string;
  entities?: Record<string, string>;
  action?: string;
  confidence?: number;
}

export interface IntentClassification {
  intent: string;
  confidence: number;
  entities: Record<string, string>;
  requiresAction: boolean;
  actionType?: string;
}

// ─── Configuração ──────────────────────────────────────────

const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_TIMEOUT = 15000;

const CONFIG_STORAGE_KEY = "agent_llm_config";

let currentConfig: LLMConfig | null = null;

/** Salva a configuração do LLM (token, modelo, etc.) */
export function configureLLM(config: LLMConfig): void {
  currentConfig = config;
  try {
    // Salvar sem o token (segurança)
    const safeConfig = { ...config, apiToken: "***" };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(safeConfig));
  } catch { /* ignore */ }
}

/** Retorna se o LLM está configurado e pronto */
export function isLLMConfigured(): boolean {
  return currentConfig !== null && currentConfig.apiToken.length > 0;
}

/** Define apenas o token (atalho) */
export function setApiToken(token: string): void {
  if (currentConfig) {
    currentConfig.apiToken = token;
  } else {
    currentConfig = { apiToken: token };
  }
}

// ─── System Prompt ─────────────────────────────────────────

function buildSystemPrompt(businessContext?: string): string {
  const contextSummary = getContextSummaryForPrompt();

  return `Você é um assistente virtual inteligente de um sistema de agendamentos (salão de beleza / barbearia / clínica).

## Seu papel
- Ajudar o usuário a gerenciar agendamentos, clientes, serviços e funcionários
- Responder perguntas sobre a agenda de forma clara e objetiva
- Executar ações como agendar, mover, cancelar e reagendar quando solicitado
- Manter continuidade na conversa, lembrando do contexto anterior

## Regras de comportamento
1. Responda SEMPRE em português brasileiro
2. Seja conciso e direto — máximo 2-3 frases para respostas simples
3. Quando o usuário pedir uma ação destrutiva (cancelar, mover, excluir), SEMPRE peça confirmação antes
4. Se faltar informação para executar uma ação, pergunte o que falta de forma natural
5. Use o contexto da conversa para entender referências como "dele", "amanhã", "esse horário"
6. Nunca invente dados — se não tem a informação, diga que não encontrou
7. Quando listar agendamentos, formate de forma legível com data, hora, cliente e serviço

## Contexto atual do sistema
${businessContext ?? "Sistema de agendamentos padrão."}

## Contexto da conversa
${contextSummary}

## Formato de resposta para ações
Quando o usuário pedir uma AÇÃO (agendar, mover, cancelar, etc.), responda TAMBÉM com um bloco JSON no final:
\`\`\`action
{
  "intent": "nome_da_intencao",
  "entities": { "chave": "valor" },
  "action": "tipo_da_acao",
  "requiresConfirmation": true/false
}
\`\`\`

Intents possíveis: ver_agendamentos, agendar, cancelar_agendamento, reagendar, mover_agendamento, ver_clientes, buscar_cliente, ver_servicos, ver_funcionarios, info_geral, saudacao, despedida, confirmar, negar, ajuda

Se for apenas uma pergunta ou conversa, NÃO inclua o bloco action.`;
}

// ─── Chamada à API ─────────────────────────────────────────

/**
 * Envia mensagens para o GitHub Models API e retorna a resposta.
 * Trata erros de rede, timeout e rate limiting.
 */
async function callGitHubModelsAPI(messages: LLMMessage[]): Promise<string> {
  if (!currentConfig || !currentConfig.apiToken) {
    throw new Error("LLM não configurado. Chame configureLLM() com seu GitHub token.");
  }

  const model = currentConfig.model ?? DEFAULT_MODEL;
  const temperature = currentConfig.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = currentConfig.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeout = currentConfig.timeout ?? DEFAULT_TIMEOUT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(GITHUB_MODELS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${currentConfig.apiToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: 0.95,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");

      if (response.status === 401) {
        throw new Error("Token do GitHub inválido ou sem permissão 'models:read'. Verifique seu PAT.");
      }
      if (response.status === 429) {
        throw new Error("Limite de requisições atingido. Aguarde alguns segundos e tente novamente.");
      }
      if (response.status === 422) {
        throw new Error(`Modelo "${model}" não suportado ou parâmetros inválidos.`);
      }

      throw new Error(`Erro na API (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Resposta vazia do modelo.");
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timeout: o modelo demorou demais para responder. Tente novamente.");
    }

    throw err;
  }
}

// ─── Funções de alto nível ─────────────────────────────────

/**
 * Envia uma mensagem do usuário ao LLM com todo o contexto da conversa.
 * Retorna a resposta processada com intent/entities extraídos se aplicável.
 */
export async function sendToLLM(
  userMessage: string,
  businessContext?: string,
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt(businessContext);

  // Construir histórico de mensagens a partir dos turnos recentes
  const recentTurns = getRecentTurns(8);
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Adicionar turnos anteriores como contexto
  for (const turn of recentTurns) {
    // Não incluir o turno atual (será adicionado como a mensagem do user)
    if (turn.text === userMessage && turn === recentTurns[recentTurns.length - 1]) continue;

    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }

  // Adicionar mensagem atual
  messages.push({ role: "user", content: userMessage });

  const rawResponse = await callGitHubModelsAPI(messages);

  // Parsear resposta — extrair bloco action se existir
  return parseResponse(rawResponse);
}

/**
 * Classifica a intenção de uma mensagem usando o LLM.
 * Mais preciso que regex para mensagens ambíguas ou conversacionais.
 */
export async function classifyIntent(userMessage: string): Promise<IntentClassification> {
  const contextSummary = getContextSummaryForPrompt();

  const classificationPrompt = `Classifique a intenção da mensagem do usuário abaixo.

Contexto da conversa:
${contextSummary}

Mensagem: "${userMessage}"

Responda APENAS com JSON (sem markdown, sem explicação):
{
  "intent": "nome_da_intencao",
  "confidence": 0.0 a 1.0,
  "entities": { "chave": "valor" },
  "requiresAction": true/false,
  "actionType": "tipo_se_aplicavel"
}

Intents possíveis:
- ver_agendamentos: quer ver/listar agendamentos
- agendar: quer criar novo agendamento
- cancelar_agendamento: quer cancelar agendamento(s)
- reagendar / mover_agendamento: quer mudar data/hora de agendamento(s)
- ver_clientes / buscar_cliente: quer ver/buscar clientes
- ver_servicos: quer ver serviços disponíveis
- ver_funcionarios: quer ver funcionários
- info_geral: pergunta geral sobre o negócio
- saudacao: oi, bom dia, etc.
- despedida: tchau, até mais, etc.
- confirmar: sim, pode, ok (confirmando ação anterior)
- negar: não, cancela (negando ação anterior)
- ajuda: pedindo ajuda
- outro: não se encaixa em nenhuma

Entities possíveis: clientName, employeeName, serviceName, date, time, dayOfWeek`;

  const messages: LLMMessage[] = [
    { role: "system", content: "Você é um classificador de intenções. Responda SOMENTE com JSON válido." },
    { role: "user", content: classificationPrompt },
  ];

  try {
    const rawResponse = await callGitHubModelsAPI(messages);

    // Limpar e parsear JSON
    const jsonStr = rawResponse
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(jsonStr);

    return {
      intent: parsed.intent ?? "outro",
      confidence: parsed.confidence ?? 0.5,
      entities: parsed.entities ?? {},
      requiresAction: parsed.requiresAction ?? false,
      actionType: parsed.actionType,
    };
  } catch {
    // Fallback se o LLM não retornar JSON válido
    return {
      intent: "outro",
      confidence: 0.3,
      entities: {},
      requiresAction: false,
    };
  }
}

/**
 * Gera uma resposta natural para o usuário usando o LLM.
 * Usa dados reais do sistema (agendamentos, clientes) para contextualizar.
 */
export async function generateResponse(
  userMessage: string,
  systemData?: string,
  businessContext?: string,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(businessContext);

  const recentTurns = getRecentTurns(6);
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Adicionar dados do sistema se fornecidos
  if (systemData) {
    messages.push({
      role: "system",
      content: `Dados relevantes do sistema:\n${systemData}`,
    });
  }

  // Adicionar histórico
  for (const turn of recentTurns) {
    if (turn.text === userMessage && turn === recentTurns[recentTurns.length - 1]) continue;
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const rawResponse = await callGitHubModelsAPI(messages);
    // Remover bloco action da resposta visível (se houver)
    return rawResponse.replace(/```action[\s\S]*?```/g, "").trim();
  } catch (err) {
    console.error("[agentLLM] Erro ao gerar resposta:", err);
    return getFallbackResponse(userMessage);
  }
}

// ─── Parser de resposta ────────────────────────────────────

function parseResponse(raw: string): LLMResponse {
  const result: LLMResponse = {
    content: raw,
  };

  // Extrair bloco ```action ... ```
  const actionMatch = raw.match(/```action\s*([\s\S]*?)```/);
  if (actionMatch) {
    try {
      const actionData = JSON.parse(actionMatch[1]);
      result.intent = actionData.intent;
      result.entities = actionData.entities;
      result.action = actionData.action;
      result.confidence = actionData.confidence ?? 0.8;
    } catch {
      // JSON inválido no bloco action — ignorar
    }
    // Remover bloco action do conteúdo visível
    result.content = raw.replace(/```action[\s\S]*?```/g, "").trim();
  }

  return result;
}

// ─── Fallback (quando LLM falha) ──────────────────────────

function getFallbackResponse(userMessage: string): string {
  const q = userMessage.toLowerCase();

  if (/oi|ola|bom dia|boa tarde|boa noite/.test(q)) {
    return "Olá! Como posso ajudar com a agenda hoje?";
  }
  if (/obrigad|valeu|vlw/.test(q)) {
    return "De nada! Precisa de mais alguma coisa?";
  }
  if (/tchau|ate mais|ate logo/.test(q)) {
    return "Até mais! Qualquer coisa é só chamar.";
  }

  return "Desculpe, não consegui processar sua mensagem agora. Pode tentar novamente?";
}

// ─── Utilitários ───────────────────────────────────────────

/**
 * Testa a conexão com o GitHub Models API.
 * Retorna true se está funcionando, ou uma mensagem de erro.
 */
export async function testConnection(): Promise<{ ok: boolean; message: string; model?: string }> {
  if (!currentConfig || !currentConfig.apiToken) {
    return { ok: false, message: "Token não configurado." };
  }

  try {
    const model = currentConfig.model ?? DEFAULT_MODEL;
    const response = await callGitHubModelsAPI([
      { role: "system", content: "Responda apenas: OK" },
      { role: "user", content: "Teste de conexão" },
    ]);

    return {
      ok: true,
      message: `Conexão OK! Modelo: ${model}`,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}

/**
 * Retorna a lista de modelos recomendados para uso gratuito.
 */
export function getAvailableModels(): Array<{ id: string; name: string; description: string }> {
  return [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini",
      description: "Rápido e eficiente. Melhor custo-benefício para chat. (Recomendado)",
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      description: "Mais inteligente, ideal para raciocínio complexo. Mais lento.",
    },
    {
      id: "openai/gpt-4.1",
      name: "GPT-4.1",
      description: "Versão mais recente da OpenAI. Melhor desempenho geral.",
    },
    {
      id: "meta/llama-3.1-70b-instruct",
      name: "Llama 3.1 70B",
      description: "Open-source da Meta. Bom desempenho, sem restrições comerciais.",
    },
    {
      id: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      description: "Bom para raciocínio lógico e matemática.",
    },
    {
      id: "mistral-ai/mistral-large",
      name: "Mistral Large",
      description: "Modelo europeu. Bom multilíngue incluindo português.",
    },
  ];
}
