/**
 * DashboardCaixaPage v3 — Dashboard financeiro completo.
 * Fonte de verdade: agendamentos.
 * Permite editar lançamentos de períodos passados com nota de auditoria.
 */
import { useState, useMemo, useEffect } from "react";
import { format, parseISO, subDays, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  TrendingUp, DollarSign, Percent, Calendar, Award,
  ChevronDown, ChevronUp, Edit3, AlertTriangle, BarChart2,
  RefreshCw, Banknote, CreditCard, Smartphone,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  cashSessionsStore, cashEntriesStore, employeesStore,
  appointmentsStore, type CashEntry, type CashSession,
} from "@/lib/store";
import {
  calcPeriodStats, calcRevenueByDay, calcRevenueByEmployee,
  getAppointmentsInPeriod, getPeriodDates, toNum, type Period,
} from "@/lib/analytics";

const tooltipStyle = { backgroundColor: "hsl(240 6% 10%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#fff", fontSize: 12 };
const tickStyle = { fontSize: 11, fill: "hsl(0 0% 55%)" };

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro", cartao_credito: "Crédito",
  cartao_debito: "Débito", pix: "PIX", outro: "Outro",
};
const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  dinheiro: Banknote, cartao_credito: CreditCard,
  cartao_debito: CreditCard, pix: Smartphone, outro: DollarSign,
};

const PERIODS: { key: Period; label: string }[] = [
  { key: "hoje",      label: "Hoje"    },
  { key: "semana",    label: "Semana"  },
  { key: "mes",       label: "Mês"     },
  { key: "trimestre", label: "90 dias" },
  { key: "ano",       label: "Ano"     },
  { key: "custom",    label: "Custom"  },
];

function Sparkline({ data, color = "#ec4899" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 80; const h = 28;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardCaixaPage() {
  const [period, setPeriod]           = useState<Period>("semana");
  const [customStart, setCustomStart] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd]     = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [refreshKey, setRefreshKey]   = useState(0);
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);

  // Modal de edição de lançamento
  const [editEntry, setEditEntry]     = useState<CashEntry | null>(null);
  const [editAmount, setEditAmount]   = useState("");
  const [editMethod, setEditMethod]   = useState("dinheiro");
  const [editNote, setEditNote]       = useState("");
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    const upd = () => setRefreshKey(k => k + 1);
    ["store_updated", "cash_entry_auto_launched"].forEach(e => window.addEventListener(e, upd));
    return () => ["store_updated", "cash_entry_auto_launched"].forEach(e => window.removeEventListener(e, upd));
  }, []);

  const employees  = useMemo(() => employeesStore.list(false),   [refreshKey]);
  const sessions   = useMemo(() => cashSessionsStore.list(),     [refreshKey]);
  const allEntries = useMemo(() => cashEntriesStore.list(),      [refreshKey]);

  const { start, end, label } = getPeriodDates(period, customStart, customEnd);

  // FONTE DE VERDADE: agendamentos do período
  const appts  = useMemo(() => getAppointmentsInPeriod(start, end), [start, end, refreshKey]);
  const stats  = useMemo(() => calcPeriodStats(appts, employees),   [appts, employees]);
  const byEmp  = useMemo(() => calcRevenueByEmployee(appts, employees), [appts, employees]);
  const byDay  = useMemo(() => calcRevenueByDay(appts, Math.min(14, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1)), [appts, start, end]);

  // Entradas do caixa no período (para formas de pagamento reais)
  const periodEntries = useMemo(() => {
    const sessionIds = new Set(
      sessions
        .filter(s => {
          try { const d = parseISO(s.openedAt); return d >= start && d <= end; } catch { return false; }
        })
        .map(s => s.id)
    );
    // Inclui caixa aberto se estiver no período
    const open = sessions.find(s => s.status === "open");
    if (open) {
      try { if (parseISO(open.openedAt) >= start && parseISO(open.openedAt) <= end) sessionIds.add(open.id); } catch {}
    }
    return allEntries.filter(e => sessionIds.has(e.sessionId));
  }, [sessions, allEntries, start, end, refreshKey]);

  // Formas de pagamento (dos lançamentos reais)
  const byPayment = useMemo(() => {
    const map: Record<string, number> = {};
    periodEntries.forEach(e => { map[e.paymentMethod] = (map[e.paymentMethod] ?? 0) + e.amount; });
    return Object.entries(map).map(([method, amount]) => ({
      method, amount, label: PAYMENT_LABELS[method] ?? method,
    })).sort((a, b) => b.amount - a.amount);
  }, [periodEntries]);

  // Sparklines (últimos 7 dias)
  const sparkData = useMemo(() => byDay.map(d => d.revenue), [byDay]);

  // Caixas no período
  const periodSessions = useMemo(() =>
    sessions.filter(s => {
      try { const d = parseISO(s.openedAt); return d >= start && d <= end; } catch { return false; }
    }),
  [sessions, start, end]);

  // Agendamentos não lançados ainda
  const notLaunched = useMemo(() => {
    const launchedIds = new Set(allEntries.filter(e => e.appointmentId).map(e => e.appointmentId!));
    return appts.filter(a =>
      !["cancelled", "no_show"].includes(a.status) &&
      !launchedIds.has(a.id) &&
      toNum(a.totalPrice) > 0 &&
      new Date(a.startTime) <= new Date()
    );
  }, [appts, allEntries, refreshKey]);

  // Editar lançamento
  const openEdit = (entry: CashEntry) => {
    setEditEntry(entry);
    setEditAmount(String(entry.amount));
    setEditMethod(entry.paymentMethod);
    setEditNote("");
  };

  const handleSaveEdit = async () => {
    if (!editEntry) return;
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Valor inválido"); return; }
    setEditLoading(true);
    try {
      const note = editNote.trim() || "Valor alterado";
      await cashEntriesStore.update(editEntry.id, {
        amount,
        paymentMethod: editMethod as any,
        description: editEntry.description + ` [Editado pelo dono: ${note}]`,
      });
      toast.success("Lançamento atualizado!");
      setEditEntry(null);
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao atualizar lançamento");
    } finally {
      setEditLoading(false);
    }
  };

  const accent = (() => {
    try { const s = localStorage.getItem("salon_config"); if (s) return JSON.parse(s).accentColor || "#ec4899"; } catch {}
    return "#ec4899";
  })();

  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Dashboard Financeiro</h2>
            <p className="text-sm text-muted-foreground">{label} · fonte: agendamentos</p>
          </div>
          <button onClick={() => setRefreshKey(k => k + 1)} className="p-2 rounded-xl text-muted-foreground hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
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

      {/* KPIs principais */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Faturamento",   value: `R$ ${stats.totalRevenue.toFixed(2)}`,    sub: `${stats.count} atend.`,  color: accent,     spark: true },
          { label: "Líquido",       value: `R$ ${stats.netRevenue.toFixed(2)}`,       sub: "após comissões",         color: "#22c55e",  spark: false },
          { label: "Comissões",     value: `R$ ${stats.totalCommissions.toFixed(2)}`, sub: "total equipe",           color: "#8b5cf6",  spark: false },
          { label: "Ticket Médio",  value: `R$ ${stats.avgTicket.toFixed(2)}`,        sub: "por atendimento",        color: "#f59e0b",  spark: false },
        ].map(({ label, value, sub, color, spark }) => (
          <Card key={label} className="border-border bg-card/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  <p className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{sub}</p>
                </div>
                {spark && <Sparkline data={sparkData} color={color} />}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alertas */}
      {notLaunched.length > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-xl"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">{notLaunched.length} atendimento(s) não lançado(s)</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              R$ {notLaunched.reduce((s, a) => s + toNum(a.totalPrice), 0).toFixed(2)} pendente · acesse Caixa para lançar
            </p>
          </div>
        </div>
      )}

      {/* Breakdown */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Breakdown do Período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {[
            { label: "Faturamento bruto",  value: stats.totalRevenue,     color: accent,     prefix: "" },
            { label: "Custo de material",  value: stats.totalMaterial,    color: "#06b6d4",  prefix: "- " },
            { label: "Comissões",          value: stats.totalCommissions,  color: "#8b5cf6",  prefix: "- " },
          ].map(({ label, value, color, prefix }) => (
            <div key={label} className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold" style={{ color }}>{prefix}R$ {value.toFixed(2)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between items-center">
            <span className="font-bold text-white">Líquido salão</span>
            <span className="font-bold text-emerald-400">R$ {stats.netRevenue.toFixed(2)}</span>
          </div>
          {stats.scheduledRevenue > 0 && (
            <>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">+ Projeção agendados</span>
                <span className="font-semibold text-amber-400">R$ {stats.scheduledRevenue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-white">Projeção total</span>
                <span className="font-bold text-amber-400">R$ {(stats.netRevenue + stats.scheduledRevenue).toFixed(2)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Gráfico por dia */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Faturamento por Dia</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={(byDay || []).filter(d => d !== undefined)} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={tickStyle} interval="preserveStartEnd" />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
              <Bar dataKey="revenue" fill={accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Formas de pagamento */}
      {byPayment.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Formas de Pagamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byPayment.map(({ method, amount, label }) => {
              const Icon = PAYMENT_ICONS[method] ?? DollarSign;
              const total = byPayment.reduce((s, p) => s + p.amount, 0);
              return (
                <div key={method} className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span>{label}</span>
                      <span className="font-semibold text-primary">R$ {amount.toFixed(2)}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary/70 transition-all"
                        style={{ width: `${total > 0 ? (amount / total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    {total > 0 ? ((amount / total) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Ranking funcionários com edição */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="w-4 h-4 text-primary" />Ranking de Funcionários
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {byEmp.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum dado no período</p>
          ) : byEmp.map((emp, i) => {
            const empEntries = periodEntries.filter(e => e.employeeId === emp.id);
            const expanded   = expandedEmp === emp.id;
            return (
              <div key={emp.id} className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                {/* Header funcionário */}
                <button className="w-full flex items-center gap-3 p-3 text-left"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                  onClick={() => setExpandedEmp(expanded ? null : emp.id)}>
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}°</span>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white overflow-hidden flex-shrink-0"
                    style={{ backgroundColor: emp.color }}>
                    {emp.photoUrl ? <img src={emp.photoUrl} alt="" className="w-full h-full object-cover" /> : emp.firstName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{emp.firstName}</p>
                    <p className="text-[10px] text-muted-foreground">{emp.count} atend. · {emp.commissionPercent}% comissão</p>
                  </div>
                  <div className="text-right mr-2">
                    <p className="text-sm font-bold text-primary">R$ {emp.revenue.toFixed(2)}</p>
                    <p className="text-[10px] text-emerald-400">líq. R$ {emp.net.toFixed(2)}</p>
                  </div>
                  {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </button>

                {/* Lançamentos expandidos */}
                {expanded && (
                  <div className="divide-y divide-border/50">
                    {empEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3">Nenhum lançamento no período</p>
                    ) : empEntries.map(entry => {
                      const edited = entry.description?.includes("[Editado pelo dono:");
                      return (
                        <div key={entry.id} className="flex items-center gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">{entry.clientName}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {entry.description?.split("[Editado")[0]} · {PAYMENT_LABELS[entry.paymentMethod] ?? entry.paymentMethod}
                            </p>
                            {edited && (
                              <p className="text-[9px] text-amber-400 mt-0.5">
                                ✏️ {entry.description?.match(/\[Editado pelo dono: ([^\]]+)\]/)?.[1]}
                              </p>
                            )}
                          </div>
                          <span className="text-xs font-bold text-primary flex-shrink-0">R$ {entry.amount.toFixed(2)}</span>
                          <button onClick={() => openEdit(entry)}
                            className="p-1.5 rounded-lg transition-colors hover:bg-white/10 flex-shrink-0"
                            title="Editar lançamento">
                            <Edit3 className="w-3 h-3 text-muted-foreground" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex justify-between items-center px-3 py-2"
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      <span className="text-xs text-muted-foreground">Comissão total</span>
                      <span className="text-xs font-bold text-purple-400">R$ {emp.commission.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Histórico de caixas */}
      {periodSessions.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Caixas do Período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {periodSessions.map(session => {
              const entries = allEntries.filter(e => e.sessionId === session.id);
              const total   = entries.reduce((s, e) => s + e.amount, 0);
              return (
                <div key={session.id} className="flex items-center gap-3 p-2.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {format(parseISO(session.openedAt), "dd/MM", { locale: ptBR })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{entries.length} lançamentos</p>
                  </div>
                  <div className="flex-1" />
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">R$ {total.toFixed(2)}</p>
                    <Badge variant={session.status === "open" ? "default" : "secondary"} className="text-[9px] mt-0.5">
                      {session.status === "open" ? "Aberto" : "Fechado"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Modal edição de lançamento */}
      <Dialog open={!!editEntry} onOpenChange={v => !v && setEditEntry(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-primary" />Editar Lançamento
            </DialogTitle>
          </DialogHeader>
          {editEntry && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-xl bg-secondary/30">
                <p className="text-sm font-semibold">{editEntry.clientName}</p>
                <p className="text-xs text-muted-foreground">{editEntry.description?.split("[Editado")[0]}</p>
              </div>
              <div className="space-y-1">
                <Label>Valor (R$)</Label>
                <Input type="number" min="0" step="0.01" value={editAmount}
                  onChange={e => setEditAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Forma de pagamento</Label>
                <Select value={editMethod} onValueChange={setEditMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Motivo da alteração *</Label>
                <Input placeholder="Ex: valor estava incorreto" value={editNote}
                  onChange={e => setEditNote(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">
                  Será registrado como: "Editado pelo dono: {editNote || "..."}"
                </p>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-xl"
                style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400">A alteração ficará registrada no histórico do lançamento.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={editLoading || !editNote.trim()}>
              {editLoading ? "Salvando..." : "Salvar Alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
