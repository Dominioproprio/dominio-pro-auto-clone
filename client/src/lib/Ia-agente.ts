import { supabase } from './supabase';

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function processarIA(mensagem: string) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  const systemPrompt = `
    Você é o Assistente Digital do salão Dominio Pro Auto.
    Sua missão é ajudar a Fernanda a gerenciar agendamentos, clientes e estoque.
    
    COMPORTAMENTO:
    - Agendamentos: Extraia Nome, Serviço, Data e Hora.
    - Conflitos: Verifique se o horário está livre antes de confirmar.
    - Regras: Segunda-feira a profissional Ana não trabalha.
    - Memória: Lembre as preferências dos clientes (ex: Maria prefere corte curto).
    - Estilo: Seja curto, educado e eficiente.
  `;

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: mensagem }
        ],
        temperature: 0.6
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Erro na IA:", error);
    return "Oi Fernanda, tive um erro de conexão. Verifique a chave da Groq no Vercel.";
  }
}

