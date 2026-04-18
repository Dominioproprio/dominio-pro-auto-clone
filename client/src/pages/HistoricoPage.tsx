/**
 * HistoricoPage — Log de auditoria com filtros por tipo de entidade.
 */
import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { History, Search, Calendar, User, Scissors, DollarSign, Clock } from "lucide-react";
import { auditStore, type AuditLog } from "@/lib/store";

const ENTITY_TYPES = [
  { value: "all", label: "Todos" },
  { value: "appointment", label: "Agendamentos" },
  { value: "client", label: "Clientes" },
  { value: "employee", label: "Funcionários" },
  { value: "service", label: "Serviços" },
  { value: "cash_session", label: "Caixa" },
];

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-500/20 text-emerald-400",
  update: "bg-blue-500/20 text-blue-400",
  delete: "bg-red-500/20 text-red-400",
};

const ENTITY_ICONS: Record<string, React.ElementType> = {
  appointment: Calendar,
  client: User,
  employee: User,
  service: Scissors,
  cash_session: DollarSign,
};

export default function HistoricoPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    auditStore.fetchAll()
      .then(() => forceUpdate(n => n + 1))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const logs = useMemo(() => {
    const all = auditStore.log(filter === "all" ? undefined : filter);
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter(l => l.description.toLowerCase().includes(q) || l.entityType.toLowerCase().includes(q));
  }, [filter, search]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Histórico</h2>
        <p className="text-sm text-muted-foreground">Log de todas as alterações no sistema</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar no histórico..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{logs.length} registros</Badge>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{loading ? "Carregando..." : "Nenhum registro encontrado"}</p>
          <p className="text-sm mt-1">{loading ? "Buscando histórico..." : "O histórico será preenchido conforme o uso do sistema"}</p>
        </div>
      ) : (
        <Card className="border-border bg-card/50">
          <CardContent className="pt-4">
            <div className="space-y-0">
              {logs.slice(0, 100).map((log, i) => {
                const Icon = ENTITY_ICONS[log.entityType] ?? Clock;
                return (
                  <div key={log.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0">
                    <div className="w-8 h-8 rounded-lg bg-secondary/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{log.description}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                        </span>
                        <Badge variant="secondary" className={`text-[10px] ${ACTION_COLORS[log.action] ?? ""}`}>
                          {log.action === "create" ? "Criado" : log.action === "update" ? "Atualizado" : "Removido"}
                        </Badge>
                        {log.userName && (
                          <span className="text-xs text-muted-foreground">por {log.userName}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
