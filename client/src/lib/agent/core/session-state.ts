import type { AgentDraft } from "../types";

const DRAFT_KEY = "dominio_pro_ai_agent_draft_v2";
const TTL_MS = 30 * 60_000;

function getStorage(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export function loadDraft(): AgentDraft | null {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentDraft;
    if (!parsed?.updatedAt || Date.now() - parsed.updatedAt > TTL_MS) {
      storage?.removeItem(DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: AgentDraft | null): void {
  const storage = getStorage();
  if (!storage) return;
  if (!draft) {
    storage.removeItem(DRAFT_KEY);
    return;
  }
  draft.updatedAt = Date.now();
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  getStorage()?.removeItem(DRAFT_KEY);
}

export function shouldReplaceDraft(currentIntent: AgentDraft["intent"], nextIntent: string): boolean {
  if (!nextIntent || nextIntent === "unknown") return false;
  return currentIntent !== nextIntent;
}
