/**
 * DashboardCaixaPage v4 — Visão em Tempo Real de Todos os Agendamentos
 * Reflete 100% da agenda, independentemente do status.
 * Excluindo apenas: cancelados e não compareceu.
 */
import { useState, useMemo } from "react";
import {
  format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, parseISO, isWithinInterval, addDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp, TrendingDown, DollarSign, Percent, Users,
  CreditCard, Calendar, BarChart2, Award, ArrowUpRight,
  Clock, CheckCircle, Eye,
} from "lucide-react";
import {
  employeesStore, appointmentsStore,
} from "@/lib/store";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

type Period = "hoje" | "semana" | "mes" | "trimestre" | "ano" | "custom";

function getPeriodRange(period: Period, customStart?: string, customEnd?: string) {
  const now = new Date();
  switch (period) {
    case "hoje":
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59), label: "Hoje" };
    case "semana":
      return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }), label: "Esta semana" };
    case "mes":
      return { start: startOfMonth(now), end: endOfMonth(now), label: "Este mês" };
    case "trimestre":
      return { start: subDays(now, 90), end: now, label: "Últimos 90 dias" };
    case "ano":
      return { start: startOfYear(now), end: endOfYear(now), label: "Este ano" };
    case "custom":
      return { start: customStart ? parseISO(customStart) : subDays(now, 30), end: customEnd ? parseISO(customEnd) : addDays(now, 30), label: "Período personalizado" };
  }
}

function Sparkline({ data, color = "#ec4899" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 80; const h = 28;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardCaixaPage() {
  const [period, setPeriod]           = useState<Period>("mes");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]     = useState("");

  const employees  = useMemo(() => employeesStore.list(false), []);
  const allAppts   = useMemo(() => appointmentsStore.list({}), []);

  const { start, end, label } = getPeriodRange(period, customStart, customEnd);
  const now = new Date();

  // Filtrar agendamentos ativos no período (excluindo cancelados e não compareceu)
  const activeAppts = useMemo(() =>
    allAppts.filter(a => {
      // Exclui apenas cancelados e não compareceu
      if (["cancelled", "no_show"].includes(a.status)) return false;
      // Ignora valores irrelevantes
      if (toNum(a.totalPrice) <= 0.01) return false;
      // Verifica se está no período
      return isWithinInterval(parseISO(a.startTime), { start, end });
    }),
    [allAppts, start, end]
  );

  // Cálculos baseados em TODOS os agendamentos ativos
  const totalRevenue     = activeAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
  const totalCommissions = activeAppts.reduce((s, a) => {
    const emp = employees.find(e => e.id === a.employeeId);
    return s + (emp ? toNum(a.totalPrice) * (emp.commissionPercent / 100) : 0);
  }, 0);
  const netRevenue       = totalRevenue - totalCommissions;
  const avgTicket        = activeAppts.length > 0 ? totalRevenue / activeAppts.length : 0;

  // Comparação com período anterior
  const prevDiff  = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - prevDiff);
  const prevEnd   = new Date(start.getTime() - 1);
  const prevAppts = allAppts.filter(a => {
    if (["cancelled", "no_show"].includes(a.status)) return false;
    if (toNum(a.totalPrice) <= 0.01) return false;
    return isWithinInterval(parseISO(a.startTime), { start: prevStart, end: prevEnd });
  });
  const prevRevenue  = prevAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
  const revenueDelta = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null;

  // Dados diários
  const dailyData = useMemo(() => {
    const daily: Record<string, number> = {};
    activeAppts.forEach(a => {
      const d = format(parseISO(a.startTime), "yyyy-MM-dd");
      daily[d] = (daily[d] ?? 0) + toNum(a.totalPrice);
    });
    const diff = Math.min(Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1, 60);
    return Array.from({ length: diff }, (_, i) => {
      const d = format(new Date(start.getTime() + i * 86400000), "yyyy-MM-dd");
      return { date: d, revenue: daily[d] ?? 0 };
    });
  }, [activeAppts, start, end]);

  // Por funcionário
  const byEmployee = useMemo(() => {
    return employees.map(emp => {
      const empAppts = activeAppts.filter(a => a.employeeId === emp.id);
      const revenue   = empAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
      const commission = revenue * (emp.commissionPercent / 100);
      return { employee: emp, revenue, commission, count: empAppts.length };
    })
    .filter(e => e.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  }, [employees, activeAppts]);

  // Por dia da semana
  const byWeekday = useMemo(() => {
    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const revenue: Record<number, number> = {};
    activeAppts.forEach(a => {
      const wd = parseISO(a.startTime).getDay();
      revenue[wd] = (revenue[wd] ?? 0) + toNum(a.totalPrice);
    });
    return days.map((name, i) => ({
      name,
      revenue: revenue[i] ?? 0,
    }));
  }, [activeAppts]);

  const maxWeekday = Math.max(...byWeekday.map(d => d.revenue), 1);

  // Top dias
  const topDays = useMemo(() => {
    const map: Record<string, number> = {};
    activeAppts.forEach(a => {
      const d = format(parseISO(a.startTime), "yyyy-MM-dd");
      map[d] = (map[d] ?? 0) + toNum(a.totalPrice);
    });
    return Object.entries(map)
      .map(([day, revenue]) => ({ day, revenue }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [activeAppts]);

  // Contadores por status
  const statusCounts = useMemo(() => {
    return {
      scheduled: activeAppts.filter(a => a.status === "scheduled").length,
      confirmed: activeAppts.filter(a => a.status === "confirmed").length,
      in_progress: activeAppts.filter(a => a.status === "in_progress").length,
      completed: activeAppts.filter(a => a.status === "completed").length,
    };
  }, [activeAppts]);

  const PERIODS = [
    { key: "hoje" as Period,      label: "Hoje"    },
    { key: "semana" as Period,    label: "Semana"  },
    { key: "mes" as Period,       label: "Mês"     },
    { key: "trimestre" as Period, label: "90 dias" },
    { key: "ano" as Period,       label: "Ano"     },
    { key: "custom" as Period,    label: "Período" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />Dashboard Financeiro
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {PERIODS.map(p => (
            <Button key={p.key} size="sm" variant={period === p.key ? "default" : "ghost"}
              className="h-7 text-xs px-3" onClick={() => setPeriod(p.key)}>{p.label}</Button>
          ))}
        </div>
      </div>

      {period === "custom" && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50">
          <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm" />
            <span className="text-muted-foreground text-sm">até</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm" />
          </div>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap p-3 rounded-lg bg-card/30 border border-border">
        <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-primary" /><span className="font-medium text-foreground">Faturamento</span> — todos os agendamentos ativos</span>
        <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-blue-400" /><span className="font-medium text-foreground">Tempo Real</span> — atualiza com a agenda</span>
      </div>

      {/* KPIs Principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Faturamento</p>
            <p className="text-xl font-bold text-primary">R$ {totalRevenue.toFixed(2)}</p>
            <div className="flex items-center justify-between mt-1">
              {revenueDelta !== null ? (
                <span className={`text-[10px] flex items-center gap-0.5 ${revenueDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {revenueDelta >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {Math.abs(revenueDelta).toFixed(1)}% vs ant.
                </span>
              ) : <span />}
              <Sparkline data={dailyData.map(d => d.revenue)} color="#ec4899" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Comissões</p>
            <p className="text-xl font-bold">R$ {totalCommissions.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{activeAppts.length} agendamento(s)</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Líquido</p>
            <p className="text-xl font-bold text-emerald-400">R$ {netRevenue.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {totalRevenue > 0 ? `${((netRevenue / totalRevenue) * 100).toFixed(1)}% do bruto` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Ticket médio</p>
            <p className="text-xl font-bold">R$ {avgTicket.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{activeAppts.length} agendamento(s)</p>
          </CardContent>
        </Card>
      </div>

      {/* Status dos Agendamentos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Agendados</p>
            <p className="text-xl font-bold text-blue-400">{statusCounts.scheduled}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Confirmados</p>
            <p className="text-xl font-bold text-amber-400">{statusCounts.confirmed}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Em andamento</p>
            <p className="text-xl font-bold text-orange-400">{statusCounts.in_progress}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Concluídos</p>
            <p className="text-xl font-bold text-emerald-400">{statusCounts.completed}</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Faturamento por Dia */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Faturamento — Últimos dias</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {dailyData.slice(-7).reverse().map((d, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-medium w-12 text-muted-foreground">
                  {format(parseISO(d.date), "dd/MM", { locale: ptBR })}
                </span>
                <div className="flex-1 h-5 bg-secondary/30 rounded-md overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-500" 
                    style={{ width: `${Math.max(...dailyData.map(x => x.revenue)) > 0 ? (d.revenue / Math.max(...dailyData.map(x => x.revenue))) * 100 : 0}%` }} />
                </div>
                <span className="text-xs font-bold w-20 text-right">R$ {d.revenue.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Ranking de Funcionários */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-4 h-4 text-primary" />Ranking de Funcionários
          </CardTitle>
        </CardHeader>
        <CardContent>
          {byEmployee.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum agendamento no período</p>
          ) : (
            <div className="space-y-3">
              {byEmployee.map((emp, i) => (
                <div key={emp.employee.id} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}°</span>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: emp.employee.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{emp.employee.name.split(" ")[0]}</span>
                      <span className="text-sm font-bold text-primary">R$ {emp.revenue.toFixed(2)}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${byEmployee[0] ? (emp.revenue / byEmployee[0].revenue) * 100 : 0}%`,
                        backgroundColor: emp.employee.color,
                      }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{emp.count} agend. — Comissão: R$ {emp.commission.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Por Dia da Semana */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Faturamento por Dia da Semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {byWeekday.map((day, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-medium w-8">{day.name}</span>
                <div className="flex-1 h-5 bg-secondary/30 rounded-md overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-500" 
                    style={{ width: `${maxWeekday > 0 ? (day.revenue / maxWeekday) * 100 : 0}%` }} />
                </div>
                <span className="text-xs font-bold w-20 text-right">R$ {day.revenue.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top 5 Dias */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Melhores Dias</CardTitle>
        </CardHeader>
        <CardContent>
          {topDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum agendamento no período</p>
          ) : (
            <div className="space-y-2">
              {topDays.map((day, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30">
                  <span className="text-sm font-medium">{format(parseISO(day.day), "dd/MM/yyyy", { locale: ptBR })}</span>
                  <span className="text-sm font-bold text-primary">R$ {day.revenue.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

