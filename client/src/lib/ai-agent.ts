/**
 * ai-agent.ts — Motor do Agente IA do Domínio Pro
 *
 * - Usa Groq (llama-3.3-70b-versatile) via VITE_GROQ_API_KEY
 * - Lê dados reais do Supabase via stores do app (cache + fallback direto)
 * - Detecta nomes de clientes com stopwords e normalização NFD
 * - Passa histórico de conversa para o modelo (multi-turn real)
 * - Cria agendamentos usando appointmentsStore.create() com schema correto
 * - Retorna erros tipados para o chat exibir corretamente
 */

import { supabase } from "./supabase";
import {
  servicesStore,
  employeesStore,
  clientsStore,
  appointmentsStore,
  type Appointment,
  type AppointmentService,
} from "./store";

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface MensagemConversa {
  role: "user" | "assistant";
  content: string;
}

export interface ResultadoAgente {
  texto: string;             // Resposta limpa para exibir ao usuário
  agendamentoCriado?: Appointment; // Preenchido se um agendamento foi persistido
  erro?: string;             // Mensagem de erro amigável se algo falhou
}

// ─── Stopwords — palavras que NÃO são nomes de clientes ──────────────────────

const STOPWORDS = new Set([
  // Verbos e expressões comuns
  "quero","qual","quais","como","quando","onde","porque","para","fazer",
  "buscar","agendar","cancelar","remarcar","confirmar","verificar","checar",
  "preciso","gostaria","poderia","pode","consigo","tenho","temos","tem",
  // Pronomes e artigos
  "voce","você","minha","meu","meus","minhas","uma","uns","umas","esse",
  "essa","este","esta","isso","aquilo","aquele","aquela","dele","dela",
  // Substantivos que aparecem no início de frases
  "cliente","clientes","servico","serviço","serviços","agenda","agendamento",
  "agendamentos","horario","horário","horarios","funcionario","funcionários",
  "hoje","amanha","semana","faturamento","caixa","relatorio","relatório",
  // Advérbios e preposições
  "agora","depois","antes","durante","junto","mais","menos","muito","pouco",
  "favor","obrigado","obrigada","boa","bom","ola","olá",
]);

// ─── Normalização de texto ────────────────────────────────────────────────────

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// ─── Detecta possível nome próprio na mensagem ────────────────────────────────

function detectarNomeNaMensagem(msg: string): string | undefined {
  // Remove pontuação e divide em tokens
  const tokens = msg.replace(/[^\w\sÀ-ú]/g, " ").split(/\s+/);

  for (const token of tokens) {
    if (token.length < 3) continue;

    const primeiraLetra = token[0];
    const ehMaiuscula =
      primeiraLetra === primeiraLetra.toUpperCase() &&
      primeiraLetra !== primeiraLetra.toLowerCase(); // filtra dígitos

    if (!ehMaiuscula) continue;
    if (STOPWORDS.has(normalizar(token))) continue;

    return token; // Primeiro candidato válido
  }
  return undefined;
}

// ─── Formata agenda para o prompt ─────────────────────────────────────────────

function formatarAgenda(agendamentos: Appointment[]): string {
  if (agendamentos.length === 0) return "Nenhum agendamento futuro cadastrado.";

  return agendamentos
    .slice(0, 20) // máx 20 itens para não estourar tokens
    .map(a => {
      const inicio = new Date(a.startTime);
      const data = inicio.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
      const hora = inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const servicos = a.services.map(s => s.name).join(", ") || "—";
      return `• ${data} ${hora} | Cliente: ${a.clientName ?? "—"} | Func. ID ${a.employeeId} | Serviço: ${servicos} | Status: ${a.status}`;
    })
    .join("\n");
}

// ─── Captura estado real do banco ─────────────────────────────────────────────

async function capturarContexto(termoBusca?: string) {
  const hoje = new Date().toISOString().split("T")[0];

  // Garante que o cache está carregado (sem requisição extra se já estiver)
  const [servicos, funcionarios] = await Promise.all([
    servicesStore.list(true), // só ativos
    employeesStore.list(true),
  ]);

  const agendaFutura = appointmentsStore.list({ startDate: hoje });

  // Busca de clientes
  let clientesEncontrados: Awaited<ReturnType<typeof clientsStore.search>> = [];
  let historicoCliente = "";

  if (termoBusca) {
    try {
      // Usa o search robusto do store (fuzzy + NFD + fallback Supabase)
      clientesEncontrados = await clientsStore.search(termoBusca, { limit: 5 });
    } catch {
      // Fallback direto ao Supabase se o store falhar
      const { data } = await supabase
        .from("clients")
        .select("*")
        .ilike("name", `%${termoBusca}%`)
        .limit(5);
      clientesEncontrados = (data ?? []) as any;
    }

    // Histórico do cliente mais relevante
    if (clientesEncontrados.length > 0) {
      const cliente = clientesEncontrados[0];
      try {
        const { data: hist } = await supabase
          .from("appointments")
          .select("services, start_time, status")
          .eq("client_id", cliente.id)
          .neq("status", "cancelled")
          .order("start_time", { ascending: false })
          .limit(5);

        if (hist && hist.length > 0) {
          const linhas = hist.map(h => {
            const data = new Date(h.start_time).toLocaleDateString("pt-BR");
            const servs = Array.isArray(h.services)
              ? h.services.map((s: any) => s.name ?? s).join(", ")
              : "—";
            return `  - ${servs} em ${data} (${h.status})`;
          });
          historicoCliente = `Histórico de ${cliente.name}:\n${linhas.join("\n")}`;
        } else {
          historicoCliente = `${cliente.name} não possui histórico de agendamentos.`;
        }
      } catch {
        historicoCliente = "Histórico indisponível no momento.";
      }
    }
  }

  return {
    servicos,
    funcionarios,
    agendaFutura,
    clientesEncontrados,
    historicoCliente,
    hoje,
  };
}

// ─── Monta o System Prompt ────────────────────────────────────────────────────

function montarSystemPrompt(ctx: Awaited<ReturnType<typeof capturarContexto>>): string {
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const servicosFormatados = ctx.servicos.map(s =>
    `  • [ID ${s.id}] ${s.name} — R$ ${s.price.toFixed(2)} — ${s.durationMinutes} min`
  ).join("\n") || "  Nenhum serviço cadastrado.";

  const funcFormatados = ctx.funcionarios.map(f =>
    `  • [ID ${f.id}] ${f.name}`
  ).join("\n") || "  Nenhum funcionário ativo.";

  const clientesFormatados = ctx.clientesEncontrados.length > 0
    ? ctx.clientesEncontrados.map(c =>
        `  • [ID ${c.id}] ${c.name}${c.phone ? ` — ${c.phone}` : ""}`
      ).join("\n")
    : "  Nenhum cliente encontrado para este termo.";

  return `Você é o Assistente IA do salão Domínio Pro. Responda SEMPRE em português do Brasil.
Seja direto, objetivo e amigável. Nunca invente dados — use APENAS o que está abaixo.

════════════════ DADOS REAIS DO SISTEMA ════════════════
🕐 AGORA: ${agora}

📋 SERVIÇOS ATIVOS:
${servicosFormatados}

👥 EQUIPE ATIVA:
${funcFormatados}

${ctx.clientesEncontrados.length > 0 ? `🔍 CLIENTES ENCONTRADOS:
${clientesFormatados}

${ctx.historicoCliente ? `📅 ${ctx.historicoCliente}` : ""}
` : ""}
📆 AGENDA (próximos agendamentos):
${formatarAgenda(ctx.agendaFutura)}
════════════════════════════════════════════════════════

📌 REGRAS OBRIGATÓRIAS:
1. SERVIÇOS: Mencione apenas IDs e nomes da lista acima. Nunca invente preço ou duração.
2. FUNCIONÁRIOS: Use apenas IDs e nomes da lista acima.
3. CONFLITO DE HORÁRIO: Antes de confirmar, verifique se o funcionário já tem agendamento naquele horário na AGENDA.
4. CRIAÇÃO DE AGENDAMENTO: Você precisa coletar TODOS estes dados antes de confirmar:
   - Nome completo do cliente (se encontrado na lista, use o ID)
   - Serviço (ID e nome)
   - Funcionário (ID e nome)
   - Data no formato YYYY-MM-DD
   - Hora no formato HH:MM
   Se faltar qualquer informação, PERGUNTE antes de confirmar.
5. CONFIRMAÇÃO: Quando tiver todos os dados, resuma o agendamento e peça confirmação do usuário.
6. AÇÃO DO SISTEMA: Somente após o usuário confirmar, inclua ao final da resposta:
   [ACAO_SISTEMA: {"tipo":"CRIAR_AGENDAMENTO","payload":{"clienteNome":"NOME","clienteId":ID_OU_NULL,"servicoId":ID,"servicoNome":"NOME","servicoPreco":PRECO,"duracaoMin":DURACAO,"funcionarioId":ID,"funcionarioNome":"NOME","data":"YYYY-MM-DD","hora":"HH:MM"}}]
   Substitua ID_OU_NULL pelo ID numérico do cliente se encontrado, ou null se não cadastrado.
7. HISTÓRICO: Se o cliente tiver histórico, sugira o serviço que ele costuma fazer.`;
}

// ─── Executa o agendamento no Supabase via store ──────────────────────────────

async function criarAgendamentoNoSistema(payload: {
  clienteNome: string;
  clienteId: number | null;
  servicoId: number;
  servicoNome: string;
  servicoPreco: number;
  duracaoMin: number;
  funcionarioId: number;
  funcionarioNome: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
}): Promise<Appointment> {
  // Monta timestamps ISO com timezone local (Brasil)
  const startTime = new Date(`${payload.data}T${payload.hora}:00`).toISOString();
  const endTime = new Date(
    new Date(`${payload.data}T${payload.hora}:00`).getTime() + payload.duracaoMin * 60_000
  ).toISOString();

  const servicoItem: AppointmentService = {
    serviceId: payload.servicoId,
    name: payload.servicoNome,
    price: payload.servicoPreco,
    durationMinutes: payload.duracaoMin,
    color: "#ec4899",
    materialCostPercent: 0,
  };

  return appointmentsStore.create({
    clientName: payload.clienteNome,
    clientId: payload.clienteId,
    employeeId: payload.funcionarioId,
    startTime,
    endTime,
    status: "scheduled",
    totalPrice: payload.servicoPreco,
    notes: "Criado via Agente IA",
    paymentStatus: null,
    groupId: null,
    services: [servicoItem],
  });
}

// ─── Função principal exportada ───────────────────────────────────────────────

export async function executarAgente(
  mensagemUsuario: string,
  historicoConversa: MensagemConversa[] = []
): Promise<ResultadoAgente> {
  try {
    // 1. Detecta nome e carrega contexto do banco
    const nome = detectarNomeNaMensagem(mensagemUsuario);
    const ctx = await capturarContexto(nome);
    const systemPrompt = montarSystemPrompt(ctx);

    // 2. Monta histórico (últimas 6 trocas — reduz tokens e chance de rate limit)
    const mensagensApi = [
      ...historicoConversa.slice(-6),
      { role: "user" as const, content: mensagemUsuario },
    ];

    const body = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...mensagensApi,
      ],
      temperature: 0.2,
      max_tokens: 768,
    });

    // 3. Chama a API Groq com retry automático no 429
    let response: Response | null = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (response.status !== 429) break;
      // Rate limit — espera antes de tentar novamente (2s, 4s)
      await new Promise(r => setTimeout(r, 2000 * (tentativa + 1)));
    }

    if (!response || !response.ok) {
      const errBody = await response?.text().catch(() => "") ?? "";
      console.error("[AI Agent] Groq HTTP error:", response?.status, errBody);
      throw new Error(`Groq ${response.status}`);
    }

    const data = await response.json();
    const respostaCompleta: string = data.choices?.[0]?.message?.content ?? "";

    // 4. Processa comando de agendamento se presente
    const match = respostaCompleta.match(/\[ACAO_SISTEMA:\s*(\{[\s\S]*?\})\]/);
    let agendamentoCriado: Appointment | undefined;

    if (match) {
      try {
        // O modelo retorna: {"tipo":"CRIAR_AGENDAMENTO","payload":{...campos...}}
        const parsed = JSON.parse(match[1]);
        if (parsed?.tipo === "CRIAR_AGENDAMENTO" && parsed?.payload) {
          const p = parsed.payload;
          agendamentoCriado = await criarAgendamentoNoSistema(p);
          console.info("[AI Agent] Agendamento criado:", agendamentoCriado.id);
        }
      } catch (e) {
        console.error("[AI Agent] Falha ao criar agendamento:", e);
        // Não falha silenciosamente — informa o usuário
        const textoLimpo = respostaCompleta.replace(/\[ACAO_SISTEMA:[\s\S]*?\]/g, "").trim();
        return {
          texto: textoLimpo + "\n\n⚠️ Houve um erro ao salvar o agendamento no sistema. Por favor, tente novamente ou registre manualmente.",
          erro: String(e),
        };
      }
    }

    // 5. Remove o marcador técnico da resposta exibida ao usuário
    const textoLimpo = respostaCompleta.replace(/\[ACAO_SISTEMA:[\s\S]*?\]/g, "").trim();

    return {
      texto: textoLimpo,
      agendamentoCriado,
    };

  } catch (error) {
    console.error("[AI Agent] Erro geral:", error);
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("401")) {
      return { texto: "❌ Chave da API inválida. Verifique VITE_GROQ_API_KEY no Vercel.", erro: msg };
    }
    if (msg.includes("429")) {
      return { texto: "⏳ Muitas requisições. Aguarde alguns segundos e tente novamente.", erro: msg };
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return { texto: "📡 Sem conexão com o servidor. Verifique sua internet.", erro: msg };
    }

    return {
      texto: "❌ Erro inesperado no agente. Verifique o console para detalhes.",
      erro: msg,
    };
  }
}
