/**
 * agentContext.ts — Memória de conversa e contexto do agente.
 * Mantém histórico de mensagens recentes, entidades extraídas,
 * perguntas pendentes e estado de fluxos multi-step.
 *
 * Recursos de continuidade:
 * - Rastreamento de tópico ativo (ex: "agendamentos do João")
 * - Resolução de referências pronominais ("dele", "essa", "aquele horário")
 * - Detecção de follow-up (mensagem que continua o mesmo assunto)
 * - Decay de entidades — entidades recentes têm mais relevância
 * - Resumo de contexto estruturado para prompts
 * - Slot-filling para fluxos multi-step (ex: agendar com parâmetros faltantes)
 * - Histórico de ações executadas para referências do tipo "desfaz isso"
 *
 * 100% client-side — persistido em localStorage.
 */

import type { ExtractedEntities } from "./agentNLU";

// ─── Tipos ─────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "agent";
  text: string;
  timestamp: number;
  intent?: string;
  entities?: ExtractedEntities;
  toolId?: string;
  /** Indica se este turno é follow-up do anterior */
  isFollowUp?: boolean;
  /** ID do tópico ativo quando este turno foi registrado */
  topicId?: string;
}

export interface PendingQuestion {
  id: string;
  toolId: string;
  missingParam: string;
  promptMessage: string;
  collectedParams: Record<string, string>;
  createdAt: number;
}

export interface PendingConfirmation {
  id: string;
  toolId: string;
  params: Record<string, string>;
  description: string;
  createdAt: number;
}

/** Entidade com metadados de quando/como foi extraída */
export interface TrackedEntity {
  key: string;
  value: string;
  /** Turno em que foi mencionada pela última vez (índice relativo) */
  lastMentionedTurn: number;
  /** Quantas vezes foi mencionada na conversa */
  mentionCount: number;
  /** Timestamp da última menção */
  lastMentionedAt: number;
  /** De qual tópico esta entidade veio */
  topicId?: string;
}

/** Tópico ativo de conversa */
export interface ConversationTopic {
  id: string;
  /** Categoria do tópico (ex: "agendamentos", "clientes", "servicos", "financeiro") */
  category: string;
  /** Entidades-chave associadas ao tópico */
  entities: Record<string, string>;
  /** Intent que iniciou o tópico */
  originIntent: string;
  /** Quando o tópico foi criado */
  createdAt: number;
  /** Quando o tópico foi referenciado pela última vez */
  lastActiveAt: number;
  /** Resumo legível do tópico */
  summary: string;
}

/** Estado de slot-filling para fluxos multi-step */
export interface SlotFillingState {
  /** ID do fluxo (ex: "agendar", "mover_agendamento") */
  flowId: string;
  /** Tool associada ao fluxo */
  toolId: string;
  /** Slots já preenchidos */
  filledSlots: Record<string, string>;
  /** Slots ainda faltantes (nome → descrição/prompt) */
  missingSlots: Record<string, string>;
  /** Quando o fluxo foi iniciado */
  startedAt: number;
  /** Último slot preenchido */
  lastFilledSlot?: string;
}

/** Registro de ação executada (para "desfaz isso", "o que foi feito", etc.) */
export interface ActionRecord {
  id: string;
  toolId: string;
  description: string;
  params: Record<string, string>;
  result: string;
  executedAt: number;
}

export interface ConversationContext {
  turns: ConversationTurn[];
  /** Entidades rastreadas com metadados de relevância */
  trackedEntities: TrackedEntity[];
  /** Entidades simples (compatibilidade) */
  lastEntities: ExtractedEntities;
  pendingQuestion: PendingQuestion | null;
  pendingConfirmation: PendingConfirmation | null;
  currentPage: string;
  sessionStartedAt: number;
  /** Tópico ativo da conversa */
  activeTopic: ConversationTopic | null;
  /** Histórico de tópicos recentes */
  topicHistory: ConversationTopic[];
  /** Estado de slot-filling ativo */
  slotFilling: SlotFillingState | null;
  /** Últimas ações executadas (para referência) */
  actionHistory: ActionRecord[];
  /** Contador de turnos total na sessão */
  totalTurnCount: number;
}

// ─── Constantes ──────────────────────────────────────────

const MAX_TURNS = 30;
const MAX_TRACKED_ENTITIES = 30;
const MAX_TOPICS = 10;
const MAX_ACTIONS = 15;
const STORAGE_KEY = "agent_conversation_context";
const CONTEXT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutos
const QUESTION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutos
const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000;
const SLOT_FILLING_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos
const TOPIC_EXPIRY_MS = 15 * 60 * 1000; // 15 minutos
/** Turnos máximos sem menção para uma entidade perder relevância */
const ENTITY_DECAY_TURNS = 8;

// ─── Palavras de referência (português) ─────────────────

const PRONOUN_REFS: Record<string, string[]> = {
  client: ["dele", "dela", "do cliente", "da cliente", "desse cliente", "dessa cliente", "do mesmo", "da mesma"],
  employee: ["do funcionario", "da funcionaria", "do profissional", "da profissional", "desse funcionario"],
  date: ["nesse dia", "nessa data", "no mesmo dia", "na mesma data", "nesse mesmo dia"],
  service: ["desse servico", "do servico", "do mesmo servico"],
  time: ["nesse horario", "no mesmo horario", "na mesma hora"],
};

/** Palavras que indicam continuação do tópico anterior */
const FOLLOW_UP_MARKERS = [
  "e ", "e os ", "e as ", "e o ", "e a ",
  "tambem", "alem disso", "mais algum", "mais alguma",
  "outro", "outra", "outros", "outras",
  "esse", "essa", "esses", "essas",
  "aquele", "aquela", "aqueles", "aquelas",
  "o mesmo", "a mesma", "os mesmos", "as mesmas",
  "dele", "dela", "deles", "delas",
  "ai", "entao", "agora",
  "e quanto", "e sobre", "e como",
  "sim", "nao", "pode", "ok", "isso",
  "qual", "quais", "quando", "onde",
];

/** Intents que tipicamente pertencem ao mesmo tópico */
const TOPIC_CATEGORIES: Record<string, string[]> = {
  agendamentos: [
    "ver_agendamentos", "agendar", "cancelar_agendamento", "reagendar",
    "mover_agendamento", "agendamentos_hoje", "agendamentos_amanha",
    "proximos_agendamentos", "agenda_action",
  ],
  clientes: [
    "ver_clientes", "buscar_cliente", "info_cliente", "novo_cliente",
    "editar_cliente", "historico_cliente",
  ],
  servicos: [
    "ver_servicos", "info_servico", "preco_servico",
  ],
  financeiro: [
    "ver_financeiro", "faturamento", "comissoes", "relatorio",
  ],
  funcionarios: [
    "ver_funcionarios", "info_funcionario", "escala",
  ],
};

// ─── Estado ──────────────────────────────────────────────

let context: ConversationContext = createFreshContext();

function createFreshContext(): ConversationContext {
  return {
    turns: [],
    trackedEntities: [],
    lastEntities: {},
    pendingQuestion: null,
    pendingConfirmation: null,
    currentPage: "/",
    sessionStartedAt: Date.now(),
    activeTopic: null,
    topicHistory: [],
    slotFilling: null,
    actionHistory: [],
    totalTurnCount: 0,
  };
}

// ─── Persistência ────────────────────────────────────────

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
  } catch (err) {
    console.error("[agentContext] Falha ao salvar contexto:", err);
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ConversationContext;
      // Verificar expiração da sessão
      if (Date.now() - parsed.sessionStartedAt > CONTEXT_EXPIRY_MS) {
        context = createFreshContext();
      } else {
        // Migrar campos que podem não existir em contextos antigos
        context = {
          ...createFreshContext(),
          ...parsed,
        };
      }
    }
  } catch (err) {
    console.error("[agentContext] Falha ao carregar contexto:", err);
    context = createFreshContext();
  }
}

// Inicializar
load();

// ─── Helpers internos ────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCategoryForIntent(intent: string): string | null {
  for (const [category, intents] of Object.entries(TOPIC_CATEGORIES)) {
    if (intents.includes(intent)) return category;
  }
  return null;
}

// ─── Detecção de follow-up ──────────────────────────────

/**
 * Detecta se a mensagem do usuário é um follow-up da conversa anterior.
 * Usa múltiplos sinais: marcadores linguísticos, brevidade, referências pronominais,
 * e proximidade temporal.
 */
export function detectFollowUp(text: string): {
  isFollowUp: boolean;
  confidence: number;
  resolvedRefs: Record<string, string>;
} {
  const q = normalize(text);
  let score = 0;
  const resolvedRefs: Record<string, string> = {};

  // Se não há conversa anterior, não é follow-up
  if (context.turns.length === 0) {
    return { isFollowUp: false, confidence: 0, resolvedRefs };
  }

  const lastTurn = context.turns[context.turns.length - 1];
  const timeSinceLast = Date.now() - lastTurn.timestamp;

  // 1. Proximidade temporal — se a última mensagem foi há menos de 2 min
  if (timeSinceLast < 2 * 60 * 1000) score += 0.15;
  else if (timeSinceLast < 5 * 60 * 1000) score += 0.05;

  // 2. Mensagem curta (menos de 6 palavras) — provável follow-up
  const wordCount = q.split(" ").length;
  if (wordCount <= 3) score += 0.25;
  else if (wordCount <= 6) score += 0.15;

  // 3. Começa com marcador de follow-up
  for (const marker of FOLLOW_UP_MARKERS) {
    if (q.startsWith(marker) || q === marker.trim()) {
      score += 0.3;
      break;
    }
  }

  // 4. Contém referências pronominais — resolver para entidades conhecidas
  for (const [entityType, pronouns] of Object.entries(PRONOUN_REFS)) {
    for (const pronoun of pronouns) {
      const normPronoun = normalize(pronoun);
      if (q.includes(normPronoun)) {
        score += 0.25;
        // Tentar resolver a referência
        const resolved = resolveEntityReference(entityType);
        if (resolved) {
          resolvedRefs[entityType] = resolved;
        }
        break; // Conta uma vez por tipo de entidade
      }
    }
  }

  // 5. Última resposta do agente foi uma pergunta (termina com ?)
  if (lastTurn.role === "agent" && lastTurn.text.trim().endsWith("?")) {
    score += 0.2;
  }

  // 6. Há pergunta pendente ou confirmação pendente
  if (context.pendingQuestion || context.pendingConfirmation) {
    score += 0.3;
  }

  // 7. Há slot-filling ativo
  if (context.slotFilling && !isSlotFillingExpired()) {
    score += 0.3;
  }

  // 8. Mesmo tópico ativo
  if (context.activeTopic && !isTopicExpired(context.activeTopic)) {
    score += 0.1;
  }

  const confidence = Math.min(score, 1.0);
  return {
    isFollowUp: confidence >= 0.3,
    confidence,
    resolvedRefs,
  };
}

// ─── Resolução de referências ───────────────────────────

/**
 * Resolve uma referência pronominal para o valor da entidade mais recente daquele tipo.
 * Ex: "dele" → resolve para o nome do último cliente mencionado.
 */
function resolveEntityReference(entityType: string): string | null {
  // Mapear tipo de referência para chaves de entidade
  const typeToKeys: Record<string, string[]> = {
    client: ["clientName", "client", "cliente"],
    employee: ["employeeName", "employee", "funcionario", "profissional"],
    date: ["date", "sourceDate", "targetDate", "data"],
    service: ["serviceName", "service", "servico"],
    time: ["time", "targetTime", "horario", "hora"],
  };

  const keys = typeToKeys[entityType];
  if (!keys) return null;

  // Buscar nas entidades rastreadas (mais recente primeiro)
  const sorted = [...context.trackedEntities]
    .filter(e => keys.includes(e.key))
    .sort((a, b) => b.lastMentionedAt - a.lastMentionedAt);

  if (sorted.length > 0) return sorted[0].value;

  // Fallback: buscar em lastEntities
  for (const key of keys) {
    const val = context.lastEntities[key];
    if (val) return String(val);
  }

  return null;
}

/**
 * Resolve todas as referências pronominais em um texto e retorna
 * as entidades que devem ser mescladas no contexto atual.
 */
export function resolveReferences(text: string): ExtractedEntities {
  const q = normalize(text);
  const resolved: ExtractedEntities = {};

  for (const [entityType, pronouns] of Object.entries(PRONOUN_REFS)) {
    for (const pronoun of pronouns) {
      if (q.includes(normalize(pronoun))) {
        const value = resolveEntityReference(entityType);
        if (value) {
          // Mapear de volta para a chave canônica
          const canonicalKey: Record<string, string> = {
            client: "clientName",
            employee: "employeeName",
            date: "date",
            service: "serviceName",
            time: "time",
          };
          const key = canonicalKey[entityType];
          if (key) resolved[key] = value;
        }
        break;
      }
    }
  }

  return resolved;
}

// ─── Rastreamento de entidades com decay ────────────────

/**
 * Atualiza uma entidade rastreada: cria nova ou atualiza a existente.
 */
function trackEntity(key: string, value: string, topicId?: string): void {
  const existing = context.trackedEntities.find(e => e.key === key);
  if (existing) {
    existing.value = value;
    existing.lastMentionedTurn = context.totalTurnCount;
    existing.mentionCount++;
    existing.lastMentionedAt = Date.now();
    if (topicId) existing.topicId = topicId;
  } else {
    context.trackedEntities.push({
      key,
      value,
      lastMentionedTurn: context.totalTurnCount,
      mentionCount: 1,
      lastMentionedAt: Date.now(),
      topicId,
    });
  }

  // Limitar e remover entidades muito antigas
  if (context.trackedEntities.length > MAX_TRACKED_ENTITIES) {
    // Remover as mais antigas e menos mencionadas
    context.trackedEntities.sort((a, b) => {
      const aScore = entityRelevanceScore(a);
      const bScore = entityRelevanceScore(b);
      return bScore - aScore;
    });
    context.trackedEntities = context.trackedEntities.slice(0, MAX_TRACKED_ENTITIES);
  }
}

/**
 * Calcula score de relevância de uma entidade (0 a 1).
 * Considera: recência, frequência de menção e se pertence ao tópico ativo.
 */
function entityRelevanceScore(entity: TrackedEntity): number {
  const turnsSinceLastMention = context.totalTurnCount - entity.lastMentionedTurn;

  // Decay baseado em turnos
  const recencyScore = Math.max(0, 1 - (turnsSinceLastMention / ENTITY_DECAY_TURNS));

  // Frequência (log scale)
  const frequencyScore = Math.min(1, Math.log2(entity.mentionCount + 1) / 4);

  // Bônus se pertence ao tópico ativo
  const topicBonus =
    context.activeTopic && entity.topicId === context.activeTopic.id ? 0.3 : 0;

  return (recencyScore * 0.5) + (frequencyScore * 0.2) + topicBonus;
}

/**
 * Retorna as entidades mais relevantes no contexto atual.
 * Filtra entidades com decay alto (pouco relevantes).
 */
export function getRelevantEntities(minRelevance = 0.15): Record<string, string> {
  const result: Record<string, string> = {};

  const sorted = [...context.trackedEntities]
    .map(e => ({ ...e, score: entityRelevanceScore(e) }))
    .filter(e => e.score >= minRelevance)
    .sort((a, b) => b.score - a.score);

  for (const entity of sorted) {
    // Se já temos um valor para essa chave, manter o mais relevante (já ordenado)
    if (!(entity.key in result)) {
      result[entity.key] = entity.value;
    }
  }

  return result;
}

// ─── Tópicos de conversa ────────────────────────────────

function isTopicExpired(topic: ConversationTopic): boolean {
  return Date.now() - topic.lastActiveAt > TOPIC_EXPIRY_MS;
}

/**
 * Atualiza ou cria o tópico ativo com base no intent e entidades.
 * Se o intent pertence à mesma categoria do tópico ativo, atualiza;
 * caso contrário, arquiva o antigo e cria um novo.
 */
export function updateTopic(intent: string, entities: ExtractedEntities): void {
  const category = getCategoryForIntent(intent);
  if (!category) return;

  const now = Date.now();

  // Se existe tópico ativo e é da mesma categoria, atualizar
  if (
    context.activeTopic &&
    context.activeTopic.category === category &&
    !isTopicExpired(context.activeTopic)
  ) {
    context.activeTopic.entities = { ...context.activeTopic.entities, ...stringifyEntities(entities) };
    context.activeTopic.lastActiveAt = now;
    context.activeTopic.summary = buildTopicSummary(category, context.activeTopic.entities);
    save();
    return;
  }

  // Arquivar tópico antigo
  if (context.activeTopic) {
    context.topicHistory.push(context.activeTopic);
    if (context.topicHistory.length > MAX_TOPICS) {
      context.topicHistory = context.topicHistory.slice(-MAX_TOPICS);
    }
  }

  // Criar novo tópico
  const topicEntities = stringifyEntities(entities);
  context.activeTopic = {
    id: `topic_${now}`,
    category,
    entities: topicEntities,
    originIntent: intent,
    createdAt: now,
    lastActiveAt: now,
    summary: buildTopicSummary(category, topicEntities),
  };

  save();
}

function stringifyEntities(entities: ExtractedEntities): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

function buildTopicSummary(category: string, entities: Record<string, string>): string {
  const parts: string[] = [];

  switch (category) {
    case "agendamentos":
      if (entities.clientName) parts.push(`cliente: ${entities.clientName}`);
      if (entities.employeeName) parts.push(`funcionário: ${entities.employeeName}`);
      if (entities.date || entities.sourceDate) parts.push(`data: ${entities.date ?? entities.sourceDate}`);
      return `Agendamentos${parts.length ? ` (${parts.join(", ")})` : ""}`;
    case "clientes":
      if (entities.clientName) parts.push(entities.clientName);
      return `Clientes${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    case "servicos":
      if (entities.serviceName) parts.push(entities.serviceName);
      return `Serviços${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    case "financeiro":
      return "Financeiro";
    case "funcionarios":
      if (entities.employeeName) parts.push(entities.employeeName);
      return `Funcionários${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    default:
      return category;
  }
}

/** Retorna o tópico ativo (se não expirou) */
export function getActiveTopic(): ConversationTopic | null {
  if (!context.activeTopic) return null;
  if (isTopicExpired(context.activeTopic)) {
    // Arquivar e limpar
    context.topicHistory.push(context.activeTopic);
    context.activeTopic = null;
    save();
    return null;
  }
  return context.activeTopic;
}

/** Retorna o histórico de tópicos recentes */
export function getTopicHistory(): ConversationTopic[] {
  return [...context.topicHistory];
}

// ─── Slot-filling ───────────────────────────────────────

function isSlotFillingExpired(): boolean {
  if (!context.slotFilling) return true;
  return Date.now() - context.slotFilling.startedAt > SLOT_FILLING_EXPIRY_MS;
}

/** Inicia um fluxo de slot-filling */
export function startSlotFilling(
  flowId: string,
  toolId: string,
  filledSlots: Record<string, string>,
  missingSlots: Record<string, string>,
): void {
  context.slotFilling = {
    flowId,
    toolId,
    filledSlots,
    missingSlots,
    startedAt: Date.now(),
  };
  save();
}

/** Preenche um slot e retorna os slots ainda faltantes */
export function fillSlot(slotName: string, value: string): Record<string, string> {
  if (!context.slotFilling || isSlotFillingExpired()) return {};

  context.slotFilling.filledSlots[slotName] = value;
  context.slotFilling.lastFilledSlot = slotName;
  delete context.slotFilling.missingSlots[slotName];
  save();

  return { ...context.slotFilling.missingSlots };
}

/** Retorna o estado atual do slot-filling (se ativo) */
export function getSlotFillingState(): SlotFillingState | null {
  if (!context.slotFilling || isSlotFillingExpired()) return null;
  return { ...context.slotFilling };
}

/** Finaliza o fluxo de slot-filling */
export function clearSlotFilling(): void {
  context.slotFilling = null;
  save();
}

// ─── Histórico de ações ─────────────────────────────────

/** Registra uma ação executada */
export function recordAction(
  toolId: string,
  description: string,
  params: Record<string, string>,
  result: string,
): void {
  context.actionHistory.push({
    id: `act_${Date.now()}`,
    toolId,
    description,
    params,
    result,
    executedAt: Date.now(),
  });

  if (context.actionHistory.length > MAX_ACTIONS) {
    context.actionHistory = context.actionHistory.slice(-MAX_ACTIONS);
  }

  save();
}

/** Retorna a última ação executada */
export function getLastAction(): ActionRecord | null {
  return context.actionHistory.length > 0
    ? context.actionHistory[context.actionHistory.length - 1]
    : null;
}

/** Retorna as últimas N ações */
export function getRecentActions(n = 5): ActionRecord[] {
  return context.actionHistory.slice(-n);
}

// ─── API Pública — Turnos ────────────────────────────────

/** Adiciona uma mensagem do usuário ao contexto */
export function addUserTurn(
  text: string,
  intent?: string,
  entities?: ExtractedEntities,
  toolId?: string,
): void {
  context.totalTurnCount++;

  // Detectar follow-up
  const followUp = detectFollowUp(text);

  // Se é follow-up, mesclar referências resolvidas com as entidades
  let mergedEntities = entities ? { ...entities } : undefined;
  if (followUp.isFollowUp && Object.keys(followUp.resolvedRefs).length > 0) {
    mergedEntities = { ...followUp.resolvedRefs, ...(mergedEntities ?? {}) };
  }

  // Se é follow-up sem entidades próprias, herdar entidades do tópico ativo
  if (followUp.isFollowUp && context.activeTopic && (!entities || Object.keys(entities).length === 0)) {
    mergedEntities = { ...context.activeTopic.entities, ...(mergedEntities ?? {}) };
  }

  context.turns.push({
    role: "user",
    text,
    timestamp: Date.now(),
    intent,
    entities: mergedEntities,
    toolId,
    isFollowUp: followUp.isFollowUp,
    topicId: context.activeTopic?.id,
  });

  // Rastrear entidades com metadados
  if (mergedEntities) {
    for (const [key, value] of Object.entries(mergedEntities)) {
      if (value !== undefined && value !== null) {
        trackEntity(key, String(value), context.activeTopic?.id);
      }
    }
    // Manter compatibilidade com lastEntities
    context.lastEntities = { ...context.lastEntities, ...mergedEntities };
  }

  // Atualizar tópico
  if (intent) {
    updateTopic(intent, mergedEntities ?? {});
  } else if (followUp.isFollowUp && context.activeTopic) {
    // Se é follow-up, manter tópico ativo
    context.activeTopic.lastActiveAt = Date.now();
  }

  // Limitar tamanho
  if (context.turns.length > MAX_TURNS) {
    context.turns = context.turns.slice(-MAX_TURNS);
  }

  save();
}

/** Adiciona uma resposta do agente ao contexto */
export function addAgentTurn(text: string, intent?: string, toolId?: string): void {
  context.totalTurnCount++;

  context.turns.push({
    role: "agent",
    text,
    timestamp: Date.now(),
    intent,
    toolId,
    topicId: context.activeTopic?.id,
  });

  if (context.turns.length > MAX_TURNS) {
    context.turns = context.turns.slice(-MAX_TURNS);
  }

  save();
}

/** Retorna os últimos N turnos */
export function getRecentTurns(n = 6): ConversationTurn[] {
  return context.turns.slice(-n);
}

/** Retorna todas as entidades acumuladas (compatibilidade) */
export function getLastEntities(): ExtractedEntities {
  return { ...context.lastEntities };
}

/** Mescla novas entidades com as acumuladas */
export function mergeEntities(entities: ExtractedEntities): ExtractedEntities {
  context.lastEntities = { ...context.lastEntities, ...entities };

  // Também rastrear com metadados
  for (const [key, value] of Object.entries(entities)) {
    if (value !== undefined && value !== null) {
      trackEntity(key, String(value), context.activeTopic?.id);
    }
  }

  save();
  return { ...context.lastEntities };
}

/** Limpa entidades acumuladas */
export function clearEntities(): void {
  context.lastEntities = {};
  context.trackedEntities = [];
  save();
}

// ─── Perguntas pendentes ────────────────────────────────

/** Define uma pergunta pendente (pedindo parâmetro faltante) */
export function setPendingQuestion(
  toolId: string,
  missingParam: string,
  promptMessage: string,
  collectedParams: Record<string, string>,
): void {
  context.pendingQuestion = {
    id: `pq_${Date.now()}`,
    toolId,
    missingParam,
    promptMessage,
    collectedParams,
    createdAt: Date.now(),
  };
  save();
}

/** Retorna a pergunta pendente (se existir e não expirou) */
export function getPendingQuestion(): PendingQuestion | null {
  if (!context.pendingQuestion) return null;
  if (Date.now() - context.pendingQuestion.createdAt > QUESTION_EXPIRY_MS) {
    context.pendingQuestion = null;
    save();
    return null;
  }
  return context.pendingQuestion;
}

/** Limpa a pergunta pendente */
export function clearPendingQuestion(): void {
  context.pendingQuestion = null;
  save();
}

// ─── Confirmações pendentes ─────────────────────────────

/** Define uma confirmação pendente */
export function setPendingConfirmation(
  toolId: string,
  params: Record<string, string>,
  description: string,
): void {
  context.pendingConfirmation = {
    id: `pc_${Date.now()}`,
    toolId,
    params,
    description,
    createdAt: Date.now(),
  };
  save();
}

/** Retorna a confirmação pendente */
export function getPendingConfirmation(): PendingConfirmation | null {
  if (!context.pendingConfirmation) return null;
  if (Date.now() - context.pendingConfirmation.createdAt > CONFIRMATION_EXPIRY_MS) {
    context.pendingConfirmation = null;
    save();
    return null;
  }
  return context.pendingConfirmation;
}

/** Limpa a confirmação pendente */
export function clearPendingConfirmation(): void {
  context.pendingConfirmation = null;
  save();
}

// ─── Página atual ───────────────────────────────────────

export function setCurrentPage(page: string): void {
  context.currentPage = page;
  save();
}

export function getCurrentPage(): string {
  return context.currentPage;
}

// ─── Utilidades ─────────────────────────────────────────

/** Verifica se houve conversa recente (últimos 5 min) */
export function hasRecentConversation(): boolean {
  const lastTurn = context.turns[context.turns.length - 1];
  if (!lastTurn) return false;
  return Date.now() - lastTurn.timestamp < 5 * 60 * 1000;
}

/** Retorna a última intenção detectada */
export function getLastIntent(): string | null {
  for (let i = context.turns.length - 1; i >= 0; i--) {
    const intent = context.turns[i].intent;
    if (intent) return intent;
  }
  return null;
}

/** Retorna o último tool executado */
export function getLastToolId(): string | null {
  for (let i = context.turns.length - 1; i >= 0; i--) {
    const toolId = context.turns[i].toolId;
    if (toolId) return toolId;
  }
  return null;
}

/** Verifica se o usuário mencionou algo específico recentemente */
export function userMentionedRecently(keyword: string, turnsBack = 4): boolean {
  const recent = context.turns.slice(-turnsBack);
  const norm = normalize(keyword);
  return recent.some(
    t => t.role === "user" && normalize(t.text).includes(norm),
  );
}

/**
 * Gera um resumo estruturado do contexto atual para uso em prompts.
 * Inclui: tópico ativo, entidades relevantes, última ação, slot-filling.
 */
export function getContextSummaryForPrompt(): string {
  const parts: string[] = [];

  // Tópico ativo
  const topic = getActiveTopic();
  if (topic) {
    parts.push(`Tópico ativo: ${topic.summary}`);
  }

  // Entidades relevantes
  const entities = getRelevantEntities(0.2);
  if (Object.keys(entities).length > 0) {
    const entList = Object.entries(entities)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    parts.push(`Entidades: ${entList}`);
  }

  // Slot-filling ativo
  const slots = getSlotFillingState();
  if (slots) {
    const filled = Object.entries(slots.filledSlots).map(([k, v]) => `${k}=${v}`).join(", ");
    const missing = Object.keys(slots.missingSlots).join(", ");
    parts.push(`Fluxo "${slots.flowId}": preenchidos=[${filled}], faltam=[${missing}]`);
  }

  // Pergunta pendente
  const pq = getPendingQuestion();
  if (pq) {
    parts.push(`Aguardando resposta: ${pq.missingParam} (${pq.promptMessage})`);
  }

  // Confirmação pendente
  const pc = getPendingConfirmation();
  if (pc) {
    parts.push(`Aguardando confirmação: ${pc.description}`);
  }

  // Última ação
  const lastAction = getLastAction();
  if (lastAction) {
    const elapsed = Math.round((Date.now() - lastAction.executedAt) / 1000);
    if (elapsed < 300) {
      parts.push(`Última ação (${elapsed}s atrás): ${lastAction.description}`);
    }
  }

  // Últimos turnos para contexto imediato
  const recent = getRecentTurns(4);
  if (recent.length > 0) {
    const turnsSummary = recent
      .map(t => `${t.role === "user" ? "Usuário" : "Agente"}: "${truncate(t.text, 80)}"`)
      .join(" → ");
    parts.push(`Conversa recente: ${turnsSummary}`);
  }

  return parts.length > 0 ? parts.join("\n") : "Sem contexto prévio.";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

/** Reseta toda a conversa */
export function resetConversation(): void {
  context = createFreshContext();
  save();
}

/** Retorna o contexto completo (para debug) */
export function getFullContext(): ConversationContext {
  return { ...context };
}
