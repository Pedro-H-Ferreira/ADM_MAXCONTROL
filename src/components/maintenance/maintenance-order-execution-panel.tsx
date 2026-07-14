"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, History, Loader2, PackageCheck, PackagePlus, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { maintenanceDate, maintenanceLabel, maintenanceMoney, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Material = { id: string; code: string; name: string; unit: string; last_cost_cents: number };
type Balance = { id: number; material_id: string; location_id: string; quantity_on_hand: number; quantity_reserved: number; quantity_blocked: number };
type Location = { id: string; warehouse_id: string; code: string; description: string | null; active: boolean };
type Warehouse = { id: string; branch_id: string; code: string; name: string };
type CatalogMaterial = Material & { balances: Balance[]; totals: { available: number } };
type CatalogPayload = { success: true; items: CatalogMaterial[]; locations: Location[]; warehouses: Warehouse[] };
type Reservation = {
  id: string;
  material_id: string;
  location_id: string;
  requested_quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  released_quantity: number;
  status: string;
  reserved_at: string;
  material?: Material | Material[] | null;
  location?: (Location & { warehouse?: Warehouse | Warehouse[] | null }) | Array<Location & { warehouse?: Warehouse | Warehouse[] | null }> | null;
};
type MaterialItem = { id: string; planned_quantity: number; reserved_quantity: number; consumed_quantity: number; returned_quantity: number; unit_cost_cents: number; material?: Material | Material[] | null };
type OrderEvent = { id: string; event_type: string; event_label: string; status_from: string | null; status_to: string | null; created_at: string; actor?: { display_name?: string | null; email?: string | null } | Array<{ display_name?: string | null; email?: string | null }> | null };
type StockMovement = { id: number; movement_type: string; quantity: number; unit: string; total_cost_cents: number; reason: string; occurred_at: string; material?: { code: string; name: string } | Array<{ code: string; name: string }> | null };
type OrderDetail = { id: string; branch: { id: string | null }; materialItems: MaterialItem[]; reservations: Reservation[]; stockMovements: StockMovement[]; events: OrderEvent[] };
type DetailPayload = { success: true; order: OrderDetail };
type ActionMode = "RESERVE" | "CONSUME" | "RELEASE" | "RETURN_CONSUMPTION";

function related<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function numberValue(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyCents(value: string) {
  return Math.max(0, Math.round(numberValue(value) * 100));
}

export function MaintenanceOrderExecutionPanel({ orderId, branchId, canMoveStock, onChanged }: { orderId: string; branchId: string | null; canMoveStock: boolean; onChanged: () => void | Promise<void> }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [orderMaterial, setOrderMaterial] = useState<MaterialItem | null>(null);
  const [form, setForm] = useState({ materialId: "", locationId: "", quantity: "", unitCost: "", reason: "" });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100", active: "true" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const [detailData, catalogData] = await Promise.all([
        maintenanceRequest<DetailPayload>(`/api/manutencao/${orderId}`, { cache: "no-store", signal }, "Falha ao carregar execucao da OS."),
        maintenanceRequest<CatalogPayload>(`/api/manutencao/materials?${params}`, { cache: "no-store", signal }, "Falha ao carregar estoque."),
      ]);
      setDetail(detailData.order);
      setMaterials(catalogData.items || []);
      const allowedWarehouseIds = new Set((catalogData.warehouses || []).filter((warehouse) => !branchId || warehouse.branch_id === branchId).map((warehouse) => warehouse.id));
      setWarehouses((catalogData.warehouses || []).filter((warehouse) => allowedWarehouseIds.has(warehouse.id)));
      setLocations((catalogData.locations || []).filter((location) => location.active && allowedWarehouseIds.has(location.warehouse_id)));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar execucao da OS.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [branchId, debouncedSearch, orderId]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void load(controller.signal));
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [load]);

  function openReserve() {
    setReservation(null);
    setOrderMaterial(null);
    setForm({ materialId: "", locationId: "", quantity: "", unitCost: "", reason: "" });
    setActionMode("RESERVE");
  }

  function openReservationAction(next: "CONSUME" | "RELEASE", current: Reservation) {
    const material = related(current.material);
    setReservation(current);
    setForm({ materialId: current.material_id, locationId: current.location_id, quantity: String(current.reserved_quantity - current.consumed_quantity - current.released_quantity).replace(".", ","), unitCost: material?.last_cost_cents ? String(material.last_cost_cents / 100).replace(".", ",") : "", reason: "" });
    setActionMode(next);
  }

  function openReturn(current: MaterialItem) {
    const available = current.consumed_quantity - current.returned_quantity;
    setReservation(null);
    setOrderMaterial(current);
    setForm({ materialId: "", locationId: "", quantity: String(available).replace(".", ","), unitCost: "", reason: "" });
    setActionMode("RETURN_CONSUMPTION");
  }

  async function runAction() {
    if (!actionMode) return;
    const quantity = numberValue(form.quantity);
    if (quantity <= 0) { toast.error("Informe uma quantidade maior que zero."); return; }
    if ((actionMode === "RESERVE" || actionMode === "RETURN_CONSUMPTION") && !form.locationId) { toast.error("Selecione o local de estoque."); return; }
    if (actionMode === "RESERVE" && !form.materialId) { toast.error("Selecione o material."); return; }
    if ((actionMode === "RELEASE" || actionMode === "RETURN_CONSUMPTION") && !form.reason.trim()) { toast.error("Informe o motivo da operacao."); return; }
    const payload = actionMode === "RESERVE"
      ? { action: "RESERVE", orderId, materialId: form.materialId, locationId: form.locationId, quantity }
      : actionMode === "CONSUME"
        ? { action: "CONSUME", reservationId: reservation?.id, quantity, unitCostCents: moneyCents(form.unitCost) }
        : actionMode === "RELEASE"
          ? { action: "RELEASE", reservationId: reservation?.id, quantity, reason: form.reason.trim() }
          : { action: "RETURN_CONSUMPTION", orderMaterialId: orderMaterial?.id, locationId: form.locationId, quantity, reason: form.reason.trim() };
    setSaving(true);
    try {
      await maintenanceRequest("/api/manutencao/stock/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, "Falha ao atualizar material da OS.");
      toast.success(actionMode === "RESERVE" ? "Material reservado para a OS." : actionMode === "CONSUME" ? "Material consumido e custo atualizado." : actionMode === "RELEASE" ? "Reserva liberada." : "Material devolvido e custo da OS recalculado.");
      setActionMode(null);
      await load();
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar material da OS.");
    } finally {
      setSaving(false);
    }
  }

  const selectedMaterial = materials.find((material) => material.id === form.materialId) || null;
  const availableLocations = useMemo(() => {
    if (!selectedMaterial) return locations;
    const balanceByLocation = new Map(selectedMaterial.balances.map((balance) => [balance.location_id, balance]));
    return locations.filter((location) => {
      const balance = balanceByLocation.get(location.id);
      return balance && balance.quantity_on_hand - balance.quantity_reserved - balance.quantity_blocked > 0;
    });
  }, [locations, selectedMaterial]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);

  if (loading && !detail) return <div className="space-y-2 rounded-md border p-3">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>;
  return (
    <div className="rounded-md border bg-background p-3">
      <Tabs defaultValue="materials">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><TabsList className="h-auto"><TabsTrigger value="materials">Materiais</TabsTrigger><TabsTrigger value="timeline">Timeline</TabsTrigger><TabsTrigger value="movements">Movimentacoes</TabsTrigger></TabsList><div className="flex gap-2"><Button type="button" size="icon" variant="ghost" title="Atualizar execucao" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>{canMoveStock ? <Button type="button" size="sm" onClick={openReserve}><PackagePlus className="size-4" />Reservar material</Button> : null}</div></div>
        <TabsContent value="materials" className="mt-3"><div className="overflow-hidden rounded-md border">{detail?.materialItems.length ? <Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Reservado</TableHead><TableHead>Consumido</TableHead><TableHead>Devolvido</TableHead><TableHead>Custo liquido</TableHead><TableHead className="w-24" /></TableRow></TableHeader><TableBody>{detail.materialItems.map((item) => { const material = related(item.material); const returnable = item.consumed_quantity - item.returned_quantity; return <TableRow key={item.id}><TableCell>{material ? `${material.code} - ${material.name}` : "Material"}</TableCell><TableCell>{item.reserved_quantity.toLocaleString("pt-BR")} {material?.unit || ""}</TableCell><TableCell>{item.consumed_quantity.toLocaleString("pt-BR")} {material?.unit || ""}</TableCell><TableCell>{item.returned_quantity.toLocaleString("pt-BR")} {material?.unit || ""}</TableCell><TableCell>{maintenanceMoney(returnable * item.unit_cost_cents)}</TableCell><TableCell>{canMoveStock && returnable > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => openReturn(item)}><ArchiveRestore className="size-4" />Devolver</Button> : null}</TableCell></TableRow>; })}</TableBody></Table> : <p className="p-5 text-sm text-muted-foreground">Nenhum material reservado ou consumido nesta OS.</p>}</div>{detail?.reservations.length ? <div className="mt-3 space-y-2">{detail.reservations.map((item) => { const material = related(item.material); const location = related(item.location); const warehouse = related(location?.warehouse); const remaining = item.reserved_quantity - item.consumed_quantity - item.released_quantity; return <div key={item.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{material ? `${material.code} - ${material.name}` : "Material"}</p><Badge variant="outline">{maintenanceLabel(item.status)}</Badge></div><p className="text-xs text-muted-foreground">{warehouse?.code || "-"} / {location?.code || "-"}: {remaining.toLocaleString("pt-BR")} {material?.unit || ""} ainda reservado</p></div>{canMoveStock && remaining > 0 ? <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => openReservationAction("RELEASE", item)}><ArchiveRestore className="size-4" />Liberar</Button><Button type="button" size="sm" onClick={() => openReservationAction("CONSUME", item)}><PackageCheck className="size-4" />Consumir</Button></div> : null}</div>; })}</div> : null}</TabsContent>
        <TabsContent value="timeline" className="mt-3"><div className="space-y-2">{detail?.events.length ? detail.events.map((event) => { const actor = related(event.actor); return <div key={event.id} className="flex gap-3 rounded-md border p-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30"><History className="size-4" /></span><div className="min-w-0"><p className="font-medium">{event.event_label}</p><p className="text-xs text-muted-foreground">{maintenanceDate(event.created_at, true)} / {actor?.display_name || actor?.email || "Sistema"}</p>{event.status_from || event.status_to ? <p className="mt-1 text-xs text-muted-foreground">{maintenanceLabel(event.status_from)} → {maintenanceLabel(event.status_to)}</p> : null}</div></div>; }) : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Sem eventos registrados.</p>}</div></TabsContent>
        <TabsContent value="movements" className="mt-3"><div className="overflow-hidden rounded-md border">{detail?.stockMovements.length ? <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Operacao</TableHead><TableHead>Material</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo</TableHead></TableRow></TableHeader><TableBody>{detail.stockMovements.map((movement) => { const material = related(movement.material); return <TableRow key={movement.id}><TableCell>{maintenanceDate(movement.occurred_at, true)}</TableCell><TableCell>{maintenanceLabel(movement.movement_type)}</TableCell><TableCell>{material ? `${material.code} - ${material.name}` : "Material"}</TableCell><TableCell>{movement.quantity.toLocaleString("pt-BR")} {movement.unit}</TableCell><TableCell>{maintenanceMoney(movement.total_cost_cents)}</TableCell></TableRow>; })}</TableBody></Table> : <p className="p-5 text-sm text-muted-foreground">Nenhuma movimentacao registrada.</p>}</div></TabsContent>
      </Tabs>

      <Dialog open={Boolean(actionMode)} onOpenChange={(open) => { if (!open) setActionMode(null); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{actionMode === "RESERVE" ? "Reservar material" : actionMode === "CONSUME" ? "Consumir reserva" : actionMode === "RELEASE" ? "Liberar reserva" : "Devolver material"}</DialogTitle><DialogDescription>{actionMode === "RESERVE" ? "O saldo disponivel e reduzido sem alterar o saldo fisico." : actionMode === "CONSUME" ? "O consumo baixa o estoque e atualiza o custo real da OS." : actionMode === "RELEASE" ? "A quantidade volta a ficar disponivel no almoxarifado." : "A devolucao repoe o estoque e reduz o custo liquido da OS."}</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">{actionMode === "RESERVE" ? <><Field label="Buscar material" className="sm:col-span-2"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Codigo, nome, SKU ou categoria" /></Field><Field label="Material" required className="sm:col-span-2"><Select value={form.materialId} onValueChange={(value) => setForm((current) => ({ ...current, materialId: value, locationId: "" }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{materials.map((material) => <SelectItem key={material.id} value={material.id}>{material.code} - {material.name} ({material.totals.available.toLocaleString("pt-BR")} {material.unit})</SelectItem>)}</SelectContent></Select></Field></> : null}{actionMode === "RESERVE" || actionMode === "RETURN_CONSUMPTION" ? <Field label={actionMode === "RESERVE" ? "Local de estoque" : "Local para devolucao"} required className="sm:col-span-2"><Select value={form.locationId} onValueChange={(value) => setForm((current) => ({ ...current, locationId: value }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{(actionMode === "RESERVE" ? availableLocations : locations).map((location) => { const warehouse = warehouseById.get(location.warehouse_id); const balance = selectedMaterial?.balances.find((item) => item.location_id === location.id); const available = balance ? balance.quantity_on_hand - balance.quantity_reserved - balance.quantity_blocked : 0; return <SelectItem key={location.id} value={location.id}>{warehouse?.code || "-"} / {location.code}{actionMode === "RESERVE" ? ` - ${available.toLocaleString("pt-BR")} ${selectedMaterial?.unit || ""}` : ""}</SelectItem>; })}</SelectContent></Select></Field> : null}<Field label="Quantidade" required><Input inputMode="decimal" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></Field>{actionMode === "CONSUME" ? <Field label="Custo unitario"><Input inputMode="decimal" value={form.unitCost} onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))} /></Field> : null}{actionMode === "RELEASE" || actionMode === "RETURN_CONSUMPTION" ? <Field label="Motivo" required className="sm:col-span-2"><Textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} /></Field> : null}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setActionMode(null)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void runAction()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : actionMode === "RESERVE" ? <PackagePlus className="size-4" /> : actionMode === "CONSUME" ? <PackageCheck className="size-4" /> : <ArchiveRestore className="size-4" />}{actionMode === "RESERVE" ? "Reservar" : actionMode === "CONSUME" ? "Consumir" : actionMode === "RELEASE" ? "Liberar" : "Devolver"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>;
}
