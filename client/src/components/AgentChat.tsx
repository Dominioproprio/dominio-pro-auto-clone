/**
 * AgentChat — Chat atualizado com Integração GitHub Models (Etapa 2c)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  MessageCircle, X, Send, Sparkles, ArrowRight,
  ChevronDown, Lightbulb, AlertTriangle, TrendingUp, Zap, Brain,
  Mic, Volume2, VolumeX, ThumbsUp, ThumbsDown, HelpCircle,
} from "lucide-react";

// --- IMPORTAÇÃO DO NOVO ORQUESTRADOR ---
import { handleUserMessage } from "../agentOrchestrator";

import { trackPageVisit, trackAction, initTracker } from "@/lib/agentTracker";
import {
  generateSuggestions,
  getWelcomeMessage,
  getProactiveSuggestion,
  getSavedMessages,
  saveMessages,
  dismissSuggestion,
  processScheduledTasks,
  getUnreadCount,
  updateAgentPage,
  type AgentMessage,
  type AgentSuggestion,
} from "@/lib/agentBrain";
import {
  requestBrowserNotificationPermission,
  markAllNotificationsRead,
} from "@/lib/agentScheduler";
import {
  getPreferences,
  updatePreferences,
  addFeedback,
  trackQuestion,
  getContextualActions,
  getOnboardingStep,
  advanceOnboarding,
  skipOnboarding,
  speakText,
  stopSpeaking,
  type ContextualAction,
  type OnboardingStep,
} from "@/lib/agentLearning";

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [onboardingStep, setOnboardingStepState] = useState<OnboardingStep | null>(null);
  const [contextActions, setContextActions] = useState<ContextualAction[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const accent = getAccent();

  useEffect(() => {
    if (initialized) return;
    initTracker();
    requestBrowserNotificationPermission();
    const saved = getSavedMessages();
    if (saved.length > 0) {
      setMessages(saved);
    } else {
      const welcome = getWelcomeMessage();
      setMessages([welcome]);
      saveMessages([welcome]);
    }
    setUnreadCount(getUnreadCount());
    const prefs = getPreferences();
    setTtsEnabled(prefs.ttsEnabled);
    const step = getOnboardingStep();
    setOnboardingStepState(step);
    setInitialized(true);
  }, [initialized]);

  useEffect(() => {
    if (!initialized) return;
    setContextActions(getContextualActions(location));
    updateAgentPage(location);
    trackPageVisit(location);
  }, [location, initialized]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [messages, isOpen]);

  // ── PROCESSAR RESPOSTA DA IA (ETAPA 2c) ──────────────────
  const processAgentResponse = useCallback(async (text: string, source: string = "question") => {
    if (!text.trim()) return;

    trackAction("chat", source, text);
    trackQuestion(text);

    const userMsg: AgentMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      // Chamada ao orquestrador inteligente (Etapa 2c)
      const response = await handleUserMessage(text);

      const agentMsg: AgentMessage = {
        id: `agent_${Date.now()}`,
        role: "agent",
        content: response.text, // Texto vindo da IA ou NLU
        timestamp: Date.now(),
      };

      setMessages(prev => {
        const next = [...prev, agentMsg];
        saveMessages(next);
        return next;
      });

      // Se a IA indicar uma navegação, executa
      if (response.navigateTo) {
        setTimeout(() => setLocation(response.navigateTo!), 800);
      }

      if (ttsEnabled) speakText(response.text);

    } catch (error) {
      console.error("Erro no Agente:", error);
      const errorMsg: AgentMessage = {
        id: `err_${Date.now()}`,
        role: "agent",
        content: "Desculpe, tive um problema ao processar sua solicitação. Verifique sua conexão ou o token do GitHub.",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [ttsEnabled, setLocation]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    processAgentResponse(text, "question");
  }, [input, processAgentResponse]);

  // ── Voice Input ──────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript;
      setInput(transcript);
      if (event.results[last].isFinal) {
        setIsListening(false);
        processAgentResponse(transcript, "voice_question");
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, [isListening, processAgentResponse]);

  const handleFeedback = useCallback((msgId: string, rating: "positive" | "negative") => {
    const msgIndex = messages.findIndex(m => m.id === msgId);
    const prevUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === "user");
    addFeedback(msgId, rating, prevUserMsg?.content ?? "");
    setFeedbackGiven(prev => new Set(prev).add(msgId));
    trackAction("feedback", rating, msgId);
  }, [messages]);

  const handleSuggestionAction = useCallback((suggestion: AgentSuggestion) => {
    trackAction("suggestion_click", suggestion.id, suggestion.title);
    if (suggestion.actionRoute) {
      setLocation(suggestion.actionRoute);
      setIsOpen(false);
    }
    dismissSuggestion(suggestion.id);
  }, [setLocation]);

  const toggleChat = useCallback(() => {
    setIsOpen(prev => !prev);
    setHasNewMessage(false);
    markAllNotificationsRead();
    setUnreadCount(0);
    stopSpeaking();
  }, []);

  const toggleTts = useCallback(() => {
    const newVal = !ttsEnabled;
    setTtsEnabled(newVal);
    updatePreferences({ ttsEnabled: newVal });
    if (!newVal) stopSpeaking();
  }, [ttsEnabled]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed z-[9999] animate-slide-up flex flex-col overflow-hidden"
          style={{
            bottom: 88, right: 16,
            width: "min(380px, calc(100vw - 32px))",
            height: "min(520px, calc(100vh - 120px))",
            borderRadius: 20,
            background: "rgba(12, 12, 22, 0.95)",
            backdropFilter: "blur(40px)",
            border: `1px solid rgba(255,255,255,0.1)`,
            boxShadow: `0 25px 60px rgba(0,0,0,0.5), 0 0 40px ${accent}15`,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-white/10" style={{ background: `linear-gradient(135deg, ${accent}12, transparent)` }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}20`, border: `1px solid ${accent}40` }}>
              <Brain className="w-4.5 h-4.5" style={{ color: accent }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white/90">Super Agente IA</p>
              <p className="text-[10px] text-white/40">Domínio Pro Inteligente</p>
            </div>
            <button onClick={toggleTts} className="p-1.5 rounded-lg hover:bg-white/5">
              {ttsEnabled ? <Volume2 className="w-4 h-4" style={{ color: accent }} /> : <VolumeX className="w-4 h-4 text-white/30" />}
            </button>
            <button onClick={toggleChat} className="p-1.5 rounded-lg hover:bg-white/10">
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm"
                  style={msg.role === "user" ? { background: accent, color: "white" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)" }}
                >
                  {msg.content.split("\n").map((line, i) => (
                    <p key={i} className={i > 0 ? "mt-1.5" : ""}>{line}</p>
                  ))}
                  
                  {msg.role === "agent" && (
                    <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-white/5">
                      <button onClick={() => handleFeedback(msg.id, "positive")} className="p-1 hover:bg-white/10 rounded">
                        <ThumbsUp className="w-3 h-3 text-white/25 hover:text-green-400" />
                      </button>
                      <button onClick={() => handleFeedback(msg.id, "negative")} className="p-1 hover:bg-white/10 rounded">
                        <ThumbsDown className="w-3 h-3 text-white/25 hover:text-red-400" />
                      </button>
                    </div>
                  )}

                  {msg.suggestions?.map(sug => {
                    const Icon = getCategoryIcon(sug.category);
                    const col = getCategoryColor(sug.category);
                    return (
                      <div key={sug.id} onClick={() => handleSuggestionAction(sug)} className="mt-2 p-2 rounded-lg cursor-pointer transition-all hover:scale-[1.02]" style={{ background: `${col}15`, border: `1px solid ${col}30` }}>
                        <div className="flex gap-2">
                          <Icon className="w-3.5 h-3.5 mt-0.5" style={{ color: col }} />
                          <div>
                            <p className="text-xs font-bold" style={{ color: col }}>{sug.title}</p>
                            <p className="text-[10px] text-white/50">{sug.message}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {isTyping && <div className="text-[10px] text-white/30 animate-pulse">Agente pensando...</div>}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-white/5">
            {contextActions.map(act => (
              <button key={act.label} onClick={() => processAgentResponse(act.query)} className="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap" style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}25` }}>
                {act.label}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <div className="p-3">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <button onClick={toggleVoice} className={`p-1.5 rounded-lg ${isListening ? "bg-red-500/20" : ""}`}>
                <Mic className={`w-4 h-4 ${isListening ? "text-red-400 animate-pulse" : "text-white/30"}`} />
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Pergunte algo..."
                className="flex-1 bg-transparent text-sm text-white outline-none"
              />
              <button onClick={handleSend} disabled={!input.trim()} className="p-1.5 rounded-lg disabled:opacity-20" style={{ background: input.trim() ? accent : "transparent" }}>
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={toggleChat}
        className="fixed z-[9999] flex items-center justify-center transition-transform hover:scale-110"
        style={{ bottom: 20, right: 16, width: 56, height: 56, borderRadius: 18, background: isOpen ? "rgba(255,255,255,0.1)" : accent, boxShadow: `0 8px 32px ${accent}40` }}
      >
        {isOpen ? <X className="text-white/70" /> : <MessageCircle className="text-white" />}
      </button>
    </>
  );
}
