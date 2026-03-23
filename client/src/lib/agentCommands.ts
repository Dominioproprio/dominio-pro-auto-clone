/**
 * agentCommands.ts — Parser de comandos em linguagem natural.
 * Interpreta ordens do usuario e as converte em tarefas agendadas ou acoes imediatas.
 *
 * Exemplos de comandos suportados:
 * - "me avisa todo sabado o rendimento da semana"
 * - "todo dia me mostra o resumo de agendamentos"
 * - "me lembra de fazer backup toda segunda"
 * - "mostra o resumo do mes todo dia 1"
 * - "cancela o aviso de sabado"
 * - "quais avisos tenho?"
 * - "para de me avisar sobre rendimento"
 */

import {
  createTask,
  removeTask,
  listAllTasks,
  listActiveTasks,
  formatTaskDescription,
  type TaskFrequency,
  type ReportType,
  type ScheduledTask,
  DAY_NAMES,
} from "./agentScheduler";

// ─── Tipos ─────────────────────────────────────────────────

export interface CommandResult {
  understood: boolean;
  type: "task_created" | "task_removed" | "task_list" | "task_not_found" | "help" | "unknown";
  message: string;
  task?: ScheduledTask;
  tasks?: ScheduledTask[];
}

// ─── Normalizacao ──────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Deteccao de intencao ──────────────────────────────────

interface ParsedIntent {
  isCommand: boolean;
  isCancel: boolean;
  isList: boolean;
  frequency: TaskFrequency | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  time: string | null;
  reportType: ReportType | null;
  periodScope: "dia" | "semana" | "mes" | "mes_anterior" | null;
  rawText: string;
}

/** Detecta se o texto e um comando (e nao uma pergunta) */
function isCommandIntent(q: string): boolean {
  const commandPatterns = [
    /me\s+avis[aeo]/,
    /me\s+lembr[aeo]/,
    /me\s+mostr[aeo]\s+todo/,
    /me\s+envie?/,
    /me\s+mand[aeo]/,
    /me\s+notifi[cq]/,
    /tod[oa]\s+(dia|segunda|terca|quarta|quinta|sexta|sabado|domingo)/,
    /todo\s+dia\s+\d+/,
    /semanalmente/,
    /mensalmente/,
    /diariamente/,
    /agendar?\s+(aviso|lembrete|relatorio|notificacao)/,
    /criar?\s+(aviso|lembrete|relatorio|notificacao)/,
    /configur[ae]\s+(aviso|lembrete|relatorio|notificacao)/,
  ];
  return commandPatterns.some(p => p.test(q));
}

function isCancelIntent(q: string): boolean {
  const patterns = [
    /cancel[ae]/,
    /remov[ae]/,
    /delet[ae]/,
    /exclu[iae]/,
    /par[ae]\s+de\s+me\s+avis/,
    /par[ae]\s+de\s+me\s+lembr/,
    /desativ[ae]/,
    /tir[ae]\s+o\s+aviso/,
    /remove\s+o\s+aviso/,
  ];
  return patterns.some(p => p.test(q));
}

function isListIntent(q: string): boolean {
  const patterns = [
    /quais?\s+(aviso|lembrete|tarefa|notificac|agendamento)/,
    /lista?\s+(aviso|lembrete|tarefa|notificac)/,
    /mostr[ae]\s+(meus\s+)?(aviso|lembrete|tarefa|notificac)/,
    /tenho\s+(aviso|lembrete|tarefa|notificac)/,
    /meus\s+(aviso|lembrete|tarefa|notificac)/,
    /avisos\s+configurad/,
    /tarefas\s+agendad/,
  ];
  return patterns.some(p => p.test(q));
}

// ─── Parse de frequencia ───────────────────────────────────

function parseFrequency(q: string): { frequency: TaskFrequency | null; dayOfWeek: number | null; dayOfMonth: number | null } {
  // Diario
  if (/tod[oa]\s+dia(?!\s+\d)/.test(q) || /diariamente/.test(q)) {
    return { frequency: "diario", dayOfWeek: null, dayOfMonth: null };
  }

  // Semanal por dia da semana
  const dayPatterns: Array<{ pattern: RegExp; day: number }> = [
    { pattern: /tod[oa]\s+domingo|aos\s+domingos/, day: 0 },
    { pattern: /tod[oa]\s+segunda|as\s+segundas/, day: 1 },
    { pattern: /tod[oa]\s+terca|as\s+tercas/, day: 2 },
    { pattern: /tod[oa]\s+quarta|as\s+quartas/, day: 3 },
    { pattern: /tod[oa]\s+quinta|as\s+quintas/, day: 4 },
    { pattern: /tod[oa]\s+sexta|as\s+sextas/, day: 5 },
    { pattern: /tod[oa]\s+sabado|aos\s+sabados/, day: 6 },
  ];

  for (const { pattern, day } of dayPatterns) {
    if (pattern.test(q)) {
      return { frequency: "semanal", dayOfWeek: day, dayOfMonth: null };
    }
  }

  // Semanal generico
  if (/semanalmente/.test(q) || /toda\s+semana/.test(q)) {
    return { frequency: "semanal", dayOfWeek: 1, dayOfMonth: null }; // default segunda
  }

  // Mensal por dia do mes
  const monthDayMatch = q.match(/todo\s+dia\s+(\d{1,2})/);
  if (monthDayMatch) {
    const day = parseInt(monthDayMatch[1], 10);
    if (day >= 1 && day <= 31) {
      return { frequency: "mensal", dayOfWeek: null, dayOfMonth: day };
    }
  }

  if (/mensalmente/.test(q) || /todo\s+mes/.test(q)) {
    return { frequency: "mensal", dayOfWeek: null, dayOfMonth: 1 };
  }

  return { frequency: null, dayOfWeek: null, dayOfMonth: null };
}

// ─── Parse de horario ──────────────────────────────────────

function parseTime(q: string): string | null {
  // "as 9h", "as 09:00", "as 14h30", "9 horas", etc.
  const timePatterns = [
    /(?:as?\s+)?(\d{1,2}):(\d{2})/,
    /(?:as?\s+)?(\d{1,2})\s*h\s*(\d{2})?/,
    /(?:as?\s+)?(\d{1,2})\s*horas?/,
  ];

  for (const pattern of timePatterns) {
    const match = q.match(pattern);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2] ?? "0", 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    }
  }

  return null;
}

// ─── Parse de tipo de relatorio ────────────────────────────

function parseReportType(q: string): { reportType: ReportType; periodScope: "dia" | "semana" | "mes" | "mes_anterior" } {
  // Rendimento/faturamento liquido
  if (/liquid[oa]/.test(q) || /lucro\s+liquid/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "rendimento_liquido", periodScope: scope };
  }

  // Rendimento/faturamento bruto
  if (/rendimento|faturamento|faturei|ganho|receita|bruto|valor\s+total|quanto/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "rendimento_bruto", periodScope: scope };
  }

  // Agendamentos
  if (/agendamento|agenda|atendimento/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "agendamentos", periodScope: scope };
  }

  // Cancelamentos
  if (/cancelamento|falta|no.?show/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "cancelamentos", periodScope: scope };
  }

  // Clientes
  if (/cliente/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "clientes", periodScope: scope };
  }

  // Servicos
  if (/servico|popular/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "servicos_populares", periodScope: scope };
  }

  // Backup/lembrete generico
  if (/backup/.test(q)) {
    return { reportType: "resumo_completo", periodScope: "semana" };
  }

  // Resumo completo
  if (/resumo|completo|geral/.test(q)) {
    const scope = detectPeriodScope(q);
    return { reportType: "resumo_completo", periodScope: scope };
  }

  // Default
  const scope = detectPeriodScope(q);
  return { reportType: "resumo_completo", periodScope: scope };
}

function detectPeriodScope(q: string): "dia" | "semana" | "mes" | "mes_anterior" {
  if (/mes\s+anterior|mes\s+passado/.test(q)) return "mes_anterior";
  if (/dia|diario|hoje/.test(q)) return "dia";
  if (/semana|semanal/.test(q)) return "semana";
  if (/mes|mensal/.test(q)) return "mes";
  // Inferir do frequency
  if (/sabado|sexta|segunda|domingo|terca|quarta|quinta|semanal/.test(q)) return "semana";
  if (/todo\s+dia\s+\d/.test(q) || /mensal/.test(q)) return "mes";
  return "semana"; // default
}

// ─── Parse completo ────────────────────────────────────────

function parseIntent(text: string): ParsedIntent {
  const q = normalize(text);

  const { frequency, dayOfWeek, dayOfMonth } = parseFrequency(q);
  const time = parseTime(q);
  const { reportType, periodScope } = parseReportType(q);

  return {
    isCommand: isCommandIntent(q),
    isCancel: isCancelIntent(q),
    isList: isListIntent(q),
    frequency,
    dayOfWeek,
    dayOfMonth,
    time,
    reportType,
    periodScope,
    rawText: text,
  };
}

// ─── Gerar label legivel ───────────────────────────────────

function generateLabel(intent: ParsedIntent): string {
  const reportLabels: Record<ReportType, string> = {
    rendimento_bruto: "Rendimento bruto",
    rendimento_liquido: "Rendimento liquido",
    agendamentos: "Resumo de agendamentos",
    clientes: "Resumo de clientes",
    cancelamentos: "Cancelamentos e faltas",
    servicos_populares: "Servicos populares",
    resumo_completo: "Resumo completo",
  };

  const scopeLabels: Record<string, string> = {
    dia: "do dia",
    semana: "da semana",
    mes: "do mes",
    mes_anterior: "do mes anterior",
  };

  const freqLabels: Record<TaskFrequency, string> = {
    diario: "Todo dia",
    semanal: `Toda ${DAY_NAMES[intent.dayOfWeek ?? 1]}`,
    mensal: `Todo dia ${intent.dayOfMonth ?? 1}`,
    unico: "Uma vez",
  };

  const report = reportLabels[intent.reportType ?? "resumo_completo"];
  const scope = scopeLabels[intent.periodScope ?? "semana"];
  const freq = freqLabels[intent.frequency ?? "semanal"];

  return `${freq} — ${report} ${scope}`;
}

// ─── Processamento principal ───────────────────────────────

export function processCommand(text: string): CommandResult {
  const intent = parseIntent(text);

  // ── Listar tarefas ──
  if (intent.isList) {
    const tasks = listAllTasks();
    if (tasks.length === 0) {
      return {
        understood: true,
        type: "task_list",
        message: "Voce nao tem nenhum aviso ou lembrete configurado ainda.\n\nVoce pode me pedir coisas como:\n- \"Me avisa todo sabado o rendimento da semana\"\n- \"Todo dia me mostra o resumo de agendamentos\"\n- \"Me lembra todo dia 1 o faturamento do mes\"",
        tasks: [],
      };
    }

    const lines = tasks.map((t, i) => {
      const status = t.active ? "Ativo" : "Pausado";
      return `${i + 1}. ${formatTaskDescription(t)} [${status}]`;
    });

    return {
      understood: true,
      type: "task_list",
      message: `Voce tem **${tasks.length} aviso(s)** configurado(s):\n\n${lines.join("\n")}\n\nPara cancelar, diga "cancela o aviso X" ou "para de me avisar sobre Y".`,
      tasks,
    };
  }

  // ── Cancelar tarefa ──
  if (intent.isCancel) {
    const tasks = listAllTasks();
    if (tasks.length === 0) {
      return {
        understood: true,
        type: "task_not_found",
        message: "Voce nao tem nenhum aviso ou lembrete para cancelar.",
      };
    }

    // Tentar encontrar a tarefa pelo conteudo
    const q = normalize(text);
    let matched: ScheduledTask | null = null;

    for (const task of tasks) {
      const taskNorm = normalize(task.label + " " + task.createdByCommand);
      // Verificar se menciona o dia
      if (intent.dayOfWeek !== null && task.dayOfWeek === intent.dayOfWeek) {
        matched = task;
        break;
      }
      // Verificar report type
      if (intent.reportType && task.reportType === intent.reportType) {
        matched = task;
        break;
      }
      // Verificar por palavras-chave
      const keywords = q.split(" ").filter(w => w.length > 3);
      const matchCount = keywords.filter(k => taskNorm.includes(k)).length;
      if (matchCount >= 2) {
        matched = task;
        break;
      }
    }

    // Se so tem 1 tarefa e o usuario quer cancelar, cancela essa
    if (!matched && tasks.length === 1) {
      matched = tasks[0];
    }

    if (matched) {
      removeTask(matched.id);
      return {
        understood: true,
        type: "task_removed",
        message: `Pronto! Cancelei o aviso: **${formatTaskDescription(matched)}**.\n\nSe quiser recriar, e so me pedir novamente.`,
        task: matched,
      };
    }

    // Nao conseguiu identificar qual
    const lines = tasks.map((t, i) => `${i + 1}. ${formatTaskDescription(t)}`);
    return {
      understood: true,
      type: "task_not_found",
      message: `Nao consegui identificar qual aviso voce quer cancelar. Seus avisos atuais sao:\n\n${lines.join("\n")}\n\nDiga algo como "cancela o aviso 1" ou "para de me avisar sobre rendimento".`,
      tasks,
    };
  }

  // ── Criar tarefa ──
  if (intent.isCommand && intent.frequency) {
    // Verificar duplicatas
    const existing = listActiveTasks();
    const duplicate = existing.find(t =>
      t.frequency === intent.frequency &&
      t.dayOfWeek === intent.dayOfWeek &&
      t.reportType === intent.reportType
    );

    if (duplicate) {
      return {
        understood: true,
        type: "task_created",
        message: `Voce ja tem um aviso parecido: **${formatTaskDescription(duplicate)}**.\n\nSe quiser modificar, cancele o atual e crie um novo.`,
        task: duplicate,
      };
    }

    const label = generateLabel(intent);
    const task = createTask({
      label,
      frequency: intent.frequency,
      dayOfWeek: intent.dayOfWeek ?? undefined,
      dayOfMonth: intent.dayOfMonth ?? undefined,
      time: intent.time ?? "09:00",
      reportType: intent.reportType ?? "resumo_completo",
      periodScope: intent.periodScope ?? "semana",
      createdByCommand: text,
    });

    const nextDate = new Date(task.nextRun);
    const nextStr = nextDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const timeStr = task.time;

    return {
      understood: true,
      type: "task_created",
      message: `Pronto! Configurei o aviso:\n\n**${formatTaskDescription(task)}**\n\nProximo aviso: ${nextStr} as ${timeStr}.\nVoce recebera uma notificacao aqui no chat e tambem no navegador (se permitir).`,
      task,
    };
  }

  // ── Comando parcial (entendeu a intencao mas falta info) ──
  if (intent.isCommand && !intent.frequency) {
    return {
      understood: true,
      type: "help",
      message: "Entendi que voce quer configurar um aviso! Mas preciso de mais detalhes.\n\nMe diga a frequencia, por exemplo:\n- \"Me avisa **todo sabado** o rendimento da semana\"\n- \"**Todo dia** me mostra o resumo\"\n- \"Me lembra **todo dia 1** do faturamento do mes\"\n\nQual frequencia voce prefere?",
    };
  }

  // ── Nao entendeu ──
  return {
    understood: false,
    type: "unknown",
    message: "",
  };
}

// ─── Deteccao: e um comando ou pergunta? ───────────────────

export function isScheduleCommand(text: string): boolean {
  const q = normalize(text);
  return isCommandIntent(q) || isCancelIntent(q) || isListIntent(q);
}
