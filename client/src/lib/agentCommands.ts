/**
 * agentCommands.ts — Parser de comandos em linguagem natural.
 * Ajustado para NÃO interceptar agendamentos normais, permitindo que o agente inteligente processe.
 */

export interface CommandResult {
  understood: boolean;
  type: "task_created" | "task_removed" | "task_list" | "task_not_found" | "help" | "unknown" | "info";
  message: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Só intercepta se for um comando de AVISO/RELATÓRIO recorrente
function isRecurringAlertIntent(q: string): boolean {
  const patterns = [
    /me\s+avis[aeo]/,
    /me\s+lembr[aeo]/,
    /me\s+mostr[aeo]\s+todo/,
    /tod[oa]\s+(dia|segunda|terca|quarta|quinta|sexta|sabado|domingo)/,
    /todo\s+dia\s+\d+/,
    /semanalmente/,
    /mensalmente/,
    /diariamente/,
  ];
  return patterns.some(p => p.test(q));
}

export function processCommand(text: string): CommandResult {
  const q = normalize(text);

  // Comandos explícitos com barra
  if (q === "/ajuda" || q === "/help") {
    return {
      understood: true,
      type: "help",
      message: "Comandos disponíveis:\n- /clientes\n- /caixa\n- Me avisa todo sábado o rendimento da semana",
    };
  }

  // Se for um comando de aviso recorrente
  if (isRecurringAlertIntent(q)) {
    return {
      understood: true,
      type: "info",
      message: "Entendido! Vou configurar esse aviso recorrente para você.",
    };
  }

  // Para qualquer outra coisa (como agendar, marcar, etc), retorna NÃO entendido
  // Isso permite que o agentOrchestrator.ts use a inteligência real (NLU/LLM)
  return {
    understood: false,
    type: "unknown",
    message: "",
  };
}

export function isScheduleCommand(text: string): boolean {
  const q = normalize(text);
  // Só intercepta se começar com "/" ou for um aviso recorrente explícito
  return q.startsWith("/") || isRecurringAlertIntent(q);
}
