/**
 * agentNLU.ts — Natural Language Understanding para PT-BR.
 * Classificador de intencoes por pontuacao (scoring), extração de entidades
 * genérica e normalização de texto com suporte a sinônimos e abreviações.
 *
 * 100% client-side — sem chamadas a APIs externas.
 */

// ─── Normalização PT-BR ───────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  "func": "funcionario",
  "funcs": "funcionarios",
  "config": "configuracao",
  "configs": "configuracoes",
  "svc": "servico",
  "svcs": "servicos",
  "cli": "cliente",
  "clis": "clientes",
  "qtd": "quantidade",
  "qts": "quantos",
  "qtas": "quantas",
  "agd": "agendamento",
  "agds": "agendamentos",
  "ag": "agenda",
  "cx": "caixa",
  "rel": "relatorio",
  "rels": "relatorios",
  "pag": "pagamento",
  "pags": "pagamentos",
  "pgto": "pagamento",
  "pgtos": "pagamentos",
  "bkp": "backup",
  "pf": "por favor",
  "obg": "obrigado",
  "vlw": "valeu",
  "tks": "obrigado",
  "fone": "telefone",
  "cel": "celular",
  "tel": "telefone",
  "dinheiro": "dinheiro",
  "debit": "debito",
  "cred": "credito",
  "prof": "profissional",
  "profs": "profissionais",
  "cab": "cabeleireiro",
  "barb": "barbeiro",
};

const SYNONYMS: Record<string, string[]> = {
  "criar": ["cadastrar", "adicionar", "novo", "nova", "registrar", "add", "incluir", "inserir", "botar", "colocar", "por"],
  "agendar": ["marcar", "reservar", "booking", "agendar", "schedule", "agende", "marca", "agendem", "marquem"],
  "editar": ["alterar", "mudar", "modificar", "atualizar", "trocar", "corrigir", "ajustar", "update"],
  "excluir": ["deletar", "remover", "apagar", "eliminar", "tirar", "excluir"],
  "buscar": ["procurar", "encontrar", "achar", "pesquisar", "search", "localizar", "onde"],
  "listar": ["mostrar", "ver", "exibir", "quais", "todos", "todas", "lista", "show"],
  "abrir": ["iniciar", "comecar", "start", "abrir"],
  "fechar": ["encerrar", "finalizar", "terminar", "concluir", "close"],
  "navegar": ["ir", "abrir pagina", "vai", "va", "me leva", "leve-me", "acessar", "visitar", "entrar"],
  "consultar": ["verificar", "checar", "consultar", "status", "como esta", "situacao"],
  "registrar": ["lancar", "anotar", "registrar", "lancamento", "entrada"],
  "exportar": ["baixar", "download", "exportar", "salvar"],
  "configurar": ["definir", "setar", "configurar", "ajustar", "personalizar"],
  "cliente": ["consumidor", "fregues", "cliente"],
  "funcionario": ["profissional", "barbeiro", "cabeleireiro", "cabeleireira", "manicure", "colaborador", "empregado", "atendente"],
  "servico": ["procedimento", "tratamento", "servico", "corte", "escova", "manicure", "pedicure", "tintura", "coloracao", "hidratacao", "alisamento", "progressiva"],
  "caixa": ["financeiro", "dinheiro", "grana", "caixa", "receita", "faturamento"],
  "agenda": ["horario", "calendario", "schedule", "agenda", "agendamento", "marcado", "compromisso"],
  "relatorio": ["resumo", "balanco", "fechamento", "resultado", "report", "analise", "estatistica"],
  "historico": ["passado", "anterior", "registro", "log", "historico"],
};

export function normalizeText(text: string): string {
  let q = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Expandir abreviações
  const words = q.split(" ");
  const expanded = words.map(w => ABBREVIATIONS[w] ?? w);
  q = expanded.join(" ");

  return q;
}

/** Retorna a forma canônica de um sinônimo (ex: "cadastrar" → "criar") */
export function resolveCanonical(word: string): string {
  const norm = normalizeText(word);
  for (const [canonical, syns] of Object.entries(SYNONYMS)) {
    if (canonical === norm) return canonical;
    if (syns.includes(norm)) return canonical;
  }
  return norm;
}

// ─── Intent Classification (Scoring) ─────────────────────

export interface IntentScore {
  intent: string;
  toolId: string;
  score: number;
  confidence: "high" | "medium" | "low";
}

interface IntentPattern {
  intent: string;
  toolId: string;
  keywords: string[];
  requiredAny: string[];
  bonusKeywords: string[];
  negativeKeywords: string[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ── Clientes ──
  {
    intent: "criar_cliente",
    toolId: "criar_cliente",
    keywords: ["criar", "cadastrar", "adicionar", "novo", "nova", "registrar", "incluir"],
    requiredAny: ["cliente", "consumidor", "fregues"],
    bonusKeywords: ["nome", "telefone", "email"],
    negativeKeywords: ["editar", "alterar", "excluir", "apagar", "buscar", "procurar", "listar", "historico"],
  },
  {
    intent: "editar_cliente",
    toolId: "editar_cliente",
    keywords: ["editar", "alterar", "mudar", "atualizar", "trocar", "corrigir", "ajustar", "modificar"],
    requiredAny: ["cliente", "consumidor", "fregues"],
    bonusKeywords: ["nome", "telefone", "email", "cpf", "endereco"],
    negativeKeywords: ["criar", "cadastrar", "novo", "excluir", "apagar"],
  },
  {
    intent: "excluir_cliente",
    toolId: "excluir_cliente",
    keywords: ["excluir", "deletar", "remover", "apagar", "eliminar", "tirar"],
    requiredAny: ["cliente", "consumidor", "fregues"],
    bonusKeywords: [],
    negativeKeywords: ["criar", "cadastrar", "editar", "alterar"],
  },
  {
    intent: "buscar_cliente",
    toolId: "buscar_cliente",
    keywords: ["buscar", "procurar", "encontrar", "pesquisar", "localizar", "achar", "onde"],
    requiredAny: ["cliente", "consumidor", "fregues"],
    bonusKeywords: ["nome", "telefone"],
    negativeKeywords: ["criar", "cadastrar", "excluir"],
  },
  {
    intent: "listar_clientes",
    toolId: "listar_clientes",
    keywords: ["listar", "mostrar", "ver", "exibir", "quais", "todos", "todas", "quantos", "quantas"],
    requiredAny: ["cliente", "clientes", "consumidor", "consumidores"],
    bonusKeywords: ["inativo", "inativos", "aniversario", "aniversariantes", "niver"],
    negativeKeywords: ["criar", "cadastrar", "editar"],
  },
  {
    intent: "historico_cliente",
    toolId: "historico_cliente",
    keywords: ["historico", "passado", "registro", "atendimentos", "visitas", "vezes"],
    requiredAny: ["cliente", "consumidor", "fregues"],
    bonusKeywords: ["gastou", "total", "ultima"],
    negativeKeywords: ["criar", "cadastrar", "editar"],
  },

  // ── Funcionários ──
  {
    intent: "criar_funcionario",
    toolId: "criar_funcionario",
    keywords: ["criar", "cadastrar", "adicionar", "novo", "nova", "registrar", "incluir", "contratar"],
    requiredAny: ["funcionario", "profissional", "barbeiro", "cabeleireiro", "cabeleireira", "manicure", "colaborador"],
    bonusKeywords: ["nome", "comissao"],
    negativeKeywords: ["editar", "alterar", "excluir", "listar", "ver"],
  },
  {
    intent: "editar_funcionario",
    toolId: "editar_funcionario",
    keywords: ["editar", "alterar", "mudar", "atualizar", "trocar", "corrigir", "ajustar", "modificar"],
    requiredAny: ["funcionario", "profissional", "barbeiro", "cabeleireiro", "cabeleireira", "manicure", "colaborador"],
    bonusKeywords: ["comissao", "nome", "telefone"],
    negativeKeywords: ["criar", "cadastrar", "novo", "listar"],
  },
  {
    intent: "listar_funcionarios",
    toolId: "listar_funcionarios",
    keywords: ["listar", "mostrar", "ver", "exibir", "quais", "todos", "todas", "quantos", "equipe", "time"],
    requiredAny: ["funcionario", "funcionarios", "profissional", "profissionais", "barbeiro", "barbeiros", "cabeleireiro", "cabeleireiros", "colaborador", "colaboradores"],
    bonusKeywords: ["ativo", "ativos", "comissao"],
    negativeKeywords: ["criar", "cadastrar", "editar"],
  },

  // ── Serviços ──
  {
    intent: "criar_servico",
    toolId: "criar_servico",
    keywords: ["criar", "cadastrar", "adicionar", "novo", "nova", "registrar", "incluir"],
    requiredAny: ["servico", "procedimento", "tratamento"],
    bonusKeywords: ["preco", "valor", "duracao", "tempo"],
    negativeKeywords: ["editar", "alterar", "excluir", "listar", "ver"],
  },
  {
    intent: "editar_servico",
    toolId: "editar_servico",
    keywords: ["editar", "alterar", "mudar", "atualizar", "trocar", "corrigir", "ajustar", "modificar"],
    requiredAny: ["servico", "procedimento", "tratamento"],
    bonusKeywords: ["preco", "valor", "duracao", "custo"],
    negativeKeywords: ["criar", "cadastrar", "novo", "listar"],
  },
  {
    intent: "listar_servicos",
    toolId: "listar_servicos",
    keywords: ["listar", "mostrar", "ver", "exibir", "quais", "todos", "todas", "quantos", "catalogo", "menu"],
    requiredAny: ["servico", "servicos", "procedimento", "procedimentos"],
    bonusKeywords: ["preco", "valor", "ativo"],
    negativeKeywords: ["criar", "cadastrar", "editar"],
  },

  // ── Caixa ──
  {
    intent: "abrir_caixa",
    toolId: "abrir_caixa",
    keywords: ["abrir", "iniciar", "comecar", "start"],
    requiredAny: ["caixa"],
    bonusKeywords: ["saldo", "inicial", "dia", "hoje"],
    negativeKeywords: ["fechar", "encerrar", "consultar"],
  },
  {
    intent: "fechar_caixa",
    toolId: "fechar_caixa",
    keywords: ["fechar", "encerrar", "finalizar", "terminar", "concluir"],
    requiredAny: ["caixa"],
    bonusKeywords: ["dia", "hoje", "resumo"],
    negativeKeywords: ["abrir", "iniciar", "consultar"],
  },
  {
    intent: "consultar_caixa",
    toolId: "consultar_caixa",
    keywords: ["consultar", "ver", "checar", "verificar", "status", "como esta", "situacao", "quanto", "saldo"],
    requiredAny: ["caixa"],
    bonusKeywords: ["hoje", "lancamento", "total"],
    negativeKeywords: ["abrir", "fechar"],
  },
  {
    intent: "registar_pagamento",
    toolId: "registar_pagamento",
    keywords: ["registrar", "lancar", "anotar", "receber", "cobrar", "pagamento", "lancamento", "entrada"],
    requiredAny: ["pagamento", "lancamento", "valor", "reais", "dinheiro", "pix", "cartao", "recebimento"],
    bonusKeywords: ["cliente", "metodo", "forma"],
    negativeKeywords: ["consultar", "ver", "historico"],
  },
  {
    intent: "reabrir_caixa",
    toolId: "reabrir_caixa",
    keywords: ["reabrir", "reabra", "desfazer fechamento", "corrigir"],
    requiredAny: ["caixa"],
    bonusKeywords: ["correcao", "erro"],
    negativeKeywords: ["abrir", "fechar"],
  },

  // ── Configuração ──
  {
    intent: "alterar_configuracao",
    toolId: "alterar_configuracao",
    keywords: ["configurar", "definir", "setar", "ajustar", "personalizar", "alterar", "mudar"],
    requiredAny: ["configuracao", "config", "ajuste", "preferencia", "nome do salao", "salao", "tema", "cor"],
    bonusKeywords: ["nome", "horario", "intervalo"],
    negativeKeywords: [],
  },

  // ── Agendamentos ──
  {
    intent: "agendar",
    toolId: "agendar",
    keywords: ["agendar", "agende", "marcar", "marca", "criar", "cadastrar", "novo", "nova", "registrar", "reservar", "booking", "agenda"],
    requiredAny: ["agendamento", "horario", "agendar", "agende", "marcar", "marca", "agenda"],
    bonusKeywords: ["cliente", "hoje", "amanha", "hora", "horas", "tarde", "manha", "corte", "barba"],
    negativeKeywords: ["cancelar", "excluir", "mover", "trocar", "listar", "ver", "mostrar"],
  },
  {
    intent: "cancelar_agendamento",
    toolId: "cancelar_agendamento",
    keywords: ["cancelar", "desmarcar", "excluir", "remover", "apagar"],
    requiredAny: ["agendamento", "horario", "agendar", "consulta"],
    bonusKeywords: ["cliente", "hoje", "amanha"],
    negativeKeywords: ["criar", "cadastrar", "novo", "mover", "reagendar", "listar"],
  },
  {
    intent: "mover_agendamento",
    toolId: "mover_agendamento",
    keywords: ["mover", "reagendar", "trocar", "transferir", "mudar", "alterar", "adiar", "antecipar"],
    requiredAny: ["agendamento", "horario", "agendar", "consulta"],
    bonusKeywords: ["cliente", "data", "hora", "para"],
    negativeKeywords: ["criar", "cadastrar", "cancelar", "listar"],
  },
  {
    intent: "listar_agendamentos",
    toolId: "listar_agendamentos",
    keywords: ["listar", "mostrar", "ver", "exibir", "quais", "quantos", "agenda"],
    requiredAny: ["agendamento", "agendamentos", "agenda", "marcado", "marcados", "compromisso", "compromissos"],
    bonusKeywords: ["hoje", "amanha", "dia", "semana"],
    negativeKeywords: ["criar", "cadastrar", "cancelar", "mover"],
  },

  // ── Navegação ──
  {
    intent: "navegar",
    toolId: "navegar",
    keywords: ["ir", "abrir", "vai", "va", "leva", "acessar", "visitar", "entrar", "mostra", "ver", "navegar"],
    requiredAny: ["pagina", "tela", "dashboard", "agenda", "caixa", "clientes", "funcionarios", "servicos", "relatorios", "configuracoes", "backup", "historico", "ferramentas", "financeiro", "inicio", "home"],
    bonusKeywords: [],
    negativeKeywords: ["criar", "cadastrar", "editar", "excluir", "fechar", "abrir caixa"],
  },

  // ── Backup ──
  {
    intent: "exportar_backup",
    toolId: "exportar_backup",
    keywords: ["exportar", "baixar", "download", "salvar", "backup"],
    requiredAny: ["backup", "dados", "exportar"],
    bonusKeywords: ["completo", "tudo"],
    negativeKeywords: [],
  },
];

export function classifyIntent(text: string): IntentScore[] {
  const q = normalizeText(text);
  const words = q.split(" ");
  const scores: IntentScore[] = [];

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;

    // Palavras-chave de ação (+2 cada)
    for (const kw of pattern.keywords) {
      if (q.includes(kw)) score += 2;
    }

    // Entidade obrigatória (pelo menos uma deve estar presente, +3 cada)
    const hasRequired = pattern.requiredAny.some(r => q.includes(r));
    if (!hasRequired && pattern.requiredAny.length > 0) {
      continue; // Pula se nenhuma entidade obrigatória foi encontrada
    }
    for (const r of pattern.requiredAny) {
      if (q.includes(r)) score += 3;
    }

    // Palavras-chave bônus (+1 cada)
    for (const bk of pattern.bonusKeywords) {
      if (q.includes(bk)) score += 1;
    }

    // Palavras negativas (-5 cada)
    for (const nk of pattern.negativeKeywords) {
      if (q.includes(nk)) score -= 5;
    }

    // Bônus por sinônimos resolvidos (+1)
    for (const w of words) {
      const canonical = resolveCanonical(w);
      if (canonical !== w && pattern.keywords.includes(canonical)) {
        score += 1;
      }
    }

    if (score > 0) {
      const confidence: "high" | "medium" | "low" = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
      scores.push({ intent: pattern.intent, toolId: pattern.toolId, score, confidence });
    }
  }

  // Ordenar por score decrescente
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

export function getBestIntent(text: string): IntentScore | null {
  const scores = classifyIntent(text);
  return scores.length > 0 ? scores[0] : null;
}

// ─── Entity Extraction ───────────────────────────────────

export interface ExtractedEntities {
  nome?: string;
  telefone?: string;
  email?: string;
  cpf?: string;
  valor?: string;
  metodo?: string;
  campo?: string;
  valorCampo?: string;
  pagina?: string;
  data?: string;
  hora?: string;
  periodo?: "dia" | "semana" | "mes" | "mes_anterior";
  filtro?: string;
  termo?: string;
  funcionario?: string;
  servico?: string;
  descricao?: string;
  nascimento?: string;
  saldo_inicial?: string;
  observacoes?: string;
  comissao?: string;
  preco?: string;
  duracao?: string;
  especialidades?: string;
  cor?: string;
  custo_material?: string;
  endereco?: string;
  notas?: string;
}

// Padrões para extração
const PHONE_PATTERN = /(?:\(?\d{2}\)?\s*)?(?:9\s?)?\d{4}[-.\s]?\d{4}/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const CPF_PATTERN = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
const MONEY_PATTERN = /(?:R\$\s*)?(\d{1,}[.,]?\d{0,2})/;
const TIME_PATTERN = /(?:(?:as?\s+)?(\d{1,2}):(\d{2})|(?:as?\s+)?(\d{1,2})\s*h\s*(\d{2})?|(?:as?\s+)?(\d{1,2})\s*horas?(?:\s+da\s+(manha|tarde|noite))?|as?\s+(\d{1,2})\s(\d{2})(?:\s|$))/;
const DATE_PATTERN = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/;

/** Extrai nome próprio de texto (heurística: palavra com inicial maiúscula) */
// Palavras que NÃO podem ser nomes de clientes — usadas para validar resultado da extração
const NOT_A_NAME = new Set([
  "dia", "hoje", "amanha", "semana", "mes", "ano", "manha", "tarde", "noite",
  "hora", "horas", "minuto", "minutos", "segundo", "segundos",
  "servico", "servicos", "procedimento", "corte", "escova", "progressiva",
  "manicure", "pedicure", "tintura", "coloracao", "hidratacao", "alisamento",
  "agendamento", "agendamentos", "horario", "caixa", "agenda",
  "funcionario", "profissional", "barbeiro", "cabeleireiro", "cabeleireira",
  "para", "com", "por", "sobre", "entre",
]);

function isValidName(name: string): boolean {
  if (name.length < 2 || name.length > 60) return false;
  const normalized = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Rejeita se começa com número ou só tem números/símbolos
  if (/^\d/.test(normalized)) return false;
  // Rejeita se a primeira palavra é uma não-nome conhecida
  const firstWord = normalized.split(/\s+/)[0];
  if (NOT_A_NAME.has(firstWord)) return false;
  return true;
}

function extractProperName(text: string, q: string): string | null {
  // Tenta extrair nome após preposições comuns
  // ATENÇÃO: patterns mais específicos (com "cliente X") vêm PRIMEIRO
  const namePatterns = [
    // Padrão explícito "cliente X" — máxima prioridade
    /(?:cliente|consumidor|freguesia)\s+(?:chamad[ao]?\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s]{1,59})(?:\s+(?:com|de|para|no|na|do|da|e\s|hoje|amanha|as\s|,|$))/i,
    // Padrão com "do cliente / da cliente"
    /(?:do|da|de)\s+(?:cliente|funcionario)\s+(.+?)(?:\s+(?:para|com|e\s|$))/i,
    // Cancelar/mover agendamento de X
    /(?:cancelar|desmarcar)\s+(?:o\s+|a\s+)?(?:agendamento\s+)?(?:do|da|de)\s+(.+?)(?:\s+(?:para|hoje|amanha|as\s|$))/i,
    /(?:mover|reagendar|trocar)\s+(?:o\s+|a\s+)?(?:agendamento\s+)?(?:do|da|de)\s+(.+?)(?:\s+(?:para|$))/i,
    // CRUD explícito de entidade
    /(?:cadastrar|criar|adicionar|novo|nova|registrar)\s+(?:o\s+|a\s+)?(?:cliente|funcionario|servico)\s+(.+?)(?:\s+(?:com|de|para|e\s|,|$))/i,
    /(?:editar|alterar|mudar|atualizar)\s+(?:o\s+|a\s+)?(?:cliente|funcionario|servico)\s+(.+?)(?:\s+(?:com|de|para|e\s|campo|,|$))/i,
    /(?:excluir|remover|deletar|apagar)\s+(?:o\s+|a\s+)?(?:cliente|funcionario|servico)\s+(.+?)$/i,
    /(?:buscar|procurar|encontrar|pesquisar)\s+(?:o\s+|a\s+)?(?:cliente|funcionario|servico)?\s*(.+?)$/i,
    /(?:historico|atendamentos|visitas)\s+(?:do|da|de)\s+(.+?)$/i,
    // Agendar/marcar — só captura nome se vier ANTES de "dia/as/hoje"
    // e NÃO começa com dígito ou palavra não-nome
    /(?:agendar?e?|marcar?|reservar)\s+(?:a\s+|o\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s]{1,59})(?:\s+(?:para|hoje|amanha|as\s|no\s|na\s|em\s|dia\s|,|$))/i,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/[.,!?]+$/, "").trim();
      if (isValidName(name)) return name;
    }
  }

  // Fallback: pega palavras com inicial maiúscula que não são comuns
  const commonWords = new Set([
    "o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "por", "para", "com", "sem",
    "que", "se", "me", "te", "lhe", "eu", "ele", "ela", "voce",
    "meu", "minha", "seu", "sua", "nosso", "nossa",
    "criar", "editar", "excluir", "buscar", "listar", "cadastrar", "alterar",
    "agendar", "marcar", "cancelar", "mover", "reagendar",
    "cliente", "funcionario", "servico", "caixa", "agenda", "relatorio",
    "novo", "nova", "como", "esta", "hoje", "ontem", "amanha",
    "sim", "nao", "ok", "bom", "boa", "dia", "noite", "tarde",
    "corte", "escova", "progressiva", "manicure", "pedicure", "tintura",
    "coloracao", "hidratacao", "alisamento", "procedimento", "tratamento",
    "servico", "horario", "minutos", "horas",
  ]);

  const words = text.split(/\s+/);
  const properWords = words.filter(w =>
    w.length >= 2 &&
    /^[A-ZÀ-Ö]/.test(w) &&
    !commonWords.has(w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
  );
  if (properWords.length > 0) {
    const candidate = properWords.join(" ");
    // Só retorna se passar na validação de nome
    if (isValidName(candidate)) return candidate;
  }

  return null;
}

/** Extrai entidades genéricas do texto */
export function extractEntities(text: string): ExtractedEntities {
  const q = normalizeText(text);
  const entities: ExtractedEntities = {};

  // Telefone
  const phoneMatch = text.match(PHONE_PATTERN);
  if (phoneMatch) entities.telefone = phoneMatch[0];

  // Email
  const emailMatch = text.match(EMAIL_PATTERN);
  if (emailMatch) entities.email = emailMatch[0];

  // CPF
  const cpfMatch = text.match(CPF_PATTERN);
  if (cpfMatch) entities.cpf = cpfMatch[0];

  // Valor monetário
  const moneyMatch = q.match(MONEY_PATTERN);
  if (moneyMatch) entities.valor = moneyMatch[1].replace(",", ".");

  // Hora — tentar primeiro no texto original (preserva ":"), depois no normalizado
  const timeMatch = text.toLowerCase().match(TIME_PATTERN) ?? q.match(TIME_PATTERN);
  if (timeMatch) {
    let h = parseInt(timeMatch[1] ?? timeMatch[3] ?? timeMatch[5] ?? timeMatch[7], 10);
    const m = parseInt(timeMatch[2] ?? timeMatch[4] ?? timeMatch[8] ?? "0", 10);
    // Ajustar "da tarde" / "da noite"
    const period = timeMatch[6];
    if (period === "tarde" && h < 12) h += 12;
    if (period === "noite" && h < 12) h += 12;
    if (period === "manha" && h === 12) h = 0;
    // Se hora <= 6 e nao especificou manha, provavelmente e da tarde
    if (!period && h >= 1 && h <= 6 && (q.includes("tarde") || q.includes("noite"))) h += 12;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      entities.hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  // Data
  const dateMatch = q.match(DATE_PATTERN);
  if (dateMatch) {
    const day = dateMatch[1];
    const month = dateMatch[2];
    const year = dateMatch[3] ?? new Date().getFullYear().toString();
    entities.data = `${year.length === 2 ? "20" + year : year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // "hoje" / "amanha" como data
  if (q.includes("hoje") && !entities.data) {
    const today = new Date();
    entities.data = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }
  if ((q.includes("amanha") || q.includes("amanhã")) && !entities.data) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    entities.data = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  }

  // Período
  if (/mes\s+(anterior|passado)/.test(q)) entities.periodo = "mes_anterior";
  else if (/hoje|dia/.test(q) && !/todo dia/.test(q)) entities.periodo = "dia";
  else if (/semana/.test(q)) entities.periodo = "semana";
  else if (/mes/.test(q)) entities.periodo = "mes";

  // Método de pagamento
  const paymentMethods: Record<string, string> = {
    "dinheiro": "dinheiro", "especie": "dinheiro", "cash": "dinheiro",
    "credito": "cartao_credito", "cartao de credito": "cartao_credito",
    "debito": "cartao_debito", "cartao de debito": "cartao_debito",
    "pix": "pix",
  };
  for (const [key, value] of Object.entries(paymentMethods)) {
    if (q.includes(key)) { entities.metodo = value; break; }
  }

  // Páginas para navegação
  const pageNames = [
    "dashboard", "inicio", "home", "principal",
    "clientes", "agenda", "caixa", "financeiro",
    "relatorios", "funcionarios", "servicos",
    "configuracoes", "backup", "historico", "ferramentas",
  ];
  for (const page of pageNames) {
    if (q.includes(page)) { entities.pagina = page; break; }
  }

  // Nome próprio
  const nome = extractProperName(text, q);
  if (nome) entities.nome = nome;

  // Campo + valor para edição (padrão: "campo para/de valor")
  const editPatterns = [
    /(?:o\s+)?(?:campo\s+)?(\w+)\s+(?:para|de|=|:)\s+(.+?)$/i,
    /(?:alterar|mudar|trocar)\s+(?:o\s+)?(\w+)\s+(?:do|da)\s+.+?\s+para\s+(.+?)$/i,
    /(\w+)\s*:\s*(.+?)$/i,
  ];
  for (const pattern of editPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[2]) {
      entities.campo = match[1].trim();
      entities.valorCampo = match[2].trim();
      break;
    }
  }

  // Filtros especiais
  if (q.includes("inativ")) entities.filtro = "inativos";
  if (q.includes("aniversari") || q.includes("niver")) entities.filtro = "aniversariantes";

  // Saldo inicial
  const saldoMatch = q.match(/saldo\s+(?:inicial\s+)?(?:de\s+)?(\d+[.,]?\d*)/);
  if (saldoMatch) entities.saldo_inicial = saldoMatch[1].replace(",", ".");

  // Comissão
  const comissaoMatch = q.match(/comissao\s+(?:de\s+)?(\d+)/);
  if (comissaoMatch) entities.comissao = comissaoMatch[1];

  // Preço
  const precoMatch = q.match(/(?:preco|valor)\s+(?:de\s+)?(?:r\$\s*)?(\d+[.,]?\d*)/);
  if (precoMatch) entities.preco = precoMatch[1].replace(",", ".");

  // Duração
  const duracaoMatch = q.match(/(?:duracao|tempo)\s+(?:de\s+)?(\d+)\s*(?:min|minuto)?/);
  if (duracaoMatch) entities.duracao = duracaoMatch[1];

  return entities;
}

// ─── Detecção de sentimento/tipo de frase ────────────────

export type PhraseType = "command" | "question" | "greeting" | "thanks" | "affirmation" | "denial" | "unknown";

export function detectPhraseType(text: string): PhraseType {
  const q = normalizeText(text);

  // Saudação
  if (/^(oi|ola|bom dia|boa tarde|boa noite|eai|e ai|fala|hey|hi|hello)/.test(q)) return "greeting";

  // Agradecimento
  if (/^(obrigad|valeu|vlw|tks|thank|agradec|muito obrigad|brigad|blz|beleza|top|show|perfeito|maravilh)/.test(q)) return "thanks";

  // Afirmação
  if (/^(sim|s|yes|isso|correto|certo|pode|confirmo|confirma|afirmativo|ok|blz|beleza|faz isso|manda|vai|bora|claro|obvio|com certeza)$/.test(q)) return "affirmation";

  // Negação
  if (/^(nao|n|no|nope|cancela|cancelar|desistir|para|desisto|deixa|esquece|nada|nem)$/.test(q)) return "denial";

  // Pergunta
  if (/^(como|quanto|quantos|quantas|qual|quais|quem|quando|onde|porque|por que|o que|cadê|cade)\s/.test(q)) return "question";
  if (q.endsWith("?") || /\?/.test(text)) return "question";

  // Comando (ação imperativa)
  if (/^(criar|cadastrar|editar|alterar|excluir|remover|buscar|listar|abrir|fechar|registrar|lancar|ir|va|vai|mostra|ver|configur|exportar|navegar|adicionar|incluir|agendar|marcar|cancelar|mover|reagendar|quero)/.test(q)) return "command";

  return "unknown";
}

// ─── Detecção de composição (múltiplas intenções) ────────

export interface CompositeResult {
  isComposite: boolean;
  parts: string[];
}

export function detectComposite(text: string): CompositeResult {
  const q = normalizeText(text);

  // Detecta conectores de composição
  const connectors = [
    /\s+e\s+(?:depois|tambem|ainda|alem)\s+/,
    /\s+e\s+/,
    /\s+depois\s+/,
    /\s+tambem\s+/,
    /\s+alem\s+disso\s+/,
    /;\s+/,
  ];

  for (const connector of connectors) {
    if (connector.test(q)) {
      const parts = q.split(connector).map(p => p.trim()).filter(p => p.length > 3);
      // Verifica se pelo menos 2 partes têm intenções distintas
      if (parts.length >= 2) {
        const intents = parts.map(p => getBestIntent(p));
        const uniqueIntents = new Set(intents.filter(i => i !== null).map(i => i!.intent));
        if (uniqueIntents.size >= 2) {
          return { isComposite: true, parts };
        }
      }
    }
  }

  return { isComposite: false, parts: [text] };
}

// ─── Fuzzy matching (distância de Levenshtein simplificada) ─

export function fuzzyMatch(input: string, target: string, threshold = 0.7): boolean {
  const a = normalizeText(input);
  const b = normalizeText(target);

  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Distância de Levenshtein
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
  }

  const distance = matrix[a.length][b.length];
  const maxLen = Math.max(a.length, b.length);
  const similarity = 1 - distance / maxLen;
  return similarity >= threshold;
}


