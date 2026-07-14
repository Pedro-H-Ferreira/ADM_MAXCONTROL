"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Pencil, RefreshCcw, Settings2, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Branch = { id: string; code: string; name: string };
type WarehouseRecord = {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  allow_negative_stock: boolean;
  require_approval_for_adjustment: boolean;
  branch?: Branch | Branch[] | null;
};
type Location = { id: string; warehouse_id: string; code: string; active: boolean; blocked: boolean };
type Payload = {
  success: true;
  warehouses: WarehouseRecord[];
  locations: Location[];
  capabilities: Record<string, boolean>;
};
type Form = { name: string; active: boolean; allowNegativeStock: boolean; requireApprovalForAdjustment: boolean };

function related<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

export function MaintenanceSettingsPanel() {
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<WarehouseRecord | null>(null);
  const [form, setForm] = useState<Form>({ name: "", active: true, allowNegativeStock: false, requireApprovalForAdjustment: true });

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await maintenanceRequest<Payload>("/api/manutencao/settings", { cache: "no-store", signal }, "Falha ao carregar configuracoes.");
      setWarehouses(data.warehouses || []);
      setLocations(data.locations || []);
      setCapabilities(data.capabilities || {});
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar configuracoes.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void load(controller.signal));
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [load]);

  const locationCount = useMemo(() => {
    const result = new Map<string, number>();
    for (const location of locations) result.set(location.warehouse_id, (result.get(location.warehouse_id) || 0) + 1);
    return result;
  }, [locations]);

  function openEdit(warehouse: WarehouseRecord) {
    setEditing(warehouse);
    setForm({
      name: warehouse.name,
      active: warehouse.active,
      allowNegativeStock: warehouse.allow_negative_stock,
      requireApprovalForAdjustment: warehouse.require_approval_for_adjustment !== false,
    });
  }

  async function save() {
    if (!editing || !form.name.trim()) { toast.error("Informe o nome do almoxarifado."); return; }
    setSaving(true);
    try {
      await maintenanceRequest("/api/manutencao/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: editing.id, ...form, name: form.name.trim() }),
      }, "Falha ao atualizar almoxarifado.");
      toast.success("Configuracao do almoxarifado atualizada.");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar almoxarifado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-base font-semibold">Configuracoes de manutencao</h2><p className="text-sm text-muted-foreground">Politicas de estoque e operacao dos almoxarifados por filial.</p></div>
        <Button type="button" variant="outline" size="icon" title="Atualizar configuracoes" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Warehouse} label="Almoxarifados" value={warehouses.length} />
        <Metric icon={MapPin} label="Locais de armazenagem" value={locations.length} />
        <Metric icon={Settings2} label="Ajuste com aprovacao" value={warehouses.filter((item) => item.require_approval_for_adjustment !== false).length} />
      </div>

      {loading && !warehouses.length ? (
        <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div>
      ) : warehouses.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {warehouses.map((warehouse) => {
            const branch = related(warehouse.branch);
            return <article key={warehouse.id} className="rounded-md border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{warehouse.code} - {warehouse.name}</h3><Badge variant={warehouse.active ? "secondary" : "outline"}>{warehouse.active ? "Ativo" : "Inativo"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{branch ? `${branch.code} - ${branch.name}` : "Filial nao identificada"}</p></div>
                {capabilities.MANAGE_STOCK ? <Button type="button" variant="ghost" size="icon" title="Editar almoxarifado" onClick={() => openEdit(warehouse)}><Pencil className="size-4" /></Button> : null}
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <SettingValue label="Locais" value={String(locationCount.get(warehouse.id) || 0)} />
                <SettingValue label="Saldo negativo" value={warehouse.allow_negative_stock ? "Permitido" : "Bloqueado"} />
                <SettingValue label="Ajustes" value={warehouse.require_approval_for_adjustment === false ? "Diretos" : "Com aprovacao"} />
              </div>
            </article>;
          })}
        </div>
      ) : <p className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">Nenhum almoxarifado disponivel para as suas filiais.</p>}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Configurar almoxarifado</DialogTitle><DialogDescription>{editing ? `${editing.code} - parametros operacionais da filial.` : "Parametros operacionais."}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="warehouse-name">Nome</Label><Input id="warehouse-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={form.active} onCheckedChange={(checked) => setForm((current) => ({ ...current, active: checked === true }))} /><span><span className="block font-medium">Almoxarifado ativo</span><span className="text-muted-foreground">Disponibiliza o almoxarifado em entradas, saidas e inventarios.</span></span></label>
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={form.allowNegativeStock} onCheckedChange={(checked) => setForm((current) => ({ ...current, allowNegativeStock: checked === true }))} /><span><span className="block font-medium">Autorizar excecao de saldo disponivel</span><span className="text-muted-foreground">A baixa continua impedindo saldo fisico negativo e exige permissao administrativa.</span></span></label>
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={form.requireApprovalForAdjustment} onCheckedChange={(checked) => setForm((current) => ({ ...current, requireApprovalForAdjustment: checked === true }))} /><span><span className="block font-medium">Exigir aprovacao para ajustes</span><span className="text-muted-foreground">Inventarios e ajustes manuais devem passar por aprovacao autorizada.</span></span></label>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Warehouse; label: string; value: number }) {
  return <div className="rounded-md border bg-background p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{label}</div><p className="mt-2 text-2xl font-semibold">{value.toLocaleString("pt-BR")}</p></div>;
}

function SettingValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted/40 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
