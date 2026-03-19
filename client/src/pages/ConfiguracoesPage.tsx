/**
 * ConfiguracoesPage — Configurações gerais do salão.
 */
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { THEME_PALETTES } from "@/components/DominioLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Settings, Building2, Clock, Bell, Palette, Save, ImagePlus, Trash2, Scissors, Monitor, Zap } from "lucide-react";
import { applyAccentColor } from "@/contexts/ThemeContext";

type BgType = "default" | "solid" | "gradient" | "image";

interface SalonConfig {
  salonName: string;
  ownerName: string;
  phone: string;
  address: string;
  openTime: string;
  closeTime: string;
  slotDuration: number;
  notifyEmail: boolean;
  autoOpenCash: boolean;
  accentColor: string;
  themeId: string;
  logoUrl: string;
  bgType: BgType;
  bgColor: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  bgGradientDir: string;
  bgImageUrl: string;
}

const DEFAULT_CONFIG: SalonConfig = {
  salonName: "Salão Bella",
  ownerName: "",
  phone: "",
  address: "",
  openTime: "08:00",
  closeTime: "20:00",
  slotDuration: 30,
  notifyEmail: false,
  autoOpenCash: true,
  accentColor: "#ec4899",
  themeId: "rosa-neon",
  logoUrl: "",
  bgType: "default",
  bgColor: "#09091a",
  bgGradientFrom: "#09091a",
  bgGradientTo: "#1a0929",
  bgGradientDir: "135deg",
  bgImageUrl: "",
};

const GRADIENT_PRESETS = [
  { from: "#09091a", to: "#1a0929", label: "Rosa noturno" },
  { from: "#0a0a1a", to: "#001a2e", label: "Azul profundo" },
  { from: "#0d1a0d", to: "#0a1a0d", label: "Verde floresta" },
  { from: "#1a0a00", to: "#2e1000", label: "Âmbar quente" },
  { from: "#1a1a1a", to: "#2e2e2e", label: "Cinza elegante" },
];

const ACCENT_COLORS = [
  "#ec4899", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#3b82f6", "#84cc16", "#f97316", "#6366f1",
];

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<SalonConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const logoInputRef  = useRef<HTMLInputElement>(null);
  const bgImgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("salon_config");
      if (saved) setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
    } catch { /* ignore */ }
  }, []);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error("Imagem muito grande. Use uma imagem menor que 500KB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => updateConfig("logoUrl", ev.target?.result as string);
    reader.readAsDataURL(file);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const handleBgImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast.error("Imagem muito grande. Use uma imagem menor que 3MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => updateConfig("bgImageUrl", ev.target?.result as string);
    reader.readAsDataURL(file);
    if (bgImgInputRef.current) bgImgInputRef.current.value = "";
  };

  const handleSave = () => {
    setLoading(true);
    try {
      localStorage.setItem("salon_config", JSON.stringify(config));
      // Dispara evento para o SalaoLayout atualizar sem precisar recarregar
      window.dispatchEvent(new Event("salon_config_updated"));
      toast.success("Configurações salvas!");
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (field: keyof SalonConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Configurações</h2>
          <p className="text-sm text-muted-foreground">Configurações gerais do salão</p>
        </div>
        <Button onClick={handleSave} disabled={loading} className="gap-2">
          <Save className="w-4 h-4" />{loading ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Salon info */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />Dados do Salão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Logo upload */}
          <div className="space-y-2">
            <Label>Logo do salão</Label>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-border bg-secondary/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                {config.logoUrl ? (
                  <img src={config.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Scissors className="w-6 h-6 opacity-40" />
                    <span className="text-[10px]">sem logo</span>
                  </div>
                )}
              </div>
              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-2 text-xs" onClick={() => logoInputRef.current?.click()}>
                  <ImagePlus className="w-3.5 h-3.5" />
                  {config.logoUrl ? "Trocar logo" : "Carregar logo"}
                </Button>
                {config.logoUrl && (
                  <Button type="button" variant="ghost" size="sm" className="gap-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => updateConfig("logoUrl", "")}>
                    <Trash2 className="w-3.5 h-3.5" />Remover logo
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground">PNG, JPG ou SVG. Máx 500KB.</p>
              </div>
            </div>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: "none" }} onChange={handleLogoSelect} />
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Nome do salão</Label>
              <Input value={config.salonName} onChange={e => updateConfig("salonName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Proprietário(a)</Label>
              <Input value={config.ownerName} onChange={e => updateConfig("ownerName", e.target.value)} placeholder="Nome do proprietário" />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={config.phone} onChange={e => updateConfig("phone", e.target.value)} placeholder="(11) 99999-9999" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Endereço</Label>
            <Textarea value={config.address} onChange={e => updateConfig("address", e.target.value)} placeholder="Endereço completo" rows={2} />
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />Horário de Funcionamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Abertura</Label>
              <Input type="time" value={config.openTime} onChange={e => updateConfig("openTime", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fechamento</Label>
              <Input type="time" value={config.closeTime} onChange={e => updateConfig("closeTime", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Intervalo de slots (min)</Label>
              <Input type="number" min="5" step="5" value={config.slotDuration} onChange={e => updateConfig("slotDuration", parseInt(e.target.value) || 30)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Automação */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />Automação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Abertura automática do caixa</p>
              <p className="text-xs text-muted-foreground">Abrir o caixa automaticamente ao iniciar o app (com saldo do dia anterior)</p>
            </div>
            <Switch checked={config.autoOpenCash} onCheckedChange={v => updateConfig("autoOpenCash", v)} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Notificação por E-mail</p>
              <p className="text-xs text-muted-foreground">Enviar confirmações por e-mail (requer integração SMTP)</p>
            </div>
            <Switch checked={config.notifyEmail} onCheckedChange={v => updateConfig("notifyEmail", v)} />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="border-border bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="w-4 h-4 text-primary" />Aparência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Seletor de tema */}
          <div className="space-y-3">
            <Label>Tema do app</Label>
            <div className="grid grid-cols-2 gap-2">
              {THEME_PALETTES.map(t => (
                <button key={t.id} type="button"
                  onClick={() => {
                    updateConfig("themeId", t.id);
                    updateConfig("accentColor", t.accent);
                    applyAccentColor(t.accent);
                    updateConfig("bgType", "default");
                  }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 transition-all text-left"
                  style={{
                    backgroundColor: t.bg,
                    borderColor: config.themeId === t.id ? t.accent : "transparent",
                    boxShadow: config.themeId === t.id ? `0 0 12px ${t.accent}50` : "none",
                  }}>
                  <div className="w-6 h-6 rounded-full flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}88)` }} />
                  <span className="text-xs font-semibold" style={{ color: config.themeId === t.id ? t.accent : "#fff" }}>
                    {t.name}
                  </span>
                  {config.themeId === t.id && (
                    <span className="ml-auto text-xs" style={{ color: t.accent }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Cor de acento */}
          <div className="space-y-2">
            <Label>Cor principal</Label>
            <div className="flex gap-2 flex-wrap">
              {ACCENT_COLORS.map(c => (
                <button key={c} type="button" onClick={() => { updateConfig("accentColor", c); applyAccentColor(c); }}
                  className={`w-10 h-10 rounded-full border-2 transition-all ${config.accentColor === c ? "border-white scale-110 shadow-lg" : "border-transparent"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          <Separator />

          {/* Fundo do app */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5" />Fundo do app
            </Label>

            {/* Tipo de fundo */}
            <div className="grid grid-cols-3 gap-2">
              {(["default", "solid", "gradient", "image"] as BgType[]).map(type => {
                const labels = { default: "Padrão", solid: "Cor sólida", gradient: "Gradiente", image: "Imagem" };
                return (
                  <button key={type} type="button"
                    onClick={() => updateConfig("bgType", type)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      config.bgType === type
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border bg-card/30 text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>

            {/* Cor sólida */}
            {config.bgType === "solid" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Escolha a cor</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={config.bgColor}
                    onChange={e => updateConfig("bgColor", e.target.value)}
                    className="w-12 h-10 rounded-lg border border-border cursor-pointer bg-transparent" />
                  <div className="w-full h-10 rounded-lg border border-border" style={{ backgroundColor: config.bgColor }} />
                </div>
              </div>
            )}

            {/* Gradiente */}
            {config.bgType === "gradient" && (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Presets</Label>
                <div className="flex gap-2 flex-wrap">
                  {GRADIENT_PRESETS.map(p => (
                    <button key={p.label} type="button"
                      onClick={() => { updateConfig("bgGradientFrom", p.from); updateConfig("bgGradientTo", p.to); }}
                      className="w-10 h-10 rounded-full border-2 border-transparent hover:border-white/50 transition-all"
                      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                      title={p.label}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Cor inicial</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={config.bgGradientFrom}
                        onChange={e => updateConfig("bgGradientFrom", e.target.value)}
                        className="w-10 h-8 rounded border border-border cursor-pointer bg-transparent" />
                      <span className="text-xs text-muted-foreground">{config.bgGradientFrom}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Cor final</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={config.bgGradientTo}
                        onChange={e => updateConfig("bgGradientTo", e.target.value)}
                        className="w-10 h-8 rounded border border-border cursor-pointer bg-transparent" />
                      <span className="text-xs text-muted-foreground">{config.bgGradientTo}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Direção</Label>
                  <div className="flex gap-2 flex-wrap">
                    {[["↘ Diagonal", "135deg"], ["↓ Vertical", "180deg"], ["→ Horizontal", "90deg"], ["↗ Anti-diag", "45deg"]].map(([label, val]) => (
                      <button key={val} type="button"
                        onClick={() => updateConfig("bgGradientDir", val)}
                        className={`px-2.5 py-1 rounded text-xs border transition-all ${
                          config.bgGradientDir === val ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {/* Preview */}
                <div className="w-full h-12 rounded-lg border border-border"
                  style={{ background: `linear-gradient(${config.bgGradientDir}, ${config.bgGradientFrom}, ${config.bgGradientTo})` }} />
              </div>
            )}

            {/* Imagem */}
            {config.bgType === "image" && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-24 h-16 rounded-lg border border-dashed border-border bg-secondary/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {config.bgImageUrl
                      ? <img src={config.bgImageUrl} alt="fundo" className="w-full h-full object-cover" />
                      : <span className="text-[10px] text-muted-foreground text-center px-1">sem imagem</span>
                    }
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-2 text-xs" onClick={() => bgImgInputRef.current?.click()}>
                      <ImagePlus className="w-3.5 h-3.5" />
                      {config.bgImageUrl ? "Trocar imagem" : "Escolher imagem"}
                    </Button>
                    {config.bgImageUrl && (
                      <Button type="button" variant="ghost" size="sm" className="gap-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => updateConfig("bgImageUrl", "")}>
                        <Trash2 className="w-3.5 h-3.5" />Remover
                      </Button>
                    )}
                    <p className="text-[10px] text-muted-foreground">PNG, JPG. Máx 3MB.</p>
                  </div>
                </div>
                <input ref={bgImgInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={handleBgImageSelect} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="border-border bg-card/30">
        <CardContent className="pt-5">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Settings className="w-4 h-4" />
            <div>
              <p><strong>Domínio Pro</strong> v2.0 — Sistema de Gestão para Salões de Beleza</p>
              <p className="text-xs mt-0.5">Dados armazenados no Supabase (nuvem). Abertura automática de caixa, histórico de serviços e reagendamento inteligente.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
