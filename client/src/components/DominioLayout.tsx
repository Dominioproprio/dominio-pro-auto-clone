/**
 * DominioLayout — Layout principal do Domínio Pro.
 * Mobile: bottom navigation + topbar.
 * Desktop: sidebar elegante à esquerda.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getSession, clearSession, MENU_VISIBILITY, isAccessControlEnabled } from "@/lib/access";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Calendar, Users, UserCheck, Scissors, DollarSign,
  BarChart2, Settings, History, Database, Menu, X,
  Sun, Moon, Plus, ChevronRight, Wrench,
  CalendarCheck, LogOut,
} from "lucide-react";

// ─── Navegação ────────────────────────────────────────────
const PRIMARY_NAV = [
  { path: "/dashboard", label: "Início",      icon: BarChart2  },
  { path: "/agenda",    label: "Agenda",      icon: Calendar   },
  { path: "/clientes",  label: "Clientes",    icon: Users      },
  { path: "/caixa",     label: "Caixa",       icon: DollarSign },
];

const SECONDARY_NAV = [
  { path: "/funcionarios",          label: "Funcionários",  icon: UserCheck   },
  { path: "/servicos",              label: "Serviços",      icon: Scissors    },
  { path: "/ferramentas-clientes",  label: "Ferramentas",   icon: Wrench      },
  { path: "/caixa/dashboard",       label: "Dashboard $",   icon: BarChart2   },
  { path: "/relatorios",            label: "Relatórios",    icon: BarChart2   },
  { path: "/historico",             label: "Histórico",     icon: History     },
  { path: "/historico/agendamentos",label: "Agendamentos",  icon: CalendarCheck },
  { path: "/backup",                label: "Backup",        icon: Database    },
  { path: "/configuracoes",         label: "Configurações", icon: Settings    },
];

function loadBranding() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) {
      const p = JSON.parse(s);
      return { name: p.salonName || "Domínio Pro", logo: p.logoUrl || "" };
    }
  } catch { /* ignore */ }
  return { name: "Domínio Pro", logo: "" };
}

function loadBackground(): React.CSSProperties {
  try {
    const s = localStorage.getItem("salon_config");
    if (!s) return {};
    const c = JSON.parse(s);
    if (c.bgType === "solid" && c.bgColor) return { backgroundColor: c.bgColor };
    if (c.bgType === "gradient" && c.bgGradientFrom && c.bgGradientTo)
      return { background: `linear-gradient(${c.bgGradientDir || "135deg"}, ${c.bgGradientFrom}, ${c.bgGradientTo})` };
    if (c.bgType === "image" && c.bgImageUrl)
      return { backgroundImage: `url(${c.bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  } catch { /* ignore */ }
  return {};
}

export const THEME_PALETTES = [
  { id: "rosa-neon", name: "Rosa Neon", accent: "#ec4899", bg: "#0d0d14", surface: "rgba(15,15,28,0.95)", card: "rgba(20,20,35,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "roxo-galaxy", name: "Roxo Galaxy", accent: "#8b5cf6", bg: "#0c0818", surface: "rgba(14,10,28,0.95)", card: "rgba(20,15,40,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "esmeralda-dark", name: "Esmeralda Noturno", accent: "#10b981", bg: "#060f0c", surface: "rgba(8,18,14,0.95)", card: "rgba(10,24,18,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "dourado", name: "Dourado Premium", accent: "#f59e0b", bg: "#0e0c08", surface: "rgba(18,14,8,0.95)", card: "rgba(24,18,10,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "azul-oceano", name: "Azul Oceano", accent: "#0ea5e9", bg: "#060d18", surface: "rgba(8,16,30,0.95)", card: "rgba(10,22,40,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "coral-dark", name: "Coral Sunset", accent: "#f97316", bg: "#0f0808", surface: "rgba(20,10,10,0.95)", card: "rgba(28,14,14,0.9)", border: "rgba(255,255,255,0.07)", dark: true, textColor: "#ffffff", textMuted: "rgba(255,255,255,0.45)" },
  { id: "verde-pastel", name: "Verde Pastel", accent: "#3d6b47", bg: "#d6e8d0", surface: "rgba(210,232,204,0.97)", card: "rgba(224,240,218,0.97)", border: "rgba(61,107,71,0.15)", dark: false, textColor: "#1e3a22", textMuted: "rgba(30,58,34,0.5)" },
  { id: "azul-pastel", name: "Azul Céu", accent: "#2563a8", bg: "#cfe0f5", surface: "rgba(208,226,245,0.97)", card: "rgba(220,234,248,0.97)", border: "rgba(37,99,168,0.15)", dark: false, textColor: "#0f2a4a", textMuted: "rgba(15,42,74,0.5)" },
  { id: "lilas-pastel", name: "Lilás Suave", accent: "#6d3fa0", bg: "#e8d8f5", surface: "rgba(232,218,245,0.97)", card: "rgba(240,228,250,0.97)", border: "rgba(109,63,160,0.15)", dark: false, textColor: "#2e1250", textMuted: "rgba(46,18,80,0.5)" },
  { id: "rosa-pastel", name: "Rosa Suave", accent: "#b5376b", bg: "#f5d6e4", surface: "rgba(245,214,228,0.97)", card: "rgba(250,226,238,0.97)", border: "rgba(181,55,107,0.15)", dark: false, textColor: "#4a0f26", textMuted: "rgba(74,15,38,0.5)" },
  { id: "areia", name: "Areia & Caramelo", accent: "#92470a", bg: "#f0e0c8", surface: "rgba(240,224,200,0.97)", card: "rgba(248,234,214,0.97)", border: "rgba(146,71,10,0.15)", dark: false, textColor: "#3a1c06", textMuted: "rgba(58,28,6,0.5)" },
  { id: "branco-minimal", name: "Branco Minimal", accent: "#ec4899", bg: "#f4f4f8", surface: "rgba(255,255,255,0.97)", card: "rgba(255,255,255,0.97)", border: "rgba(0,0,0,0.08)", dark: false, textColor: "#111128", textMuted: "rgba(17,17,40,0.45)" },
];

function loadPalette() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) {
      const c = JSON.parse(s);
      if (c.themeId) return THEME_PALETTES.find(p => p.id === c.themeId) ?? THEME_PALETTES[0];
    }
  } catch { /* ignore */ }
  return THEME_PALETTES[0];
}

function getAccent(): string {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function BrandLogo({ size = 48 }: { size?: number }) {
  const branding = loadBranding();
  const accent = getAccent();
  if (branding.logo) return <img src={branding.logo} alt="logo" style={{ width: size, height: size, objectFit: "contain", borderRadius: size * 0.2 }} />;
  return <div style={{ width: size, height: size, borderRadius: size * 0.22, background: `linear-gradient(135deg, ${accent}40, ${accent}15)`, border: `1.5px solid ${accent}50`, boxShadow: `0 4px 20px ${accent}30`, display: "flex", alignItems: "center", justifyContent: "center" }}><Scissors style={{ width: size * 0.42, height: size * 0.42, color: accent }} /></div>;
}

export default function DominioLayout({ children, onNewAppt }: { children: React.ReactNode; onNewAppt?: () => void; }) {
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme, switchable } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [branding, setBranding] = useState(loadBranding);
  const [bgStyle, setBgStyle] = useState(loadBackground);
  const [accent, setAccent] = useState(getAccent);
  const [palette, setPalette] = useState(loadPalette);

  const session = getSession();
  const role = session?.role ?? "owner";
  const menuVis = MENU_VISIBILITY[role];
  const accessEnabled = isAccessControlEnabled();

  const visiblePrimaryNav = PRIMARY_NAV.filter(n => {
    const key = n.path.replace("/", "") || "dashboard";
    return menuVis[key] !== false;
  });
  const visibleSecondaryNav = SECONDARY_NAV.filter(n => {
    const key = n.path.replace("/", "").split("/")[0];
    const keyMap: Record<string,string> = { "funcionarios": "funcionarios", "servicos": "servicos", "ferramentas-clientes": "ferramentas", "caixa": "caixa", "relatorios": "relatorios", "historico": "historico", "backup": "backup", "configuracoes": "configuracoes" };
    return menuVis[keyMap[key] ?? key] !== false;
  });

  useEffect(() => {
    const onUpdate = () => { setBranding(loadBranding()); setBgStyle(loadBackground()); setAccent(getAccent()); setPalette(loadPalette()); };
    window.addEventListener("salon_config_updated", onUpdate);
    return () => window.removeEventListener("salon_config_updated", onUpdate);
  }, []);

  const navigate = (path: string) => { setLocation(path); setSidebarOpen(false); };
  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  return (
    <div className="flex h-screen overflow-hidden" style={Object.keys(bgStyle).length > 0 ? bgStyle : { backgroundColor: palette.bg }}>
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={cn("fixed md:relative z-50 flex flex-col h-full transition-transform duration-300 ease-out w-64", sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")} style={{ background: palette.surface, backdropFilter: "blur(32px)", borderRight: `1px solid ${palette.border}` }}>
        <div className="flex flex-col items-center pt-7 pb-5 px-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="relative mb-3"><BrandLogo size={72} /></div>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.15em", textTransform: "uppercase", color: palette.textColor, textShadow: `0 0 20px ${accent}80`, textAlign: "center", lineHeight: 1.2 }}>{branding.name}</p>
          <p style={{ fontSize: 10, color: palette.textMuted, letterSpacing: "0.25em", marginTop: 3 }}>PRO</p>
          <button className="md:hidden absolute top-4 right-4 text-white/30" onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <p style={{ fontSize: 10, color: palette.textMuted, letterSpacing: "0.2em", padding: "0 8px 8px" }}>PRINCIPAL</p>
          {visiblePrimaryNav.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <button key={path} onClick={() => navigate(path)} className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200", active ? "" : "hover:bg-black/5")} style={active ? { background: `linear-gradient(135deg, ${accent}25, ${accent}10)`, border: `1px solid ${accent}30`, boxShadow: `0 2px 12px ${accent}20`, color: palette.textColor } : { color: palette.textMuted }}>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", active ? "" : "bg-white/5")} style={active ? { background: `linear-gradient(135deg, ${accent}40, ${accent}20)` } : {}}><Icon className="w-4 h-4" style={active ? { color: accent } : {}} /></div>
                <span className="flex-1 text-left">{label}</span>
                {active && <ChevronRight className="w-3.5 h-3.5 opacity-50" style={{ color: accent }} />}
              </button>
            );
          })}
          <div className="pt-4">
            <p style={{ fontSize: 10, color: palette.textMuted, letterSpacing: "0.2em", padding: "0 8px 8px" }}>GESTÃO</p>
            {visibleSecondaryNav.map(({ path, label, icon: Icon }) => {
              const active = isActive(path);
              return (
                <button key={path} onClick={() => navigate(path)} className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200", active ? "" : "hover:bg-black/5")} style={active ? { background: `linear-gradient(135deg, ${accent}20, ${accent}08)`, border: `1px solid ${accent}25`, color: palette.textColor } : { color: palette.textMuted }}>
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" style={active ? { color: accent } : {}} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className="px-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {switchable && <button onClick={toggleTheme} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/30 hover:text-white/60 hover:bg-white/5">{theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}<span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span></button>}
          {accessEnabled && session && <button onClick={() => { clearSession(); window.location.reload(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/5 mb-1" style={{ color: palette.textMuted }}><LogOut className="w-3.5 h-3.5" /><span>Sair ({session.profileName})</span></button>}
          <p style={{ fontSize: 10, color: palette.textMuted, textAlign: "center", marginTop: 8 }}>Domínio Pro v2.0</p>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex-shrink-0 flex items-center gap-3 px-4 py-3" style={{ background: palette.surface.replace("0.95", "0.80"), backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => setSidebarOpen(true)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-white/50"><Menu className="w-5 h-5" /></button>
          <div className="md:hidden flex items-center gap-2.5 flex-1"><BrandLogo size={28} /><span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.15em", textTransform: "uppercase", color: palette.textColor, textShadow: `0 0 12px ${accent}80` }}>{branding.name}</span></div>
          <div className="hidden md:flex items-center gap-2 flex-1">{(() => { const all = [...PRIMARY_NAV, ...SECONDARY_NAV]; const cur = all.find(n => isActive(n.path)); const Icon = cur?.icon; return cur ? <div className="flex items-center gap-2">{Icon && <Icon className="w-4 h-4" style={{ color: accent }} />}<span className="text-sm font-semibold" style={{ color: palette.textMuted }}>{cur.label}</span></div> : null; })()}</div>
          <div className="flex items-center gap-2 ml-auto">{onNewAppt && <button onClick={onNewAppt} className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 4px 16px ${accent}40` }}><Plus className="w-4 h-4" />Novo Agendamento</button>}</div>
        </header>
        <main className="flex-1 overflow-auto pb-20 md:pb-0">{children}</main>
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 pb-safe" style={{ background: palette.surface, backdropFilter: "blur(32px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-around px-2 py-2">
            {visiblePrimaryNav.map(({ path, label, icon: Icon }) => {
              const active = isActive(path);
              return <button key={path} onClick={() => navigate(path)} className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition-all" style={active ? { background: `${accent}18`, color: accent } : { color: palette.textMuted }}><div className="relative"><Icon className="w-5 h-5" style={{ color: active ? accent : "rgba(255,255,255,0.35)" }} />{active && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: accent }} />}</div><span className="text-[10px] font-medium">{label}</span></button>;
            })}
            <button onClick={() => setSidebarOpen(true)} className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition-all"><Menu className="w-5 h-5" style={{ color: "rgba(255,255,255,0.35)" }} /><span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.35)" }}>Menu</span></button>
          </div>
        </nav>
        {onNewAppt && <button onClick={onNewAppt} className="md:hidden fixed bottom-20 right-5 z-30 w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 8px 32px ${accent}60` }}><Plus className="w-6 h-6 text-white" /></button>}
      </div>
    </div>
  );
}

