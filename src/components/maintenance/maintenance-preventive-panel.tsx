"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { maintenanceDate, maintenanceLabel, maintenanceRequest } from "@/components/maintenance/maintenance-api";

type Branch = { id: string; code: string; name: string; active: boolean };
type Asset = { id: string; branch_id: string; internal_code: string; name: string; asset_tag: string | null; status: string; current_meter: number | null; branch?: Branch | null };
type Material = { id: string; code: string; name: string; unit: string };
type PlanTask = { id?: string; title: string; description: string | null; expected_minutes: number | null; required: boolean; evidence_required: boolean };
type PlanMaterial = { material_id: string; planned_quantity: number; notes: string | null; material?: Material | null };
type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  branch_id: string | null;
  recurrence_value: number;
  recurrence_unit: string;
  expected_minutes: number | null;
  responsible_name: string | null;
  priority: string;
  tolerance_before: number;
  tolerance_after: number;
  auto_generate_order: boolean;
  generation_lead_days: number;
  next_due_at: string | null;
  next_meter_value: number | null;
  notify_before_days: number;
  evidence_required: boolean;
  completion_approval_required: boolean;
  active: boolean;
  last_generated_at: string | null;
  assets: Array<{ asset: Asset | null }>;
  tasks: PlanTask[];
  materials: PlanMaterial[];
};
type PreventivePayload = { success: true; plans: Plan[]; branches: Branch[]; capabilities: Record<string, boolean> };
type AssetPayload = { success: true; items: Asset[]; total: number };
type MaterialPayload = { success: true; items: Material[]; total: number };
type TaskDraft = { title: string; description: string; expectedMinutes: string; required: boolean; evidenceRequired: boolean };
type MaterialDraft = { materialId: string; quantity: string; notes: string };
type PlanForm = {
  code: string;
  name: string;
  description: string;
  branchId: string;
  recurrenceValue: string;
  recurrenceUnit: string;
  expectedMinutes: string;
  responsibleName: string;
  priority: string;
  toleranceBefore: string;
  toleranceAfter: string;
  autoGenerateOrder: boolean;
  generationLeadDays: string;
  nextDueAt: string;
  nextMeterValue: string;
  notifyBeforeDays: string;
  evidenceRequired: boolean;
  completionApprovalRequired: boolean;
  assetIds: string[];
  tasks: TaskDraft[];
  materials: MaterialDraft[];
};

const recurrenceUnits = ["DAYS", "WEEKS", "MONTHS", "YEARS", "HOURS", "KM", "CYCLES"];
const meterUnits = new Set(["HOURS", "KM", "CYCLES"]);
const emptyTask: TaskDraft = { title: "", description: "", expectedMinutes: "", required: true, evidenceRequired: false };
const emptyMaterial: MaterialDraft = { materialId: "", quantity: "", notes: "" };
const emptyForm: PlanForm = {
  code: "", name: "", description: "", branchId: "", recurrenceValue: "1", recurrenceUnit: "MONTHS",
  expectedMinutes: "", responsibleName: "", priority: "MEDIA", toleranceBefore: "0", toleranceAfter: "0",
  autoGenerateOrder: true, generationLeadDays: "7", nextDueAt: "", nextMeterValue: "", notifyBeforeDays: "7",
  evidenceRequired: false, completionApprovalRequired: false, assetIds: [], tasks: [{ ...emptyTask }], materials: [],
};

function numberValue(value: string, fallback = 0) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formFromPlan(plan: Plan): PlanForm {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    branchId: plan.branch_id || "",
    recurrenceValue: String(plan.recurrence_value).replace(".", ","),
    recurrenceUnit: plan.recurrence_unit,
    expectedMinutes: plan.expected_minutes == null ? "" : String(plan.expected_minutes),
    responsibleName: plan.responsible_name || "",
    priority: plan.priority,
    toleranceBefore: String(plan.tolerance_before),
    toleranceAfter: String(plan.tolerance_after),
    autoGenerateOrder: plan.auto_generate_order,
    generationLeadDays: String(plan.generation_lead_days),
    nextDueAt: localDateTime(plan.next_due_at),
    nextMeterValue: plan.next_meter_value == null ? "" : String(plan.next_meter_value).replace(".", ","),
    notifyBeforeDays: String(plan.notify_before_days),
    evidenceRequired: plan.evidence_required,
    completionApprovalRequired: plan.completion_approval_required,
    assetIds: plan.assets.map(({ asset }) => asset?.id).filter((id): id is string => Boolean(id)),
    tasks: plan.tasks.length ? plan.tasks.map((task) => ({ title: task.title, description: task.description || "", expectedMinutes: task.expected_minutes == null ? "" : String(task.expected_minutes), required: task.required, evidenceRequired: task.evidence_required })) : [{ ...emptyTask }],
    materials: plan.materials.map((material) => ({ materialId: material.material_id || material.material?.id || "", quantity: String(material.planned_quantity).replace(".", ","), notes: material.notes || "" })),
  };
}

export function MaintenancePreventivePanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [debouncedAssetSearch, setDebouncedAssetSearch] = useState("");
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [generateConfirm, setGenerateConfirm] = useState(false);
  const [referenceTime, setReferenceTime] = useState(0);

  const loadPlans = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await maintenanceRequest<PreventivePayload>("/api/manutencao/preventive", { cache: "no-store", signal }, "Falha ao carregar planos preventivos.");
      setPlans(data.plans || []);
      setBranches((data.branches || []).filter((branch) => branch.active));
      setCapabilities(data.capabilities || {});
      setReferenceTime(new Date().getTime());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar planos preventivos.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void loadPlans(controller.signal));
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [loadPlans]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAssetSearch(assetSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [assetSearch]);

  const loadCatalogs = useCallback(async (signal?: AbortSignal) => {
    if (!formOpen) return;
    setCatalogLoading(true);
    try {
      const assetParams = new URLSearchParams({ page: "1", pageSize: "100" });
      if (form.branchId) assetParams.set("branchId", form.branchId);
      if (debouncedAssetSearch) assetParams.set("q", debouncedAssetSearch);
      const [assetData, materialData] = await Promise.all([
        maintenanceRequest<AssetPayload>(`/api/manutencao/assets?${assetParams}`, { cache: "no-store", signal }, "Falha ao carregar ativos."),
        materials.length
          ? Promise.resolve({ success: true as const, items: materials, total: materials.length })
          : maintenanceRequest<MaterialPayload>("/api/manutencao/materials?page=1&pageSize=100&active=true", { cache: "no-store", signal }, "Falha ao carregar materiais."),
      ]);
      setAssets(assetData.items || []);
      setMaterials(materialData.items || []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar catalogos.");
    } finally {
      if (!signal?.aborted) setCatalogLoading(false);
    }
  }, [debouncedAssetSearch, form.branchId, formOpen, materials]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void loadCatalogs(controller.signal));
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [loadCatalogs]);

  function openCreate() {
    setEditingPlan(null);
    setForm({ ...emptyForm, branchId: branches[0]?.id || "", tasks: [{ ...emptyTask }], materials: [] });
    setAssetSearch("");
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan);
    setForm(formFromPlan(plan));
    setAssetSearch("");
    setAdvancedOpen(true);
    setSelected(null);
    setFormOpen(true);
  }

  function toggleAsset(assetId: string, checked: boolean) {
    setForm((current) => ({ ...current, assetIds: checked ? [...new Set([...current.assetIds, assetId])] : current.assetIds.filter((id) => id !== assetId) }));
  }

  async function savePlan() {
    if (!form.branchId || !form.code.trim() || !form.name.trim() || !form.description.trim()) { toast.error("Informe filial, codigo, nome e descricao."); return; }
    if (!form.assetIds.length) { toast.error("Vincule pelo menos um ativo."); return; }
    const tasks = form.tasks.filter((task) => task.title.trim());
    const planMaterials = form.materials.filter((material) => material.materialId && numberValue(material.quantity) > 0);
    setSaving(true);
    try {
      await maintenanceRequest(editingPlan ? `/api/manutencao/preventive/${editingPlan.id}` : "/api/manutencao/preventive", {
        method: editingPlan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(), name: form.name.trim(), description: form.description.trim(), branchId: form.branchId,
          checklistTemplateId: null, recurrenceValue: numberValue(form.recurrenceValue, 1), recurrenceUnit: form.recurrenceUnit,
          expectedMinutes: form.expectedMinutes ? Math.round(numberValue(form.expectedMinutes)) : null, responsibleUserId: null,
          responsibleName: form.responsibleName.trim() || null, serviceProviderId: null, priority: form.priority,
          toleranceBefore: numberValue(form.toleranceBefore), toleranceAfter: numberValue(form.toleranceAfter), autoGenerateOrder: form.autoGenerateOrder,
          generationLeadDays: Math.round(numberValue(form.generationLeadDays)), nextDueAt: meterUnits.has(form.recurrenceUnit) ? null : form.nextDueAt ? new Date(form.nextDueAt).toISOString() : null,
          nextMeterValue: meterUnits.has(form.recurrenceUnit) && form.nextMeterValue ? numberValue(form.nextMeterValue) : null,
          notifyBeforeDays: Math.round(numberValue(form.notifyBeforeDays)), evidenceRequired: form.evidenceRequired,
          completionApprovalRequired: form.completionApprovalRequired, ...(editingPlan ? { active: editingPlan.active } : {}), assetIds: form.assetIds,
          tasks: tasks.map((task) => ({ title: task.title.trim(), description: task.description.trim() || null, expectedMinutes: Math.round(numberValue(task.expectedMinutes)), required: task.required, evidenceRequired: task.evidenceRequired })),
          materials: planMaterials.map((material) => ({ materialId: material.materialId, quantity: numberValue(material.quantity), notes: material.notes.trim() || null })),
        }),
      }, editingPlan ? "Falha ao atualizar plano preventivo." : "Falha ao cadastrar plano preventivo.");
      toast.success(editingPlan ? "Plano preventivo atualizado." : "Plano preventivo cadastrado.");
      setFormOpen(false);
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar plano preventivo.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePlanActive(plan: Plan) {
    if (saving) return;
    setSaving(true);
    try {
      await maintenanceRequest(`/api/manutencao/preventive/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !plan.active }) }, "Falha ao alterar status do plano.");
      toast.success(plan.active ? "Plano preventivo desativado." : "Plano preventivo ativado.");
      setSelected(null);
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar status do plano.");
    } finally {
      setSaving(false);
    }
  }

  async function generateOrders() {
    setSaving(true);
    try {
      const data = await maintenanceRequest<{ success: true; orders: unknown[] }>("/api/manutencao/preventive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "GENERATE" }) }, "Falha ao gerar preventivas.");
      toast.success(data.orders.length ? `${data.orders.length} OS preventiva(s) gerada(s).` : "Nenhum plano esta vencido para geracao.");
      setGenerateConfirm(false);
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar preventivas.");
    } finally {
      setSaving(false);
    }
  }

  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const selectedAssetIds = new Set(form.assetIds);

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-base font-semibold">Planos preventivos</h2><p className="text-sm text-muted-foreground">Recorrencias por data ou medidor com geracao idempotente de OS.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="icon" title="Atualizar planos" onClick={() => void loadPlans()} disabled={loading}><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /><span className="sr-only">Atualizar planos</span></Button>{capabilities.MANAGE_PREVENTIVE_PLANS !== false ? <><Button type="button" variant="outline" onClick={() => setGenerateConfirm(true)}><Sparkles className="size-4" />Gerar OS vencidas</Button><Button type="button" onClick={openCreate}><Plus className="size-4" />Novo plano</Button></> : null}</div></div>

      <div className="overflow-hidden rounded-md border bg-background">{loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : plans.length ? <Table><TableHeader><TableRow><TableHead>Plano</TableHead><TableHead>Filial</TableHead><TableHead>Recorrencia</TableHead><TableHead>Ativos</TableHead><TableHead>Proxima execucao</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{plans.map((plan) => { const due = Boolean(referenceTime && plan.next_due_at && new Date(plan.next_due_at).getTime() <= referenceTime); return <TableRow key={plan.id} className="cursor-pointer" onClick={() => setSelected(plan)}><TableCell><p className="font-medium">{plan.code} - {plan.name}</p><p className="max-w-80 truncate text-xs text-muted-foreground">{plan.description}</p></TableCell><TableCell>{plan.branch_id ? `${branchById.get(plan.branch_id)?.code || "-"} - ${branchById.get(plan.branch_id)?.name || "Filial"}` : "Todas"}</TableCell><TableCell>{plan.recurrence_value.toLocaleString("pt-BR")} {maintenanceLabel(plan.recurrence_unit)}</TableCell><TableCell>{plan.assets.length}</TableCell><TableCell>{meterUnits.has(plan.recurrence_unit) ? `${Number(plan.next_meter_value || 0).toLocaleString("pt-BR")} ${maintenanceLabel(plan.recurrence_unit)}` : maintenanceDate(plan.next_due_at)}</TableCell><TableCell>{!plan.active ? <Badge variant="outline">Inativo</Badge> : due ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline">Programado</Badge>}</TableCell></TableRow>; })}</TableBody></Table> : <div className="p-10 text-center text-sm text-muted-foreground">Nenhum plano preventivo cadastrado.</div>}</div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{editingPlan ? `Editar ${editingPlan.code}` : "Novo plano preventivo"}</DialogTitle><DialogDescription>Defina a recorrencia, os ativos e o roteiro que sera levado para cada OS.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Codigo" required><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></Field><Field label="Nome" required className="sm:col-span-2"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Filial" required><Select value={form.branchId} onValueChange={(value) => setForm((current) => ({ ...current, branchId: value, assetIds: [] }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Recorrencia" required><Input inputMode="decimal" value={form.recurrenceValue} onChange={(event) => setForm((current) => ({ ...current, recurrenceValue: event.target.value }))} /></Field><Field label="Unidade" required><Select value={form.recurrenceUnit} onValueChange={(value) => setForm((current) => ({ ...current, recurrenceUnit: value }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{recurrenceUnits.map((unit) => <SelectItem key={unit} value={unit}>{maintenanceLabel(unit)}</SelectItem>)}</SelectContent></Select></Field>{meterUnits.has(form.recurrenceUnit) ? <Field label="Proximo medidor" required><Input inputMode="decimal" value={form.nextMeterValue} onChange={(event) => setForm((current) => ({ ...current, nextMeterValue: event.target.value }))} /></Field> : <Field label="Proxima execucao" required><Input type="datetime-local" value={form.nextDueAt} onChange={(event) => setForm((current) => ({ ...current, nextDueAt: event.target.value }))} /></Field>}<Field label="Prioridade"><Select value={form.priority} onValueChange={(value) => setForm((current) => ({ ...current, priority: value }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["CRITICA", "ALTA", "MEDIA", "BAIXA"].map((priority) => <SelectItem key={priority} value={priority}>{maintenanceLabel(priority)}</SelectItem>)}</SelectContent></Select></Field><Field label="Tempo previsto (min)"><Input inputMode="numeric" value={form.expectedMinutes} onChange={(event) => setForm((current) => ({ ...current, expectedMinutes: event.target.value }))} /></Field><Field label="Responsavel"><Input value={form.responsibleName} onChange={(event) => setForm((current) => ({ ...current, responsibleName: event.target.value }))} /></Field><Field label="Descricao" required className="sm:col-span-2 lg:col-span-3"><Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field></div>

        <div className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="font-medium">Equipamentos vinculados</h3><p className="text-xs text-muted-foreground">{form.assetIds.length} selecionado(s); a pesquisa consulta o servidor.</p></div>{catalogLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}</div><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Buscar codigo, patrimonio, nome, modelo ou local" /></div><div className="grid max-h-56 gap-px overflow-y-auto rounded-md border bg-border sm:grid-cols-2">{assets.length ? assets.map((asset) => <label key={asset.id} className="flex cursor-pointer items-start gap-3 bg-background p-3 hover:bg-muted/40"><Checkbox checked={selectedAssetIds.has(asset.id)} onCheckedChange={(checked) => toggleAsset(asset.id, checked === true)} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{asset.internal_code} - {asset.name}</span><span className="block truncate text-xs text-muted-foreground">{asset.asset_tag || maintenanceLabel(asset.status)} / medidor {Number(asset.current_meter || 0).toLocaleString("pt-BR")}</span></span></label>) : <p className="col-span-full bg-background p-5 text-center text-sm text-muted-foreground">Nenhum ativo encontrado.</p>}</div></div>

        <div className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-medium">Checklist da preventiva</h3><p className="text-xs text-muted-foreground">Itens executados e registrados na OS.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, tasks: [...current.tasks, { ...emptyTask }] }))}><Plus className="size-4" />Item</Button></div>{form.tasks.map((task, index) => <div key={`task-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_110px_auto]"><div className="grid gap-2"><Input value={task.title} onChange={(event) => setForm((current) => ({ ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} placeholder="Atividade" /><Input value={task.description} onChange={(event) => setForm((current) => ({ ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} placeholder="Orientacao para o tecnico" /></div><Input inputMode="numeric" value={task.expectedMinutes} onChange={(event) => setForm((current) => ({ ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? { ...item, expectedMinutes: event.target.value } : item) }))} placeholder="Minutos" /><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs"><Checkbox checked={task.evidenceRequired} onCheckedChange={(checked) => setForm((current) => ({ ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? { ...item, evidenceRequired: checked === true } : item) }))} />Foto</label><Button type="button" size="icon" variant="ghost" title="Remover item" onClick={() => setForm((current) => ({ ...current, tasks: current.tasks.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 className="size-4" /></Button></div></div>)}</div>

        <button type="button" className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium" onClick={() => setAdvancedOpen((current) => !current)}><span>Materiais previstos e regras de geracao</span>{advancedOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>{advancedOpen ? <div className="space-y-4 rounded-md border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">Materiais previstos</h3><Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, materials: [...current.materials, { ...emptyMaterial }] }))}><Plus className="size-4" />Material</Button></div>{form.materials.map((material, index) => <div key={`material-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_40px]"><Select value={material.materialId} onValueChange={(value) => setForm((current) => ({ ...current, materials: current.materials.map((item, itemIndex) => itemIndex === index ? { ...item, materialId: value } : item) }))}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione o material" /></SelectTrigger><SelectContent>{materials.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} - {item.name}</SelectItem>)}</SelectContent></Select><Input inputMode="decimal" value={material.quantity} onChange={(event) => setForm((current) => ({ ...current, materials: current.materials.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item) }))} placeholder="Qtd." /><Input value={material.notes} onChange={(event) => setForm((current) => ({ ...current, materials: current.materials.map((item, itemIndex) => itemIndex === index ? { ...item, notes: event.target.value } : item) }))} placeholder="Observacao" /><Button type="button" size="icon" variant="ghost" title="Remover material" onClick={() => setForm((current) => ({ ...current, materials: current.materials.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 className="size-4" /></Button></div>)}<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Antecedencia para gerar (dias)"><Input inputMode="numeric" value={form.generationLeadDays} onChange={(event) => setForm((current) => ({ ...current, generationLeadDays: event.target.value }))} /></Field><Field label="Avisar antes (dias)"><Input inputMode="numeric" value={form.notifyBeforeDays} onChange={(event) => setForm((current) => ({ ...current, notifyBeforeDays: event.target.value }))} /></Field><Field label="Tolerancia antes"><Input inputMode="decimal" value={form.toleranceBefore} onChange={(event) => setForm((current) => ({ ...current, toleranceBefore: event.target.value }))} /></Field><Field label="Tolerancia depois"><Input inputMode="decimal" value={form.toleranceAfter} onChange={(event) => setForm((current) => ({ ...current, toleranceAfter: event.target.value }))} /></Field></div><div className="flex flex-wrap gap-5"><Toggle checked={form.autoGenerateOrder} label="Gerar OS automaticamente" onChange={(checked) => setForm((current) => ({ ...current, autoGenerateOrder: checked }))} /><Toggle checked={form.evidenceRequired} label="Exigir evidencias" onChange={(checked) => setForm((current) => ({ ...current, evidenceRequired: checked }))} /><Toggle checked={form.completionApprovalRequired} label="Exigir aprovacao final" onChange={(checked) => setForm((current) => ({ ...current, completionApprovalRequired: checked }))} /></div></div> : null}

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t bg-background px-6 py-4"><Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void savePlan()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}{editingPlan ? "Salvar alteracoes" : "Cadastrar plano"}</Button></DialogFooter></DialogContent></Dialog>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-3xl">
          <SheetHeader><SheetTitle>{selected ? `${selected.code} - ${selected.name}` : "Plano preventivo"}</SheetTitle><SheetDescription>{selected?.description}</SheetDescription></SheetHeader>
          {selected ? <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3"><Detail label="Recorrencia" value={`${selected.recurrence_value.toLocaleString("pt-BR")} ${maintenanceLabel(selected.recurrence_unit)}`} /><Detail label="Proxima execucao" value={meterUnits.has(selected.recurrence_unit) ? `${Number(selected.next_meter_value || 0).toLocaleString("pt-BR")} ${maintenanceLabel(selected.recurrence_unit)}` : maintenanceDate(selected.next_due_at)} /><Detail label="Prioridade" value={maintenanceLabel(selected.priority)} /><Detail label="Responsavel" value={selected.responsible_name || "Nao definido"} /><Detail label="Ultima geracao" value={maintenanceDate(selected.last_generated_at, true)} /><Detail label="Aprovacao final" value={selected.completion_approval_required ? "Obrigatoria" : "Nao exigida"} /></div>
            <section><h3 className="mb-2 font-medium">Equipamentos</h3><div className="rounded-md border">{selected.assets.map(({ asset }) => asset ? <div key={asset.id} className="flex items-center justify-between gap-3 border-b p-3 last:border-0"><div><p className="font-medium">{asset.internal_code} - {asset.name}</p><p className="text-xs text-muted-foreground">{asset.asset_tag || maintenanceLabel(asset.status)}</p></div><Badge variant="outline">{maintenanceLabel(asset.status)}</Badge></div> : null)}</div></section>
            <section><h3 className="mb-2 font-medium">Checklist</h3><div className="rounded-md border">{selected.tasks.length ? selected.tasks.map((task, index) => <div key={task.id || index} className="flex gap-3 border-b p-3 last:border-0"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">{index + 1}</span><div><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.description || "Sem orientacao adicional"}{task.evidence_required ? " / evidencia obrigatoria" : ""}</p></div></div>) : <p className="p-4 text-sm text-muted-foreground">Sem checklist.</p>}</div></section>
            <section><h3 className="mb-2 font-medium">Materiais previstos</h3><div className="rounded-md border">{selected.materials.length ? selected.materials.map((material) => <div key={material.material?.id || material.notes || material.planned_quantity} className="flex items-center justify-between gap-3 border-b p-3 last:border-0"><span>{material.material ? `${material.material.code} - ${material.material.name}` : "Material"}</span><span className="font-medium">{material.planned_quantity.toLocaleString("pt-BR")} {material.material?.unit || ""}</span></div>) : <p className="p-4 text-sm text-muted-foreground">Sem materiais previstos.</p>}</div></section>
          </div> : null}
          {selected && capabilities.MANAGE_PREVENTIVE_PLANS ? <SheetFooter className="border-t"><Button type="button" variant="outline" onClick={() => openEdit(selected)} disabled={saving}><Pencil className="size-4" />Editar</Button><Button type="button" variant={selected.active ? "destructive" : "default"} onClick={() => void togglePlanActive(selected)} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}{selected.active ? "Desativar" : "Ativar"}</Button></SheetFooter> : null}
        </SheetContent>
      </Sheet>

      <Dialog open={generateConfirm} onOpenChange={setGenerateConfirm}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Gerar OS preventivas</DialogTitle><DialogDescription>O processamento cria somente as OS de planos vencidos ainda nao geradas. Repetir a acao nao duplica ordens.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setGenerateConfirm(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void generateOrders()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Gerar agora</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>;
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />{checked ? <Check className="size-3 text-emerald-700" /> : null}{label}</label>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>;
}
