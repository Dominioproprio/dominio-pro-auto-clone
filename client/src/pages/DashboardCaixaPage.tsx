/**
 * DashboardCaixaPage v2 — Visão geral financeira por período.
 * Três camadas de dados:
 *  • Realizado  — lançamentos confirmados no caixa
 *  • Agendado   — agendamentos ainda não lançados (visão futura)
 *  • Projeção   — soma das duas camadas
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
  cashSessionsStore, cashEntriesStore, employeesStore, appointmentsStore,
} from "@/lib/store";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

const PAYMENT_COLORS: Record<string, string> = {
  dinheiro: "#10b981", cartao_credito: "#3b82f6",
  cartao_debito: "#8b5cf6", pix: "#06b6d4", outro: "#6b7280",
};
const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro", cartao_credito: "Crédito",
  cartao_debito: "Débito", pix: "PIX", outro: "Outro",
};

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

function DualBar({ realized, scheduled, max }: { realized: number; scheduled: number; max: number }) {
  const rPct = max > 0 ? (realized / max) * 100 : 0;
  const sPct = max > 0 ? (scheduled / max) * 100 : 0;
  return (
    <div className="flex-1 h-5 bg-secondary/30 rounded-md overflow-hidden flex">
      <div className="h-full bg-primary/70 rounded-l-md transition-all duration-500 flex items-center justify-end pr-1"
        style={{ width: `${rPct}%`, minWidth: realized > 0 ? "2rem" : 0 }}>
        {realized > 0 && rPct > 15 && <span className="text-[9px] text-primary-foreground font-medium">R${realized.toFixed(0)}</span>}
      </div>
      <div className="h-full bg-amber-400/50 transition-all duration-500 flex items-center justify-end pr-1"
        style={{ width: `${sPct}%`, minWidth: scheduled > 0 ? "1rem" : 0 }}>
        {scheduled > 0 && sPct > 10 && <span className="text-[9px] text-amber-900 font-medium">R${scheduled.toFixed(0)}</span>}
      </div>
    </div>
  );
}

export default function DashboardCaixaPage() {
  const [period, setPeriod]           = useState<Period>("mes");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]     = useState("");

  const employees  = useMemo(() => employeesStore.list(false), []);
  const sessions   = useMemo(() => cashSessionsStore.list(), []);
  const allEntries = useMemo(() => cashEntriesStore.list(), []);
  const allAppts   = useMemo(() => appointmentsStore.list({}), []);

  const { start, end, label } = getPeriodRange(period, customStart, customEnd);
  const now = new Date();

  const periodSessions = useMemo(() =>
    sessions.filter(s => isWithinInterval(parseISO(s.openedAt), { start, end })),
    [sessions, start, end]
  );

  const realizedEntries = useMemo(() => {
    const sessionIds = new Set(periodSessions.map(s => s.id));
    const cur = sessions.find(s => s.status === "open");
    if (cur && isWithinInterval(parseISO(cur.openedAt), { start, end })) sessionIds.add(cur.id);
    return allEntries.filter(e => sessionIds.has(e.sessionId));
  }, [allEntries, periodSessions, sessions, start, end]);

  const launchedApptIds = useMemo(() =>
    new Set(allEntries.filter(e => e.appointmentId).map(e => e.appointmentId!)),
    [allEntries]
  );

  const scheduledAppts = useMemo(() =>
    allAppts.filter(a => {
      if (["cancelled", "no_show"].includes(a.status)) return false;
      if (launchedApptIds.has(a.id)) return false;
      if (toNum(a.totalPrice) <= 0.01) return false;
      return isWithinInterval(parseISO(a.startTime), { start, end });
    }),
    [allAppts, launchedApptIds, start, end]
  );

  const pastUnlaunched      = scheduledAppts.filter(a => parseISO(a.startTime) < now && a.status !== "completed");
  const futureAppts         = scheduledAppts.filter(a => parseISO(a.startTime) >= now);
  const completedUnlaunched = scheduledAppts.filter(a => a.status === "completed");

  const realizedRevenue     = realizedEntries.reduce((s, e) => s + e.amount, 0);
  const realizedCommissions = realizedEntries.reduce((s, e) => s + e.commissionValue, 0);
  const realizedNet         = realizedRevenue - realizedCommissions;

  const scheduledRevenue = scheduledAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
  const scheduledCommissions = scheduledAppts.reduce((s, a) => {
    const emp = employees.find(e => e.id === a.employeeId);
    return s + (emp ? toNum(a.totalPrice) * (emp.commissionPercent / 100) : 0);
  }, 0);

  const projectedRevenue     = realizedRevenue + scheduledRevenue;
  const projectedCommissions = realizedCommissions + scheduledCommissions;
  const projectedNet         = projectedRevenue - projectedCommissions;
  const avgTicket            = realizedEntries.length > 0 ? realizedRevenue / realizedEntries.length : 0;

  const prevDiff  = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - prevDiff);
  const prevEnd   = new Date(start.getTime() - 1);
  const prevEntries = allEntries.filter(e =>
    sessions.filter(s => isWithinInterval(parseISO(s.openedAt), { start: prevStart, end: prevEnd })).some(s => s.id === e.sessionId)
  );
  const prevRevenue  = prevEntries.reduce((s, e) => s + e.amount, 0);
  const revenueDelta = prevRevenue > 0 ? ((realizedRevenue - prevRevenue) / prevRevenue) * 100 : null;

  const dailyData = useMemo(() => {
    const realized: Record<string, number> = {};
    const scheduled: Record<string, number> = {};
    realizedEntries.forEach(e => {
      const s = sessions.find(s => s.id === e.sessionId);
      if (!s) return;
      const d = format(parseISO(s.openedAt), "yyyy-MM-dd");
      realized[d] = (realized[d] ?? 0) + e.amount;
    });
    scheduledAppts.forEach(a => {
      const d = format(parseISO(a.startTime), "yyyy-MM-dd");
      scheduled[d] = (scheduled[d] ?? 0) + toNum(a.totalPrice);
    });
    const diff = Math.min(Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1, 60);
    return Array.from({ length: diff }, (_, i) => {
      const d = format(new Date(start.getTime() + i * 86400000), "yyyy-MM-dd");
      return { date: d, realized: realized[d] ?? 0, scheduled: scheduled[d] ?? 0 };
    });
  }, [realizedEntries, scheduledAppts, sessions, start, end]);

  const byEmployee = useMemo(() => {
    return employees.map(emp => {
      const eEntries = realizedEntries.filter(e => e.employeeId === emp.id);
      const eAppts   = scheduledAppts.filter(a => a.employeeId === emp.id);
      const realized   = eEntries.reduce((s, e) => s + e.amount, 0);
      const commission = eEntries.reduce((s, e) => s + e.commissionValue, 0);
      const scheduled  = eAppts.reduce((s, a) => s + toNum(a.totalPrice), 0);
      return { employee: emp, realized, commission, scheduled, count: eEntries.length, apptCount: eAppts.length };
    })
    .filter(e => e.realized > 0 || e.scheduled > 0)
    .sort((a, b) => (b.realized + b.scheduled) - (a.realized + a.scheduled));
  }, [employees, realizedEntries, scheduledAppts]);

  const byWeekday = useMemo(() => {
    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const realized: Record<number, number>  = {};
    const scheduled: Record<number, number> = {};
    realizedEntries.forEach(e => {
      const s = sessions.find(s => s.id === e.sessionId);
      if (!s) return;
      const wd = parseISO(s.openedAt).getDay();
      realized[wd] = (realized[wd] ?? 0) + e.amount;
    });
    scheduledAppts.forEach(a => {
      const wd = parseISO(a.startTime).getDay();
      scheduled[wd] = (scheduled[wd] ?? 0) + toNum(a.totalPrice);
    });
    return days.map((name, i) => ({
      name,
      realized:  realized[i]  ?? 0,
      scheduled: scheduled[i] ?? 0,
      total: (realized[i] ?? 0) + (scheduled[i] ?? 0),
    }));
  }, [realizedEntries, scheduledAppts, sessions]);

  const maxWeekday = Math.max(...byWeekday.map(d => d.total), 1);

  const byPayment = useMemo(() => {
    const map: Record<string, number> = {};
    realizedEntries.forEach(e => { map[e.paymentMethod] = (map[e.paymentMethod] ?? 0) + e.amount; });
    return Object.entries(map)
      .map(([method, value]) => ({ method, value, pct: realizedRevenue > 0 ? (value / realizedRevenue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [realizedEntries, realizedRevenue]);

  const topDays = useMemo(() => {
    const map: Record<string, { realized: number; scheduled: number }> = {};
    realizedEntries.forEach(e => {
      const s = sessions.find(s => s.id === e.sessionId);
      if (!s) return;
      const d = format(parseISO(s.openedAt), "yyyy-MM-dd");
      if (!map[d]) map[d] = { realized: 0, scheduled: 0 };
      map[d].realized += e.amount;
    });
    scheduledAppts.forEach(a => {
      const d = format(parseISO(a.startTime), "yyyy-MM-dd");
      if (!map[d]) map[d] = { realized: 0, scheduled: 0 };
      map[d].scheduled += toNum(a.totalPrice);
    });
    return Object.entries(map)
      .map(([day, v]) => ({ day, ...v, total: v.realized + v.scheduled }))
      .sort((a, b) => b.total - a.total).slice(0, 5);
  }, [realizedEntries, scheduledAppts, sessions]);

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
        <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-primary" /><span className="font-medium text-foreground">Realizado</span> — lançado no caixa</span>
        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-400" /><span className="font-medium text-foreground">Agendado</span> — previsto, não lançado</span>
        <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-blue-400" /><span className="font-medium text-foreground">Projeção</span> — visão financeira completa</span>
      </div>

      {/* KPIs — Realizado */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">Realizado (caixa)</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Faturamento</p>
              <p className="text-xl font-bold text-primary">R$ {realizedRevenue.toFixed(2)}</p>
              <div className="flex items-center justify-between mt-1">
                {revenueDelta !== null ? (
                  <span className={`text-[10px] flex items-center gap-0.5 ${revenueDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {revenueDelta >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                    {Math.abs(revenueDelta).toFixed(1)}% vs ant.
                  </span>
                ) : <span />}
                <Sparkline data={dailyData.map(d => d.realized)} color="#ec4899" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Comissões</p>
              <p className="text-xl font-bold">R$ {realizedCommissions.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{realizedEntries.length} lançamento(s)</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Líquido realizado</p>
              <p className="text-xl font-bold text-emerald-400">R$ {realizedNet.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {realizedRevenue > 0 ? `${((realizedNet / realizedRevenue) * 100).toFixed(1)}% do bruto` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Ticket médio</p>
              <p className="text-xl font-bold">R$ {avgTicket.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{periodSessions.length} caixa(s)</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* KPIs — Agendado */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Agendado (não lançado)</span>
          {completedUnlaunched.length > 0 && (
            <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">
              {completedUnlaunched.length} concluído(s) pendente(s) de lançamento
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Previsto</p>
              <p className="text-xl font-bold text-amber-400">R$ {scheduledRevenue.toFixed(2)}</p>
              <Sparkline data={dailyData.map(d => d.scheduled)} color="#f59e0b" />
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Com. previstas</p>
              <p className="text-xl font-bold">R$ {scheduledCommissions.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{scheduledAppts.length} agendamento(s)</p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Líquido previsto</p>
              <p className="text-xl font-bold text-amber-400">R$ {(scheduledRevenue - scheduledCommissions).toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{futureAppts.length} futuros</p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Pendentes de lançar</p>
              <p className="text-xl font-bold text-red-400">{pastUnlaunched.length + completedUnlaunched.length}</p>
              <p className="text-[10px] text-muted-foreground mt-1">já passados</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* KPIs — Projeção */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Projeção do período</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Faturamento projetado</p>
              <p className="text-2xl font-bold text-blue-400">R$ {projectedRevenue.toFixed(2)}</p>
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-muted-foreground">Realizado: R$ {realizedRevenue.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-muted-foreground">Agendado: R$ {scheduledRevenue.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/50">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Comissões projetadas</p>
              <p className="text-2xl font-bold">R$ {projectedCommissions.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {projectedRevenue > 0 ? `${((projectedCommissions / projectedRevenue) * 100).toFixed(1)}% do bruto` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Líquido projetado</p>
              <p className="text-2xl font-bold text-blue-400">R$ {projectedNet.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {projectedRevenue > 0 ? `${((projectedNet / projectedRevenue) * 100).toFixed(1)}% do bruto` : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Faturamento por dia da semana */}
          <Card className="border-border bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />Faturamento por Dia da Semana
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byWeekday.every(d => d.total === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados no período</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-3">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-primary/70" />Realizado</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-amber-400/50" />Agendado</span>
                  </div>
                  {byWeekday.map(({ name, realized, scheduled, total }) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-7 flex-shrink-0">{name}</span>
                      <DualBar realized={realized} scheduled={scheduled} max={maxWeekday} />
                      <span className="text-xs font-semibold w-20 text-right flex-shrink-0">
                        {total > 0 ? `R$ ${total.toFixed(0)}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Formas de pagamento */}
          {byPayment.length > 0 && (
            <Card className="border-border bg-card/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />Formas de Pagamento
                  <Badge variant="secondary" className="text-[10px] ml-1">Realizados</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                  {byPayment.map(({ method, pct }) => (
                    <div key={method} style={{ width: `${pct}%`, backgroundColor: PAYMENT_COLORS[method] ?? "#6b7280" }}
                      className="transition-all duration-500" />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {byPayment.map(({ method, value, pct }) => (
                    <div key={method} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PAYMENT_COLORS[method] ?? "#6b7280" }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{PAYMENT_LABELS[method]}</p>
                        <p className="text-[10px] text-muted-foreground">R$ {value.toFixed(2)} · {pct.toFixed(1)}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Melhores dias */}
          {topDays.length > 0 && (
            <Card className="border-border bg-card/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" />Melhores Dias do Período
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topDays.map(({ day, realized, scheduled, total }, i) => (
                    <div key={day} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                      <span className={`text-xs font-bold w-5 flex-shrink-0 ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-400" : i === 2 ? "text-orange-600" : "text-muted-foreground"}`}>
                        #{i + 1}
                      </span>
                      <span className="text-sm flex-1">{format(parseISO(day), "EEEE, dd/MM", { locale: ptBR })}</span>
                      <div className="text-right text-xs space-y-0.5">
                        {realized > 0 && <p className="text-primary font-medium">R$ {realized.toFixed(2)} <span className="text-muted-foreground font-normal">real.</span></p>}
                        {scheduled > 0 && <p className="text-amber-400 font-medium">R$ {scheduled.toFixed(2)} <span className="text-muted-foreground font-normal">agend.</span></p>}
                      </div>
                      <span className="text-sm font-bold text-blue-400 flex-shrink-0 w-20 text-right">R$ {total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">

          {/* Ranking funcionários */}
          <Card className="border-border bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />Ranking de Funcionários
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byEmployee.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados no período</p>
              ) : (
                <div className="space-y-4">
                  {byEmployee.map(({ employee, realized, commission, scheduled, count, apptCount }, i) => {
                    const total    = realized + scheduled;
                    const maxTotal = byEmployee[0].realized + byEmployee[0].scheduled;
                    return (
                      <div key={employee.id} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: employee.color }} />
                          <span className="text-sm font-medium flex-1 truncate">{employee.name}</span>
                          <span className="text-sm font-bold text-blue-400">R$ {total.toFixed(2)}</span>
                        </div>
                        <div className="ml-6 flex items-center gap-2">
                          <DualBar realized={realized} scheduled={scheduled} max={maxTotal} />
                        </div>
                        <div className="ml-6 text-[10px] text-muted-foreground space-y-0.5">
                          {realized > 0 && <p className="text-primary">✓ R$ {realized.toFixed(2)} real. ({count}x)</p>}
                          {scheduled > 0 && <p className="text-amber-400">◷ R$ {scheduled.toFixed(2)} agend. ({apptCount}x)</p>}
                          <p>Com. R$ {commission.toFixed(2)} · Líq. R$ {(realized - commission).toFixed(2)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <Separator />
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground"><span>Realizado</span><span className="font-semibold text-primary">R$ {realizedRevenue.toFixed(2)}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>Agendado</span><span className="font-semibold text-amber-400">R$ {scheduledRevenue.toFixed(2)}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>Comissões</span><span className="font-semibold text-red-400">- R$ {realizedCommissions.toFixed(2)}</span></div>
                    <Separator />
                    <div className="flex justify-between font-bold text-sm"><span>Líquido projetado</span><span className="text-blue-400">R$ {projectedNet.toFixed(2)}</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Resumo */}
          <Card className="border-border bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />Resumo do Período
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 text-sm">
              {[
                { label: "Caixas abertos",         value: `${periodSessions.length}`,             color: "" },
                { label: "Lançamentos",             value: `${realizedEntries.length}`,             color: "text-primary" },
                { label: "Agendamentos previstos",  value: `${scheduledAppts.length}`,             color: "text-amber-400" },
                { label: "Faturamento realizado",   value: `R$ ${realizedRevenue.toFixed(2)}`,     color: "text-primary" },
                { label: "Faturamento agendado",    value: `R$ ${scheduledRevenue.toFixed(2)}`,    color: "text-amber-400" },
                { label: "Projeção total",           value: `R$ ${projectedRevenue.toFixed(2)}`,   color: "text-blue-400 font-bold" },
                { label: "Comissões projetadas",    value: `R$ ${projectedCommissions.toFixed(2)}`, color: "" },
                { label: "Líquido projetado",        value: `R$ ${projectedNet.toFixed(2)}`,       color: "text-blue-400 font-bold" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <span className={`text-xs ${color}`}>{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
