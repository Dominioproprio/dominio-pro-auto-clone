import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquare, Send, X, Bot, User, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { executarAgente } from "@/lib/ai-agent";
import { supabase } from "@/lib/supabase";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
}

const MESSAGES_KEY = "dominio_pro_chat_messages";

export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carregar histórico do localStorage
  useEffect(() => {
    const saved = localStorage.getItem(MESSAGES_KEY);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error("Erro ao carregar mensagens:", e);
      }
    } else {
      // Mensagem de boas-vindas padrão
      setMessages([
        {
          id: "welcome",
          role: "agent",
          content: "Olá! Sou o assistente inteligente do Domínio Pro. Como posso ajudar você hoje?",
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  // Scroll automático para o fim
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, isTyping]);

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
                employee_id: payload.profissional,
                appointment_date: payload.data,
                start_time: payload.hora,
                status: 'pendente'
              }]);

              if (!error) {
                console.log("✅ Agendamento realizado pelo Agente!");
              }
            }
          }
        } catch (e) {
          console.error("Erro ao processar comando da IA:", e);
        }
      }

      // Limpa a tag técnica da resposta
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
        id: `err_${Date.now()}`, 
        role: "agent", 
        content: "Erro na conexão. Verifique sua chave API.", 
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [messages, isTyping]);

  const handleClearChat = () => {
    const welcomeMsg: ChatMessage = {
      id: "welcome",
      role: "agent",
      content: "Chat reiniciado. Como posso ajudar?",
      timestamp: Date.now(),
    };
    setMessages([welcomeMsg]);
    localStorage.removeItem(MESSAGES_KEY);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
      {isOpen && (
        <Card className="mb-4 w-[350px] sm:w-[400px] h-[500px] flex flex-col shadow-2xl border-primary/20 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <div className="p-4 bg-primary text-primary-foreground flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              <div>
                <h3 className="font-bold text-sm">Assistente IA</h3>
                <p className="text-[10px] opacity-80">Domínio Pro v2.0</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={handleClearChat} title="Limpar chat">
                <X className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setIsOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex w-full", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] rounded-2xl px-4 py-2 text-sm", msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted text-muted-foreground rounded-tl-none")}>
                    <div className="flex items-center gap-1 mb-1 opacity-50 text-[10px]">
                      {msg.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                      <span>{msg.role === "user" ? "Você" : "IA"}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted text-muted-foreground rounded-2xl rounded-tl-none px-4 py-2 text-sm flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Pensando...</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t bg-background">
            <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="flex gap-2">
              <Input placeholder="Digite sua mensagem..." value={input} onChange={(e) => setInput(e.target.value)} disabled={isTyping} className="flex-1" />
              <Button type="submit" size="icon" disabled={!input.trim() || isTyping}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      )}

      <Button size="icon" className={cn("h-14 w-14 rounded-full shadow-lg transition-all duration-300", isOpen ? "rotate-90 scale-0" : "rotate-0 scale-100")} onClick={() => setIsOpen(true)}>
        <MessageSquare className="h-6 w-6" />
      </Button>
    </div>
  );
}
