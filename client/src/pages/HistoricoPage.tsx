/**
 * HistoricoAgendamentosPage — Histórico de agendamentos concluídos por cliente.
 * Exibe os 3 últimos atendimentos de cada cliente com serviços e valores.
 * Permite reagendar os mesmos serviços para nova data/horário com os mesmos funcionários.
 */
import { useState, useMemo, useEffect } from "react";
import { format, addMinutes, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Search, CalendarCheck, Clock, DollarSign, User, Scissors,
  RefreshCw, ChevronDown, ChevronUp, Calendar, CheckCircle,
  RotateCcw, Users,
} from "lucide-react";
import {
  appointmentsStore, employeesStore,
  type Appointment, type AppointmentService,
} from "@/lib/store";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Agrupa os últimos N agendamentos concluídos por cliente
function groupByClient(appointments: Appointment[], maxPerClient = 3) {
  const map = new Map<string, Appointment[]>();

  // Ordena do mais recente para o mais antigo
  const sorted = [...appointments].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  );

  sorted.forEach(appt => {
    const key = (appt.clientName ?? "Sem nome").toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key)!;
    if (list.length < maxPerClient) list.push(appt);
  });

  // Retorna como array ordenado por nome
  return Array.from(map.entries())
    .map(([, appts]) => ({
      clientName: appts[0].clientName ?? "Sem nome",
      appointments: appts,
      lastVisit: appts[0].startTime,
      totalSpent: appts.reduce((s, a) => s + toNum(a.totalPrice), 0),
    }))
    .sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));
}

// ─── Modal de Reagendamento ───────────────────────────────

interface RescheduleModalProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  employees: ReturnType<typeof employeesStore.list>;
}

function RescheduleModal({ open, onClose, appointment, employees }: RescheduleModalProps) {
  const [date, setDate]   = useState(format(new Date(), "yyyy-MM-dd"));
  const [time, setTime]   = useState("09:00");
  const [loading, setLoading] = useState(false);

  // Todos os cálculos ANTES de qualquer return condicional (regra dos hooks)
  const emp           = employees.find(e => e.id === appointment?.employeeId);
  const services      = appointment?.services ?? [];
  const totalDuration = services.reduce((s, sv) => s + sv.durationMinutes, 0) || 60;

  const endTime = useMemo(() => {
    const [h, m] = time.split(":").map(Number);
    return format(addMinutes(new Date(2000, 0, 1, h, m), totalDuration), "HH:mm");
  }, [time, totalDuration]);

  // Return condicional DEPOIS de todos os hooks
  if (!appointment) return null;


  const handleConfirm = async () => {
    if (!date) { toast.error("Selecione uma data"); return; }
    if (!time) { toast.error("Selecione um horário"); return; }

    setLoading(true);
    try {
      const [h, m]  = time.split(":").map(Number);
      const base    = parseISO(date);
      const startDt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
      const endDt   = addMinutes(startDt, totalDuration);

      await appointmentsStore.create({
        clientName:    appointment.clientName,
        clientId:      appointment.clientId,
        employeeId:    appointment.employeeId,
        startTime:     startDt.toISOString(),
        endTime:       endDt.toISOString(),
        status:        "scheduled",
        totalPrice:    appointment.totalPrice,
        notes:         appointment.notes,
        paymentStatus: null,
        groupId:       null,
        services:      appointment.services,
      });

      toast.success(
        `Reagendado para ${format(parseISO(date), "dd/MM/yyyy", { locale: ptBR })} às ${time}!`
      );
      onClose();
    } catch {
      toast.error("Erro ao reagendar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-primary" />
            Reagendar Atendimento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Resumo do que será reagendado */}
          <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{appointment.clientName ?? "Cliente"}</span>
            </div>
            {emp && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                <span className="text-xs text-muted-foreground">{emp.name}</span>
              </div>
            )}
            <Separator />
            <div className="space-y-1">
              {services.length > 0 ? services.map((svc, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color }} />
                    <span>{svc.name}</span>
                    <span className="text-muted-foreground">· {svc.durationMinutes}min</span>
                  </div>
                  <span className="font-medium text-primary">R$ {svc.price.toFixed(2)}</span>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">Nenhum serviço registrado</p>
              )}
            </div>
            <div className="flex items-center justify-between pt-1 text-xs font-semibold">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />{totalDuration} min no total
              </span>
              <span className="text-primary">R$ {toNum(appointment.totalPrice).toFixed(2)}</span>
            </div>
          </div>

          {/* Nova data e horário */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nova data *</Label>
              <Input
                type="date"
                value={date}
                min={format(new Date(), "yyyy-MM-dd")}
                onChange={e => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Horário *</Label>
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
              />
            </div>
          </div>

          {/* Preview do horário final */}
          {date && time && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-muted-foreground">
                {format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold">{time} → {endTime}</span>
            </div>
          )}

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              O novo agendamento usará os mesmos serviços e funcionário do atendimento original.
              O status será definido como <strong>Agendado</strong>.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading} className="gap-2">
            <RotateCcw className="w-3.5 h-3.5" />
            {loading ? "Reagendando..." : "Confirmar Reagendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente Principal ─────────────────────────────────

export default function HistoricoAgendamentosPage() {
  const [search, setSearch]               = useState("");
  const [expandedClients, setExpanded]    = useState<Set<string>>(new Set());
  const [rescheduleAppt, setReschedule]   = useState<Appointment | null>(null);
  const [refreshKey, setRefreshKey]       = useState(0);

  useEffect(() => {
    const onUpdate = () => setRefreshKey(k => k + 1);
    window.addEventListener("store_updated", onUpdate);
    return () => window.removeEventListener("store_updated", onUpdate);
  }, []);

  const employees    = useMemo(() => employeesStore.list(false), [refreshKey]);
  const allCompleted = useMemo(() =>
    appointmentsStore.list({}).filter(a => a.status === "completed"),
    [refreshKey]
  );

  const grouped = useMemo(() => groupByClient(allCompleted, 3), [allCompleted]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped.filter(g =>
      g.clientName.toLowerCase().includes(q) ||
      g.appointments.some(a =>
        a.services?.some(s => s.name.toLowerCase().includes(q))
      )
    );
  }, [grouped, search]);

  const toggleClient = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const totalClients     = grouped.length;
  const totalAtendimentos = allCompleted.length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-primary" />
            Histórico de Agendamentos
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Atendimentos concluídos — últimas 3 visitas por cliente
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-primary">{totalClients}</p>
            <p className="text-[10px] text-muted-foreground">clientes</p>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="text-center">
            <p className="text-lg font-bold">{totalAtendimentos}</p>
            <p className="text-[10px] text-muted-foreground">atendimentos</p>
          </div>
        </div>
      </div>

      {/* ── Busca ── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente ou serviço..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* ── Lista ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarCheck className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">
            {search ? "Nenhum resultado encontrado" : "Nenhum atendimento concluído ainda"}
          </p>
          <p className="text-sm mt-1">
            {!search && "Os atendimentos marcados como 'Concluído' aparecerão aqui."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ clientName, appointments, lastVisit, totalSpent }) => {
            const isExpanded = expandedClients.has(clientName);
            const initials   = clientName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

            return (
              <Card key={clientName} className={`border-border bg-card/50 overflow-hidden transition-all duration-200 ${isExpanded ? "border-primary/30" : ""}`}>

                {/* ── Cabeçalho do cliente ── */}
                <button
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-secondary/20 transition-colors"
                  onClick={() => toggleClient(clientName)}
                >
                  <Avatar className="w-10 h-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{clientName}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {appointments.length} visita{appointments.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Última visita: {format(parseISO(lastVisit), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Total: R$ {totalSpent.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Botão de reagendar rápido (último atendimento) */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-7 flex-shrink-0 hidden sm:flex"
                    onClick={e => { e.stopPropagation(); setReschedule(appointments[0]); }}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reagendar
                  </Button>

                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  }
                </button>

                {/* ── Detalhes expandidos ── */}
                {isExpanded && (
                  <div className="border-t border-border divide-y divide-border">
                    {appointments.map((appt, idx) => {
                      const emp      = employees.find(e => e.id === appt.employeeId);
                      const services = appt.services ?? [];
                      const isLatest = idx === 0;

                      return (
                        <div key={appt.id} className={`p-4 space-y-3 ${isLatest ? "bg-primary/3" : ""}`}>

                          {/* Data + funcionário + badge */}
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              {isLatest && (
                                <Badge className="text-[10px] bg-primary/20 text-primary border-0 px-1.5">
                                  Mais recente
                                </Badge>
                              )}
                              <span className="text-sm font-medium">
                                {format(parseISO(appt.startTime), "EEEE, dd/MM/yyyy", { locale: ptBR })}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(parseISO(appt.startTime), "HH:mm")}
                                {appt.endTime && ` → ${format(parseISO(appt.endTime), "HH:mm")}`}
                              </span>
                            </div>

                            {/* Reagendar este atendimento */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 text-xs h-7 text-primary hover:text-primary hover:bg-primary/10"
                              onClick={() => setReschedule(appt)}
                            >
                              <RotateCcw className="w-3 h-3" />
                              Reagendar
                            </Button>
                          </div>

                          {/* Funcionário */}
                          {emp && (
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                              <span className="text-xs text-muted-foreground">{emp.name}</span>
                            </div>
                          )}

                          {/* Serviços */}
                          <div className="space-y-1.5">
                            {services.length > 0 ? (
                              services.map((svc, si) => (
                                <div key={si} className="flex items-center gap-2.5">
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: svc.color }}
                                  />
                                  <span className="text-sm flex-1">{svc.name}</span>
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Clock className="w-3 h-3" />{svc.durationMinutes}min
                                  </span>
                                  <span className="text-xs font-semibold text-primary">
                                    R$ {svc.price.toFixed(2)}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground">Nenhum serviço registrado</p>
                            )}
                          </div>

                          {/* Total */}
                          {appt.totalPrice != null && (
                            <div className="flex justify-end pt-1">
                              <div className="flex items-center gap-2 text-sm font-bold">
                                <span className="text-muted-foreground font-normal text-xs">Total</span>
                                <span className="text-primary">R$ {toNum(appt.totalPrice).toFixed(2)}</span>
                              </div>
                            </div>
                          )}

                          {/* Observações */}
                          {appt.notes && (
                            <div className="p-2.5 rounded-lg bg-secondary/30 text-xs text-muted-foreground">
                              <span className="font-medium">Obs:</span> {appt.notes}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Botão de reagendar no mobile */}
                    <div className="p-3 sm:hidden">
                      <Button
                        size="sm"
                        className="w-full gap-2 text-xs"
                        onClick={() => setReschedule(appointments[0])}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reagendar última visita
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Modal de reagendamento ── */}
      <RescheduleModal
        open={rescheduleAppt !== null}
        onClose={() => setReschedule(null)}
        appointment={rescheduleAppt}
        employees={employees}
      />
    </div>
  );
}
