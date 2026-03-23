/**
 * agentOrchestrator.ts — Orquestrador central do Super Agente.
 * Pipeline: normalizar → contexto → classificar → extrair → resolver tool →
 *           validar params → pedir confirmação → executar → formatar resposta.
 *
 * Este módulo substitui o cascade de if/else do agentBrain.ts para ações/tools,
 * mantendo compatibilidade com as funcionalidades existentes (agenda actions,
 * scheduled commands, reports).
 */

import {
  normalizeText,
  classifyIntent,
  getBestIntent,
  extractEntities,
  detectPhraseType,
  detectComposite,
  type IntentScore,
  type ExtractedEntities,
  type PhraseType,
} from "./agentNLU";

import {
  getToolById,
  getAllTools,
  type ToolResult,
  type AgentTool,
} from "./agentTools";

import {
  addUserTurn,
  addAgentTurn,
  getRecentTurns,
  getLastEntities,
  mergeEntities,
  clearEntities,
  setPendingQuestion,
  getPendingQuestion,
  clearPendingQuestion,
  setPendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  hasRecentConversation,
  getLastIntent,
  userMentionedRecently,
} from "./agentContext";

// ─── Tipos ─────────────────────────────────────────────────

export interface OrchestratorResult {
  message: string;
  navigateTo?: string;
  handled: boolean;
  toolId?: string;
  isAsync?: boolean;
}

// ─── Labels para parâmetros ───────────────────────────────

const PARAM_LABELS: Record<string, string> = {
  nome: "nome",
  telefone: "telefone",
  email: "email",
  cpf: "CPF",
  campo: "qual campo deseja alterar",
  valor: "qual o valor",
  valorCampo: "qual o novo valor",
  termo: "o que deseja buscar",
  pagina: "para qual pagina deseja ir",
  metodo: "qual a forma de pagamento",
  cliente: "nome do cliente",
  funcionario: "nome do funcionario",
  servico: "nome do servico",
  preco: "qual o preco",
  duracao: "qual a duracao em minutos",
  saldo_inicial: "qual o saldo inicial",
  descricao: "alguma descricao",
  comissao: "qual o percentual de comissao",
  observacoes: "alguma observacao",
  filtro: "qual filtro aplicar",
  nascimento: "data de nascimento",
  endereco: "endereco",
  notas: "notas ou observacoes",
  especialidades: "especialidades (separadas por virgula)",
  cor: "cor",
  custo_material: "percentual de custo de material",
};

// ─── Mapeamento de entidades → parâmetros ────────────────

function mapEntitiesToParams(
  entities: ExtractedEntities,
  tool: AgentTool,
): Record<string, string> {
  const params: Record<string, string> = {};
  const allParams = [...tool.requiredParams, ...tool.optionalParams];

  for (const paramName of allParams) {
    // Mapeamento direto
    if (paramName === "nome" && entities.nome) params.nome = entities.nome;
    if (paramName === "telefone" && entities.telefone) params.telefone = entities.telefone;
    if (paramName === "email" && entities.email) params.email = entities.email;
    if (paramName === "cpf" && entities.cpf) params.cpf = entities.cpf;
    if (paramName === "valor" && entities.valor) params.valor = entities.valor;
    if (paramName === "metodo" && entities.metodo) params.metodo = entities.metodo;
    if (paramName === "campo" && entities.campo) params.campo = entities.campo;
    if (paramName === "pagina" && entities.pagina) params.pagina = entities.pagina;
    if (paramName === "termo" && entities.termo) params.termo = entities.termo;
    if (paramName === "cliente" && entities.nome) params.cliente = entities.nome;
    if (paramName === "funcionario" && entities.funcionario) params.funcionario = entities.funcionario;
    if (paramName === "servico" && entities.servico) params.servico = entities.servico;
    if (paramName === "preco" && entities.preco) params.preco = entities.preco;
    if (paramName === "duracao" && entities.duracao) params.duracao = entities.duracao;
    if (paramName === "saldo_inicial" && entities.saldo_inicial) params.saldo_inicial = entities.saldo_inicial;
    if (paramName === "descricao" && entities.descricao) params.descricao = entities.descricao;
    if (paramName === "comissao" && entities.comissao) params.comissao = entities.comissao;
    if (paramName === "nascimento" && entities.nascimento) params.nascimento = entities.nascimento;
    if (paramName === "endereco" && entities.endereco) params.endereco = entities.endereco;
    if (paramName === "notas" && entities.notas) params.notas = entities.notas;
    if (paramName === "especialidades" && entities.especialidades) params.especialidades = entities.especialidades;
    if (paramName === "cor" && entities.cor) params.cor = entities.cor;
    if (paramName === "custo_material" && entities.custo_material) params.custo_material = entities.custo_material;
    if (paramName === "observacoes" && entities.observacoes) params.observacoes = entities.observacoes;
    if (paramName === "filtro" && entities.filtro) params.filtro = entities.filtro;

    // Valor do campo para edição
    if (paramName === "valor" && !params.valor && entities.valorCampo) {
      params.valor = entities.valorCampo;
    }
  }

  // Caso especial: "termo" para busca pode ser o nome
  if (!params.termo && entities.nome) {
    params.termo = entities.nome;
  }

  return params;
}

// ─── Greetings/thanks ───────────────────────────────────

const GREETINGS = [
  "Ola! Como posso ajudar? Posso gerenciar clientes, funcionarios, servicos, caixa e muito mais.",
  "Oi! Estou pronto para ajudar. O que voce precisa?",
  "Ola! Sou seu assistente virtual. Diga o que precisa e eu resolvo!",
];

const THANKS_RESPONSES = [
  "De nada! Se precisar de mais alguma coisa, e so falar.",
  "Disponha! Estou aqui se precisar.",
  "Por nada! Qualquer coisa, me chama.",
];

function randomPick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Pipeline principal ─────────────────────────────────

/**
 * Processa uma mensagem do usuário pelo pipeline do orquestrador.
 * Retorna null se a mensagem não foi tratada por nenhum tool
 * (para que o agentBrain possa tratá-la com a lógica existente).
 */
export async function processMessage(text: string): Promise<OrchestratorResult> {
  const phraseType = detectPhraseType(text);
  const entities = extractEntities(text);

  // ── 0. Verificar confirmação/negação pendente ──
  const pendingConfirm = getPendingConfirmation();
  if (pendingConfirm) {
    if (phraseType === "affirmation") {
      clearPendingConfirmation();
      const tool = getToolById(pendingConfirm.toolId);
      if (tool) {
        try {
          const result = await tool.execute(pendingConfirm.params);
          addUserTurn(text, pendingConfirm.toolId, entities, pendingConfirm.toolId);
          addAgentTurn(result.message, pendingConfirm.toolId, pendingConfirm.toolId);
          return {
            message: result.message,
            navigateTo: result.navigateTo,
            handled: true,
            toolId: pendingConfirm.toolId,
            isAsync: true,
          };
        } catch (err) {
          const errMsg = `Erro ao executar a acao: ${err instanceof Error ? err.message : "erro desconhecido"}`;
          addAgentTurn(errMsg);
          return { message: errMsg, handled: true };
        }
      }
    }
    if (phraseType === "denial") {
      clearPendingConfirmation();
      const msg = "Ok, acao cancelada.";
      addUserTurn(text, "cancel", entities);
      addAgentTurn(msg);
      return { message: msg, handled: true };
    }
  }

  // ── 1. Verificar pergunta pendente (parâmetro faltante) ──
  const pendingQ = getPendingQuestion();
  if (pendingQ) {
    clearPendingQuestion();
    const params = { ...pendingQ.collectedParams };
    // A resposta do usuário é o valor do parâmetro faltante
    const rawAnswer = text.trim();

    // Tentar extrair entidades do campo faltante
    const answerEntities = extractEntities(rawAnswer);
    if (pendingQ.missingParam === "nome" && (answerEntities.nome || rawAnswer)) {
      params[pendingQ.missingParam] = answerEntities.nome ?? rawAnswer;
    } else if (pendingQ.missingParam === "telefone" && (answerEntities.telefone || rawAnswer)) {
      params[pendingQ.missingParam] = answerEntities.telefone ?? rawAnswer;
    } else if (pendingQ.missingParam === "email" && (answerEntities.email || rawAnswer)) {
      params[pendingQ.missingParam] = answerEntities.email ?? rawAnswer;
    } else if (pendingQ.missingParam === "valor" && (answerEntities.valor || rawAnswer)) {
      params[pendingQ.missingParam] = answerEntities.valor ?? rawAnswer;
    } else {
      params[pendingQ.missingParam] = rawAnswer;
    }

    const tool = getToolById(pendingQ.toolId);
    if (tool) {
      // Verificar se ainda faltam parâmetros
      const stillMissing = tool.requiredParams.filter(p => !params[p]);
      if (stillMissing.length > 0) {
        const nextMissing = stillMissing[0];
        const label = PARAM_LABELS[nextMissing] ?? nextMissing;
        setPendingQuestion(tool.id, nextMissing, `Qual ${label}?`, params);
        const msg = `Entendi! E ${label}?`;
        addUserTurn(text, tool.id, answerEntities, tool.id);
        addAgentTurn(msg, tool.id, tool.id);
        return { message: msg, handled: true, toolId: tool.id };
      }

      // Todos os parâmetros coletados
      if (tool.confirmationRequired) {
        const desc = formatConfirmationMessage(tool, params);
        setPendingConfirmation(tool.id, params, desc);
        addUserTurn(text, tool.id, answerEntities, tool.id);
        addAgentTurn(desc, tool.id, tool.id);
        return { message: desc, handled: true, toolId: tool.id };
      }

      try {
        const result = await tool.execute(params);
        addUserTurn(text, tool.id, answerEntities, tool.id);
        addAgentTurn(result.message, tool.id, tool.id);
        return {
          message: result.message,
          navigateTo: result.navigateTo,
          handled: true,
          toolId: tool.id,
          isAsync: true,
        };
      } catch (err) {
        const errMsg = `Erro: ${err instanceof Error ? err.message : "erro desconhecido"}`;
        addAgentTurn(errMsg);
        return { message: errMsg, handled: true };
      }
    }
  }

  // ── 2. Saudações e agradecimentos ──
  if (phraseType === "greeting") {
    const msg = randomPick(GREETINGS);
    addUserTurn(text, "greeting", entities);
    addAgentTurn(msg, "greeting");
    return { message: msg, handled: true };
  }

  if (phraseType === "thanks") {
    const msg = randomPick(THANKS_RESPONSES);
    addUserTurn(text, "thanks", entities);
    addAgentTurn(msg, "thanks");
    return { message: msg, handled: true };
  }

  // ── 3. Detectar composição (múltiplas ações) ──
  const composite = detectComposite(text);
  if (composite.isComposite && composite.parts.length >= 2) {
    const results: string[] = [];
    let lastNavigate: string | undefined;
    for (const part of composite.parts) {
      const partResult = await processSingleIntent(part);
      if (partResult.handled) {
        results.push(partResult.message);
        if (partResult.navigateTo) lastNavigate = partResult.navigateTo;
      }
    }
    if (results.length > 0) {
      const msg = results.join("\n\n---\n\n");
      addUserTurn(text, "composite", entities);
      addAgentTurn(msg, "composite");
      return { message: msg, navigateTo: lastNavigate, handled: true };
    }
  }

  // ── 4. Classificar intenção e executar ──
  return processSingleIntent(text);
}

/** Processa uma única intenção (usado tanto no fluxo normal quanto em composição) */
async function processSingleIntent(text: string): Promise<OrchestratorResult> {
  const entities = extractEntities(text);
  const scores = classifyIntent(text);
  const best = scores.length > 0 ? scores[0] : null;

  if (!best || best.score < 3) {
    // Nenhum tool match — retornar para agentBrain tratar
    addUserTurn(text, undefined, entities);
    return { message: "", handled: false };
  }

  // ── Desambiguação ──
  if (scores.length >= 2 && best.confidence === "low" && scores[1].score >= best.score - 1) {
    const options = scores.slice(0, 3).map((s, i) => `${i + 1}. ${getToolById(s.toolId)?.name ?? s.intent}`);
    const msg = `Nao tenho certeza do que voce quer. Voce quis dizer:\n\n${options.join("\n")}\n\nPode especificar melhor?`;
    addUserTurn(text, "ambiguous", entities);
    addAgentTurn(msg, "ambiguous");
    return { message: msg, handled: true };
  }

  const tool = getToolById(best.toolId);
  if (!tool) {
    addUserTurn(text, best.intent, entities);
    return { message: "", handled: false };
  }

  // ── Mapear entidades → parâmetros ──
  const contextEntities = hasRecentConversation() ? getLastEntities() : {};
  const mergedEntities = { ...contextEntities, ...entities };
  const params = mapEntitiesToParams(mergedEntities, tool);

  // ── Verificar parâmetros obrigatórios ──
  const missing = tool.requiredParams.filter(p => !params[p]);
  if (missing.length > 0) {
    const firstMissing = missing[0];
    const label = PARAM_LABELS[firstMissing] ?? firstMissing;
    setPendingQuestion(tool.id, firstMissing, `Qual ${label}?`, params);
    const msg = `Certo! Para ${tool.description}, preciso saber: qual ${label}?`;
    addUserTurn(text, best.intent, entities, tool.id);
    addAgentTurn(msg, best.intent, tool.id);
    return { message: msg, handled: true, toolId: tool.id };
  }

  // ── Confirmação ──
  if (tool.confirmationRequired) {
    const desc = formatConfirmationMessage(tool, params);
    setPendingConfirmation(tool.id, params, desc);
    addUserTurn(text, best.intent, entities, tool.id);
    addAgentTurn(desc, best.intent, tool.id);
    return { message: desc, handled: true, toolId: tool.id };
  }

  // ── Executar ──
  try {
    const result = await tool.execute(params);
    addUserTurn(text, best.intent, entities, tool.id);
    addAgentTurn(result.message, best.intent, tool.id);
    clearEntities();
    return {
      message: result.message,
      navigateTo: result.navigateTo,
      handled: true,
      toolId: tool.id,
      isAsync: true,
    };
  } catch (err) {
    const errMsg = `Desculpe, ocorreu um erro ao executar essa acao: ${err instanceof Error ? err.message : "erro desconhecido"}. Tente novamente.`;
    addUserTurn(text, best.intent, entities, tool.id);
    addAgentTurn(errMsg, best.intent, tool.id);
    return { message: errMsg, handled: true };
  }
}

// ─── Helpers ────────────────────────────────────────────

function formatConfirmationMessage(tool: AgentTool, params: Record<string, string>): string {
  const paramLines = Object.entries(params)
    .map(([k, v]) => `- ${PARAM_LABELS[k] ?? k}: **${v}**`)
    .join("\n");

  return `Vou **${tool.description}** com os seguintes dados:\n\n${paramLines}\n\nConfirma? (sim/nao)`;
}

// ─── Sugestões proativas inteligentes ───────────────────

export interface ProactiveSuggestion {
  id: string;
  message: string;
  priority: "high" | "medium" | "low";
  action?: string;
}

export function getProactiveSuggestions(): ProactiveSuggestion[] {
  const suggestions: ProactiveSuggestion[] = [];

  // Sugestão de abertura de caixa
  try {
    const { cashSessionsStore } = require("./store");
    const current = cashSessionsStore.getCurrent();
    if (!current) {
      const now = new Date();
      if (now.getHours() >= 7 && now.getHours() <= 10) {
        suggestions.push({
          id: "open_cash",
          message: "Bom dia! O caixa ainda nao foi aberto. Quer que eu abra?",
          priority: "high",
          action: "abrir caixa",
        });
      }
    }
  } catch { /* ignore */ }

  // Sugestão de fechamento de caixa
  try {
    const { cashSessionsStore } = require("./store");
    const current = cashSessionsStore.getCurrent();
    if (current) {
      const now = new Date();
      if (now.getHours() >= 19) {
        suggestions.push({
          id: "close_cash",
          message: "Ja e fim de expediente. Quer fechar o caixa de hoje?",
          priority: "medium",
          action: "fechar caixa",
        });
      }
    }
  } catch { /* ignore */ }

  return suggestions;
}

// ─── Quick actions dinâmicas ────────────────────────────

export interface DynamicQuickAction {
  label: string;
  query: string;
  icon?: string;
}

export function getDynamicQuickActions(currentPage: string): DynamicQuickAction[] {
  const page = currentPage.replace(/^\//, "").split("/")[0] || "dashboard";
  const actions: DynamicQuickAction[] = [];

  const baseActions: Record<string, DynamicQuickAction[]> = {
    dashboard: [
      { label: "Resumo do dia", query: "resumo de hoje", icon: "chart" },
      { label: "Faturamento do mes", query: "quanto faturei este mes?", icon: "dollar" },
      { label: "Abrir caixa", query: "abrir caixa", icon: "cash" },
      { label: "Clientes inativos", query: "listar clientes inativos", icon: "users" },
    ],
    agenda: [
      { label: "Agenda de hoje", query: "como esta minha agenda hoje?", icon: "calendar" },
      { label: "Cancelamentos do mes", query: "quantos cancelamentos este mes?", icon: "x" },
      { label: "Novo agendamento", query: "como agendar?", icon: "plus" },
    ],
    clientes: [
      { label: "Cadastrar cliente", query: "cadastrar novo cliente", icon: "plus" },
      { label: "Clientes inativos", query: "listar clientes inativos", icon: "users" },
      { label: "Buscar cliente", query: "buscar cliente", icon: "search" },
      { label: "Aniversariantes", query: "aniversariantes da semana", icon: "cake" },
    ],
    funcionarios: [
      { label: "Cadastrar funcionario", query: "cadastrar novo funcionario", icon: "plus" },
      { label: "Ver equipe", query: "listar funcionarios", icon: "users" },
      { label: "Comissoes", query: "quanto devo de comissao?", icon: "dollar" },
    ],
    servicos: [
      { label: "Cadastrar servico", query: "cadastrar novo servico", icon: "plus" },
      { label: "Ver catalogo", query: "listar servicos", icon: "list" },
      { label: "Mais populares", query: "quais servicos mais populares?", icon: "star" },
    ],
    caixa: [
      { label: "Status do caixa", query: "como esta o caixa?", icon: "cash" },
      { label: "Registrar pagamento", query: "registrar pagamento", icon: "dollar" },
      { label: "Fechar caixa", query: "fechar caixa", icon: "x" },
    ],
    relatorios: [
      { label: "Faturamento semanal", query: "relatorio de faturamento da semana", icon: "chart" },
      { label: "Servicos populares", query: "servicos mais populares do mes", icon: "star" },
      { label: "Resumo completo", query: "resumo completo do mes", icon: "file" },
    ],
    configuracoes: [
      { label: "Alterar nome", query: "alterar nome do salao", icon: "edit" },
      { label: "Backup", query: "exportar backup", icon: "download" },
    ],
    backup: [
      { label: "Exportar backup", query: "exportar backup", icon: "download" },
    ],
    historico: [
      { label: "Historico geral", query: "historico de atendimentos", icon: "clock" },
    ],
  };

  const pageActions = baseActions[page] ?? baseActions.dashboard;
  actions.push(...pageActions);

  // Ações contextuais baseadas no último intent
  const lastIntent = getLastIntent();
  if (lastIntent) {
    if (lastIntent === "criar_cliente") {
      actions.unshift({ label: "Cadastrar outro cliente", query: "cadastrar novo cliente", icon: "plus" });
    }
    if (lastIntent === "buscar_cliente") {
      actions.unshift({ label: "Buscar outro", query: "buscar cliente", icon: "search" });
    }
  }

  // Limitar a 6 ações
  return actions.slice(0, 6);
}

// ─── Phrase templates ───────────────────────────────────

export const PHRASE_TEMPLATES = [
  // Clientes
  "Cadastrar cliente {nome}",
  "Buscar cliente {nome}",
  "Historico do cliente {nome}",
  "Clientes inativos",
  "Aniversariantes da semana",
  // Funcionários
  "Cadastrar funcionario {nome}",
  "Listar funcionarios",
  "Ver comissoes",
  // Serviços
  "Cadastrar servico {nome} por R$ {valor}",
  "Listar servicos",
  // Caixa
  "Abrir caixa",
  "Fechar caixa",
  "Status do caixa",
  "Registrar pagamento de {nome} R$ {valor} em {metodo}",
  // Navegação
  "Ir para {pagina}",
  // Relatórios
  "Resumo de hoje",
  "Faturamento da semana",
  "Relatorio completo do mes",
  // Config
  "Alterar nome do salao para {nome}",
  "Exportar backup",
];
