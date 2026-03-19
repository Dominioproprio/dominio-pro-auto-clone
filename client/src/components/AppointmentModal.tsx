/**
 * AppointmentModal — Modal de criação/edição de agendamento.
 * Design: Glass Dashboard. Adaptado de tRPC para localStorage store.
 * Suporta groupId para agrupar serviços do mesmo cliente.
 * INTEGRADO: Busca de clientes no clientsStore e criação de novos clientes.
 */
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { format, addMinutes, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Clock, DollarSign, X, Link2, UserPlus, Search, RotateCcw, History } from "lucide-react";
import {
  employeesStore, servicesStore, appointmentsStore, clientsStore,
  type Appointment, type AppointmentService,
} from "@/lib/store";

const STATUS_OPTIONS = [
  { value: "scheduled",   label: "Agendado"       },
  { value: "confirmed",   label: "Confirmado"      },
  { value: "in_progress", label: "Em andamento"    },
  { value: "completed",   label: "Concluído"       },
  { value: "cancelled",   label: "Cancelado"       },
  { value: "no_show",     label: "Não compareceu"  },
];

interface SelectedService {
  serviceId: number;
  name: string;
  price: number;
  durationMinutes: number;
  color: string;
  materialCostPercent: number;
}

interface AppointmentModalProps {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaultEmployeeId?: number;
  defaultHour?: number;
  defaultMinute?: number;
  selectedDate: string;
  groupClientName?: string;
  groupId?: string;
  onSuccess: () => void;
  onAddGroupService?: (clientName: string, groupId: string) => void;
}

const newGroupId = () => `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export default function AppointmentModal({
  open,
  onClose,
  appointment,
  defaultEmployeeId,
  defaultHour = 9,
  defaultMinute = 0,
  selectedDate,
  groupClientName,
  groupId: incomingGroupId,
  onSuccess,
  onAddGroupService,
}: AppointmentModalProps) {
  const isEditing = !!appointment;

  // Client selection state
  const [clientName, setClientName]             = useState("");
  const [clientId, setClientId]                 = useState<number | null>(null);
  const [clientSearch, setClientSearch]         = useState("");
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientEmail, setNewClientEmail]     = useState("");
  const [newClientPhone, setNewClientPhone]     = useState("");

  // Appointment state
  const [employeeId, setEmployeeId]             = useState<string>("");
  const [apptDate, setApptDate]                 = useState(selectedDate);
  const [startTime, setStartTime]               = useState("09:00");
  const [status, setStatus]                     = useState("scheduled");
  const [notes, setNotes]                       = useState("");
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  const [loading, setLoading]                   = useState(false);

  const employees = useMemo(() => employeesStore.list(true), [open]);
  const servicesData = useMemo(() => servicesStore.list(true), [open]);
  const [clientsKey, setClientsKey] = useState(0);
  const allClients = useMemo(() => clientsStore.list(), [open, clientsKey]);

  useEffect(() => {
    const onUpdate = () => setClientsKey(k => k + 1);
    window.addEventListener("clients_updated", onUpdate);
    return () => window.removeEventListener("clients_updated", onUpdate);
  }, []);

  // Filtrar clientes por busca
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return [];
    const search = clientSearch.toLowerCase();
    return allClients.filter(c =>
      c.name.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.phone?.includes(search)
    );
  }, [clientSearch, allClients]);

  // Load siblings only when editing a grouped appointment
  const groupSiblings = useMemo(() => {
    if (!isEditing || !appointment?.groupId) return [];
    const allAppointments = appointmentsStore.list({ date: selectedDate });
    return allAppointments.filter(
      a => a.groupId === appointment.groupId && a.id !== appointment.id
    );
  }, [isEditing, appointment, selectedDate, open]);

  const totalDuration = selectedServices.reduce((s, sv) => s + sv.durationMinutes, 0);
  const totalPrice    = selectedServices.reduce((s, sv) => s + sv.price, 0);

  const endTime = useMemo(() => {
    if (!startTime || totalDuration === 0) return "";
    const [h, m] = startTime.split(":").map(Number);
    const start  = new Date(2000, 0, 1, h, m);
    return format(addMinutes(start, totalDuration), "HH:mm");
  }, [startTime, totalDuration]);

  // Populate form when modal opens
  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setClientName(appointment.clientName ?? "");
      setClientId(appointment.clientId ?? null);
      setClientSearch("");
      setShowNewClientForm(false);
      setNewClientEmail("");
      setNewClientPhone("");
      setEmployeeId(String(appointment.employeeId));
      setApptDate(format(new Date(appointment.startTime), "yyyy-MM-dd"));
      setStartTime(format(new Date(appointment.startTime), "HH:mm"));
      setStatus(appointment.status);
      setNotes(appointment.notes ?? "");
      if (appointment.services?.length) {
        setSelectedServices(appointment.services.map(s => {
          const svc = servicesData.find(sv => sv.id === s.serviceId);
          return {
            serviceId: s.serviceId,
            name: svc?.name ?? s.name ?? `Serviço #${s.serviceId}`,
            price: s.price,
            durationMinutes: svc?.durationMinutes ?? s.durationMinutes ?? 60,
            color: svc?.color ?? s.color ?? "#ec4899",
            materialCostPercent: svc?.materialCostPercent ?? s.materialCostPercent ?? 0,
          };
        }));
      } else {
        setSelectedServices([]);
      }
    } else {
      const h = String(defaultHour).padStart(2, "0");
      const m = String(defaultMinute).padStart(2, "0");
      setClientName(groupClientName ?? "");
      setClientId(null);
      setClientSearch("");
      setShowNewClientForm(false);
      setNewClientEmail("");
      setNewClientPhone("");
      setEmployeeId(defaultEmployeeId ? String(defaultEmployeeId) : "");
      setApptDate(selectedDate);
      setStartTime(`${h}:${m}`);
      setStatus("scheduled");
      setNotes("");
      
      // ─── Pré-preenchimento para clientes recorrentes ───
      if (clientId) {
        const allAppts = appointmentsStore.list({});
        const clientAppts = allAppts
          .filter(a => a.clientId === clientId && a.status === "completed")
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        if (clientAppts.length > 0) {
          const lastAppt = clientAppts[0];

          // Pré-preenche com o funcionário anterior
          if (lastAppt.employeeId && !defaultEmployeeId) {
            setEmployeeId(String(lastAppt.employeeId));
          }

          // Se o último agendamento faz parte de um grupo, reconstitui todos os serviços da visita
          if (!groupClientName) {
            let lastVisitServices = lastAppt.services ?? [];
            if (lastAppt.groupId) {
              const groupAppts = clientAppts
                .filter(a => a.groupId === lastAppt.groupId)
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
              lastVisitServices = groupAppts.flatMap(a => a.services ?? []);
            }
            if (lastVisitServices.length > 0) {
              setSelectedServices(lastVisitServices.map(s => ({
                serviceId: s.serviceId,
                name: s.name,
                price: s.price,
                durationMinutes: s.durationMinutes,
                color: s.color,
                materialCostPercent: s.materialCostPercent ?? 0,
              })));
            }
          }
        }
      } else {
        setSelectedServices([]);
      }
    }
  }, [open, appointment, defaultEmployeeId, defaultHour, defaultMinute, groupClientName, servicesData]);

  const addService = (serviceId: string) => {
    if (!serviceId) return;
    const svc = servicesData.find(s => s.id === parseInt(serviceId));
    if (!svc) return;
    if (selectedServices.find(s => s.serviceId === svc.id)) { toast.error("Serviço já adicionado"); return; }
    setSelectedServices(prev => [...prev, {
      serviceId: svc.id,
      name: svc.name,
      price: svc.price,
      durationMinutes: svc.durationMinutes,
      color: svc.color,
      materialCostPercent: svc.materialCostPercent ?? 0,
    }]);
  };

  const removeService = (serviceId: number) =>
    setSelectedServices(prev => prev.filter(s => s.serviceId !== serviceId));

  const buildPayload = (gid?: string | null) => {
    const [sh, sm] = startTime.split(":").map(Number);
    const base     = parseISO(apptDate);
    const startDt  = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm);
    const endDt    = addMinutes(startDt, totalDuration || 60);
    return {
      clientName: clientName.trim(),
      clientId: clientId,
      employeeId: parseInt(employeeId),
      startTime: startDt.toISOString(),
      endTime: endDt.toISOString(),
      status: status as Appointment["status"],
      totalPrice,
      notes: notes.trim() || null,
      paymentStatus: null as string | null,
      groupId: gid ?? null,
      services: selectedServices.map(s => ({
        serviceId: s.serviceId,
        name: s.name,
        price: s.price,
        durationMinutes: s.durationMinutes,
        color: s.color,
        materialCostPercent: s.materialCostPercent ?? 0,
      })),
    };
  };

  const handleSelectClient = (client: typeof allClients[0]) => {
    setClientId(client.id);
    setClientName(client.name);
    setClientSearch("");
  };

  const handleCreateNewClient = async () => {
    if (!clientName.trim()) { toast.error("Nome do cliente é obrigatório"); return; }
    try {
      const newClient = await clientsStore.create({
        name: clientName.trim(),
        email: newClientEmail.trim() || null,
        phone: newClientPhone.trim() || null,
        birthDate: null,
        cpf: null,
        address: null,
        notes: null,
      });
      setClientId(newClient.id);
      setShowNewClientForm(false);
      setNewClientEmail("");
      setNewClientPhone("");
      toast.success(`Cliente "${newClient.name}" criado com sucesso!`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar cliente");
    }
  };

  const handleSubmit = async () => {
    if (!clientName.trim())            { toast.error("Nome do cliente é obrigatório"); return; }
    if (!employeeId)                   { toast.error("Selecione um funcionário"); return; }
    if (selectedServices.length === 0) { toast.error("Adicione pelo menos um serviço"); return; }

    setLoading(true);
    try {
      // Se não selecionou um cliente existente, cria automaticamente
      let resolvedClientId = clientId;
      if (!resolvedClientId) {
        const newClient = await clientsStore.create({
          name: clientName.trim(),
          email: newClientEmail.trim() || null,
          phone: newClientPhone.trim() || null,
          birthDate: null,
          cpf: null,
          address: null,
          notes: null,
        });
        resolvedClientId = newClient.id;
      }
      if (isEditing && appointment) {
        // Edição: atualiza o agendamento existente normalmente
        const resolvedGroupId = appointment?.groupId ?? undefined;
        await appointmentsStore.update(appointment.id, buildPayload(resolvedGroupId));
        toast.success("Agendamento atualizado!");
        onSuccess();
        return;
      }

      // Criação: se há mais de 1 serviço, gera um bloco separado por serviço
      const [sh, sm] = startTime.split(":").map(Number);
      const base = parseISO(apptDate);
      const empId = parseInt(employeeId);
      const gid = selectedServices.length > 1
        ? (incomingGroupId ?? newGroupId())
        : (incomingGroupId ?? null);

      if (selectedServices.length <= 1) {
        // Caso normal: 1 serviço, 1 agendamento
        await appointmentsStore.create({ ...buildPayload(gid), clientId: resolvedClientId });
        toast.success("Agendamento criado!");
      } else {
        // Múltiplos serviços: cria N agendamentos encadeados em sequência
        let cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm);
        for (let idx = 0; idx < selectedServices.length; idx++) {
          const svc = selectedServices[idx];
          const svcStart = new Date(cursor);
          const svcEnd   = addMinutes(svcStart, svc.durationMinutes || 60);
          await appointmentsStore.create({
            clientName:    clientName.trim(),
            clientId:      resolvedClientId,
            employeeId:    empId,
            startTime:     svcStart.toISOString(),
            endTime:       svcEnd.toISOString(),
            status:        status as Appointment["status"],
            totalPrice:    svc.price,
            notes:         idx === 0 ? (notes.trim() || null) : null,
            paymentStatus: null,
            groupId:       gid,
            services:      [svc],
          });
          cursor = svcEnd;
        }
        toast.success(`${selectedServices.length} serviços agendados em blocos separados!`);
      }
      onSuccess();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar agendamento");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!appointment || !confirm("Excluir este agendamento?")) return;
    try {
      await appointmentsStore.delete(appointment.id);
      toast.success("Agendamento excluído");
      onSuccess();
    } catch {
      toast.error("Erro ao excluir");
    }
  };

  // Save current appointment and open a new modal for next service in the group
  const handleAddGroupService = async () => {
    if (!clientName.trim())            { toast.error("Preencha o nome do cliente"); return; }
    if (!employeeId)                   { toast.error("Selecione um funcionário"); return; }
    if (selectedServices.length === 0) { toast.error("Adicione pelo menos um serviço"); return; }

    const gid = incomingGroupId ?? appointment?.groupId ?? newGroupId();
    setLoading(true);
    try {
      if (isEditing && appointment) {
        await appointmentsStore.update(appointment.id, buildPayload(gid));
      } else {
        await appointmentsStore.create(buildPayload(gid));
      }
      onSuccess();
      onAddGroupService?.(clientName.trim(), gid);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const availableServices = servicesData.filter(
    s => !selectedServices.find(sel => sel.serviceId === s.id)
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? "Editar Agendamento" : "Novo Agendamento"}
            {(isEditing ? appointment?.groupId : incomingGroupId) && (
              <Badge variant="secondary" className="text-xs gap-1 font-normal">
                <Link2 className="w-3 h-3" /> Grupo
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Client Selection */}
          <div className="space-y-2">
            <Label>Cliente *</Label>
            {!showNewClientForm ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder="Buscar cliente por nome, email ou telefone..."
                    className="pl-10"
                  />
                </div>
                {clientSearch && filteredClients.length > 0 && (
                  <div className="border border-border rounded-lg bg-card/50 max-h-48 overflow-y-auto">
                    {filteredClients.map(client => (
                      <button
                        key={client.id}
                        onClick={() => handleSelectClient(client)}
                        className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-border/50 last:border-b-0 transition-colors"
                      >
                        <p className="font-medium text-sm">{client.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {client.email && `${client.email} • `}
                          {client.phone || "Sem telefone"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                {clientId && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{clientName}</p>
                        <p className="text-xs text-muted-foreground">ID: {clientId}</p>
                      </div>
                      <button
                        onClick={() => { setClientId(null); setClientName(""); setClientSearch(""); }}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Card de histórico do cliente */}
                    {(() => {
                      const clientAppts = appointmentsStore.list({})
                        .filter(a => a.clientId === clientId && a.status === "completed")
                        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
                      if (clientAppts.length === 0) return null;
                      const totalGasto = clientAppts.reduce((s, a) => s + (a.totalPrice || 0), 0);
                      const ultima = clientAppts[0];
                      // Count service frequency
                      const svcFreq = new Map<string, number>();
                      clientAppts.forEach(a => a.services?.forEach(s => svcFreq.set(s.name, (svcFreq.get(s.name) ?? 0) + 1)));
                      const topServices = [...svcFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
                      const lastEmp = employees.find(e => e.id === ultima.employeeId);
                      return (
                        <div className="p-2.5 rounded-lg bg-secondary/40 border border-border space-y-2">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <History className="w-3 h-3" /> Histórico do Cliente
                          </p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <p className="text-sm font-bold text-primary">{clientAppts.length}</p>
                              <p className="text-[9px] text-muted-foreground">visitas</p>
                            </div>
                            <div className="p-1.5 rounded-md bg-emerald-500/10">
                              <p className="text-sm font-bold text-emerald-400">R$ {totalGasto.toFixed(0)}</p>
                              <p className="text-[9px] text-muted-foreground">total</p>
                            </div>
                            <div className="p-1.5 rounded-md bg-blue-500/10">
                              <p className="text-sm font-bold text-blue-400">{format(new Date(ultima.startTime), "dd/MM")}</p>
                              <p className="text-[9px] text-muted-foreground">última</p>
                            </div>
                          </div>
                          {topServices.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-[9px] text-muted-foreground">Serviços frequentes:</p>
                              {topServices.map(([name, count]) => (
                                <div key={name} className="flex items-center justify-between text-xs">
                                  <span className="text-foreground truncate">{name}</span>
                                  <span className="text-muted-foreground text-[10px]">{count}x</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {lastEmp && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lastEmp.color }} />
                              Profissional habitual: <span className="font-medium text-foreground">{lastEmp.name.split(" ")[0]}</span>
                            </div>
                          )}
                          {/* Repeat last services button */}
                          {ultima.services?.length > 0 && selectedServices.length === 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                // Reconstitui todos os serviços da última visita (incluindo grupo)
                                const lastVisitSvcs = ultima.groupId
                                  ? clientAppts.filter(a => a.groupId === ultima.groupId)
                                      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                                      .flatMap(a => a.services ?? [])
                                  : (ultima.services ?? []);
                                setSelectedServices(lastVisitSvcs.map(s => ({
                                  serviceId: s.serviceId,
                                  name: s.name,
                                  price: s.price,
                                  durationMinutes: s.durationMinutes,
                                  color: s.color,
                                })));
                                if (ultima.employeeId && !employeeId) {
                                  setEmployeeId(String(ultima.employeeId));
                                }
                                toast.success("Serviços da última visita carregados!");
                              }}
                              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Repetir última visita ({
                                (ultima.groupId
                                  ? clientAppts.filter(a => a.groupId === ultima.groupId).flatMap(a => a.services ?? [])
                                  : (ultima.services ?? [])
                                ).map(s => s.name).join(", ")
                              })
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
                <button
                  onClick={() => setShowNewClientForm(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-dashed border-primary/50 text-sm text-primary hover:bg-primary/5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Criar novo cliente
                </button>
              </div>
            ) : (
              <div className="space-y-3 p-3 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    placeholder="Nome completo"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={newClientEmail}
                    onChange={e => setNewClientEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    type="email"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Telefone</Label>
                  <Input
                    value={newClientPhone}
                    onChange={e => setNewClientPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowNewClientForm(false);
                      setClientName("");
                      setNewClientEmail("");
                      setNewClientPhone("");
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCreateNewClient}
                    className="flex-1"
                  >
                    Criar Cliente
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Employee + Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Funcionário *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={String(emp.id)}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} />
                        {emp.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data *</Label>
              <Input type="date" value={apptDate} onChange={e => setApptDate(e.target.value)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Horário de início *</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
          </div>

          {/* Services */}
          <div className="space-y-2">
            <Label>Serviços *</Label>
            {selectedServices.length > 0 && (
              <div className="space-y-1.5">
                {selectedServices.map(svc => (
                  <div key={svc.serviceId}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 border border-border">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color }} />
                    <span className="flex-1 text-sm font-medium truncate">{svc.name}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />{svc.durationMinutes}min
                    </span>
                    <span className="text-xs font-semibold text-primary">R$ {svc.price.toFixed(2)}</span>
                    <button onClick={() => removeService(svc.serviceId)}
                      className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {availableServices.length > 0 && (
              <Select onValueChange={addService} value="">
                <SelectTrigger className="border-dashed">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-sm">Adicionar serviço</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {availableServices.map(svc => (
                    <SelectItem key={svc.id} value={String(svc.id)}>
                      <div className="flex items-center gap-2 w-full">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color }} />
                        <span className="flex-1">{svc.name}</span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {svc.durationMinutes}min — R$ {svc.price.toFixed(2)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Summary */}
          {selectedServices.length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{totalDuration} min</span>
                {endTime && <span className="text-xs">{startTime} → {endTime}</span>}
              </div>
              <div className="flex items-center gap-1 font-bold text-primary">
                <DollarSign className="w-4 h-4" />
                R$ {totalPrice.toFixed(2)}
              </div>
            </div>
          )}

          <Separator />

          {/* Status + Notes */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Preferências, observações..." rows={2} />
            </div>
          </div>

          {/* Group siblings */}
          {groupSiblings.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="w-3.5 h-3.5 text-primary" />
                Outros serviços deste cliente hoje
              </Label>
              <div className="space-y-1.5">
                {groupSiblings.map(sib => (
                  <div key={sib.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-secondary/40 border border-border text-xs">
                    <span className="flex-1 truncate font-medium">
                      {format(new Date(sib.startTime), "HH:mm")} —{" "}
                      {employees.find(e => e.id === sib.employeeId)?.name ?? `Func. #${sib.employeeId}`}
                    </span>
                    {sib.totalPrice != null && (
                      <span className="text-primary font-semibold">
                        R$ {sib.totalPrice.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add another service for same client */}
          {onAddGroupService && (
            <button
              type="button"
              onClick={handleAddGroupService}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-primary/50 text-sm text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4" />
              Adicionar outro serviço para este cliente
            </button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {isEditing && (
            <Button variant="ghost" className="text-destructive hover:text-destructive mr-auto"
              onClick={handleDelete} disabled={loading}>
              <Trash2 className="w-4 h-4 mr-1" />Excluir
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Salvando..." : isEditing ? "Salvar" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
