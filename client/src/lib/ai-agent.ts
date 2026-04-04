import { supabase } from "./supabase";

/**
 * Função para buscar o contexto real do salão no banco de dados
 */
async function buscarContextoSalao(nomeCliente?: string) {
  // 1. Busca Profissionais e Serviços em paralelo
  const [profissionais, servicos] = await Promise.all([
    supabase.from('employees').select('name, specialty, working_days'),
    supabase.from('services').select('name, price, duration')
  ]);

  // 2. Busca histórico se o nome do cliente for fornecido
  let historicoStr = "Cliente novo ou sem histórico identificado.";
  if (nomeCliente) {
    const { data: h } = await supabase
      .from('appointments')
      .select('service, date')
      .ilike('client_name', `%${nomeCliente}%`)
      .order('date', { ascending: false })
      .limit(1);
    
    if (h && h.length > 0) {
      historicoStr = `Último serviço do(a) ${nomeCliente}: ${h[0].service} em ${h[0].date}.`;
    }
  }

  // 3. Formata os dados para a IA "ler"
  const listaPro = profissionais.data?.map(p => `${p.name} (${p.specialty})`).join(", ");
  const listaServ = servicos.data?.map(s => `${s.name} - R$${s.price}`).join(", ");

  return {
    prompt: `
      CONTEXTO ATUAL DO SALÃO:
      - Profissionais Disponíveis: ${listaPro}
      - Serviços Oferecidos: ${listaServ}
      - Histórico do Cliente: ${historicoStr}
      - Data de Hoje: ${new Date().toLocaleDateString('pt-BR')}
    `
  };
}

export async function executarAgente(mensagemUsuario: string) {
  try {
    // Tenta extrair um nome da mensagem para buscar histórico (ajuste simples)
    const possivelNome = mensagemUsuario.split(" ").find(w => w.length > 3 && w[0] === w[0].toUpperCase());
    
    const contexto = await buscarContextoSalao(possivelNome);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `Você é o Agente Pro do Salão Domínio Pro. Você tem controle total da gestão.
            ${contexto.prompt}
            
            REGRAS DE OURO:
            1. Use o histórico do cliente para sugerir serviços (ex: "Vi que você fez Mechas, quer retocar?").
            2. Se o cliente pedir um serviço que não existe na lista acima, avise que não fazemos.
            3. Se pedir um profissional que não está na lista, sugira os disponíveis.
            4. Ao confirmar um agendamento, retorne no final: [AGENDAR: {"cliente": "...", "servico": "...", "profissional": "...", "data": "YYYY-MM-DD", "hora": "HH:MM"}]`
          },
          { role: "user", content: mensagemUsuario }
        ],
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Erro no Agente:", error);
    return "Desculpe Fernanda, tive um problema ao acessar o banco de dados agora.";
  }
}
