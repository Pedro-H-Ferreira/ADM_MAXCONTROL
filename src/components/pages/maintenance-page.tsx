"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  FileImage,
  Hammer,
  Loader2,
  PackageOpen,
  Plus,
  RefreshCcw,
  SendHorizontal,
  Smartphone,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { FluigIntegrationPanel } from "@/components/shared/fluig-integration-panel";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ModuleConfig } from "@/lib/admin-data";
import type { FluigAdmJobSummary } from "@/lib/fluig-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useFluigJobState } from "@/lib/use-fluig-job-state";
import { cn } from "@/lib/utils";

type MaintenanceOrderSource = "manual" | "fluig";
type MaintenanceOrderPriority = "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
type MaintenanceOrderStatus =
  | "ABERTA"
  | "INICIADA"
  | "AGUARDANDO_MATERIAL"
  | "AGUARDANDO_TERCEIRO"
  | "FINALIZADA"
  | "CANCELADA";

type MaintenanceBranch = {
  id: string;
  code: string;
  name: string;
  fluigLabel: string | null;
  active: boolean;
};

type MaintenancePhotoRecord = {
  name: string;
  size?: number | null;
  type?: string | null;
  bucket?: string | null;
  path?: string | null;
  uploadedAt?: string | null;
  uploadedByUserId?: string | null;
  signedUrl?: string | null;
};

type MaintenanceMaterialRecord = {
  item: string;
  quantity?: string | null;
  valueCents?: number | null;
};

type MaintenanceMaterialFormRow = {
  item: string;
  quantity: string;
  value: string;
};

type MaintenanceOrderRecord = {
  id: string;
  code: string;
  source: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority: MaintenanceOrderPriority;
  status: MaintenanceOrderStatus;
  requester: string | null;
  technician: string | null;
  branch: {
    id: string | null;
    code: string | null;
    label: string | null;
  };
  dueAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  materialSummary: string | null;
  materialCostCents: number;
  materials: MaintenanceMaterialRecord[];
  photos: MaintenancePhotoRecord[];
  pendingReason: string | null;
  fluig: {
    requestId: string | null;
    numLancW: string | null;
    currentTask: string | null;
    taskOwner: string | null;
    lastSyncAt: string | null;
  };
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
};

type MaintenancePayload = {
  success: true;
  items: MaintenanceOrderRecord[];
  branches: MaintenanceBranch[];
  total: number;
  counts: {
    open: number;
    started: number;
    waitingMaterial: number;
    finished: number;
    fluig: number;
    manual: number;
  };
};

type FormState = {
  source: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority: MaintenanceOrderPriority;
  status: MaintenanceOrderStatus;
  requester: string;
  technician: string;
  branchId: string;
  dueAt: string;
  materialSummary: string;
  materialCost: string;
  materials: MaintenanceMaterialFormRow[];
  pendingReason: string;
  fluigRequestId: string;
  fluigSourceRequestId: string;
  fluigNumLancW: string;
  fluigCurrentTask: string;
  fluigTaskOwner: string;
  photos: MaintenancePhotoRecord[];
};

const emptyForm: FormState = {
  source: "manual",
  title: "",
  description: "",
  area: "",
  priority: "MEDIA",
  status: "ABERTA",
  requester: "",
  technician: "",
  branchId: "",
  dueAt: "",
  materialSummary: "",
  materialCost: "",
  materials: [],
  pendingReason: "",
  fluigRequestId: "",
  fluigSourceRequestId: "",
  fluigNumLancW: "",
  fluigCurrentTask: "",
  fluigTaskOwner: "",
  photos: [],
};

const statusOptions: MaintenanceOrderStatus[] = [
  "ABERTA",
  "INICIADA",
  "AGUARDANDO_MATERIAL",
  "AGUARDANDO_TERCEIRO",
  "FINALIZADA",
  "CANCELADA",
];
const priorityOptions: MaintenanceOrderPriority[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];
const areaOptions = ["Docas", "Camara fria", "Cobertura", "Empilhadeiras", "Administrativo", "Patio", "Portaria"];
const photoMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const maxPhotoBytes = 10 * 1024 * 1024;

function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  return response.json().then((data: { success?: boolean; error?: string }) => {
    if (!response.ok || data.success === false) {
      throw new Error(data.error || fallbackMessage);
    }
    return data as T;
  });
}

function centsFromMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function moneyFromCents(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((value || 0) / 100);
}

function moneyInputFromCents(value: number | null | undefined) {
  return value ? String(value / 100).replace(".", ",") : "";
}

function materialTotalCents(materials: MaintenanceMaterialFormRow[]) {
  return materials.reduce((total, material) => total + centsFromMoney(material.value), 0);
}

function formatFileSize(value: number | null | undefined) {
  if (!value) return "-";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(Math.round(value / 1024), 1)} KB`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function formFromOrder(order: MaintenanceOrderRecord): FormState {
  return {
    source: order.source,
    title: order.title,
    description: order.description,
    area: order.area,
    priority: order.priority,
    status: order.status,
    requester: order.requester || "",
    technician: order.technician || "",
    branchId: order.branch.id || "",
    dueAt: order.dueAt ? order.dueAt.slice(0, 10) : "",
    materialSummary: order.materialSummary || "",
    materialCost: order.materialCostCents ? String(order.materialCostCents / 100).replace(".", ",") : "",
    materials: (order.materials || []).map((material) => ({
      item: material.item || "",
      quantity: material.quantity || "",
      value: moneyInputFromCents(material.valueCents),
    })),
    pendingReason: order.pendingReason || "",
    fluigRequestId: order.fluig.requestId || "",
    fluigSourceRequestId: metadataText(order.metadata, "fluigSourceRequestId"),
    fluigNumLancW: order.fluig.numLancW || "",
    fluigCurrentTask: order.fluig.currentTask || "",
    fluigTaskOwner: order.fluig.taskOwner || "",
    photos: order.photos || [],
  };
}

function buildPayload(form: FormState) {
  const materials = form.materials
    .map((material) => ({
      item: material.item.trim(),
      quantity: material.quantity.trim() || null,
      valueCents: centsFromMoney(material.value),
    }))
    .filter((material) => material.item);
  const materialsTotal = materialTotalCents(form.materials);

  return {
    source: form.source,
    title: form.title.trim(),
    description: form.description.trim(),
    area: form.area.trim(),
    priority: form.priority,
    status: form.status,
    requester: form.requester.trim() || null,
    technician: form.technician.trim() || null,
    branchId: form.branchId || null,
    dueAt: form.dueAt || null,
    materialSummary: form.materialSummary.trim() || null,
    materialCostCents: materials.length ? materialsTotal : centsFromMoney(form.materialCost),
    materials,
    pendingReason: form.pendingReason.trim() || null,
    fluigRequestId: form.source === "fluig" ? form.fluigRequestId.trim() || null : null,
    fluigNumLancW: form.source === "fluig" ? form.fluigNumLancW.trim() || null : null,
    fluigCurrentTask: form.source === "fluig" ? form.fluigCurrentTask.trim() || null : null,
    fluigTaskOwner: form.source === "fluig" ? form.fluigTaskOwner.trim() || null : null,
    metadata:
      form.source === "fluig" && form.fluigSourceRequestId.trim()
        ? { fluigSourceRequestId: form.fluigSourceRequestId.trim() }
        : undefined,
  };
}

type ActiveFluigJob = {
  orderId: string;
  id: string;
  status: string;
  progressLabel: string | null;
};

type PhotoUploadDraft = {
  file: File;
  name: string;
  size: number;
  type: string;
};

type SignedPhotoUpload = {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  mimeType: string;
};

type OrderMutationResponse = {
  success: true;
  order: MaintenanceOrderRecord;
};

type PhotoListResponse = {
  success: true;
  photos: MaintenancePhotoRecord[];
};

export function MaintenancePage({
  config,
  initialOpenForm = false,
}: {
  config: ModuleConfig;
  initialOpenForm?: boolean;
}) {
  const [orders, setOrders] = useState<MaintenanceOrderRecord[]>([]);
  const [branches, setBranches] = useState<MaintenanceBranch[]>([]);
  const [counts, setCounts] = useState<MaintenancePayload["counts"]>({
    open: 0,
    started: 0,
    waitingMaterial: 0,
    finished: 0,
    fluig: 0,
    manual: 0,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MaintenanceOrderStatus | "ALL">("ALL");
  const [source, setSource] = useState<MaintenanceOrderSource | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(initialOpenForm);
  const [editing, setEditing] = useState<MaintenanceOrderRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photoUploads, setPhotoUploads] = useState<PhotoUploadDraft[]>([]);
  const [photoViewer, setPhotoViewer] = useState<{ order: MaintenanceOrderRecord; photos: MaintenancePhotoRecord[] } | null>(null);
  const [photoViewerLoading, setPhotoViewerLoading] = useState(false);
  const matchesMaintenanceJob = useCallback(
    (job: FluigAdmJobSummary) =>
      job.module === "manutencao" &&
      job.operation === "open_from_source" &&
      Boolean(job.requestPayload?.maintenanceOrderId),
    []
  );
  const fluigJobTracker = useFluigJobState({ matches: matchesMaintenanceJob });
  const activeFluigJob = useMemo<ActiveFluigJob | null>(() => {
    const job = fluigJobTracker.job;
    const orderId = String(job?.requestPayload?.maintenanceOrderId || "");
    if (!job || !orderId) return null;
    return { orderId, id: job.id, status: job.status, progressLabel: job.progressLabel };
  }, [fluigJobTracker.job]);

  const visibleMobileOrders = useMemo(
    () => orders.filter((order) => order.status !== "FINALIZADA" && order.status !== "CANCELADA").slice(0, 6),
    [orders]
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        pageSize: "100",
      });
      if (search.trim()) params.set("q", search.trim());
      if (status !== "ALL") params.set("status", status);
      if (source !== "ALL") params.set("source", source);

      const data = await parseResponse<MaintenancePayload>(
        await fetch(`/api/manutencao?${params.toString()}`, { cache: "no-store" }),
        "Falha ao carregar OS de manutencao."
      );
      setOrders(data.items || []);
      setBranches(data.branches || []);
      setCounts(data.counts);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar OS de manutencao.");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [search, source, status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadOrders(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadOrders]);

  function openCreate(sourceType: MaintenanceOrderSource = "manual") {
    setEditing(null);
    setPhotoUploads([]);
    setForm({ ...emptyForm, source: sourceType, branchId: branches[0]?.id || "" });
    setDialogOpen(true);
  }

  function openEdit(order: MaintenanceOrderRecord) {
    setEditing(order);
    setPhotoUploads([]);
    setForm(formFromOrder(order));
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setPhotoUploads([]);
      setForm(emptyForm);
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addMaterial() {
    setForm((current) => ({
      ...current,
      materials: [...current.materials, { item: "", quantity: "", value: "" }],
    }));
  }

  function updateMaterial(index: number, key: keyof MaintenanceMaterialFormRow, value: string) {
    setForm((current) => ({
      ...current,
      materials: current.materials.map((material, currentIndex) =>
        currentIndex === index ? { ...material, [key]: value } : material
      ),
    }));
  }

  function removeMaterial(index: number) {
    setForm((current) => ({
      ...current,
      materials: current.materials.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function handlePhotoFiles(files: FileList | null) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) {
      setPhotoUploads([]);
      return;
    }

    const validFiles: PhotoUploadDraft[] = [];
    for (const file of selectedFiles.slice(0, 12)) {
      if (!photoMimeTypes.has(file.type)) {
        toast.error(`${file.name}: use JPG, PNG ou WebP.`);
        continue;
      }
      if (file.size > maxPhotoBytes) {
        toast.error(`${file.name}: foto maior que 10 MB.`);
        continue;
      }
      validFiles.push({
        file,
        name: file.name,
        size: file.size,
        type: file.type === "image/jpg" ? "image/jpeg" : file.type,
      });
    }

    if (selectedFiles.length > 12) {
      toast.error("Envie no maximo 12 fotos por vez.");
    }
    setPhotoUploads(validFiles);
  }

  async function uploadSelectedPhotos(orderId: string) {
    if (!photoUploads.length) return;

    const supabase = getSupabaseBrowserClient();
    const uploadedPhotos: MaintenancePhotoRecord[] = [];
    for (const draft of photoUploads) {
      const uploadResponse = await fetch(`/api/manutencao/${orderId}/photos/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          mimeType: draft.type,
          size: draft.size,
        }),
      });
      const uploadData = await parseResponse<{ success: true; upload: SignedPhotoUpload }>(
        uploadResponse,
        "Falha ao preparar upload da foto."
      );

      const { error: uploadError } = await supabase.storage
        .from(uploadData.upload.bucket)
        .uploadToSignedUrl(uploadData.upload.path, uploadData.upload.token, draft.file, {
          contentType: uploadData.upload.mimeType,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      uploadedPhotos.push({
        name: draft.name,
        size: draft.size,
        type: uploadData.upload.mimeType,
        bucket: uploadData.upload.bucket,
        path: uploadData.upload.path,
      });
    }

    await parseResponse<PhotoListResponse>(
      await fetch(`/api/manutencao/${orderId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: uploadedPhotos }),
      }),
      "Falha ao registrar fotos da OS."
    );
  }

  async function submitOrder() {
    if (!form.title.trim() || !form.description.trim() || !form.area.trim()) {
      toast.error("Informe titulo, area e descricao da OS.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/manutencao/${editing.id}` : "/api/manutencao", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      const data = await parseResponse<OrderMutationResponse>(response, editing ? "Falha ao atualizar OS." : "Falha ao criar OS.");
      if (photoUploads.length) {
        try {
          await uploadSelectedPhotos(data.order.id);
        } catch (error) {
          toast.error(error instanceof Error ? `OS salva, mas as fotos falharam: ${error.message}` : "OS salva, mas as fotos falharam.");
          await loadOrders();
          return;
        }
      }

      toast.success(photoUploads.length ? "OS salva com fotos anexadas." : editing ? "OS atualizada." : "OS criada.");
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setPhotoUploads([]);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar OS.");
    } finally {
      setSaving(false);
    }
  }

  async function viewPhotos(order: MaintenanceOrderRecord) {
    setPhotoViewerLoading(true);
    try {
      const data = await parseResponse<PhotoListResponse>(
        await fetch(`/api/manutencao/${order.id}/photos`, { cache: "no-store" }),
        "Falha ao carregar fotos da OS."
      );
      setPhotoViewer({ order, photos: data.photos || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar fotos da OS.");
    } finally {
      setPhotoViewerLoading(false);
    }
  }

  async function quickStatus(order: MaintenanceOrderRecord, nextStatus: MaintenanceOrderStatus) {
    try {
      await parseResponse(
        await fetch(`/api/manutencao/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        }),
        "Falha ao atualizar status da OS."
      );
      toast.success(`OS ${order.code} atualizada para ${nextStatus.replaceAll("_", " ")}.`);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar status da OS.");
    }
  }

  async function pollFluigJob(jobId: string) {
    return fluigJobTracker.wait(jobId);
  }

  async function openOrderInFluig(order: MaintenanceOrderRecord) {
    const sourceRequestId = metadataText(order.metadata, "fluigSourceRequestId");
    if (!sourceRequestId) {
      toast.error("Abra a OS e informe o numero da solicitacao modelo Fluig antes de enviar.");
      openEdit(order);
      return;
    }

    try {
      const response = await fetch(`/api/manutencao/${order.id}/fluig/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRequestId }),
      });
      const data = await parseResponse<{
        success: true;
        job: FluigAdmJobSummary;
      }>(response, "Falha ao criar job de abertura Fluig.");

      fluigJobTracker.track(data.job);
      await pollFluigJob(data.job.id);
      toast.success(`OS ${order.code} aberta no Fluig.`);
      fluigJobTracker.clear();
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao abrir OS no Fluig.");
      await loadOrders();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description="Ordens manuais do CD e OS integradas ao Fluig em uma fila operacional para desktop e celular."
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="stitch-soft-button" onClick={() => openCreate("manual")}>
            <Plus className="size-4" />
            Nova OS manual
          </Button>
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => openCreate("fluig")}>
            <Wrench className="size-4" />
            Nova OS Fluig
          </Button>
        </div>
        <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void loadOrders()} disabled={loading}>
          <RefreshCcw className={cn("size-4", loading ? "animate-spin" : "")} />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric icon={Clock} label="Abertas" value={String(counts.open)} />
        <Metric icon={Hammer} label="Iniciadas" value={String(counts.started)} />
        <Metric icon={PackageOpen} label="Aguardando material" value={String(counts.waitingMaterial)} />
        <Metric icon={CheckCircle2} label="Finalizadas" value={String(counts.finished)} />
        <Metric icon={Smartphone} label="Manuais" value={String(counts.manual)} />
        <Metric icon={Wrench} label="Com Fluig" value={String(counts.fluig)} />
      </div>

      <Card className="stitch-animate-in rounded-lg shadow-none">
        <CardContent className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar OS, area, tecnico, Fluig ou filial" />
          <Select value={status} onValueChange={(value) => setStatus(value as MaintenanceOrderStatus | "ALL")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              {statusOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(value) => setSource(value as MaintenanceOrderSource | "ALL")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as origens</SelectItem>
              <SelectItem value="manual">Ferramenta</SelectItem>
              <SelectItem value="fluig">Fluig</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-3">
          {loading ? (
            <Card className="rounded-lg shadow-none">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">Carregando OS reais...</CardContent>
            </Card>
          ) : orders.length ? (
            orders.map((order) => (
              <MaintenanceOrderCard
                key={order.id}
                order={order}
                activeFluigJob={activeFluigJob?.orderId === order.id ? activeFluigJob : null}
                onEdit={() => openEdit(order)}
                onViewPhotos={() => void viewPhotos(order)}
                onQuickStatus={(nextStatus) => void quickStatus(order, nextStatus)}
                onOpenFluig={() => void openOrderInFluig(order)}
              />
            ))
          ) : (
            <EmptyState title="Nenhuma OS real encontrada" />
          )}
        </section>

        <aside className="space-y-4">
          <Card className="stitch-animate-in rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="size-4" />
                Fila mobile do manutentor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {visibleMobileOrders.length ? (
                visibleMobileOrders.map((order) => (
                  <div key={`${order.id}-mobile`} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{order.code} - {order.title}</p>
                        <p className="text-xs text-muted-foreground">{order.area} - {order.technician || "Sem tecnico"}</p>
                      </div>
                      <PriorityBadge priority={order.priority} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={order.status} />
                      <span className="text-xs text-muted-foreground">{formatDate(order.dueAt)}</span>
                      <span className="text-xs text-muted-foreground">{order.materials.length} material(is)</span>
                      <span className="text-xs text-muted-foreground">{moneyFromCents(order.materialCostCents)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Nenhuma OS aberta para a fila mobile.
                </p>
              )}
            </CardContent>
          </Card>

          <FluigIntegrationPanel moduleSlug="manutencao" compact />
        </aside>
      </div>

      <MaintenanceDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        editing={editing}
        form={form}
        branches={branches}
        photoUploads={photoUploads}
        saving={saving}
        updateForm={updateForm}
        addMaterial={addMaterial}
        updateMaterial={updateMaterial}
        removeMaterial={removeMaterial}
        onPhotoFilesChange={handlePhotoFiles}
        submitOrder={submitOrder}
      />

      <PhotoViewerDialog
        open={Boolean(photoViewer)}
        loading={photoViewerLoading}
        order={photoViewer?.order || null}
        photos={photoViewer?.photos || []}
        onOpenChange={(open) => {
          if (!open) setPhotoViewer(null);
        }}
      />
    </div>
  );
}

function MaintenanceOrderCard({
  order,
  onEdit,
  onViewPhotos,
  onQuickStatus,
  onOpenFluig,
  activeFluigJob,
}: {
  order: MaintenanceOrderRecord;
  onEdit: () => void;
  onViewPhotos: () => void;
  onQuickStatus: (status: MaintenanceOrderStatus) => void;
  onOpenFluig: () => void;
  activeFluigJob: ActiveFluigJob | null;
}) {
  const hasFluigModel = Boolean(metadataText(order.metadata, "fluigSourceRequestId"));
  const canOpenFluig = order.source === "fluig" && !order.fluig.requestId;

  return (
    <Card className="stitch-animate-in rounded-lg shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{order.code}</span>
              <PriorityBadge priority={order.priority} />
              <StatusBadge status={order.status} />
              <span className="rounded-md border bg-muted/40 px-2 py-1 text-xs">
                {order.source === "manual" ? "Ferramenta" : "Fluig"}
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold">{order.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{order.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {order.photos.length ? (
              <Button type="button" variant="outline" className="stitch-soft-button w-fit" onClick={onViewPhotos}>
                <Eye className="size-4" />
                Ver fotos
              </Button>
            ) : null}
            {canOpenFluig ? (
              <Button
                type="button"
                className="stitch-soft-button w-fit"
                onClick={onOpenFluig}
                disabled={Boolean(activeFluigJob)}
                title={hasFluigModel ? "Abrir processo no Fluig pelo agente local" : "Informe o modelo Fluig na OS"}
              >
                {activeFluigJob ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                Abrir no Fluig
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="stitch-soft-button w-fit" onClick={onEdit}>
              Atualizar OS
            </Button>
          </div>
        </div>

        <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          <Field label="Area" value={order.area} />
          <Field label="Filial" value={order.branch.label || order.branch.code || "-"} />
          <Field label="Tecnico" value={order.technician || "-"} />
          <Field label="Prazo" value={formatDate(order.dueAt)} />
          <Field label="Inicio" value={formatDateTime(order.startedAt)} />
          <Field label="Custo" value={moneyFromCents(order.materialCostCents)} />
          <Field label="Materiais" value={String(order.materials.length)} />
          <Field label="Fotos" value={String(order.photos.length)} />
          <Field label="Atualizada" value={formatDateTime(order.updatedAt)} />
        </div>

        {order.source === "fluig" ? (
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm md:grid-cols-4">
            <Field label="Fluig" value={order.fluig.requestId || "-"} />
            <Field label="NumLancW" value={order.fluig.numLancW || "-"} />
            <Field label="Etapa" value={order.fluig.currentTask || "-"} />
            <Field label="Responsavel" value={order.fluig.taskOwner || "-"} />
          </div>
        ) : null}

        {activeFluigJob ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Execucao Fluig</span>
              <StatusBadge status={activeFluigJob.status.toUpperCase()} />
              <span className="font-mono text-xs text-muted-foreground">{activeFluigJob.id.slice(0, 8)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeFluigJob.progressLabel || "Aguardando agente local assumir a abertura da OS."}
            </p>
          </div>
        ) : null}

        {order.materialSummary || order.materials.length || order.pendingReason ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <p className="font-medium">Execucao</p>
            {order.materialSummary ? <p className="mt-1 text-muted-foreground">{order.materialSummary}</p> : null}
            {order.materials.length ? (
              <div className="mt-2 grid gap-1">
                {order.materials.slice(0, 4).map((material, index) => (
                  <div key={`${material.item}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1 text-xs">
                    <span className="min-w-0 truncate font-medium">{material.item}</span>
                    <span className="text-muted-foreground">
                      {material.quantity || "Qtd. nao informada"} - {moneyFromCents(material.valueCents || 0)}
                    </span>
                  </div>
                ))}
                {order.materials.length > 4 ? <p className="text-xs text-muted-foreground">+ {order.materials.length - 4} material(is)</p> : null}
              </div>
            ) : null}
            {order.pendingReason ? <p className="mt-1 text-amber-700">Pendencia: {order.pendingReason}</p> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onQuickStatus("INICIADA")} disabled={order.status === "INICIADA"}>
            Iniciar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onQuickStatus("AGUARDANDO_MATERIAL")}>
            Aguardando material
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onQuickStatus("AGUARDANDO_TERCEIRO")}>
            Aguardando terceiro
          </Button>
          <Button type="button" size="sm" onClick={() => onQuickStatus("FINALIZADA")}>
            Finalizar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MaintenanceDialog({
  open,
  onOpenChange,
  editing,
  form,
  branches,
  photoUploads,
  saving,
  updateForm,
  addMaterial,
  updateMaterial,
  removeMaterial,
  onPhotoFilesChange,
  submitOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: MaintenanceOrderRecord | null;
  form: FormState;
  branches: MaintenanceBranch[];
  photoUploads: PhotoUploadDraft[];
  saving: boolean;
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  addMaterial: () => void;
  updateMaterial: (index: number, key: keyof MaintenanceMaterialFormRow, value: string) => void;
  removeMaterial: (index: number) => void;
  onPhotoFilesChange: (files: FileList | null) => void;
  submitOrder: () => Promise<void>;
}) {
  const materialTotal = materialTotalCents(form.materials);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Atualizar ${editing.code}` : "Nova OS de manutencao"}</DialogTitle>
          <DialogDescription>
            Selecione se a OS fica somente na ferramenta ou se acompanha um processo Fluig de manutencao/ativo.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={form.source} onValueChange={(value) => updateForm("source", value as MaintenanceOrderSource)}>
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="manual">OS manual</TabsTrigger>
            <TabsTrigger value="fluig">OS Fluig</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="mt-4">
            <FlowNotice description="Nao abre processo no Fluig. O manutentor atualiza status, materiais, custo e fotos dentro do ADM." />
          </TabsContent>
          <TabsContent value="fluig" className="mt-4">
            <FlowNotice description="Use quando a OS deve acompanhar o processo Fluig. O numero Fluig e o NumLancW ficam vinculados ao registro local." />
          </TabsContent>
        </Tabs>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Titulo" required>
            <Input value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
          </FormField>
          <FormField label="Area" required>
            <Select value={form.area || undefined} onValueChange={(value) => updateForm("area", value)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a area" />
              </SelectTrigger>
              <SelectContent>
                {areaOptions.map((area) => (
                  <SelectItem key={area} value={area}>
                    {area}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Filial">
            <Select value={form.branchId || undefined} onValueChange={(value) => updateForm("branchId", value)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filial da OS" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.code} - {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Prioridade">
            <Select value={form.priority} onValueChange={(value) => updateForm("priority", value as MaintenanceOrderPriority)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorityOptions.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Solicitante">
            <Input value={form.requester} onChange={(event) => updateForm("requester", event.target.value)} />
          </FormField>
          <FormField label="Tecnico ou equipe">
            <Input value={form.technician} onChange={(event) => updateForm("technician", event.target.value)} />
          </FormField>
          <FormField label="Prazo">
            <Input type="date" value={form.dueAt} onChange={(event) => updateForm("dueAt", event.target.value)} />
          </FormField>
          <FormField label="Status">
            <Select value={form.status} onValueChange={(value) => updateForm("status", value as MaintenanceOrderStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Descricao" className="md:col-span-2" required>
            <Textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
          </FormField>
          <FormField label="Material utilizado" className="md:col-span-2">
            <Textarea
              value={form.materialSummary}
              onChange={(event) => updateForm("materialSummary", event.target.value)}
              placeholder="Produto, quantidade, unidade, observacoes da execucao"
            />
          </FormField>
          <div className="space-y-3 rounded-md border bg-muted/20 p-3 md:col-span-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Materiais e produtos usados</p>
                <p className="text-xs text-muted-foreground">Registre item, quantidade e valor para alimentar o custo real da OS.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                <Plus className="size-4" />
                Adicionar material
              </Button>
            </div>

            {form.materials.length ? (
              <div className="space-y-2">
                {form.materials.map((material, index) => (
                  <div key={index} className="grid gap-2 rounded-md bg-background/70 p-2 md:grid-cols-[minmax(0,1fr)_140px_140px_40px]">
                    <Input
                      value={material.item}
                      onChange={(event) => updateMaterial(index, "item", event.target.value)}
                      placeholder="Material ou produto"
                    />
                    <Input
                      value={material.quantity}
                      onChange={(event) => updateMaterial(index, "quantity", event.target.value)}
                      placeholder="Qtd./unidade"
                    />
                    <Input
                      value={material.value}
                      onChange={(event) => updateMaterial(index, "value", event.target.value)}
                      placeholder="R$ 0,00"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => removeMaterial(index)} title="Remover material">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-sm font-medium">Total dos materiais: {moneyFromCents(materialTotal)}</p>
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Nenhum material estruturado. Use o valor avulso abaixo quando nao houver detalhamento por item.
              </p>
            )}
          </div>
          <FormField label={form.materials.length ? "Valor avulso ignorado" : "Valor gasto avulso"}>
            <Input
              value={form.materials.length ? moneyFromCents(materialTotal) : form.materialCost}
              onChange={(event) => updateForm("materialCost", event.target.value)}
              placeholder="R$ 0,00"
              disabled={form.materials.length > 0}
            />
          </FormField>
          <FormField label="Fotos da execucao">
            <Input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => onPhotoFilesChange(event.target.files)}
            />
            <div className="space-y-1 text-xs text-muted-foreground">
              {form.photos.length ? <p>{form.photos.length} foto(s) ja anexada(s) nesta OS</p> : null}
              {photoUploads.length ? (
                <p>
                  {photoUploads.length} nova(s) foto(s) pronta(s) para envio -{" "}
                  {formatFileSize(photoUploads.reduce((total, photo) => total + photo.size, 0))}
                </p>
              ) : null}
            </div>
          </FormField>
          <FormField label="Motivo se nao finalizou" className="md:col-span-2">
            <Textarea value={form.pendingReason} onChange={(event) => updateForm("pendingReason", event.target.value)} />
          </FormField>
        </div>

        {form.source === "fluig" ? (
          <div className="grid gap-4 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
            <FormField label="Solicitacao modelo Fluig" required>
              <Input
                value={form.fluigSourceRequestId}
                onChange={(event) => updateForm("fluigSourceRequestId", event.target.value)}
                placeholder="Ex.: numero de uma OS Fluig real para clonar"
              />
            </FormField>
            <FormField label="Numero Fluig">
              <Input value={form.fluigRequestId} onChange={(event) => updateForm("fluigRequestId", event.target.value)} />
            </FormField>
            <FormField label="NumLancW">
              <Input value={form.fluigNumLancW} onChange={(event) => updateForm("fluigNumLancW", event.target.value)} />
            </FormField>
            <FormField label="Etapa Fluig">
              <Input value={form.fluigCurrentTask} onChange={(event) => updateForm("fluigCurrentTask", event.target.value)} />
            </FormField>
            <FormField label="Responsavel Fluig">
              <Input value={form.fluigTaskOwner} onChange={(event) => updateForm("fluigTaskOwner", event.target.value)} />
            </FormField>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submitOrder()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving && photoUploads.length ? "Salvando e anexando..." : editing ? "Salvar OS" : "Criar OS"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <Card className="stitch-animate-in rounded-lg shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-4" />
          {label}
        </div>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function PhotoViewerDialog({
  open,
  loading,
  order,
  photos,
  onOpenChange,
}: {
  open: boolean;
  loading: boolean;
  order: MaintenanceOrderRecord | null;
  photos: MaintenancePhotoRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{order ? `Fotos da ${order.code}` : "Fotos da OS"}</DialogTitle>
          <DialogDescription>Registros anexados pelo manutentor com acesso temporario seguro.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center rounded-md border border-dashed p-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Carregando fotos...
          </div>
        ) : photos.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo, index) => (
              <div key={`${photo.path || photo.name}-${index}`} className="overflow-hidden rounded-md border bg-muted/20">
                {photo.signedUrl ? (
                  <a href={photo.signedUrl} target="_blank" rel="noreferrer" className="block">
                    <span className="relative block aspect-video w-full overflow-hidden">
                      <Image src={photo.signedUrl} alt={photo.name} fill sizes="(max-width: 1024px) 50vw, 33vw" unoptimized className="object-cover" />
                    </span>
                  </a>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
                    <FileImage className="size-8" />
                  </div>
                )}
                <div className="space-y-1 p-3 text-sm">
                  <p className="truncate font-medium">{photo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(photo.size)} {photo.uploadedAt ? `- ${formatDateTime(photo.uploadedAt)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma foto anexada.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}

function FormField({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function FlowNotice({ description }: { description: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
