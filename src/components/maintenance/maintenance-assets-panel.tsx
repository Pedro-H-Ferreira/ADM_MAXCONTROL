"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { maintenanceDate, maintenanceLabel, maintenanceMoney, maintenanceRequest } from "@/components/maintenance/maintenance-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Branch = { id: string; code: string; name: string; active: boolean };
type Category = { id: string; code: string; name: string };
type Supplier = { id: string; legalName: string; displayName: string | null; taxId: string | null; status: string };
type AssetDocument = { id: string; document_type: string; name: string; bucket: string; path: string; mime_type: string | null; size_bytes: number | null; expires_at: string | null; created_at: string; signedUrl?: string | null };
type Asset = {
  id: string;
  branch_id: string;
  internal_code: string;
  asset_tag: string | null;
  name: string;
  category_id: string | null;
  subcategory: string | null;
  category?: Category | null;
  branch?: Branch | null;
  supplier?: { id: string; nome_fantasia: string | null; razao_social: string; cnpj: string | null } | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  description: string | null;
  area: string | null;
  physical_location: string | null;
  cost_center_code: string | null;
  cost_center_label: string | null;
  responsible_name: string | null;
  status: string;
  criticality: string;
  meter_type: string | null;
  current_meter: number | null;
  acquisition_value_cents: number;
  acquired_at: string | null;
  supplier_id: string | null;
  invoice_number: string | null;
  commissioned_at: string | null;
  warranty_months: number | null;
  warranty_ends_at: string | null;
  useful_life_months: number | null;
  qr_code: string | null;
  barcode: string | null;
  last_maintenance_at: string | null;
  next_maintenance_at: string | null;
  notes: string | null;
  updated_at: string;
};

type AssetDetail = Asset & {
  events: Array<{ id: string; label: string; event_type: string; created_at: string }>;
  readings: Array<{ id: string; meter_type: string; reading: number; read_at: string }>;
  orders: Array<{ id: string; code: string; title: string; status: string; created_at: string }>;
  documents: AssetDocument[];
};

type AssetsPayload = {
  success: true;
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
  branches: Branch[];
  categories: Category[];
  capabilities: Record<string, boolean>;
};

type AssetForm = {
  branchId: string;
  internalCode: string;
  assetTag: string;
  name: string;
  categoryId: string;
  subcategory: string;
  brand: string;
  model: string;
  serialNumber: string;
  description: string;
  area: string;
  physicalLocation: string;
  costCenterCode: string;
  costCenterLabel: string;
  responsibleName: string;
  status: string;
  criticality: string;
  acquiredAt: string;
  acquisitionValue: string;
  supplierId: string;
  invoiceNumber: string;
  commissionedAt: string;
  warrantyMonths: string;
  warrantyEndsAt: string;
  usefulLifeMonths: string;
  qrCode: string;
  barcode: string;
  meterType: string;
  notes: string;
};

const emptyForm: AssetForm = {
  branchId: "", internalCode: "", assetTag: "", name: "", categoryId: "", subcategory: "", brand: "", model: "",
  serialNumber: "", description: "", area: "", physicalLocation: "", costCenterCode: "", costCenterLabel: "", responsibleName: "", status: "ATIVO", criticality: "MEDIA",
  acquiredAt: "", acquisitionValue: "", supplierId: "", invoiceNumber: "", commissionedAt: "", warrantyMonths: "", warrantyEndsAt: "", usefulLifeMonths: "", qrCode: "", barcode: "", meterType: "", notes: "",
};

const assetStatuses = ["ATIVO", "EM_MANUTENCAO", "PARADO", "RESERVA", "EM_GARANTIA", "AGUARDANDO_PECA", "AGUARDANDO_TERCEIRO", "BAIXADO"];
const criticalities = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];

function cents(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized || 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function assetForm(asset?: Asset | null, fallbackBranchId = ""): AssetForm {
  if (!asset) return { ...emptyForm, branchId: fallbackBranchId };
  return {
    branchId: asset.branch_id, internalCode: asset.internal_code, assetTag: asset.asset_tag || "", name: asset.name,
    categoryId: asset.category_id || "", subcategory: asset.subcategory || "", brand: asset.brand || "", model: asset.model || "", serialNumber: asset.serial_number || "", description: asset.description || "",
    area: asset.area || "", physicalLocation: asset.physical_location || "", costCenterCode: asset.cost_center_code || "", costCenterLabel: asset.cost_center_label || "", responsibleName: asset.responsible_name || "",
    status: asset.status, criticality: asset.criticality, acquiredAt: asset.acquired_at?.slice(0, 10) || "",
    acquisitionValue: asset.acquisition_value_cents ? String(asset.acquisition_value_cents / 100).replace(".", ",") : "", supplierId: asset.supplier_id || "", invoiceNumber: asset.invoice_number || "",
    commissionedAt: asset.commissioned_at?.slice(0, 10) || "", warrantyMonths: asset.warranty_months == null ? "" : String(asset.warranty_months), warrantyEndsAt: asset.warranty_ends_at?.slice(0, 10) || "", usefulLifeMonths: asset.useful_life_months == null ? "" : String(asset.useful_life_months),
    qrCode: asset.qr_code || "", barcode: asset.barcode || "", meterType: asset.meter_type || "", notes: asset.notes || "",
  };
}

export function MaintenanceAssetsPanel() {
  const [items, setItems] = useState<Asset[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [branchId, setBranchId] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [criticality, setCriticality] = useState("ALL");
  const [categoryId, setCategoryId] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AssetForm>(emptyForm);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentType, setDocumentType] = useState("OTHER");
  const [action, setAction] = useState<"TRANSFER" | "METER" | "RETIRE" | null>(null);
  const [actionForm, setActionForm] = useState({ branchId: "", area: "", physicalLocation: "", reason: "", meterType: "HOURS", reading: "", notes: "" });
  const pageCount = Math.max(1, Math.ceil(total / 20));

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadAssets = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (branchId !== "ALL") params.set("branchId", branchId);
      if (status !== "ALL") params.set("status", status);
      if (criticality !== "ALL") params.set("criticality", criticality);
      if (categoryId !== "ALL") params.set("categoryId", categoryId);
      const data = await maintenanceRequest<AssetsPayload>(`/api/manutencao/assets?${params}`, { cache: "no-store", signal }, "Falha ao carregar ativos.");
      setItems(data.items || []);
      setBranches((data.branches || []).filter((branch) => branch.active));
      setCategories(data.categories || []);
      setCapabilities(data.capabilities || {});
      setTotal(data.total || 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar ativos.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [branchId, categoryId, criticality, debouncedSearch, page, status]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void loadAssets(controller.signal));
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadAssets]);

  function openForm(asset?: Asset) {
    setEditing(asset || null);
    setForm(assetForm(asset, branches[0]?.id || ""));
    setFormOpen(true);
  }

  async function saveAsset() {
    if (!form.branchId || !form.internalCode.trim() || !form.name.trim()) {
      toast.error("Informe filial, codigo e nome do ativo.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        branchId: form.branchId, internalCode: form.internalCode.trim(), assetTag: form.assetTag.trim() || null,
        name: form.name.trim(), categoryId: form.categoryId || null, subcategory: form.subcategory.trim() || null, brand: form.brand.trim() || null, model: form.model.trim() || null,
        serialNumber: form.serialNumber.trim() || null, description: form.description.trim() || null, area: form.area.trim() || null, physicalLocation: form.physicalLocation.trim() || null,
        costCenterCode: form.costCenterCode.trim() || null, costCenterLabel: form.costCenterLabel.trim() || null,
        responsibleName: form.responsibleName.trim() || null, status: form.status, criticality: form.criticality,
        acquiredAt: form.acquiredAt || null, acquisitionValueCents: cents(form.acquisitionValue), supplierId: form.supplierId || null,
        invoiceNumber: form.invoiceNumber.trim() || null, commissionedAt: form.commissionedAt || null,
        warrantyMonths: form.warrantyMonths ? Math.max(0, Math.round(Number(form.warrantyMonths))) : null,
        warrantyEndsAt: form.warrantyEndsAt || null, usefulLifeMonths: form.usefulLifeMonths ? Math.max(0, Math.round(Number(form.usefulLifeMonths))) : null,
        qrCode: form.qrCode.trim() || null, barcode: form.barcode.trim() || null, meterType: form.meterType || null,
        notes: form.notes.trim() || null,
      };
      await maintenanceRequest(
        editing ? `/api/manutencao/assets/${editing.id}` : "/api/manutencao/assets",
        { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        editing ? "Falha ao atualizar ativo." : "Falha ao cadastrar ativo."
      );
      toast.success(editing ? "Ativo atualizado." : "Ativo cadastrado.");
      setFormOpen(false);
      await loadAssets();
      if (editing && detail?.id === editing.id) await openDetail(editing.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar ativo.");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const data = await maintenanceRequest<{ success: true; asset: AssetDetail }>(`/api/manutencao/assets/${id}`, { cache: "no-store" }, "Falha ao consultar ativo.");
      const documentData = await maintenanceRequest<{ success: true; documents: AssetDocument[] }>(`/api/manutencao/assets/${id}/documents`, { cache: "no-store" }, "Falha ao consultar documentos.");
      setDetail({ ...data.asset, documents: documentData.documents || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao consultar ativo.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function uploadDocument(file: File) {
    if (!detail || documentUploading) return;
    setDocumentUploading(true);
    try {
      const prepared = await maintenanceRequest<{ success: true; upload: { bucket: string; path: string; token: string; mimeType: string } }>(`/api/manutencao/assets/${detail.id}/documents/upload-url`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size }),
      }, "Falha ao preparar documento.");
      const { error } = await getSupabaseBrowserClient().storage.from(prepared.upload.bucket).uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, { contentType: prepared.upload.mimeType, upsert: false });
      if (error) throw error;
      await maintenanceRequest(`/api/manutencao/assets/${detail.id}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentType, name: file.name, bucket: prepared.upload.bucket, path: prepared.upload.path, mimeType: prepared.upload.mimeType, sizeBytes: file.size, expiresAt: null }),
      }, "Falha ao registrar documento.");
      toast.success("Documento anexado ao ativo.");
      await openDetail(detail.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao anexar documento.");
    } finally {
      setDocumentUploading(false);
    }
  }

  async function removeDocument(document: AssetDocument) {
    if (!detail || saving || !window.confirm(`Remover o documento ${document.name}?`)) return;
    setSaving(true);
    try {
      await maintenanceRequest(`/api/manutencao/assets/${detail.id}/documents/${document.id}`, { method: "DELETE" }, "Falha ao remover documento.");
      toast.success("Documento removido.");
      await openDetail(detail.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover documento.");
    } finally {
      setSaving(false);
    }
  }

  async function exportAssets() {
    try {
      const rows: Asset[] = [];
      for (let exportPage = 1; ; exportPage += 1) {
        const params = new URLSearchParams({ page: String(exportPage), pageSize: "100" });
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (branchId !== "ALL") params.set("branchId", branchId);
        if (status !== "ALL") params.set("status", status);
        if (criticality !== "ALL") params.set("criticality", criticality);
        if (categoryId !== "ALL") params.set("categoryId", categoryId);
        const data = await maintenanceRequest<AssetsPayload>(`/api/manutencao/assets?${params}`, { cache: "no-store" }, "Falha ao exportar ativos.");
        rows.push(...(data.items || []));
        if (rows.length >= data.total || !data.items.length) break;
      }
      const header = ["Codigo", "Patrimonio", "Nome", "Filial", "Area", "Local", "Categoria", "Criticidade", "Status", "Marca", "Modelo", "Serie", "Centro de custo", "Fornecedor", "Nota fiscal", "Valor"];
      const values = rows.map((asset) => [asset.internal_code, asset.asset_tag || "", asset.name, asset.branch?.code || "", asset.area || "", asset.physical_location || "", asset.category?.name || "", maintenanceLabel(asset.criticality), maintenanceLabel(asset.status), asset.brand || "", asset.model || "", asset.serial_number || "", asset.cost_center_code || asset.cost_center_label || "", asset.supplier?.razao_social || asset.supplier?.nome_fantasia || "", asset.invoice_number || "", String((asset.acquisition_value_cents || 0) / 100)]);
      const csv = [header, ...values].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ativos-manutencao.csv"; anchor.click(); URL.revokeObjectURL(url);
      toast.success(`${rows.length} ativo(s) exportado(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar ativos.");
    }
  }

  function openAction(next: "TRANSFER" | "METER" | "RETIRE") {
    setActionForm({ branchId: "", area: detail?.area || "", physicalLocation: detail?.physical_location || "", reason: "", meterType: detail?.meter_type || "HOURS", reading: "", notes: "" });
    setAction(next);
  }

  async function runAction() {
    if (!detail || !action) return;
    const payload = action === "TRANSFER"
      ? { action, branchId: actionForm.branchId, area: actionForm.area || null, physicalLocation: actionForm.physicalLocation || null, responsibleUserId: null, reason: actionForm.reason }
      : action === "METER"
        ? { action, meterType: actionForm.meterType, reading: Number(actionForm.reading.replace(",", ".")), readAt: null, notes: actionForm.notes || null }
        : { action, reason: actionForm.reason };
    setSaving(true);
    try {
      await maintenanceRequest(`/api/manutencao/assets/${detail.id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, "Falha ao executar acao.");
      toast.success(action === "TRANSFER" ? "Ativo transferido." : action === "METER" ? "Leitura registrada." : "Ativo baixado.");
      setAction(null);
      await Promise.all([openDetail(detail.id), loadAssets()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao executar acao.");
    } finally {
      setSaving(false);
    }
  }

  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId), [branchId, branches]);

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold">Ativos e equipamentos</h2>
          <p className="text-sm text-muted-foreground">{total} ativo(s){selectedBranch ? ` em ${selectedBranch.name}` : " nas filiais liberadas"}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void exportAssets()} disabled={loading}><Download className="size-4" />Exportar</Button>
          <Button type="button" variant="outline" size="icon" onClick={() => void loadAssets()} disabled={loading} title="Atualizar ativos"><RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
          {capabilities.MANAGE_ASSETS !== false ? <Button type="button" onClick={() => openForm()}><Plus className="size-4" />Novo ativo</Button> : null}
        </div>
      </div>

      <div className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_200px_190px_190px_220px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar codigo, patrimonio, serie, modelo ou local" /></div>
        <Select value={branchId} onValueChange={(value) => { setBranchId(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos os status</SelectItem>{assetStatuses.map((item) => <SelectItem key={item} value={item}>{maintenanceLabel(item)}</SelectItem>)}</SelectContent></Select>
        <Select value={criticality} onValueChange={(value) => { setCriticality(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as criticidades</SelectItem>{criticalities.map((item) => <SelectItem key={item} value={item}>{maintenanceLabel(item)}</SelectItem>)}</SelectContent></Select>
        <Select value={categoryId} onValueChange={(value) => { setCategoryId(value); setPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as categorias</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.code} - {category.name}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="overflow-hidden rounded-md border bg-background">
        {loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div> : items.length ? (
          <Table><TableHeader><TableRow><TableHead>Ativo</TableHead><TableHead>Filial / local</TableHead><TableHead>Criticidade</TableHead><TableHead>Status</TableHead><TableHead>Medidor</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>
            {items.map((asset) => <TableRow key={asset.id} className="cursor-pointer" onClick={() => void openDetail(asset.id)}><TableCell><div className="max-w-72"><p className="truncate font-medium">{asset.internal_code} - {asset.name}</p><p className="truncate text-xs text-muted-foreground">{[asset.asset_tag, asset.brand, asset.model, asset.serial_number].filter(Boolean).join(" / ") || "Sem identificacao complementar"}</p></div></TableCell><TableCell><p>{asset.branch?.code || "-"}</p><p className="max-w-52 truncate text-xs text-muted-foreground">{asset.area || "-"} / {asset.physical_location || "-"}</p></TableCell><TableCell><Badge variant="outline">{maintenanceLabel(asset.criticality)}</Badge></TableCell><TableCell><Badge variant={asset.status === "ATIVO" ? "secondary" : "outline"}>{maintenanceLabel(asset.status)}</Badge></TableCell><TableCell>{asset.meter_type ? `${Number(asset.current_meter || 0).toLocaleString("pt-BR")} ${asset.meter_type}` : "-"}</TableCell><TableCell><Button type="button" variant="ghost" size="icon" title="Abrir ativo" onClick={(event) => { event.stopPropagation(); void openDetail(asset.id); }}><Boxes className="size-4" /></Button></TableCell></TableRow>)}
          </TableBody></Table>
        ) : <div className="p-10 text-center text-sm text-muted-foreground">Nenhum ativo encontrado.</div>}
      </div>

      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{total ? `${(page - 1) * 20 + 1}-${Math.min(page * 20, total)} de ${total}` : "0 ativos"}</p><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-20 text-center text-sm">{page} de {pageCount}</span><Button type="button" variant="outline" size="icon" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}><ChevronRight className="size-4" /></Button></div></div>

      <AssetFormDialog open={formOpen} editing={editing} form={form} branches={branches} categories={categories} saving={saving} onOpenChange={setFormOpen} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onSave={() => void saveAsset()} />

      <Sheet open={Boolean(detail) || detailLoading} onOpenChange={(open) => { if (!open) setDetail(null); }}><SheetContent className="w-full sm:max-w-2xl"><SheetHeader><SheetTitle>{detail ? `${detail.internal_code} - ${detail.name}` : "Carregando ativo"}</SheetTitle><SheetDescription>{detail ? `${detail.branch?.code || "-"} / ${detail.area || "Sem area"} / ${detail.physical_location || "Sem local"}` : "Consultando historico..."}</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {detailLoading && !detail ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-48" /></div> : detail ? <div className="space-y-5"><div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"><Detail label="Status" value={maintenanceLabel(detail.status)} /><Detail label="Criticidade" value={maintenanceLabel(detail.criticality)} /><Detail label="Categoria" value={[detail.category?.name, detail.subcategory].filter(Boolean).join(" / ") || "-"} /><Detail label="Marca / modelo" value={[detail.brand, detail.model].filter(Boolean).join(" / ") || "-"} /><Detail label="Numero de serie" value={detail.serial_number || "-"} /><Detail label="Responsavel" value={detail.responsible_name || "-"} /><Detail label="Centro de custo" value={[detail.cost_center_code, detail.cost_center_label].filter(Boolean).join(" - ") || "-"} /><Detail label="Fornecedor" value={detail.supplier?.razao_social || detail.supplier?.nome_fantasia || "-"} /><Detail label="Nota fiscal" value={detail.invoice_number || "-"} /><Detail label="Valor de aquisicao" value={maintenanceMoney(detail.acquisition_value_cents)} /><Detail label="Inicio de uso" value={maintenanceDate(detail.commissioned_at)} /><Detail label="Garantia ate" value={maintenanceDate(detail.warranty_ends_at)} /><Detail label="Vida util" value={detail.useful_life_months == null ? "-" : `${detail.useful_life_months} meses`} /><Detail label="Medidor" value={detail.meter_type ? `${Number(detail.current_meter || 0).toLocaleString("pt-BR")} ${maintenanceLabel(detail.meter_type)}` : "-"} /><Detail label="QR Code" value={detail.qr_code || "-"} /><Detail label="Codigo de barras" value={detail.barcode || "-"} /><Detail label="Ultima manutencao" value={maintenanceDate(detail.last_maintenance_at, true)} /><Detail label="Proxima manutencao" value={maintenanceDate(detail.next_maintenance_at, true)} /><Detail label="Atualizado" value={maintenanceDate(detail.updated_at, true)} /></div>
          <section><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">Manuais, fotos e documentos</h3><p className="text-xs text-muted-foreground">PDF ou imagem, ate 20 MB por arquivo.</p></div>{capabilities.MANAGE_ASSETS ? <div className="flex flex-wrap gap-2"><Select value={documentType} onValueChange={setDocumentType}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MANUAL">Manual</SelectItem><SelectItem value="PHOTO">Foto</SelectItem><SelectItem value="INVOICE">Nota fiscal</SelectItem><SelectItem value="WARRANTY">Garantia</SelectItem><SelectItem value="CERTIFICATE">Certificado</SelectItem><SelectItem value="OTHER">Outro</SelectItem></SelectContent></Select><Button type="button" variant="outline" size="sm" asChild disabled={documentUploading}><label className="cursor-pointer">{documentUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Anexar<input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={documentUploading} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadDocument(file); }} /></label></Button></div> : null}</div><div className="rounded-md border">{detail.documents?.length ? detail.documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-3 border-b p-3 last:border-0"><div className="flex min-w-0 items-center gap-3"><FileText className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate font-medium">{document.name}</p><p className="text-xs text-muted-foreground">{maintenanceLabel(document.document_type)} / {document.size_bytes ? `${(document.size_bytes / 1024 / 1024).toFixed(1)} MB` : "tamanho nao informado"}</p></div></div><div className="flex gap-1">{document.signedUrl ? <Button type="button" variant="ghost" size="icon" title="Abrir documento" asChild><a href={document.signedUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a></Button> : null}{capabilities.MANAGE_ASSETS ? <Button type="button" variant="ghost" size="icon" title="Remover documento" disabled={saving} onClick={() => void removeDocument(document)}><Trash2 className="size-4" /></Button> : null}</div></div>) : <p className="p-4 text-sm text-muted-foreground">Nenhum documento anexado.</p>}</div></section>
          <HistorySection title="Ordens vinculadas" empty="Nenhuma OS vinculada.">{detail.orders?.map((order) => <div key={order.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div className="min-w-0"><p className="truncate font-medium">{order.code} - {order.title}</p><p className="text-xs text-muted-foreground">{maintenanceDate(order.created_at)}</p></div><Badge variant="outline">{maintenanceLabel(order.status)}</Badge></div>)}</HistorySection>
          <HistorySection title="Leituras" empty="Nenhuma leitura registrada.">{detail.readings?.map((reading) => <div key={reading.id} className="flex items-center justify-between border-b py-2 last:border-0"><span>{Number(reading.reading).toLocaleString("pt-BR")} {reading.meter_type}</span><span className="text-xs text-muted-foreground">{maintenanceDate(reading.read_at, true)}</span></div>)}</HistorySection>
          <HistorySection title="Historico" empty="Nenhum evento registrado.">{detail.events?.map((event) => <div key={event.id} className="border-b py-2 last:border-0"><p>{event.label || maintenanceLabel(event.event_type)}</p><p className="text-xs text-muted-foreground">{maintenanceDate(event.created_at, true)}</p></div>)}</HistorySection>
        </div> : null}
      </div>{detail ? <SheetFooter className="border-t"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => openForm(detail)}><Pencil className="size-4" />Editar</Button><Button type="button" variant="outline" onClick={() => openAction("METER")}><Gauge className="size-4" />Leitura</Button><Button type="button" variant="outline" onClick={() => openAction("TRANSFER")}><ArrowRightLeft className="size-4" />Transferir</Button>{capabilities.RETIRE_ASSET ? <Button type="button" variant="destructive" onClick={() => openAction("RETIRE")}><Trash2 className="size-4" />Baixar</Button> : null}</div></SheetFooter> : null}</SheetContent></Sheet>

      <AssetActionDialog action={action} form={actionForm} branches={branches.filter((branch) => branch.id !== detail?.branch_id)} saving={saving} onOpenChange={(open) => { if (!open) setAction(null); }} onChange={(key, value) => setActionForm((current) => ({ ...current, [key]: value }))} onSubmit={() => void runAction()} />
    </section>
  );
}

function AssetFormDialog({ open, editing, form, branches, categories, saving, onOpenChange, onChange, onSave }: { open: boolean; editing: Asset | null; form: AssetForm; branches: Branch[]; categories: Category[]; saving: boolean; onOpenChange: (open: boolean) => void; onChange: (key: keyof AssetForm, value: string) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{editing ? `Editar ${editing.internal_code}` : "Cadastrar ativo"}</DialogTitle><DialogDescription>Identificacao, localizacao, responsabilidade, aquisicao e garantia do equipamento.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <FormSection title="Identificacao" />
    <Field label="Filial" required><Select value={form.branchId} onValueChange={(value) => onChange("branchId", value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Codigo interno" required><Input value={form.internalCode} onChange={(event) => onChange("internalCode", event.target.value)} /></Field><Field label="Patrimonio"><Input value={form.assetTag} onChange={(event) => onChange("assetTag", event.target.value)} /></Field>
    <Field label="Nome" required className="sm:col-span-2"><Input value={form.name} onChange={(event) => onChange("name", event.target.value)} /></Field><Field label="Categoria"><Select value={form.categoryId || "NONE"} onValueChange={(value) => onChange("categoryId", value === "NONE" ? "" : value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Sem categoria</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.code} - {category.name}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Subcategoria"><Input value={form.subcategory} onChange={(event) => onChange("subcategory", event.target.value)} /></Field><Field label="Marca"><Input value={form.brand} onChange={(event) => onChange("brand", event.target.value)} /></Field><Field label="Modelo"><Input value={form.model} onChange={(event) => onChange("model", event.target.value)} /></Field>
    <Field label="Numero de serie"><Input value={form.serialNumber} onChange={(event) => onChange("serialNumber", event.target.value)} /></Field><Field label="Codigo de barras"><Input value={form.barcode} onChange={(event) => onChange("barcode", event.target.value)} /></Field><Field label="QR Code"><Input value={form.qrCode} onChange={(event) => onChange("qrCode", event.target.value)} placeholder="Gerado automaticamente se vazio" /></Field>
    <Field label="Descricao" className="sm:col-span-2 lg:col-span-3"><Textarea value={form.description} onChange={(event) => onChange("description", event.target.value)} /></Field>

    <FormSection title="Localizacao e operacao" />
    <Field label="Area"><Input value={form.area} onChange={(event) => onChange("area", event.target.value)} /></Field><Field label="Local fisico"><Input value={form.physicalLocation} onChange={(event) => onChange("physicalLocation", event.target.value)} /></Field><Field label="Responsavel"><Input value={form.responsibleName} onChange={(event) => onChange("responsibleName", event.target.value)} /></Field>
    <Field label="Centro de custo"><Input value={form.costCenterCode} onChange={(event) => onChange("costCenterCode", event.target.value)} placeholder="Codigo" /></Field><Field label="Descricao do centro de custo" className="sm:col-span-2"><Input value={form.costCenterLabel} onChange={(event) => onChange("costCenterLabel", event.target.value)} /></Field>
    <Field label="Status"><Select value={form.status} onValueChange={(value) => onChange("status", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{assetStatuses.map((item) => <SelectItem key={item} value={item}>{maintenanceLabel(item)}</SelectItem>)}</SelectContent></Select></Field><Field label="Criticidade"><Select value={form.criticality} onValueChange={(value) => onChange("criticality", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{criticalities.map((item) => <SelectItem key={item} value={item}>{maintenanceLabel(item)}</SelectItem>)}</SelectContent></Select></Field><Field label="Tipo de medidor"><Select value={form.meterType || "NONE"} onValueChange={(value) => onChange("meterType", value === "NONE" ? "" : value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Sem medidor</SelectItem><SelectItem value="HOURS">Horas</SelectItem><SelectItem value="KM">Quilometros</SelectItem><SelectItem value="CYCLES">Ciclos</SelectItem></SelectContent></Select></Field>

    <FormSection title="Aquisicao e garantia" />
    <SupplierLookup key={editing?.id || "new"} value={form.supplierId} initialSupplier={editing?.supplier || null} onChange={(value) => onChange("supplierId", value)} />
    <Field label="Nota fiscal"><Input value={form.invoiceNumber} onChange={(event) => onChange("invoiceNumber", event.target.value)} /></Field><Field label="Data de aquisicao"><Input type="date" value={form.acquiredAt} onChange={(event) => onChange("acquiredAt", event.target.value)} /></Field>
    <Field label="Valor de aquisicao"><Input inputMode="decimal" value={form.acquisitionValue} onChange={(event) => onChange("acquisitionValue", event.target.value)} placeholder="R$ 0,00" /></Field><Field label="Inicio de uso"><Input type="date" value={form.commissionedAt} onChange={(event) => onChange("commissionedAt", event.target.value)} /></Field><Field label="Garantia (meses)"><Input inputMode="numeric" value={form.warrantyMonths} onChange={(event) => onChange("warrantyMonths", event.target.value)} /></Field>
    <Field label="Fim da garantia"><Input type="date" value={form.warrantyEndsAt} onChange={(event) => onChange("warrantyEndsAt", event.target.value)} /></Field><Field label="Vida util (meses)"><Input inputMode="numeric" value={form.usefulLifeMonths} onChange={(event) => onChange("usefulLifeMonths", event.target.value)} /></Field>
    <Field label="Observacoes" className="sm:col-span-2 lg:col-span-3"><Textarea value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></Field>
  </div><DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t bg-background px-6 py-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={onSave} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{editing ? "Salvar alteracoes" : "Cadastrar ativo"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SupplierLookup({ value, initialSupplier, onChange }: { value: string; initialSupplier: Asset["supplier"]; onChange: (value: string) => void }) {
  const initialLabel = initialSupplier ? `${initialSupplier.nome_fantasia || initialSupplier.razao_social}${initialSupplier.cnpj ? ` - ${initialSupplier.cnpj}` : ""}` : "";
  const [query, setQuery] = useState(initialLabel);
  const [items, setItems] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await maintenanceRequest<{ success: true; items: Supplier[] }>(`/api/manutencao/suppliers?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal }, "Falha ao buscar fornecedores.");
        setItems(data.items || []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : "Falha ao buscar fornecedores.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

      return <div className="relative space-y-1.5"><Label htmlFor="asset-supplier">Fornecedor</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="asset-supplier" className="pl-9" value={query} placeholder="Pesquisar nome ou CNPJ" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); }} /></div>{open ? <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">{value ? <button type="button" className="w-full rounded px-2 py-2 text-left text-xs hover:bg-muted" onMouseDown={(event) => { event.preventDefault(); setQuery(""); onChange(""); setOpen(false); }}>Remover fornecedor selecionado</button> : null}{loading ? <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Consultando...</p> : items.length ? items.map((supplier) => <button key={supplier.id} type="button" className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-muted" onMouseDown={(event) => { event.preventDefault(); setQuery(`${supplier.displayName || supplier.legalName}${supplier.taxId ? ` - ${supplier.taxId}` : ""}`); onChange(supplier.id); setOpen(false); }}><span className="block truncate font-medium">{supplier.displayName || supplier.legalName}</span><span className="block truncate text-muted-foreground">{supplier.legalName}{supplier.taxId ? ` / ${supplier.taxId}` : ""}{supplier.status === "PENDENTE_REVISAO" ? " / pre-cadastro" : ""}</span></button>) : <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum fornecedor encontrado.</p>}</div> : null}</div>;
}

function FormSection({ title }: { title: string }) {
  return <h3 className="border-b pb-2 text-sm font-semibold sm:col-span-2 lg:col-span-3">{title}</h3>;
}

function AssetActionDialog({ action, form, branches, saving, onOpenChange, onChange, onSubmit }: { action: "TRANSFER" | "METER" | "RETIRE" | null; form: { branchId: string; area: string; physicalLocation: string; reason: string; meterType: string; reading: string; notes: string }; branches: Branch[]; saving: boolean; onOpenChange: (open: boolean) => void; onChange: (key: keyof typeof form, value: string) => void; onSubmit: () => void }) {
  return <Dialog open={Boolean(action)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{action === "TRANSFER" ? "Transferir ativo" : action === "METER" ? "Registrar leitura" : "Baixar ativo"}</DialogTitle><DialogDescription>{action === "TRANSFER" ? "Atualize a filial e a localizacao fisica." : action === "METER" ? "A leitura alimenta os planos preventivos por uso." : "A baixa mantem o historico e impede uso operacional."}</DialogDescription></DialogHeader><div className="space-y-4">
    {action === "TRANSFER" ? <><Field label="Filial de destino" required><Select value={form.branchId} onValueChange={(value) => onChange("branchId", value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Area"><Input value={form.area} onChange={(event) => onChange("area", event.target.value)} /></Field><Field label="Local fisico"><Input value={form.physicalLocation} onChange={(event) => onChange("physicalLocation", event.target.value)} /></Field></> : null}
    {action === "METER" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Medidor"><Select value={form.meterType} onValueChange={(value) => onChange("meterType", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HOURS">Horas</SelectItem><SelectItem value="KM">Quilometros</SelectItem><SelectItem value="CYCLES">Ciclos</SelectItem></SelectContent></Select></Field><Field label="Leitura" required><Input inputMode="decimal" value={form.reading} onChange={(event) => onChange("reading", event.target.value)} /></Field></div> : null}
    {action !== "METER" ? <Field label="Motivo" required><Textarea value={form.reason} onChange={(event) => onChange("reason", event.target.value)} /></Field> : <Field label="Observacoes"><Textarea value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></Field>}
  </div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button><Button type="button" variant={action === "RETIRE" ? "destructive" : "default"} onClick={onSubmit} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Confirmar</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className || ""}`}><Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>; }
function HistorySection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section><h3 className="mb-2 font-medium">{title}</h3><div className="rounded-md border px-3">{hasChildren ? children : <p className="py-4 text-sm text-muted-foreground">{empty}</p>}</div></section>; }
