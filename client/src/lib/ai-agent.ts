/**
 * ai-agent.ts — Fachada do agente modular.
 *
 * Regras fixas preservadas:
 * - agenda é a fonte de verdade
 * - não agenda com conflito
 * - agente não cria cliente automaticamente
 * - não edita cadastro sem pedido explícito
 * - uma etapa por vez
 */

import { appointmentsStore, type Appointment } from "./store";
import { addAgentAudit } from "./agent/core/audit";
import {
  detectIntent,
  extractLikelyClientTerm,
  formatDateLong,
  interpretMessage,
  isPastDate,
  NO,
  normalizar,
  YES,
} from "./agent/core/interpreter";
import {
  answerWithLLM,
  executeCancellation,
  executeReschedule,
  executeScheduleCreation,
  queryAvailable,
  queryClient,
  queryFinance,
  querySchedule,
} from "./agent/core/executor";
import { clearDraft, loadDraft, saveDraft, shouldReplaceDraft } from "./agent/core/session-state";
import {
  ensureBaseLoaded,
  findEmployeeInMessage,
  findServiceInMessage,
  resolveClientByTerm,
  resolveClientFromMessage,
} from "./agent/domain/context-loader";
import {
  resolveAppointmentForCancel,
  validateRescheduleDraft,
  validateScheduleDraft,
} from "./agent/domain/scheduling-validator";
import type {
  CancelDraft,
  MensagemConversa,
  RescheduleDraft,
  ResultadoAgente,
  ScheduleDraft,
} from "./agent/types";

export type { MensagemConversa, ResultadoAgente } from "./agent/types";

function summarizeScheduleDraft(draft: ScheduleDraft): string {
  return [
    `Cliente: ${draft.client?.name}`,
    `Data: ${draft.date ? formatDateLong(draft.date) : "—"}`,
    `Horário: ${draft.time ?? "—"}`,
    `Serviço: ${draft.service?.name ?? "—"}`,
    `Profissional: ${draft.employee?.name ?? "—"}`,
  ].join("\n");
}

function summarizeAppointment(appointment: Appointment): string {
  const date = appointment.startTime.slice(0, 10);
  const time = new Date(appointment.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const service = appointment.services[0]?.name ?? "—";
  return `Cliente: ${appointment.clientName ?? "—"}\nData: ${formatDateLong(date)}\nHorário: ${time}\nServiço: ${service}`;
}

function nextScheduleQuestion(draft: ScheduleDraft): string {
  if (!draft.client) return "Qual é o cliente?";
  if (!draft.date) return "Qual é a data?";
  if (!draft.time) return "Qual é o horário?";
  if (!draft.service) return "Qual é o serviço?";
  if (!draft.employee) return "Qual é o profissional?";
  return `Confirma?\n${summarizeScheduleDraft(draft)}`;
}

function nextCancelQuestion(draft: CancelDraft): string {
  if (!draft.client) return "Qual é o cliente do agendamento que você quer cancelar?";
  if (!draft.date && !draft.appointment) return "Qual é a data do agendamento que você quer cancelar?";
  if (!draft.appointment) return `Ainda preciso identificar o agendamento certo de ${draft.client.name}. Me passe o horário exato.`;
  return `Confirma o cancelamento?\n${summarizeAppointment(draft.appointment)}`;
}

function nextRescheduleQuestion(draft: RescheduleDraft): string {
  if (!draft.client && !draft.appointment) return "Qual é o cliente do agendamento que você quer remarcar?";
  if (!draft.appointment) return "Preciso identificar qual agendamento você quer remarcar. Me diga o cliente e, se houver mais de um horário, a data atual dele.";
  if (!draft.newDate) return "Qual é a nova data?";
  if (!draft.newTime) return "Qual é o novo horário?";
  const professional = draft.newEmployee?.name ?? "mesmo profissional";
  return `Confirma a remarcação?\nCliente: ${draft.appointment.clientName ?? "—"}\nNova data: ${formatDateLong(draft.newDate)}\nNovo horário: ${draft.newTime}\nProfissional: ${professional}`;
}

function findUniqueUpcomingAppointmentForClient(clientId: number): Appointment | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const matches = appointmentsStore
    .list({ startDate: today })
    .filter((appointment) => appointment.clientId === clientId && appointment.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return matches.length === 1 ? matches[0] : undefined;
}

async function handleScheduleFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();
  const interpretation = interpretMessage(msg);
  const normalized = interpretation.normalized;
  let draft = (loadDraft() as ScheduleDraft | null) ?? { intent: "schedule", updatedAt: Date.now() };

  if (/\be\b/.test(normalized) && /( e |,)/.test(normalized) && /(servico|serviço|corte|escova|hidr|sobrancelha|unha)/.test(normalized)) {
    return { texto: "Serviço múltiplo ainda não está fechado. Me passe um serviço por vez." };
  }

  if (draft.awaitingConfirmation) {
    if (YES.test(msg.trim())) {
      const validation = validateScheduleDraft(draft);
      if (!validation.ok) {
        draft.awaitingConfirmation = false;
        saveDraft(draft);
        return { texto: validation.message ?? nextScheduleQuestion(draft) };
      }
      clearDraft();
      return executeScheduleCreation(draft);
    }
    if (NO.test(msg.trim())) {
      clearDraft();
      return { texto: "Ok. Não executei nada." };
    }
    draft.awaitingConfirmation = false;
  }

  if (!draft.client) {
    const resolved = await resolveClientFromMessage(msg);
    if (resolved.error) return { texto: resolved.error };
    if (resolved.client) draft.client = resolved.client;
  }

  if (!draft.date && interpretation.date) {
    if (isPastDate(interpretation.date)) return { texto: "Não posso agendar em data passada." };
    draft.date = interpretation.date;
  }

  if (!draft.time && interpretation.time) draft.time = interpretation.time;
  if (!draft.service) draft.service = findServiceInMessage(msg);
  if (!draft.employee) draft.employee = findEmployeeInMessage(msg);

  const validation = validateScheduleDraft(draft);
  if (draft.client && draft.date && draft.time && draft.service && draft.employee && !validation.ok) {
    addAgentAudit("validation_blocked", validation.message ?? "Validação bloqueou agendamento", { intent: "schedule" });
    if (/conflito|horário/.test(normalizar(validation.message ?? ""))) draft.time = undefined;
    if (/compatível|profissional/.test(normalizar(validation.message ?? ""))) draft.employee = undefined;
    saveDraft(draft);
    return { texto: validation.message ?? nextScheduleQuestion(draft) };
  }

  if (draft.client && draft.date && draft.time && draft.service && draft.employee) {
    draft.awaitingConfirmation = true;
    saveDraft(draft);
    return { texto: `Confirma?\n${summarizeScheduleDraft(draft)}` };
  }

  saveDraft(draft);
  addAgentAudit("draft_updated", "Draft de agendamento atualizado", { intent: "schedule" });
  return { texto: nextScheduleQuestion(draft) };
}

async function handleCancelFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();
  let draft = (loadDraft() as CancelDraft | null) ?? { intent: "cancel", updatedAt: Date.now() };
  const interpretation = interpretMessage(msg);

  if (draft.awaitingConfirmation && draft.appointment) {
    if (YES.test(msg.trim())) {
      clearDraft();
      return executeCancellation(draft);
    }
    if (NO.test(msg.trim())) {
      clearDraft();
      return { texto: "Ok. Não cancelei nada." };
    }
    draft.awaitingConfirmation = false;
  }

  if (!draft.client) {
    const resolved = await resolveClientFromMessage(msg);
    if (resolved.error) return { texto: resolved.error };
    if (resolved.client) draft.client = resolved.client;
  }
  if (!draft.date && interpretation.date) draft.date = interpretation.date;
  if (!draft.time && interpretation.time) draft.time = interpretation.time;
  if (!draft.employee) draft.employee = findEmployeeInMessage(msg);

  const resolvedAppointment = resolveAppointmentForCancel(draft);
  if (!resolvedAppointment.appointment) {
    saveDraft(draft);
    return { texto: resolvedAppointment.message ?? nextCancelQuestion(draft) };
  }

  draft.appointment = resolvedAppointment.appointment;
  draft.awaitingConfirmation = true;
  saveDraft(draft);
  return { texto: `Confirma o cancelamento?\n${summarizeAppointment(draft.appointment)}` };
}

async function handleRescheduleFlow(msg: string): Promise<ResultadoAgente> {
  await ensureBaseLoaded();
  let draft = (loadDraft() as RescheduleDraft | null) ?? { intent: "reschedule", updatedAt: Date.now() };
  const interpretation = interpretMessage(msg);

  if (draft.awaitingConfirmation && draft.appointment) {
    if (YES.test(msg.trim())) {
      const validation = validateRescheduleDraft(draft);
      if (!validation.ok) {
        draft.awaitingConfirmation = false;
        saveDraft(draft);
        return { texto: validation.message ?? nextRescheduleQuestion(draft) };
      }
      clearDraft();
      return executeReschedule(draft);
    }
    if (NO.test(msg.trim())) {
      clearDraft();
      return { texto: "Ok. Não remarquei nada." };
    }
    draft.awaitingConfirmation = false;
  }

  if (!draft.client && !draft.appointment) {
    const resolved = await resolveClientFromMessage(msg);
    if (resolved.error) return { texto: resolved.error };
    if (resolved.client) draft.client = resolved.client;
  }

  if (!draft.appointment && draft.client) {
    const unique = findUniqueUpcomingAppointmentForClient(draft.client.id);
    if (!unique) {
      saveDraft(draft);
      return { texto: `Encontrei mais de um ou nenhum agendamento futuro para ${draft.client.name}. Me diga qual agendamento atual você quer remarcar.` };
    }
    draft.appointment = unique;
  }

  if (!draft.newDate && interpretation.date) {
    if (isPastDate(interpretation.date)) return { texto: "Não posso remarcar para uma data passada." };
    draft.newDate = interpretation.date;
  }
  if (!draft.newTime && interpretation.time) draft.newTime = interpretation.time;
  if (!draft.newEmployee) draft.newEmployee = findEmployeeInMessage(msg);

  const validation = validateRescheduleDraft(draft);
  if (draft.appointment && draft.newDate && draft.newTime && !validation.ok) {
    addAgentAudit("validation_blocked", validation.message ?? "Validação bloqueou remarcação", { intent: "reschedule" });
    if (/horario|horário|conflito/.test(normalizar(validation.message ?? ""))) draft.newTime = undefined;
    saveDraft(draft);
    return { texto: validation.message ?? nextRescheduleQuestion(draft) };
  }

  if (draft.appointment && draft.newDate && draft.newTime) {
    draft.awaitingConfirmation = true;
    saveDraft(draft);
    return { texto: nextRescheduleQuestion(draft) };
  }

  saveDraft(draft);
  return { texto: nextRescheduleQuestion(draft) };
}

export async function executarAgente(
  mensagemUsuario: string,
  historicoConversa: MensagemConversa[] = [],
): Promise<ResultadoAgente> {
  try {
    await ensureBaseLoaded();
    const msg = mensagemUsuario.trim();
    if (!msg) return { texto: "Envie uma mensagem." };

    const pending = loadDraft();
    const nextIntent = detectIntent(msg);
    addAgentAudit("intent_detected", "Intenção detectada", { intent: nextIntent });

    if (pending && !(pending.awaitingConfirmation && (YES.test(msg) || NO.test(msg))) && shouldReplaceDraft(pending.intent, nextIntent)) {
      clearDraft();
    }

    const activeDraft = loadDraft();
    if (activeDraft?.intent === "schedule") return handleScheduleFlow(msg);
    if (activeDraft?.intent === "cancel") return handleCancelFlow(msg);
    if (activeDraft?.intent === "reschedule") return handleRescheduleFlow(msg);

    switch (nextIntent) {
      case "schedule":
        return handleScheduleFlow(msg);
      case "cancel":
        return handleCancelFlow(msg);
      case "reschedule":
        return handleRescheduleFlow(msg);
      case "query_schedule": {
        const interpretation = interpretMessage(msg);
        return querySchedule(msg, interpretation.date);
      }
      case "query_finance": {
        const interpretation = interpretMessage(msg);
        return queryFinance(msg, interpretation.date);
      }
      case "query_client": {
        const term = extractLikelyClientTerm(msg) ?? msg;
        return queryClient(term);
      }
      case "query_available": {
        const interpretation = interpretMessage(msg);
        return queryAvailable(interpretation.date, interpretation.time);
      }
      case "create_client":
        return {
          texto: "Entendi o pedido de cadastro. O agente não cria cliente automaticamente. Se quiser seguir por aqui, me passe o nome completo e pelo menos um contato, ou faça o cadastro direto pela agenda.",
        };
      default:
        return answerWithLLM(msg, historicoConversa);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addAgentAudit("execution_error", "Erro no agente", { error: message });
    if (message.includes("401")) return { texto: "Chave da IA inválida.", erro: message };
    if (message.includes("429")) return { texto: "Muitas requisições. Tente de novo em instantes.", erro: message };
    return { texto: "Erro ao processar a mensagem.", erro: message };
  }
}
