/**
 * RelatoriosPage — Relatórios completos.
 * Fonte de verdade: agendamentos.
 */
import { useState, useMemo } from "react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { TrendingUp, Users, DollarSign, Award, Calendar, Scissors, Percent } from "lucide-react";
import { appointmentsStore, employeesStore, servicesStore } from "@/lib/store";
import {
  calcPeriodStats, calcRevenueByDay, calcRevenueByEmployee,
  calcPopularServices, getAppointmentsInPeriod, getPeriodDates,
  toNum, type Period,
} from "@/lib/analytics";

const tooltipStyle = { backgroundColor: "hsl(240 6% 10%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#fff", fontSize: 12 };
const tickStyle = { fontSize: 11, fill: "hsl(0 0% 55%)" };

const PERIODS: { key: Period; label: string }[] = [
  { key: "hoje",      label: "Hoje"    },
  { key: "semana",    label: "Semana"  },
  { key: "mes",       label: "Mês"     },
  { key: "trimestre", label: "90 dias" },
  { key: "ano",       label: "Ano"     },
  { key: "custom",    label: "Custom"  },
];

export default function RelatoriosPage() {
  const [period, setPeriod]           = useState<Period>("mes");
  const [customStart, setCustomStart] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd]     = useState(() => format(new Date(), "yyyy-MM-dd"));

  const employees = useMemo(() => employeesStore.list(false), []);

  const { start, end, label } = getPeriodDates(period, customStart, customEnd);

  const appts    = useMemo(() => getAppointmentsInPeriod(start, end), [start, end]);
  const stats    = useMemo(() => calcPeriodStats(appts, employees), [appts, employees]);
  const byDay    = useMemo(() => calcRevenueByDay(appts, Math.min(30, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1)), [appts, start, end]);
  const byEmp    = useMemo(() => calcRevenueByEmployee(appts, employees), [appts, employees]);
  const services = useMemo(() => calcPopularServices(appts), [appts]);

  // Status breakdown
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    appts.forEach(a => { map[a.status] = (map[a.status] ?? 0) + 1; });
    const labels: Record<string, string> = {
      scheduled: "Agendado", confirmed: "Confirmado", in_progress: "Em andamento",
      completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou",
    };
    const colors: Record<string, string> = {
      scheduled: "#3b82f6", confirmed: "#10b981", in_progress: "#f59e0b",
      completed: "#22c55e", cancelled: "#ef4444", no_show: "#6b7280",
    };
    return Object.entries(map).map(([st, count]) => ({
      name: labels[st] ?? st, value: count, color: colors[st] ?? "#ec4899",
    }));
  }, [appts]);

  const kpis = [
    { label: "Faturamento",        value: `R$ ${stats.totalRevenue.toFixed(2)}`,   icon: DollarSign, color: "#ec4899" },
    { label: "Líquido",            value: `R$ ${stats.netRevenue.toFixed(2)}`,      icon: TrendingUp, color: "#22c55e" },
    { label: "Atendimentos",       value: String(stats.count),                      icon: Calendar,   color: "#3b82f6" },
    { label: "Ticket Médio",       value: `R$ ${stats.avgTicket.toFixed(2)}`,       icon: DollarSign, color: "#f59e0b" },
    { label: "Comissões",          value: `R$ ${stats.totalCommissions.toFixed(2)}`,icon: Percent,    color: "#8b5cf6" },
    { label: "Custo Material",     value: `R$ ${stats.totalMaterial.toFixed(2)}`,   icon: Scissors,   color: "#06b6d4" },
    { label: "Cancelamentos",      value: `${stats.cancelRate.toFixed(1)}%`,        icon: Users,      color: "#ef4444" },
    { label: "Agend. Futuros",     value: `R$ ${stats.scheduledRevenue.toFixed(2)}`,icon: Calendar,   color: "#f97316" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header + período */}
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-bold">Relatórios</h2>
          <p className="text-sm text-muted-foreground">Fonte: agendamentos · {label}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(p => (
            <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"}
              onClick={() => setPeriod(p.key)} className="h-7 text-xs">
              {p.label}
            </Button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs">De:</Label>
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Até:</Label>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-border bg-card/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${color}20` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
              </div>
              <p className="text-lg font-bold" style={{ color }}>{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Faturamento por dia */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Faturamento por Dia</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byDay.filter(d => d !== undefined && d !== null)} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={tickStyle} interval="preserveStartEnd" />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
              <Bar dataKey="revenue" fill="#ec4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Ranking funcionários */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />Ranking de Funcionários
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byEmp.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado no período</p>
            ) : (
              <div className="space-y-4">
                {byEmp.map((emp, i) => (
                  <div key={emp.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}°</span>
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                      <span className="text-sm font-semibold flex-1">{emp.name.split(" ")[0]}</span>
                      <span className="text-sm font-bold text-primary">R$ {emp.revenue.toFixed(2)}</span>
                    </div>
                    <div className="pl-7 space-y-1">
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${byEmp[0] ? (emp.revenue / byEmp[0].revenue) * 100 : 0}%`,
                          backgroundColor: emp.color,
                        }} />
                      </div>
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        <span>{emp.count} atend.</span>
                        <span>Comissão: R$ {emp.commission.toFixed(2)}</span>
                        {emp.material > 0 && <span>Material: R$ {emp.material.toFixed(2)}</span>}
                        <span className="text-emerald-400">Líq: R$ {emp.net.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent>
            {byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {byStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend formatter={v => <span style={{ fontSize: 11, color: "hsl(0 0% 60%)" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Serviços populares */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scissors className="w-4 h-4 text-primary" />Serviços Mais Populares
            </CardTitle>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado</p>
            ) : (
              <div className="space-y-3">
                {services.slice(0, 8).map((svc, i) => (
                  <div key={svc.serviceId} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}°</span>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{svc.name}</span>
                        <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{svc.count}x</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${services[0] ? (svc.count / services[0].count) * 100 : 0}%`,
                          backgroundColor: svc.color,
                        }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">R$ {svc.revenue.toFixed(2)} gerado</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Breakdown financeiro */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Breakdown Financeiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Faturamento bruto",  value: stats.totalRevenue,     color: "#ec4899" },
              { label: "- Custo material",   value: -stats.totalMaterial,   color: "#06b6d4" },
              { label: "- Comissões",        value: -stats.totalCommissions, color: "#8b5cf6" },
              { label: "= Líquido salão",    value: stats.netRevenue,       color: "#22c55e", bold: true },
            ].map(({ label, value, color, bold }) => (
              <div key={label} className={`flex justify-between items-center ${bold ? "pt-2 border-t border-border" : ""}`}>
                <span className={`text-sm ${bold ? "font-bold text-white" : "text-muted-foreground"}`}>{label}</span>
                <span className={`text-sm font-bold`} style={{ color }}>{value >= 0 ? "" : ""}R$ {Math.abs(value).toFixed(2)}</span>
              </div>
            ))}
            {stats.scheduledRevenue > 0 && (
              <>
                <div className="pt-2 border-t border-border flex justify-between">
                  <span className="text-sm text-muted-foreground">+ Agendados (projeção)</span>
                  <span className="text-sm font-bold text-amber-400">R$ {stats.scheduledRevenue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-white">= Projeção total</span>
                  <span className="text-sm font-bold text-amber-400">R$ {(stats.netRevenue + stats.scheduledRevenue).toFixed(2)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
