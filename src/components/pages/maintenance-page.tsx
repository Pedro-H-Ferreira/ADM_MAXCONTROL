"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { FluigIntegrationPanel } from "@/components/shared/fluig-integration-panel";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import type { FluigAdmJobSummary } from "@/lib/fluig-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useFluigJobState } from "@/lib/use-fluig-job-state";
import { cn } from "@/lib/utils";
import { MaintenanceOrderExecutionPanel } from "@/components/maintenance/maintenance-order-execution-panel";

type MaintenanceOrderSource = "manual" | "fluig" | "preventiva" | "checklist" | "alerta";
type MaintenanceOrderPriority = "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
type MaintenanceOrderWorkType = "CORRETIVA" | "PREVENTIVA" | "INSPECAO" | "MELHORIA" | "EMERGENCIA";
type MaintenanceOrderStatus =
  | "ABERTA"
  | "EM_TRIAGEM"
  | "PLANEJADA"
  | "AGUARDANDO_APROVACAO"
  | "INICIADA"
  | "EM_EXECUCAO"
  | "AGUARDANDO_MATERIAL"
  | "MATERIAL_RESERVADO"
  | "AGUARDANDO_TERCEIRO"
  | "PROGRAMADA"
  | "PAUSADA"
  | "CONCLUIDA"
  | "AGUARDANDO_VALIDACAO"
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

export type MaintenanceOrderRecord = {
  id: string;
  code: string;
  source: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority: MaintenanceOrderPriority;
  status: MaintenanceOrderStatus;
  workType: MaintenanceOrderWorkType;
  assetId: string | null;
  asset: { id: string; internal_code: string; asset_tag: string | null; name: string; status: string; physical_location: string | null } | null;
  serviceProviderId: string | null;
  serviceProvider: { id: string; name: string; tax_id: string | null } | null;
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
  slaMinutes: number | null;
  diagnosis: string | null;
  rootCause: string | null;
  executedSolution: string | null;
  downtimeMinutes: number;
  laborCostCents: number;
  otherCostCents: number;
  totalCostCents: number;
  completionNotes: string | null;
  approvalStatus: string;
  approval: {
    approvedBy: string | null;
    approvedAt: string | null;
    notes: string | null;
  };
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
  page: number;
  pageSize: number;
  total: number;
  capabilities: Record<string, boolean>;
  counts: {
    open: number;
    started: number;
    waitingMaterial: number;
    finished: number;
    fluig: number;
    manual: number;
  };
};

type MaintenanceAssetOption = {
  id: string;
  branch_id: string;
  internal_code: string;
  asset_tag: string | null;
  name: string;
  status: string;
};

type FormState = {
  source: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority: MaintenanceOrderPriority;
  status: MaintenanceOrderStatus;
  workType: MaintenanceOrderWorkType;
  assetId: string;
  requester: string;
  technician: string;
  branchId: string;
  dueAt: string;
  materialSummary: string;
  materialCost: string;
  materials: MaintenanceMaterialFormRow[];
  pendingReason: string;
  slaMinutes: string;
  diagnosis: string;
  rootCause: string;
  executedSolution: string;
  downtimeMinutes: string;
  laborCost: string;
  otherCost: string;
  completionNotes: string;
  completionApprovalRequired: boolean;
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
  workType: "CORRETIVA",
  assetId: "",
  requester: "",
  technician: "",
  branchId: "",
  dueAt: "",
  materialSummary: "",
  materialCost: "",
  materials: [],
  pendingReason: "",
  slaMinutes: "",
  diagnosis: "",
  rootCause: "",
  executedSolution: "",
  downtimeMinutes: "",
  laborCost: "",
  otherCost: "",
  completionNotes: "",
  completionApprovalRequired: false,
  fluigRequestId: "",
  fluigSourceRequestId: "",
  fluigNumLancW: "",
  fluigCurrentTask: "",
  fluigTaskOwner: "",
  photos: [],
};

const statusOptions: MaintenanceOrderStatus[] = [
  "ABERTA",
  "EM_TRIAGEM",
  "PLANEJADA",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_MATERIAL",
  "MATERIAL_RESERVADO",
  "AGUARDANDO_TERCEIRO",
  "PROGRAMADA",
  "INICIADA",
  "EM_EXECUCAO",
  "PAUSADA",
  "CONCLUIDA",
  "AGUARDANDO_VALIDACAO",
  "FINALIZADA",
  "CANCELADA",
];
const priorityOptions: MaintenanceOrderPriority[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];
const workTypeOptions: MaintenanceOrderWorkType[] = ["CORRETIVA", "PREVENTIVA", "INSPECAO", "MELHORIA", "EMERGENCIA"];
const statusTransitions: Record<MaintenanceOrderStatus, MaintenanceOrderStatus[]> = {
  ABERTA: ["EM_TRIAGEM", "PLANEJADA", "AGUARDANDO_APROVACAO", "INICIADA", "EM_EXECUCAO", "CANCELADA"],
  EM_TRIAGEM: ["PLANEJADA", "AGUARDANDO_APROVACAO", "AGUARDANDO_MATERIAL", "PROGRAMADA", "EM_EXECUCAO", "CANCELADA"],
  PLANEJADA: ["AGUARDANDO_APROVACAO", "AGUARDANDO_MATERIAL", "MATERIAL_RESERVADO", "PROGRAMADA", "EM_EXECUCAO", "CANCELADA"],
  AGUARDANDO_APROVACAO: ["PLANEJADA", "AGUARDANDO_MATERIAL", "PROGRAMADA", "CANCELADA"],
  AGUARDANDO_MATERIAL: ["MATERIAL_RESERVADO", "PLANEJADA", "CANCELADA"],
  MATERIAL_RESERVADO: ["PROGRAMADA", "INICIADA", "EM_EXECUCAO", "AGUARDANDO_MATERIAL", "CANCELADA"],
  AGUARDANDO_TERCEIRO: ["PROGRAMADA", "EM_EXECUCAO", "PAUSADA", "CANCELADA"],
  PROGRAMADA: ["INICIADA", "EM_EXECUCAO", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "CANCELADA"],
  INICIADA: ["EM_EXECUCAO", "PAUSADA", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "CONCLUIDA", "AGUARDANDO_VALIDACAO", "FINALIZADA", "CANCELADA"],
  EM_EXECUCAO: ["PAUSADA", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "CONCLUIDA", "AGUARDANDO_VALIDACAO", "FINALIZADA", "CANCELADA"],
  PAUSADA: ["EM_EXECUCAO", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "CANCELADA"],
  CONCLUIDA: ["AGUARDANDO_VALIDACAO", "FINALIZADA", "EM_EXECUCAO"],
  AGUARDANDO_VALIDACAO: ["FINALIZADA", "EM_EXECUCAO"],
  FINALIZADA: [],
  CANCELADA: [],
};
const areaOptions = ["Docas", "Camara fria", "Cobertura", "Empilhadeiras", "Administrativo", "Patio", "Portaria"];
const photoMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const maxPhotoBytes = 10 * 1024 * 1024;
const maintenancePageSizes = [20, 50, 100] as const;

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

function maintenanceSourceLabel(source: MaintenanceOrderSource) {
  const labels: Record<MaintenanceOrderSource, string> = {
    manual: "Ferramenta",
    fluig: "Fluig",
    preventiva: "Preventiva",
    checklist: "Checklist",
    alerta: "Alerta",
  };
  return labels[source];
}

function formFromOrder(order: MaintenanceOrderRecord): FormState {
  return {
    source: order.source,
    title: order.title,
    description: order.description,
    area: order.area,
    priority: order.priority,
    status: order.status,
    workType: order.workType,
    assetId: order.assetId || "",
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
    slaMinutes: order.slaMinutes == null ? "" : String(order.slaMinutes),
    diagnosis: order.diagnosis || "",
    rootCause: order.rootCause || "",
    executedSolution: order.executedSolution || "",
    downtimeMinutes: order.downtimeMinutes ? String(order.downtimeMinutes) : "",
    laborCost: moneyInputFromCents(order.laborCostCents),
    otherCost: moneyInputFromCents(order.otherCostCents),
    completionNotes: order.completionNotes || "",
    completionApprovalRequired: order.approvalStatus !== "NOT_REQUIRED",
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
    workType: form.workType,
    assetId: form.assetId || null,
    requester: form.requester.trim() || null,
    technician: form.technician.trim() || null,
    branchId: form.branchId || null,
    dueAt: form.dueAt || null,
    materialSummary: form.materialSummary.trim() || null,
    materialCostCents: materials.length ? materialsTotal : centsFromMoney(form.materialCost),
    materials,
    pendingReason: form.pendingReason.trim() || null,
    slaMinutes: form.slaMinutes ? Math.max(0, Math.round(Number(form.slaMinutes))) : null,
    diagnosis: form.diagnosis.trim() || null,
    rootCause: form.rootCause.trim() || null,
    executedSolution: form.executedSolution.trim() || null,
    downtimeMinutes: form.downtimeMinutes ? Math.max(0, Math.round(Number(form.downtimeMinutes))) : 0,
    laborCostCents: centsFromMoney(form.laborCost),
    otherCostCents: centsFromMoney(form.otherCost),
    completionNotes: form.completionNotes.trim() || null,
    completionApprovalRequired: form.completionApprovalRequired,
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

export function MaintenanceOrdersPanel({
  initialOpenForm = false,
}: {
  initialOpenForm?: boolean;
}) {
  const initialSearchParams = useSearchParams();
  const initialStatus = initialSearchParams.get("status");
  const initialSource = initialSearchParams.get("source");
  const initialPageSize = Number(initialSearchParams.get("pageSize") || 20);
  const [orders, setOrders] = useState<MaintenanceOrderRecord[]>([]);
  const [branches, setBranches] = useState<MaintenanceBranch[]>([]);
  const [assets, setAssets] = useState<MaintenanceAssetOption[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<MaintenancePayload["counts"]>({
    open: 0,
    started: 0,
    waitingMaterial: 0,
    finished: 0,
    fluig: 0,
    manual: 0,
  });
  const [search, setSearch] = useState(() => initialSearchParams.get("q") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => initialSearchParams.get("q") || "");
  const [status, setStatus] = useState<MaintenanceOrderStatus | "ALL">(() =>
    initialStatus && (statusOptions as string[]).includes(initialStatus) ? initialStatus as MaintenanceOrderStatus : "ALL"
  );
  const [source, setSource] = useState<MaintenanceOrderSource | "ALL">(() =>
    initialSource && ["manual", "fluig", "preventiva", "checklist", "alerta"].includes(initialSource)
      ? initialSource as MaintenanceOrderSource
      : "ALL"
  );
  const [page, setPage] = useState(() => Math.max(1, Number(initialSearchParams.get("page") || 1) || 1));
  const [pageSize, setPageSize] = useState<(typeof maintenancePageSizes)[number]>(() =>
    maintenancePageSizes.includes(initialPageSize as (typeof maintenancePageSizes)[number])
      ? initialPageSize as (typeof maintenancePageSizes)[number]
      : 20
  );
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(initialOpenForm);
  const [editing, setEditing] = useState<MaintenanceOrderRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photoUploads, setPhotoUploads] = useState<PhotoUploadDraft[]>([]);
  const [photoViewer, setPhotoViewer] = useState<{ order: MaintenanceOrderRecord; photos: MaintenancePhotoRecord[] } | null>(null);
  const [photoViewerLoading, setPhotoViewerLoading] = useState(false);
  const [transitionDialog, setTransitionDialog] = useState<{ order: MaintenanceOrderRecord; nextStatus: MaintenanceOrderStatus; comment: string } | null>(null);
  const [reviewDialog, setReviewDialog] = useState<{ order: MaintenanceOrderRecord; decision: "APPROVE" | "REJECT"; notes: string } | null>(null);
  const [savingAction, setSavingAction] = useState(false);
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (status !== "ALL") params.set("status", status);
      if (source !== "ALL") params.set("source", source);

      const data = await parseResponse<MaintenancePayload>(
        await fetch(`/api/manutencao?${params.toString()}`, { cache: "no-store", signal }),
        "Falha ao carregar OS de manutencao."
      );
      setOrders(data.items || []);
      setBranches(data.branches || []);
      setCapabilities(data.capabilities || {});
      setCounts(data.counts);
      setTotal(data.total || 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Falha ao carregar OS de manutencao.");
      setOrders([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, source, status]);

  useEffect(() => {
    if (!dialogOpen) return;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      if (form.branchId) params.set("branchId", form.branchId);
      void fetch(`/api/manutencao/assets?${params}`, { cache: "no-store", signal: controller.signal })
        .then((response) => parseResponse<{ success: true; items: MaintenanceAssetOption[] }>(response, "Falha ao carregar ativos da filial."))
        .then((data) => setAssets(data.items || [])).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error(error instanceof Error ? error.message : "Falha ao carregar ativos da filial.");
      });
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [dialogOpen, form.branchId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void loadOrders(controller.signal));
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadOrders]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key: string, value: string, fallback: string) => {
      if (value === fallback) params.delete(key);
      else params.set(key, value);
    };
    setOrDelete("q", debouncedSearch, "");
    setOrDelete("status", status, "ALL");
    setOrDelete("source", source, "ALL");
    setOrDelete("page", String(page), "1");
    setOrDelete("pageSize", String(pageSize), "20");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [debouncedSearch, page, pageSize, source, status]);

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

  async function confirmStatusTransition() {
    if (!transitionDialog) return;
    if (["CANCELADA", "FINALIZADA", "CONCLUIDA"].includes(transitionDialog.nextStatus) && !transitionDialog.comment.trim()) {
      toast.error("Informe um comentario para esta transicao.");
      return;
    }
    setSavingAction(true);
    try {
      await parseResponse(
        await fetch(`/api/manutencao/${transitionDialog.order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: transitionDialog.nextStatus, transitionComment: transitionDialog.comment.trim() || null }),
        }),
        "Falha ao atualizar status da OS."
      );
      toast.success(`OS ${transitionDialog.order.code} atualizada para ${transitionDialog.nextStatus.replaceAll("_", " ")}.`);
      setTransitionDialog(null);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar status da OS.");
    } finally {
      setSavingAction(false);
    }
  }

  async function reviewCompletion() {
    if (!reviewDialog) return;
    if (!reviewDialog.notes.trim()) {
      toast.error("Informe um comentario para a decisao.");
      return;
    }
    setSavingAction(true);
    try {
      await parseResponse(
        await fetch(`/api/manutencao/${reviewDialog.order.id}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: reviewDialog.decision, notes: reviewDialog.notes.trim() }),
        }),
        "Falha ao revisar a conclusao da OS."
      );
      toast.success(reviewDialog.decision === "APPROVE" ? "Conclusao aprovada." : "Conclusao rejeitada para ajuste.");
      setReviewDialog(null);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao revisar a conclusao da OS.");
    } finally {
      setSavingAction(false);
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="stitch-soft-button" onClick={() => openCreate("manual")} disabled={capabilities.CREATE_ORDER === false}>
            <Plus className="size-4" />
            Nova OS manual
          </Button>
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => openCreate("fluig")} disabled={capabilities.CREATE_ORDER === false}>
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
          <Select value={status} onValueChange={(value) => { setStatus(value as MaintenanceOrderStatus | "ALL"); setPage(1); }}>
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
          <Select value={source} onValueChange={(value) => { setSource(value as MaintenanceOrderSource | "ALL"); setPage(1); }}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as origens</SelectItem>
              <SelectItem value="manual">Ferramenta</SelectItem>
              <SelectItem value="fluig">Fluig</SelectItem>
              <SelectItem value="preventiva">Preventiva</SelectItem>
              <SelectItem value="checklist">Checklist</SelectItem>
              <SelectItem value="alerta">Alerta</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-3">
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <Card key={`maintenance-skeleton-${index}`} className="rounded-lg shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </CardContent>
              </Card>
            ))
          ) : orders.length ? (
            orders.map((order) => (
              <MaintenanceOrderCard
                key={order.id}
                order={order}
                activeFluigJob={activeFluigJob?.orderId === order.id ? activeFluigJob : null}
                onEdit={() => openEdit(order)}
                onViewPhotos={() => void viewPhotos(order)}
                onQuickStatus={(nextStatus) => setTransitionDialog({ order, nextStatus, comment: "" })}
                onReview={(decision) => setReviewDialog({ order, decision, notes: "" })}
                onOpenFluig={() => void openOrderInFluig(order)}
                canEdit={capabilities.EDIT_ORDER !== false}
                canChangeStatus={capabilities.CHANGE_STATUS !== false}
                canFinish={capabilities.FINISH_ORDER !== false}
                canApproveCompletion={capabilities.APPROVE_COMPLETION !== false}
              />
            ))
          ) : (
            <EmptyState title="Nenhuma OS real encontrada" />
          )}
          <div className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} de ${total}` : "0 OS"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => { setPageSize(Number(value) as (typeof maintenancePageSizes)[number]); setPage(1); }}
              >
                <SelectTrigger className="w-[108px]" aria-label="OS por pagina">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {maintenancePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size} por pagina</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" size="icon" variant="outline" title="Pagina anterior" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="size-4" />
                <span className="sr-only">Pagina anterior</span>
              </Button>
              <span className="min-w-20 text-center text-sm">{page} de {pageCount}</span>
              <Button type="button" size="icon" variant="outline" title="Proxima pagina" disabled={page >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                <ChevronRight className="size-4" />
                <span className="sr-only">Proxima pagina</span>
              </Button>
            </div>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
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
        assets={assets}
        capabilities={capabilities}
        photoUploads={photoUploads}
        saving={saving}
        updateForm={updateForm}
        onPhotoFilesChange={handlePhotoFiles}
        submitOrder={submitOrder}
        onExecutionChanged={loadOrders}
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

      <Dialog open={Boolean(transitionDialog)} onOpenChange={(open) => { if (!open && !savingAction) setTransitionDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Alterar status da OS</DialogTitle>
            <DialogDescription>{transitionDialog ? `${transitionDialog.order.code}: ${transitionDialog.order.status.replaceAll("_", " ")} para ${transitionDialog.nextStatus.replaceAll("_", " ")}.` : "Confirme a transicao."}</DialogDescription>
          </DialogHeader>
          <FormField label="Comentario" required={Boolean(transitionDialog && ["CANCELADA", "FINALIZADA", "CONCLUIDA"].includes(transitionDialog.nextStatus))}>
            <Textarea value={transitionDialog?.comment || ""} onChange={(event) => setTransitionDialog((current) => current ? { ...current, comment: event.target.value } : null)} placeholder="Contexto da mudanca para a timeline e auditoria" />
          </FormField>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setTransitionDialog(null)} disabled={savingAction}>Voltar</Button><Button type="button" variant={transitionDialog?.nextStatus === "CANCELADA" ? "destructive" : "default"} onClick={() => void confirmStatusTransition()} disabled={savingAction}>{savingAction ? <Loader2 className="size-4 animate-spin" /> : null}Confirmar transicao</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewDialog)} onOpenChange={(open) => { if (!open && !savingAction) setReviewDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{reviewDialog?.decision === "APPROVE" ? "Aprovar conclusao" : "Rejeitar conclusao"}</DialogTitle><DialogDescription>{reviewDialog ? `${reviewDialog.order.code}: registre a decisao que ficara na timeline da OS.` : "Revise a conclusao."}</DialogDescription></DialogHeader>
          <FormField label="Comentario da revisao" required><Textarea value={reviewDialog?.notes || ""} onChange={(event) => setReviewDialog((current) => current ? { ...current, notes: event.target.value } : null)} /></FormField>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setReviewDialog(null)} disabled={savingAction}>Voltar</Button><Button type="button" variant={reviewDialog?.decision === "REJECT" ? "destructive" : "default"} onClick={() => void reviewCompletion()} disabled={savingAction}>{savingAction ? <Loader2 className="size-4 animate-spin" /> : null}{reviewDialog?.decision === "APPROVE" ? "Aprovar" : "Rejeitar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MaintenanceOrderCard({
  order,
  onEdit,
  onViewPhotos,
  onQuickStatus,
  onReview,
  onOpenFluig,
  activeFluigJob,
  canEdit,
  canChangeStatus,
  canFinish,
  canApproveCompletion,
}: {
  order: MaintenanceOrderRecord;
  onEdit: () => void;
  onViewPhotos: () => void;
  onQuickStatus: (status: MaintenanceOrderStatus) => void;
  onReview: (decision: "APPROVE" | "REJECT") => void;
  onOpenFluig: () => void;
  activeFluigJob: ActiveFluigJob | null;
  canEdit: boolean;
  canChangeStatus: boolean;
  canFinish: boolean;
  canApproveCompletion: boolean;
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
                {order.source === "manual" ? "Ferramenta" : order.source === "fluig" ? "Fluig" : maintenanceSourceLabel(order.source)}
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
                title={hasFluigModel ? "Abrir processo no Fluig diretamente pela VPS" : "Informe o modelo Fluig na OS"}
              >
                {activeFluigJob ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                Abrir no Fluig
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="stitch-soft-button w-fit" onClick={onEdit} disabled={!canEdit}>
              Atualizar OS
            </Button>
          </div>
        </div>

        <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          <Field label="Area" value={order.area} />
          <Field label="Tipo" value={order.workType.replaceAll("_", " ")} />
          <Field label="Ativo" value={order.asset ? `${order.asset.internal_code} - ${order.asset.name}` : "-"} />
          <Field label="Filial" value={order.branch.label || order.branch.code || "-"} />
          <Field label="Tecnico" value={order.technician || "-"} />
          <Field label="Prazo" value={formatDate(order.dueAt)} />
          <Field label="Inicio" value={formatDateTime(order.startedAt)} />
          <Field label="Custo total" value={moneyFromCents(order.totalCostCents || order.materialCostCents)} />
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
              {activeFluigJob.progressLabel || "Aguardando o executor da VPS assumir a abertura da OS."}
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

        {order.approvalStatus !== "NOT_REQUIRED" ? <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm"><span className="text-muted-foreground">Aprovacao da conclusao:</span><StatusBadge status={order.approvalStatus} />{order.approval.notes ? <span className="min-w-0 flex-1 text-muted-foreground">{order.approval.notes}</span> : null}{order.approvalStatus === "PENDING" && canApproveCompletion && ["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(order.status) ? <><Button type="button" size="sm" variant="outline" onClick={() => onReview("REJECT")}>Rejeitar</Button><Button type="button" size="sm" onClick={() => onReview("APPROVE")}>Aprovar</Button></> : null}</div> : null}
        {statusTransitions[order.status].length && canChangeStatus ? <div className="flex flex-wrap gap-2">{statusTransitions[order.status].slice(0, 5).map((nextStatus) => { const approvalBlocksFinish = nextStatus === "FINALIZADA" && ["PENDING", "REJECTED"].includes(order.approvalStatus); return <Button key={nextStatus} type="button" variant={nextStatus === "FINALIZADA" || nextStatus === "CONCLUIDA" ? "default" : "outline"} size="sm" onClick={() => onQuickStatus(nextStatus)} disabled={(nextStatus === "FINALIZADA" && !canFinish) || approvalBlocksFinish} title={approvalBlocksFinish ? "A conclusao precisa ser aprovada antes da finalizacao." : undefined}>{nextStatus.replaceAll("_", " ")}</Button>; })}</div> : null}
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
  assets,
  capabilities,
  photoUploads,
  saving,
  updateForm,
  onPhotoFilesChange,
  submitOrder,
  onExecutionChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: MaintenanceOrderRecord | null;
  form: FormState;
  branches: MaintenanceBranch[];
  assets: MaintenanceAssetOption[];
  capabilities: Record<string, boolean>;
  photoUploads: PhotoUploadDraft[];
  saving: boolean;
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onPhotoFilesChange: (files: FileList | null) => void;
  submitOrder: () => Promise<void>;
  onExecutionChanged: () => void | Promise<void>;
}) {
  const availableStatuses = editing
    ? [editing.status, ...statusTransitions[editing.status]]
    : ["ABERTA" as MaintenanceOrderStatus];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Atualizar ${editing.code}` : "Nova OS de manutencao"}</DialogTitle>
          <DialogDescription>
            Selecione se a OS fica somente na ferramenta ou se acompanha um processo Fluig de manutencao/ativo.
          </DialogDescription>
        </DialogHeader>

        {form.source === "manual" || form.source === "fluig" ? <Tabs value={form.source} onValueChange={(value) => updateForm("source", value as MaintenanceOrderSource)}>
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
        </Tabs> : <FlowNotice description={`Origem ${maintenanceSourceLabel(form.source)} gerada automaticamente. A origem permanece preservada durante a edicao.`} />}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Titulo" required>
            <Input value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
          </FormField>
          <FormField label="Area" required>
            <Select value={form.area} onValueChange={(value) => updateForm("area", value)}>
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
            <Select value={form.branchId} onValueChange={(value) => { updateForm("branchId", value); updateForm("assetId", ""); }}>
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
          <FormField label="Tipo de manutencao">
            <Select value={form.workType} onValueChange={(value) => updateForm("workType", value as MaintenanceOrderWorkType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{workTypeOptions.map((type) => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Equipamento ou ativo">
            <Select value={form.assetId || "NONE"} onValueChange={(value) => updateForm("assetId", value === "NONE" ? "" : value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="NONE">Sem ativo vinculado</SelectItem>{assets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.internal_code} - {asset.name}{asset.asset_tag ? ` (${asset.asset_tag})` : ""}</SelectItem>)}</SelectContent>
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
          <FormField label="SLA (minutos)">
            <Input inputMode="numeric" value={form.slaMinutes} onChange={(event) => updateForm("slaMinutes", event.target.value)} />
          </FormField>
          <FormField label="Status">
            <Select value={form.status} onValueChange={(value) => updateForm("status", value as MaintenanceOrderStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableStatuses.map((option) => (
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
          {form.materialSummary || form.materials.length ? <div className="space-y-2 rounded-md border bg-muted/20 p-3 md:col-span-2"><p className="text-sm font-medium">Historico de materiais anterior ao estoque</p>{form.materialSummary ? <p className="text-sm text-muted-foreground">{form.materialSummary}</p> : null}{form.materials.map((material, index) => <div key={`${material.item}-${index}`} className="flex flex-wrap justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs"><span>{material.item} / {material.quantity || "quantidade nao informada"}</span><span>{moneyFromCents(centsFromMoney(material.value))}</span></div>)}</div> : null}
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
          <FormField label="Diagnostico" className="md:col-span-2">
            <Textarea value={form.diagnosis} onChange={(event) => updateForm("diagnosis", event.target.value)} />
          </FormField>
          <FormField label="Causa raiz">
            <Textarea value={form.rootCause} onChange={(event) => updateForm("rootCause", event.target.value)} />
          </FormField>
          <FormField label="Solucao executada">
            <Textarea value={form.executedSolution} onChange={(event) => updateForm("executedSolution", event.target.value)} />
          </FormField>
          <FormField label="Tempo de parada (minutos)">
            <Input inputMode="numeric" value={form.downtimeMinutes} onChange={(event) => updateForm("downtimeMinutes", event.target.value)} />
          </FormField>
          <FormField label="Custo de mao de obra">
            <Input inputMode="decimal" value={form.laborCost} onChange={(event) => updateForm("laborCost", event.target.value)} placeholder="R$ 0,00" />
          </FormField>
          <FormField label="Outros custos">
            <Input inputMode="decimal" value={form.otherCost} onChange={(event) => updateForm("otherCost", event.target.value)} placeholder="R$ 0,00" />
          </FormField>
          <FormField label="Conclusao / observacoes finais" className="md:col-span-2">
            <Textarea value={form.completionNotes} onChange={(event) => updateForm("completionNotes", event.target.value)} />
          </FormField>
          <label className="flex cursor-pointer items-center gap-2 text-sm md:col-span-2"><Checkbox checked={form.completionApprovalRequired} onCheckedChange={(checked) => updateForm("completionApprovalRequired", checked === true)} />Exigir validacao antes de finalizar a OS</label>
        </div>

        {editing ? <MaintenanceOrderExecutionPanel orderId={editing.id} branchId={editing.branch.id} canMoveStock={Boolean(capabilities.MOVE_STOCK)} onChanged={onExecutionChanged} /> : <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Depois de criar a OS, abra novamente para reservar e consumir materiais diretamente do estoque.</div>}

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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
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
