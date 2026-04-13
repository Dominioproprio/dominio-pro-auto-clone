type AgentAuditEventType =
  | "intent_detected"
  | "draft_updated"
  | "validation_blocked"
  | "execution_success"
  | "execution_error"
  | "fallback_llm";

interface AgentAuditEvent {
  id: string;
  type: AgentAuditEventType;
  message: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

const AUDIT_KEY = "dominio_pro_agent_audit_log_v1";
const MAX_ITEMS = 200;

function getStorage(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export function addAgentAudit(type: AgentAuditEventType, message: string, payload?: Record<string, unknown>): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const existing = JSON.parse(storage.getItem(AUDIT_KEY) ?? "[]") as AgentAuditEvent[];
    const next: AgentAuditEvent[] = [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        message,
        createdAt: new Date().toISOString(),
        payload,
      },
      ...existing,
    ].slice(0, MAX_ITEMS);
    storage.setItem(AUDIT_KEY, JSON.stringify(next));
  } catch {
    // auditoria do agente não pode quebrar a execução
  }
}
