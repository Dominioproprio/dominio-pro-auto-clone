import {
  appointmentsStore,
  cashSessionsStore,
  clientsStore,
  employeesStore,
  servicesStore,
  type Client,
  type Employee,
  type Service,
} from "../../store";
import type { ClientResolution } from "../types";
import { extractLikelyClientTerm, normalizar } from "../core/interpreter";

export async function ensureBaseLoaded(): Promise<void> {
  await Promise.allSettled([
    clientsStore.ensureLoaded(),
    Promise.resolve(servicesStore.list(true).length || servicesStore.fetchAll()),
    Promise.resolve(employeesStore.list(true).length || employeesStore.fetchAll()),
    Promise.resolve(appointmentsStore.list().length || appointmentsStore.fetchAll()),
    Promise.resolve(cashSessionsStore.list().length || cashSessionsStore.fetchAll()),
  ]);
}

function scoreNameMatch(haystack: string, candidate: string): number {
  const c = normalizar(candidate);
  if (!c) return 0;
  if (haystack.includes(c)) return 1;
  const tokens = c.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every((t) => haystack.includes(t))) return 0.9;
  const intersect = tokens.filter((t) => haystack.includes(t)).length;
  return intersect / Math.max(tokens.length, 1);
}

export function findServiceInMessage(msg: string): Service | undefined {
  const n = normalizar(msg);
  const services = servicesStore.list(true);
  return services
    .map((service) => ({ service, score: scoreNameMatch(n, service.name) }))
    .filter((x) => x.score > 0.75)
    .sort((a, b) => b.score - a.score)[0]?.service;
}

export function findEmployeeInMessage(msg: string): Employee | undefined {
  const n = normalizar(msg);
  const employees = employeesStore.list(true);
  return employees
    .map((employee) => ({ employee, score: scoreNameMatch(n, employee.name) }))
    .filter((x) => x.score > 0.75)
    .sort((a, b) => b.score - a.score)[0]?.employee;
}

export async function resolveClientFromMessage(msg: string): Promise<ClientResolution> {
  const term = extractLikelyClientTerm(msg);
  if (!term) return {};
  return resolveClientByTerm(term);
}

export async function resolveClientByTerm(term: string): Promise<ClientResolution> {
  const found = await clientsStore.search(term, { limit: 5 });
  if (found.length === 1) return { client: found[0] };
  if (found.length > 1) return { error: `Encontrei mais de um cliente para "${term}". Seja mais específico.` };
  return { error: `Não encontrei cliente para "${term}". O agente não cria cliente automaticamente. Se quiser, peça o cadastro explicitamente ou faça isso pela agenda.` };
}

export function getEmployeeName(employeeId: number): string {
  return employeesStore.list().find((employee) => employee.id === employeeId)?.name ?? `ID ${employeeId}`;
}

export function getClientById(id: number | null | undefined): Client | undefined {
  if (!id) return undefined;
  return clientsStore.list().find((client) => client.id === id);
}
