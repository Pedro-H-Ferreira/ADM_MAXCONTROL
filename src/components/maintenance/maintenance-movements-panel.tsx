"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ChevronLeft, ChevronRight, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { maintenanceDate, maintenanceLabel, maintenanceMoney, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Branch = { id: string; code: string; name: string };
type Related<T> = T | T[] | null;
type Movement = {
  id: number; movement_type: string; quantity: number; unit: string; document_number: string | null;
  total_cost_cents: number; reason: string; occurred_at: string;
  material: Related<{ code: string; name: string; sku: string | null }>;
  from_location: Related<{ code: string }>;
  to_location: Related<{ code: string }>;
  order: Related<{ code: string; title: string }>;
  actor: Related<{ display_name: string | null; email: string | null }>;
};
type Payload = { success: true; items: Movement[]; total: number; page: number; pageSize: number; branches: Branch[] };

const movementTypes = ["PURCHASE_IN", "MANUAL_IN", "RETURN_FROM_ORDER", "WORK_ORDER_OUT", "TRANSFER", "POSITIVE_ADJUSTMENT", "NEGATIVE_ADJUSTMENT", "LOSS", "DAMAGE", "INVENTORY_IN", "INVENTORY_OUT", "WRITE_OFF", "REVERSAL_IN", "REVERSAL_OUT"];
const inbound = new Set(["PURCHASE_IN", "MANUAL_IN", "RETURN_FROM_ORDER", "POSITIVE_ADJUSTMENT", "INVENTORY_IN", "REVERSAL_IN"]);

function related<T>(value: Related<T>) { return Array.isArray(value) ? value[0] || null : value; }

export function MaintenanceMovementsPanel() {
  const [items, setItems] = useState<Movement[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [branchId, setBranchId] = useState("ALL");
  const [movementType, setMovementType] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageCount = Math.max(1, Math.ceil(total / 20));

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (branchId !== "ALL") params.set("branchId", branchId);
      if (movementType !== "ALL") params.set("movementType", movementType);
      const data = await maintenanceRequest<Payload>(`/api/manutencao/movements?${params}`, { cache: "no-store", signal }, "Falha ao carregar movimentacoes.");
      setItems(data.items || []); setBranches(data.branches || []); setTotal(data.total || 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar movimentacoes.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [branchId, debouncedSearch, movementType, page]);
  useEffect(() => { const controller = new AbortController(); const frame = requestAnimationFrame(() => void load(controller.signal)); return () => { cancelAnimationFrame(frame); controller.abort(); }; }, [load]);

  const totals = useMemo(() => items.reduce((result, item) => ({
    inbound: result.inbound + (inbound.has(item.movement_type) ? item.quantity : 0),
    outbound: result.outbound + (!inbound.has(item.movement_type) && item.movement_type !== "TRANSFER" ? item.quantity : 0),
  }), { inbound: 0, outbound: 0 }), [items]);

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-semibold">Movimentacoes de estoque</h2><p className="text-sm text-muted-foreground">Rastreabilidade de entradas, saidas, transferencias e ajustes.</p></div><Button type="button" variant="outline" size="icon" title="Atualizar movimentacoes" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></div>
    <div className="grid gap-3 sm:grid-cols-3"><Metric icon={ArrowDownToLine} label="Entradas nesta pagina" value={totals.inbound.toLocaleString("pt-BR")} /><Metric icon={ArrowUpFromLine} label="Saidas nesta pagina" value={totals.outbound.toLocaleString("pt-BR")} /><Metric icon={ArrowLeftRight} label="Registros encontrados" value={total.toLocaleString("pt-BR")} /></div>
    <div className="grid gap-2 rounded-md border bg-background p-3 lg:grid-cols-[minmax(0,1fr)_220px_240px]"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Material, documento ou motivo" /></div><Select value={branchId} onValueChange={(value) => { setBranchId(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select><Select value={movementType} onValueChange={(value) => { setMovementType(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos os tipos</SelectItem>{movementTypes.map((type) => <SelectItem key={type} value={type}>{maintenanceLabel(type)}</SelectItem>)}</SelectContent></Select></div>
    <div className="overflow-x-auto rounded-md border bg-background">{loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : items.length ? <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Material</TableHead><TableHead>Origem / destino</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo</TableHead><TableHead>Referencia</TableHead><TableHead>Responsavel</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => { const material = related(item.material); const source = related(item.from_location); const destination = related(item.to_location); const order = related(item.order); const actor = related(item.actor); return <TableRow key={item.id}><TableCell className="whitespace-nowrap">{maintenanceDate(item.occurred_at, true)}</TableCell><TableCell><Badge variant="outline">{maintenanceLabel(item.movement_type)}</Badge></TableCell><TableCell><p className="font-medium">{material?.code || "-"}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{material?.name || "Material removido"}</p></TableCell><TableCell>{source?.code || "-"} → {destination?.code || "-"}</TableCell><TableCell>{Number(item.quantity).toLocaleString("pt-BR")} {item.unit}</TableCell><TableCell>{maintenanceMoney(item.total_cost_cents)}</TableCell><TableCell><p>{order?.code || item.document_number || "-"}</p><p className="max-w-48 truncate text-xs text-muted-foreground">{item.reason}</p></TableCell><TableCell>{actor?.display_name || actor?.email || "Sistema"}</TableCell></TableRow>; })}</TableBody></Table> : <p className="p-10 text-center text-sm text-muted-foreground">Nenhuma movimentacao encontrada.</p>}</div>
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{total ? `${(page - 1) * 20 + 1}-${Math.min(page * 20, total)} de ${total}` : "0 registros"}</p><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-20 text-center text-sm">{page} de {pageCount}</span><Button type="button" variant="outline" size="icon" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-4" /></Button></div></div>
  </section>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof ArrowLeftRight; label: string; value: string }) { return <div className="rounded-md border bg-background p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{label}</div><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
