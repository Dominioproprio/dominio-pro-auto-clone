/**
 * DashboardPage — Visão geral do dia.
 * Fonte de verdade: agendamentos.
 */
import { useState, useEffect, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation } from "wouter";
import { employeesStore, clientsStore, appointmentsStore, cashSessionsStore, fetchAllData, type Appointment } from "@/lib/store";
import { calcPeriodStats, calcRevenueByEmployee, getPeriodDates, getAppointmentsInPeriod } from "@/lib/analytics";
import { Calendar, Users, DollarSign, TrendingUp, CheckCircle, Zap, ChevronRight, Scissors } from "lucide-react";

function getAccent() {
  try { const s = localStorage.getItem("salon_config"); if (s) return JSON.parse(s).accentColor || "#ec4899"; } catch {}
  return "#ec4899";
}
function getSalonName() {
  try { const s = localStorage.getItem("salon_config"); if (s) return JSON.parse(s).salonName || "Domínio Pro"; } catch {}
  return "Domínio Pro";
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  scheduled:   { label: "Agendado",       color: "#3b82f6" },
  confirmed:   { label: "Confirmado",     color: "#10b981" },
  in_progress: { label: "Em andamento",   color: "#f59e0b" },
  completed:   { label: "Concluído",      color: "#22c55e" },
  cancelled:   { label: "Cancelado",      color: "#ef4444" },
  no_show:     { label: "Não compareceu", color: "#6b7280" },
};

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const accent = getAccent();
  const salonName = getSalonName();
  const today = format(new Date(), "yyyy-MM-dd");
  const agora = new Date();

  const greeting = (() => {
    const h = agora.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();

  useEffect(() => {
    fetchAllData().then(() => { setRefreshKey(k => k + 1); setLoading(false); });
    const upd = () => setRefreshKey(k => k + 1);
    ["store_updated", "cash_entry_auto_launched", "clients_updated"].forEach(e => window.addEventListener(e, upd));
    return () => ["store_updated", "cash_entry_auto_launched", "clients_updated"].forEach(e => window.removeEventListener(e, upd));
  }, []);

  const employees   = useMemo(() => employeesStore.list(true),  [refreshKey]);
  const allClients  = useMemo(() => clientsStore.list(),        [refreshKey]);
  const cashSession = useMemo(() => cashSessionsStore.list().find(s => s.status === "open"), [refreshKey]);
  const apptToday   = useMemo(() => appointmentsStore.list({ date: today }), [refreshKey, today]);

  // Stats do dia usando analytics
  const { start: dStart, end: dEnd } = getPeriodDates("hoje");
  const statsHoje = useMemo(() => {
    const appts = getAppointmentsInPeriod(dStart, dEnd);
    return calcPeriodStats(appts, employees);
  }, [refreshKey, employees]);

  // Ranking rápido do dia
  const rankingHoje = useMemo(() => {
    const appts = getAppointmentsInPeriod(dStart, dEnd);
    return calcRevenueByEmployee(appts, employees).slice(0, 3);
  }, [refreshKey, employees]);

  // Em andamento agora
  const emAndamento = useMemo(() =>
    apptToday.filter(a => agora >= new Date(a.startTime) && agora <= new Date(a.endTime)),
  [apptToday]);

  // Próximos
  const proximos = useMemo(() =>
    apptToday
      .filter(a => new Date(a.startTime) > agora && !["cancelled", "no_show"].includes(a.status))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5),
  [apptToday]);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accent, borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{greeting} 👋</p>
          <h1 className="text-xl font-bold text-gradient mt-0.5">{salonName}</h1>
          <p className="text-xs mt-0.5 capitalize" style={{ color: "rgba(255,255,255,0.3)" }}>
            {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {cashSession ? (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{ background: "#22c55e18", color: "#22c55e", border: "1px solid #22c55e30" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Caixa aberto
            </span>
          ) : (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
              Caixa fechado
            </span>
          )}
        </div>
      </div>

      {/* KPIs do dia — fonte: agendamentos */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Calendar,   label: "Agendamentos",  value: apptToday.filter(a => !["cancelled","no_show"].includes(a.status)).length, sub: `${statsHoje.scheduledCount} pendentes`, color: accent, path: "/agenda" },
          { icon: DollarSign, label: "Faturamento",   value: `R$ ${statsHoje.totalRevenue.toFixed(0)}`, sub: `líq. R$ ${statsHoje.netRevenue.toFixed(0)}`, color: "#22c55e", path: "/caixa" },
          { icon: CheckCircle,label: "Concluídos",    value: statsHoje.count, sub: statsHoje.count > 0 ? `tm. R$ ${statsHoje.avgTicket.toFixed(0)}` : "—", color: "#10b981", path: "/agenda" },
          { icon: Users,      label: "Clientes",      value: allClients.length, sub: "cadastrados", color: "#3b82f6", path: "/clientes" },
        ].map(({ icon: Icon, label, value, sub, color, path }) => (
          <button key={label} onClick={() => setLocation(path)}
            className="rounded-2xl p-4 flex flex-col gap-2 text-left transition-all active:scale-95 hover:brightness-110"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
                <Icon className="w-4.5 h-4.5" style={{ color, width: 18, height: 18 }} />
              </div>
              <ChevronRight style={{ color: "rgba(255,255,255,0.2)", width: 14, height: 14 }} />
            </div>
            <div>
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</p>
              {sub && <p className="text-[10px] mt-0.5" style={{ color }}>{sub}</p>}
            </div>
          </button>
        ))}
      </div>

      {/* Resumo financeiro do dia */}
      {statsHoje.totalRevenue > 0 && (
        <div className="rounded-2xl p-4 space-y-2.5"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>RESUMO FINANCEIRO — HOJE</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-base font-bold" style={{ color: accent }}>R$ {statsHoje.totalRevenue.toFixed(0)}</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Faturamento</p>
            </div>
            <div>
              <p className="text-base font-bold text-red-400">-R$ {statsHoje.totalCommissions.toFixed(0)}</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Comissões</p>
            </div>
            <div>
              <p className="text-base font-bold text-emerald-400">R$ {statsHoje.netRevenue.toFixed(0)}</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Líquido</p>
            </div>
          </div>
        </div>
      )}

      {/* Em andamento */}
      {emAndamento.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3"
          style={{ background: `linear-gradient(135deg, ${accent}15, ${accent}05)`, border: `1px solid ${accent}30` }}>
          <div className="flex items-center gap-2">
            <Zap style={{ color: accent, width: 15, height: 15 }} />
            <p className="text-sm font-semibold text-white">Acontecendo agora</p>
          </div>
          {emAndamento.map(a => {
            const emp = employees.find(e => e.id === a.employeeId);
            return (
              <div key={a.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white overflow-hidden flex-shrink-0"
                  style={{ backgroundColor: emp?.color || accent }}>
                  {emp?.photoUrl ? <img src={emp.photoUrl} alt="" className="w-full h-full object-cover" /> : emp?.name.charAt(0) || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{a.clientName}</p>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {a.services?.map(s => s.name).join(", ") || "Serviço"} · {emp?.name.split(" ")[0]}
                  </p>
                </div>
                {a.totalPrice != null && (
                  <span className="text-sm font-bold flex-shrink-0" style={{ color: accent }}>R$ {a.totalPrice.toFixed(0)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Equipe hoje */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Equipe hoje</p>
          <button onClick={() => setLocation("/funcionarios")} className="text-xs" style={{ color: accent }}>Ver todos →</button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
          {employees.map(emp => {
            const empAppts = apptToday.filter(a => a.employeeId === emp.id && !["cancelled","no_show"].includes(a.status));
            const empNow   = empAppts.find(a => agora >= new Date(a.startTime) && agora <= new Date(a.endTime));
            const next     = empAppts.filter(a => new Date(a.startTime) > agora)[0];
            const empRev   = rankingHoje.find(r => r.id === emp.id);
            return (
              <div key={emp.id} className="flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[88px]"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="relative">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white overflow-hidden"
                    style={{ backgroundColor: emp.color }}>
                    {emp.photoUrl ? <img src={emp.photoUrl} alt="" className="w-full h-full object-cover" /> : emp.name.charAt(0)}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                    style={{ borderColor: "rgba(10,10,18,0.9)", backgroundColor: empNow ? "#f59e0b" : empAppts.length > 0 ? "#22c55e" : "#6b7280" }} />
                </div>
                <p className="text-xs font-semibold text-white truncate max-w-[76px] text-center">{emp.name.split(" ")[0]}</p>
                <p className="text-[10px] text-center" style={{ color: empNow ? "#f59e0b" : "rgba(255,255,255,0.35)" }}>
                  {empNow ? "Ocupado" : next ? format(new Date(next.startTime), "HH:mm") : "Livre"}
                </p>
                {empRev && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${emp.color}20`, color: emp.color }}>
                    R$ {empRev.revenue.toFixed(0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Próximos agendamentos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Próximos agendamentos</p>
          <button onClick={() => setLocation("/agenda")} className="text-xs" style={{ color: accent }}>Ver agenda →</button>
        </div>
        {proximos.length > 0 ? (
          <div className="space-y-2">
            {proximos.map(a => {
              const emp = employees.find(e => e.id === a.employeeId);
              const st  = STATUS_LABEL[a.status] ?? STATUS_LABEL.scheduled;
              return (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white overflow-hidden flex-shrink-0"
                    style={{ backgroundColor: emp?.color || accent }}>
                    {emp?.photoUrl ? <img src={emp.photoUrl} alt="" className="w-full h-full object-cover" /> : emp?.name.charAt(0) || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.clientName || "Sem nome"}</p>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {format(new Date(a.startTime), "HH:mm")} · {emp?.name.split(" ")[0] || "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${st.color}20`, color: st.color }}>{st.label}</span>
                    {a.totalPrice != null && (
                      <span className="text-xs font-bold" style={{ color: accent }}>R$ {a.totalPrice.toFixed(0)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <Calendar style={{ color: "rgba(255,255,255,0.15)", width: 28, height: 28, marginBottom: 8 }} />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Nenhum agendamento pendente hoje</p>
          </div>
        )}
      </div>

      {/* Acesso rápido */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Clientes",   icon: Users,      path: "/clientes",   color: "#3b82f6" },
          { label: "Serviços",   icon: Scissors,   path: "/servicos",   color: "#8b5cf6" },
          { label: "Relatórios", icon: TrendingUp, path: "/relatorios", color: "#f59e0b" },
        ].map(({ label, icon: Icon, path, color }) => (
          <button key={path} onClick={() => setLocation(path)}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all active:scale-95"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: `${color}18`, border: `1px solid ${color}25` }}>
              <Icon style={{ color, width: 18, height: 18 }} />
            </div>
            <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>{label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
