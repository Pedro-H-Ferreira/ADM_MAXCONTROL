"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { maintenanceDate, maintenanceLabel, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Branch = { id: string; code: string; name: string; active: boolean };
type Warehouse = { id: string; branch_id: string; code: string; name: string; active: boolean; branch?: Branch | null };
type Inventory = {
  id: string;
  code: string;
  inventory_type: "MATERIAL" | "ASSET";
  branch_id: string;
  warehouse_id: string | null;
  area: string | null;
  status: string;
  reference_frozen_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  branch?: Branch | null;
  warehouse?: Warehouse | null;
};
type InventoryItem = {
  id: string;
  reference_quantity: number | null;
  first_count_quantity: number | null;
  second_count_quantity: number | null;
  asset_found: boolean | null;
  found_location: string | null;
  condition: string | null;
  variance_quantity: number | null;
  justification: string | null;
  resolution: string | null;
  material?: { id: string; code: string; name: string; unit: string } | null;
  asset?: { id: string; internal_code: string; asset_tag: string | null; name: string; physical_location: string | null; status: string } | null;
};
type InventoryDetail = Inventory & {
  items: InventoryItem[];
  itemTotal: number;
  itemPage: number;
  itemPageSize: number;
};
type InventoryPayload = {
  success: true;
  items: Inventory[];
  total: number;
  page: number;
  pageSize: number;
  branches: Branch[];
  warehouses: Warehouse[];
  capabilities: Record<string, boolean>;
};
type CountDraft = {
  round: "1" | "2";
  quantity: string;
  found: "" | "FOUND" | "NOT_FOUND";
  foundLocation: string;
  condition: string;
  justification: string;
};

const statuses = ["COUNTING", "RECOUNT", "SUBMITTED", "APPROVED", "CANCELLED"];
const emptyCreate = { branchId: "", inventoryType: "MATERIAL" as "MATERIAL" | "ASSET", warehouseId: "", area: "", notes: "" };

function draftFor(item: InventoryItem): CountDraft {
  const useSecond = item.first_count_quantity != null;
  return {
    round: useSecond ? "2" : "1",
    quantity: String(useSecond ? item.second_count_quantity ?? "" : item.first_count_quantity ?? ""),
    found: item.asset_found == null ? "" : item.asset_found ? "FOUND" : "NOT_FOUND",
    foundLocation: item.found_location || item.asset?.physical_location || "",
    condition: item.condition || "",
    justification: item.justification || "",
  };
}

export function MaintenanceInventoriesPanel() {
  const [items, setItems] = useState<Inventory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [branchId, setBranchId] = useState("ALL");
  const [inventoryType, setInventoryType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [itemSavingId, setItemSavingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CountDraft>>({});
  const [confirmation, setConfirmation] = useState<"SUBMIT" | "APPROVE" | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / 20));

  const loadInventories = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (branchId !== "ALL") params.set("branchId", branchId);
      if (inventoryType !== "ALL") params.set("inventoryType", inventoryType);
      if (status !== "ALL") params.set("status", status);
      const data = await maintenanceRequest<InventoryPayload>(`/api/manutencao/inventories?${params}`, { cache: "no-store", signal }, "Falha ao carregar inventarios.");
      setItems(data.items || []);
      setTotal(data.total || 0);
      setBranches((data.branches || []).filter((branch) => branch.active));
      setWarehouses((data.warehouses || []).filter((warehouse) => warehouse.active));
      setCapabilities(data.capabilities || {});
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar inventarios.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [branchId, inventoryType, page, status]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void loadInventories(controller.signal));
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [loadInventories]);

  const loadDetail = useCallback(async (id: string, itemPage = 1) => {
    setDetailLoading(true);
    try {
      const data = await maintenanceRequest<{ success: true; inventory: InventoryDetail }>(`/api/manutencao/inventories/${id}?page=${itemPage}&pageSize=20`, { cache: "no-store" }, "Falha ao consultar inventario.");
      setDetail(data.inventory);
      setDrafts(Object.fromEntries((data.inventory.items || []).map((item) => [item.id, draftFor(item)])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao consultar inventario.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openCreate() {
    setCreateForm({ ...emptyCreate, branchId: branches[0]?.id || "" });
    setCreateOpen(true);
  }

  async function createInventory() {
    if (!createForm.branchId) { toast.error("Selecione a filial."); return; }
    if (createForm.inventoryType === "MATERIAL" && !createForm.warehouseId) { toast.error("Selecione o almoxarifado."); return; }
    setSaving(true);
    try {
      const data = await maintenanceRequest<{ success: true; inventory: Inventory }>("/api/manutencao/inventories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: createForm.branchId,
          inventoryType: createForm.inventoryType,
          warehouseId: createForm.inventoryType === "MATERIAL" ? createForm.warehouseId : null,
          area: createForm.inventoryType === "ASSET" ? createForm.area.trim() || null : null,
          notes: createForm.notes.trim() || null,
        }),
      }, "Falha ao iniciar inventario.");
      toast.success("Inventario iniciado com o saldo de referencia congelado.");
      setCreateOpen(false);
      await loadInventories();
      await loadDetail(data.inventory.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar inventario.");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item: InventoryItem) {
    if (!detail) return;
    const draft = drafts[item.id] || draftFor(item);
    let payload: Record<string, unknown>;
    if (detail.inventory_type === "MATERIAL") {
      const quantity = Number(draft.quantity.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity < 0) { toast.error("Informe uma quantidade valida."); return; }
      if (quantity !== Number(item.reference_quantity || 0) && !draft.justification.trim()) { toast.error("Justifique a divergencia de saldo."); return; }
      payload = { action: "COUNT_ITEM", itemId: item.id, round: Number(draft.round), quantity, justification: draft.justification.trim() || null };
    } else {
      if (!draft.found) { toast.error("Informe se o ativo foi encontrado."); return; }
      const expected = item.asset?.physical_location || "";
      const changedLocation = draft.found === "FOUND" && draft.foundLocation.trim() && draft.foundLocation.trim() !== expected;
      if ((draft.found === "NOT_FOUND" || changedLocation) && !draft.justification.trim()) { toast.error("Justifique a divergencia do ativo."); return; }
      payload = { action: "COUNT_ITEM", itemId: item.id, found: draft.found === "FOUND", foundLocation: draft.foundLocation.trim() || null, condition: draft.condition.trim() || null, photoPath: null, justification: draft.justification.trim() || null };
    }
    setItemSavingId(item.id);
    try {
      await maintenanceRequest(`/api/manutencao/inventories/${detail.id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, "Falha ao salvar conferencia.");
      toast.success("Conferencia salva.");
      await loadDetail(detail.id, detail.itemPage);
      await loadInventories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar conferencia.");
    } finally {
      setItemSavingId(null);
    }
  }

  async function runWorkflowAction() {
    if (!detail || !confirmation) return;
    const action = confirmation;
    setSaving(true);
    try {
      await maintenanceRequest(`/api/manutencao/inventories/${detail.id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }, "Falha ao atualizar inventario.");
      toast.success(action === "SUBMIT" ? "Inventario enviado para aprovacao." : "Inventario aprovado e ajustes aplicados.");
      setConfirmation(null);
      await Promise.all([loadDetail(detail.id, detail.itemPage), loadInventories()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar inventario.");
    } finally {
      setSaving(false);
    }
  }

  const filteredWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.branch_id === createForm.branchId), [createForm.branchId, warehouses]);
  const detailPageCount = detail ? Math.max(1, Math.ceil(detail.itemTotal / detail.itemPageSize)) : 1;
  const editable = detail?.status === "COUNTING" || detail?.status === "RECOUNT";

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 className="text-base font-semibold">Inventarios</h2><p className="text-sm text-muted-foreground">Contagem auditada de materiais e equipamentos por filial.</p></div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="icon" title="Atualizar inventarios" onClick={() => void loadInventories()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /><span className="sr-only">Atualizar inventarios</span></Button>
          {capabilities.EXECUTE_INVENTORY !== false ? <Button type="button" onClick={openCreate}><Plus className="size-4" />Nova contagem</Button> : null}
        </div>
      </div>

      <div className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-3">
        <Select value={branchId} onValueChange={(value) => { setBranchId(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select>
        <Select value={inventoryType} onValueChange={(value) => { setInventoryType(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Materiais e ativos</SelectItem><SelectItem value="MATERIAL">Materiais</SelectItem><SelectItem value="ASSET">Equipamentos</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos os status</SelectItem>{statuses.map((item) => <SelectItem key={item} value={item}>{maintenanceLabel(item)}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="overflow-hidden rounded-md border bg-background">
        {loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : items.length ? (
          <Table><TableHeader><TableRow><TableHead>Contagem</TableHead><TableHead>Tipo</TableHead><TableHead>Filial / local</TableHead><TableHead>Status</TableHead><TableHead>Inicio</TableHead></TableRow></TableHeader><TableBody>{items.map((inventory) => <TableRow key={inventory.id} className="cursor-pointer" onClick={() => void loadDetail(inventory.id)}><TableCell><p className="font-mono font-medium">{inventory.code}</p><p className="max-w-64 truncate text-xs text-muted-foreground">{inventory.notes || "Sem observacoes"}</p></TableCell><TableCell>{inventory.inventory_type === "MATERIAL" ? "Materiais" : "Equipamentos"}</TableCell><TableCell><p>{inventory.branch?.code || "-"} - {inventory.branch?.name || "Filial"}</p><p className="text-xs text-muted-foreground">{inventory.warehouse?.name || inventory.area || "Toda a filial"}</p></TableCell><TableCell><Badge variant={inventory.status === "APPROVED" ? "default" : inventory.status === "CANCELLED" ? "destructive" : "outline"}>{maintenanceLabel(inventory.status)}</Badge></TableCell><TableCell>{maintenanceDate(inventory.started_at || inventory.created_at, true)}</TableCell></TableRow>)}</TableBody></Table>
        ) : <div className="p-10 text-center text-sm text-muted-foreground">Nenhum inventario encontrado.</div>}
      </div>

      <Pagination page={page} pageCount={pageCount} total={total} disabled={loading} onPage={setPage} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Iniciar inventario</DialogTitle><DialogDescription>O saldo e a lista de ativos serao congelados como referencia desta contagem.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Filial" required><Select value={createForm.branchId} onValueChange={(value) => setCreateForm((current) => ({ ...current, branchId: value, warehouseId: "" }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Tipo" required><Select value={createForm.inventoryType} onValueChange={(value: "MATERIAL" | "ASSET") => setCreateForm((current) => ({ ...current, inventoryType: value, warehouseId: "", area: "" }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MATERIAL">Materiais</SelectItem><SelectItem value="ASSET">Equipamentos</SelectItem></SelectContent></Select></Field>{createForm.inventoryType === "MATERIAL" ? <Field label="Almoxarifado" required className="sm:col-span-2"><Select value={createForm.warehouseId} onValueChange={(value) => setCreateForm((current) => ({ ...current, warehouseId: value }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{filteredWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>)}</SelectContent></Select></Field> : <Field label="Area (opcional)" className="sm:col-span-2"><Input value={createForm.area} onChange={(event) => setCreateForm((current) => ({ ...current, area: event.target.value }))} placeholder="Vazio para todos os ativos da filial" /></Field>}<Field label="Observacoes" className="sm:col-span-2"><Textarea value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void createInventory()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}Iniciar contagem</Button></DialogFooter></DialogContent></Dialog>

      <Sheet open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}><SheetContent className="w-full sm:max-w-5xl"><SheetHeader><SheetTitle>{detail?.code || "Inventario"}</SheetTitle><SheetDescription>{detail ? `${detail.inventory_type === "MATERIAL" ? "Materiais" : "Equipamentos"} - ${detail.branch?.code || ""} ${detail.branch?.name || ""}` : "Carregando conferencia."}</SheetDescription></SheetHeader>{detailLoading && !detail ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14" />)}</div> : detail ? <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><Badge variant={detail.status === "APPROVED" ? "default" : "outline"}>{maintenanceLabel(detail.status)}</Badge><p className="mt-1 text-sm text-muted-foreground">Referencia congelada em {maintenanceDate(detail.reference_frozen_at, true)}; {detail.itemTotal} item(ns).</p></div><div className="flex flex-wrap gap-2">{editable && capabilities.EXECUTE_INVENTORY ? <Button type="button" variant="outline" onClick={() => setConfirmation("SUBMIT")}><Send className="size-4" />Enviar para aprovacao</Button> : null}{detail.status === "SUBMITTED" && capabilities.APPROVE_INVENTORY ? <Button type="button" onClick={() => setConfirmation("APPROVE")}><CheckCircle2 className="size-4" />Aprovar ajustes</Button> : null}</div></div><InventoryItemsTable detail={detail} drafts={drafts} editable={Boolean(editable && capabilities.EXECUTE_INVENTORY)} itemSavingId={itemSavingId} onDraft={(id, next) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] || draftFor(detail.items.find((item) => item.id === id)!)), ...next } }))} onSave={(item) => void saveItem(item)} /><Pagination page={detail.itemPage} pageCount={detailPageCount} total={detail.itemTotal} disabled={detailLoading} onPage={(next) => void loadDetail(detail.id, next)} /></div> : null}</SheetContent></Sheet>

      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) setConfirmation(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{confirmation === "APPROVE" ? "Aprovar inventario" : "Enviar inventario"}</DialogTitle><DialogDescription>{confirmation === "APPROVE" ? "As divergencias de material serao transformadas em movimentacoes de ajuste auditadas." : "Depois do envio, a contagem ficara bloqueada ate a aprovacao."}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmation(null)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void runWorkflowAction()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : confirmation === "APPROVE" ? <CheckCircle2 className="size-4" /> : <Send className="size-4" />}{confirmation === "APPROVE" ? "Aprovar e ajustar" : "Confirmar envio"}</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

function InventoryItemsTable({ detail, drafts, editable, itemSavingId, onDraft, onSave }: { detail: InventoryDetail; drafts: Record<string, CountDraft>; editable: boolean; itemSavingId: string | null; onDraft: (id: string, next: Partial<CountDraft>) => void; onSave: (item: InventoryItem) => void }) {
  if (!detail.items.length) return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum item foi gerado para esta contagem.</div>;
  return <div className="mb-4 overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Referencia</TableHead><TableHead>Conferencia</TableHead><TableHead>Situacao / local</TableHead><TableHead>Justificativa</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{detail.items.map((item) => { const draft = drafts[item.id] || draftFor(item); return <TableRow key={item.id}><TableCell><p className="max-w-64 truncate font-medium">{item.material ? `${item.material.code} - ${item.material.name}` : `${item.asset?.internal_code || "-"} - ${item.asset?.name || "Ativo"}`}</p><p className="text-xs text-muted-foreground">{item.material?.unit || item.asset?.asset_tag || "Equipamento"}</p></TableCell><TableCell>{detail.inventory_type === "MATERIAL" ? `${Number(item.reference_quantity || 0).toLocaleString("pt-BR")} ${item.material?.unit || ""}` : item.asset?.physical_location || "Sem local"}</TableCell><TableCell>{detail.inventory_type === "MATERIAL" ? <div className="flex min-w-48 gap-2"><Select value={draft.round} onValueChange={(value: "1" | "2") => onDraft(item.id, { round: value, quantity: value === "2" ? String(item.second_count_quantity ?? "") : String(item.first_count_quantity ?? "") })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1a</SelectItem><SelectItem value="2">2a</SelectItem></SelectContent></Select><Input className="w-28" inputMode="decimal" value={draft.quantity} disabled={!editable} onChange={(event) => onDraft(item.id, { quantity: event.target.value })} /></div> : <Select value={draft.found} disabled={!editable} onValueChange={(value: "FOUND" | "NOT_FOUND") => onDraft(item.id, { found: value })}><SelectTrigger className="min-w-40"><SelectValue placeholder="Conferir" /></SelectTrigger><SelectContent><SelectItem value="FOUND">Encontrado</SelectItem><SelectItem value="NOT_FOUND">Nao encontrado</SelectItem></SelectContent></Select>}</TableCell><TableCell>{detail.inventory_type === "MATERIAL" ? <span className="text-sm">{item.variance_quantity == null ? "Pendente" : item.variance_quantity === 0 ? "Sem divergencia" : `${item.variance_quantity > 0 ? "+" : ""}${item.variance_quantity}`}</span> : <div className="grid min-w-56 gap-2"><Input value={draft.foundLocation} disabled={!editable || draft.found === "NOT_FOUND"} onChange={(event) => onDraft(item.id, { foundLocation: event.target.value })} placeholder="Local encontrado" /><Input value={draft.condition} disabled={!editable || draft.found === "NOT_FOUND"} onChange={(event) => onDraft(item.id, { condition: event.target.value })} placeholder="Conservacao" /></div>}</TableCell><TableCell><Textarea className="min-h-10 min-w-56" value={draft.justification} disabled={!editable} onChange={(event) => onDraft(item.id, { justification: event.target.value })} placeholder="Obrigatoria em divergencias" /></TableCell><TableCell>{editable ? <Button type="button" size="icon" variant="ghost" title="Salvar conferencia" disabled={Boolean(itemSavingId)} onClick={() => onSave(item)}>{itemSavingId === item.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}</Button> : null}</TableCell></TableRow>; })}</TableBody></Table></div>;
}

function Pagination({ page, pageCount, total, disabled, onPage }: { page: number; pageCount: number; total: number; disabled: boolean; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{total} registro(s)</p><div className="flex items-center gap-2"><Button type="button" size="icon" variant="outline" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-20 text-center text-sm">{page} de {pageCount}</span><Button type="button" size="icon" variant="outline" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></Button></div></div>;
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>;
}
