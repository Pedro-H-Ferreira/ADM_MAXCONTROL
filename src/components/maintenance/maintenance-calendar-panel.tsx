"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, RefreshCcw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { maintenanceLabel, maintenanceRequest } from "@/components/maintenance/maintenance-api";
import { cn } from "@/lib/utils";

type Branch = { id: string; code: string; name: string };
type Entry = {
  id: string; type: "ORDER" | "PREVENTIVE"; date: string; code: string; title?: string; name?: string;
  status?: string; priority: string; branch_id: string | null;
};
type Payload = { success: true; entries: Entry[]; branches: Branch[] };

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
function dateKey(value: Date | string) { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function monthLabel(value: Date) { return value.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
function monthRange(value: Date) {
  const first = new Date(value.getFullYear(), value.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - first.getDay()); start.setHours(0, 0, 0, 0);
  const last = new Date(value.getFullYear(), value.getMonth() + 1, 0);
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay())); end.setHours(23, 59, 59, 999);
  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(new Date(cursor));
  return { start, end, days };
}

export function MaintenanceCalendarPanel() {
  const [month, setMonth] = useState(() => new Date());
  const [branchId, setBranchId] = useState("ALL");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => monthRange(month), [month]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.start.toISOString(), to: range.end.toISOString() });
      if (branchId !== "ALL") params.set("branchId", branchId);
      const data = await maintenanceRequest<Payload>(`/api/manutencao/calendar?${params}`, { cache: "no-store", signal }, "Falha ao carregar calendario.");
      setEntries(data.entries || []); setBranches(data.branches || []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar calendario.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [branchId, range.end, range.start]);
  useEffect(() => { const controller = new AbortController(); const frame = requestAnimationFrame(() => void load(controller.signal)); return () => { cancelAnimationFrame(frame); controller.abort(); }; }, [load]);
  const byDay = useMemo(() => { const grouped = new Map<string, Entry[]>(); for (const entry of entries) grouped.set(dateKey(entry.date), [...(grouped.get(dateKey(entry.date)) || []), entry]); return grouped; }, [entries]);
  const today = dateKey(new Date());

  function moveMonth(offset: number) { setMonth((value) => new Date(value.getFullYear(), value.getMonth() + offset, 1)); }

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-base font-semibold">Calendario de manutencao</h2><p className="text-sm text-muted-foreground">Prazos de OS e proximas execucoes preventivas por filial.</p></div><div className="flex flex-wrap gap-2"><Select value={branchId} onValueChange={setBranchId}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="icon" title="Atualizar calendario" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></div></div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" title="Mes anterior" onClick={() => moveMonth(-1)}><ChevronLeft className="size-4" /></Button><Button type="button" variant="outline" onClick={() => setMonth(new Date())}>Hoje</Button><Button type="button" variant="outline" size="icon" title="Proximo mes" onClick={() => moveMonth(1)}><ChevronRight className="size-4" /></Button></div><h3 className="text-base font-semibold capitalize">{monthLabel(month)}</h3><div className="flex gap-2 text-xs"><Badge variant="outline"><Wrench className="size-3" />OS</Badge><Badge variant="outline"><CalendarClock className="size-3" />Preventiva</Badge></div></div>
    {loading && !entries.length ? <div className="grid grid-cols-7 gap-1">{Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div> : <div className="overflow-x-auto rounded-md border bg-border"><div className="grid min-w-[840px] grid-cols-7 gap-px">{weekDays.map((day) => <div key={day} className="bg-muted px-2 py-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}{range.days.map((day) => { const key = dateKey(day); const dayEntries = byDay.get(key) || []; const currentMonth = day.getMonth() === month.getMonth(); return <div key={key} className={cn("min-h-32 bg-background p-2", !currentMonth && "bg-muted/30 text-muted-foreground")}><div className={cn("mb-2 flex size-7 items-center justify-center rounded-full text-xs", key === today && "bg-primary text-primary-foreground")}>{day.getDate()}</div><div className="space-y-1">{dayEntries.slice(0, 4).map((entry) => <Link key={`${entry.type}-${entry.id}`} href={entry.type === "ORDER" ? `/manutencao?view=orders&q=${encodeURIComponent(entry.code)}` : "/manutencao?view=preventive"} className={cn("block rounded-sm border-l-2 px-2 py-1 text-xs hover:bg-muted", entry.type === "ORDER" ? "border-l-sky-600" : "border-l-emerald-600")}><span className="block truncate font-medium">{entry.code} - {entry.title || entry.name}</span><span className="block truncate text-muted-foreground">{maintenanceLabel(entry.status || entry.priority)}</span></Link>)}{dayEntries.length > 4 ? <p className="text-xs text-muted-foreground">+{dayEntries.length - 4} item(ns)</p> : null}</div></div>; })}</div></div>}
  </section>;
}
