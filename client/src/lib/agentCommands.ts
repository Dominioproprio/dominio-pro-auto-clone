/**
 * agentCommands.ts — Processamento de comandos diretos via texto.
 * Permite que o usuário use atalhos como "/agendar" ou comandos rápidos.
 */

export interface CommandResult {
  ok: boolean;
  message: string;
  type: "task_created" | "task_removed" | "info" | "error";
}

/** Verifica se a mensagem é um comando de agendamento rápido */
export function isScheduleCommand(text: string): boolean {
  const q = text.toLowerCase().trim();
  return q.startsWith("/") || q.startsWith("!") || q.includes("agendar") || q.includes("marcar");
}

/** Processa comandos rápidos do usuário */
export function processCommand(text: string): CommandResult {
  const q = text.toLowerCase().trim();

  if (q.includes("ajuda") || q === "/help") {
    return {
      ok: true,
      message: "Comandos disponíveis:\n- /agendar [serviço] [data] [hora]\n- /cancelar [data]\n- /clientes\n- /caixa",
      type: "info"
    };
  }

  if (q.includes("agendar") || q.startsWith("/agendar")) {
    return {
      ok: true,
      message: "Entendido! Para agendar, por favor me informe o nome do cliente, o serviço e o horário desejado.",
      type: "info"
    };
  }

  if (q.includes("cancelar") || q.startsWith("/cancelar")) {
    return {
      ok: true,
      message: "Para cancelar um agendamento, preciso saber a data ou o nome do cliente.",
      type: "info"
    };
  }

  return {
    ok: false,
    message: "Comando não reconhecido. Tente /ajuda para ver as opções.",
    type: "error"
  };
}
