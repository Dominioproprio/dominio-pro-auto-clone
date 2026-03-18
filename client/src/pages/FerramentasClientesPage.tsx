/**
 * FerramentasClientesPage — Importar cadastro de clientes, detectar e mesclar duplicados.
 * Design: Glass Dashboard — tema escuro, accent rosa, backdrop-blur.
 */
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload, Users, Merge, CheckCircle, AlertTriangle, FileSpreadsheet,
  Trash2, RefreshCw, ChevronDown, ChevronUp, Eye, ArrowRight, Smartphone, Phone,
} from "lucide-react";
import { clientsStore, appointmentsStore, type Client } from "@/lib/store";
import * as XLSX from "xlsx";

// ─── Helpers ────────────────────────────────────────────────

/** Normaliza nome para comparação: lowercase, sem acentos, sem espaços extras */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Agrupa clientes por nome normalizado */
function findDuplicateGroups(clients: Client[]): Map<string, Client[]> {
  const groups = new Map<string, Client[]>();
  clients.forEach(client => {
    const key = normalizeName(client.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(client);
  });
  // Retorna apenas grupos com mais de 1 cliente
  const duplicates = new Map<string, Client[]>();
  groups.forEach((group, key) => {
    if (group.length > 1) duplicates.set(key, group);
  });
  return duplicates;
}

/** Mescla um grupo de clientes duplicados, mantendo o mais antigo e combinando dados */
function mergeClientGroup(group: Client[]): { keep: Client; removeIds: number[] } {
  // Ordena por data de criação (mais antigo primeiro)
  const sorted = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  
  // Criamos uma cópia profunda do objeto 'keep' para não alterar o cache diretamente antes do update
  const keep = { ...sorted[0] };
  const removeIds: number[] = [];

  // Mescla dados: preenche campos vazios do "keep" com dados dos outros
  sorted.slice(1).forEach(other => {
    if (!keep.email && other.email) keep.email = other.email;
    if (!keep.phone && other.phone) keep.phone = other.phone;
    if (!keep.birthDate && other.birthDate) keep.birthDate = other.birthDate;
    if (!keep.cpf && other.cpf) keep.cpf = other.cpf;
    if (!keep.address && other.address) keep.address = other.address;
    
    if (!keep.notes && other.notes) {
      keep.notes = other.notes;
    } else if (keep.notes && other.notes && !keep.notes.includes(other.notes)) {
      keep.notes = `${keep.notes} | ${other.notes}`;
    }
    removeIds.push(other.id);
  });

  return { keep, removeIds };
}

/** Parse CSV text para array de objetos */
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;\t]/).map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1).map(line => {
    // Suporta campos com aspas
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if ((char === "," || char === ";" || char === "\t") && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    values.push(current.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ""; });
    return obj;
  });
}

/** Mapeia colunas do CSV/XLSX para campos do Client */
function mapToClient(row: Record<string, string>): Omit<Client, "id" | "createdAt"> | null {
  const name = row["nome"] || row["name"] || row["cliente"] || row["client"] || row["nome completo"] || row["full name"] || "";
  if (!name.trim()) return null;
  const email     = row["email"]     || row["e-mail"]          || row["e_mail"]        || null;
  const phone     = row["telefone"]  || row["phone"]           || row["celular"]        || row["tel"] || row["whatsapp"] || null;
  const birthDate = row["nascimento"]|| row["data_nascimento"] || row["birth_date"]     || row["birthdate"] || row["data nascimento"] || null;
  const cpf       = row["cpf"]       || row["cpf/cnpj"]        || row["documento"]      || null;
  const address   = row["endereço"]  || row["endereco"]        || row["address"]        || row["logradouro"] || row["rua"] || null;
  const notes     = row["observacao"]|| row["observações"]     || row["obs"]            || row["notes"] || row["notas"] || null;
  return {
    name:      name.trim(),
    email:     email?.trim()     || null,
    phone:     phone?.trim()     || null,
    birthDate: birthDate?.trim() || null,
    cpf:       cpf?.trim()       || null,
    address:   address?.trim()   || null,
    notes:     notes?.trim()     || null,
  };
}


// ─── VCF / vCard Parser ─────────────────────────────────────

function parseVCF(text: string): Omit<Client, "id" | "createdAt">[] {
  const clients: Omit<Client, "id" | "createdAt">[] = [];

  // Divide em blocos BEGIN:VCARD ... END:VCARD
  const cards = text.split(/BEGIN:VCARD/i).slice(1);

  cards.forEach(card => {
    const lines: string[] = [];

    // Une linhas dobradas (RFC 2425: linha que começa com espaço/tab é continuação)
    card.split(/\r?\n/).forEach(line => {
      if (/^[ 	]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.trimStart();
      } else {
        lines.push(line);
      }
    });

    let name    = "";
    let phone   = "";
    let email   = "";
    let address = "";

    lines.forEach(line => {
      const [rawKey, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (!value) return;
      const key = rawKey.toUpperCase();

      // Nome: FN (nome formatado) tem prioridade sobre N
      if (key === "FN" || key.startsWith("FN;")) {
        name = value;
      } else if ((key === "N" || key.startsWith("N;")) && !name) {
        // N: Sobrenome;Nome;Adicional;Prefixo;Sufixo
        const parts = value.split(";").map(p => p.trim()).filter(Boolean);
        name = parts.length >= 2
          ? `${parts[1]} ${parts[0]}`.trim()
          : parts[0] ?? "";
      }

      // Telefone — pega o primeiro encontrado
      if ((key.startsWith("TEL") || key === "TEL") && !phone) {
        phone = value.replace(/[^\d+\-() ]/g, "").trim();
      }

      // Email — pega o primeiro encontrado
      if ((key.startsWith("EMAIL") || key === "EMAIL") && !email) {
        email = value;
      }

      // Endereço — ADR: PO Box;Complemento;Rua;Cidade;Estado;CEP;País
      if ((key.startsWith("ADR") || key === "ADR") && !address) {
        const parts = value.split(";").map(p => p.trim()).filter(Boolean);
        address = parts.join(", ");
      }
    });

    if (!name.trim()) return;

    clients.push({
      name:      name.trim(),
      phone:     phone  || null,
      email:     email  || null,
      address:   address || null,
      birthDate: null,
      cpf:       null,
      notes:     null,
    });
  });

  return clients;
}

// ─── Componente Principal ───────────────────────────────────

export default function FerramentasClientesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [importPreview, setImportPreview] = useState<Omit<Client, "id" | "createdAt">[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mergeAllOpen, setMergeAllOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [mergeDetailGroup, setMergeDetailGroup] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vcfInputRef  = useRef<HTMLInputElement>(null);

  const clients = useMemo(() => clientsStore.list(), [refreshKey]);
  const duplicateGroups = useMemo(() => findDuplicateGroups(clients), [clients]);
  const duplicateGroupsArray = useMemo(() => Array.from(duplicateGroups.entries()), [duplicateGroups]);

  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    const onUpdate = () => setRefreshKey(k => k + 1);
    window.addEventListener("clients_updated", onUpdate);
    window.addEventListener("store_updated", onUpdate);
    return () => {
      window.removeEventListener("clients_updated", onUpdate);
      window.removeEventListener("store_updated", onUpdate);
    };
  }, []);



  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");

    const processRows = (rows: Record<string, string>[]) => {
      const parsed = rows.map(row => mapToClient(row)).filter(Boolean) as Omit<Client, "id" | "createdAt">[];
      if (parsed.length === 0) {
        toast.error("Nenhum cliente encontrado. Verifique se há uma coluna 'nome'.");
        return;
      }
      setImportPreview(parsed);
      setImportModalOpen(true);
    };

    if (isXlsx) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          const normalized = rows.map(row =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [
                k.toLowerCase().trim(),
                String(v ?? "").trim(),
              ])
            )
          );
          processRows(normalized);
        } catch {
          toast.error("Erro ao ler o arquivo XLSX. Verifique se não está corrompido.");
        } finally {
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          if (file.name.endsWith(".json")) {
            const json = JSON.parse(text);
            const arr = Array.isArray(json) ? json : json.clients || json.clientes || [];
            const parsed = arr.map((item: any) => mapToClient(item)).filter(Boolean) as Omit<Client, "id" | "createdAt">[];
            if (parsed.length === 0) {
              toast.error("Nenhum cliente encontrado no arquivo. Verifique se há uma coluna 'nome'.");
              return;
            }
            setImportPreview(parsed);
            setImportModalOpen(true);
          } else {
            processRows(parseCSV(text));
          }
        } catch {
          toast.error("Erro ao ler o arquivo. Verifique o formato.");
        } finally {
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.readAsText(file);
    }
  }, []);


  const handleVCFSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseVCF(text);
        if (parsed.length === 0) {
          toast.error("Nenhum contato encontrado no arquivo VCF.");
          return;
        }
        setImportPreview(parsed);
        setImportModalOpen(true);
      } catch {
        toast.error("Erro ao ler o arquivo VCF. Verifique se é um vCard válido.");
      }
    };
    reader.readAsText(file, "UTF-8");
    if (vcfInputRef.current) vcfInputRef.current.value = "";
  }, []);

  const handleImportConfirm = async () => {
    setImporting(true);
    try {
      await clientsStore.createMany(importPreview);
      await clientsStore.fetchAll();
      toast.success(`${importPreview.length} cliente(s) importado(s) com sucesso!`);
      setImportModalOpen(false);
      setImportPreview([]);
      // Resetar ambos os inputs para permitir reimportar o mesmo arquivo
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (vcfInputRef.current) vcfInputRef.current.value = "";
      refresh();
    } catch (err: any) {
      const msg = err?.message || err?.error_description || JSON.stringify(err) || "Erro desconhecido";
      toast.error(`Erro ao importar: ${msg}`);
      console.error("Import error:", err);
    } finally {
      setImporting(false);
    }
  };

  // ─── Mesclagem individual ───────────────────────────────

  const handleMergeGroup = async (key: string) => {
    const group = duplicateGroups.get(key);
    if (!group) return;
    const { keep, removeIds } = mergeClientGroup(group);

    try {
      // Atualiza o cliente mantido
      await clientsStore.update(keep.id, {
        email: keep.email,
        phone: keep.phone,
        birthDate: keep.birthDate,
        cpf: keep.cpf,
        address: keep.address,
        notes: keep.notes,
      });

      // Reatribui agendamentos dos removidos para o mantido
      const allAppts = appointmentsStore.list({});
      for (const removeId of removeIds) {
        const appts = allAppts.filter(a => a.clientId === removeId);
        for (const a of appts) {
          await appointmentsStore.update(a.id, { clientId: keep.id, clientName: keep.name });
        }
        await clientsStore.delete(removeId);
      }

      toast.success(`"${keep.name}" mesclado — ${removeIds.length} duplicata(s) removida(s)`);
      setMergeDetailGroup(null);
      refresh();
    } catch {
      toast.error("Erro ao mesclar clientes");
    }
  };

  // ─── Mesclar todos ─────────────────────────────────────

  const handleMergeAll = async () => {
    setMerging(true);
    try {
      let totalRemoved = 0;
      const groupsToMerge = selectedGroups.size > 0
        ? duplicateGroupsArray.filter(([key]) => selectedGroups.has(key))
        : duplicateGroupsArray;

      for (const [, group] of groupsToMerge) {
        const { keep, removeIds } = mergeClientGroup(group);
        await clientsStore.update(keep.id, {
          email: keep.email,
          phone: keep.phone,
          birthDate: keep.birthDate,
          cpf: keep.cpf,
          address: keep.address,
          notes: keep.notes,
        });
        const allAppts = appointmentsStore.list({});
        for (const removeId of removeIds) {
          const appts = allAppts.filter(a => a.clientId === removeId);
          for (const a of appts) {
            await appointmentsStore.update(a.id, { clientId: keep.id, clientName: keep.name });
          }
          await clientsStore.delete(removeId);
        }
        totalRemoved += removeIds.length;
      }

      toast.success(`Mesclagem concluída! ${totalRemoved} duplicata(s) removida(s) de ${groupsToMerge.length} grupo(s).`);
      setMergeAllOpen(false);
      setSelectedGroups(new Set());
      refresh();
    } catch {
      toast.error("Erro ao mesclar clientes");
    } finally {
      setMerging(false);
    }
  };

  // ─── Toggle helpers ─────────────────────────────────────

  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelectGroup = (key: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedGroups.size === duplicateGroupsArray.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(duplicateGroupsArray.map(([key]) => key)));
    }
  };

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Ferramentas de Clientes</h2>
        <p className="text-sm text-muted-foreground">Importar cadastros e gerenciar clientes duplicados</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total de Clientes</p>
                <p className="text-xl font-bold">{clients.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Grupos Duplicados</p>
                <p className="text-xl font-bold text-amber-400">{duplicateGroupsArray.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Duplicatas a Remover</p>
                <p className="text-xl font-bold text-red-400">
                  {duplicateGroupsArray.reduce((sum, [, group]) => sum + group.length - 1, 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clientes Únicos</p>
                <p className="text-xl font-bold text-emerald-400">
                  {clients.length - duplicateGroupsArray.reduce((sum, [, group]) => sum + group.length - 1, 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ações principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Importar */}
        <Card className="border-border bg-card/50 hover:border-primary/30 transition-colors">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Importar Cadastro</h3>
                <p className="text-xs text-muted-foreground">CSV, TSV, JSON ou Excel (XLSX) com dados de clientes</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border">
              <p className="text-xs text-muted-foreground mb-2">Colunas aceitas no arquivo:</p>
              <div className="flex flex-wrap gap-1.5">
                {["nome", "email", "telefone", "nascimento", "cpf", "endereço", "observação"].map(col => (
                  <Badge key={col} variant="secondary" className="text-[10px]">{col}</Badge>
                ))}
              </div>
            </div>
            <Button onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
              <FileSpreadsheet className="w-4 h-4" />Selecionar Arquivo
            </Button>
          </CardContent>
        </Card>

        {/* Importar VCF / Contatos do celular */}
        <Card className="border-border bg-card/50 hover:border-primary/30 transition-colors">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Importar Contatos do Celular</h3>
                <p className="text-xs text-muted-foreground">Arquivo VCF exportado da agenda do iPhone ou Android</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-2">
              <p className="text-xs font-medium">Como exportar seus contatos:</p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-start gap-1.5">
                  <span className="text-primary font-bold flex-shrink-0">iPhone:</span>
                  Contatos → Selecionar tudo → Compartilhar → salvar como .vcf
                </p>
                <p className="flex items-start gap-1.5">
                  <span className="text-amber-400 font-bold flex-shrink-0">Android:</span>
                  Contatos → Menu → Exportar → Exportar para arquivo .vcf
                </p>
                <p className="flex items-start gap-1.5">
                  <span className="text-blue-400 font-bold flex-shrink-0">Google:</span>
                  contacts.google.com → Exportar → vCard (.vcf)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Importa nome, telefone, email e endereço de cada contato</span>
            </div>
            <Button onClick={() => vcfInputRef.current?.click()} className="w-full gap-2" variant="outline">
              <Smartphone className="w-4 h-4" />Selecionar arquivo .vcf
            </Button>
          </CardContent>
        </Card>

        {/* Mesclar todos */}
        <Card className={`border-border bg-card/50 transition-colors ${duplicateGroupsArray.length > 0 ? "hover:border-amber-500/30" : "opacity-60"}`}>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Merge className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold">Mesclar Todos</h3>
                <p className="text-xs text-muted-foreground">
                  {duplicateGroupsArray.length > 0
                    ? `${duplicateGroupsArray.length} grupo(s) com nomes repetidos encontrados`
                    : "Nenhum cliente duplicado encontrado"}
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border">
              <p className="text-xs text-muted-foreground">
                Mantém o cadastro mais antigo de cada grupo e combina as informações complementares (email, telefone, notas). Agendamentos são reatribuídos automaticamente.
              </p>
            </div>
            <Button
              onClick={() => setMergeAllOpen(true)}
              disabled={duplicateGroupsArray.length === 0}
              variant="outline"
              className="w-full gap-2 bg-transparent border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-40"
            >
              <Merge className="w-4 h-4" />
              {selectedGroups.size > 0
                ? `Mesclar ${selectedGroups.size} Selecionado(s)`
                : "Mesclar Todos os Duplicados"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Lista de duplicados */}
      {duplicateGroupsArray.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Clientes com Nomes Repetidos
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={toggleSelectAll}>
                  {selectedGroups.size === duplicateGroupsArray.length ? "Desmarcar todos" : "Selecionar todos"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {duplicateGroupsArray.map(([key, group]) => {
                const isExpanded = expandedGroups.has(key);
                const isSelected = selectedGroups.has(key);
                return (
                  <div key={key} className="border border-border rounded-lg overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-3 p-3 bg-secondary/20 hover:bg-secondary/30 transition-colors">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelectGroup(key)}
                      />
                      <button
                        className="flex-1 flex items-center gap-3 text-left"
                        onClick={() => toggleExpand(key)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{group[0].name}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.length} cadastros encontrados
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px] bg-amber-500/20 text-amber-400">
                          {group.length}x
                        </Badge>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 gap-1 bg-transparent border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => setMergeDetailGroup(key)}
                      >
                        <Merge className="w-3 h-3" />Mesclar
                      </Button>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="p-3 space-y-2 border-t border-border bg-background/30">
                        {group.map((client, i) => (
                          <div key={client.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/20 border border-border">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${
                              i === 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
                            }`}>
                              {i === 0 ? "★" : i + 1}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{client.name}</p>
                                {i === 0 && (
                                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/20 text-emerald-400">
                                    Mais antigo
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                                {client.email && <span>📧 {client.email}</span>}
                                {client.phone && <span>📱 {client.phone}</span>}
                                {client.birthDate && <span>🎂 {client.birthDate}</span>}
                                {client.notes && <span>📝 {client.notes}</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground/60">
                                ID #{client.id} — Criado em {new Date(client.createdAt).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-400">
                          <strong>Resultado da mesclagem:</strong> O cadastro mais antigo (★) será mantido. Dados faltantes serão preenchidos com informações dos outros cadastros. Duplicatas serão removidas.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {duplicateGroupsArray.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-30 text-emerald-400" />
          <p className="text-lg font-medium">Nenhum cliente duplicado</p>
          <p className="text-sm mt-1">Todos os cadastros possuem nomes únicos</p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.json,.txt,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
      <input
        ref={vcfInputRef}
        type="file"
        accept=".vcf,.vcard"
        style={{ display: "none" }}
        onChange={handleVCFSelect}
      />

      {/* ─── Modal: Preview de importação ─────────────────── */}
      <Dialog open={importModalOpen} onOpenChange={v => !v && setImportModalOpen(false)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              Importar {importPreview.length} Cliente(s)
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {importPreview.slice(0, 50).map((client, i) => (
              <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/20 border border-border">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{client.name}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5">
                    {client.email     && <span>{client.email}</span>}
                    {client.phone     && <span>{client.phone}</span>}
                    {client.cpf       && <span>CPF: {client.cpf}</span>}
                    {client.address   && <span>📍 {client.address}</span>}
                    {client.birthDate && <span>{client.birthDate}</span>}
                  </div>
                </div>
              </div>
            ))}
            {importPreview.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                ... e mais {importPreview.length - 50} clientes
              </p>
            )}
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
            <strong>Atenção:</strong> Os clientes serão adicionados ao cadastro existente. Nomes duplicados poderão ser mesclados depois usando a ferramenta de mesclagem.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportModalOpen(false)} disabled={importing}>
              Cancelar
            </Button>
            <Button onClick={handleImportConfirm} disabled={importing} className="gap-2">
              {importing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" />Importando...</>
              ) : (
                <><Upload className="w-4 h-4" />Importar {importPreview.length} Cliente(s)</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Confirmar mesclagem individual ────────── */}
      <Dialog open={mergeDetailGroup !== null} onOpenChange={v => !v && setMergeDetailGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-primary" />Confirmar Mesclagem
            </DialogTitle>
          </DialogHeader>
          {mergeDetailGroup && duplicateGroups.has(mergeDetailGroup) && (() => {
            const group = duplicateGroups.get(mergeDetailGroup)!;
            const { keep, removeIds } = mergeClientGroup([...group]);
            return (
              <div className="space-y-4 py-2">
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Cadastro que será mantido:</p>
                  <p className="text-sm font-semibold text-emerald-400">{keep.name}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-1">
                    {keep.email && <span>📧 {keep.email}</span>}
                    {keep.phone && <span>📱 {keep.phone}</span>}
                    {keep.birthDate && <span>🎂 {keep.birthDate}</span>}
                    {keep.notes && <span>📝 {keep.notes}</span>}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Cadastros que serão removidos:</p>
                  {removeIds.map(id => {
                    const c = group.find(g => g.id === id);
                    return c ? (
                      <div key={id} className="flex items-center gap-2 mt-1">
                        <Trash2 className="w-3 h-3 text-red-400" />
                        <span className="text-sm text-red-400">#{c.id} — {c.name}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDetailGroup(null)}>Cancelar</Button>
            <Button onClick={() => mergeDetailGroup && handleMergeGroup(mergeDetailGroup)} className="gap-2">
              <Merge className="w-4 h-4" />Confirmar Mesclagem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Confirmar mesclar todos ───────────────── */}
      <Dialog open={mergeAllOpen} onOpenChange={v => !v && setMergeAllOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-amber-400" />
              {selectedGroups.size > 0 ? `Mesclar ${selectedGroups.size} Grupo(s)` : "Mesclar Todos os Duplicados"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {selectedGroups.size > 0
                ? `Serão mesclados ${selectedGroups.size} grupo(s) de clientes com nomes repetidos.`
                : `Serão mesclados ${duplicateGroupsArray.length} grupo(s) de clientes com nomes repetidos.`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-secondary/30 text-center">
                <p className="text-xs text-muted-foreground">Grupos</p>
                <p className="text-lg font-bold">{selectedGroups.size > 0 ? selectedGroups.size : duplicateGroupsArray.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-red-500/10 text-center">
                <p className="text-xs text-muted-foreground">Duplicatas a remover</p>
                <p className="text-lg font-bold text-red-400">
                  {(selectedGroups.size > 0
                    ? duplicateGroupsArray.filter(([key]) => selectedGroups.has(key))
                    : duplicateGroupsArray
                  ).reduce((sum, [, group]) => sum + group.length - 1, 0)}
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              <strong>Como funciona:</strong> Para cada grupo, o cadastro mais antigo é mantido. Dados complementares (email, telefone, notas) são combinados. Agendamentos são reatribuídos automaticamente.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeAllOpen(false)} disabled={merging}>Cancelar</Button>
            <Button onClick={handleMergeAll} disabled={merging} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
              {merging ? (
                <><RefreshCw className="w-4 h-4 animate-spin" />Mesclando...</>
              ) : (
                <><Merge className="w-4 h-4" />Confirmar Mesclagem</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
