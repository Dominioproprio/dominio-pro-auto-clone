/**
 * AgentChat.tsx — Interface do Agente IA v2
 * Usa agentV2 (LLM-first com tool calling) em vez do orquestrador antigo.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  MessageCircle, X, Send, Brain, Mic, ChevronDown,
  ThumbsUp, ThumbsDown, Trash2, Zap,
} from "lucide-react";
import { handleMessageV2, clearHistory } from "@/lib/agentV2";

// ─── Tipos ─────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
}

// ─── Helpers ───────────────────────────────────────────────

function getAccent(): string {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch {}
  return "#ec4899";
}

function getSalonName(): string {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).salonName || "Domínio Pro";
  } catch {}
  return "Domínio Pro";
}

const QUICK_ACTIONS = [
  { label: "Agenda hoje", query: "Quais agendamentos temos hoje?" },
  { label: "Agendar", query: "Quero fazer um agendamento" },
  { label: "Buscar cliente", query: "Preciso buscar um cliente" },
  { label: "Faturamento", query: "Qual o faturamento de hoje?" },
];

const MESSAGES_KEY = "agentv2_chat_messages";

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistMessages(msgs: ChatMessage[]) {
  try {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs.slice(-50)));
  } catch {}
}

// ─── Componente Principal ──────────────────────────────────

export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [, setLocation] = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const accent = getAccent();
  const salonName = getSalonName();

  // Carregar mensagens salvas
  useEffect(() => {
    const saved = loadMessages();
    if (saved.length > 0) {
      setMessages(saved);
    } else {
      const welcome: ChatMessage = {
        id: "welcome",
        role: "agent",
        content: `Olá! Sou o Agente IA do ${salonName}. Posso ajudar com agendamentos, clientes, serviços e muito mais. Como posso ajudar?`,
        timestamp: Date.now(),
      };
      setMessages([welcome]);
      persistMessages([welcome]);
    }
  }, []);

  // Scroll para o final
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [messages, isOpen]);

  // ── Enviar mensagem ──────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => {
      const next = [...prev, userMsg];
      persistMessages(next);
      return next;
    });
    setInput("");
    setIsTyping(true);

    try {
      const response = await handleMessageV2(text.trim());

      const agentMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "agent",
        content: response.text,
        timestamp: Date.now(),
      };

      setMessages(prev => {
        const next = [...prev, agentMsg];
        persistMessages(next);
        return next;
      });

      if (!isOpen) setHasNew(true);

      if (response.navigateTo) {
        setTimeout(() => setLocation(response.navigateTo!), 1000);
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `e_${Date.now()}`,
        role: "agent",
        content: "Não consegui processar agora. Verifique seu token e tente novamente.",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [isTyping, isOpen, setLocation]);

  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  // ── Limpar conversa ──────────────────────────────────────
  const handleClear = useCallback(() => {
    clearHistory();
    localStorage.removeItem(MESSAGES_KEY);
    const welcome: ChatMessage = {
      id: `welcome_${Date.now()}`,
      role: "agent",
      content: `Conversa reiniciada! Como posso ajudar?`,
      timestamp: Date.now(),
    };
    setMessages([welcome]);
    persistMessages([welcome]);
  }, []);

  // ── Voice Input ──────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = "pt-BR";
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => {
      const t = e.results[e.results.length - 1][0].transcript;
      setInput(t);
      if (e.results[e.results.length - 1].isFinal) {
        setIsListening(false);
        sendMessage(t);
      }
    };
    r.onerror = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
  }, [isListening, sendMessage]);

  const toggleChat = useCallback(() => {
    setIsOpen(p => !p);
    setHasNew(false);
  }, []);

  return (
    <>
      {/* Chat Panel */}
      {isOpen && (
        <div
          className="fixed z-[9999] flex flex-col overflow-hidden"
          style={{
            bottom: 88, right: 16,
            width: "min(400px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 110px))",
            borderRadius: 20,
            background: "rgba(10, 10, 20, 0.97)",
            backdropFilter: "blur(40px)",
            border: `1px solid rgba(255,255,255,0.1)`,
            boxShadow: `0 25px 60px rgba(0,0,0,0.6), 0 0 40px ${accent}18`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-white/10"
            style={{ background: `linear-gradient(135deg, ${accent}15, transparent)` }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${accent}25`, border: `1px solid ${accent}50` }}
            >
              <Brain className="w-4 h-4" style={{ color: accent }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white/90">Agente IA</p>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[10px] text-white/40">Online — {salonName}</p>
              </div>
            </div>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="Limpar conversa"
            >
              <Trash2 className="w-3.5 h-3.5 text-white/30 hover:text-white/60" />
            </button>
            <button onClick={toggleChat} className="p-1.5 rounded-lg hover:bg-white/10">
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm"
                  style={
                    msg.role === "user"
                      ? { background: accent, color: "white" }
                      : {
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          color: "rgba(255,255,255,0.88)",
                        }
                  }
                >
                  {msg.content.split("\n").map((line, i) => (
                    <p key={i} className={i > 0 ? "mt-1" : ""}>{line}</p>
                  ))}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div
                  className="px-4 py-3 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full animate-bounce"
                        style={{ backgroundColor: accent, animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-white/5 shrink-0">
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={() => sendMessage(a.query)}
                disabled={isTyping}
                className="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap shrink-0 transition-opacity disabled:opacity-40"
                style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="p-3 shrink-0">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <button
                onClick={toggleVoice}
                className={`p-1.5 rounded-lg transition-colors ${isListening ? "bg-red-500/20" : "hover:bg-white/5"}`}
              >
                <Mic className={`w-4 h-4 ${isListening ? "text-red-400 animate-pulse" : "text-white/30"}`} />
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Pergunte algo..."
                disabled={isTyping}
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/20 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="p-1.5 rounded-lg transition-all disabled:opacity-20"
                style={{ background: input.trim() && !isTyping ? accent : "transparent" }}
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={toggleChat}
        className="fixed z-[9999] flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        style={{
          bottom: 20, right: 16,
          width: 56, height: 56,
          borderRadius: 18,
          background: isOpen ? "rgba(255,255,255,0.1)" : accent,
          boxShadow: isOpen ? "none" : `0 8px 32px ${accent}50`,
        }}
      >
        {isOpen
          ? <X className="w-5 h-5 text-white/70" />
          : (
            <div className="relative">
              <Brain className="w-6 h-6 text-white" />
              {hasNew && (
                <div
                  className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-black"
                  style={{ background: "#ef4444" }}
                />
              )}
            </div>
          )
        }
      </button>
    </>
  );
}
