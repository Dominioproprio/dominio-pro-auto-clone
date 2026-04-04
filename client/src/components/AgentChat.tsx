import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquare, Send, X, Bot, User, Loader2, Trash2 } from "lucide-react";
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
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        } else {
          setMessages([{
            id: "welcome",
            role: "agent",
            content: "Olá! Sou o assistente inteligente do Domínio Pro. Como posso ajudar você hoje?",
            timestamp: Date.now(),
          }]);
        }
      } catch (e) {
        console.error("Erro ao carregar mensagens:", e);
      }
    } else {
      setMessages([{
        id: "welcome",
        role: "agent",
        content: "Olá! Sou o assistente inteligente do Domínio Pro. Como posso ajudar você hoje?",
        timestamp: Date.now(),
      }]);
    }
  }, []);

  // Scroll automático para o fim quando mensagens mudam ou IA está digitando
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        setTimeout(() => {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
        }, 100);
      }
    }
  }, [messages, isTyping, isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(updatedMessages));
    setInput("");
    setIsTyping(true);

    try {
      const respostaIA = await executarAgente(text.trim());

      // Lógica de Ação do Sistema (Agendamento)
      if (respostaIA.includes("[ACAO_SISTEMA:")) {
        try {
          const jsonString = respostaIA.match(/\[ACAO_SISTEMA: (.*?)\]/)?.[1];
          if (jsonString) {
            const { tipo, payload } = JSON.parse(jsonString);
            if (tipo === "CRIAR_AGENDAMENTO") {
              await supabase.from('appointments').insert([{
                client_name: payload.cliente,
                service: payload.servico,
                employee_id: payload.profissional,
                appointment_date: payload.data,
                start_time: payload.hora,
                status: 'pendente'
              }]);
            }
          }
        } catch (e) {
          console.error("Erro ao processar comando da IA:", e);
        }
      }

      const respostaLimpa = respostaIA.replace(/\[ACAO_SISTEMA: .*?\]/g, "").trim();
      const agentMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "agent",
        content: respostaLimpa,
        timestamp: Date.now(),
      };

      const finalMessages = [...updatedMessages, agentMsg];
      setMessages(finalMessages);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(finalMessages));
      
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`, 
        role: "agent", 
        content: "Desculpe, tive um problema na conexão. Verifique sua chave API.", 
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
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
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {isOpen && (
        <Card className="mb-4 w-[380px] h-[550px] flex flex-col shadow-2xl border-primary/20 overflow-hidden animate-in slide-in-from-bottom-4 duration-300 bg-background">
          {/* Header */}
          <div className="p-4 bg-primary text-primary-foreground flex items-center justify-between shadow-md">
            <div className="flex items-center gap-3">
              <div className="bg-primary-foreground/20 p-2 rounded-lg">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-none">Assistente IA</h3>
                <p className="text-[10px] opacity-70 mt-1">Domínio Pro v2.0</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" 
                onClick={handleClearChat} 
                title="Limpar conversa"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" 
                onClick={() => setIsOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Chat Area */}
          <ScrollArea className="flex-1 p-4 bg-muted/30" ref={scrollRef}>
            <div className="space-y-4 pb-2">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex w-full", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm", 
                    msg.role === "user" 
                      ? "bg-primary text-primary-foreground rounded-tr-none" 
                      : "bg-background text-foreground border border-border rounded-tl-none"
                  )}>
                    <div className="flex items-center gap-1.5 mb-1.5 opacity-60 text-[10px] font-semibold uppercase tracking-wider">
                      {msg.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                      <span>{msg.role === "user" ? "Você" : "Assistente"}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-background border border-border text-foreground rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-3 shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs font-medium animate-pulse">O assistente está escrevendo...</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="p-4 border-t bg-background shadow-[0_-4px_12px_rgba(0,0,0,0.03)]">
            <form 
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} 
              className="flex gap-2 items-center"
            >
              <Input 
                placeholder="Pergunte algo ao assistente..." 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                disabled={isTyping} 
                className="flex-1 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary h-10" 
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={!input.trim() || isTyping}
                className="h-10 w-10 shrink-0 shadow-md"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      )}

      {/* Toggle Button */}
      <Button 
        size="icon" 
        className={cn(
          "h-14 w-14 rounded-full shadow-2xl transition-all duration-500 hover:scale-105 active:scale-95", 
          isOpen ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        )} 
        onClick={() => setIsOpen(true)}
      >
        <MessageSquare className="h-6 w-6" />
      </Button>
    </div>
  );
}
