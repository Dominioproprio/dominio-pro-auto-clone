/**
 * analytics.ts — Fonte única de verdade para cálculos financeiros.
 * Todos os dados derivam dos agendamentos (appointments).
 * Regras:
 *  - Conta tudo exceto cancelled e no_show
 *  - Custo de material deduzido antes da comissão
 *  - Consistente em Dashboard, Caixa e Relatórios
 */
import { appointmentsStore, employeesStore, type Appointment, type Employee } from "./store";
import { format, isWithinInterval, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, addDays } from "date-fns";

export const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export const EXCLUDED = ["cancelled", "no_show"] as const;
export const isValid = (a: Appointment) => !EXCLUDED.includes(a.status as any) && toNum(a.totalPrice) > 0;

export type Period = "hoje" | "semana" | "mes" | "trimestre" | "ano" | "custom";

export function getPeriodDates(period: Period, customStart?: string, customEnd?: string) {
  const now = new Date();
  switch (period) {
    case "hoje":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
        end:   new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59),
        label: "Hoje",
      };
    case "semana":
      return {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end:   endOfWeek(now,   { weekStartsOn: 1 }),
        label: "Esta semana",
      };
    case "mes":
      return { start: startOfMonth(now), end: endOfMonth(now), label: "Este mês" };
    case "trimestre":
      return { start: subDays(now, 89), end: now, label: "Últimos 90 dias" };
    case "ano":
      return { start: startOfYear(now), end: endOfYear(now), label: "Este ano" };
    case "custom":
      return {
        start: customStart ? parseISO(customStart) : subDays(now, 30),
        end:   customEnd   ? parseISO(customEnd)   : now,
        label: "Período personalizado",
      };
  }
}

export function getAppointmentsInPeriod(start: Date, end: Date): Appointment[] {
  return appointmentsStore.list({}).filter(a => {
    try {
      return isWithinInterval(parseISO(a.startTime), { start, end });
    } catch { return false; }
  });
}

export function calcMaterialCost(appt: Appointment): number {
  return (appt.services ?? []).reduce((sum, s) => {
    return sum + ((s.price ?? 0) * ((s.materialCostPercent ?? 0) / 100));
  }, 0);
}

export function calcCommission(appt: Appointment, emp: Employee): number {
  const base = Math.max(0, toNum(appt.totalPrice) - calcMaterialCost(appt));
  return base * (emp.commissionPercent / 100);
}

export interface PeriodStats {
  totalRevenue:      number;
  totalMaterial:     number;
  totalCommissions:  number;
  netRevenue:        number;
  count:             number;
  avgTicket:         number;
  cancelCount:       number;
  cancelRate:        number;
  scheduledRevenue:  number; // agendados futuros (projeção)
  scheduledCount:    number;
}

export function calcPeriodStats(appts: Appointment[], employees: Employee[]): PeriodStats {
  const empMap = new Map(employees.map(e => [e.id, e]));

  const valid    = appts.filter(isValid);
  const future   = appts.filter(a => ["scheduled", "confirmed"].includes(a.status) && new Date(a.startTime) > new Date());
  const cancelled = appts.filter(a => EXCLUDED.includes(a.status as any));

  let totalRevenue     = 0;
  let totalMaterial    = 0;
  let totalCommissions = 0;

  for (const a of valid) {
    const rev  = toNum(a.totalPrice);
    const mat  = calcMaterialCost(a);
    const emp  = empMap.get(a.employeeId);
    const comm = emp ? calcCommission(a, emp) : 0;
    totalRevenue     += rev;
    totalMaterial    += mat;
    totalCommissions += comm;
  }

  const netRevenue      = totalRevenue - totalMaterial - totalCommissions;
  const scheduledRevenue = future.reduce((s, a) => s + toNum(a.totalPrice), 0);

  return {
    totalRevenue,
    totalMaterial,
    totalCommissions,
    netRevenue,
    count:            valid.length,
    avgTicket:        valid.length > 0 ? totalRevenue / valid.length : 0,
    cancelCount:      cancelled.length,
    cancelRate:       appts.length > 0 ? (cancelled.length / appts.length) * 100 : 0,
    scheduledRevenue,
    scheduledCount:   future.length,
  };
}

export function calcRevenueByDay(appts: Appointment[], days: number = 7): { date: string; label: string; revenue: number; count: number }[] {
  const result: { date: string; label: string; revenue: number; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(new Date(), i);
    const key = format(d, "yyyy-MM-dd");
    const dayAppts = appts.filter(a => {
      try { return format(parseISO(a.startTime), "yyyy-MM-dd") === key; } catch { return false; }
    }).filter(isValid);
    result.push({
      date:    key,
      label:   format(d, "EEE dd/MM", { locale: { code: "pt-BR" } as any }).replace(/^\w/, c => c.toUpperCase()),
      revenue: dayAppts.reduce((s, a) => s + toNum(a.totalPrice), 0),
      count:   dayAppts.length,
    });
  }
  return result;
}

export function calcRevenueByEmployee(appts: Appointment[], employees: Employee[]) {
  return employees.map(emp => {
    const empAppts = appts.filter(a => a.employeeId === emp.id).filter(isValid);
    const revenue  = empAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
    const material = empAppts.reduce((s, a) => s + calcMaterialCost(a), 0);
    const commission = revenue > 0 ? revenue * (emp.commissionPercent / 100) : 0;
    return {
      id:         emp.id,
      name:       emp.name,
      firstName:  emp.name.split(" ")[0],
      color:      emp.color,
      photoUrl:   emp.photoUrl,
      revenue,
      material,
      commission,
      net:        revenue - material - commission,
      count:      empAppts.length,
      commissionPercent: emp.commissionPercent,
    };
  }).filter(e => e.count > 0).sort((a, b) => b.revenue - a.revenue);
}

export function calcPopularServices(appts: Appointment[]) {
  const counts: Record<number, { serviceId: number; name: string; count: number; revenue: number; color: string }> = {};
  appts.filter(isValid).forEach(a => {
    (a.services ?? []).forEach(s => {
      if (!counts[s.serviceId]) {
        counts[s.serviceId] = { serviceId: s.serviceId, name: s.name, count: 0, revenue: 0, color: s.color ?? "#ec4899" };
      }
      counts[s.serviceId].count++;
      counts[s.serviceId].revenue += toNum(s.price);
    });
  });
  return Object.values(counts).sort((a, b) => b.count - a.count);
}
