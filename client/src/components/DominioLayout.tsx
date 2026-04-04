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

// ─── Helpers ──────────────────────────────────────────────
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
    if (c.bgType === "solid" && c.bgColor)
      return { backgroundColor: c.bgColor };
    if (c.bgType === "gradient" && c.bgGradientFrom && c.bgGradientTo)
      return { background: `linear-gradient(${c.bgGradientDir || "135deg"}, ${c.bgGradientFrom}, ${c.bgGradientTo})` };
    if (c.bgType === "image" && c.bgImageUrl)
      return { backgroundImage: `url(${c.bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  } catch { /* ignore */ }
  return {};
}

// ─── Paletas de tema ─────────────────────────────────────
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
  if (branding.logo) {
    return (
      <img src={branding.logo} alt="logo"
        style={{ width: size, height: size, objectFit: "contain", borderRadius: size * 0.2 }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.22,
      background: `linear-gradient(135deg, ${accent}40, ${accent}15)`,
      border: `1.5px solid ${accent}50`,
      boxShadow: `0 4px 20px ${accent}30`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <Scissors style={{ width: size * 0.42, height: size * 0.42, color: accent }} />
    </div>
  );
}

export default function DominioLayout({ children, onNewAppt }: {
  children: React.ReactNode;
  onNewAppt?: () => void;
}) {
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
    const keyMap: Record<string,string> = {
      "funcionarios": "funcionarios", "servicos": "servicos",
      "ferramentas-clientes": "ferramentas", "caixa": "caixa",
      "relatorios": "relatorios", "historico": "historico",
      "backup": "backup", "configuracoes": "configuracoes",
    };
    return menuVis[keyMap[key] ?? key] !== false;
  });

  const handleLogout = () => {
    clearSession();
    window.location.reload();
  };

  useEffect(() => {
    const onUpdate = () => {
      setBranding(loadBranding());
      setBgStyle(loadBackground());
      setAccent(getAccent());
      setPalette(loadPalette());
    };
    window.addEventListener("salon_config_updated", onUpdate);
    return () => window.removeEventListener("salon_config_updated", onUpdate);
  }, []);

  const navigate = (path: string) => {
    setLocation(path);
    setSidebarOpen(false);
  };

  const isActive = (path: string) =>
    location === path || location.startsWith(path + "/");

  return (
    <div className="flex h-screen overflow-hidden" style={Object.keys(bgStyle).length > 0 ? bgStyle : { backgroundColor: palette.bg }}>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={cn(
        "fixed md:relative z-50 flex flex-col h-full transition-transform duration-300 ease-out w-64",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      )} style={{
        background: palette.surface,
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        borderRight: `1px solid ${palette.border}`,
      }}>

        <div className="flex flex-col items-center pt-7 pb-5 px-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="relative mb-3"><BrandLogo size={72} /></div>
          <p style={{ fontFamily: "'Space Gro

