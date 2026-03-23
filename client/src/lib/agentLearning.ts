/**
 * agentLearning.ts — Sistema de aprendizado adaptativo do agente.
 * Rastreia preferencias do usuario, padroes de uso e feedback para
 * personalizar sugestoes e respostas ao longo do tempo.
 *
 * Funcionalidades:
 * - Rastreamento de perguntas frequentes
 * - Registro de feedback (util/nao util) em respostas
 * - Deteccao de padroes de uso (horarios, features favoritas)
 * - Sugestoes de onboarding para novos usuarios
 * - Quick actions contextuais baseados na pagina atual
 * - Preferencias de voz (velocidade, idioma)
 */

// ─── Tipos ─────────────────────────────────────────────────

export interface UserPreferences {
  voiceEnabled: boolean;
  voiceSpeed: number;             // 0.5 a 2.0
  voicePitch: number;             // 0.5 a 2.0
  ttsEnabled: boolean;            // text-to-speech nas respostas
  onboardingCompleted: boolean;
  onboardingStep: number;
  firstUseDate: number;
  totalInteractions: number;
  favoriteQuestions: string[];    // perguntas mais frequentes
  dismissedTips: string[];        // dicas que o usuario ja descartou
}

export interface FeedbackEntry {
  messageId: string;
  rating: "positive" | "negative";
  question: string;
  timestamp: number;
}

export interface UsagePattern {
  hourlyUsage: number[];          // 24 slots, contagem por hora
  topQuestions: Array<{ question: string; count: number }>;
  topPages: Array<{ page: string; timeSpent: number }>;
  lastActive: number;
}

export interface ContextualAction {
  label: string;
  query: string;
  icon?: string;
}

// ─── Storage ───────────────────────────────────────────────

const PREFS_KEY = "dominio_agent_preferences";
const FEEDBACK_KEY = "dominio_agent_feedback";
const PATTERNS_KEY = "dominio_agent_patterns";
const QUESTION_LOG_KEY = "dominio_agent_question_log";

function loadPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    voiceEnabled: false,
    voiceSpeed: 1.0,
    voicePitch: 1.0,
    ttsEnabled: false,
    onboardingCompleted: false,
    onboardingStep: 0,
    firstUseDate: Date.now(),
    totalInteractions: 0,
    favoriteQuestions: [],
    dismissedTips: [],
  };
}

function savePrefs(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFeedback(entries: FeedbackEntry[]): void {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries.slice(-200)));
  } catch { /* ignore */ }
}

function loadPatterns(): UsagePattern {
  try {
    const raw = localStorage.getItem(PATTERNS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    hourlyUsage: new Array(24).fill(0),
    topQuestions: [],
    topPages: [],
    lastActive: Date.now(),
  };
}

function savePatterns(patterns: UsagePattern): void {
  try {
    localStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
  } catch { /* ignore */ }
}

// ─── Preferencias ──────────────────────────────────────────

export function getPreferences(): UserPreferences {
  return loadPrefs();
}

export function updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
  const prefs = loadPrefs();
  const updated = { ...prefs, ...partial };
  savePrefs(updated);
  return updated;
}

export function incrementInteractions(): void {
  const prefs = loadPrefs();
  prefs.totalInteractions++;
  savePrefs(prefs);
}

// ─── Feedback ──────────────────────────────────────────────

export function addFeedback(messageId: string, rating: "positive" | "negative", question: string): void {
  const entries = loadFeedback();
  entries.push({ messageId, rating, question, timestamp: Date.now() });
  saveFeedback(entries);
}

export function getFeedbackStats(): { positive: number; negative: number; total: number } {
  const entries = loadFeedback();
  const positive = entries.filter(e => e.rating === "positive").length;
  const negative = entries.filter(e => e.rating === "negative").length;
  return { positive, negative, total: entries.length };
}

/** Retorna se o tipo de pergunta costuma ter feedback negativo */
export function hasNegativeFeedbackPattern(question: string): boolean {
  const entries = loadFeedback();
  const q = question.toLowerCase();
  const similar = entries.filter(e => {
    const eq = e.question.toLowerCase();
    return eq.includes(q.substring(0, 20)) || q.includes(eq.substring(0, 20));
  });
  if (similar.length < 2) return false;
  const negCount = similar.filter(e => e.rating === "negative").length;
  return negCount / similar.length > 0.5;
}

// ─── Padroes de uso ────────────────────────────────────────

export function trackQuestion(question: string): void {
  const patterns = loadPatterns();
  const hour = new Date().getHours();
  patterns.hourlyUsage[hour]++;
  patterns.lastActive = Date.now();

  // Atualizar top questions
  const norm = question.toLowerCase().trim();
  const existing = patterns.topQuestions.find(q => q.question === norm);
  if (existing) {
    existing.count++;
  } else {
    patterns.topQuestions.push({ question: norm, count: 1 });
  }

  // Manter apenas top 50
  patterns.topQuestions.sort((a, b) => b.count - a.count);
  patterns.topQuestions = patterns.topQuestions.slice(0, 50);

  savePatterns(patterns);
  incrementInteractions();
}

export function getUsagePatterns(): UsagePattern {
  return loadPatterns();
}

/** Retorna o horario de pico do usuario */
export function getPeakHour(): number {
  const patterns = loadPatterns();
  let maxIdx = 0;
  let maxVal = 0;
  patterns.hourlyUsage.forEach((val, idx) => {
    if (val > maxVal) { maxVal = val; maxIdx = idx; }
  });
  return maxIdx;
}

/** Retorna as perguntas mais frequentes do usuario */
export function getFrequentQuestions(limit: number = 5): string[] {
  const patterns = loadPatterns();
  return patterns.topQuestions.slice(0, limit).map(q => q.question);
}

// ─── Onboarding ────────────────────────────────────────────

export interface OnboardingStep {
  id: number;
  title: string;
  message: string;
  action?: string;       // query a executar
  actionLabel?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 0,
    title: "Bem-vinda ao Assistente!",
    message: "Eu sou o assistente inteligente do seu salao. Vou te ajudar a gerenciar agendamentos, ver relatorios e muito mais. Vamos fazer um tour rapido?",
    actionLabel: "Vamos la!",
  },
  {
    id: 1,
    title: "Pergunte qualquer coisa",
    message: "Voce pode me perguntar sobre faturamento, agendamentos, clientes... Tente digitar ou usar o microfone!",
    action: "quanto faturei este mes?",
    actionLabel: "Testar: Quanto faturei?",
  },
  {
    id: 2,
    title: "Avisos automaticos",
    message: "Posso te avisar periodicamente sobre o rendimento do salao. E so me pedir!",
    action: "me avisa todo sabado o rendimento da semana",
    actionLabel: "Testar: Aviso semanal",
  },
  {
    id: 3,
    title: "Gerenciar agenda",
    message: "Posso mover, cancelar ou reagendar agendamentos por voce. Basta me dizer o que precisa!",
    actionLabel: "Entendi!",
  },
  {
    id: 4,
    title: "Fale comigo por voz",
    message: "Clique no icone do microfone para falar por voz. Eu tambem posso ler as respostas em voz alta!",
    actionLabel: "Concluir tour",
  },
];

export function getOnboardingStep(): OnboardingStep | null {
  const prefs = loadPrefs();
  if (prefs.onboardingCompleted) return null;
  if (prefs.onboardingStep >= ONBOARDING_STEPS.length) {
    updatePreferences({ onboardingCompleted: true });
    return null;
  }
  return ONBOARDING_STEPS[prefs.onboardingStep];
}

export function advanceOnboarding(): OnboardingStep | null {
  const prefs = loadPrefs();
  const nextStep = prefs.onboardingStep + 1;
  if (nextStep >= ONBOARDING_STEPS.length) {
    updatePreferences({ onboardingCompleted: true, onboardingStep: nextStep });
    return null;
  }
  updatePreferences({ onboardingStep: nextStep });
  return ONBOARDING_STEPS[nextStep];
}

export function skipOnboarding(): void {
  updatePreferences({ onboardingCompleted: true, onboardingStep: ONBOARDING_STEPS.length });
}

// ─── Quick Actions Contextuais ─────────────────────────────

/** Retorna quick actions baseados na pagina atual */
export function getContextualActions(currentPage: string): ContextualAction[] {
  const page = currentPage.replace(/^\//, "").split("/")[0] || "dashboard";

  const contextActions: Record<string, ContextualAction[]> = {
    dashboard: [
      { label: "Resumo do dia", query: "resumo de hoje" },
      { label: "Faturamento", query: "quanto faturei este mes?" },
      { label: "Sugestoes", query: "o que posso melhorar?" },
    ],
    agenda: [
      { label: "Agenda hoje", query: "como esta minha agenda hoje?" },
      { label: "Cancelamentos", query: "quantos cancelamentos este mes?" },
      { label: "Mover agendamento", query: "como mover agendamento?" },
    ],
    clientes: [
      { label: "Total clientes", query: "quantos clientes tenho?" },
      { label: "Inativos", query: "quantos clientes inativos?" },
      { label: "Importar", query: "como importar clientes?" },
    ],
    funcionarios: [
      { label: "Minha equipe", query: "como funciona minha equipe?" },
      { label: "Comissoes", query: "como configurar comissoes?" },
      { label: "Desempenho", query: "rendimento por funcionario" },
    ],
    servicos: [
      { label: "Populares", query: "quais servicos sao mais populares?" },
      { label: "Criar servico", query: "como criar um servico?" },
      { label: "Relatorio", query: "relatorio de servicos do mes" },
    ],
    caixa: [
      { label: "Status caixa", query: "o caixa esta aberto?" },
      { label: "Faturamento", query: "quanto faturei hoje?" },
      { label: "Fechar caixa", query: "como fechar o caixa?" },
    ],
    relatorios: [
      { label: "Resumo semana", query: "resumo da semana" },
      { label: "Rendimento liquido", query: "rendimento liquido do mes" },
      { label: "Comparativo", query: "faturamento comparado ao mes anterior" },
    ],
    configuracoes: [
      { label: "Backup", query: "como fazer backup?" },
      { label: "Horarios", query: "como configurar horarios?" },
      { label: "Ajuda", query: "o que voce pode fazer?" },
    ],
  };

  // Retorna acoes contextuais ou as do dashboard como default
  const actions = contextActions[page] ?? contextActions.dashboard ?? [];

  // Adicionar perguntas frequentes do usuario como acoes extras
  const freqQuestions = getFrequentQuestions(2);
  const extraActions: ContextualAction[] = freqQuestions
    .filter(q => !actions.some(a => a.query === q))
    .map(q => ({
      label: q.length > 25 ? q.substring(0, 22) + "..." : q,
      query: q,
      icon: "star",
    }));

  return [...actions, ...extraActions].slice(0, 5);
}

// ─── Dicas adaptativas ─────────────────────────────────────

export function getAdaptiveTip(): string | null {
  const prefs = loadPrefs();
  const patterns = loadPatterns();

  const tips: Array<{ id: string; condition: boolean; tip: string }> = [
    {
      id: "voice_tip",
      condition: prefs.totalInteractions > 5 && !prefs.voiceEnabled,
      tip: "Dica: Voce pode falar comigo por voz! Clique no icone do microfone.",
    },
    {
      id: "schedule_tip",
      condition: prefs.totalInteractions > 10 && patterns.topQuestions.some(q => q.question.includes("fatur") && q.count > 2),
      tip: "Notei que voce pergunta bastante sobre faturamento. Quer que eu te avise automaticamente? Diga: \"me avisa todo sabado o rendimento da semana\"",
    },
    {
      id: "report_tip",
      condition: prefs.totalInteractions > 15,
      tip: "Dica: Voce pode pedir relatorios completos! Tente: \"resumo completo do mes\"",
    },
    {
      id: "agenda_tip",
      condition: prefs.totalInteractions > 8,
      tip: "Dica: Posso mover agendamentos por voce! Tente: \"troque os agendamentos de [nome] de segunda para sexta\"",
    },
    {
      id: "tts_tip",
      condition: prefs.totalInteractions > 20 && prefs.voiceEnabled && !prefs.ttsEnabled,
      tip: "Dica: Posso ler as respostas em voz alta! Ative nas configuracoes do chat.",
    },
  ];

  const applicableTips = tips.filter(t =>
    t.condition && !prefs.dismissedTips.includes(t.id)
  );

  if (applicableTips.length === 0) return null;

  // Retorna a primeira dica nao descartada
  return applicableTips[0].tip;
}

export function dismissTip(tipId: string): void {
  const prefs = loadPrefs();
  if (!prefs.dismissedTips.includes(tipId)) {
    prefs.dismissedTips.push(tipId);
    savePrefs(prefs);
  }
}

// ─── Text-to-Speech ────────────────────────────────────────

/** Fala o texto usando a API de Speech Synthesis do navegador */
export function speakText(text: string): void {
  const prefs = loadPrefs();
  if (!prefs.ttsEnabled) return;

  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  // Cancelar fala anterior
  window.speechSynthesis.cancel();

  // Limpar markdown
  const cleanText = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[#*_~`]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "pt-BR";
  utterance.rate = prefs.voiceSpeed;
  utterance.pitch = prefs.voicePitch;

  // Tentar usar voz em portugues
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.startsWith("pt")) ??
                  voices.find(v => v.lang.startsWith("pt-BR"));
  if (ptVoice) utterance.voice = ptVoice;

  window.speechSynthesis.speak(utterance);
}

/** Para de falar */
export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/** Verifica se esta falando */
export function isSpeaking(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  return window.speechSynthesis.speaking;
}
