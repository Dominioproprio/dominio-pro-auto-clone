// 1. Certifique-se de importar o supabase no topo do arquivo
import { supabase } from "../lib/supabase";

// ... dentro do componente AgentChat ...

const sendMessage = useCallback(async (text: string) => {
  if (!text.trim() || isTyping) return;

  const userMsg: ChatMessage = {
    id: `u_${Date.now()}`,
    role: "user",
    content: text.trim(),
    timestamp: Date.now(),
  };

  const newMessages = [...messages, userMsg];
  setMessages(newMessages);
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(newMessages));
  setInput("");
  setIsTyping(true);

  try {
    // Chama o Agente Supremo
    const respostaIA = await executarAgente(text.trim());

    // --- LÓGICA DE EXECUÇÃO AUTOMÁTICA ---
    if (respostaIA.includes("[ACAO_SISTEMA:")) {
      try {
        const jsonString = respostaIA.match(/\[ACAO_SISTEMA: (.*?)\]/)?.[1];
        if (jsonString) {
          const { tipo, payload } = JSON.parse(jsonString);

          if (tipo === "CRIAR_AGENDAMENTO") {
            // Salva direto no Supabase
            const { error } = await supabase.from('appointments').insert([{
              client_name: payload.cliente,
              service: payload.servico,
              employee_id: payload.profissional, // O agente tentará mandar o nome ou ID
              appointment_date: payload.data,
              start_time: payload.hora,
              status: 'pendente'
            }]);

            if (!error) {
              console.log("✅ Agendamento realizado pelo Agente!");
              // Opcional: Recarregar a agenda se estiver na tela de agenda
            }
          }
        }
      } catch (e) {
        console.error("Erro ao processar comando da IA:", e);
      }
    }

    // Limpa a tag técnica da resposta para a Fernanda não ver o código
    const respostaLimpa = respostaIA.replace(/\[ACAO_SISTEMA: .*?\]/g, "").trim();

    const agentMsg: ChatMessage = {
      id: `a_${Date.now()}`,
      role: "agent",
      content: respostaLimpa,
      timestamp: Date.now(),
    };

    const finalMessages = [...newMessages, agentMsg];
    setMessages(finalMessages);
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(finalMessages));
    
  } catch (err) {
    setMessages(prev => [...prev, {
      id: "err", role: "agent", content: "Erro na conexão. Verifique sua chave API.", timestamp: Date.now()
    }]);
  } finally {
    setIsTyping(false);
  }
}, [messages, isTyping]);
