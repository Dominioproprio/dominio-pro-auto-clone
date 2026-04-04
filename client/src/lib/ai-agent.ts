import { supabase } from "./supabase";

/**
 * Mapeamento completo do banco de dados para o Agente.
 * Ele agora enxerga TUDO antes de falar.
 */
async function capturarEstadoGeral(termoBusca?: string) {
  const hoje = new Date().toISOString().split('T')[0];

  // Busca em todas as tabelas principais simultaneamente
  const [resServicos, resEquipe, resAgenda, resClientes] = await Promise.all([
    supabase.from('services').select('*'),
    supabase.from('employees').select('*'),
    supabase.from('appointments').select('*').gte('appointment_date', hoje),
    termoBusca ? supabase.from('clients').select('*').ilike('name', `%${termoBusca}%`) : { data: [] }
  ]);

  // Se encontrar um cliente, busca o histórico de agendamentos dele
  let historicoDestaque = "Nenhum histórico encontrado para este termo.";
  if (resClientes.data && resClientes.data.length > 0) {
    const cliente = resClientes.data[0];
    const { data: ultimos } = await supabase
      .from('appointments')
      .select('service, appointment_date, status')
      .eq('client_name', cliente.name)
      .order('appointment_date', { ascending: false })
      .limit(3);

    if (ultimos && ultimos.length > 0) {
      historicoDestaque = `O cliente ${cliente.name} realizou recentemente: ${ultimos.map(u => `${u.service} em ${u.appointment_date} (${u.status})`).join('; ')}.`;
    }
  }

  return {
    servicos: resServicos.data || [],
    funcionarios: resEquipe.data || [],
    agendaAtiva: resAgenda.data || [],
    clientesEncontrados: resClientes.data || [],
    historico: historicoDestaque,
    dataHoje: hoje
  };
}

export async function executarAgente(mensagemUsuario: string) {
  try {
    // Tenta detectar um nome próprio na mensagem (começa com letra maiúscula)
    const palavras = mensagemUsuario.split(" ");
    const nomeParaBusca = palavras.find(p => p.length > 2 && p[0] === p[0].toUpperCase());

    const banco = await capturarEstadoGeral(nomeParaBusca);

    const promptSistema = `
      VOCÊ É O GERENTE SUPREMO DO SALÃO DOMÍNIO PRO.
      Você tem acesso direto ao banco de dados e deve ser ultra-preciso.

      --- DADOS REAIS DO SUPABASE ---
      SERVIÇOS DISPONÍVEIS: ${JSON.stringify(banco.servicos)}
      EQUIPE (FUNCIONÁRIOS): ${JSON.stringify(banco.funcionarios)}
      AGENDA ATUAL (OCUPADA): ${JSON.stringify(banco.agendaAtiva)}
      CLIENTES IDENTIFICADOS: ${JSON.stringify(banco.clientesEncontrados)}
      HISTÓRICO RELEVANTE: ${banco.historico}
      DATA ATUAL: ${banco.dataHoje}
      -------------------------------

      SUAS DIRETRIZES:
      1. SUCESSO DO CLIENTE: Se o cliente tem histórico, sugira algo baseado no que ele já gosta.
      2. PRECISÃO DE AGENDA: Antes de confirmar, olhe a "AGENDA ATUAL". Se o funcionário estiver ocupado naquela hora/data, NÃO agende. Avise e ofereça outro.
      3. SERVIÇOS REAIS: Nunca invente um serviço ou preço. Use apenas o que está em "SERVIÇOS DISPONÍVEIS".
      4. COMANDO DE AÇÃO: Quando o agendamento for definido (Nome, Serviço, Funcionário, Data e Hora), você DEVE obrigatoriamente terminar a resposta com:
         [ACAO_SISTEMA: {"tipo": "CRIAR_AGENDAMENTO", "payload": {"cliente": "...", "servico": "...", "profissional": "...", "data": "YYYY-MM-DD", "hora": "HH:MM"}}]
    `;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: promptSistema },
          { role: "user", content: mensagemUsuario }
        ],
        temperature: 0.3, // Baixa temperatura para ele ser um gerente sério e não inventar coisas
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error("Erro no Agente Supremo:", error);
    return "Erro crítico ao acessar as tabelas do salão. Verifique o console.";
  }
}
