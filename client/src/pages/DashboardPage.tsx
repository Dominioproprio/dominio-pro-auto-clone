/**
 * DashboardPage â€” VisÃ£o geral do dia com mÃ©tricas e acesso rÃ¡pido.
 * DomÃ­nio Pro â€” design glassmorphism 2026.
 */
import { useState, useEffect, useMemo } from "react";
import { format, isToday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation } from "wouter";
import {
  employeesStore, servicesStore, clientsStore,
  appointmentsStore, cashSessionsStore, fetchAllData,
  type Appointment,
} from "@/lib/store";
import {
  Calendar, Users, DollarSign, TrendingUp, Clock,
  CheckCircle, AlertCircle, UserCheck, Scissors,
  ChevronRight, ArrowUp, Zap,
} from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  scheduled:   { label: "Agendado",      color: "#3b82f6" },
  confirmed:   { label: "Confirmado",    color: "#10b981" },
  in_progress: { label: "Em andamento",  color: "#f59e0b" },
  completed:   { label: "ConcluÃ­do",     color: "#22c55e" },
  cancelled:   { label: "Cancelado",     color: "#ef4444" },
  no_show:     { label: "NÃ£o compareceu",color: "#6b7280" },
};

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

function getAccent(): string {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function MetricCard({ icon: Icon, label, value, sub, color, onClick }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; onClick?: () => void;
}) {
  return (
    <div onClick={onClick}
      className={`rounded-2xl p-4 flex flex-col gap-3 transition-all duration-200 ${onClick ? "cursor-pointer active:scale-95 hover:brightness-110" : ""}`}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
      }}>
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {onClick && <ChevronRight className="w-4 h-4 text-white/20" />}
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-white/50 mt-0.5">{label}</p>
        {sub && <p className="text-xs mt-1" style={{ color }}>{sub}</p>}
      </div>
    </div>
  );
}

function ApptCard({ appt, employees, accent }: {
  appt: Appointment;
  employees: ReturnType<typeof employeesStore.list>;
  accent: string;
}) {
  const emp = employees.find(e => e.id === appt.employeeId);
  const st = STATUS_LABEL[appt.status] ?? STATUS_LABEL.scheduled;
  const start = new Date(appt.startTime);
  const end = new Date(appt.endTime);

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl transition-all"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Avatar funcionÃ¡rio */}
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
        style={{ backgroundColor: emp?.color || accent }}>
        {emp?.photoUrl
          ? <img src={emp.photoUrl} alt="" className="w-full h-full object-cover rounded-xl" />
          : emp?.name.charAt(0).toUpperCase() || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{appt.clientName || "Sem nome"}</p>
        <p className="text-xs text-white/40 truncate">
          {format(start, "HH:mm")}â€“{format(end, "HH:mm")} Â· {emp?.name.split(" ")[0] || "â€”"}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${st.color}20`, color: st.color }}>
          {st.label}
        </span>
        {appt.totalPrice != null && (
          <span className="text-xs font-bold" style={{ color: accent }}>
            R$ {appt.totalPrice.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const accent = getAccent();
  const today = format(new Date(), "yyyy-MM-dd");
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();

  useEffect(() => {
    fetchAllData().then(() => {
      setRefreshKey(k => k + 1);
      setLoading(false);
    });
    const onUpdate = () => setRefreshKey(k => k + 1);
    const onAutoLaunch = () => setRefreshKey(k => k + 1);
    window.addEventListener("store_updated", onUpdate);
    window.addEventListener("cash_entry_auto_launched", onAutoLaunch);
    return () => {
      window.removeEventListener("store_updated", onUpdate);
      window.removeEventListener("cash_entry_auto_launched", onAutoLaunch);
    };
  }, []);

  const employees   = useMemo(() => employeesStore.list(true), [refreshKey]);
  const apptToday   = useMemo(() => appointmentsStore.list({ date: today }), [refreshKey, today]);
  const allClients  = useMemo(() => clientsStore.list(), [refreshKey]);
  const cashSession = useMemo(() => cashSessionsStore.list().find(s => s.status === "open"), [refreshKey]);

  const totalHoje      = apptToday.length;
  const concluidos     = apptToday.filter(a => a.status === "completed").length;
  const pendentes      = apptToday.filter(a => ["scheduled","confirmed"].includes(a.status)).length;
  const faturamentoHoje = apptToday
    .filter(a => a.status === "completed" && toNum(a.totalPrice) > 0.01)
    .reduce((s, a) => s + (a.totalPrice || 0), 0);

  // PrÃ³ximos agendamentos
  const agora = new Date();
  const proximos = apptToday
    .filter(a => new Date(a.startTime) >= agora && a.status !== "cancelled")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5);

  // Em andamento agora
  const emAndamento = apptToday.filter(a => {
    const s = new Date(a.startTime);
    const e = new Date(a.endTime);
    return agora >= s && agora <= e;
  });

  const salonName = (() => {
    try {
      const s = localStorage.getItem("salon_config");
      if (s) return JSON.parse(s).salonName || "DomÃ­nio Pro";
    } catch { /* ignore */ }
    return "DomÃ­nio Pro";
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: accent, borderTopColor: "transparent" }} />
          <p className="text-sm text-white/40">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 animate-slide-up">

      {/* SaudaÃ§Ã£o v2.0 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/40">{greeting} ðŸ‘‹</p>
          <h1 className="text-xl font-bold text-gradient mt-0.5">{salonName}</h1>
          <p className="text-xs text-white/30 mt-0.5 capitalize">
            {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cashSession && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{ background: "#22c55e18", color: "#22c55e", border: "1px solid #22c55e30" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Caixa aberto
            </div>
          )}
          <div className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
            style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}25` }}>
            v2.0
          </div>
        </div>
      </div>

      {/* MÃ©tricas do dia */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={Calendar} label="Agendamentos hoje" value={totalHoje}
          sub={`${pendentes} pendentes`} color={accent}
          onClick={() => setLocation("/agenda")} />
        <MetricCard icon={CheckCircle} label="ConcluÃ­dos" value={concluidos}
          sub={totalHoje > 0 ? `${Math.round(concluidos/totalHoje*100)}% do dia` : "â€”"}
          color="#22c55e" />
        <MetricCard icon={DollarSign} label="Faturamento hoje" value={`R$ ${faturamentoHoje.toFixed(0)}`}
          sub="serviÃ§os concluÃ­dos" color="#f59e0b"
          onClick={() => setLocation("/caixa")} />
        <MetricCard icon={Users} label="Clientes" value={allClients.length}
          sub="cadastrados" color="#3b82f6"
          onClick={() => setLocation("/clientes")} />
      </div>

      {/* Em andamento agora */}
      {emAndamento.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3"
          style={{
            background: `linear-gradient(135deg, ${accent}15, ${accent}05)`,
            border: `1px solid ${accent}30`,
          }}>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: accent }} />
            <p className="text-sm font-semibold text-white">Acontecendo agora</p>
          </div>
          <div className="space-y-2">
            {emAndamento.map(a => (
              <ApptCard key={a.id} appt={a} employees={employees} accent={accent} />
            ))}
          </div>
        </div>
      )}

      {/* FuncionÃ¡rios â€” status */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white/70">Equipe hoje</p>
          <button onClick={() => setLocation("/funcionarios")}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: accent }}>
            Ver todos â†’
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {employees.map(emp => {
            const empAppts = apptToday.filter(a => a.employeeId === emp.id);
            const empNow = empAppts.find(a => {
              const s = new Date(a.startTime);
              const e = new Date(a.endTime);
              return agora >= s && agora <= e;
            });
            const next = empAppts
              .filter(a => new Date(a.startTime) > agora && a.status !== "cancelled")
              .sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

            return (
              <div key={emp.id} className="flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[90px]"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                {/* Avatar */}
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-base font-bold text-white overflow-hidden"
                    style={{ backgroundColor: emp.color }}>
                    {emp.photoUrl
                      ? <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                      : emp.name.charAt(0).toUpperCase()}
                  </div>
                  {/* Status dot */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                    style={{
                      borderColor: "rgba(10,10,18,0.9)",
                      backgroundColor: empNow ? "#f59e0b" : empAppts.length > 0 ? "#22c55e" : "#6b7280",
                    }} />
                </div>
                <p className="text-xs font-semibold text-white truncate max-w-[80px] text-center">
                  {emp.name.split(" ")[0]}
                </p>
                <p className="text-[10px] text-center"
                  style={{ color: empNow ? "#f59e0b" : "rgba(255,255,255,0.35)" }}>
                  {empNow ? "Ocupado" : next ? format(new Date(next.startTime), "HH:mm") : "Livre"}
                </p>
                <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: `${emp.color}20`, color: emp.color }}>
                  {empAppts.filter(a => a.status !== "cancelled").length} hoje
                </div>
              </div>
            );
          })}
          {employees.length === 0 && (
            <p className="text-xs text-white/30 py-4">Nenhum funcionÃ¡rio cadastrado</p>
          )}
        </div>
      </div>

      {/* PrÃ³ximos agendamentos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white/70">PrÃ³ximos agendamentos</p>
          <button onClick={() => setLocation("/agenda")}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: accent }}>
            Ver agenda â†’
          </button>
        </div>
        {proximos.length > 0 ? (
          <div className="space-y-2">
            {proximos.map(a => (
              <ApptCard key={a.id} appt={a} employees={employees} accent={accent} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <Calendar className="w-8 h-8 text-white/15 mb-2" />
            <p className="text-sm text-white/30">Nenhum agendamento pendente hoje</p>
          </div>
        )}
      </div>

      {/* Acesso rÃ¡pido */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Clientes",      icon: Users,      path: "/clientes",     color: "#3b82f6" },
          { label: "ServiÃ§os",      icon: Scissors,   path: "/servicos",     color: "#8b5cf6" },
          { label: "RelatÃ³rios",    icon: TrendingUp, path: "/relatorios",   color: "#f59e0b" },
        ].map(({ label, icon: Icon, path, color }) => (
          <button key={path} onClick={() => setLocation(path)}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all active:scale-95 hover:brightness-110"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${color}18`, border: `1px solid ${color}25` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <span className="text-xs font-medium text-white/60">{label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}

