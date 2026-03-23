/**
 * agentActions.ts — Sistema de ações de escrita na agenda.
 * Revisado para maior precisão em datas e prevenção de colisões.
 */

// ... (Tipos e interfaces permanecem os mesmos)

// ─── Melhoria na Lógica de Datas ────────────────────────────

function parseDateFromText(q: string, context: "source" | "target"): { date: string | null; dayOfWeek: number | null } {
  const now = new Date();
  const qNorm = normalize(q);

  if (qNorm.includes("hoje")) return { date: toDateStr(now), dayOfWeek: now.getDay() };
  
  if (qNorm.includes("amanha")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: toDateStr(d), dayOfWeek: d.getDay() };
  }

  // Regex melhorada para "dia 10", "dia 10/05", "dia 10 de maio"
  const dayMatch = qNorm.match(/dia\s+(\d{1,2})(?:\s*(?:\/|de)\s*(\d{1,2}|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))?/);
  
  if (dayMatch) {
    let day = parseInt(dayMatch[1], 10);
    let month = now.getMonth();
    
    if (dayMatch[2]) {
      const mMatch = dayMatch[2];
      if (!isNaN(parseInt(mMatch))) {
        month = parseInt(mMatch) - 1;
      } else {
        const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
        month = months.findIndex(m => mMatch.startsWith(m));
      }
    }
    
    let targetDate = new Date(now.getFullYear(), month, day);
    // Se a data já passou e estamos no contexto "target", assume o próximo ano ou mês
    if (context === "target" && targetDate < now && !dayMatch[2]) {
       targetDate.setMonth(targetDate.getMonth() + 1);
    }
    return { date: toDateStr(targetDate), dayOfWeek: targetDate.getDay() };
  }

  // Dias da semana
  for (let i = 0; i < DAY_NAMES_PT.length; i++) {
    if (qNorm.includes(DAY_NAMES_PT[i])) {
      const currentDay = now.getDay();
      let daysUntil = i - currentDay;

      if (context === "target") {
        if (daysUntil <= 0) daysUntil += 7; // Próxima ocorrência
      } else {
        // Source: Se eu digo na terça "Mover de segunda...", eu provavelmente falo da segunda de ONTEM.
        if (daysUntil > 3) daysUntil -= 7; 
        if (daysUntil < -3) daysUntil += 7;
      }

      const d = new Date(now);
      d.setDate(d.getDate() + daysUntil);
      return { date: toDateStr(d), dayOfWeek: i };
    }
  }

  return { date: null, dayOfWeek: null };
}

// ─── Validação de Conflito de Horário ───────────────────────

function checkConflict(employeeId: number, start: Date, end: Date): string | null {
  const appts = appointmentsStore.list({ employeeId });
  const conflict = appts.find(a => {
    if (a.status === "cancelled") return false;
    const aStart = new Date(a.startTime);
    const aEnd = new Date(a.endTime);
    return (start < aEnd && end > aStart);
  });

  if (conflict) {
    const time = new Date(conflict.startTime).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
    return `O profissional já tem um agendamento com ${conflict.clientName} às ${time}.`;
  }
  return null;
}

// ─── Preparar Criação (Com verificação de conflito) ──────────

function prepareCreateAppointment(params: ActionParams): ActionResult {
  // ... (Busca de cliente, funcionário e serviço como no seu original)

  // Cálculo de horários
  const [h, m] = params.targetTime!.split(":").map(Number);
  const [y, mon, d] = params.targetDate!.split("-").map(Number);
  const startTime = new Date(y, mon - 1, d, h, m);
  const duration = params.duration || 60;
  const endTime = new Date(startTime.getTime() + duration * 60000);

  // Verificação de conflito
  let warning = "";
  if (employee) {
    const conflictMsg = checkConflict(employee.id, startTime, endTime);
    if (conflictMsg) {
      warning = `\n\n⚠️ **Atenção:** ${conflictMsg} Deseja agendar mesmo assim?`;
    }
  }

  // ... (Montagem do objeto PendingAction igual ao seu)

  return {
    success: true,
    message: `${details}${warning}\n\n**Confirma o agendamento?** (sim/não)`,
    pendingAction,
  };
}

// ─── Execução com Proteção ───────────────────────────────────

export function executeAction(actionId: string): ActionResult {
  const pending = loadPendingActions();
  const idx = pending.findIndex(a => a.id === actionId);
  const action = pending[idx];

  if (!action || action.status !== "pending_confirmation") {
    return { success: false, message: "Ação expirada ou já executada." };
  }

  try {
    // Para criação, garantimos que o preço e serviços sigam a estrutura do Store
    if (action.type === "create_appointment") {
       // ... lógica de appointmentsStore.create
    }
    
    // Marcar como executada e remover das pendentes ativas
    action.status = "executed";
    savePendingActions(pending);
    
    return { success: true, message: "Operação realizada com sucesso! ✅" };
  } catch (err) {
    return { success: false, message: "Erro técnico ao salvar no banco de dados." };
  }
}
