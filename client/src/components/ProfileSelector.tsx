/**
 * ProfileSelector — Tela de seleção de perfil e login
 */
import { useState } from "react";
import { type UserRole, setSession, loadAccessConfig, getDefaultRoute } from "@/lib/access";

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
  const cfg = loadAccessConfig();

  const [selected, setSelected] = useState<UserRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const profiles = [
    { role: "owner" as UserRole,    emoji: "👑", label: "Dono",       sublabel: "Acesso total",      enabled: true },
    { role: "manager" as UserRole,  emoji: "👔", label: cfg.managerName || "Gerente", sublabel: "Acesso total", enabled: cfg.managerEnabled },
    { role: "employee" as UserRole, emoji: "✂️", label: "Funcionário", sublabel: "Agenda e clientes", enabled: cfg.employeesAccessEnabled },
  ].filter(p => p.enabled);

  function handleLogin() {
    if (!selected || !password) return;

    const fresh = loadAccessConfig();
    let correct = "";
    let name = "";

    if (selected === "owner")   { correct = fresh.ownerPassword;    name = "Dono"; }
    if (selected === "manager") { correct = fresh.managerPassword;   name = fresh.managerName || "Gerente"; }
    if (selected === "employee"){ correct = fresh.employeePassword;  name = "Funcionário"; }

    if (password === correct) {
      setSession(selected, name);
      window.location.href = getDefaultRoute(selected);
    } else {
      setError("Senha incorreta.");
      setPassword("");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "#0d0d14" }}>

      {/* Logo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 40 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: `linear-gradient(135deg, ${accent}40, ${accent}15)`,
          border: `1.5px solid ${accent}50`,
          boxShadow: `0 4px 24px ${accent}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16, fontSize: 28,
        }}>✂️</div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.15em", textTransform: "uppercase", color: "#fff", textShadow: `0 0 20px ${accent}80`, margin: 0 }}>
          {salonName}
        </h1>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.25em", marginTop: 4 }}>DOMÍNIO PRO</p>
      </div>

      <div style={{ width: "100%", maxWidth: 360 }}>

        {/* Perfis */}
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.2em", textAlign: "center", marginBottom: 12 }}>
          Selecione seu perfil
        </p>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${profiles.length}, 1fr)`, gap: 12, marginBottom: 24 }}>
          {profiles.map(p => (
            <button
              key={p.role}
              type="button"
              onClick={() => { setSelected(p.role); setPassword(""); setError(""); }}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                padding: "16px 8px", borderRadius: 16,
                border: `2px solid ${selected === p.role ? accent : "rgba(255,255,255,0.1)"}`,
                background: selected === p.role ? `${accent}18` : "rgba(255,255,255,0.04)",
                boxShadow: selected === p.role ? `0 0 20px ${accent}30` : "none",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 28 }}>{p.emoji}</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0 }}>{p.label}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{p.sublabel}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Senha */}
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "center", margin: 0 }}>
              Digite a senha de acesso
            </p>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              autoFocus
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, fontSize: 18,
                textAlign: "center", letterSpacing: "0.3em",
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff", outline: "none", boxSizing: "border-box",
              }}
            />
            {error && (
              <p style={{ fontSize: 12, color: "#f87171", textAlign: "center", margin: 0 }}>{error}</p>
            )}
            <button
              type="button"
              onClick={handleLogin}
              disabled={!password}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, fontSize: 15, fontWeight: 700,
                background: password ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : "rgba(255,255,255,0.1)",
                color: password ? "#fff" : "rgba(255,255,255,0.3)",
                border: "none", cursor: password ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              Entrar
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 48 }}>Domínio Pro v2.0</p>
    </div>
  );
}
