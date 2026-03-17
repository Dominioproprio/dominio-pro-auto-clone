/**
 * ClientesPage — CRUD de clientes com busca, histórico e importação.
 * Design: Glass Dashboard.
 */
import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Users, Phone, Mail, Search, ChevronRight,
  Calendar, RefreshCw,
} from "lucide-react";
import { clientsStore, appointmentsStore, type Client } from "@/lib/store";
import { Smartphone } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado", confirmed: "Confirmado", in_progress: "Em andamento",
  completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou",
};

export default function ClientesPage() {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchingContacts, setSearchingContacts] = useState(false);

  useEffect(() => {
    const onUpdate = () => setRefreshKey(k => k + 1);
    window.addEventListener("clients_updated", onUpdate);
    window.addEventListener("store_updated", onUpdate);
    return () => {
      window.removeEventListener("clients_updated", onUpdate);
      window.removeEventListener("store_updated", onUpdate);
    };
  }, []);
  const [form, setForm] = useState({ name: "", email: "", phone: "", birthDate: "", cpf: "", address: "", notes: "" });

  const clients = useMemo(() => clientsStore.list(), [refreshKey]);
  const allAppointments = useMemo(() => appointmentsStore.list({}), [refreshKey]);

  const clientAppointments = useMemo(() => {
    const map: Record<number, typeof allAppointments> = {};
    clients.forEach(c => {
      map[c.id] = allAppointments.filter(a =>
        a.clientName?.toLowerCase() === c.name.toLowerCase()
      );
    });
    return map;
  }, [clients, allAppointments]);

  const filtered = useMemo(() => {
    if (!search) return clients;
    const q = search.toLowerCase();
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", email: "", phone: "", birthDate: "", cpf: "", address: "", notes: "" });
    setModalOpen(true);
  };

  // Funcao para buscar contatos do celular
  const handleSearchPhoneContacts = async () => {
    setSearchingContacts(true);
    try {
      // Verifica se o navegador suporta a Contacts API
      if (!('contacts' in navigator)) {
        toast.error("Seu navegador nao suporta acesso a contatos");
        setSearchingContacts(false);
        return;
      }

      // Solicita permissao para acessar contatos
      const contacts = await (navigator as any).contacts.select(
        ['name', 'tel', 'email'],
        { multiple: true }
      );

      if (!contacts || contacts.length === 0) {
        toast.info("Nenhum contato selecionado");
        setSearchingContacts(false);
        return;
      }

      // Processa cada contato selecionado
      let addedCount = 0;
      for (const contact of contacts) {
        const name = contact.name?.[0] || "";
        const phone = contact.tel?.[0] || "";
        const email = contact.email?.[0] || "";

        if (!name.trim()) continue;

        // Verifica se o cliente ja existe
        const exists = clients.some(c => c.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          try {
            await clientsStore.create({
              name: name.trim(),
              phone: phone || null,
              email: email || null,
              birthDate: null,
              cpf: null,
              address: null,
              notes: null,
            });
            addedCount++;
          } catch (err) {
            console.error(`Erro ao adicionar ${name}:`, err);
          }
        }
      }

      if (addedCount > 0) {
        toast.success(`${addedCount} contato(s) importado(s) com sucesso!`);
        setRefreshKey(k => k + 1);
      } else {
        toast.info("Todos os contatos ja estao cadastrados");
      }
    } catch (err: any) {
      // Trata erro de permissao ou cancelamento
      if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
        toast.error("Permissao negada para acessar contatos");
      } else if (err.name === 'AbortError') {
        toast.info("Selecao de contatos cancelada");
      } else {
        console.error("Erro ao buscar contatos:", err);
        toast.error("Erro ao buscar contatos do celular");
      }
    } finally {
      setSearchingContacts(false);
    }
  };

  const openEdit = (client: Client) => {
    setEditingId(client.id);
    setForm({
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      birthDate: client.birthDate ?? "",
      cpf: client.cpf ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        birthDate: form.birthDate || null,
        cpf: form.cpf || null,
        address: form.address || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await clientsStore.update(editingId, payload);
        toast.success("Cliente atualizado!");
      } else {
        await clientsStore.create(payload);
        toast.success("Cliente cadastrado!");
      }
      setModalOpen(false);
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Excluir este cliente?")) return;
    try {
      await clientsStore.delete(id);
      toast.success("Cliente excluído");
      setRefreshKey(k => k + 1);
    } catch { toast.error("Erro ao excluir cliente"); }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      await clientsStore.clearAll();
      toast.success("Todos os clientes foram removidos");
      setClearAllOpen(false);
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao remover clientes");
    } finally {
      setClearingAll(false);
    }
  };

  const selectedClientData = selectedClient ? clients.find(c => c.id === selectedClient) : null;
  const selectedClientAppts = selectedClient ? (clientAppointments[selectedClient] ?? []) : [];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Clientes</h2>
          <p className="text-sm text-muted-foreground">{clients.length} cadastrados</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleSearchPhoneContacts}
            disabled={searchingContacts}
            variant="outline"
            className="gap-2 text-xs bg-transparent"
            title="Importar contatos do seu celular"
          >
            <Smartphone className="w-3.5 h-3.5" />
            {searchingContacts ? "Carregando..." : "Importar Contatos"}
          </Button>
          {clients.length > 0 && (
            <Button onClick={() => setClearAllOpen(true)} variant="outline" className="gap-2 text-destructive hover:text-destructive bg-transparent text-xs">
              <Trash2 className="w-3.5 h-3.5" />Limpar Tudo
            </Button>
          )}
          <Button onClick={openCreate} className="gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" />Novo Cliente
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, telefone ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(client => {
            const apptCount = (clientAppointments[client.id] ?? []).length;
            return (
              <div
                key={client.id}
                className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all duration-200 hover:border-primary/50 ${selectedClient === client.id ? "border-primary bg-primary/5" : "border-border bg-card/50"}`}
                onClick={() => setSelectedClient(selectedClient === client.id ? null : client.id)}
              >
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                    {client.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{client.name}</span>
                    {apptCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{apptCount} visita{apptCount !== 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    {client.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
                    {client.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{client.email}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={e => { e.stopPropagation(); openEdit(client); }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(client.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${selectedClient === client.id ? "rotate-90" : ""}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Client history panel */}
      {selectedClientData && (
        <Card className="border-primary/30 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Histórico de {selectedClientData.name}</h3>
            </div>
          </CardHeader>
          <CardContent>
            {selectedClientAppts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum agendamento encontrado</p>
            ) : (
              <div className="space-y-2">
                {selectedClientAppts.slice(0, 10).map(appt => (
                  <div key={appt.id} className="flex items-center gap-3 text-sm py-2 border-b border-border last:border-0">
                    <div className={`w-2 h-2 rounded-full ${appt.status === "completed" ? "bg-green-400" : appt.status === "cancelled" ? "bg-red-400" : "bg-blue-400"}`} />
                    <span className="text-muted-foreground text-xs">
                      {format(new Date(appt.startTime), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                    <span className="flex-1 font-medium text-xs">{STATUS_LABELS[appt.status] ?? appt.status}</span>
                    {appt.totalPrice && <span className="text-primary font-semibold text-xs">R$ {appt.totalPrice.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            )}
            {selectedClientData.notes && (
              <div className="mt-3 p-3 bg-secondary/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Observações</p>
                <p className="text-sm">{selectedClientData.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal - Novo/Editar */}
      <Dialog open={modalOpen} onOpenChange={v => !v && setModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Editar Cliente" : "Novo Cliente"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo" />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>CPF</Label>
                <Input value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
              </div>
              <div className="space-y-1">
                <Label>Data de nascimento</Label>
                <Input type="date" value={form.birthDate} onChange={e => setForm(p => ({ ...p, birthDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Rua, número, bairro, cidade..." />
            </div>
            <div className="space-y-1">
              <Label>Observações / Preferências</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Preferências, alergias, observações..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={loading}>{loading ? "Salvando..." : editingId ? "Salvar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Limpar Tudo */}
      <Dialog open={clearAllOpen} onOpenChange={v => !v && setClearAllOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Limpar todos os clientes?</DialogTitle></DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Esta ação vai deletar <span className="font-semibold text-foreground">{clients.length} cliente(s)</span> permanentemente.
            </p>
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm text-destructive">Atenção: esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearAllOpen(false)} disabled={clearingAll}>Cancelar</Button>
            <Button variant="destructive" onClick={handleClearAll} disabled={clearingAll} className="gap-2">
              {clearingAll ? <><RefreshCw className="w-4 h-4 animate-spin" />Deletando...</> : <><Trash2 className="w-4 h-4" />Deletar Tudo</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
