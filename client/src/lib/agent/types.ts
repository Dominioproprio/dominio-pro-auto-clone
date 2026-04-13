import type { Appointment, Client, Employee, Service } from "../store";

export interface MensagemConversa {
  role: "user" | "assistant";
  content: string;
}

export interface ResultadoAgente {
  texto: string;
  agendamentoCriado?: Appointment;
  erro?: string;
}

export type AgentIntent =
  | "schedule"
  | "cancel"
  | "reschedule"
  | "query_schedule"
  | "query_finance"
  | "query_client"
  | "query_available"
  | "create_client"
  | "unknown";

interface BaseDraft {
  intent: AgentIntent;
  updatedAt: number;
  awaitingConfirmation?: boolean;
}

export interface ScheduleDraft extends BaseDraft {
  intent: "schedule";
  client?: Client;
  date?: string;
  time?: string;
  service?: Service;
  employee?: Employee;
}

export interface CancelDraft extends BaseDraft {
  intent: "cancel";
  client?: Client;
  date?: string;
  time?: string;
  employee?: Employee;
  appointment?: Appointment;
}

export interface RescheduleDraft extends BaseDraft {
  intent: "reschedule";
  client?: Client;
  appointment?: Appointment;
  newDate?: string;
  newTime?: string;
  newEmployee?: Employee;
}

export type AgentDraft = ScheduleDraft | CancelDraft | RescheduleDraft;

export interface AgentInterpretation {
  intent: AgentIntent;
  raw: string;
  normalized: string;
  date?: string;
  time?: string;
  clientHint?: string;
  serviceHint?: string;
  employeeHint?: string;
  explicitCreateClient?: boolean;
}

export interface ClientResolution {
  client?: Client;
  error?: string;
}

export interface ScheduleValidationResult {
  ok: boolean;
  message?: string;
}
