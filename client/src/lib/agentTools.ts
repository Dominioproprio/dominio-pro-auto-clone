/**
 * agentTools.ts — Catálogo de ferramentas do Super Agente.
 * Cada ferramenta é uma ação executável que o agente pode realizar.
 * Padrão compatível com "tool calling" (preparado para futuro LLM).
 *
 * 18+ ferramentas cobrindo 100% das funcionalidades do app:
 * - CRUD Clientes, Funcionários, Serviços
 * - Caixa (abrir, fechar, lançamentos, consulta)
 * - Configurações, Backup, Navegação, Histórico
 */

import {
  clientsStore,
  employeesStore,
  servicesStore,
  appointmentsStore,
  cashSessionsStore,
  cashEntriesStore,
  auditStore,
  type Client,
  type Employee,
  type Service,
} from "./store";
import { calcPeriodStats, getAppointmentsInPeriod, getPeriodDates } from "./analytics";

// ─── Tipos ─────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  navigateTo?: string;
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  confirmationRequired: boolean;
  execute: (params: Record<string, string>) => Promise<ToolResult>;
}

// ─── Helpers ───────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function findClientByName(name: string): Client | null {
  const clients = clientsStore.list();
  const norm = normalize(name);
  let found = clients.find(c => normalize(c.name) === norm);
  if (found) return found;
  found = clients.find(c => normalize(c.name).includes(norm));
  if (found) return found;
  const parts = norm.split(" ").filter(p => p.length > 2);
  found = clients.find(c => {
    const cn = normalize(c.name);
    return parts.every(p => cn.includes(p));
  });
  return found ?? null;
}

function findEmployeeByName(name: string): Employee | null {
  const employees = employeesStore.list(false);
  const norm = normalize(name);
  let found = employees.find(e => normalize(e.name) === norm);
  if (found) return found;
  found = employees.find(e => normalize(e.name).includes(norm));
  if (found) return found;
  const parts = norm.split(" ").filter(p => p.length > 2);
  found = employees.find(e => {
    const en = normalize(e.name);
    return parts.every(p => en.includes(p));
  });
  return found ?? null;
}

function findServiceByName(name: string): Service | null {
  const services = servicesStore.list(false);
  const norm = normalize(name);
  let found = services.find(s => normalize(s.name) === norm);
  if (found) return found;
  found = services.find(s => normalize(s.name).includes(norm));
  if (found) return found;
  found = services.find(s => norm.includes(normalize(s.name)));
  if (found) return found;
  const parts = norm.split(" ").filter(p => p.length > 2);
  if (parts.length > 0) {
    found = services.find(s => {
      const sn = normalize(s.name);
      return parts.some(p => sn.includes(p));
    });
  }
  return found ?? null;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

// ─── Mapeamento de páginas (sinônimos) ────────────────────

export const PAGE_SYNONYMS: Record<string, string> = {
  "dashboard": "/",
  "inicio": "/",
  "home": "/",
  "principal": "/",
  "clientes": "/clientes",
  "meus clientes": "/clientes",
  "cliente": "/clientes",
  "agenda": "/agenda",
  "agendamentos": "/agenda",
  "agendamento": "/agenda",
  "caixa": "/caixa",
  "financeiro": "/caixa/dashboard",
  "dashboard financeiro": "/caixa/dashboard",
  "painel financeiro": "/caixa/dashboard",
  "relatorios": "/relatorios",
  "relatorio": "/relatorios",
  "funcionarios": "/funcionarios",
  "funcionario": "/funcionarios",
  "equipe": "/funcionarios",
  "time": "/funcionarios",
  "profissionais": "/funcionarios",
  "servicos": "/servicos",
  "servico": "/servicos",
  "configuracoes": "/configuracoes",
  "configuracao": "/configuracoes",
  "config": "/configuracoes",
  "ajustes": "/configuracoes",
  "backup": "/backup",
  "backups": "/backup",
  "historico": "/historico",
  "historico de agendamentos": "/historico-agendamentos",
  "ferramentas": "/ferramentas-clientes",
  "ferramentas de clientes": "/ferramentas-clientes",
  "importar clientes": "/ferramentas-clientes",
  "importar": "/ferramentas-clientes",
};

// ─── Mapeamento de campos editáveis ──────────────────────

const CLIENT_FIELDS: Record<string, string> = {
  "nome": "name",
  "email": "email",
  "telefone": "phone",
  "celular": "phone",
  "fone": "phone",
  "nascimento": "birthDate",
  "data de nascimento": "birthDate",
  "aniversario": "birthDate",
  "cpf": "cpf",
  "endereco": "address",
  "notas": "notes",
  "observacoes": "notes",
  "obs": "notes",
};

const EMPLOYEE_FIELDS: Record<string, string> = {
  "nome": "name",
  "email": "email",
  "telefone": "phone",
  "celular": "phone",
  "cor": "color",
  "comissao": "commissionPercent",
  "porcentagem": "commissionPercent",
  "especialidades": "specialties",
};

const SERVICE_FIELDS: Record<string, string> = {
  "nome": "name",
  "descricao": "description",
  "duracao": "durationMinutes",
  "tempo": "durationMinutes",
  "preco": "price",
  "valor": "price",
  "cor": "color",
  "custo de material": "materialCostPercent",
  "custo material": "materialCostPercent",
};

const PAYMENT_METHODS: Record<string, string> = {
  "dinheiro": "dinheiro",
  "especie": "dinheiro",
  "cash": "dinheiro",
  "credito": "cartao_credito",
  "cartao de credito": "cartao_credito",
  "cartao credito": "cartao_credito",
  "debito": "cartao_debito",
  "cartao de debito": "cartao_debito",
  "cartao debito": "cartao_debito",
  "pix": "pix",
  "outro": "outro",
  "outros": "outro",
};

function resolveField(fieldName: string, fieldMap: Record<string, string>): string | null {
  const norm = normalize(fieldName);
  return fieldMap[norm] ?? null;
}

// ─── Ferramentas ──────────────────────────────────────────

export const tools: AgentTool[] = [
  // ── 1. Criar Cliente ──
  {
    id: "criar_cliente",
    name: "Criar Cliente",
    description: "cadastrar novo cliente no sistema",
    requiredParams: ["nome"],
    optionalParams: ["telefone", "email", "cpf", "endereco", "notas", "nascimento"],
    confirmationRequired: false,
    execute: async (params) => {
      const existing = findClientByName(params.nome);
      if (existing) {
        return {
          success: false,
          message: `Ja existe um cliente chamado "${existing.name}". Deseja atualizar os dados dele?`,
        };
      }
      const client = await clientsStore.create({
        name: params.nome,
        phone: params.telefone ? formatPhone(params.telefone) : null,
        email: params.email ?? null,
        cpf: params.cpf ?? null,
        address: params.endereco ?? null,
        notes: params.notas ?? null,
        birthDate: params.nascimento ?? null,
      });
      let msg = `Cliente "${client.name}" cadastrado com sucesso!`;
      if (client.phone) msg += ` Tel: ${client.phone}.`;
      if (client.email) msg += ` Email: ${client.email}.`;
      return { success: true, message: msg, data: client };
    },
  },

  // ── 2. Editar Cliente ──
  {
    id: "editar_cliente",
    name: "Editar Cliente",
    description: "alterar dados de um cliente existente",
    requiredParams: ["nome", "campo", "valor"],
    optionalParams: [],
    confirmationRequired: true,
    execute: async (params) => {
      const client = findClientByName(params.nome);
      if (!client) {
        return { success: false, message: `Nao encontrei nenhum cliente chamado "${params.nome}". Verifique o nome e tente novamente.` };
      }
      const field = resolveField(params.campo, CLIENT_FIELDS);
      if (!field) {
        return { success: false, message: `Campo "${params.campo}" nao reconhecido. Campos validos: ${Object.keys(CLIENT_FIELDS).join(", ")}.` };
      }
      const updateData: Partial<Client> = { [field]: params.valor };
      if (field === "phone") updateData.phone = formatPhone(params.valor);
      const updated = await clientsStore.update(client.id, updateData);
      return {
        success: true,
        message: `Cliente "${client.name}" atualizado! ${params.campo}: ${params.valor}.`,
        data: updated,
      };
    },
  },

  // ── 3. Excluir Cliente ──
  {
    id: "excluir_cliente",
    name: "Excluir Cliente",
    description: "remover um cliente do sistema",
    requiredParams: ["nome"],
    optionalParams: [],
    confirmationRequired: true,
    execute: async (params) => {
      const client = findClientByName(params.nome);
      if (!client) {
        return { success: false, message: `Nao encontrei nenhum cliente chamado "${params.nome}".` };
      }
      await clientsStore.delete(client.id);
      return { success: true, message: `Cliente "${client.name}" removido do sistema.` };
    },
  },

  // ── 4. Buscar Cliente ──
  {
    id: "buscar_cliente",
    name: "Buscar Cliente",
    description: "procurar cliente por nome, telefone ou email",
    requiredParams: ["termo"],
    optionalParams: [],
    confirmationRequired: false,
    execute: async (params) => {
      const clients = clientsStore.list();
      const norm = normalize(params.termo);
      const results = clients.filter(c => {
        const nameMatch = normalize(c.name).includes(norm);
        const phoneMatch = c.phone && c.phone.replace(/\D/g, "").includes(norm.replace(/\D/g, ""));
        const emailMatch = c.email && normalize(c.email).includes(norm);
        return nameMatch || phoneMatch || emailMatch;
      }).slice(0, 10);

      if (results.length === 0) {
        return { success: true, message: `Nenhum cliente encontrado com "${params.termo}".` };
      }
      const lines = results.map((c, i) =>
        `${i + 1}. **${c.name}**${c.phone ? ` — ${c.phone}` : ""}${c.email ? ` — ${c.email}` : ""}`
      );
      return {
        success: true,
        message: `Encontrei ${results.length} cliente(s):\n\n${lines.join("\n")}`,
        data: results,
      };
    },
  },

  // ── 5. Criar Funcionário ──
  {
    id: "criar_funcionario",
    name: "Criar Funcionario",
    description: "cadastrar novo funcionario/profissional",
    requiredParams: ["nome"],
    optionalParams: ["telefone", "email", "comissao", "especialidades", "cor"],
    confirmationRequired: false,
    execute: async (params) => {
      const existing = findEmployeeByName(params.nome);
      if (existing) {
        return { success: false, message: `Ja existe um funcionario chamado "${existing.name}".` };
      }
      const colors = ["#ec4899", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#3b82f6", "#ef4444"];
      const empCount = employeesStore.list(false).length;
      const emp = await employeesStore.create({
        name: params.nome,
        email: params.email ?? "",
        phone: params.telefone ? formatPhone(params.telefone) : "",
        color: params.cor ?? colors[empCount % colors.length],
        photoUrl: null,
        specialties: params.especialidades ? params.especialidades.split(",").map(s => s.trim()) : [],
        commissionPercent: params.comissao ? parseFloat(params.comissao) : 0,
        workingHours: {},
        active: true,
      });
      return {
        success: true,
        message: `Funcionario "${emp.name}" cadastrado! ${params.comissao ? `Comissao: ${params.comissao}%.` : "Lembre de configurar a comissao e horarios de trabalho."}`,
        data: emp,
        navigateTo: "/funcionarios",
      };
    },
  },

  // ── 6. Editar Funcionário ──
  {
    id: "editar_funcionario",
    name: "Editar Funcionario",
    description: "alterar dados de um funcionario",
    requiredParams: ["nome", "campo", "valor"],
    optionalParams: [],
    confirmationRequired: true,
    execute: async (params) => {
      const emp = findEmployeeByName(params.nome);
      if (!emp) {
        return { success: false, message: `Nao encontrei nenhum funcionario chamado "${params.nome}".` };
      }
      const field = resolveField(params.campo, EMPLOYEE_FIELDS);
      if (!field) {
        return { success: false, message: `Campo "${params.campo}" nao reconhecido. Campos validos: ${Object.keys(EMPLOYEE_FIELDS).join(", ")}.` };
      }
      const updateData: Partial<Employee> = {};
      if (field === "commissionPercent") {
        updateData.commissionPercent = parseFloat(params.valor);
      } else if (field === "specialties") {
        updateData.specialties = params.valor.split(",").map(s => s.trim());
      } else if (field === "phone") {
        updateData.phone = formatPhone(params.valor);
      } else {
        (updateData as Record<string, unknown>)[field] = params.valor;
      }
      const updated = await employeesStore.update(emp.id, updateData);
      return {
        success: true,
        message: `Funcionario "${emp.name}" atualizado! ${params.campo}: ${params.valor}.`,
        data: updated,
      };
    },
  },

  // ── 7. Criar Serviço ──
  {
    id: "criar_servico",
    name: "Criar Servico",
    description: "cadastrar novo servico no catalogo",
    requiredParams: ["nome"],
    optionalParams: ["preco", "duracao", "descricao", "cor", "custo_material"],
    confirmationRequired: false,
    execute: async (params) => {
      const existing = findServiceByName(params.nome);
      if (existing) {
        return { success: false, message: `Ja existe um servico chamado "${existing.name}".` };
      }
      const colors = ["#ec4899", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#3b82f6"];
      const svcCount = servicesStore.list(false).length;
      const svc = await servicesStore.create({
        name: params.nome,
        description: params.descricao ?? null,
        durationMinutes: params.duracao ? parseInt(params.duracao, 10) : 60,
        price: params.preco ? parseFloat(params.preco) : 0,
        materialCostPercent: params.custo_material ? parseFloat(params.custo_material) : 0,
        color: params.cor ?? colors[svcCount % colors.length],
        active: true,
      });
      let msg = `Servico "${svc.name}" criado!`;
      if (svc.price > 0) msg += ` Preco: ${formatCurrency(svc.price)}.`;
      if (svc.durationMinutes) msg += ` Duracao: ${svc.durationMinutes} min.`;
      return { success: true, message: msg, data: svc };
    },
  },

  // ── 8. Editar Serviço ──
  {
    id: "editar_servico",
    name: "Editar Servico",
    description: "alterar dados de um servico",
    requiredParams: ["nome", "campo", "valor"],
    optionalParams: [],
    confirmationRequired: true,
    execute: async (params) => {
      const svc = findServiceByName(params.nome);
      if (!svc) {
        return { success: false, message: `Nao encontrei nenhum servico chamado "${params.nome}".` };
      }
      const field = resolveField(params.campo, SERVICE_FIELDS);
      if (!field) {
        return { success: false, message: `Campo "${params.campo}" nao reconhecido. Campos validos: ${Object.keys(SERVICE_FIELDS).join(", ")}.` };
      }
      const updateData: Partial<Service> = {};
      if (field === "price" || field === "materialCostPercent") {
        (updateData as Record<string, unknown>)[field] = parseFloat(params.valor);
      } else if (field === "durationMinutes") {
        updateData.durationMinutes = parseInt(params.valor, 10);
      } else {
        (updateData as Record<string, unknown>)[field] = params.valor;
      }
      const updated = await servicesStore.update(svc.id, updateData);
      return {
        success: true,
        message: `Servico "${svc.name}" atualizado! ${params.campo}: ${params.valor}.`,
        data: updated,
      };
    },
  },

  // ── 9. Abrir Caixa ──
  {
    id: "abrir_caixa",
    name: "Abrir Caixa",
    description: "abrir o caixa do dia com saldo inicial",
    requiredParams: [],
    optionalParams: ["saldo_inicial"],
    confirmationRequired: false,
    execute: async (params) => {
      const current = cashSessionsStore.getCurrent();
      if (current) {
        const entries = cashEntriesStore.list(current.id);
        const total = entries.reduce((s, e) => s + e.amount, 0);
        return {
          success: false,
          message: `O caixa ja esta aberto desde ${new Date(current.openedAt).toLocaleTimeString("pt-BR")}. ${entries.length} lancamento(s), total ${formatCurrency(total)}.`,
        };
      }
      const balance = params.saldo_inicial ? parseFloat(params.saldo_inicial) : 0;
      const session = await cashSessionsStore.open(balance);
      return {
        success: true,
        message: `Caixa aberto com sucesso! Saldo inicial: ${formatCurrency(balance)}.`,
        data: session,
        navigateTo: "/caixa",
      };
    },
  },

  // ── 10. Fechar Caixa ──
  {
    id: "fechar_caixa",
    name: "Fechar Caixa",
    description: "fechar o caixa e gerar resumo do dia",
    requiredParams: [],
    optionalParams: ["observacoes"],
    confirmationRequired: true,
    execute: async (params) => {
      const current = cashSessionsStore.getCurrent();
      if (!current) {
        return { success: false, message: "O caixa nao esta aberto." };
      }
      const entries = cashEntriesStore.list(current.id);
      const totalRevenue = entries.reduce((s, e) => s + e.amount, 0);
      const totalCommissions = entries.reduce((s, e) => s + e.commissionValue, 0);
      await cashSessionsStore.close(current.id, {
        totalRevenue,
        totalCommissions,
        closingNotes: params.observacoes ?? "",
      });

      const methodCounts: Record<string, number> = {};
      entries.forEach(e => {
        methodCounts[e.paymentMethod] = (methodCounts[e.paymentMethod] ?? 0) + 1;
      });
      const topMethod = Object.entries(methodCounts).sort(([, a], [, b]) => b - a)[0];

      return {
        success: true,
        message: `Caixa fechado!\n\n**Resumo:**\n- ${entries.length} lancamento(s)\n- Faturamento: ${formatCurrency(totalRevenue)}\n- Comissoes: ${formatCurrency(totalCommissions)}\n- Liquido: ${formatCurrency(totalRevenue - totalCommissions)}${topMethod ? `\n- Metodo mais usado: ${topMethod[0]} (${topMethod[1]}x)` : ""}`,
      };
    },
  },

  // ── 11. Registrar Pagamento ──
  {
    id: "registar_pagamento",
    name: "Registrar Pagamento",
    description: "registrar lancamento/pagamento no caixa",
    requiredParams: ["cliente", "valor"],
    optionalParams: ["metodo", "descricao", "funcionario"],
    confirmationRequired: false,
    execute: async (params) => {
      const current = cashSessionsStore.getCurrent();
      if (!current) {
        return { success: false, message: "O caixa nao esta aberto. Abra o caixa primeiro." };
      }
      const amount = parseFloat(params.valor.replace(",", ".").replace(/[^\d.]/g, ""));
      if (isNaN(amount) || amount <= 0) {
        return { success: false, message: "Valor invalido. Informe um valor positivo." };
      }
      const methodKey = params.metodo ? normalize(params.metodo) : "dinheiro";
      const paymentMethod = PAYMENT_METHODS[methodKey] ?? "dinheiro";

      let employeeId = 0;
      let commissionPercent = 0;
      if (params.funcionario) {
        const emp = findEmployeeByName(params.funcionario);
        if (emp) {
          employeeId = emp.id;
          commissionPercent = emp.commissionPercent;
        }
      }
      if (!employeeId) {
        const activeEmps = employeesStore.list(true);
        if (activeEmps.length > 0) {
          employeeId = activeEmps[0].id;
          commissionPercent = activeEmps[0].commissionPercent;
        }
      }

      const commissionValue = amount * (commissionPercent / 100);

      const entry = await cashEntriesStore.create({
        sessionId: current.id,
        appointmentId: null,
        clientName: params.cliente,
        employeeId,
        description: params.descricao ?? "Pagamento registrado via assistente",
        amount,
        paymentMethod: paymentMethod as "dinheiro" | "cartao_credito" | "cartao_debito" | "pix" | "outro",
        commissionPercent,
        commissionValue,
        materialCostValue: 0,
        isAutoLaunch: false,
      });
      return {
        success: true,
        message: `Pagamento registrado! ${params.cliente}: ${formatCurrency(amount)} (${paymentMethod}).`,
        data: entry,
      };
    },
  },

  // ── 12. Consultar Caixa ──
  {
    id: "consultar_caixa",
    name: "Consultar Caixa",
    description: "ver status atual do caixa e lancamentos",
    requiredParams: [],
    optionalParams: [],
    confirmationRequired: false,
    execute: async () => {
      const current = cashSessionsStore.getCurrent();
      if (!current) {
        return { success: true, message: "O caixa nao esta aberto no momento. Quer que eu abra?" };
      }
      const entries = cashEntriesStore.list(current.id);
      const totalRevenue = entries.reduce((s, e) => s + e.amount, 0);
      const totalCommissions = entries.reduce((s, e) => s + e.commissionValue, 0);

      const lines = [
        `**Status do Caixa**\n`,
        `Aberto desde: ${new Date(current.openedAt).toLocaleTimeString("pt-BR")}`,
        `Saldo inicial: ${formatCurrency(current.openingBalance)}`,
        `Lancamentos: ${entries.length}`,
        `Total recebido: ${formatCurrency(totalRevenue)}`,
        `Comissoes: ${formatCurrency(totalCommissions)}`,
        `**Saldo atual: ${formatCurrency(current.openingBalance + totalRevenue)}**`,
      ];

      if (entries.length > 0) {
        lines.push("\n**Ultimos lancamentos:**");
        entries.slice(-5).forEach(e => {
          lines.push(`- ${e.clientName}: ${formatCurrency(e.amount)} (${e.paymentMethod})`);
        });
      }

      return { success: true, message: lines.join("\n"), data: { current, entries } };
    },
  },

  // ── 13. Alterar Configuração ──
  {
    id: "alterar_configuracao",
    name: "Alterar Configuracao",
    description: "alterar configuracoes do salao",
    requiredParams: ["campo", "valor"],
    optionalParams: [],
    confirmationRequired: true,
    execute: async (params) => {
      const configFields: Record<string, string> = {
        "nome do salao": "salonName",
        "nome": "salonName",
        "salao": "salonName",
        "telefone": "phone",
        "endereco": "address",
        "cor": "accentColor",
        "cor do tema": "accentColor",
        "abertura automatica": "autoOpenCash",
        "auto caixa": "autoOpenCash",
        "intervalo": "slotInterval",
        "hora inicio": "startHour",
        "hora fim": "endHour",
      };
      const field = configFields[normalize(params.campo)];
      if (!field) {
        return { success: false, message: `Campo de configuracao "${params.campo}" nao reconhecido. Campos validos: ${Object.keys(configFields).join(", ")}.` };
      }
      let config: Record<string, unknown> = {};
      try {
        const raw = localStorage.getItem("salon_config");
        if (raw) config = JSON.parse(raw);
      } catch { /* ignore */ }

      let value: unknown = params.valor;
      if (field === "autoOpenCash") {
        value = ["sim", "true", "1", "ativar", "ativado", "on"].includes(normalize(params.valor));
      } else if (field === "slotInterval" || field === "startHour" || field === "endHour") {
        value = parseInt(params.valor, 10);
      }

      config[field] = value;
      localStorage.setItem("salon_config", JSON.stringify(config));

      return {
        success: true,
        message: `Configuracao atualizada! ${params.campo}: ${params.valor}.`,
        navigateTo: "/configuracoes",
      };
    },
  },

  // ── 14. Exportar Backup ──
  {
    id: "exportar_backup",
    name: "Exportar Backup",
    description: "exportar backup completo dos dados",
    requiredParams: [],
    optionalParams: [],
    confirmationRequired: false,
    execute: async () => {
      return {
        success: true,
        message: "Para exportar o backup, va ate a pagina de Backup. La voce pode baixar todos os seus dados em formato JSON.",
        navigateTo: "/backup",
      };
    },
  },

  // ── 15. Navegar ──
  {
    id: "navegar",
    name: "Navegar",
    description: "ir para uma pagina especifica do app",
    requiredParams: ["pagina"],
    optionalParams: [],
    confirmationRequired: false,
    execute: async (params) => {
      const norm = normalize(params.pagina);
      const route = PAGE_SYNONYMS[norm];
      if (!route) {
        const available = Object.keys(PAGE_SYNONYMS).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15).join(", ");
        return { success: false, message: `Pagina "${params.pagina}" nao encontrada. Paginas disponiveis: ${available}.` };
      }
      return {
        success: true,
        message: `Navegando para ${params.pagina}...`,
        navigateTo: route,
      };
    },
  },

  // ── 16. Listar Funcionários ──
  {
    id: "listar_funcionarios",
    name: "Listar Funcionarios",
    description: "listar todos os funcionarios e suas informacoes",
    requiredParams: [],
    optionalParams: [],
    confirmationRequired: false,
    execute: async () => {
      const all = employeesStore.list(false);
      const active = all.filter(e => e.active);
      if (all.length === 0) {
        return { success: true, message: "Nenhum funcionario cadastrado. Quer cadastrar um?" };
      }
      const lines = all.map((e, i) => {
        const status = e.active ? "" : " (inativo)";
        const specs = e.specialties.length > 0 ? ` — ${e.specialties.join(", ")}` : "";
        return `${i + 1}. **${e.name}**${status} — Comissao: ${e.commissionPercent}%${specs}`;
      });
      return {
        success: true,
        message: `**Equipe** (${active.length} ativos de ${all.length}):\n\n${lines.join("\n")}`,
        data: all,
      };
    },
  },

  // ── 17. Listar Serviços ──
  {
    id: "listar_servicos",
    name: "Listar Servicos",
    description: "listar todos os servicos disponiveis",
    requiredParams: [],
    optionalParams: [],
    confirmationRequired: false,
    execute: async () => {
      const all = servicesStore.list(false);
      const active = all.filter(s => s.active);
      if (all.length === 0) {
        return { success: true, message: "Nenhum servico cadastrado. Quer criar um?" };
      }
      const lines = all.map((s, i) => {
        const status = s.active ? "" : " (inativo)";
        return `${i + 1}. **${s.name}**${status} — ${formatCurrency(s.price)} — ${s.durationMinutes} min`;
      });
      return {
        success: true,
        message: `**Servicos** (${active.length} ativos de ${all.length}):\n\n${lines.join("\n")}`,
        data: all,
      };
    },
  },

  // ── 18. Histórico do Cliente ──
  {
    id: "historico_cliente",
    name: "Historico do Cliente",
    description: "ver historico de atendimentos de um cliente",
    requiredParams: ["nome"],
    optionalParams: [],
    confirmationRequired: false,
    execute: async (params) => {
      const client = findClientByName(params.nome);
      if (!client) {
        return { success: false, message: `Nao encontrei nenhum cliente chamado "${params.nome}".` };
      }
      const allAppts = appointmentsStore.list({});
      const clientAppts = allAppts
        .filter(a => a.clientId === client.id || normalize(a.clientName ?? "").includes(normalize(client.name)))
        .sort((a, b) => b.startTime.localeCompare(a.startTime));

      if (clientAppts.length === 0) {
        return { success: true, message: `Cliente "${client.name}" nao tem historico de atendimentos.` };
      }

      const totalSpent = clientAppts
        .filter(a => a.status !== "cancelled" && a.status !== "no_show")
        .reduce((s, a) => s + (a.totalPrice ?? 0), 0);

      const lastVisit = clientAppts[0];
      const employees = employeesStore.list(false);

      const lines = [
        `**Historico de ${client.name}**\n`,
        `Total de visitas: ${clientAppts.length}`,
        `Total gasto: ${formatCurrency(totalSpent)}`,
        `Ultima visita: ${new Date(lastVisit.startTime).toLocaleDateString("pt-BR")}`,
        "",
        "**Ultimos atendimentos:**",
      ];

      clientAppts.slice(0, 10).forEach(a => {
        const emp = employees.find(e => e.id === a.employeeId);
        const services = (a.services ?? []).map(s => s.name).join(", ") || "Servico";
        const date = new Date(a.startTime).toLocaleDateString("pt-BR");
        const statusLabel = a.status === "completed" ? "Concluido" : a.status === "cancelled" ? "Cancelado" : a.status;
        lines.push(`- ${date} — ${services} com ${emp?.name ?? "?"} — ${formatCurrency(a.totalPrice ?? 0)} [${statusLabel}]`);
      });

      return { success: true, message: lines.join("\n"), data: clientAppts };
    },
  },

  // ── 19. Listar Clientes (bonus) ──
  {
    id: "listar_clientes",
    name: "Listar Clientes",
    description: "listar clientes cadastrados ou ver estatisticas",
    requiredParams: [],
    optionalParams: ["filtro"],
    confirmationRequired: false,
    execute: async (params) => {
      const clients = clientsStore.list();
      if (clients.length === 0) {
        return { success: true, message: "Nenhum cliente cadastrado. Quer cadastrar ou importar?" };
      }

      const allAppts = appointmentsStore.list({});
      const cutoff30 = Date.now() - 30 * 86400000;
      const clientLastVisit: Record<number, number> = {};
      for (const a of allAppts) {
        if (a.clientId && a.status !== "cancelled" && a.status !== "no_show") {
          const t = new Date(a.startTime).getTime();
          if (!clientLastVisit[a.clientId] || t > clientLastVisit[a.clientId]) {
            clientLastVisit[a.clientId] = t;
          }
        }
      }

      const filtro = normalize(params.filtro ?? "");
      if (filtro.includes("inativ")) {
        const inactive = clients.filter(c => {
          const last = clientLastVisit[c.id];
          return !last || last < cutoff30;
        });
        if (inactive.length === 0) {
          return { success: true, message: "Nenhum cliente inativo! Todos visitaram nos ultimos 30 dias." };
        }
        const lines = inactive.slice(0, 15).map((c, i) => {
          const last = clientLastVisit[c.id];
          const dias = last ? Math.round((Date.now() - last) / 86400000) : "nunca visitou";
          return `${i + 1}. **${c.name}** — ultima visita: ${typeof dias === "number" ? `ha ${dias} dias` : dias}`;
        });
        return {
          success: true,
          message: `**${inactive.length} clientes inativos** (30+ dias sem visita):\n\n${lines.join("\n")}${inactive.length > 15 ? `\n\n...e mais ${inactive.length - 15} cliente(s).` : ""}`,
        };
      }

      // Aniversariantes da semana
      if (filtro.includes("aniversari") || filtro.includes("niver")) {
        const now = new Date();
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const birthday = clients.filter(c => {
          if (!c.birthDate) return false;
          const bd = new Date(c.birthDate);
          const thisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
          return thisYear >= now && thisYear <= weekEnd;
        });
        if (birthday.length === 0) {
          return { success: true, message: "Nenhum aniversariante nos proximos 7 dias." };
        }
        const lines = birthday.map((c, i) => {
          const bd = new Date(c.birthDate!);
          return `${i + 1}. **${c.name}** — ${bd.getDate()}/${bd.getMonth() + 1}`;
        });
        return {
          success: true,
          message: `**${birthday.length} aniversariante(s) esta semana:**\n\n${lines.join("\n")}`,
        };
      }

      // Listagem geral
      const noPhone = clients.filter(c => !c.phone).length;
      const inactive = clients.filter(c => {
        const last = clientLastVisit[c.id];
        return !last || last < cutoff30;
      }).length;
      return {
        success: true,
        message: `**Clientes:** ${clients.length} cadastrados\n- ${inactive} inativos (30+ dias)\n- ${noPhone} sem telefone\n\nDiga "buscar cliente [nome]" para procurar, ou "clientes inativos" para ver a lista completa.`,
      };
    },
  },

  // ── 20. Criar Agendamento ──
  {
    id: "criar_agendamento",
    name: "Criar Agendamento",
    description: "agendar atendimento para um cliente",
    requiredParams: ["nome"],
    optionalParams: ["data", "hora", "funcionario", "servico", "observacoes"],
    confirmationRequired: false,
    execute: async (params) => {
      // ── Segurança: re-extrair nome via padrão "cliente X" se disponível ──
      // Isso garante que o nome correto seja usado mesmo se o NLU errou
      if (params._rawText) {
        const clienteMatch = params._rawText.match(
          /cliente\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s]{1,59})(?:\s*(?:,|$))/i
        );
        if (clienteMatch && clienteMatch[1]) {
          params.nome = clienteMatch[1].trim();
        }
      }

      // ── 1. Validar cliente no banco ──
      const client = findClientByName(params.nome);
      if (!client) {
        // Sugerir clientes similares
        const allClients = clientsStore.list();
        const norm = normalize(params.nome);
        const similar = allClients
          .filter(c => {
            const cn = normalize(c.name);
            const parts = norm.split(" ").filter(p => p.length > 1);
            return parts.some(p => cn.includes(p));
          })
          .slice(0, 5);

        if (similar.length > 0) {
          const suggestions = similar.map((c, i) => `${i + 1}. **${c.name}**${c.phone ? ` (${c.phone})` : ""}`).join("\n");
          return {
            success: false,
            message: `Nao encontrei o cliente "${params.nome}" cadastrado.\n\nVoce quis dizer:\n${suggestions}\n\nDigite o nome correto ou "cadastrar cliente ${params.nome}" para cadastrar.`,
          };
        }
        return {
          success: false,
          message: `Cliente "${params.nome}" nao encontrado no sistema.\n\nDigite "cadastrar cliente ${params.nome}" para cadastrar, ou "buscar cliente" para procurar.`,
        };
      }

      // ── 2. Validar/sugerir funcionário ──
      const activeEmps = employeesStore.list(true);
      if (activeEmps.length === 0) {
        return { success: false, message: "Nao ha funcionarios ativos cadastrados. Cadastre um funcionario antes de agendar." };
      }

      let employeeId: number;
      let empName: string;
      if (params.funcionario) {
        const emp = findEmployeeByName(params.funcionario);
        if (!emp) {
          const empList = activeEmps.map((e, i) => `${i + 1}. **${e.name}**${e.specialties ? ` (${e.specialties})` : ""}`).join("\n");
          return {
            success: false,
            message: `Nao encontrei o profissional "${params.funcionario}".\n\n**Profissionais disponiveis:**\n${empList}\n\nInforme o nome do profissional.`,
          };
        }
        employeeId = emp.id;
        empName = emp.name;
      } else if (activeEmps.length === 1) {
        employeeId = activeEmps[0].id;
        empName = activeEmps[0].name;
      } else {
        // Múltiplos funcionários — sugerir e usar o primeiro como padrão
        const empList = activeEmps.map((e, i) => `${i + 1}. **${e.name}**${e.specialties ? ` (${e.specialties})` : ""}`).join("\n");
        employeeId = activeEmps[0].id;
        empName = activeEmps[0].name;
        // Nota: vamos usar o primeiro mas avisar na mensagem final
      }

      // ── 3. Validar/sugerir serviço ──
      const allServices = servicesStore.list(true);
      let services: { serviceId: number; name: string; price: number; durationMinutes: number; color: string; materialCostPercent: number }[] = [];
      let totalDuration = 60;
      let totalPrice = 0;
      let servicoInfo = "";

      if (params.servico) {
        const svc = findServiceByName(params.servico);
        if (!svc) {
          if (allServices.length > 0) {
            const svcList = allServices.map((s, i) => `${i + 1}. **${s.name}** — ${formatCurrency(s.price)} (${s.durationMinutes}min)`).join("\n");
            return {
              success: false,
              message: `Nao encontrei o servico "${params.servico}".\n\n**Servicos disponiveis:**\n${svcList}\n\nInforme o nome do servico.`,
            };
          }
          return { success: false, message: `Servico "${params.servico}" nao encontrado. Cadastre servicos primeiro.` };
        }
        services = [{ serviceId: svc.id, name: svc.name, price: svc.price, durationMinutes: svc.durationMinutes, color: svc.color, materialCostPercent: svc.materialCostPercent }];
        totalDuration = svc.durationMinutes;
        totalPrice = svc.price;
        servicoInfo = svc.name;
      } else if (allServices.length > 0) {
        // Sem servico informado — avisar que pode adicionar
        servicoInfo = "(nenhum especificado)";
      }

      // ── 4. Resolver data ──
      let dateStr: string;
      const today = new Date();
      if (params.data) {
        dateStr = params.data;
      } else {
        dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      }

      // ── 5. Resolver hora ──
      let hour = 10;
      let minute = 0;
      if (params.hora) {
        const timeParts = params.hora.split(":");
        hour = parseInt(timeParts[0], 10);
        minute = parseInt(timeParts[1] ?? "0", 10);
      } else {
        // Sem hora — avisar na resposta
      }

      // ── 6. Verificar conflitos de horário ──
      const startTime = `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
      const startDate = new Date(startTime);
      const endDate = new Date(startDate.getTime() + totalDuration * 60 * 1000);
      const endTime = `${dateStr}T${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}:00`;

      // Checar se tem conflito no mesmo horário com mesmo funcionário
      const dayAppts = appointmentsStore.list({ date: dateStr });
      const conflicts = dayAppts.filter(a =>
        a.status !== "cancelled" &&
        a.employeeId === employeeId &&
        a.startTime < endTime &&
        a.endTime > startTime
      );

      if (conflicts.length > 0) {
        const conflictInfo = conflicts.map(a => {
          const h = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
          return `- ${h} — ${a.clientName ?? "Sem nome"}`;
        }).join("\n");

        // Sugerir próximo horário livre
        const lastConflictEnd = conflicts.reduce((max, a) => a.endTime > max ? a.endTime : max, "");
        const nextFree = lastConflictEnd.split("T")[1]?.slice(0, 5) ?? "";

        return {
          success: false,
          message: `**${empName}** ja tem agendamento nesse horario:\n${conflictInfo}\n\nProximo horario livre: **${nextFree}**\nDeseja agendar nesse horario? Diga "agendar ${client.name} as ${nextFree}"`,
        };
      }

      // ── 7. Criar agendamento ──
      const appt = await appointmentsStore.create({
        clientName: client.name,
        clientId: client.id,
        employeeId,
        startTime,
        endTime,
        status: "scheduled",
        totalPrice: totalPrice > 0 ? totalPrice : null,
        notes: params.observacoes ?? null,
        paymentStatus: null,
        groupId: null,
        services,
      });

      // ── 8. Montar mensagem de sucesso com detalhes ──
      const horaStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const dataFormatada = dateStr.split("-").reverse().join("/");

      let msg = `Agendamento criado com sucesso!\n\n`;
      msg += `- **Cliente:** ${client.name}${client.phone ? ` (${client.phone})` : ""}\n`;
      msg += `- **Data:** ${dataFormatada}\n`;
      msg += `- **Horario:** ${horaStr} - ${endTime.split("T")[1]?.slice(0, 5) ?? ""}\n`;
      msg += `- **Profissional:** ${empName}\n`;

      if (services.length > 0) {
        msg += `- **Servico:** ${services.map(s => s.name).join(", ")}\n`;
        msg += `- **Valor:** ${formatCurrency(totalPrice)}\n`;
        msg += `- **Duracao:** ${totalDuration}min\n`;
      }

      // Sugestões contextuais
      const hints: string[] = [];
      if (!params.servico && allServices.length > 0) {
        const topSvcs = allServices.slice(0, 3).map(s => s.name).join(", ");
        hints.push(`Servicos disponiveis: ${topSvcs}. Diga "agendar ${client.name} com [servico]" para incluir.`);
      }
      if (!params.funcionario && activeEmps.length > 1) {
        hints.push(`Agendado com **${empName}**. Outros profissionais: ${activeEmps.filter(e => e.id !== employeeId).map(e => e.name).join(", ")}.`);
      }
      if (!params.hora) {
        hints.push(`Horario padrao 10:00. Diga a hora desejada na proxima vez.`);
      }

      if (hints.length > 0) {
        msg += `\n**Dicas:**\n${hints.map(h => `- ${h}`).join("\n")}`;
      }

      return {
        success: true,
        message: msg,
        data: appt,
        navigateTo: "/agenda",
      };
    },
  },

  // ── 21. Cancelar Agendamento ──
  {
    id: "cancelar_agendamento",
    name: "Cancelar Agendamento",
    description: "cancelar um agendamento existente",
    requiredParams: ["nome"],
    optionalParams: ["data", "hora"],
    confirmationRequired: true,
    execute: async (params) => {
      const today = new Date();
      const dateStr = params.data ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const dataFormatada = dateStr.split("-").reverse().join("/");

      // Validar cliente no banco
      const client = findClientByName(params.nome);
      const norm = normalize(params.nome);

      const allAppts = appointmentsStore.list({ date: dateStr });
      const matching = allAppts.filter(a =>
        a.status !== "cancelled" &&
        a.clientName &&
        (client ? a.clientId === client.id || normalize(a.clientName).includes(normalize(client.name)) : normalize(a.clientName).includes(norm))
      );

      if (matching.length === 0) {
        // Mostrar agendamentos do dia para ajudar
        const active = allAppts.filter(a => a.status !== "cancelled");
        if (active.length > 0) {
          const emps = employeesStore.list(false);
          const listStr = active.map(a => {
            const h = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
            const emp = emps.find(e => e.id === a.employeeId);
            return `- **${h}** — ${a.clientName ?? "Sem nome"}${emp ? ` c/ ${emp.name}` : ""}`;
          }).join("\n");
          return {
            success: false,
            message: `Nao encontrei agendamentos de "${params.nome}" em ${dataFormatada}.\n\n**Agendamentos do dia:**\n${listStr}\n\nDiga "cancelar agendamento de [nome]" com o nome correto.`,
          };
        }
        return { success: false, message: `Nao encontrei agendamentos para "${params.nome}" em ${dataFormatada}. Nenhum agendamento nesta data.` };
      }

      // Se múltiplos agendamentos, listar para o usuário escolher
      if (matching.length > 1 && !params.hora) {
        const emps = employeesStore.list(false);
        const listStr = matching.map((a, i) => {
          const h = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
          const emp = emps.find(e => e.id === a.employeeId);
          return `${i + 1}. **${h}** — ${a.clientName}${emp ? ` c/ ${emp.name}` : ""}`;
        }).join("\n");
        return {
          success: false,
          message: `Encontrei ${matching.length} agendamentos de "${client?.name ?? params.nome}" em ${dataFormatada}:\n\n${listStr}\n\nInforme o horario para cancelar: "cancelar agendamento de ${client?.name ?? params.nome} as [hora]"`,
        };
      }

      // Se tem hora específica, filtra
      if (params.hora && matching.length > 1) {
        const withHour = matching.filter(a => a.startTime.includes(`T${params.hora}`));
        if (withHour.length === 1) {
          await appointmentsStore.update(withHour[0].id, { status: "cancelled" });
          return { success: true, message: `Agendamento de **${withHour[0].clientName}** as ${params.hora} em ${dataFormatada} cancelado com sucesso.`, navigateTo: "/agenda" };
        }
      }

      // Cancela o encontrado
      const appt = matching[0];
      await appointmentsStore.update(appt.id, { status: "cancelled" });
      const hora = appt.startTime.split("T")[1]?.slice(0, 5) ?? "";
      const empName = employeesStore.list(false).find(e => e.id === appt.employeeId)?.name ?? "";
      return {
        success: true,
        message: `Agendamento cancelado:\n\n- **Cliente:** ${appt.clientName}\n- **Data:** ${dataFormatada}\n- **Horario:** ${hora}\n${empName ? `- **Profissional:** ${empName}\n` : ""}`,
        navigateTo: "/agenda",
      };
    },
  },

  // ── 22. Mover/Reagendar Agendamento ──
  {
    id: "mover_agendamento",
    name: "Mover Agendamento",
    description: "reagendar ou mover um agendamento para outro horario ou data",
    requiredParams: ["nome"],
    optionalParams: ["data", "hora", "funcionario"],
    confirmationRequired: true,
    execute: async (params) => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      // Validar cliente
      const client = findClientByName(params.nome);
      const norm = normalize(params.nome);

      // Buscar agendamentos do cliente (hoje ou futuro)
      const allAppts = appointmentsStore.list({ startDate: todayStr });
      const matching = allAppts.filter(a =>
        a.status !== "cancelled" &&
        a.clientName &&
        (client ? a.clientId === client.id || normalize(a.clientName).includes(normalize(client.name)) : normalize(a.clientName).includes(norm))
      );

      if (matching.length === 0) {
        // Sugerir agendamentos futuros disponíveis
        const futureActive = allAppts.filter(a => a.status !== "cancelled").slice(0, 5);
        if (futureActive.length > 0) {
          const emps = employeesStore.list(false);
          const listStr = futureActive.map(a => {
            const d = a.startTime.split("T")[0].split("-").reverse().join("/");
            const h = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
            const emp = emps.find(e => e.id === a.employeeId);
            return `- **${d} ${h}** — ${a.clientName ?? "Sem nome"}${emp ? ` c/ ${emp.name}` : ""}`;
          }).join("\n");
          return {
            success: false,
            message: `Nao encontrei agendamentos ativos para "${params.nome}".\n\n**Proximos agendamentos:**\n${listStr}`,
          };
        }
        return { success: false, message: `Nao encontrei agendamentos ativos para "${params.nome}".` };
      }

      // Se múltiplos, avisar qual será movido
      const appt = matching[0];
      const originalHora = appt.startTime.split("T")[1]?.slice(0, 5) ?? "";
      const originalData = appt.startTime.split("T")[0].split("-").reverse().join("/");

      const updates: Partial<{ employeeId: number; startTime: string; endTime: string }> = {};

      if (params.data || params.hora) {
        const originalStart = new Date(appt.startTime);
        const duration = new Date(appt.endTime).getTime() - originalStart.getTime();

        const newDate = params.data ?? todayStr;
        let newHour = originalStart.getHours();
        let newMin = originalStart.getMinutes();
        if (params.hora) {
          const parts = params.hora.split(":");
          newHour = parseInt(parts[0], 10);
          newMin = parseInt(parts[1] ?? "0", 10);
        }

        const newStart = `${newDate}T${String(newHour).padStart(2, "0")}:${String(newMin).padStart(2, "0")}:00`;
        const newEndDate = new Date(new Date(newStart).getTime() + duration);
        const newEnd = `${newDate}T${String(newEndDate.getHours()).padStart(2, "0")}:${String(newEndDate.getMinutes()).padStart(2, "0")}:00`;

        // Verificar conflito no novo horário
        const targetEmpId = params.funcionario ? (findEmployeeByName(params.funcionario)?.id ?? appt.employeeId) : appt.employeeId;
        const dayAppts = appointmentsStore.list({ date: newDate });
        const conflicts = dayAppts.filter(a =>
          a.id !== appt.id &&
          a.status !== "cancelled" &&
          a.employeeId === targetEmpId &&
          a.startTime < newEnd &&
          a.endTime > newStart
        );

        if (conflicts.length > 0) {
          const conflictInfo = conflicts.map(a => {
            const h = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
            return `- ${h} — ${a.clientName ?? "Sem nome"}`;
          }).join("\n");
          return {
            success: false,
            message: `Conflito no novo horario!\n\nAgendamentos existentes:\n${conflictInfo}\n\nEscolha outro horario.`,
          };
        }

        updates.startTime = newStart;
        updates.endTime = newEnd;
      }

      if (params.funcionario) {
        const emp = findEmployeeByName(params.funcionario);
        if (!emp) {
          const activeEmps = employeesStore.list(true);
          const empList = activeEmps.map((e, i) => `${i + 1}. **${e.name}**`).join("\n");
          return {
            success: false,
            message: `Profissional "${params.funcionario}" nao encontrado.\n\n**Disponiveis:**\n${empList}`,
          };
        }
        updates.employeeId = emp.id;
      }

      await appointmentsStore.update(appt.id, updates);
      const newHora = updates.startTime?.split("T")[1]?.slice(0, 5) ?? originalHora;
      const newData = params.data ? params.data.split("-").reverse().join("/") : originalData;
      const newEmpName = updates.employeeId
        ? (employeesStore.list(false).find(e => e.id === updates.employeeId)?.name ?? "")
        : (employeesStore.list(false).find(e => e.id === appt.employeeId)?.name ?? "");

      let msg = `Agendamento reagendado com sucesso!\n\n`;
      msg += `- **Cliente:** ${appt.clientName}\n`;
      msg += `- **De:** ${originalData} as ${originalHora}\n`;
      msg += `- **Para:** ${newData} as ${newHora}\n`;
      if (newEmpName) msg += `- **Profissional:** ${newEmpName}\n`;

      return {
        success: true,
        message: msg,
        navigateTo: "/agenda",
      };
    },
  },

  // ── 23. Listar Agendamentos ──
  {
    id: "listar_agendamentos",
    name: "Listar Agendamentos",
    description: "ver os agendamentos do dia ou de uma data especifica",
    requiredParams: [],
    optionalParams: ["data", "nome", "funcionario"],
    confirmationRequired: false,
    execute: async (params) => {
      const today = new Date();
      const dateStr = params.data ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const dataFormatada = dateStr.split("-").reverse().join("/");

      let appts = appointmentsStore.list({ date: dateStr });

      // Filtrar por cliente
      if (params.nome) {
        const client = findClientByName(params.nome);
        if (client) {
          appts = appts.filter(a => a.clientId === client.id || (a.clientName && normalize(a.clientName).includes(normalize(client.name))));
        } else {
          const norm = normalize(params.nome);
          appts = appts.filter(a => a.clientName && normalize(a.clientName).includes(norm));
        }
      }

      // Filtrar por funcionário
      if (params.funcionario) {
        const emp = findEmployeeByName(params.funcionario);
        if (emp) {
          appts = appts.filter(a => a.employeeId === emp.id);
        } else {
          const activeEmps = employeesStore.list(true);
          const empList = activeEmps.map((e, i) => `${i + 1}. **${e.name}**`).join("\n");
          return {
            success: false,
            message: `Profissional "${params.funcionario}" nao encontrado.\n\n**Profissionais:**\n${empList}`,
          };
        }
      }

      const active = appts.filter(a => a.status !== "cancelled");
      const cancelled = appts.filter(a => a.status === "cancelled");

      if (active.length === 0 && cancelled.length === 0) {
        // Sugerir agendar
        const activeEmps = employeesStore.list(true);
        const empNames = activeEmps.slice(0, 3).map(e => e.name).join(", ");
        return {
          success: true,
          message: `Nenhum agendamento em ${dataFormatada}.\n\n${activeEmps.length > 0 ? `Profissionais disponiveis: ${empNames}.\n` : ""}Diga "agendar [cliente] para ${dataFormatada}" para marcar.`,
        };
      }

      const emps = employeesStore.list(false);
      const lines = active
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map(a => {
          const horaInicio = a.startTime.split("T")[1]?.slice(0, 5) ?? "";
          const horaFim = a.endTime.split("T")[1]?.slice(0, 5) ?? "";
          const emp = emps.find(e => e.id === a.employeeId);
          const statusMap: Record<string, string> = {
            completed: " *(concluido)*",
            confirmed: " *(confirmado)*",
            in_progress: " *(em andamento)*",
            scheduled: "",
          };
          const status = statusMap[a.status] ?? "";
          const svcNames = a.services?.map(s => s.name).join(", ") ?? "";
          return `- **${horaInicio}-${horaFim}** — ${a.clientName ?? "Sem nome"}${emp ? ` c/ ${emp.name}` : ""}${svcNames ? ` | ${svcNames}` : ""}${a.totalPrice ? ` | ${formatCurrency(a.totalPrice)}` : ""}${status}`;
        });

      // Resumo
      const totalRevenue = active.reduce((sum, a) => sum + (a.totalPrice ?? 0), 0);
      let msg = `**Agenda ${dataFormatada}** — ${active.length} agendamento(s)${cancelled.length > 0 ? `, ${cancelled.length} cancelado(s)` : ""}\n\n`;
      msg += lines.join("\n");
      if (totalRevenue > 0) {
        msg += `\n\n**Total previsto:** ${formatCurrency(totalRevenue)}`;
      }

      return {
        success: true,
        message: msg,
        navigateTo: "/agenda",
      };
    },
  },

  // ── 24. Reabrir Caixa ──
  {
    id: "reabrir_caixa",
    name: "Reabrir Caixa",
    description: "reabrir um caixa que foi fechado para correcoes",
    requiredParams: [],
    optionalParams: [],
    confirmationRequired: true,
    execute: async () => {
      const current = cashSessionsStore.getCurrent();
      if (current) {
        return { success: false, message: "Ja existe um caixa aberto. Feche-o antes de reabrir outro." };
      }
      const sessions = cashSessionsStore.list();
      const lastClosed = sessions.find(s => s.status === "closed");
      if (!lastClosed) {
        return { success: false, message: "Nao ha caixa fechado para reabrir." };
      }
      const session = await cashSessionsStore.reopen(lastClosed.id);
      return {
        success: true,
        message: `Caixa #${lastClosed.id} reaberto para correcao.`,
        data: session,
        navigateTo: "/caixa",
      };
    },
  },
];

// ─── Registro e lookup ────────────────────────────────────

const toolMap = new Map<string, AgentTool>();
tools.forEach(t => toolMap.set(t.id, t));

export function getToolById(id: string): AgentTool | undefined {
  return toolMap.get(id);
}

export function getAllTools(): AgentTool[] {
  return [...tools];
}

export function findToolByDescription(query: string): AgentTool | null {
  const norm = normalize(query);
  for (const tool of tools) {
    if (normalize(tool.description).includes(norm)) return tool;
    if (normalize(tool.name).includes(norm)) return tool;
  }
  return null;
}

