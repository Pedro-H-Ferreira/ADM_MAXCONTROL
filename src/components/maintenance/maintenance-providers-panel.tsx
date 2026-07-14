"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Provider = { id: string; name: string; tax_id: string | null; contact_name: string | null; email: string | null; phone: string | null; specialties: string[]; sla_minutes: number | null; active: boolean };
type Payload = { success: true; items: Provider[]; total: number; capabilities: Record<string, boolean> };
type Form = { name: string; taxId: string; contactName: string; email: string; phone: string; specialties: string; slaMinutes: string; active: boolean };
const emptyForm: Form = { name: "", taxId: "", contactName: "", email: "", phone: "", specialties: "", slaMinutes: "", active: true };
function formFromProvider(provider?: Provider | null): Form { return provider ? { name: provider.name, taxId: provider.tax_id || "", contactName: provider.contact_name || "", email: provider.email || "", phone: provider.phone || "", specialties: (provider.specialties || []).join(", "), slaMinutes: provider.sla_minutes == null ? "" : String(provider.sla_minutes), active: provider.active } : { ...emptyForm }; }

export function MaintenanceProvidersPanel() {
  const [items, setItems] = useState<Provider[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const pageCount = Math.max(1, Math.ceil(total / 20));
  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", active });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const data = await maintenanceRequest<Payload>(`/api/manutencao/providers?${params}`, { cache: "no-store", signal }, "Falha ao carregar prestadores.");
      setItems(data.items || []); setTotal(data.total || 0); setCapabilities(data.capabilities || {});
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar prestadores.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [active, debouncedSearch, page]);
  useEffect(() => { const controller = new AbortController(); const frame = requestAnimationFrame(() => void load(controller.signal)); return () => { cancelAnimationFrame(frame); controller.abort(); }; }, [load]);

  function edit(provider?: Provider) { setEditing(provider || null); setForm(formFromProvider(provider)); setOpen(true); }
  async function save() {
    if (!form.name.trim()) { toast.error("Informe o nome do prestador."); return; }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), taxId: form.taxId.trim() || null, contactName: form.contactName.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, specialties: form.specialties.split(",").map((value) => value.trim()).filter(Boolean), slaMinutes: form.slaMinutes ? Math.max(0, Math.round(Number(form.slaMinutes))) : null, active: form.active };
      await maintenanceRequest(editing ? `/api/manutencao/providers/${editing.id}` : "/api/manutencao/providers", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Falha ao salvar prestador.");
      toast.success(editing ? "Prestador atualizado." : "Prestador cadastrado."); setOpen(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao salvar prestador."); } finally { setSaving(false); }
  }

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-semibold">Fornecedores e prestadores</h2><p className="text-sm text-muted-foreground">Empresas e profissionais habilitados para executar manutencoes.</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="icon" title="Atualizar prestadores" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>{capabilities.MANAGE_ASSETS !== false ? <Button type="button" onClick={() => edit()}><Plus className="size-4" />Novo prestador</Button> : null}</div></div>
    <div className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[minmax(0,1fr)_220px]"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, CNPJ, contato ou e-mail" /></div><Select value={active} onValueChange={(value) => { setActive(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Ativos</SelectItem><SelectItem value="false">Inativos</SelectItem><SelectItem value="ALL">Todos</SelectItem></SelectContent></Select></div>
    <div className="overflow-x-auto rounded-md border bg-background">{loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : items.length ? <Table><TableHeader><TableRow><TableHead>Prestador</TableHead><TableHead>Contato</TableHead><TableHead>Especialidades</TableHead><TableHead>SLA</TableHead><TableHead>Status</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{items.map((provider) => <TableRow key={provider.id}><TableCell><p className="font-medium">{provider.name}</p><p className="text-xs text-muted-foreground">{provider.tax_id || "Sem documento"}</p></TableCell><TableCell><p>{provider.contact_name || "-"}</p><p className="text-xs text-muted-foreground">{provider.email || provider.phone || "Sem contato"}</p></TableCell><TableCell><div className="flex max-w-80 flex-wrap gap-1">{provider.specialties?.length ? provider.specialties.slice(0, 4).map((item) => <Badge key={item} variant="outline">{item}</Badge>) : "-"}</div></TableCell><TableCell>{provider.sla_minutes == null ? "-" : `${provider.sla_minutes} min`}</TableCell><TableCell><Badge variant={provider.active ? "secondary" : "outline"}>{provider.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell>{capabilities.MANAGE_ASSETS !== false ? <Button type="button" variant="ghost" size="icon" title="Editar prestador" onClick={() => edit(provider)}><Pencil className="size-4" /></Button> : null}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-10 text-center text-sm text-muted-foreground">Nenhum prestador encontrado.</p>}</div>
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{total ? `${(page - 1) * 20 + 1}-${Math.min(page * 20, total)} de ${total}` : "0 prestadores"}</p><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-20 text-center text-sm">{page} de {pageCount}</span><Button type="button" variant="outline" size="icon" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-4" /></Button></div></div>
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? "Editar prestador" : "Novo prestador"}</DialogTitle><DialogDescription>Dados operacionais usados em OS e planos preventivos.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome" required><Input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} /></Field><Field label="CNPJ / CPF"><Input value={form.taxId} onChange={(event) => setForm((value) => ({ ...value, taxId: event.target.value }))} /></Field><Field label="Contato"><Input value={form.contactName} onChange={(event) => setForm((value) => ({ ...value, contactName: event.target.value }))} /></Field><Field label="Telefone"><Input value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))} /></Field><Field label="E-mail"><Input type="email" value={form.email} onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))} /></Field><Field label="SLA (minutos)"><Input inputMode="numeric" value={form.slaMinutes} onChange={(event) => setForm((value) => ({ ...value, slaMinutes: event.target.value }))} /></Field><Field label="Especialidades, separadas por virgula" className="sm:col-span-2"><Input value={form.specialties} onChange={(event) => setForm((value) => ({ ...value, specialties: event.target.value }))} placeholder="Eletrica, refrigeracao, empilhadeiras" /></Field><label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={form.active} onCheckedChange={(checked) => setForm((value) => ({ ...value, active: checked === true }))} />Prestador ativo</label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Salvar</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>; }
