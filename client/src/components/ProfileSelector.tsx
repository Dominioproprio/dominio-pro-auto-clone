/**
 * ProfileSelector — Tela de seleção de perfil e login
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type UserRole, setSession, loadAccessConfig, getDefaultRoute } from "@/lib/access";
import { useLocation } from "wouter";

function getAccent() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function getSalonName() {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).salonName || "Domínio Pro";
  } catch { /* ignore */ }
  return "Domínio Pro";
}

export default function ProfileSelector() {
  const accent = getAccent();
  const salonName = getSalonName();
  const [, setLocation] = useLocation();

  const [selected, setSelected] = useState<UserRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const cfg = loadAccessConfig();

  const profiles = [
    { role: "owner" as UserRole,    emoji: "👑", label: "Dono",       sublabel: "Acesso total",      enabled: true },
    { role: "manager" as UserRole,  emoji: "👔", label: cfg.managerName || "Gerente", sublabel: "Acesso total", enabled: cfg.managerEnabled },
    { role: "employee" as UserRole, emoji: "✂️", label: "Funcionário", sublabel: "Agenda e clientes", enabled: cfg.employeesAccessEnabled },
  ].filter(p => p.enabled);

  const handleSelect = (role: UserRole) => {
    setSelected(role);
    setPassword("");
    setError("");
  };

  const handleLogin = () => {
    if (!selected || !password) return;

    const freshCfg = loadAccessConfig();
    let correct = "";
    let name = "";

    if (selected === "owner") {
      correct = freshCfg.ownerPassword;
      name = "Dono";
    } else if (selected === "manager") {
      correct = freshCfg.managerPassword;
      name = freshCfg.managerName || "Gerente";
    } else {
      correct = freshCfg.employeePassword;
      name = "Funcionário";
    }

    if (password === correct) {
      setSession(selected, name);
      setLocation(getDefaultRoute(selected));
    } else {
      setError("Senha incorreta. Tente novamente.");
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "#0d0d14" }}>

      <div className="flex flex-col items-center mb-10">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: `linear-gradient(135deg, ${accent}40, ${accent}15)`,
            border: `1.5px solid ${accent}50`,
            boxShadow: `0 4px 24px ${accent}30`,
          }}>
          <span style={{ fontSize: 28 }}>✂️</span>
        </div>
        <h1 className="text-xl font-bold tracking-widest uppercase text-white"
          style={{ textShadow: `0 0 20px ${accent}80`, fontFamily: "'Space Grotesk', sans-serif" }}>
          {salonName}
        </h1>
        <p className="text-xs text-white/30 tracking-widest mt-1">DOMÍNIO PRO</p>
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-widest mb-3 text-center">
            Selecione seu perfil
          </p>
          <div className={`grid gap-3 ${profiles.length === 1 ? "grid-cols-1" : profiles.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {profiles.map(p => (
              <button
                key={p.role}
                type="button"
                onClick={() => handleSelect(p.role)}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all"
                style={{
                  borderColor: selected === p.role ? accent : "rgba(255,255,255,0.1)",
                  background: selected === p.role ? `${accent}18` : "rgba(255,255,255,0.04)",
                  boxShadow: selected === p.role ? `0 0 20px ${accent}30` : "none",
                }}
              >
                <div style={{ fontSize: 28 }}>{p.emoji}</div>
                <div>
                  <p className="text-sm font-bold text-white">{p.label}</p>
                  <p className="text-[10px] text-white/40 mt-0.5">{p.sublabel}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="space-y-3">
            <p className="text-xs text-white/40 text-center">Digite a senha de acesso</p>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
              autoFocus
              className="text-center text-lg tracking-widest bg-white/5 border-white/10 text-white placeholder:text-white/20"
            />
            {error && (
              <p className="text-xs text-red-400 text-center">{error}</p>
            )}
            <Button
              type="button"
              onClick={handleLogin}
              disabled={!password}
              className="w-full font-semibold"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
            >
              Entrar
            </Button>
          </div>
        )}
      </div>

      <p className="text-[10px] text-white/15 mt-12">Domínio Pro v2.0</p>
    </div>
  );
}
