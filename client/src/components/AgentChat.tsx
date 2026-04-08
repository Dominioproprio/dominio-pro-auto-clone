/**
 * AgentChat.tsx — Interface do Agente IA
 *
 * - Passa histórico de conversa real para executarAgente()
 * - Lida com ResultadoAgente tipado (agendamentoCriado, erro)
 * - Lê accent e salonName do localStorage (compatível com salonConfig)
 * - Persiste mensagens no localStorage (max 50)
 * - Suporte a voz (Web Speech API)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain, X, Send, Mic, ChevronDown,
  Trash2, Bot, User, Loader2, CalendarCheck,
} from "lucide-react";
import { executarAgente, type MensagemConversa } from "@/lib/ai-agent";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  tipo?: "success" | "error" | "info";
}

// ─── Config do salão (lida do localStorage / salonConfig) ─────────────────────

function getAccent(): string {
  try {
    const raw = localStorage.getItem("salon_config");
    if (raw) return JSON.parse(raw).accentColor || "#ec4899";
  } catch {}
  return "#ec4899";
}

function getSalonName(): string {
  try {
    const raw = localStorage.getItem("salon_config");
    if (raw) return JSON.parse(raw).salonName || "Domínio Pro";
  } catch {}
  return "Domínio Pro";
}

// ─── Ações rápidas ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "📅 Agenda hoje",    query: "Quais agendamentos temos para hoje?" },
  { label: "✂️ Novo agendamento", query: "Quero fazer um novo agendamento" },
  { label: "🔍 Buscar cliente",  query: "Preciso buscar informações de um cliente" },
  { label: "💰 Faturamento",     query: "Qual o faturamento de hoje?" },
  { label: "👥 Equipe livre",    query: "Quais funcionários estão livres agora?" },
];

// ─── Persistência de mensagens ────────────────────────────────────────────────

const STORAGE_KEY = "dominio_pro_agent_chat";

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50)));
  } catch {}
}

// ─── Converte ChatMessage[] em histórico para o agente ────────────────────────

function toHistorico(msgs: ChatMessage[]): MensagemConversa[] {
  return msgs
    .filter(m => m.role === "user" || m.role === "agent")
    .map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function AgentChat() {
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [input, setInput]           = useState("");
  const [isTyping, setIsTyping]     = useState(false);
  const [hasNew, setHasNew]         = useState(false);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const lastSentRef    = useRef<number>(0);
  const cooldownRef    = useRef<number>(0);

  const accent     = getAccent();
  const salonName  = getSalonName();

  // ── Inicialização ──────────────────────────────────────
  useEffect(() => {
    const saved = loadMessages();
    if (saved.length > 0) {
      setMessages(saved);
    } else {
      const welcome: ChatMessage = {
        id: "welcome",
        role: "agent",
        content: `Olá! Sou o Assistente IA do ${salonName}. 🤖\nPosso ajudar com agendamentos, consultar a agenda, buscar clientes e responder dúvidas sobre os serviços. Como posso ajudar?`,
        timestamp: Date.now(),
        tipo: "info",
      };
      setMessages([welcome]);
      saveMessages([welcome]);
    }
  }, [salonName]);

  // ── Scroll automático ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
    return () => clearTimeout(timer);
  }, [messages, isOpen, isTyping]);

  // ── Foco no input ao abrir ─────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ── Enviar mensagem ────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const agora = Date.now();
    const textoLimpo = text.trim();
    if (!textoLimpo || isTyping) return;
    if (agora - lastSentRef.current < 1500) return; // debounce mais seguro
    if (agora < cooldownRef.current) {
      // ainda em cooldown — mostra aviso suave sem chamar a API
      return;
    }
    lastSentRef.current = agora;

    // Adiciona mensagem do usuário
    const userMsg: ChatMessage = {
      id: `u_${agora}`,
      role: "user",
      content: textoLimpo,
      timestamp: agora,
    };

    setMessages(prev => {
      const next = [...prev, userMsg];
      saveMessages(next);
      return next;
    });
    setInput("");
    setIsTyping(true);

    try {
      // Obtém histórico atual para passar ao agente
      const historico = toHistorico(messages);

      const resultado = await executarAgente(textoLimpo, historico);

      // Mensagem do agente
      const agentMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "agent",
        content: resultado.texto,
        timestamp: Date.now(),
        tipo: resultado.erro ? "error" : resultado.agendamentoCriado ? "success" : undefined,
      };

      // Se agendamento foi criado, adiciona notificação inline
      const extras: ChatMessage[] = [];
      if (resultado.agendamentoCriado) {
        const appt = resultado.agendamentoCriado;
        const dataFormatada = new Date(appt.startTime).toLocaleString("pt-BR", {
          weekday: "long", day: "2-digit", month: "long",
          hour: "2-digit", minute: "2-digit",
        });
        extras.push({
          id: `sys_${Date.now()}`,
          role: "agent",
          content: `✅ Agendamento #${appt.id} salvo com sucesso para ${dataFormatada}.`,
          timestamp: Date.now() + 1,
          tipo: "success",
        });
      }

      setMessages(prev => {
        const next = [...prev, agentMsg, ...extras];
        saveMessages(next);
        return next;
      });

      if (!isOpen) setHasNew(true);
      // Cooldown de 3s após cada resposta para não disparar rajada na Groq
      cooldownRef.current = Date.now() + 3000;

    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `e_${Date.now()}`,
        role: "agent",
        content: "❌ Não consegui processar sua mensagem. Verifique a conexão e tente novamente.",
        timestamp: Date.now(),
        tipo: "error",
      };
      setMessages(prev => {
        const next = [...prev, errorMsg];
        saveMessages(next);
        return next;
      });
    } finally {
      setIsTyping(false);
    }
  }, [isTyping, isOpen, messages]);

  const handleSend = useCallback(() => sendMessage(input), [input, sendMessage]);

  // ── Limpar conversa ────────────────────────────────────
  const handleClear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    const welcome: ChatMessage = {
      id: `welcome_${Date.now()}`,
      role: "agent",
      content: "Conversa reiniciada! Como posso ajudar?",
      timestamp: Date.now(),
      tipo: "info",
    };
    setMessages([welcome]);
    saveMessages([welcome]);
  }, []);

  // ── Reconhecimento de voz ──────────────────────────────
  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }
    const r = new SR();
    r.lang = "pt-BR";
    r.continuous = false;
    r.interimResults = false;
    r.onstart  = () => setIsListening(true);
    r.onerror  = () => setIsListening(false);
    r.onend    = () => setIsListening(false);
    r.onresult = (e: any) => {
      const transcript = e.results[e.results.length - 1][0].transcript;
      setInput(transcript);
      setIsListening(false);
      sendMessage(transcript);
    };
    recognitionRef.current = r;
    r.start();
  }, [isListening, sendMessage]);

  const toggleChat = useCallback(() => {
    setIsOpen(p => !p);
    setHasNew(false);
  }, []);

  // ── Cor da bolha por tipo ──────────────────────────────
  function getBubbleStyle(msg: ChatMessage): React.CSSProperties {
    if (msg.role === "user") {
      return { background: accent, color: "white" };
    }
    if (msg.tipo === "success") {
      return { background: "rgba(16,185,129,0.15)", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(16,185,129,0.3)" };
    }
    if (msg.tipo === "error") {
      return { background: "rgba(239,68,68,0.12)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(239,68,68,0.3)" };
    }
    return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.1)" };
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Painel do chat ────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed z-[9999] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
          style={{
            bottom: 88, right: 16,
            width: "min(420px, calc(100vw - 32px))",
            height: "min(600px, calc(100vh - 110px))",
            borderRadius: 20,
            background: "rgba(8, 8, 18, 0.98)",
            backdropFilter: "blur(40px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: `0 30px 70px rgba(0,0,0,0.7), 0 0 50px ${accent}12`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-white/[0.07]"
            style={{ background: `linear-gradient(135deg, ${accent}12, transparent)` }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${accent}20`, border: `1px solid ${accent}40` }}
            >
              <Brain className="w-4 h-4" style={{ color: accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white/90 truncate">Agente IA</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <p className="text-[10px] text-white/40 truncate">{salonName}</p>
              </div>
            </div>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
              title="Limpar conversa"
            >
              <Trash2 className="w-3.5 h-3.5 text-white/25 hover:text-white/60 transition-colors" />
            </button>
            <button
              onClick={toggleChat}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            >
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </div>

          {/* Mensagens */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" style={{ overscrollBehavior: "contain" }}>
            <div className="space-y-4">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  {/* Rótulo */}
                  <div className="flex items-center gap-1 mb-1 opacity-35">
                    {msg.role === "user"
                      ? <User className="w-2.5 h-2.5 text-white" />
                      : msg.tipo === "success"
                        ? <CalendarCheck className="w-2.5 h-2.5 text-emerald-400" />
                        : <Bot className="w-2.5 h-2.5 text-white" />
                    }
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white">
                      {msg.role === "user" ? "Você" : "Assistente"}
                    </span>
                    <span className="text-[9px] text-white/30 ml-0.5">
                      {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  {/* Bolha */}
                  <div
                    className="px-4 py-2.5 rounded-2xl text-sm max-w-[87%] whitespace-pre-wrap break-words leading-relaxed shadow-sm"
                    style={getBubbleStyle(msg)}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Indicador de digitação */}
              {isTyping && (
                <div className="flex items-start gap-2">
                  <div
                    className="px-4 py-3 rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <div className="flex gap-1.5 items-center">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full animate-bounce"
                          style={{ backgroundColor: accent, animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                      <span className="text-[10px] text-white/30 ml-1">pensando…</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Ações rápidas */}
          <div
            className="px-3 py-2 flex gap-1.5 overflow-x-auto border-t shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.05)" }}
          >
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={() => sendMessage(a.query)}
                disabled={isTyping}
                className="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap shrink-0 transition-all hover:opacity-90 active:scale-95 disabled:opacity-30"
                style={{
                  background: `${accent}14`,
                  color: accent,
                  border: `1px solid ${accent}28`,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="p-3 shrink-0">
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2 transition-all"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid rgba(255,255,255,0.09)`,
              }}
            >
              <button
                onClick={toggleVoice}
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                  isListening ? "bg-red-500/20" : "hover:bg-white/5"
                }`}
                title={isListening ? "Parar gravação" : "Falar"}
              >
                <Mic className={`w-4 h-4 transition-colors ${
                  isListening ? "text-red-400 animate-pulse" : "text-white/25"
                }`} />
              </button>

              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Pergunte algo..."
                disabled={isTyping}
                className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/20 disabled:opacity-40 min-w-0"
              />

              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="p-1.5 rounded-lg transition-all shrink-0 disabled:opacity-20 active:scale-95"
                style={{
                  background: input.trim() && !isTyping ? accent : "transparent",
                }}
                title="Enviar"
              >
                {isTyping
                  ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  : <Send className="w-3.5 h-3.5 text-white" />
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB ───────────────────────────────────────── */}
      <button
        onClick={toggleChat}
        className="fixed z-[9999] flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          bottom: 20, right: 16,
          width: 56, height: 56,
          borderRadius: 18,
          background: isOpen ? "rgba(255,255,255,0.08)" : accent,
          boxShadow: isOpen ? "none" : `0 8px 32px ${accent}55, 0 2px 8px rgba(0,0,0,0.3)`,
          border: isOpen ? "1px solid rgba(255,255,255,0.1)" : "none",
        }}
        aria-label={isOpen ? "Fechar agente" : "Abrir agente IA"}
      >
        {isOpen ? (
          <X className="w-5 h-5 text-white/70" />
        ) : (
          <div className="relative">
            <Brain className="w-6 h-6 text-white" />
            {hasNew && (
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2"
                style={{ background: "#ef4444", borderColor: "#0a0a12" }}
              />
            )}
          </div>
        )}
      </button>
    </>
  );
}
