"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
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
import { maintenanceMoney, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type StockBalance = { id: string; location_id: string; quantity_on_hand: number; quantity_reserved: number; quantity_blocked: number; quantity_in_transit: number; average_cost_cents: number };
type Material = {
  id: string; code: string; sku: string | null; barcode: string | null; name: string; description: string | null;
  category: string | null; unit: string; brand: string | null; model: string | null; average_cost_cents: number;
  last_cost_cents: number; minimum_stock: number; maximum_stock: number | null; reorder_point: number; lead_time_days: number;
  active: boolean; balances: StockBalance[]; totals: { onHand: number; reserved: number; blocked: number; inTransit: number; available: number };
};
type Warehouse = { id: string; branch_id: string; code: string; name: string; branch?: { id: string; code: string; name: string } | null };
type Location = { id: string; warehouse_id: string; code: string; name: string | null };
type MaterialsPayload = { success: true; items: Material[]; total: number; warehouses: Warehouse[]; locations: Location[]; capabilities: Record<string, boolean> };
type MaterialForm = { code: string; sku: string; barcode: string; name: string; description: string; category: string; unit: string; brand: string; model: string; averageCost: string; lastCost: string; minimumStock: string; maximumStock: string; reorderPoint: string; leadTimeDays: string; active: boolean };

const emptyMaterial: MaterialForm = { code: "", sku: "", barcode: "", name: "", description: "", category: "", unit: "UN", brand: "", model: "", averageCost: "", lastCost: "", minimumStock: "0", maximumStock: "", reorderPoint: "0", leadTimeDays: "0", active: true };
type MovementDefinition = {
  value: string;
  label: string;
  direction: "in" | "out" | "transfer";
  adjustment?: boolean;
};

const movementTypes: readonly MovementDefinition[] = [
  { value: "PURCHASE_IN", label: "Entrada por compra", direction: "in" },
  { value: "MANUAL_IN", label: "Entrada manual", direction: "in" },
  { value: "RETURN_FROM_ORDER", label: "Devolucao de OS", direction: "in" },
  { value: "WORK_ORDER_OUT", label: "Consumo em OS", direction: "out" },
  { value: "TRANSFER", label: "Transferencia", direction: "transfer" },
  { value: "POSITIVE_ADJUSTMENT", label: "Ajuste positivo", direction: "in", adjustment: true },
  { value: "NEGATIVE_ADJUSTMENT", label: "Ajuste negativo", direction: "out", adjustment: true },
  { value: "LOSS", label: "Perda", direction: "out", adjustment: true },
  { value: "DAMAGE", label: "Avaria", direction: "out", adjustment: true },
  { value: "WRITE_OFF", label: "Baixa", direction: "out", adjustment: true },
] as const;

function moneyCents(value: string) { const amount = Number(value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".") || 0); return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0; }
function numberValue(value: string) { const amount = Number(value.replace(",", ".") || 0); return Number.isFinite(amount) ? Math.max(0, amount) : 0; }
function formFromMaterial(material?: Material | null): MaterialForm { return material ? { code: material.code, sku: material.sku || "", barcode: material.barcode || "", name: material.name, description: material.description || "", category: material.category || "", unit: material.unit, brand: material.brand || "", model: material.model || "", averageCost: String(material.average_cost_cents / 100).replace(".", ","), lastCost: String(material.last_cost_cents / 100).replace(".", ","), minimumStock: String(material.minimum_stock), maximumStock: material.maximum_stock == null ? "" : String(material.maximum_stock), reorderPoint: String(material.reorder_point), leadTimeDays: String(material.lead_time_days), active: material.active } : { ...emptyMaterial }; }

export function MaintenanceStockPanel() {
  const [items, setItems] = useState<Material[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Material | null>(null);
  const [editing, setEditing] = useState<Material | null>(null);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [form, setForm] = useState<MaterialForm>(emptyMaterial);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movement, setMovement] = useState({ movementType: "PURCHASE_IN", materialId: "", quantity: "", fromLocationId: "", toLocationId: "", unitCost: "", documentNumber: "", reason: "", notes: "" });
  const pageCount = Math.max(1, Math.ceil(total / 20));

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);

  const loadMaterials = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (active !== "ALL") params.set("active", active);
      const data = await maintenanceRequest<MaterialsPayload>(`/api/manutencao/materials?${params}`, { cache: "no-store", signal }, "Falha ao carregar estoque.");
      setItems(data.items || []); setTotal(data.total || 0); setWarehouses(data.warehouses || []); setLocations(data.locations || []); setCapabilities(data.capabilities || {});
      setSelected((current) => current ? data.items.find((item) => item.id === current.id) || current : null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar estoque.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [active, debouncedSearch, page]);

  useEffect(() => { const controller = new AbortController(); const frame = window.requestAnimationFrame(() => void loadMaterials(controller.signal)); return () => { window.cancelAnimationFrame(frame); controller.abort(); }; }, [loadMaterials]);

  function openMaterial(material?: Material) { setEditing(material || null); setForm(formFromMaterial(material)); setMaterialOpen(true); }
  async function saveMaterial() {
    if (!form.code.trim() || !form.name.trim() || !form.unit.trim()) { toast.error("Informe codigo, nome e unidade."); return; }
    setSaving(true);
    try {
      const payload = { code: form.code.trim(), sku: form.sku.trim() || null, barcode: form.barcode.trim() || null, name: form.name.trim(), description: form.description.trim() || null, category: form.category.trim() || null, unit: form.unit.trim().toUpperCase(), brand: form.brand.trim() || null, model: form.model.trim() || null, averageCostCents: moneyCents(form.averageCost), lastCostCents: moneyCents(form.lastCost), minimumStock: numberValue(form.minimumStock), maximumStock: form.maximumStock.trim() ? numberValue(form.maximumStock) : null, reorderPoint: numberValue(form.reorderPoint), leadTimeDays: Math.round(numberValue(form.leadTimeDays)), active: form.active };
      await maintenanceRequest(editing ? `/api/manutencao/materials/${editing.id}` : "/api/manutencao/materials", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, "Falha ao salvar material.");
      toast.success(editing ? "Material atualizado." : "Material cadastrado."); setMaterialOpen(false); await loadMaterials();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao salvar material."); } finally { setSaving(false); }
  }

  function openMovement(material?: Material, type = "PURCHASE_IN") {
    const defaultLocation = locations[0]?.id || "";
    const definition = movementTypes.find((item) => item.value === type) || movementTypes[0];
    setMovement({ movementType: definition.value, materialId: material?.id || "", quantity: "", fromLocationId: definition.direction === "out" ? defaultLocation : "", toLocationId: definition.direction === "in" ? defaultLocation : "", unitCost: material?.last_cost_cents ? String(material.last_cost_cents / 100).replace(".", ",") : "", documentNumber: "", reason: "", notes: "" });
    setMovementOpen(true);
  }

  async function postMovement() {
    const definition = movementTypes.find((item) => item.value === movement.movementType);
    if (!movement.materialId || !numberValue(movement.quantity) || !movement.reason.trim()) { toast.error("Informe material, quantidade e motivo."); return; }
    if ((definition?.direction === "out" || definition?.direction === "transfer") && !movement.fromLocationId) { toast.error("Informe o local de origem."); return; }
    if ((definition?.direction === "in" || definition?.direction === "transfer") && !movement.toLocationId) { toast.error("Informe o local de destino."); return; }
    setSaving(true);
    try {
      await maintenanceRequest("/api/manutencao/stock/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "MOVE", movementType: movement.movementType, materialId: movement.materialId, quantity: numberValue(movement.quantity), fromLocationId: movement.fromLocationId || null, toLocationId: movement.toLocationId || null, workOrderId: null, assetId: null, inventoryCountId: null, unitCostCents: moneyCents(movement.unitCost), reason: movement.reason.trim(), documentNumber: movement.documentNumber.trim() || null, notes: movement.notes.trim() || null }) }, "Falha ao movimentar estoque.");
      toast.success("Movimentacao registrada."); setMovementOpen(false); await loadMaterials();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao movimentar estoque."); } finally { setSaving(false); }
  }

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const currentMovement = movementTypes.find((item) => item.value === movement.movementType) || movementTypes[0];
  const lowStockCount = items.filter((item) => item.active && item.totals.available <= Math.max(item.minimum_stock, item.reorder_point)).length;

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-base font-semibold">Estoque de manutencao</h2><p className="text-sm text-muted-foreground">{total} material(is) no catalogo; {lowStockCount} em reposicao nesta pagina.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="icon" onClick={() => void loadMaterials()} disabled={loading} title="Atualizar estoque"><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>{capabilities.MOVE_STOCK !== false ? <Button type="button" variant="outline" onClick={() => openMovement()}><ArrowLeftRight className="size-4" />Movimentar</Button> : null}{capabilities.MANAGE_STOCK !== false ? <Button type="button" onClick={() => openMaterial()}><Plus className="size-4" />Novo material</Button> : null}</div></div>
    <div className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[minmax(0,1fr)_220px]"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar codigo, SKU, nome, marca ou categoria" /></div><Select value={active} onValueChange={(value) => { setActive(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Materiais ativos</SelectItem><SelectItem value="false">Materiais inativos</SelectItem><SelectItem value="ALL">Todos</SelectItem></SelectContent></Select></div>
    <div className="overflow-hidden rounded-md border bg-background">{loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : items.length ? <Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Disponivel</TableHead><TableHead>Reservado</TableHead><TableHead>Minimo</TableHead><TableHead>Custo medio</TableHead><TableHead className="w-24" /></TableRow></TableHeader><TableBody>{items.map((material) => { const low = material.active && material.totals.available <= Math.max(material.minimum_stock, material.reorder_point); return <TableRow key={material.id} className="cursor-pointer" onClick={() => setSelected(material)}><TableCell><div className="max-w-80"><div className="flex items-center gap-2"><p className="truncate font-medium">{material.code} - {material.name}</p>{!material.active ? <Badge variant="outline">Inativo</Badge> : low ? <Badge variant="destructive">Repor</Badge> : null}</div><p className="truncate text-xs text-muted-foreground">{[material.sku, material.category, material.brand, material.model].filter(Boolean).join(" / ") || material.unit}</p></div></TableCell><TableCell className={low ? "font-semibold text-destructive" : "font-semibold"}>{material.totals.available.toLocaleString("pt-BR")} {material.unit}</TableCell><TableCell>{material.totals.reserved.toLocaleString("pt-BR")} {material.unit}</TableCell><TableCell>{material.minimum_stock.toLocaleString("pt-BR")} {material.unit}</TableCell><TableCell>{maintenanceMoney(material.average_cost_cents)}</TableCell><TableCell><div className="flex gap-1"><Button type="button" size="icon" variant="ghost" title="Movimentar material" onClick={(event) => { event.stopPropagation(); openMovement(material, "WORK_ORDER_OUT"); }}><ArrowUpFromLine className="size-4" /></Button><Button type="button" size="icon" variant="ghost" title="Editar material" onClick={(event) => { event.stopPropagation(); openMaterial(material); }}><Pencil className="size-4" /></Button></div></TableCell></TableRow>; })}</TableBody></Table> : <div className="p-10 text-center text-sm text-muted-foreground">Nenhum material encontrado.</div>}</div>
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{total ? `${(page - 1) * 20 + 1}-${Math.min(page * 20, total)} de ${total}` : "0 materiais"}</p><div className="flex items-center gap-2"><Button type="button" size="icon" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-20 text-center text-sm">{page} de {pageCount}</span><Button type="button" size="icon" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}><ChevronRight className="size-4" /></Button></div></div>

    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><SheetContent className="w-full sm:max-w-xl"><SheetHeader><SheetTitle>{selected ? `${selected.code} - ${selected.name}` : "Material"}</SheetTitle><SheetDescription>{selected?.description || "Saldo por local de armazenamento."}</SheetDescription></SheetHeader>{selected ? <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"><div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"><StockDetail label="Disponivel" value={`${selected.totals.available.toLocaleString("pt-BR")} ${selected.unit}`} /><StockDetail label="Em estoque" value={`${selected.totals.onHand.toLocaleString("pt-BR")} ${selected.unit}`} /><StockDetail label="Reservado" value={`${selected.totals.reserved.toLocaleString("pt-BR")} ${selected.unit}`} /><StockDetail label="Em transito" value={`${selected.totals.inTransit.toLocaleString("pt-BR")} ${selected.unit}`} /><StockDetail label="Custo medio" value={maintenanceMoney(selected.average_cost_cents)} /><StockDetail label="Ultimo custo" value={maintenanceMoney(selected.last_cost_cents)} /></div><h3 className="mb-2 mt-5 font-medium">Saldos por local</h3><div className="rounded-md border">{selected.balances.length ? selected.balances.map((balance) => { const location = locationById.get(balance.location_id); const warehouse = location ? warehouseById.get(location.warehouse_id) : null; return <div key={balance.id} className="flex items-center justify-between gap-3 border-b p-3 last:border-0"><div><p className="font-medium">{warehouse?.branch?.code || "-"} / {warehouse?.code || "-"} / {location?.code || "-"}</p><p className="text-xs text-muted-foreground">{location?.name || warehouse?.name || "Local"}</p></div><div className="text-right"><p className="font-semibold">{(balance.quantity_on_hand - balance.quantity_reserved - balance.quantity_blocked).toLocaleString("pt-BR")} {selected.unit}</p><p className="text-xs text-muted-foreground">{balance.quantity_reserved.toLocaleString("pt-BR")} reservado</p></div></div>; }) : <p className="p-4 text-sm text-muted-foreground">Sem saldo registrado.</p>}</div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={() => openMovement(selected, "PURCHASE_IN")}><ArrowDownToLine className="size-4" />Entrada</Button><Button type="button" variant="outline" onClick={() => openMovement(selected, "WORK_ORDER_OUT")}><ArrowUpFromLine className="size-4" />Saida</Button><Button type="button" variant="outline" onClick={() => openMaterial(selected)}><Pencil className="size-4" />Editar</Button></div></div> : null}</SheetContent></Sheet>

    <MaterialDialog open={materialOpen} editing={editing} form={form} saving={saving} onOpenChange={setMaterialOpen} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onSave={() => void saveMaterial()} />
    <MovementDialog open={movementOpen} movement={movement} material={items.find((item) => item.id === movement.materialId) || selected} items={items} locations={locations} warehouses={warehouses} definition={currentMovement} saving={saving} canAdjust={Boolean(capabilities.ADJUST_STOCK)} onOpenChange={setMovementOpen} onChange={(key, value) => setMovement((current) => ({ ...current, [key]: value }))} onSave={() => void postMovement()} />
  </section>;
}

function MaterialDialog({ open, editing, form, saving, onOpenChange, onChange, onSave }: { open: boolean; editing: Material | null; form: MaterialForm; saving: boolean; onOpenChange: (open: boolean) => void; onChange: <K extends keyof MaterialForm>(key: K, value: MaterialForm[K]) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{editing ? `Editar ${editing.code}` : "Cadastrar material"}</DialogTitle><DialogDescription>Catalogo, unidade, custos e parametros de reposicao.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Codigo" required><Input value={form.code} onChange={(event) => onChange("code", event.target.value)} /></Field><Field label="SKU"><Input value={form.sku} onChange={(event) => onChange("sku", event.target.value)} /></Field><Field label="Codigo de barras"><Input value={form.barcode} onChange={(event) => onChange("barcode", event.target.value)} /></Field><Field label="Nome" required className="sm:col-span-2"><Input value={form.name} onChange={(event) => onChange("name", event.target.value)} /></Field><Field label="Unidade" required><Input value={form.unit} onChange={(event) => onChange("unit", event.target.value)} /></Field><Field label="Categoria"><Input value={form.category} onChange={(event) => onChange("category", event.target.value)} /></Field><Field label="Marca"><Input value={form.brand} onChange={(event) => onChange("brand", event.target.value)} /></Field><Field label="Modelo"><Input value={form.model} onChange={(event) => onChange("model", event.target.value)} /></Field><Field label="Custo medio"><Input inputMode="decimal" value={form.averageCost} onChange={(event) => onChange("averageCost", event.target.value)} /></Field><Field label="Ultimo custo"><Input inputMode="decimal" value={form.lastCost} onChange={(event) => onChange("lastCost", event.target.value)} /></Field><Field label="Estoque minimo"><Input inputMode="decimal" value={form.minimumStock} onChange={(event) => onChange("minimumStock", event.target.value)} /></Field><Field label="Ponto de reposicao"><Input inputMode="decimal" value={form.reorderPoint} onChange={(event) => onChange("reorderPoint", event.target.value)} /></Field><Field label="Estoque maximo"><Input inputMode="decimal" value={form.maximumStock} onChange={(event) => onChange("maximumStock", event.target.value)} /></Field><Field label="Prazo de entrega (dias)"><Input inputMode="numeric" value={form.leadTimeDays} onChange={(event) => onChange("leadTimeDays", event.target.value)} /></Field><Field label="Situacao"><Select value={form.active ? "true" : "false"} onValueChange={(value) => onChange("active", value === "true")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Ativo</SelectItem><SelectItem value="false">Inativo</SelectItem></SelectContent></Select></Field><Field label="Descricao" className="sm:col-span-2 lg:col-span-3"><Textarea value={form.description} onChange={(event) => onChange("description", event.target.value)} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={onSave} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}{editing ? "Salvar material" : "Cadastrar material"}</Button></DialogFooter></DialogContent></Dialog>;
}

function MovementDialog({ open, movement, material, items, locations, warehouses, definition, saving, canAdjust, onOpenChange, onChange, onSave }: { open: boolean; movement: { movementType: string; materialId: string; quantity: string; fromLocationId: string; toLocationId: string; unitCost: string; documentNumber: string; reason: string; notes: string }; material: Material | null | undefined; items: Material[]; locations: Location[]; warehouses: Warehouse[]; definition: (typeof movementTypes)[number]; saving: boolean; canAdjust: boolean; onOpenChange: (open: boolean) => void; onChange: (key: keyof typeof movement, value: string) => void; onSave: () => void }) {
  const allowedTypes = movementTypes.filter((item) => !item.adjustment || canAdjust);
  const locationLabel = (location: Location) => { const warehouse = warehouses.find((item) => item.id === location.warehouse_id); return `${warehouse?.branch?.code || "-"} / ${warehouse?.code || "-"} / ${location.code}`; };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Movimentar estoque</DialogTitle><DialogDescription>O saldo e atualizado de forma transacional no local selecionado.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Operacao" required><Select value={movement.movementType} onValueChange={(value) => { const next = movementTypes.find((item) => item.value === value) || movementTypes[0]; onChange("movementType", value); if (next.direction === "in") onChange("fromLocationId", ""); if (next.direction === "out") onChange("toLocationId", ""); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{allowedTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Material" required><Select value={movement.materialId} onValueChange={(value) => onChange("materialId", value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} - {item.name}</SelectItem>)}</SelectContent></Select></Field>{definition.direction !== "in" ? <Field label="Local de origem" required><Select value={movement.fromLocationId} onValueChange={(value) => onChange("fromLocationId", value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{locationLabel(location)}</SelectItem>)}</SelectContent></Select></Field> : null}{definition.direction !== "out" ? <Field label="Local de destino" required><Select value={movement.toLocationId} onValueChange={(value) => onChange("toLocationId", value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{locationLabel(location)}</SelectItem>)}</SelectContent></Select></Field> : null}<Field label={`Quantidade${material ? ` (${material.unit})` : ""}`} required><Input inputMode="decimal" value={movement.quantity} onChange={(event) => onChange("quantity", event.target.value)} /></Field><Field label="Custo unitario"><Input inputMode="decimal" value={movement.unitCost} onChange={(event) => onChange("unitCost", event.target.value)} /></Field><Field label="Documento"><Input value={movement.documentNumber} onChange={(event) => onChange("documentNumber", event.target.value)} /></Field><Field label="Motivo" required className="sm:col-span-2"><Textarea value={movement.reason} onChange={(event) => onChange("reason", event.target.value)} /></Field><Field label="Observacoes" className="sm:col-span-2"><Textarea value={movement.notes} onChange={(event) => onChange("notes", event.target.value)} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={onSave} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}Registrar</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>; }
function StockDetail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>; }
