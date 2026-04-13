import {
  appointmentsStore,
  cashSessionsStore,
  clientsStore,
  employeesStore,
  servicesStore,
  type Appointment,
} from "../../store";
import type {
  CancelDraft,
  MensagemConversa,
  RescheduleDraft,
  ResultadoAgente,
  ScheduleDraft,
} from "../types";
import { getConversationWindow } from "./memory";
import { addAgentAudit } from "./audit";
import { formatDateLong, normalizar, ymd } from "./interpreter";
import { buildAppointmentPayload, buildReschedulePayload } from "../domain/scheduling-validator";
import { getEmployeeName } from "../domain/context-loader";

const TZ = "America/Sao_Paulo";

function getLocalNowYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

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
  const employee = getEmployeeName(appointment.employeeId);
  return `Cliente: ${appointment.clientName ?? "—"}\nData: ${formatDateLong(date)}\nHorário: ${time}\nServiço: ${service}\nProfissional: ${employee}`;
}

export async function executeScheduleCreation(draft: ScheduleDraft): Promise<ResultadoAgente> {
  const created = await appointmentsStore.create(buildAppointmentPayload(draft));
  addAgentAudit("execution_success", "Agendamento criado pelo agente", { appointmentId: created.id, clientId: created.clientId ?? undefined });
  return {
    texto: `Agendamento confirmado.\n${summarizeScheduleDraft(draft)}`,
    agendamentoCriado: created,
  };
}

export async function executeCancellation(draft: CancelDraft): Promise<ResultadoAgente> {
  const appointment = draft.appointment!;
  await appointmentsStore.update(appointment.id, { status: "cancelled" });
  addAgentAudit("execution_success", "Agendamento cancelado pelo agente", { appointmentId: appointment.id });
  return { texto: `Agendamento cancelado com sucesso.\n${summarizeAppointment(appointment)}` };
}

export async function executeReschedule(draft: RescheduleDraft): Promise<ResultadoAgente> {
  const payload = buildReschedulePayload(draft);
  await appointmentsStore.move(draft.appointment!.id, payload.employeeId, payload.startTime, payload.endTime);
  addAgentAudit("execution_success", "Agendamento remarcado pelo agente", { appointmentId: draft.appointment!.id, employeeId: payload.employeeId });
  return {
    texto: `Agendamento remarcado com sucesso.\nCliente: ${draft.appointment!.clientName ?? "—"}\nNova data: ${formatDateLong(draft.newDate!)}\nNovo horário: ${draft.newTime}\nProfissional: ${getEmployeeName(payload.employeeId)}`,
  };
}

function getDateForQuery(msg: string, resolvedDate?: string): string {
  return resolvedDate ?? ymd(new Date(`${getLocalNowYmd()}T12:00:00`));
}

export function querySchedule(msg: string, resolvedDate?: string): ResultadoAgente {
  const date = getDateForQuery(msg, resolvedDate);
  const list = appointmentsStore
    .list({ date })
    .filter((appointment) => appointment.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 20);
  if (!list.length) return { texto: `Sem agendamentos para ${formatDateLong(date)}.` };
  const lines = list.map((appointment) => {
    const time = new Date(appointment.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const employee = getEmployeeName(appointment.employeeId);
    const service = appointment.services[0]?.name ?? "—";
    return `${time} — ${appointment.clientName ?? "—"} — ${service} — ${employee}`;
  });
  return { texto: `${formatDateLong(date)}\n${lines.join("\n")}` };
}

export async function queryClient(term: string): Promise<ResultadoAgente> {
  const found = await clientsStore.search(term, { limit: 5 });
  if (!found.length) return { texto: `Não encontrei cliente para "${term}".` };
  const client = found[0];
  return { texto: `${client.name}${client.phone ? ` — ${client.phone}` : ""}${client.email ? ` — ${client.email}` : ""}` };
}

function isEmployeeWorkingOnDate(employeeId: number, date: string, time?: string): boolean {
  const employee = employeesStore.list(true).find((item) => item.id === employeeId);
  if (!employee) return false;
  const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${date}T12:00:00`).getDay()];
  const slot = employee.workingHours?.[weekday];
  if (!slot?.active) return false;
  if (!time) return true;
  return time >= slot.start && time < slot.end;
}

export function queryAvailable(date?: string, time?: string): ResultadoAgente {
  const queryDate = date ?? getLocalNowYmd();
  const employees = employeesStore.list(true);
  const free = employees.filter((employee) => {
    if (!isEmployeeWorkingOnDate(employee.id, queryDate, time)) return false;
    if (!time) return true;
    return !appointmentsStore.list({ date: queryDate, employeeId: employee.id }).some((appointment) => {
      if (appointment.status === "cancelled") return false;
      const start = new Date(appointment.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return start === time;
    });
  });
  if (!free.length) return { texto: time ? "Nenhum profissional livre nesse horário." : "Nenhum profissional disponível nessa data." };
  return { texto: `Livres: ${free.map((employee) => employee.name).join(", ")}` };
}

export function queryFinance(msg: string, resolvedDate?: string): ResultadoAgente {
  const date = getDateForQuery(msg, resolvedDate);
  const current = cashSessionsStore.getCurrent();
  const completed = appointmentsStore.list({ date }).filter((appointment) => appointment.status === "completed");
  const total = completed.reduce((sum, appointment) => sum + Number(appointment.totalPrice ?? 0), 0);
  if (/caixa/.test(normalizar(msg))) return { texto: current ? "Caixa aberto." : "Caixa fechado." };
  return { texto: `Faturamento de ${formatDateLong(date)}: R$ ${total.toFixed(2)}` };
}

export async function answerWithLLM(mensagemUsuario: string, historicoConversa: MensagemConversa[]): Promise<ResultadoAgente> {
  const hoje = getLocalNowYmd();
  const [servicos, funcionarios] = await Promise.all([
    Promise.resolve(servicesStore.list(true).length ? servicesStore.list(true) : servicesStore.fetchAll()),
    Promise.resolve(employeesStore.list(true).length ? employeesStore.list(true) : employeesStore.fetchAll()),
  ]);
  const agendaFutura = appointmentsStore.list({ startDate: hoje });
  const nome = mensagemUsuario.trim();
  let clientesEncontrados = [] as Awaited<ReturnType<typeof clientsStore.search>>;
  try {
    clientesEncontrados = await clientsStore.search(nome, { limit: 5 });
  } catch {
    clientesEncontrados = [];
  }
  const systemPrompt = `Você é o assistente do salão Domínio Pro. Responda em pt-BR, curto e direto. Nunca invente dados. Não execute ações do sistema. Agenda é a fonte de verdade. Use só os dados abaixo.\n\nServiços:\n${servicos.map((service) => `- ${service.name}`).join("\n")}\n\nEquipe:\n${funcionarios.map((employee) => `- ${employee.name}`).join("\n")}\n\nClientes encontrados:\n${clientesEncontrados.map((client) => `- ${client.name}`).join("\n") || "- nenhum"}\n\nAgenda futura:\n${agendaFutura.slice(0, 20).map((appointment) => `- ${appointment.startTime} | ${appointment.clientName ?? "—"}`).join("\n") || "- vazia"}`;

  const body = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: systemPrompt }, ...getConversationWindow(historicoConversa, 6), { role: "user", content: mensagemUsuario }],
    temperature: 0.2,
    max_tokens: 300,
  });

  addAgentAudit("fallback_llm", "Fallback para LLM acionado", { userMessage: mensagemUsuario.slice(0, 120) });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  const texto = data.choices?.[0]?.message?.content?.trim() || "Não consegui responder agora.";
  return { texto };
}
