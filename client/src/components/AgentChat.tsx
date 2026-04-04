/**
 * AgentChat.tsx — Interface do Agente IA 2.0 (Simplificado e Veloz)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  X, Send, Brain, ChevronDown, Trash2
} from "lucide-react";
// Usando caminho relativo para evitar erro de resolução do Vercel
import { executarAgente } from "../lib/ai-agent";

// ─── Tipos ─────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
}

// ─── Helpers Visuais ───────────────────────────────────────
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
];

const MESSAGES_KEY = "dominiopro_chat_history";

// ─── Componente Principal ──────────────────────────────────
export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [, setLocation] = useLocation();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const accent = getAccent();
  const salonName = getSalonName();

  useEffect(() => {
    const saved = localStorage.getItem(MESSAGES_KEY);
    if (saved) {
      setMessages(JSON.parse(saved));
    } else {
      setMessages([{
        id: "welcome",
        role: "agent",
        content: `Olá Fernanda! Sou o novo Agente do ${salonName}. Como posso te ajudar hoje?`,
        timestamp: Date.now(),
      }]);
    }
  }, [salonName]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

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
      const respostaIA = await executarAgente(text.trim());

      const agentMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "agent",
        content: respostaIA,
        timestamp: Date.now(),
      };

      const finalMessages = [...newMessages, agentMsg];
      setMessages(finalMessages);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(finalMessages));
    } catch (err) {
      setMessages(prev => [...prev, {
        id: "err", role: "agent", content: "Erro na conexão. Verifique sua chave API no Vercel.", timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [messages, isTyping]);

  const handleClear = () => {
    localStorage.removeItem(MESSAGES_KEY);
    setMessages([{ id: "w", role: "agent", content: "Conversa reiniciada!", timestamp: Date.now() }]);
  };

  return (
    <>
      {isOpen && (
        <div className="fixed z-[9999] flex flex-col overflow-hidden shadow-2xl"
          style={{
            bottom: 88, right: 16,
            width: "min(400px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 110px))",
            borderRadius: 20,
            background: "rgba(10, 10, 20, 0.98)",
            border: `1px solid rgba(255,255,255,0.1)`,
          }}>
          
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10"
            style={{ background: `linear-gradient(135deg, ${accent}20, transparent)` }}>
            <Brain className="w-5 h-5" style={{ color: accent }} />
            <div className="flex-1">
              <p className="text-sm font-bold text-white">Agente Pro</p>
              <p className="text-[10px] text-emerald-400">Online e Veloz</p>
            </div>
            <button onClick={handleClear} className="p-1.5 hover:bg-white/10 rounded-lg">
              <Trash2 className="w-4 h-4 text-white/30" />
            </button>
            <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg">
              <ChevronDown className="w-4 h-4 text-white/50" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === "user" ? "" : "bg-white/5 border border-white/10 text-white/90"}`}
                  style={msg.role === "user" ? { background: accent, color: "white" } : {}}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isTyping && <div className="text-[10px] text-white/30 animate-pulse">Agente pensando...</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-black/20">
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {QUICK_ACTIONS.map(q => (
                <button key={q.label} onClick={() => sendMessage(q.query)}
                  className="text-[10px] px-3 py-1 rounded-full border border-white/10 text-white/50 hover:text-white">
                  {q.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage(input)}
                placeholder="Como posso ajudar?"
                className="flex-1 bg-transparent text-sm text-white outline-none"
              />
              <button onClick={() => sendMessage(input)} className="p-1.5 rounded-lg" style={{ background: accent }}>
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed z-[9999] flex items-center justify-center hover:scale-110 transition-transform"
        style={{
          bottom: 20, right: 16,
          width: 60, height: 60,
          borderRadius: 20,
          background: accent,
          boxShadow: `0 10px 30px ${accent}40`,
        }}>
        {isOpen ? <X className="text-white" /> : <Brain className="text-white w-7 h-7" />}
      </button>
    </>
  );
}

