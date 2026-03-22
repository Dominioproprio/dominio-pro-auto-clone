/**
 * RelatoriosPage — Relatórios com gráficos de faturamento, ranking e status.
 */
import { useState, useMemo } from "react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { TrendingUp, Users, DollarSign, Award, Calendar, Scissors } from "lucide-react";
import { appointmentsStore, employeesStore, servicesStore } from "@/lib/store";

const CHART_COLORS = ["#ec4899", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const toNumber = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export default function RelatoriosPage() {
  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const allAppointments = useMemo(() => appointmentsStore.list({ startDate, endDate }), [startDate, endDate]);
  const employees = useMemo(() => employeesStore.list(false), []);
  const services = useMemo(() => servicesStore.list(false), []);

  const completed = useMemo(() => allAppointments.filter(a => a.status === "completed" && toNumber(a.totalPrice) > 0.01), [allAppointments]);
  const totalRevenue = useMemo(() => completed.reduce((sum, a) => sum + toNumber(a.totalPrice), 0), [completed]);
  const avgTicket = completed.length > 0 ? totalRevenue / completed.length : 0;
  const cancelRate = allAppointments.length > 0
    ? (allAppointments.filter(a => a.status === "cancelled").length / allAppointments.length) * 100 : 0;

  // Revenue by day (last 7 days)
  const revenueByDay = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      days[d] = 0;
    }
    completed.forEach(a => {
      const d = format(new Date(a.startTime), "yyyy-MM-dd");
      if (d in days) days[d] = (days[d] ?? 0) + toNumber(a.totalPrice);
    });
    return Object.entries(days).map(([date, revenue]) => ({
      date: format(parseISO(date), "dd/MM", { locale: ptBR }),
      revenue: parseFloat(revenue.toFixed(2)),
    }));
  }, [completed]);

  // Revenue by employee
  const revenueByEmployee = useMemo(() => {
    return employees.map(emp => {
      const empAppts = completed.filter(a => a.employeeId === emp.id);
      const revenue = empAppts.reduce((sum, a) => sum + toNumber(a.totalPrice), 0);
      const commission = revenue * (emp.commissionPercent / 100);
      return { name: emp.name.split(" ")[0], revenue: parseFloat(revenue.toFixed(2)), commission: parseFloat(commission.toFixed(2)), count: empAppts.length, color: emp.color };
    }).filter(e => e.count > 0).sort((a, b) => b.revenue - a.revenue);
  }, [employees, completed]);

  // By status
  const byStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    allAppointments.forEach(a => { counts[a.status] = (counts[a.status] ?? 0) + 1; });
    const labels: Record<string, string> = {
      scheduled: "Agendado", confirmed: "Confirmado", in_progress: "Em andamento",
      completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou",
    };
    return Object.entries(counts).map(([status, count], i) => ({
      name: labels[status] ?? status, value: count,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [allAppointments]);

  // Popular services
  const popularServices = useMemo(() => {
    const counts: Record<number, { name: string; count: number; revenue: number; color: string }> = {};
    completed.forEach(a => {
      a.services?.forEach(s => {
        const svc = services.find(sv => sv.id === s.serviceId);
        if (!svc) return;
        if (!counts[s.serviceId]) counts[s.serviceId] = { name: svc.name, count: 0, revenue: 0, color: svc.color };
        counts[s.serviceId].count++;
        counts[s.serviceId].revenue += toNumber(s.price);
      });
    });
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [completed, services]);

  const tooltipStyle = { backgroundColor: "hsl(240 6% 12%)", border: "1px solid hsl(0 0% 100% / 8%)", borderRadius: "8px", color: "#fff" };
  const tickColor = "hsl(0 0% 60%)";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold">Relatórios</h2>
          <p className="text-sm text-muted-foreground">Análise de desempenho do salão</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">De:</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Até:</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Faturamento", value: `R$ ${totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-primary", bg: "bg-primary/20" },
          { label: "Atendimentos", value: String(completed.length), icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/20" },
          { label: "Ticket Médio", value: `R$ ${avgTicket.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/20" },
          { label: "Taxa Cancelamento", value: `${cancelRate.toFixed(1)}%`, icon: Users, color: "text-amber-400", bg: "bg-amber-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="border-border bg-card/50">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by day */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Faturamento — Últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 6%)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} />
                <YAxis tick={{ fontSize: 11, fill: tickColor }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
                <Bar dataKey="revenue" fill="#ec4899" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Employee ranking */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />Ranking de Funcionários
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByEmployee.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado no período</p>
            ) : (
              <div className="space-y-3">
                {revenueByEmployee.map((emp, i) => (
                  <div key={emp.name} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}°</span>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{emp.name}</span>
                        <span className="text-sm font-bold text-primary">R$ {emp.revenue.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${revenueByEmployee[0] ? (emp.revenue / revenueByEmployee[0].revenue) * 100 : 0}%`,
                          backgroundColor: emp.color,
                        }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{emp.count} atend. — Comissão: R$ {emp.commission.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status distribution */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent>
            {byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado no período</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {byStatus.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend formatter={v => <span style={{ fontSize: 11, color: tickColor }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Popular services */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scissors className="w-4 h-4 text-primary" />Serviços Mais Populares
            </CardTitle>
          </CardHeader>
          <CardContent>
            {popularServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado no período</p>
            ) : (
              <div className="space-y-3">
                {popularServices.map((svc, i) => (
                  <div key={svc.name} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}°</span>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{svc.name}</span>
                        <span className="text-xs text-muted-foreground">{svc.count}x</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${popularServices[0] ? (svc.count / popularServices[0].count) * 100 : 0}%`,
                          backgroundColor: svc.color,
                        }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">R$ {svc.revenue.toFixed(2)} gerado</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
