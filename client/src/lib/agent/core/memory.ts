import type { MensagemConversa } from "../types";

export function getConversationWindow(history: MensagemConversa[], limit = 8): MensagemConversa[] {
  return history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-limit);
}
