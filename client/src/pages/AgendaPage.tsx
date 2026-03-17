/**
 * AgendaPage — Grade de horários por funcionário com drag-and-drop.
 * Design: Glass Dashboard. Adaptado de tRPC para localStorage store.
 * Suporta groupId para agrupar serviços do mesmo cliente.
 */
import { useState, useMemo, useRef, useCallback, useEffect, memo } from "react";
import { format, addDays, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Calendar, CalendarDays, RefreshCw, Clock, Link2, Search } from "lucide-react";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import AppointmentModal from "@/components/AppointmentModal";
import { cn } from "@/lib/utils";
import {
  employeesStore, servicesStore, appointmentsStore,
  fetchAllData,
  type Appointment,
} from "@/lib/store";

// ─── Constants ────────────────────────────────────────────────────────────────
const HOUR_HEIGHT = 64;
const MIN_COL_WIDTH = 120;

function loadScheduleConfig() {
  try {
    const saved = localStorage.getItem("salon_config");
    if (saved) {
      const c = JSON.parse(saved);
      const startH = parseInt((c.openTime  || "07:00").split(":")[0]);
      const endH   = parseInt((c.closeTime || "21:00").split(":")[0]);
      const snap   = parseInt(c.slotDuration) || 15;
      return {
        START_HOUR:   isNaN(startH) ? 7  : startH,
        END_HOUR:     isNaN(endH)   ? 21 : endH,
        SNAP_MINUTES: isNaN(snap)   ? 15 : snap,
      };
    }
  } catch { /* ignore */ }
  return { START_HOUR: 7, END_HOUR: 21, SNAP_MINUTES: 15 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeToPixels(date: Date, startHour: number): number {
  return (date.getHours() + date.getMinutes() / 60 - startHour) * HOUR_HEIGHT;
}

function durationToPixels(start: Date, end: Date): number {
  return ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_HEIGHT;
}

function snapToGrid(minutes: number, snapMinutes: number): number {
  return Math.round(minutes / snapMinutes) * snapMinutes;
}

const STATUS_BORDER: Record<string, string> = {
  scheduled:   "border-l-blue-400",
  confirmed:   "border-l-emerald-400",
  in_progress: "border-l-amber-400",
  completed:   "border-l-green-400",
  cancelled:   "border-l-red-400",
  no_show:     "border-l-gray-400",
};

// ─── AppointmentBlock ─────────────────────────────────────────────────────────
const LONG_PRESS_MS = 500;

const AppointmentBlock = memo(function AppointmentBlock({
  appt,
  color,
  isGrouped,
  onClick,
  onDragStart,
  startHour,
}: {
  appt: Appointment;
  color: string;
  isGrouped: boolean;
  onClick: () => void;
  onDragStart: (appt: Appointment, y: number, x: number) => void;
  startHour: number;
}) {
  const start  = new Date(appt.startTime);
  const end    = new Date(appt.endTime);
  const top    = timeToPixels(start, startHour);
  const height = Math.max(durationToPixels(start, end), 28);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart   = useRef<{ y: number; x: number } | null>(null);
  const dragReady      = useRef(false); // long press concluído
  const didDrag        = useRef(false); // drag efetivamente iniciado
  const [pressing, setPressing] = useState(false); // feedback visual

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pointerStart.current = null;
    dragReady.current = false;
    setPressing(false);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    didDrag.current = false;
    dragReady.current = false;
    pointerStart.current = { y: e.clientY, x: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.pointerType === "mouse") {
      // Mouse: ativa drag direto ao mover, sem long press
      dragReady.current = true;
    } else {
      // Touch: long press de 500ms com feedback visual
      setPressing(true);
      longPressTimer.current = setTimeout(() => {
        dragReady.current = true;
        setPressing(false);
        if (navigator.vibrate) navigator.vibrate(40);
      }, LONG_PRESS_MS);
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dy = e.clientY - pointerStart.current.y;
    const dx = e.clientX - pointerStart.current.x;
    const dist = Math.sqrt(dy * dy + dx * dx);

    // Touch: se mover mais de 10px antes do long press, cancela (vira scroll)
    if (e.pointerType !== "mouse" && !dragReady.current && dist > 10) {
      cancelLongPress();
      return;
    }

    // Drag ativo — inicia ao mover
    if (dragReady.current && !didDrag.current && dist > 4) {
      didDrag.current = true;
      onDragStart(appt, pointerStart.current.y, pointerStart.current.x);
    }
  }, [appt, onDragStart, cancelLongPress]);

  const handlePointerUp = useCallback(() => {
    cancelLongPress();
    didDrag.current = false;
  }, [cancelLongPress]);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelLongPress}
      onClick={(e) => { e.stopPropagation(); if (!didDrag.current && !dragReady.current) onClick(); }}
      style={{
        position: "absolute",
        top: `${top}px`,
        height: `${height}px`,
        left: "3px",
        right: "3px",
        backgroundColor: color + "25",
        borderLeft: `3px solid ${color}`,
        zIndex: 10,
        touchAction: "none",
        transition: pressing ? "none" : "transform 0.15s, box-shadow 0.15s",
        transform: pressing ? "scale(0.97)" : "scale(1)",
        boxShadow: pressing ? `0 0 0 2px ${color}88` : "none",
      }}
      className={cn(
        "rounded-md px-2 py-1 cursor-grab active:cursor-grabbing select-none overflow-hidden",
        "hover:brightness-110 transition-all",
        STATUS_BORDER[appt.status] ?? "border-l-gray-400"
      )}
    >
      <div className="flex items-center gap-1">
        {/* Se tem exatamente 1 serviço, mostra o nome do serviço em destaque */}
        {appt.services?.length === 1 ? (
          <p className="text-xs font-semibold truncate flex-1" style={{ color }}>
            {appt.services[0].name}
          </p>
        ) : (
          <p className="text-xs font-semibold truncate flex-1" style={{ color }}>
            {appt.clientName ?? "Sem nome"}
          </p>
        )}
        {isGrouped && (
          <Link2 className="w-2.5 h-2.5 flex-shrink-0 opacity-70" style={{ color }} />
        )}
      </div>
      {/* Nome do cliente (secundário) */}
      {height > 36 && (
        <p className="text-[10px] text-muted-foreground truncate leading-tight">
          {appt.clientName ?? "Sem nome"}
        </p>
      )}
      {height > 52 && (
        <p className="text-xs text-muted-foreground flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {format(start, "HH:mm")}–{format(end, "HH:mm")}
        </p>
      )}
      {height > 70 && appt.totalPrice != null && (
        <p className="text-xs text-muted-foreground">
          R$ {appt.totalPrice.toFixed(2)}
        </p>
      )}
    </div>
  );
});

// ─── EmployeeColumn ───────────────────────────────────────────────────────────
const EmployeeColumn = memo(function EmployeeColumn({
  employee,
  appointments,
  serviceMap,
  groupIds,
  isDragOver,
  onColumnClick,
  onAppointmentClick,
  onDragStart,
  startHour,
  totalHours,
  snapMinutes,
}: {
  employee: { id: number; name: string; color: string; photoUrl?: string | null };
  appointments: Appointment[];
  serviceMap: Map<number, { color: string }>;
  groupIds: Set<string>;
  isDragOver: boolean;
  onColumnClick: (empId: number, hour: number, minute: number) => void;
  onAppointmentClick: (appt: Appointment) => void;
  onDragStart: (appt: Appointment, y: number, x: number) => void;
  startHour: number;
  totalHours: number;
  snapMinutes: number;
}) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMinutes = (y / HOUR_HEIGHT) * 60 + startHour * 60;
    const snapped = snapToGrid(totalMinutes, snapMinutes);
    const hour = Math.floor(snapped / 60);
    const minute = snapped % 60;
    onColumnClick(employee.id, hour, minute);
  }, [employee.id, onColumnClick, startHour, snapMinutes]);

  return (
    <div
      className={cn(
        "relative border-l border-border transition-colors",
        isDragOver && "bg-primary/8"
      )}
      style={{ height: `${totalHours * HOUR_HEIGHT}px`, width: `${MIN_COL_WIDTH}px` }}
      onClick={handleClick}
    >
      {Array.from({ length: totalHours }, (_, i) => (
        <div key={i} className="absolute w-full border-t border-border/60"
          style={{ top: `${i * HOUR_HEIGHT}px` }} />
      ))}
      {Array.from({ length: totalHours }, (_, i) => (
        <div key={`h${i}`} className="absolute w-full border-t border-border/20 border-dashed"
          style={{ top: `${i * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }} />
      ))}
      {/* Linha do horário atual — pointer-events:none para não bloquear cliques */}
      <NowLine startHour={startHour} totalHours={totalHours} />
      {appointments.map(appt => {
        const firstSvcId = appt.services?.[0]?.serviceId;
        const color = firstSvcId
          ? (serviceMap.get(firstSvcId)?.color ?? employee.color)
          : employee.color;
        const isGrouped = !!(appt.groupId && groupIds.has(appt.groupId));
        return (
          <AppointmentBlock
            key={appt.id}
            appt={appt}
            color={color}
            isGrouped={isGrouped}
            onClick={() => onAppointmentClick(appt)}
            onDragStart={onDragStart}
            startHour={startHour}
          />
        );
      })}
    </div>
  );
});

// ─── useAccentColor — lê a cor de acento do salon_config ─────────────────────
function useAccentColor(): string {
  const [accent, setAccent] = useState(() => {
    try {
      const s = localStorage.getItem("salon_config");
      if (s) return JSON.parse(s).accentColor || "#ec4899";
    } catch { /* ignore */ }
    return "#ec4899";
  });
  useEffect(() => {
    const onUpdate = () => {
      try {
        const s = localStorage.getItem("salon_config");
        if (s) setAccent(JSON.parse(s).accentColor || "#ec4899");
      } catch { /* ignore */ }
    };
    window.addEventListener("salon_config_updated", onUpdate);
    return () => window.removeEventListener("salon_config_updated", onUpdate);
  }, []);
  return accent;
}

// ─── NowLine — linha vermelha do horário atual ────────────────────────────────
function NowLine({ startHour, totalHours }: { startHour: number; totalHours: number }) {
  const accent = useAccentColor();
  const [top, setTop] = useState<number | null>(null);

  const calcTop = useCallback(() => {
    const now = new Date();
    const rel = (now.getHours() + now.getMinutes() / 60) - startHour;
    return (rel >= 0 && rel <= totalHours) ? rel * HOUR_HEIGHT : null;
  }, [startHour, totalHours]);

  useEffect(() => {
    setTop(calcTop());
    const id = setInterval(() => setTop(calcTop()), 60_000);
    return () => clearInterval(id);
  }, [calcTop]);

  if (top === null) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: `${top}px`,
        left: 0, right: 0,
        display: "flex",
        alignItems: "center",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      <div style={{
        width: 9, height: 9,
        borderRadius: "50%",
        backgroundColor: accent,
        flexShrink: 0,
        marginLeft: -4.5,
        boxShadow: `0 0 0 3px ${accent}44, 0 0 8px ${accent}99`,
      }} />
      <div style={{
        height: 1.5,
        flex: 1,
        background: `linear-gradient(to right, ${accent} 0%, ${accent}55 50%, transparent 100%)`,
      }} />
    </div>
  );
}

// ─── DragGhost ────────────────────────────────────────────────────────────────
function DragGhost({ appt, x, y }: { appt: Appointment; x: number; y: number }) {
  return (
    <div
      style={{
        position: "fixed",
        left: x - 60,
        top: y - 20,
        zIndex: 9999,
        pointerEvents: "none",
        minWidth: 120,
      }}
      className="bg-card border border-primary rounded-md px-3 py-2 shadow-2xl text-sm font-medium opacity-90"
    >
      {appt.clientName ?? "Sem nome"}
    </div>
  );
}

// ─── AgendaPage ───────────────────────────────────────────────────────────────
export default function AgendaPage() {
  const [selectedDate, setSelectedDate]   = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [modalOpen, setModalOpen]         = useState(false);
  const [editingAppt, setEditingAppt]     = useState<Appointment | null>(null);
  const [defaultEmpId, setDefaultEmpId]   = useState<number | undefined>();
  const [defaultHour, setDefaultHour]     = useState(9);
  const [defaultMinute, setDefaultMinute] = useState(0);
  const [groupClientName, setGroupClientName] = useState<string | undefined>();
  const [groupId, setGroupId]             = useState<string | undefined>();
  const [refreshKey, setRefreshKey]       = useState(0);
  const [refreshing, setRefreshing]       = useState(false);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchAllData();
      setRefreshKey(k => k + 1);
      window.dispatchEvent(new Event("store_updated"));
      toast.success("Agenda atualizada!");
    } catch {
      toast.error("Erro ao atualizar");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // Horários/slots dinâmicos vindos de Configurações
  const [schedCfg, setSchedCfg] = useState(loadScheduleConfig);
  const { START_HOUR, END_HOUR, SNAP_MINUTES } = schedCfg;
  const TOTAL_HOURS = END_HOUR - START_HOUR;

  useEffect(() => {
    const onUpdate = () => setSchedCfg(loadScheduleConfig());
    window.addEventListener("salon_config_updated", onUpdate);
    return () => window.removeEventListener("salon_config_updated", onUpdate);
  }, []);

  // Drag state
  const [dragging, setDragging]           = useState<Appointment | null>(null);
  const [dragPos, setDragPos]             = useState({ x: 0, y: 0 });
  const [dragOverEmpId, setDragOverEmpId] = useState<number | null>(null);
  const dragStartY  = useRef(0);
  const dragStartX  = useRef(0);
  const gridRef     = useRef<HTMLDivElement>(null);

  const employees = useMemo(() => employeesStore.list(true), [refreshKey]);
  const appointments = useMemo(() => appointmentsStore.list({ date: selectedDate }), [selectedDate, refreshKey]);
  const servicesData = useMemo(() => servicesStore.list(true), [refreshKey]);

  const serviceMap = useMemo(
    () => new Map(servicesData.map(s => [s.id, { color: s.color }])),
    [servicesData]
  );

  const apptsByEmployee = useMemo(() =>
    employees.reduce((acc, emp) => {
      acc[emp.id] = appointments.filter(a => a.employeeId === emp.id);
      return acc;
    }, {} as Record<number, Appointment[]>),
    [employees, appointments]
  );

  // Detect real groups (groupId appearing in 2+ appointments)
  const groupIds = useMemo(() => {
    const counts: Record<string, number> = {};
    appointments.forEach(a => {
      if (a.groupId) counts[a.groupId] = (counts[a.groupId] ?? 0) + 1;
    });
    return new Set(
      Object.entries(counts).filter(([, v]) => v > 1).map(([k]) => k)
    );
  }, [appointments]);

  const currentDate   = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const formattedDate = format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  // ── Find employee column at X ─────────────────────────────────────────────
  const getEmpAtX = useCallback((clientX: number): number | null => {
    if (!gridRef.current) return null;
    const cols = Array.from(gridRef.current.querySelectorAll<HTMLElement>("[data-emp-id]"));
    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return parseInt(cols[i].dataset.empId ?? "0", 10);
      }
    }
    return null;
  }, []);

  // ── Global pointer events while dragging ──────────────────────────────────
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      setDragOverEmpId(getEmpAtX(e.clientX));
    };

    const onUp = async (e: PointerEvent) => {
      if (!dragging) return;

      const targetEmpId = getEmpAtX(e.clientX);
      if (!targetEmpId) {
        setDragging(null);
        return;
      }

      const rect = gridRef.current?.querySelector<HTMLElement>(`[data-emp-id="${targetEmpId}"]`)?.getBoundingClientRect();
      if (!rect) {
        setDragging(null);
        return;
      }

      const y = e.clientY - rect.top;
      const totalMinutes = (y / HOUR_HEIGHT) * 60 + START_HOUR * 60;
      const snapped = snapToGrid(totalMinutes, SNAP_MINUTES);
      const hour = Math.floor(snapped / 60);
      const minute = snapped % 60;

      const newStart = new Date(currentDate);
      newStart.setHours(hour, minute, 0, 0);
      const duration = (new Date(dragging.endTime).getTime() - new Date(dragging.startTime).getTime()) / 1000 / 60;
      const newEnd = new Date(newStart.getTime() + duration * 60_000);

      // Atualiza cache local imediatamente
      appointmentsStore.updateLocal(dragging.id, {
        employeeId: targetEmpId,
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      });
      setRefreshKey(k => k + 1);

      // Persiste no Supabase em background
      try {
        await appointmentsStore.move(dragging.id, targetEmpId, newStart.toISOString(), newEnd.toISOString());
        toast.success("Agendamento reagendado!");
      } catch {
        toast.error("Erro ao mover — revertendo");
        // Reverte: restaura posição original no cache
        appointmentsStore.updateLocal(dragging.id, {
          employeeId: dragging.employeeId,
          startTime: dragging.startTime,
          endTime: dragging.endTime,
        });
        setRefreshKey(k => k + 1);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, getEmpAtX, START_HOUR, END_HOUR, SNAP_MINUTES]);

  // ── Drag start ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((appt: Appointment, y: number, x: number) => {
    setDragging(appt);
    setDragPos({ x, y });
    dragStartY.current = y;
    dragStartX.current = x;
  }, []);

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openNew = useCallback((empId: number, hour: number, minute = 0) => {
    setEditingAppt(null);
    setDefaultEmpId(empId);
    setDefaultHour(hour);
    setDefaultMinute(minute);
    setGroupClientName(undefined);
    setGroupId(undefined);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((appt: Appointment) => {
    setEditingAppt(appt);
    setGroupClientName(undefined);
    setGroupId(undefined);
    setModalOpen(true);
  }, []);

  // Called from AppointmentModal when user clicks "Adicionar outro serviço"
  const openGroupAdd = useCallback((clientName: string, existingGroupId: string) => {
    setEditingAppt(null);
    setDefaultEmpId(undefined);
    setDefaultHour(9);
    setDefaultMinute(0);
    setGroupClientName(clientName);
    setGroupId(existingGroupId);
    setRefreshKey(k => k + 1);
    setModalOpen(true);
  }, []);

  const navigateDate = (dir: number) =>
    setSelectedDate(format(dir > 0 ? addDays(currentDate, 1) : subDays(currentDate, 1), "yyyy-MM-dd"));

  const completedCount = appointments.filter(a => a.status === "completed").length;
  const [showDatePicker, setShowDatePicker] = useState(false);

  return (
    <div className="flex flex-col h-full" style={{ userSelect: dragging ? "none" : undefined }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-6 py-2 md:py-3 border-b border-border bg-card/30 backdrop-blur-sm flex-wrap">
        <div className="flex items-center gap-1 md:gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateDate(-1)} className="h-8 w-8 bg-transparent">
            <ChevronLeft className="w-3 h-3" />
          </Button>

          {/* Chip de data + ícone calendário com Popover */}
          <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
            <PopoverTrigger asChild>
              <div className="flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-lg bg-white/90 cursor-pointer hover:bg-white transition-colors">
                <span className="text-xs md:text-sm font-semibold text-gray-900 capitalize truncate max-w-[140px] md:max-w-none">
                  {formattedDate}
                </span>
                <Calendar className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-white shadow-lg" align="start">
              <div className="p-3 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-foreground">Selecionar Data</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] font-bold uppercase tracking-wider"
                    onClick={() => {
                      setSelectedDate(format(new Date(), "yyyy-MM-dd"));
                      setShowDatePicker(false);
                    }}
                  >
                    Hoje
                  </Button>
                </div>
                <CalendarUI
                  mode="single"
                  selected={parseISO(selectedDate)}
                  onSelect={(date) => {
                    if (date) {
                      const newDate = format(date, "yyyy-MM-dd");
                      setSelectedDate(newDate);
                      setShowDatePicker(false);
                    }
                  }}
                  locale={ptBR}
                  initialFocus
                  disabled={(date) => false}
                />
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="icon" onClick={() => navigateDate(1)} className="h-8 w-8 bg-transparent">
            <ChevronRight className="w-3 h-3" />
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))}
            className="text-xs h-8 hidden md:inline-flex bg-transparent"
          >
            Hoje
          </Button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} className="h-8 w-8" title="Atualizar">
            <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
          </Button>
          <Badge variant="secondary" className="text-xs hidden md:inline-flex">
            {completedCount}/{appointments.length}
          </Badge>
          <Button
            size="sm"
            onClick={() => { setEditingAppt(null); setDefaultEmpId(undefined); setGroupClientName(undefined); setGroupId(undefined); setModalOpen(true); }}
            className="gap-1 h-8 text-xs md:text-sm"
          >
            <Plus className="w-3 h-3" />
            <span className="hidden md:inline">Novo Agendamento</span>
            <span className="md:hidden">+</span>
          </Button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto" ref={gridRef}>
        <div className="flex min-w-max">

          {/* Time column — sticky left */}
          <div className="w-10 md:w-14 flex-shrink-0 sticky left-0 bg-background z-20 border-r border-border">
            <div className="h-10 md:h-12 border-b border-border sticky top-0 bg-background z-20" />
            <div style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px`, position: "relative" }}>
              {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                <div key={i} className="absolute w-full flex justify-end pr-1 md:pr-2"
                  style={{ top: `${i * HOUR_HEIGHT - 8}px` }}>
                  <span className="text-xs text-muted-foreground">
                    {String(START_HOUR + i).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Employee columns */}
          {employees.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-12 text-muted-foreground">
              <div className="text-center">
                <p className="text-lg font-medium mb-1">Nenhum funcionário cadastrado</p>
                <p className="text-sm">Cadastre funcionários para visualizar a agenda</p>
              </div>
            </div>
          ) : (
            employees.map(emp => (
              <div key={emp.id} className="flex-shrink-0" style={{ width: `${MIN_COL_WIDTH}px` }}>
                {/* Employee header — sticky top */}
                <div className="h-10 md:h-12 border-b border-border flex items-center justify-center gap-1.5 px-2 sticky top-0 bg-card/80 backdrop-blur-sm z-20">
                  {/* Avatar: foto se disponível, senão inicial */}
                  <div
                    style={{
                      width: 26, height: 26,
                      borderRadius: "50%",
                      backgroundColor: emp.color,
                      boxShadow: `0 0 0 2px ${emp.color}44`,
                      flexShrink: 0,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {emp.photoUrl
                      ? <img src={emp.photoUrl} alt={emp.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : emp.name.charAt(0).toUpperCase()
                    }
                  </div>
                  <span className="text-xs md:text-sm font-bold text-white uppercase tracking-wide truncate">{emp.name.split(" ")[0]}</span>
                </div>

                {/* Droppable zone wrapper — identified by data-emp-id */}
                <div data-emp-id={emp.id}>
                  <EmployeeColumn
                    employee={emp}
                    appointments={apptsByEmployee[emp.id] ?? []}
                    serviceMap={serviceMap}
                    groupIds={groupIds}
                    isDragOver={dragOverEmpId === emp.id}
                    onColumnClick={openNew}
                    onAppointmentClick={openEdit}
                    onDragStart={handleDragStart}
                    startHour={START_HOUR}
                    totalHours={TOTAL_HOURS}
                    snapMinutes={SNAP_MINUTES}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Drag ghost follows pointer ── */}
      {dragging && <DragGhost appt={dragging} x={dragPos.x} y={dragPos.y} />}

      {/* ── Modal ── */}
      <AppointmentModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingAppt(null); }}
        appointment={editingAppt}
        defaultEmployeeId={defaultEmpId}
        defaultHour={defaultHour}
        defaultMinute={defaultMinute}
        selectedDate={selectedDate}
        groupClientName={groupClientName}
        groupId={groupId}
        onSuccess={() => {
          setRefreshKey(k => k + 1);
          setModalOpen(false);
          setEditingAppt(null);
        }}
        onAddGroupService={openGroupAdd}
      />
    </div>
  );
}
