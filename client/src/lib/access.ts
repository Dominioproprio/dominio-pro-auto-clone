/**
 * access.ts — Controle de acesso por perfil (client-side)
 * Perfis: owner (dono), manager (gerente), employee (funcionário)
 */

export type UserRole = "owner" | "manager" | "employee";

export interface AccessProfile {
  id: string;
  name: string;
  role: UserRole;
  emoji: string;
}

// Rotas permitidas por perfil
const ALLOWED_ROUTES: Record<UserRole, string[]> = {
  owner: ["*"], // tudo
  manager: ["*"], // tudo
  employee: [
    "/agenda",
    "/clientes",
    "/servicos",
  ],
};

// Páginas do menu visíveis por perfil
export const MENU_VISIBILITY: Record<UserRole, Record<string, boolean>> = {
  owner: {
    dashboard: true,
    agenda: true,
    clientes: true,
    funcionarios: true,
    servicos: true,
    caixa: true,
    relatorios: true,
    historico: true,
    backup: true,
    configuracoes: true,
    ferramentas: true,
  },
  manager: {
    dashboard: true,
    agenda: true,
    clientes: true,
    funcionarios: true,
    servicos: true,
    caixa: true,
    relatorios: true,
    historico: true,
    backup: true,
    configuracoes: true,
    ferramentas: true,
  },
  employee: {
    dashboard: false,
    agenda: true,
    clientes: true,
    funcionarios: false,
    servicos: true,
    caixa: false,
    relatorios: false,
    historico: false,
    backup: false,
    configuracoes: false,
    ferramentas: false,
  },
};

// Sessão atual
const SESSION_KEY = "dominio_pro_session";

export interface Session {
  role: UserRole;
  profileName: string;
  loginAt: number;
}

export function getSession(): Session | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return null;
    const session: Session = JSON.parse(s);
    // Expira após 12h de inatividade
    if (Date.now() - session.loginAt > 12 * 60 * 60 * 1000) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(role: UserRole, profileName: string): void {
  const session: Session = { role, profileName, loginAt: Date.now() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function canAccess(role: UserRole, path: string): boolean {
  const allowed = ALLOWED_ROUTES[role];
  if (allowed.includes("*")) return true;
  return allowed.some(r => path === r || path.startsWith(r + "/"));
}

export function getDefaultRoute(role: UserRole): string {
  if (role === "owner" || role === "manager") return "/dashboard";
  return "/agenda";
}

// Senhas salvas no salon_config do localStorage
export interface AccessConfig {
  ownerPassword: string;
  managerEnabled: boolean;
  managerName: string;
  managerPassword: string;
  employeesAccessEnabled: boolean;
  employeePassword: string; // senha única para todos os funcionários
}

export const DEFAULT_ACCESS_CONFIG: AccessConfig = {
  ownerPassword: "",
  managerEnabled: false,
  managerName: "Gerente",
  managerPassword: "",
  employeesAccessEnabled: false,
  employeePassword: "",
};

export function loadAccessConfig(): AccessConfig {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) {
      const c = JSON.parse(s);
      return { ...DEFAULT_ACCESS_CONFIG, ...c.access };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_ACCESS_CONFIG };
}

export function saveAccessConfig(access: AccessConfig): void {
  try {
    const s = localStorage.getItem("salon_config");
    const c = s ? JSON.parse(s) : {};
    c.access = access;
    localStorage.setItem("salon_config", JSON.stringify(c));
  } catch { /* ignore */ }
}

// Verifica se o controle de acesso está ativado
// ALTERAÇÃO: Retornando false para desativar a trava de senha temporariamente
export function isAccessControlEnabled(): boolean {
  return false; 
}

