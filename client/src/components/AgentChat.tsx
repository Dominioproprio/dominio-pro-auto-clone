/**
 * AgentChat — Chat flutuante do agente inteligente.
 * Observa o uso do app, sugere melhorias e responde perguntas.
 * Design glassmorphism consistente com o tema do app.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  MessageCircle, X, Send, Sparkles, ArrowRight,
  ChevronDown, Lightbulb, AlertTriangle, TrendingUp, Zap, Brain,
} from "lucide-react";
import { trackPageVisit, trackAction, initTracker } from "@/lib/agentTracker";
import {
  generateSuggestions,
  answerQuestion,
  getWelcomeMessage,
  getProactiveSuggestion,
  getSavedMessages,
  saveMessages,
  dismissSuggestion,
  type AgentMessage,
  type AgentSuggestion,
} from "@/lib/agentBrain";

// ─── Helpers ───────────────────────────────────────────────

function getAccent(): string {
  try {
    const s = localStorage.getItem("salon_config");
    if (s) return JSON.parse(s).accentColor || "#ec4899";
  } catch { /* ignore */ }
  return "#ec4899";
}

function getCategoryIcon(cat: AgentSuggestion["category"]) {
  switch (cat) {
    case "dica":     return Lightbulb;
    case "alerta":   return AlertTriangle;
    case "melhoria": return Zap;
    case "acao":     return ArrowRight;
    case "insight":  return TrendingUp;
    default:         return Sparkles;
  }
}

function getCategoryColor(cat: AgentSuggestion["category"]): string {
  switch (cat) {
    case "dica":     return "#3b82f6";
    case "alerta":   return "#f59e0b";
    case "melhoria": return "#8b5cf6";
    case "acao":     return "#10b981";
    case "insight":  return "#06b6d4";
    default:         return "#ec4899";
  }
}

// ─── Componente Principal ──────────────────────────────────

export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const accent = getAccent();

  // ── Inicializar tracker e carregar mensagens ────────────
  useEffect(() => {
    if (initialized) return;
    initTracker();

    const saved = getSavedMessages();
    if (saved.length > 0) {
      setMessages(saved);
    } else {
      const welcome = getWelcomeMessage();
      setMessages([welcome]);
      saveMessages([welcome]);
    }
    setInitialized(true);
  }, [initialized]);

  // ── Rastrear navegacao ──────────────────────────────────
  useEffect(() => {
    if (!initialized) return;
    trackPageVisit(location);
  }, [location, initialized]);

  // ── Escutar eventos do store para tracking ──────────────
  useEffect(() => {
    if (!initialized) return;

    const handlers: Array<[string, EventListener]> = [
      ["store_updated", () => trackAction("data_change", "store")],
      ["clients_updated", () => trackAction("update", "clients")],
      ["cash_entry_auto_launched", () => trackAction("auto_launch", "cash_entry")],
    ];

    handlers.forEach(([event, handler]) => window.addEventListener(event, handler));
    return () => {
      handlers.forEach(([event, handler]) => window.removeEventListener(event, handler));
    };
  }, [initialized]);

  // ── Sugestoes proativas periodicas ──────────────────────
  useEffect(() => {
    if (!initialized) return;

    const checkProactive = () => {
      if (isOpen) return; // nao interromper se o chat esta aberto

      const suggestion = getProactiveSuggestion();
      if (suggestion) {
        // Verifica se ja nao sugerimos algo similar recentemente
        const lastAgent = messages.filter(m => m.role === "agent").slice(-1)[0];
        if (lastAgent && Date.now() - lastAgent.timestamp < 5 * 60 * 1000) return; // 5 min cooldown

        setMessages(prev => {
          const next = [...prev, suggestion];
          saveMessages(next);
          return next;
        });
        setHasNewMessage(true);
      }
    };

    // Verificar apos 30s e depois a cada 3 min
    const initialTimer = setTimeout(checkProactive, 30000);
    const interval = setInterval(checkProactive, 180000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [initialized, isOpen, messages]);

  // ── Auto-scroll ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // ── Focus no input ao abrir ─────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // ── Enviar mensagem ─────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    trackAction("chat", "question", text);

    const userMsg: AgentMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Simula tempo de "pensamento" (300-800ms)
    setTimeout(() => {
      const answer = answerQuestion(text);
      const agentMsg: AgentMessage = {
        id: `agent_${Date.now()}`,
        role: "agent",
        content: answer,
        timestamp: Date.now(),
      };

      setMessages(prev => {
        const next = [...prev, agentMsg];
        saveMessages(next);
        return next;
      });
      setIsTyping(false);
    }, 300 + Math.random() * 500);
  }, [input]);

  // ── Acao de sugestao ────────────────────────────────────
  const handleSuggestionAction = useCallback((suggestion: AgentSuggestion) => {
    trackAction("suggestion_click", suggestion.id, suggestion.title);

    if (suggestion.actionRoute) {
      setLocation(suggestion.actionRoute);
      setIsOpen(false);
    }

    dismissSuggestion(suggestion.id);
  }, [setLocation]);

  // ── Ver sugestoes ───────────────────────────────────────
  const handleShowSuggestions = useCallback(() => {
    const suggestions = generateSuggestions();

    if (suggestions.length === 0) {
      const msg: AgentMessage = {
        id: `agent_${Date.now()}`,
        role: "agent",
        content: "Tudo certo por aqui! Nao encontrei nenhuma sugestao pendente no momento. Continue usando o app e eu vou observando para identificar oportunidades de melhoria.",
        timestamp: Date.now(),
      };
      setMessages(prev => {
        const next = [...prev, msg];
        saveMessages(next);
        return next;
      });
      return;
    }

    const msg: AgentMessage = {
      id: `agent_${Date.now()}`,
      role: "agent",
      content: `Encontrei **${suggestions.length}** sugestao(oes) para voce:`,
      timestamp: Date.now(),
      suggestions: suggestions.slice(0, 5),
    };
    setMessages(prev => {
      const next = [...prev, msg];
      saveMessages(next);
      return next;
    });
  }, []);

  // ── Toggle ──────────────────────────────────────────────
  const toggleChat = useCallback(() => {
    setIsOpen(prev => !prev);
    setHasNewMessage(false);
  }, []);

  // ── Render ──────────────────────────────────────────────
  return (
    <>
      {/* ── Chat Window ── */}
      {isOpen && (
        <div
          className="fixed z-[9999] animate-slide-up"
          style={{
            bottom: 88,
            right: 16,
            width: "min(380px, calc(100vw - 32px))",
            height: "min(520px, calc(100vh - 120px))",
            borderRadius: 20,
            background: "rgba(12, 12, 22, 0.95)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            border: `1px solid rgba(255,255,255,0.1)`,
            boxShadow: `0 25px 60px rgba(0,0,0,0.5), 0 0 40px ${accent}15`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: `linear-gradient(135deg, ${accent}12, transparent)`,
            }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
                border: `1px solid ${accent}40`,
              }}
            >
              <Brain className="w-4.5 h-4.5" style={{ color: accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white/90">Assistente IA</p>
              <p className="text-[10px] text-white/40">Observando e aprendendo</p>
            </div>
            <button
              onClick={handleShowSuggestions}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              title="Ver sugestoes"
            >
              <Sparkles className="w-4 h-4" style={{ color: accent }} />
            </button>
            <button
              onClick={toggleChat}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            >
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={
                    msg.role === "user"
                      ? {
                          background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                          color: "white",
                          borderBottomRightRadius: 6,
                        }
                      : {
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          color: "rgba(255,255,255,0.85)",
                          borderBottomLeftRadius: 6,
                        }
                  }
                >
                  {/* Render message with bold support */}
                  {msg.content.split("\n").map((line, i) => (
                    <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                      {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                        part.startsWith("**") && part.endsWith("**") ? (
                          <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>
                        ) : (
                          <span key={j}>{part}</span>
                        )
                      )}
                    </p>
                  ))}

                  {/* Suggestion cards */}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.suggestions.map(sug => {
                        const Icon = getCategoryIcon(sug.category);
                        const color = getCategoryColor(sug.category);
                        return (
                          <div
                            key={sug.id}
                            className="rounded-xl p-2.5 cursor-pointer transition-all hover:scale-[1.01]"
                            style={{
                              background: `${color}10`,
                              border: `1px solid ${color}25`,
                            }}
                            onClick={() => handleSuggestionAction(sug)}
                          >
                            <div className="flex items-start gap-2">
                              <Icon
                                className="w-3.5 h-3.5 mt-0.5 shrink-0"
                                style={{ color }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold" style={{ color }}>
                                  {sug.title}
                                </p>
                                <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2">
                                  {sug.message}
                                </p>
                                {sug.actionLabel && (
                                  <div className="flex items-center gap-1 mt-1.5">
                                    <span
                                      className="text-[10px] font-medium"
                                      style={{ color }}
                                    >
                                      {sug.actionLabel}
                                    </span>
                                    <ArrowRight className="w-3 h-3" style={{ color }} />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl px-4 py-3"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderBottomLeftRadius: 6,
                  }}
                >
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 flex gap-2 overflow-x-auto shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {[
              { label: "Faturamento", q: "quanto faturei este mes?" },
              { label: "Hoje", q: "como esta minha agenda hoje?" },
              { label: "Ajuda", q: "o que voce pode fazer?" },
            ].map(({ label, q }) => (
              <button
                key={label}
                onClick={() => {
                  setInput(q);
                  setTimeout(() => {
                    const text = q;
                    trackAction("chat", "quick_action", text);
                    const userMsg: AgentMessage = {
                      id: `user_${Date.now()}`,
                      role: "user",
                      content: text,
                      timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, userMsg]);
                    setInput("");
                    setIsTyping(true);
                    setTimeout(() => {
                      const answer = answerQuestion(text);
                      const agentMsg: AgentMessage = {
                        id: `agent_${Date.now()}`,
                        role: "agent",
                        content: answer,
                        timestamp: Date.now(),
                      };
                      setMessages(prev => {
                        const next = [...prev, agentMsg];
                        saveMessages(next);
                        return next;
                      });
                      setIsTyping(false);
                    }, 400);
                  }, 50);
                }}
                className="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all hover:scale-105 shrink-0"
                style={{
                  background: `${accent}15`,
                  border: `1px solid ${accent}25`,
                  color: `${accent}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-1 shrink-0">
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
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
                className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/25 outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-1.5 rounded-lg transition-all disabled:opacity-30"
                style={{
                  background: input.trim() ? accent : "transparent",
                }}
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB (Floating Action Button) ── */}
      <button
        onClick={toggleChat}
        className="fixed z-[9999] transition-all duration-300 hover:scale-110 active:scale-95"
        style={{
          bottom: 20,
          right: 16,
          width: 56,
          height: 56,
          borderRadius: 18,
          background: isOpen
            ? "rgba(255,255,255,0.1)"
            : `linear-gradient(135deg, ${accent}, ${accent}bb)`,
          border: `1px solid ${isOpen ? "rgba(255,255,255,0.15)" : `${accent}60`}`,
          boxShadow: isOpen
            ? "0 8px 32px rgba(0,0,0,0.3)"
            : `0 8px 32px ${accent}40, 0 0 20px ${accent}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isOpen ? (
          <X className="w-5 h-5 text-white/70" />
        ) : (
          <>
            <MessageCircle className="w-5.5 h-5.5 text-white" />
            {/* Notification badge */}
            {hasNewMessage && (
              <div
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center animate-pulse-ring"
                style={{ background: "#ef4444" }}
              >
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>
            )}
          </>
        )}
      </button>
    </>
  );
}
