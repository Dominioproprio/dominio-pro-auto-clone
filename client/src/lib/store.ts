/**
 * store.ts — Supabase edition com carregamento recursivo
 * Mesma API pública do store localStorage, agora com banco na nuvem.
 * Implementa busca em lotes para superar o limite de 1000 registros do Supabase.
 */

import { supabase } from "./supabase";

// ─── Tipos ───────────────────────────────────────────────

export interface Employee {
  id: number;
  name: string;
  email: string;
  phone: string;
  color: string;
  photoUrl: string | null;
  specialties: string[];
  commissionPercent: number;
  workingHours: Record<string, { start: string; end: string; active: boolean }>;
  active: boolean;
  createdAt: string;
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  materialCostPercent: number;
  color: string;
  active: boolean;
  createdAt: string;
}

export interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  cpf: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AppointmentService {
  serviceId: number;
  name: string;
  price: number;
  durationMinutes: number;
  color: string;
  materialCostPercent: number;
}

export interface Appointment {
  id: number;
  clientName: string | null;
  clientId: number | null;
  employeeId: number;
  startTime: string;
  endTime: string;
  status: "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  totalPrice: number | null;
  notes: string | null;
  paymentStatus: string | null;
  groupId: string | null;
  services: AppointmentService[];
  createdAt: string;
}

export interface CashSession {
  id: number;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  totalRevenue: number | null;
  totalCommissions: number | null;
  closingNotes: string | null;
  status: "open" | "closed";
}

export interface CashEntry {
  id: number;
  sessionId: number;
  appointmentId: number | null;
  clientName: string;
  employeeId: number;
  description: string;
  amount: number;
  paymentMethod: "dinheiro" | "cartao_credito" | "cartao_debito" | "pix" | "outro";
  commissionPercent: number;
  commissionValue: number;
  materialCostValue: number;
  isAutoLaunch: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  description: string;
  userName: string | null;
  createdAt: string;
}

// ─── Helpers ───────────────────────────────────────────────

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// ─── Mappers (snake_case → camelCase) ────────────────────

function toEmployee(r: any): Employee {
  return { id: r.id, name: r.name, email: r.email ?? "", phone: r.phone ?? "", color: r.color ?? "#ec4899", photoUrl: r.photo_url ?? null, specialties: r.specialties ?? [], commissionPercent: Number(r.commission_percent ?? 0), workingHours: r.working_hours ?? {}, active: r.active ?? true, createdAt: r.created_at };
}
function toService(r: any): Service {
  return { id: r.id, name: r.name, description: r.description ?? null, durationMinutes: r.duration_minutes ?? 60, price: Number(r.price ?? 0), materialCostPercent: Number(r.material_cost_percent ?? 0), color: r.color ?? "#ec4899", active: r.active ?? true, createdAt: r.created_at };
}
function toClient(r: any): Client {
  return { id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null, birthDate: r.birth_date ?? null, cpf: r.cpf ?? null, address: r.address ?? null, notes: r.notes ?? null, createdAt: r.created_at };
}
function toAppointment(r: any): Appointment {
  return { id: r.id, clientName: r.client_name ?? null, clientId: r.client_id ?? null, employeeId: r.employee_id, startTime: r.start_time, endTime: r.end_time, status: r.status, totalPrice: r.total_price != null ? Number(r.total_price) : null, notes: r.notes ?? null, paymentStatus: r.payment_status ?? null, groupId: r.group_id ?? null, services: r.services ?? [], createdAt: r.created_at };
}
function toCashSession(r: any): CashSession {
  return { id: r.id, openedAt: r.opened_at, closedAt: r.closed_at ?? null, openingBalance: Number(r.opening_balance ?? 0), totalRevenue: r.total_revenue != null ? Number(r.total_revenue) : null, totalCommissions: r.total_commissions != null ? Number(r.total_commissions) : null, closingNotes: r.closing_notes ?? null, status: r.status };
}
function toCashEntry(r: any): CashEntry {
  return { id: r.id, sessionId: r.session_id, appointmentId: r.appointment_id ?? null, clientName: r.client_name ?? "", employeeId: r.employee_id, description: r.description ?? "", amount: Number(r.amount ?? 0), paymentMethod: r.payment_method ?? "dinheiro", commissionPercent: Number(r.commission_percent ?? 0), commissionValue: Number(r.commission_value ?? 0), materialCostValue: Number(r.material_cost_value ?? 0), isAutoLaunch: r.is_auto_launch ?? false, createdAt: r.created_at };
}
function toAuditLog(r: any): AuditLog {
  return { id: r.id, entityType: r.entity_type, entityId: r.entity_id, action: r.action, description: r.description, userName: r.user_name ?? null, createdAt: r.created_at };
}

// ─── Cache em memória ─────────────────────────────────────

const cache = {
  employees:    [] as Employee[],
  services:     [] as Service[],
  clients:      [] as Client[],
  appointments: [] as Appointment[],
  cashSessions: [] as CashSession[],
  cashEntries:  [] as CashEntry[],
  auditLogs:    [] as AuditLog[],
};

async function addAuditLog(entityType: string, entityId: number, action: string, description: string) {
  await supabase.from("audit_logs").insert({ entity_type: entityType, entity_id: entityId, action, description, user_name: "Admin" });
}

// ─── Função de Busca em Lotes (Paginação Recursiva) ───────

async function fetchAllFromTable(tableName: string, orderBy: string = "id"): Promise<any[]> {
  let allData: any[] = [];
  let from = 0;
  let to = 999;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .order(orderBy)
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = [...allData, ...data];
      if (data.length < 1000) {
        hasMore = false;
      } else {
        from += 1000;
        to += 1000;
      }
    }
  }
  return allData;
}

// ─── Employees ───────────────────────────────────────────

export const employeesStore = {
  list(activeOnly = false): Employee[] {
    return activeOnly ? cache.employees.filter(e => e.active) : [...cache.employees];
  },
  async fetchAll(): Promise<Employee[]> {
    const data = await fetchAllFromTable("employees", "id");
    cache.employees = data.map(toEmployee);
    return cache.employees;
  },
  async create(data: Omit<Employee, "id" | "createdAt">): Promise<Employee> {
    const { data: row, error } = await supabase.from("employees").insert({ name: data.name, email: data.email, phone: data.phone, color: data.color, photo_url: data.photoUrl ?? null, specialties: data.specialties, commission_percent: data.commissionPercent, working_hours: data.workingHours, active: data.active }).select().single();
    if (error) throw error;
    const emp = toEmployee(row);
    cache.employees.push(emp);
    await addAuditLog("employee", emp.id, "create", `Funcionário "${emp.name}" criado`);
    return emp;
  },
  async update(id: number, data: Partial<Employee>): Promise<Employee | null> {
    const p: any = {};
    if (data.name !== undefined) p.name = data.name;
    if (data.email !== undefined) p.email = data.email;
    if (data.phone !== undefined) p.phone = data.phone;
    if (data.color !== undefined) p.color = data.color;
    if (data.photoUrl !== undefined) p.photo_url = data.photoUrl;
    if (data.specialties !== undefined) p.specialties = data.specialties;
    if (data.commissionPercent !== undefined) p.commission_percent = data.commissionPercent;
    if (data.workingHours !== undefined) p.working_hours = data.workingHours;
    if (data.active !== undefined) p.active = data.active;
    const { data: row, error } = await supabase.from("employees").update(p).eq("id", id).select().single();
    if (error) throw error;
    const emp = toEmployee(row);
    const idx = cache.employees.findIndex(e => e.id === id);
    if (idx !== -1) cache.employees[idx] = emp;
    await addAuditLog("employee", id, "update", `Funcionário "${emp.name}" atualizado`);
    return emp;
  },
  async delete(id: number): Promise<void> {
    const emp = cache.employees.find(e => e.id === id);
    await supabase.from("employees").delete().eq("id", id);
    cache.employees = cache.employees.filter(e => e.id !== id);
    if (emp) await addAuditLog("employee", id, "delete", `Funcionário "${emp.name}" removido`);
  },
};

// ─── Services ────────────────────────────────────────────

export const servicesStore = {
  list(activeOnly = false): Service[] {
    return activeOnly ? cache.services.filter(s => s.active) : [...cache.services];
  },
  async fetchAll(): Promise<Service[]> {
    const data = await fetchAllFromTable("services", "id");
    cache.services = data.map(toService);
    return cache.services;
  },
  async create(data: Omit<Service, "id" | "createdAt">): Promise<Service> {
    const { data: row, error } = await supabase.from("services").insert({ name: data.name, description: data.description, duration_minutes: data.durationMinutes, price: data.price, material_cost_percent: data.materialCostPercent ?? 0, color: data.color, active: data.active }).select().single();
    if (error) throw error;
    const svc = toService(row);
    cache.services.push(svc);
    await addAuditLog("service", svc.id, "create", `Serviço "${svc.name}" criado`);
    return svc;
  },
  async update(id: number, data: Partial<Service>): Promise<Service | null> {
    const p: any = {};
    if (data.name !== undefined) p.name = data.name;
    if (data.description !== undefined) p.description = data.description;
    if (data.durationMinutes !== undefined) p.duration_minutes = data.durationMinutes;
    if (data.price !== undefined) p.price = data.price;
    if (data.materialCostPercent !== undefined) p.material_cost_percent = data.materialCostPercent;
    if (data.color !== undefined) p.color = data.color;
    if (data.active !== undefined) p.active = data.active;
    const { data: row, error } = await supabase.from("services").update(p).eq("id", id).select().single();
    if (error) throw error;
    const svc = toService(row);
    const idx = cache.services.findIndex(s => s.id === id);
    if (idx !== -1) cache.services[idx] = svc;
    await addAuditLog("service", id, "update", `Serviço "${svc.name}" atualizado`);
    return svc;
  },
};

// ─── Clients ─────────────────────────────────────────────

export const clientsStore = {
  list(): Client[] { return [...cache.clients]; },
  async fetchAll(): Promise<Client[]> {
    const data = await fetchAllFromTable("clients", "name");
    cache.clients = data.map(toClient);
    return cache.clients;
  },
  async create(data: Omit<Client, "id" | "createdAt">): Promise<Client> {
    const { data: row, error } = await supabase.from("clients").insert({ name: data.name, email: data.email, phone: data.phone, birth_date: data.birthDate, cpf: data.cpf, address: data.address, notes: data.notes }).select().single();
    if (error) throw error;
    const cli = toClient(row);
    cache.clients.push(cli);
    await addAuditLog("client", cli.id, "create", `Cliente "${cli.name}" criado`);
    return cli;
  },
  async update(id: number, data: Partial<Client>): Promise<Client | null> {
    const p: any = {};
    if (data.name !== undefined) p.name = data.name;
    if (data.email !== undefined) p.email = data.email;
    if (data.phone !== undefined) p.phone = data.phone;
    if (data.birthDate !== undefined) p.birth_date = data.birthDate;
    if (data.cpf !== undefined) p.cpf = data.cpf;
    if (data.address !== undefined) p.address = data.address;
    if (data.notes !== undefined) p.notes = data.notes;
    const { data: row, error } = await supabase.from("clients").update(p).eq("id", id).select().single();
    if (error) throw error;
    const cli = toClient(row);
    const idx = cache.clients.findIndex(c => c.id === id);
    if (idx !== -1) cache.clients[idx] = cli;
    await addAuditLog("client", id, "update", `Cliente "${cli.name}" atualizado`);
    return cli;
  },
  async delete(id: number): Promise<void> {
    const cli = cache.clients.find(c => c.id === id);
    await supabase.from("clients").delete().eq("id", id);
    cache.clients = cache.clients.filter(c => c.id !== id);
    if (cli) await addAuditLog("client", id, "delete", `Cliente "${cli.name}" removido`);
  },
};

// ─── Appointments ────────────────────────────────────────

export const appointmentsStore = {
  list(filter?: { date?: string; employeeId?: number }): Appointment[] {
    let list = [...cache.appointments];
    if (filter?.date) list = list.filter(a => a.startTime.startsWith(filter.date!));
    if (filter?.employeeId) list = list.filter(a => a.employeeId === filter.employeeId);
    return list;
  },
  async fetchAll(): Promise<Appointment[]> {
    const data = await fetchAllFromTable("appointments", "start_time");
    cache.appointments = data.map(toAppointment);
    return cache.appointments;
  },
  async create(data: Omit<Appointment, "id" | "createdAt">): Promise<Appointment> {
    const { data: row, error } = await supabase.from("appointments").insert({ client_name: data.clientName, client_id: data.clientId, employee_id: data.employeeId, start_time: data.startTime, end_time: data.endTime, status: data.status, total_price: data.totalPrice, notes: data.notes, payment_status: data.paymentStatus, group_id: data.groupId, services: data.services }).select().single();
    if (error) {
      // Enriquecer o erro com contexto para diagnóstico
      const enriched = new Error(
        `Supabase insert falhou [appointments]: ${error.message}` +
        (error.code ? ` (code: ${error.code})` : "") +
        (error.details ? ` | details: ${error.details}` : "") +
        (error.hint ? ` | hint: ${error.hint}` : "")
      );
      (enriched as any).code = error.code;
      (enriched as any).details = error.details;
      (enriched as any).hint = error.hint;
      console.error("[store] appointments.create error:", error, "data:", data);
      throw enriched;
    }
    const appt = toAppointment(row);
    cache.appointments.push(appt);
    await addAuditLog("appointment", appt.id, "create", `Agendamento para "${appt.clientName}" criado`);
    return appt;
  },
  async update(id: number, data: Partial<Appointment>): Promise<Appointment | null> {
    const p: any = {};
    if (data.clientName !== undefined) p.client_name = data.clientName;
    if (data.clientId !== undefined) p.client_id = data.clientId;
    if (data.employeeId !== undefined) p.employee_id = data.employeeId;
    if (data.startTime !== undefined) p.start_time = data.startTime;
    if (data.endTime !== undefined) p.end_time = data.endTime;
    if (data.status !== undefined) p.status = data.status;
    if (data.totalPrice !== undefined) p.total_price = data.totalPrice;
    if (data.notes !== undefined) p.notes = data.notes;
    if (data.paymentStatus !== undefined) p.payment_status = data.paymentStatus;
    if (data.groupId !== undefined) p.group_id = data.groupId;
    if (data.services !== undefined) p.services = data.services;
    const { data: row, error } = await supabase.from("appointments").update(p).eq("id", id).select().single();
    if (error) throw error;
    const appt = toAppointment(row);
    const idx = cache.appointments.findIndex(a => a.id === id);
    if (idx !== -1) cache.appointments[idx] = appt;
    
    if (data.status === "completed" && appt.paymentStatus !== "paid") {
      await autoLaunchCashEntry(appt);
    }
    
    await addAuditLog("appointment", id, "update", `Agendamento #${id} atualizado`);
    return appt;
  },
  async delete(id: number): Promise<void> {
    await supabase.from("appointments").delete().eq("id", id);
    cache.appointments = cache.appointments.filter(a => a.id !== id);
    await addAuditLog("appointment", id, "delete", `Agendamento #${id} removido`);
  },
};

// ─── Cash Sessions ───────────────────────────────────────

export const cashSessionsStore = {
  list(): CashSession[] { return [...cache.cashSessions]; },
  getCurrent(): CashSession | null { return cache.cashSessions.find(s => s.status === "open") || null; },
  async fetchAll(): Promise<CashSession[]> {
    const { data, error } = await supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false });
    if (error) throw error;
    cache.cashSessions = (data ?? []).map(toCashSession);
    return cache.cashSessions;
  },
  async open(openingBalance: number): Promise<CashSession> {
    const { data: row, error } = await supabase.from("cash_sessions").insert({ opened_at: new Date().toISOString(), opening_balance: openingBalance, status: "open" }).select().single();
    if (error) throw error;
    const session = toCashSession(row);
    cache.cashSessions.unshift(session);
    await addAuditLog("cash_session", session.id, "open", `Caixa aberto com R$ ${openingBalance.toFixed(2)}`);
    return session;
  },
  async close(id: number, data: { totalRevenue: number; totalCommissions: number; closingNotes?: string }): Promise<CashSession> {
    const { data: row, error } = await supabase.from("cash_sessions").update({ closed_at: new Date().toISOString(), total_revenue: data.totalRevenue, total_commissions: data.totalCommissions, closing_notes: data.closingNotes, status: "closed" }).eq("id", id).select().single();
    if (error) throw error;
    const session = toCashSession(row);
    const idx = cache.cashSessions.findIndex(s => s.id === id);
    if (idx !== -1) cache.cashSessions[idx] = session;
    await addAuditLog("cash_session", id, "close", `Caixa fechado. Receita: R$ ${data.totalRevenue.toFixed(2)}`);
    return session;
  },
};

// ─── Cash Entries ────────────────────────────────────────

export const cashEntriesStore = {
  list(sessionId?: number): CashEntry[] {
    return sessionId ? cache.cashEntries.filter(e => e.sessionId === sessionId) : [...cache.cashEntries];
  },
  async fetchAll(): Promise<CashEntry[]> {
    const data = await fetchAllFromTable("cash_entries", "created_at");
    cache.cashEntries = data.map(toCashEntry);
    return cache.cashEntries;
  },
  async create(data: Omit<CashEntry, "id" | "createdAt">): Promise<CashEntry> {
    const { data: row, error } = await supabase.from("cash_entries").insert({ session_id: data.sessionId, appointment_id: data.appointmentId, client_name: data.clientName, employee_id: data.employeeId, description: data.description, amount: data.amount, payment_method: data.paymentMethod, commission_percent: data.commissionPercent, commission_value: data.commissionValue, material_cost_value: data.materialCostValue, is_auto_launch: data.isAutoLaunch }).select().single();
    if (error) throw error;
    const entry = toCashEntry(row);
    cache.cashEntries.unshift(entry);
    return entry;
  },
  async update(id: number, data: Partial<CashEntry>): Promise<CashEntry | null> {
    const p: any = {};
    if (data.clientName !== undefined) p.client_name = data.clientName;
    if (data.description !== undefined) p.description = data.description;
    if (data.amount !== undefined) p.amount = data.amount;
    if (data.paymentMethod !== undefined) p.payment_method = data.paymentMethod;
    if (data.commissionPercent !== undefined) p.commission_percent = data.commissionPercent;
    if (data.commissionValue !== undefined) p.commission_value = data.commissionValue;
    const { data: row, error } = await supabase.from("cash_entries").update(p).eq("id", id).select().single();
    if (error) throw error;
    const entry = toCashEntry(row);
    const idx = cache.cashEntries.findIndex(e => e.id === id);
    if (idx !== -1) cache.cashEntries[idx] = entry;
    return entry;
  },
  async delete(id: number): Promise<void> {
    await supabase.from("cash_entries").delete().eq("id", id);
    cache.cashEntries = cache.cashEntries.filter(e => e.id !== id);
    await addAuditLog("cash_entry", id, "delete", `Lançamento #${id} removido`);
  },
  async deleteBySession(sessionId: number): Promise<void> {
    await supabase.from("cash_entries").delete().eq("session_id", sessionId);
    cache.cashEntries = cache.cashEntries.filter(e => e.sessionId !== sessionId);
  },
  async deleteByAppointment(appointmentId: number): Promise<void> {
    await supabase.from("cash_entries").delete().eq("appointment_id", appointmentId);
    cache.cashEntries = cache.cashEntries.filter(e => e.appointmentId !== appointmentId);
  },
};

// ─── Auto-Launch Cash Entry ──────────────────────────────────

async function autoLaunchCashEntry(appt: Appointment): Promise<void> {
  const currentSession = cache.cashSessions.find(s => s.status === "open");
  if (!currentSession) return;

  const sessionDate = currentSession.openedAt.slice(0, 10);
  const apptDate    = appt.startTime.slice(0, 10);
  if (apptDate < sessionDate) return;

  const existing = cache.cashEntries.find(e => e.appointmentId === appt.id);
  if (existing) return;

  const emp = cache.employees.find(e => e.id === appt.employeeId);
  if (!emp) return;

  const amount = toNum(appt.totalPrice);
  const materialCostValue = (appt.services ?? []).reduce((sum, s) => {
    const svcPrice = s.price ?? 0;
    const costPct  = s.materialCostPercent ?? 0;
    return sum + (svcPrice * costPct / 100);
  }, 0);
  const baseForCommission = Math.max(0, amount - materialCostValue);
  const commissionValue = baseForCommission * (emp.commissionPercent / 100);
  const services = (appt.services ?? []).map(s => s.name).join(", ") || "Serviço";

  await cashEntriesStore.create({
    sessionId: currentSession.id,
    appointmentId: appt.id,
    clientName: appt.clientName ?? "Cliente",
    employeeId: emp.id,
    description: services,
    amount,
    paymentMethod: "dinheiro",
    commissionPercent: emp.commissionPercent,
    commissionValue,
    materialCostValue,
    isAutoLaunch: true,
  });

  await appointmentsStore.update(appt.id, { paymentStatus: "paid" });
  window.dispatchEvent(new Event("cash_entry_auto_launched"));
}

// ─── Audit Log ───────────────────────────────────────────

export const auditStore = {
  log(entityType?: string): AuditLog[] {
    const all = [...cache.auditLogs];
    const filtered = entityType ? all.filter(l => l.entityType === entityType) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async fetchAll(): Promise<AuditLog[]> {
    const data = await fetchAllFromTable("audit_logs", "created_at");
    cache.auditLogs = data.map(toAuditLog);
    return cache.auditLogs;
  },
};

// ─── Abertura Automática do Caixa ─────────────────────────

export async function autoOpenCashIfNeeded(): Promise<boolean> {
  try {
    const config = localStorage.getItem("salon_config");
    if (config) {
      const parsed = JSON.parse(config);
      if (parsed.autoOpenCash === false) return false;
    }
  } catch { /* ignore */ }

  const currentSession = cashSessionsStore.getCurrent();
  if (currentSession) return false;

  const sessions = cashSessionsStore.list();
  const lastClosed = sessions.find(s => s.status === "closed");
  const openingBalance = lastClosed?.totalRevenue
    ? Math.max(0, (lastClosed.totalRevenue - (lastClosed.totalCommissions ?? 0)) + (lastClosed.openingBalance ?? 0))
    : 0;

  await cashSessionsStore.open(openingBalance);
  return true;
}

// ─── Carregamento inicial ─────────────────────────────────

export async function fetchAllData(): Promise<void> {
  await Promise.all([
    employeesStore.fetchAll(),
    servicesStore.fetchAll(),
    clientsStore.fetchAll(),
    appointmentsStore.fetchAll(),
    cashSessionsStore.fetchAll(),
    cashEntriesStore.fetchAll(),
    auditStore.fetchAll(),
  ]);
}

/**
 * fetchDashboardData — Carrega APENAS os dados necessários para o Dashboard.
 * Muito mais rápido que fetchAllData() porque:
 *   - Agendamentos: só do dia atual (poucos registros)
 *   - Clientes: apenas o COUNT via Supabase (sem baixar todos os registros)
 *   - Funcionários e sessão de caixa: poucos registros, OK carregar tudo
 *   - NÃO carrega: cashEntries, auditLogs (desnecessários no dashboard)
 */
export async function fetchDashboardData(): Promise<{ clientCount: number }> {
  const today = new Date().toISOString().split("T")[0];

  const [, , apptResult, , countResult] = await Promise.all([
    // Funcionários (poucos registros)
    employeesStore.fetchAll(),
    // Serviços (poucos registros)
    servicesStore.fetchAll(),
    // Agendamentos só do dia atual
    supabase
      .from("appointments")
      .select("*")
      .gte("start_time", `${today}T00:00:00`)
      .lte("start_time", `${today}T23:59:59`)
      .order("start_time"),
    // Sessão de caixa aberta
    cashSessionsStore.fetchAll(),
    // COUNT de clientes sem baixar todos
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true }),
  ]);

  // Popular cache de agendamentos com só os de hoje
  if (apptResult.data && !apptResult.error) {
    const mapped = apptResult.data.map((row: any) => ({
      id: row.id,
      clientName: row.client_name,
      clientId: row.client_id,
      employeeId: row.employee_id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      totalPrice: row.total_price,
      notes: row.notes,
      paymentStatus: row.payment_status,
      groupId: row.group_id,
      services: row.services ?? [],
      createdAt: row.created_at,
    }));
    // Merge no cache sem apagar agendamentos de outros dias já carregados
    const otherDays = (cache as any).appointments.filter(
      (a: any) => !a.startTime?.startsWith(today)
    );
    (cache as any).appointments = [...otherDays, ...mapped];
  }

  const clientCount = countResult.count ?? (cache as any).clients.length;
  return { clientCount };
}

