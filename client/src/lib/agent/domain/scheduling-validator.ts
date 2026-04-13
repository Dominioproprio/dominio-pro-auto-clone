import {
  appointmentsStore,
  employeesStore,
  type Appointment,
  type AppointmentService,
  type Employee,
} from "../../store";
import type { CancelDraft, RescheduleDraft, ScheduleDraft, ScheduleValidationResult } from "../types";
import { formatDateLong, normalizar, parseYMD } from "../core/interpreter";

const WEEKDAY_KEYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getWeekdayKey(dateStr: string): string {
  return WEEKDAY_KEYS[parseYMD(dateStr).getDay()];
}

function getWorkingWindow(employee: Employee, dateStr: string): { start: string; end: string; active: boolean } | null {
  const key = getWeekdayKey(dateStr);
  return employee.workingHours?.[key] ?? null;
}

export function isWithinWorkingHours(employee: Employee, dateStr: string, startTime: string, endTime: string): boolean {
  const window = getWorkingWindow(employee, dateStr);
  if (!window?.active) return false;
  return timeToMinutes(startTime) >= timeToMinutes(window.start) && timeToMinutes(endTime) <= timeToMinutes(window.end);
}

export function isEmployeeCompatible(employee: Employee, serviceName: string): boolean {
  if (!employee.specialties?.length) return true;
  const normalizedService = normalizar(serviceName);
  return employee.specialties.some((specialty) => {
    const normalizedSpecialty = normalizar(specialty);
    return normalizedService.includes(normalizedSpecialty) || normalizedSpecialty.includes(normalizedService);
  });
}

export function buildAppointmentPayload(draft: ScheduleDraft): Omit<Appointment, "id" | "createdAt"> {
  const startTime = new Date(`${draft.date}T${draft.time}:00`).toISOString();
  const end = new Date(new Date(`${draft.date}T${draft.time}:00`).getTime() + (draft.service?.durationMinutes ?? 0) * 60_000);
  const endTime = end.toISOString();
  const serviceItem: AppointmentService = {
    serviceId: draft.service!.id,
    name: draft.service!.name,
    price: draft.service!.price,
    durationMinutes: draft.service!.durationMinutes,
    color: draft.service!.color,
    materialCostPercent: draft.service!.materialCostPercent,
  };

  return {
    clientName: draft.client!.name,
    clientId: draft.client!.id,
    employeeId: draft.employee!.id,
    startTime,
    endTime,
    status: "scheduled",
    totalPrice: draft.service!.price,
    notes: "Criado via Agente IA",
    paymentStatus: null,
    groupId: null,
    services: [serviceItem],
  };
}

export function hasConflict(employeeId: number, dateStr: string, startTime: string, endTime: string, ignoreAppointmentId?: number): boolean {
  const start = new Date(`${dateStr}T${startTime}:00`).getTime();
  const end = new Date(`${dateStr}T${endTime}:00`).getTime();
  return appointmentsStore.list({ date: dateStr, employeeId }).some((appointment) => {
    if (appointment.status === "cancelled") return false;
    if (ignoreAppointmentId && appointment.id === ignoreAppointmentId) return false;
    const appointmentStart = new Date(appointment.startTime).getTime();
    const appointmentEnd = new Date(appointment.endTime).getTime();
    return start < appointmentEnd && end > appointmentStart;
  });
}

export function validateScheduleDraft(draft: ScheduleDraft): ScheduleValidationResult {
  if (!draft.client) return { ok: false, message: "Qual é o cliente?" };
  if (!draft.date) return { ok: false, message: "Qual é a data?" };
  if (!draft.time) return { ok: false, message: "Qual é o horário?" };
  if (!draft.service) return { ok: false, message: "Qual é o serviço?" };
  if (!draft.employee) return { ok: false, message: "Qual é o profissional?" };

  const startTime = draft.time;
  const endMinutes = timeToMinutes(startTime) + draft.service.durationMinutes;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  if (!isEmployeeCompatible(draft.employee, draft.service.name)) {
    return { ok: false, message: `${draft.employee.name} não está compatível com o serviço ${draft.service.name}. Escolha outro profissional.` };
  }

  if (!isWithinWorkingHours(draft.employee, draft.date, startTime, endTime)) {
    const day = formatDateLong(draft.date);
    return { ok: false, message: `${draft.employee.name} não atende nesse horário em ${day}. Me passe outro horário ou profissional.` };
  }

  if (hasConflict(draft.employee.id, draft.date, startTime, endTime)) {
    return { ok: false, message: "Há conflito nesse horário. Me passe outro horário." };
  }

  return { ok: true };
}

function matchAppointmentByDraftBase(params: {
  clientId?: number;
  date?: string;
  time?: string;
  employeeId?: number;
}): Appointment[] {
  let matches = params.date ? appointmentsStore.list({ date: params.date }) : appointmentsStore.list({ startDate: new Date().toISOString().slice(0, 10) });
  matches = matches.filter((appointment) => appointment.status !== "cancelled");
  if (params.clientId) matches = matches.filter((appointment) => appointment.clientId === params.clientId);
  if (params.employeeId) matches = matches.filter((appointment) => appointment.employeeId === params.employeeId);
  if (params.time) {
    matches = matches.filter((appointment) => {
      const localTime = new Date(appointment.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return localTime === params.time;
    });
  }
  return matches.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function resolveAppointmentForCancel(draft: CancelDraft): { appointment?: Appointment; message?: string } {
  if (!draft.client) return { message: "Qual é o cliente do agendamento que você quer cancelar?" };

  const matches = matchAppointmentByDraftBase({
    clientId: draft.client.id,
    date: draft.date,
    time: draft.time,
    employeeId: draft.employee?.id,
  });

  if (!matches.length) {
    return { message: `Não encontrei agendamento ativo para ${draft.client.name}${draft.date ? ` em ${formatDateLong(draft.date)}` : ""}.` };
  }

  if (matches.length > 1) {
    return { message: `Encontrei mais de um agendamento para ${draft.client.name}. Me passe a data e o horário exatos.` };
  }

  return { appointment: matches[0] };
}

export function validateRescheduleDraft(draft: RescheduleDraft): ScheduleValidationResult {
  if (!draft.appointment) return { ok: false, message: "Qual agendamento você quer remarcar?" };
  if (!draft.newDate) return { ok: false, message: "Qual é a nova data?" };
  if (!draft.newTime) return { ok: false, message: "Qual é o novo horário?" };

  const employee = draft.newEmployee ?? employeesStore.list().find((item) => item.id === draft.appointment!.employeeId);
  if (!employee) return { ok: false, message: "Não encontrei o profissional desse agendamento." };

  const durationMinutes = Math.max(0, Math.round((new Date(draft.appointment.endTime).getTime() - new Date(draft.appointment.startTime).getTime()) / 60000));
  const endMinutes = timeToMinutes(draft.newTime) + durationMinutes;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  if (!isWithinWorkingHours(employee, draft.newDate, draft.newTime, endTime)) {
    return { ok: false, message: `${employee.name} não atende nesse horário. Me passe outra data, horário ou profissional.` };
  }

  if (hasConflict(employee.id, draft.newDate, draft.newTime, endTime, draft.appointment.id)) {
    return { ok: false, message: "Há conflito nesse horário. Me passe outro horário." };
  }

  return { ok: true };
}

export function buildReschedulePayload(draft: RescheduleDraft): { employeeId: number; startTime: string; endTime: string } {
  const appointment = draft.appointment!;
  const employee = draft.newEmployee ?? employeesStore.list().find((item) => item.id === appointment.employeeId)!;
  const durationMinutes = Math.max(0, Math.round((new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime()) / 60000));
  const startTime = new Date(`${draft.newDate}T${draft.newTime}:00`).toISOString();
  const endTime = new Date(new Date(`${draft.newDate}T${draft.newTime}:00`).getTime() + durationMinutes * 60_000).toISOString();
  return { employeeId: employee.id, startTime, endTime };
}
