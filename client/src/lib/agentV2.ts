// 🔥 PATCH SEGURO — SUPER AGENTE BASE (SEM QUEBRAR UI)

import { supabase } from "./supabase";
import {
  servicesStore,
  employeesStore,
  clientsStore,
  appointmentsStore,
  type Appointment,
} from "./store";

export interface MensagemConversa {
  role: "user" | "assistant";
  content: string;
}

export interface ResultadoAgente {
  texto: string;
  agendamentoCriado?: Appointment;
  erro?: string;
}

// 🧠 NOVO: estado de confirmação
let pendingConfirmation: any = null;

// ─────────────────────────────────────────────

export async function processarMensagem(
  mensagem: string,
  historico: MensagemConversa[]
): Promise<ResultadoAgente> {
  const lower = mensagem.toLowerCase();

  // ✅ CONFIRMAÇÃO
  if (pendingConfirmation) {
    if (
      lower.includes("sim") ||
      lower.includes("ok") ||
      lower.includes("confirmar")
    ) {
      const action = pendingConfirmation;
      pendingConfirmation = null;

      return executarAgendamento(action);
    }

    if (
      lower.includes("não") ||
      lower.includes("nao") ||
      lower.includes("cancelar")
    ) {
      pendingConfirmation = null;

      return {
        texto: "Ok, não realizei a ação.",
      };
    }

    return {
      texto: "Confirme com 'sim' ou 'não'.",
    };
  }

  // 🔍 DETECTA INTENÇÃO SIMPLES (sem quebrar LLM atual)
  if (lower.includes("agenda") || lower.includes("agendar")) {
    const nome = detectarNome(mensagem);
    if (!nome) {
      return { texto: "Qual o nome do cliente?" };
    }

    const cliente = await clientsStore.search(nome);
    if (cliente.length === 0) {
      return { texto: `Cliente "${nome}" não encontrado.` };
    }

    const c = cliente[0];

    // ⚠️ NÃO EXECUTA — PEDE CONFIRMAÇÃO
    pendingConfirmation = {
      clientId: c.id,
      clientName: c.name,
      date: "amanhã",
      time: "08:00",
    };

    return {
      texto: `
Vou agendar:

Cliente: ${c.name}
Data: amanhã
Hora: 08:00

Confirmar?
      `.trim(),
    };
  }

  return {
    texto: "Não entendi. Pode reformular?",
  };
}

// ─────────────────────────────────────────────

function detectarNome(msg: string): string | null {
  const tokens = msg.split(" ");
  for (const t of tokens) {
    if (t.length > 3 && t[0] === t[0].toUpperCase()) {
      return t;
    }
  }
  return null;
}

// ─────────────────────────────────────────────

async function executarAgendamento(action: any): Promise<ResultadoAgente> {
  try {
    const novo = await appointmentsStore.create({
      clientId: action.clientId,
      clientName: action.clientName,
      startTime: new Date().toISOString(),
      employeeId: 1,
      services: [],
      status: "scheduled",
    });

    return {
      texto: "Agendamento realizado com sucesso.",
      agendamentoCriado: novo,
    };
  } catch (e) {
    return {
      texto: "Erro ao agendar.",
      erro: String(e),
    };
  }
}
