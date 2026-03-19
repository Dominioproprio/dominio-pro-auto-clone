/**
 * CaixaPage v2 — Caixa completo com lançamentos manuais, lançamento automático
 * por agendamentos, comissões automáticas e histórico detalhado.
 */
import { useState, useMemo, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DollarSign, Clock, CheckCircle, Lock, Unlock, TrendingUp, Percent,
  Plus, Trash2, Zap, RefreshCw, CreditCard, Banknote, Smartphone,
  AlertTriangle, ChevronDown, ChevronUp, User, Scissors, History,
  ArrowUpRight, ArrowDownRight, Eye, EyeOff,
} from "lucide-react";
import {
  appointmentsStore, employeesStore, cashSessionsStore, cashEntriesStore,
  type Appointment, type Employee, type CashEntry,
} from "@/lib/store";

// ─── Helpers ─────────────────────────────────────────────

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

const PAYMENT_METHODS = [
  { value: "dinheiro",        label: "Dinheiro",        icon: Banknote   },
  { value: "cartao_credito",  label: "Cartão Crédito",  icon: CreditCard },
  { value: "cartao_debito",   label: "Cartão Débito",   icon: CreditCard },
  { value: "pix",             label: "PIX",             icon: Smartphone },
  { value: "outro",           label: "Outro",           icon: DollarSign },
] as const;

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro", cartao_credito: "Crédito",
  cartao_debito: "Débito", pix: "PIX", outro: "Outro",
};

const PAYMENT_COLORS: Record<string, string> = {
  dinheiro: "text-emerald-400", cartao_credito: "text-blue-400",
  cartao_debito: "text-violet-400", pix: "text-cyan-400", outro: "text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado", confirmed: "Confirmado", in_progress: "Em andamento",
  completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou",
};

// ─── Componente ───────────────────────────────────────────

export default function CaixaPage() {
  const today = format(new Date(), "yyyy-MM-dd");

  // ── UI state ──
  const [refreshKey, setRefreshKey]           = useState(0);
  const [openModalOpen, setOpenModalOpen]     = useState(false);
  const [closeModalOpen, setCloseModalOpen]   = useState(false);
  const [entryModalOpen, setEntryModalOpen]   = useState(false);
  const [autoModalOpen, setAutoModalOpen]     = useState(false);
  const [historyOpen, setHistoryOpen]         = useState(false);
  const [editingEntry, setEditingEntry]       = useState<CashEntry | null>(null);
  const [showAllEntries, setShowAllEntries]   = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["lancamentos", "comissoes"]));

  // ── Form state: abrir caixa ──
  const [openingBalance, setOpeningBalance]   = useState("0");
  const [openingDate, setOpeningDate]         = useState(format(new Date(), "yyyy-MM-dd"));
  const [closingNotes, setClosingNotes]       = useState("");

  // ── Form state: lançamento manual ──
  const [entryForm, setEntryForm] = useState({
    clientName: "",
    employeeId: "",
    description: "",
    amount: "",
    paymentMethod: "dinheiro" as CashEntry["paymentMethod"],
  });

  // ── Form state: lançamento automático ──
  const [autoSelected, setAutoSelected]       = useState<Set<number>>(new Set());
  const [autoPayMethod, setAutoPayMethod]     = useState<CashEntry["paymentMethod"]>("dinheiro");

  const [loading, setLoading]                 = useState(false);

  // ── Listener para reatividade em tempo real ──
  useEffect(() => {
    const onAutoLaunch = () => {
      setRefreshKey(k => k + 1);
      toast.success("Lançamento automático criado!");
    };
    const onAutoClosed = () => {
      setRefreshKey(k => k + 1);
      toast.info("Caixa fechado automaticamente à meia-noite.");
    };
    window.addEventListener("cash_entry_auto_launched", onAutoLaunch);
    window.addEventListener("cash_session_auto_closed", onAutoClosed);
    return () => {
      window.removeEventListener("cash_entry_auto_launched", onAutoLaunch);
      window.removeEventListener("cash_session_auto_closed", onAutoClosed);
    };
  }, []);

  // ── Dados ──
  const currentSession  = useMemo(() => cashSessionsStore.getCurrent(), [refreshKey]);
  const sessions        = useMemo(() => cashSessionsStore.list(), [refreshKey]);
  const employees       = useMemo(() => employeesStore.list(false), [refreshKey]);
  // Agendamentos do dia de hoje (para exibição na aba de hoje)
  const allAppointments = useMemo(() => appointmentsStore.list({ date: today }), [today, refreshKey]);

  const entries = useMemo(() =>
    currentSession ? cashEntriesStore.list(currentSession.id) : [],
    [currentSession, refreshKey]
  );

  // Agendamentos não lançados desde a abertura da sessão (não só hoje)
  // Necessário para sessões que cobrem múltiplos dias
  const launchableAppts = useMemo(() => {
    if (!currentSession) return [];
    const sessionStart = currentSession.openedAt.slice(0, 10); // "yyyy-MM-dd"
    const apptsSinceOpen = appointmentsStore.list({ startDate: sessionStart });
    const launchedIds = new Set(entries.filter(e => e.appointmentId).map(e => e.appointmentId!));
    return apptsSinceOpen.filter(a =>
      !["cancelled"].includes(a.status) &&
      !launchedIds.has(a.id) &&
      toNum(a.totalPrice) > 0
    );
  }, [entries, currentSession, refreshKey]);

  // KPIs do caixa atual
  const totalRevenue     = entries.reduce((s, e) => s + e.amount, 0);
  const totalCommissions = entries.reduce((s, e) => s + e.commissionValue, 0);
  const netRevenue       = totalRevenue - totalCommissions;
  const openingBal       = toNum(currentSession?.openingBalance);

  // Comissões agrupadas por funcionário
  const commissionsByEmployee = useMemo(() => {
    const map = new Map<number, { employee: Employee; revenue: number; commission: number; count: number }>();
    entries.forEach(entry => {
      const emp = employees.find(e => e.id === entry.employeeId);
      if (!emp) return;
      const cur = map.get(emp.id) ?? { employee: emp, revenue: 0, commission: 0, count: 0 };
      cur.revenue    += entry.amount;
      cur.commission += entry.commissionValue;
      cur.count      += 1;
      map.set(emp.id, cur);
    });
    return Array.from(map.values());
  }, [entries, employees]);

  // Receita por forma de pagamento
  const revenueByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    entries.forEach(e => {
      map[e.paymentMethod] = (map[e.paymentMethod] ?? 0) + e.amount;
    });
    return map;
  }, [entries]);

  // ── Abrir caixa ──
  const handleOpenCash = async () => {
    setLoading(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      await cashSessionsStore.open(parseFloat(openingBalance) || 0, openingDate !== today ? openingDate : undefined);
      const isBackdate = openingDate !== today;
      toast.success(isBackdate ? `Caixa aberto para ${format(parseISO(openingDate), "dd/MM/yyyy", { locale: ptBR })}!` : "Caixa aberto!");
      setOpenModalOpen(false);
      setOpeningBalance("0");
      setOpeningDate(format(new Date(), "yyyy-MM-dd"));
      setRefreshKey(k => k + 1);
    } catch { toast.error("Erro ao abrir caixa"); } finally { setLoading(false); }
  };

  // ── Fechar caixa ──
  const handleCloseCash = async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      await cashSessionsStore.close(currentSession.id, {
        totalRevenue, totalCommissions, closingNotes,
      });
      toast.success("Caixa fechado!");
      setCloseModalOpen(false);
      setClosingNotes("");
      setRefreshKey(k => k + 1);
    } catch { toast.error("Erro ao fechar caixa"); } finally { setLoading(false); }
  };

  // ── Lançamento manual ──
  const resetEntryForm = () =>
    setEntryForm({ clientName: "", employeeId: "", description: "", amount: "", paymentMethod: "dinheiro" });

  const openCreateEntry = () => {
    setEditingEntry(null);
    resetEntryForm();
    setEntryModalOpen(true);
  };

  const openEditEntry = (entry: CashEntry) => {
    setEditingEntry(entry);
    const emp = employees.find(e => e.id === entry.employeeId);
    setEntryForm({
      clientName:    entry.clientName,
      employeeId:    String(entry.employeeId),
      description:   entry.description,
      amount:        String(entry.amount),
      paymentMethod: entry.paymentMethod,
    });
    setEntryModalOpen(true);
  };

  const handleSaveEntry = async () => {
    if (!currentSession) return;
    if (!entryForm.clientName.trim()) { toast.error("Informe o nome do cliente"); return; }
    if (!entryForm.employeeId)        { toast.error("Selecione o funcionário");    return; }
    if (!entryForm.amount || toNum(entryForm.amount) <= 0) { toast.error("Informe o valor"); return; }

    const emp = employees.find(e => e.id === parseInt(entryForm.employeeId));
    if (!emp) { toast.error("Funcionário não encontrado"); return; }

    const amount          = toNum(entryForm.amount);
    const commissionValue = amount * (emp.commissionPercent / 100);

    setLoading(true);
    try {
      if (editingEntry) {
        await cashEntriesStore.update(editingEntry.id, {
          clientName:      entryForm.clientName.trim(),
          employeeId:      emp.id,
          description:     entryForm.description.trim() || `Serviço — ${entryForm.clientName.trim()}`,
          amount,
          paymentMethod:   entryForm.paymentMethod,
          commissionPercent: emp.commissionPercent,
          commissionValue,
        });
        toast.success("Lançamento atualizado!");
      } else {
        await cashEntriesStore.create({
          sessionId:         currentSession.id,
          appointmentId:     null,
          clientName:        entryForm.clientName.trim(),
          employeeId:        emp.id,
          description:       entryForm.description.trim() || `Serviço — ${entryForm.clientName.trim()}`,
          amount,
          paymentMethod:     entryForm.paymentMethod,
          commissionPercent: emp.commissionPercent,
          commissionValue,
          isAutoLaunch:      false,
        });
        toast.success("Lançamento registrado!");
      }
      setEntryModalOpen(false);
      resetEntryForm();
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao salvar lançamento");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (id: number) => {
    if (!confirm("Excluir este lançamento?")) return;
    try {
      await cashEntriesStore.delete(id);
      toast.success("Lançamento removido");
      setRefreshKey(k => k + 1);
    } catch { toast.error("Erro ao excluir lançamento"); }
  };

  // ── Lançamento automático ──
  const openAutoModal = () => {
    setAutoSelected(new Set(launchableAppts.map(a => a.id)));
    setAutoPayMethod("dinheiro");
    setAutoModalOpen(true);
  };

  const toggleAutoSelect = (id: number) => {
    setAutoSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAutoLaunch = async () => {
    if (!currentSession) return;
    if (autoSelected.size === 0) { toast.error("Selecione ao menos um agendamento"); return; }

    setLoading(true);
    try {
      let count = 0;
      const selectedAppts = launchableAppts.filter(a => autoSelected.has(a.id));
      for (const appt of selectedAppts) {
        const emp = employees.find(e => e.id === appt.employeeId);
        if (!emp) continue;
        const amount          = toNum(appt.totalPrice);
        const commissionValue = amount * (emp.commissionPercent / 100);
        const services        = (appt.services ?? []).map(s => s.name).join(", ") || "Serviço";

        await cashEntriesStore.create({
          sessionId:         currentSession.id,
          appointmentId:     appt.id,
          clientName:        appt.clientName ?? "Cliente",
          employeeId:        emp.id,
          description:       services,
          amount,
          paymentMethod:     autoPayMethod,
          commissionPercent: emp.commissionPercent,
          commissionValue,
          isAutoLaunch:      true,
        });

        // Marca o agendamento como concluído se ainda não estava
        if (appt.status !== "completed") {
          await appointmentsStore.update(appt.id, { status: "completed", paymentStatus: "paid" });
        } else {
          await appointmentsStore.update(appt.id, { paymentStatus: "paid" });
        }

        count++;
      }

      toast.success(`${count} agendamento(s) lançados no caixa!`);
      setAutoModalOpen(false);
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro no lançamento automático");
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const autoTotal = useMemo(() =>
    launchableAppts
      .filter(a => autoSelected.has(a.id))
      .reduce((s, a) => s + toNum(a.totalPrice), 0),
    [launchableAppts, autoSelected]
  );

  const closedSessions = sessions.filter(s => s.status === "closed")
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Caixa</h2>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="w-3.5 h-3.5" />Histórico
          </Button>
          {currentSession ? (
            <Button onClick={() => setCloseModalOpen(true)} variant="outline" className="gap-2 bg-transparent">
              <Lock className="w-4 h-4" />Fechar Caixa
            </Button>
          ) : (
            <Button onClick={() => setOpenModalOpen(true)} className="gap-2">
              <Unlock className="w-4 h-4" />Abrir Caixa
            </Button>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className={`flex items-center justify-between gap-3 p-4 rounded-xl border ${
        currentSession
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-border bg-card/50"
      }`}>
        <div className="flex items-center gap-3">
          {currentSession ? (
            <>
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="font-medium text-emerald-400 text-sm">Caixa Aberto</p>
                <p className="text-xs text-muted-foreground">
                  Desde {format(new Date(currentSession.openedAt), "HH:mm")} —
                  Saldo inicial: R$ {toNum(currentSession.openingBalance).toFixed(2)}
                </p>
              </div>
            </>
          ) : (
            <>
              <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <p className="text-muted-foreground text-sm">
                Caixa fechado. Abra o caixa para registrar movimentos.
              </p>
            </>
          )}
        </div>
        {currentSession && (
          <div className="flex items-center gap-2">
            {launchableAppts.length > 0 && (
              <Button
                onClick={openAutoModal}
                size="sm"
                className="gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0"
              >
                <Zap className="w-3.5 h-3.5" />
                Lançamento Automático
                <Badge className="bg-white/20 text-white text-[10px] px-1.5 py-0 ml-1">
                  {launchableAppts.length}
                </Badge>
              </Button>
            )}
            <Button onClick={openCreateEntry} size="sm" className="gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" />Lançar
            </Button>
          </div>
        )}
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
              <p className="text-xs text-muted-foreground">Faturamento</p>
            </div>
            <p className="text-2xl font-bold text-primary">R$ {totalRevenue.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">{entries.length} lançamento(s)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <p className="text-xs text-muted-foreground">Pendentes (hoje)</p>
            </div>
            <p className="text-2xl font-bold text-amber-400">
              R$ {launchableAppts.reduce((s, a) => s + toNum(a.totalPrice), 0).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{launchableAppts.length} agendamento(s)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Comissões</p>
            </div>
            <p className="text-2xl font-bold">R$ {totalCommissions.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-xs text-muted-foreground">Líquido</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400">R$ {netRevenue.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">+ R$ {openingBal.toFixed(2)} abertura</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Formas de pagamento ── */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PAYMENT_METHODS.map(({ value, label }) => {
            const val = revenueByMethod[value] ?? 0;
            if (val === 0) return null;
            return (
              <div key={value} className="bg-card/50 border border-border rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                <p className={`text-sm font-bold ${PAYMENT_COLORS[value]}`}>
                  R$ {val.toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Lançamentos ── */}
        <div className="lg:col-span-2 space-y-3">
          <button
            className="w-full flex items-center justify-between text-sm font-semibold py-1"
            onClick={() => toggleSection("lancamentos")}
          >
            <span className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Lançamentos do Caixa
              {entries.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">{entries.length}</Badge>
              )}
            </span>
            {expandedSections.has("lancamentos")
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            }
          </button>

          {expandedSections.has("lancamentos") && (
            <Card className="border-border bg-card/50">
              <CardContent className="pt-4">
                {entries.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Nenhum lançamento ainda.</p>
                    {currentSession && (
                      <p className="text-xs mt-1">Use "Lançar" ou "Lançamento Automático".</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(showAllEntries ? entries : entries.slice(-10)).map(entry => {
                      const emp = employees.find(e => e.id === entry.employeeId);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-secondary/30 transition-colors group"
                        >
                          {entry.isAutoLaunch && (
                            <Zap className="w-3 h-3 text-amber-400 flex-shrink-0" />
                          )}
                          {!entry.isAutoLaunch && (
                            <Plus className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{entry.clientName}</p>
                              <span className={`text-[10px] flex-shrink-0 ${PAYMENT_COLORS[entry.paymentMethod]}`}>
                                {PAYMENT_LABELS[entry.paymentMethod]}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {emp?.name ?? "—"} · {entry.description}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-primary">
                              R$ {entry.amount.toFixed(2)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              com. R$ {entry.commissionValue.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEditEntry(entry)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Scissors className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {entries.length > 10 && (
                      <button
                        onClick={() => setShowAllEntries(v => !v)}
                        className="w-full text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                      >
                        {showAllEntries
                          ? "Mostrar menos"
                          : `Ver todos (${entries.length})`}
                      </button>
                    )}
                    <Separator className="my-2" />
                    <div className="flex items-center justify-between px-2.5 text-sm font-semibold">
                      <span>Total</span>
                      <span className="text-primary">R$ {totalRevenue.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Comissões ── */}
        <div className="space-y-3">
          <button
            className="w-full flex items-center justify-between text-sm font-semibold py-1"
            onClick={() => toggleSection("comissoes")}
          >
            <span className="flex items-center gap-2">
              <Percent className="w-4 h-4 text-primary" />
              Comissões
            </span>
            {expandedSections.has("comissoes")
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            }
          </button>

          {expandedSections.has("comissoes") && (
            <Card className="border-border bg-card/50">
              <CardContent className="pt-4">
                {commissionsByEmployee.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Nenhuma comissão calculada
                  </p>
                ) : (
                  <div className="space-y-3">
                    {commissionsByEmployee.map(({ employee, revenue, commission, count }) => (
                      <div key={employee.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: employee.color }} />
                          <span className="text-sm font-medium flex-1 truncate">{employee.name}</span>
                          <span className="text-sm font-bold text-primary">
                            R$ {commission.toFixed(2)}
                          </span>
                        </div>
                        <div className="ml-4.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{count} atend.</span>
                          <span>·</span>
                          <span>{employee.commissionPercent}% de R$ {revenue.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                    <Separator />
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Faturamento bruto</span>
                        <span className="font-semibold">R$ {totalRevenue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total comissões</span>
                        <span className="font-semibold text-red-400">- R$ {totalCommissions.toFixed(2)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-bold">
                        <span>Líquido</span>
                        <span className="text-emerald-400">R$ {netRevenue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Agendamentos pendentes */}
          {launchableAppts.length > 0 && currentSession && (
            <>
              <button
                className="w-full flex items-center justify-between text-sm font-semibold py-1"
                onClick={() => toggleSection("pendentes")}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Pendentes de Lançamento
                  <Badge className="bg-amber-500/20 text-amber-400 text-[10px] px-1.5 border-0">
                    {launchableAppts.length}
                  </Badge>
                </span>
                {expandedSections.has("pendentes")
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {expandedSections.has("pendentes") && (
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardContent className="pt-4 space-y-2">
                    {launchableAppts.map(appt => {
                      const emp = employees.find(e => e.id === appt.employeeId);
                      return (
                        <div key={appt.id} className="flex items-center gap-2 text-xs">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            appt.status === "completed" ? "bg-green-400" :
                            appt.status === "in_progress" ? "bg-amber-400" : "bg-blue-400"
                          }`} />
                          <span className="flex-1 truncate font-medium">{appt.clientName ?? "—"}</span>
                          <span className="text-muted-foreground truncate">{emp?.name ?? "—"}</span>
                          <span className="font-semibold text-primary flex-shrink-0">
                            R$ {toNum(appt.totalPrice).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                    <Button
                      size="sm"
                      onClick={openAutoModal}
                      className="w-full mt-2 gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0 h-7"
                    >
                      <Zap className="w-3 h-3" />Lançar todos automaticamente
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══════════════ MODAIS ══════════════ */}

      {/* ── Modal: Abrir caixa ── */}
      <Dialog open={openModalOpen} onOpenChange={v => !v && setOpenModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            <Unlock className="w-4 h-4" />Abrir Caixa
          </DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Data do caixa */}
            <div className="space-y-1">
              <Label>Data do caixa</Label>
              <Input
                type="date"
                value={openingDate}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={e => setOpeningDate(e.target.value)}
              />
              {openingDate !== format(new Date(), "yyyy-MM-dd") && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
                  <span>⚠</span>
                  <span>Abrindo caixa retroativo para <strong>{format(parseISO(openingDate), "dd/MM/yyyy", { locale: ptBR })}</strong></span>
                </div>
              )}
            </div>
            {/* Saldo inicial */}
            <div className="space-y-1">
              <Label>Saldo inicial (R$)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={openingBalance}
                onChange={e => setOpeningBalance(e.target.value)}
                placeholder="0,00"
              />
              <p className="text-xs text-muted-foreground">
                Dinheiro em caixa antes de começar o dia
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenModalOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={handleOpenCash} disabled={loading} className="gap-2">
              <Unlock className="w-4 h-4" />{loading ? "Abrindo..." : "Abrir Caixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Fechar caixa ── */}
      <Dialog open={closeModalOpen} onOpenChange={v => !v && setCloseModalOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4" />Fechar Caixa
          </DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">Saldo abertura</p>
                <p className="font-bold text-lg">R$ {openingBal.toFixed(2)}</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">Faturamento</p>
                <p className="font-bold text-primary text-lg">R$ {totalRevenue.toFixed(2)}</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">Comissões</p>
                <p className="font-bold text-lg">- R$ {totalCommissions.toFixed(2)}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">Total em caixa</p>
                <p className="font-bold text-emerald-400 text-lg">
                  R$ {(openingBal + netRevenue).toFixed(2)}
                </p>
              </div>
            </div>
            {launchableAppts.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  {launchableAppts.length} agendamento(s) ainda não lançados. Considere usar
                  o lançamento automático antes de fechar.
                </span>
              </div>
            )}
            <div className="space-y-1">
              <Label>Observações do fechamento</Label>
              <Textarea
                value={closingNotes}
                onChange={e => setClosingNotes(e.target.value)}
                placeholder="Observações, divergências..." rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseModalOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={handleCloseCash} disabled={loading} className="gap-2">
              <Lock className="w-4 h-4" />{loading ? "Fechando..." : "Confirmar Fechamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Lançamento manual ── */}
      <Dialog open={entryModalOpen} onOpenChange={v => !v && setEntryModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {editingEntry ? "Editar Lançamento" : "Novo Lançamento"}
          </DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Cliente *</Label>
                <Input
                  value={entryForm.clientName}
                  onChange={e => setEntryForm(p => ({ ...p, clientName: e.target.value }))}
                  placeholder="Nome do cliente"
                />
              </div>
              <div className="space-y-1">
                <Label>Funcionário *</Label>
                <Select value={entryForm.employeeId} onValueChange={v => setEntryForm(p => ({ ...p, employeeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {employees.map(emp => (
                      <SelectItem key={emp.id} value={String(emp.id)}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} />
                          {emp.name}
                          <span className="text-muted-foreground text-xs">({emp.commissionPercent}%)</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Forma de pagamento</Label>
                <Select value={entryForm.paymentMethod} onValueChange={v => setEntryForm(p => ({ ...p, paymentMethod: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Valor (R$) *</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={entryForm.amount}
                  onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label>Descrição / Serviço</Label>
                <Input
                  value={entryForm.description}
                  onChange={e => setEntryForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Ex: Corte + escova"
                />
              </div>
            </div>
            {/* Preview comissão */}
            {entryForm.employeeId && toNum(entryForm.amount) > 0 && (() => {
              const emp = employees.find(e => e.id === parseInt(entryForm.employeeId));
              if (!emp) return null;
              const commission = toNum(entryForm.amount) * (emp.commissionPercent / 100);
              return (
                <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                  <span className="text-muted-foreground">
                    Comissão {emp.name} ({emp.commissionPercent}%)
                  </span>
                  <span className="font-bold text-primary">R$ {commission.toFixed(2)}</span>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryModalOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={handleSaveEntry} disabled={loading}>
              {loading ? "Salvando..." : editingEntry ? "Salvar" : "Lançar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Lançamento automático ── */}
      <Dialog open={autoModalOpen} onOpenChange={v => !v && setAutoModalOpen(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Lançamento Automático
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Lança agendamentos do dia no caixa automaticamente como dinheiro e calcula comissões.
            </p>
          </DialogHeader>

          <div className="space-y-3 py-2 flex-1 overflow-y-auto">
            {/* Forma de pagamento global */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
              <Label className="text-sm flex-shrink-0">Forma de pagamento:</Label>
              <Select value={autoPayMethod} onValueChange={v => setAutoPayMethod(v as any)}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selecionar todos */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">
                {autoSelected.size} de {launchableAppts.length} selecionados
              </span>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  if (autoSelected.size === launchableAppts.length) {
                    setAutoSelected(new Set());
                  } else {
                    setAutoSelected(new Set(launchableAppts.map(a => a.id)));
                  }
                }}
              >
                {autoSelected.size === launchableAppts.length ? "Desmarcar todos" : "Selecionar todos"}
              </button>
            </div>

            {/* Lista de agendamentos */}
            <div className="space-y-1.5">
              {launchableAppts.map(appt => {
                const emp = employees.find(e => e.id === appt.employeeId);
                const amount     = toNum(appt.totalPrice);
                const commission = emp ? amount * (emp.commissionPercent / 100) : 0;
                const isSelected = autoSelected.has(appt.id);
                const services   = (appt.services ?? []).map(s => s.name).join(", ") || "Serviço";

                return (
                  <div
                    key={appt.id}
                    onClick={() => toggleAutoSelect(appt.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card/50 opacity-60"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                      isSelected ? "bg-primary border-primary" : "border-muted-foreground"
                    }`}>
                      {isSelected && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{appt.clientName ?? "Cliente"}</p>
                        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                          {STATUS_LABELS[appt.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {emp?.name ?? "—"} · {services}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(appt.startTime), "HH:mm")}
                        {emp && ` · comissão ${emp.commissionPercent}% = R$ ${commission.toFixed(2)}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-primary">R$ {amount.toFixed(2)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resumo */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total selecionado</span>
              <span className="font-bold text-primary">R$ {autoTotal.toFixed(2)}</span>
            </div>
            {autoSelected.size > 0 && (() => {
              const totalComm = launchableAppts
                .filter(a => autoSelected.has(a.id))
                .reduce((s, a) => {
                  const emp = employees.find(e => e.id === a.employeeId);
                  return s + (emp ? toNum(a.totalPrice) * (emp.commissionPercent / 100) : 0);
                }, 0);
              return (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Comissões estimadas</span>
                  <span>R$ {totalComm.toFixed(2)}</span>
                </div>
              );
            })()}
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setAutoModalOpen(false)} disabled={loading}>Cancelar</Button>
            <Button
              onClick={handleAutoLaunch}
              disabled={loading || autoSelected.size === 0}
              className="gap-2 bg-amber-500 hover:bg-amber-600 text-white border-0"
            >
              <Zap className="w-4 h-4" />
              {loading ? "Lançando..." : `Lançar ${autoSelected.size} agendamento(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Histórico de caixas ── */}
      <Dialog open={historyOpen} onOpenChange={v => !v && setHistoryOpen(false)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4" />Histórico de Caixas
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {closedSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum caixa fechado ainda
              </p>
            ) : (
              closedSessions.map(session => {
                const sessionEntries = cashEntriesStore.list(session.id);
                return (
                  <div key={session.id} className="border border-border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-4 p-3 bg-secondary/20">
                      <div className="flex-1">
                        <p className="text-sm font-semibold">
                          {format(new Date(session.openedAt), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(session.openedAt), "HH:mm")}
                          {session.closedAt && ` → ${format(new Date(session.closedAt), "HH:mm")}`}
                          {` · ${sessionEntries.length} lançamento(s)`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">
                          R$ {toNum(session.totalRevenue).toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          líquido R$ {(toNum(session.totalRevenue) - toNum(session.totalCommissions)).toFixed(2)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">Fechado</Badge>
                    </div>
                    {session.closingNotes && (
                      <div className="px-3 py-2 border-t border-border bg-background/30">
                        <p className="text-xs text-muted-foreground">{session.closingNotes}</p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
