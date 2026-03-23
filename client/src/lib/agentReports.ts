/**
 * agentReports.ts — Gerador de relatorios formatados.
 * Produz textos de relatorio para tarefas agendadas e consultas sob demanda.
 *
 * Tipos de relatorio:
 * - Rendimento bruto/liquido (dia, semana, mes)
 * - Resumo de agendamentos
 * - Clientes (novos, inativos, total)
 * - Cancelamentos/faltas
 * - Servicos populares
 * - Resumo completo (tudo junto)
 */

import {
  employeesStore,
  servicesStore,
  clientsStore,
  appointmentsStore,
  cashEntriesStore,
} from "./store";
import { calcPeriodStats, getAppointmentsInPeriod, getPeriodDates } from "./analytics";
import type { ReportType } from "./agentScheduler";

// ─── Helpers de periodo ────────────────────────────────────

interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
}

function getPeriodRange(scope: "dia" | "semana" | "mes" | "mes_anterior"): PeriodRange {
  const now = new Date();

  if (scope === "dia") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: `hoje (${start.toLocaleDateString("pt-BR")})` };
  }

  if (scope === "semana") {
    // Semana: segunda a domingo (ou ate hoje se ainda nao acabou)
    const { start, end } = getPeriodDates("semana");
    return { start, end, label: `esta semana (${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")})` };
  }

  if (scope === "mes_anterior") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const mesNome = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return { start, end, label: `${mesNome}` };
  }

  // mes (atual)
  const { start, end } = getPeriodDates("mes");
  return { start, end, label: `este mes (${start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })})` };
}

// ─── Geradores de relatorio ────────────────────────────────

function reportRendimentoBruto(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const employees = employeesStore.list(false);
  const appts = getAppointmentsInPeriod(start, end);
  const stats = calcPeriodStats(appts, employees);

  const lines = [
    `**Rendimento Bruto — ${label}**\n`,
    `Faturamento bruto: **R$ ${stats.totalRevenue.toFixed(2)}**`,
    `Atendimentos: ${stats.count}`,
    `Ticket medio: R$ ${stats.avgTicket.toFixed(2)}`,
  ];

  if (stats.count > 0) {
    // Top funcionarios
    const empRanking = stats.byEmployee
      ?.sort((a: { revenue: number }, b: { revenue: number }) => b.revenue - a.revenue)
      .slice(0, 3);
    if (empRanking && empRanking.length > 0) {
      lines.push(`\nTop funcionarios:`);
      empRanking.forEach((e: { name: string; revenue: number; count: number }, i: number) => {
        lines.push(`  ${i + 1}. ${e.name}: R$ ${e.revenue.toFixed(2)} (${e.count} atend.)`);
      });
    }
  }

  return lines.join("\n");
}

function reportRendimentoLiquido(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const employees = employeesStore.list(false);
  const appts = getAppointmentsInPeriod(start, end);
  const stats = calcPeriodStats(appts, employees);

  const lines = [
    `**Rendimento Liquido — ${label}**\n`,
    `Faturamento bruto: R$ ${stats.totalRevenue.toFixed(2)}`,
    `Comissoes: R$ ${stats.totalCommissions.toFixed(2)}`,
    `Custos de material: R$ ${stats.totalMaterialCost.toFixed(2)}`,
    `**Liquido: R$ ${stats.netRevenue.toFixed(2)}**`,
    `\nMargem: ${stats.totalRevenue > 0 ? ((stats.netRevenue / stats.totalRevenue) * 100).toFixed(1) : 0}%`,
  ];

  return lines.join("\n");
}

function reportAgendamentos(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const appts = getAppointmentsInPeriod(start, end);

  const total = appts.length;
  const completed = appts.filter(a => a.status === "completed").length;
  const cancelled = appts.filter(a => a.status === "cancelled").length;
  const noShow = appts.filter(a => a.status === "no_show").length;
  const pending = total - completed - cancelled - noShow;

  const lines = [
    `**Agendamentos — ${label}**\n`,
    `Total: ${total}`,
    `Concluidos: ${completed}`,
    `Pendentes: ${pending}`,
    `Cancelados: ${cancelled}`,
    `Faltas (no-show): ${noShow}`,
  ];

  if (total > 0) {
    const cancelRate = ((cancelled + noShow) / total * 100).toFixed(1);
    lines.push(`\nTaxa de cancelamento/falta: ${cancelRate}%`);
  }

  return lines.join("\n");
}

function reportClientes(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const clients = clientsStore.list();
  const allAppts = appointmentsStore.list({});

  // Clientes novos no periodo
  const newClients = clients.filter(c => {
    const created = new Date(c.createdAt ?? 0);
    return created >= start && created <= end;
  });

  // Clientes atendidos no periodo
  const appts = getAppointmentsInPeriod(start, end);
  const attendedClientIds = new Set(
    appts
      .filter(a => a.status !== "cancelled" && a.status !== "no_show" && a.clientId)
      .map(a => a.clientId)
  );

  // Clientes inativos (sem visita ha 30+ dias)
  const cutoff30 = Date.now() - 30 * 86400000;
  const clientLastVisit: Record<number, number> = {};
  for (const a of allAppts) {
    if (a.clientId && a.status !== "cancelled" && a.status !== "no_show") {
      const t = new Date(a.startTime).getTime();
      if (!clientLastVisit[a.clientId] || t > clientLastVisit[a.clientId]) {
        clientLastVisit[a.clientId] = t;
      }
    }
  }
  const inactiveCount = clients.filter(c => {
    const last = clientLastVisit[c.id];
    return !last || last < cutoff30;
  }).length;

  const lines = [
    `**Clientes — ${label}**\n`,
    `Total de clientes: ${clients.length}`,
    `Novos no periodo: ${newClients.length}`,
    `Atendidos no periodo: ${attendedClientIds.size}`,
    `Inativos (30+ dias sem visita): ${inactiveCount}`,
  ];

  return lines.join("\n");
}

function reportCancelamentos(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const appts = getAppointmentsInPeriod(start, end);

  const cancelled = appts.filter(a => a.status === "cancelled");
  const noShow = appts.filter(a => a.status === "no_show");
  const total = appts.length;

  const lines = [
    `**Cancelamentos e Faltas — ${label}**\n`,
    `Cancelamentos: ${cancelled.length}`,
    `Faltas (no-show): ${noShow.length}`,
    `Total de agendamentos: ${total}`,
  ];

  if (total > 0) {
    const rate = ((cancelled.length + noShow.length) / total * 100).toFixed(1);
    lines.push(`Taxa: ${rate}%`);
  }

  if (cancelled.length + noShow.length > 3) {
    lines.push(`\nDica: Considere enviar lembretes 24h antes ou cobrar sinal para reduzir no-shows.`);
  }

  return lines.join("\n");
}

function reportServicosPopulares(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const { start, end, label } = getPeriodRange(scope);
  const appts = getAppointmentsInPeriod(start, end);

  const serviceCounts: Record<string, { count: number; revenue: number }> = {};
  appts.forEach(a => {
    if (a.status === "cancelled" || a.status === "no_show") return;
    (a.services ?? []).forEach((s: { name: string; price?: number }) => {
      if (!serviceCounts[s.name]) serviceCounts[s.name] = { count: 0, revenue: 0 };
      serviceCounts[s.name].count++;
      serviceCounts[s.name].revenue += s.price ?? 0;
    });
  });

  const sorted = Object.entries(serviceCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  const lines = [
    `**Servicos Populares — ${label}**\n`,
  ];

  if (sorted.length === 0) {
    lines.push("Nenhum servico realizado neste periodo.");
  } else {
    sorted.forEach(([name, data], i) => {
      lines.push(`${i + 1}. ${name}: ${data.count}x (R$ ${data.revenue.toFixed(2)})`);
    });
  }

  return lines.join("\n");
}

function reportResumoCompleto(scope: "dia" | "semana" | "mes" | "mes_anterior"): string {
  const parts = [
    reportRendimentoLiquido(scope),
    "",
    "---",
    "",
    reportAgendamentos(scope),
    "",
    "---",
    "",
    reportServicosPopulares(scope),
  ];

  return parts.join("\n");
}

// ─── API publica ───────────────────────────────────────────

/**
 * Gera um relatorio formatado com base no tipo e periodo.
 */
export function generateReport(
  reportType: ReportType,
  periodScope: "dia" | "semana" | "mes" | "mes_anterior"
): string {
  switch (reportType) {
    case "rendimento_bruto":
      return reportRendimentoBruto(periodScope);
    case "rendimento_liquido":
      return reportRendimentoLiquido(periodScope);
    case "agendamentos":
      return reportAgendamentos(periodScope);
    case "clientes":
      return reportClientes(periodScope);
    case "cancelamentos":
      return reportCancelamentos(periodScope);
    case "servicos_populares":
      return reportServicosPopulares(periodScope);
    case "resumo_completo":
      return reportResumoCompleto(periodScope);
    default:
      return reportResumoCompleto(periodScope);
  }
}

/**
 * Gera relatorio sob demanda a partir de texto do usuario.
 * Retorna null se nao entender o pedido.
 */
export function generateOnDemandReport(question: string): string | null {
  const q = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Detectar se e um pedido de relatorio
  const isReportRequest =
    /relatorio|resumo|balanco|fechamento|resultado/.test(q) ||
    (/rendimento|liquido|bruto|faturamento/.test(q) && /semana|mes|dia|periodo/.test(q));

  if (!isReportRequest) return null;

  // Detectar tipo
  let reportType: ReportType = "resumo_completo";
  if (/liquid[oa]|lucro/.test(q)) reportType = "rendimento_liquido";
  else if (/bruto|rendimento|faturamento/.test(q)) reportType = "rendimento_bruto";
  else if (/agendamento|agenda/.test(q)) reportType = "agendamentos";
  else if (/cliente/.test(q)) reportType = "clientes";
  else if (/cancelamento|falta/.test(q)) reportType = "cancelamentos";
  else if (/servico|popular/.test(q)) reportType = "servicos_populares";

  // Detectar periodo
  let scope: "dia" | "semana" | "mes" | "mes_anterior" = "semana";
  if (/mes\s+(anterior|passado)/.test(q)) scope = "mes_anterior";
  else if (/hoje|dia/.test(q)) scope = "dia";
  else if (/semana/.test(q)) scope = "semana";
  else if (/mes/.test(q)) scope = "mes";

  return generateReport(reportType, scope);
}
