/**
 * agentContext.ts — Memória de conversa e contexto do agente.
 * Mantém histórico de mensagens recentes, entidades extraídas,
 * perguntas pendentes e estado de fluxos multi-step.
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

export interface ConversationContext {
  turns: ConversationTurn[];
  lastEntities: ExtractedEntities;
  pendingQuestion: PendingQuestion | null;
  pendingConfirmation: PendingConfirmation | null;
  currentPage: string;
  sessionStartedAt: number;
}

// ─── Constantes ──────────────────────────────────────────

const MAX_TURNS = 20;
const STORAGE_KEY = "agent_conversation_context";
const CONTEXT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutos

// ─── Estado ──────────────────────────────────────────────

let context: ConversationContext = createFreshContext();

function createFreshContext(): ConversationContext {
  return {
    turns: [],
    lastEntities: {},
    pendingQuestion: null,
    pendingConfirmation: null,
    currentPage: "/",
    sessionStartedAt: Date.now(),
  };
}

// ─── Persistência ────────────────────────────────────────

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
  } catch { /* ignore quota errors */ }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ConversationContext;
      // Verificar expiração
      if (Date.now() - parsed.sessionStartedAt > CONTEXT_EXPIRY_MS) {
        context = createFreshContext();
      } else {
        context = parsed;
      }
    }
  } catch {
    context = createFreshContext();
  }
}

// Inicializar
load();

// ─── API Pública ─────────────────────────────────────────

/** Adiciona uma mensagem do usuário ao contexto */
export function addUserTurn(text: string, intent?: string, entities?: ExtractedEntities, toolId?: string): void {
  context.turns.push({
    role: "user",
    text,
    timestamp: Date.now(),
    intent,
    entities,
    toolId,
  });

  // Mesclar entidades (as novas sobrescrevem as antigas)
  if (entities) {
    context.lastEntities = { ...context.lastEntities, ...entities };
  }

  // Limitar tamanho
  if (context.turns.length > MAX_TURNS) {
    context.turns = context.turns.slice(-MAX_TURNS);
  }

  save();
}

/** Adiciona uma resposta do agente ao contexto */
export function addAgentTurn(text: string, intent?: string, toolId?: string): void {
  context.turns.push({
    role: "agent",
    text,
    timestamp: Date.now(),
    intent,
    toolId,
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

/** Retorna todas as entidades acumuladas */
export function getLastEntities(): ExtractedEntities {
  return { ...context.lastEntities };
}

/** Mescla novas entidades com as acumuladas */
export function mergeEntities(entities: ExtractedEntities): ExtractedEntities {
  context.lastEntities = { ...context.lastEntities, ...entities };
  save();
  return { ...context.lastEntities };
}

/** Limpa entidades acumuladas */
export function clearEntities(): void {
  context.lastEntities = {};
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
  // Expira após 5 minutos
  if (Date.now() - context.pendingQuestion.createdAt > 5 * 60 * 1000) {
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
  // Expira após 5 minutos
  if (Date.now() - context.pendingConfirmation.createdAt > 5 * 60 * 1000) {
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
    if (context.turns[i].intent) return context.turns[i].intent!;
  }
  return null;
}

/** Retorna o último tool executado */
export function getLastToolId(): string | null {
  for (let i = context.turns.length - 1; i >= 0; i--) {
    if (context.turns[i].toolId) return context.turns[i].toolId!;
  }
  return null;
}

/** Verifica se o usuário mencionou algo específico recentemente */
export function userMentionedRecently(keyword: string, turnsBack = 4): boolean {
  const recent = context.turns.slice(-turnsBack);
  const norm = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return recent.some(t =>
    t.role === "user" &&
    t.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(norm)
  );
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
