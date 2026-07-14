"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, Download, Loader2, PackageSearch, RefreshCcw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { maintenanceLabel, maintenanceMoney, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Branch = { id: string; code: string; name: string };
type Report = {
  orders: { created: number; open: number; finished: number; cancelled: number; overdue: number; totalCostCents: number; averageDowntimeMinutes: number };
  assets: { total: number; unavailable: number; critical: number };
  stock: { valueCents: number; lowStockMaterials: number; materialsWithBalance: number };
  movements: { total: number; inbound: number; outbound: number };
  preventiveDue: number;
  byStatus: Array<{ status: string; count: number }>;
  byBranch: Array<{ branchId: string | null; branchCode: string | null; branchLabel: string | null; orders: number; open: number; totalCostCents: number }>;
};
type Payload = { success: true; report: Report; branches: Branch[] };
function inputDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

export function MaintenanceReportsPanel() {
  const [from, setFrom] = useState(() => inputDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => inputDate(new Date()));
  const [branchId, setBranchId] = useState("ALL");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const start = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T23:59:59.999`);
      const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
      if (branchId !== "ALL") params.set("branchId", branchId);
      const data = await maintenanceRequest<Payload>(`/api/manutencao/reports?${params}`, { cache: "no-store", signal }, "Falha ao gerar relatorio.");
      setReport(data.report); setBranches(data.branches || []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao gerar relatorio.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [branchId, from, to]);
  useEffect(() => { const controller = new AbortController(); const frame = requestAnimationFrame(() => void load(controller.signal)); return () => { cancelAnimationFrame(frame); controller.abort(); }; }, [load]);

  function exportCsv() {
    if (!report) return;
    const rows = [["Filial", "OS no periodo", "OS abertas", "Custo total"], ...report.byBranch.map((item) => [item.branchCode || "Sem filial", String(item.orders), String(item.open), String(item.totalCostCents / 100)])];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `relatorio-manutencao-${from}-${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
    toast.success("Relatorio exportado em CSV.");
  }

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-base font-semibold">Relatorios de manutencao</h2><p className="text-sm text-muted-foreground">Custos, disponibilidade, atrasos, estoque e volume por filial.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={exportCsv} disabled={!report || loading}><Download className="size-4" />Exportar CSV</Button><Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}Atualizar</Button></div></div>
    <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="De"><Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></Field><Field label="Ate"><Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></Field><Field label="Filial"><Select value={branchId} onValueChange={setBranchId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select></Field></div>
    {loading && !report ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div> : report ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={Wrench} label="OS abertas" value={report.orders.open.toLocaleString("pt-BR")} detail={`${report.orders.overdue} atrasada(s)`} /><Metric icon={AlertTriangle} label="Preventivas vencidas" value={report.preventiveDue.toLocaleString("pt-BR")} detail={`${report.assets.critical} ativo(s) critico(s)`} /><Metric icon={Boxes} label="Ativos indisponiveis" value={report.assets.unavailable.toLocaleString("pt-BR")} detail={`${report.assets.total} ativo(s) cadastrado(s)`} /><Metric icon={PackageSearch} label="Estoque tecnico" value={maintenanceMoney(report.stock.valueCents)} detail={`${report.stock.lowStockMaterials} item(ns) em reposicao`} /><Metric icon={Wrench} label="Custo das OS" value={maintenanceMoney(report.orders.totalCostCents)} detail={`${report.orders.created} OS no periodo`} /></div><div className="grid gap-4 xl:grid-cols-2"><div className="overflow-x-auto rounded-md border bg-background"><div className="border-b p-3"><h3 className="font-medium">Por filial</h3></div><Table><TableHeader><TableRow><TableHead>Filial</TableHead><TableHead>OS</TableHead><TableHead>Abertas</TableHead><TableHead>Custo</TableHead></TableRow></TableHeader><TableBody>{report.byBranch.length ? report.byBranch.map((item) => <TableRow key={item.branchId || "NONE"}><TableCell>{item.branchCode || item.branchLabel || "Sem filial"}</TableCell><TableCell>{item.orders}</TableCell><TableCell>{item.open}</TableCell><TableCell>{maintenanceMoney(item.totalCostCents)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem OS no periodo.</TableCell></TableRow>}</TableBody></Table></div><div className="rounded-md border bg-background"><div className="border-b p-3"><h3 className="font-medium">Fila por status</h3></div><div className="grid gap-2 p-3">{report.byStatus.length ? report.byStatus.map((item) => <div key={item.status} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"><Badge variant="outline">{maintenanceLabel(item.status)}</Badge><span className="font-semibold">{item.count}</span></div>) : <p className="p-5 text-center text-sm text-muted-foreground">Sem ordens registradas.</p>}</div></div></div></> : null}
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Metric({ icon: Icon, label, value, detail }: { icon: typeof Wrench; label: string; value: string; detail: string }) { return <div className="rounded-md border bg-background p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{label}</div><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
