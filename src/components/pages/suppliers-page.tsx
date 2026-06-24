"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Edit3,
  Eye,
  FileSearch,
  Loader2,
  Plus,
  Power,
  PowerOff,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { FluigIntegrationPanel } from "@/components/shared/fluig-integration-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ModuleConfig } from "@/lib/admin-data";
import { formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj";
import { cn } from "@/lib/utils";

type SupplierStatus = "ATIVO" | "PENDENTE_REVISAO" | "INATIVO";
type SupplierSourceSystem = "LOCAL" | "FLUIG" | "LOCAL_FLUIG" | "PRE_CADASTRO_FLUIG";
type SupplierSyncStatus = "NAO_SINCRONIZADO" | "SINCRONIZADO" | "PENDENTE_REVISAO" | "ERRO_SYNC";

type SupplierBranch = {
  id: string;
  code: string | null;
  name: string | null;
  fluigLabel: string | null;
  active: boolean;
  defaultBranch: boolean;
};

type SupplierRecord = {
  id: string;
  cnpj: string | null;
  cnpjNormalizado: string | null;
  cnpjFormatado: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  categoria: string | null;
  status: SupplierStatus;
  email: string | null;
  telefone: string | null;
  contatoPrincipal: string | null;
  endereco?: {
    cep?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    pais?: string | null;
  };
  observacoes: string | null;
  fluig: {
    name: string | null;
    code: string | null;
    supplierLabel: string | null;
    defaultSourceRequestId: string | null;
    defaultPayload: Record<string, unknown>;
    lastSyncAt: string | null;
  };
  sourceSystem: SupplierSourceSystem;
  syncStatus: SupplierSyncStatus;
  requestCount: number;
  branches: SupplierBranch[];
  updatedAt: string;
  deletedAt: string | null;
};

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  fluigLabel: string | null;
  active: boolean;
};

type SupplierFormState = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  categoria: string;
  status: SupplierStatus;
  email: string;
  telefone: string;
  contatoPrincipal: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  pais: string;
  observacoes: string;
  fluigName: string;
  fluigCode: string;
  fluigSupplierLabel: string;
  defaultSourceRequestId: string;
  defaultPayload: Record<string, unknown>;
  sourceSystem: SupplierSourceSystem;
  syncStatus: SupplierSyncStatus;
  branchIds: string[];
};

type LookupSuggestions = Partial<SupplierFormState> & {
  linkId?: string;
  candidateId?: string;
  confidence?: number;
  sourceRequestIds?: string[];
  defaultPayload?: Record<string, unknown>;
  sourceTable?: string;
  branchCode?: string;
  branchLabel?: string;
  latestRequestId?: string;
  autoFilledFields?: string[];
  reviewFields?: string[];
};

type LookupResult = {
  source: "local" | "fluig_candidate" | "fluig_catalog" | "fluig_request" | "not_found";
  supplier: SupplierRecord | null;
  suggestions: LookupSuggestions;
  warnings: string[];
};

const lookupSourceLabels: Record<LookupResult["source"], string> = {
  local: "Cadastro local",
  fluig_candidate: "Pre-cadastro Fluig",
  fluig_catalog: "Catalogo Fluig",
  fluig_request: "Solicitacao Fluig",
  not_found: "Nao encontrado",
};

type SuppliersPayload = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  items: SupplierRecord[];
  permissions?: PagePermissions;
};

type PagePermissions = {
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  canReconcile?: boolean;
};

const sourceLabels: Record<SupplierSourceSystem, string> = {
  LOCAL: "Local",
  FLUIG: "Fluig",
  LOCAL_FLUIG: "Local + Fluig",
  PRE_CADASTRO_FLUIG: "Pre-cadastro Fluig",
};

const syncLabels: Record<SupplierSyncStatus, string> = {
  NAO_SINCRONIZADO: "Nao sincronizado",
  SINCRONIZADO: "Sincronizado",
  PENDENTE_REVISAO: "Pendente revisao",
  ERRO_SYNC: "Erro de sync",
};

const initialForm: SupplierFormState = {
  cnpj: "",
  razaoSocial: "",
  nomeFantasia: "",
  categoria: "",
  status: "ATIVO",
  email: "",
  telefone: "",
  contatoPrincipal: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  pais: "BR",
  observacoes: "",
  fluigName: "",
  fluigCode: "",
  fluigSupplierLabel: "",
  defaultSourceRequestId: "",
  defaultPayload: {},
  sourceSystem: "LOCAL",
  syncStatus: "NAO_SINCRONIZADO",
  branchIds: [],
};

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; success?: boolean };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || fallbackMessage);
  }
  return data as T;
}

function formFromSupplier(supplier: SupplierRecord): SupplierFormState {
  return {
    cnpj: supplier.cnpjNormalizado || supplier.cnpj || "",
    razaoSocial: supplier.razaoSocial || "",
    nomeFantasia: supplier.nomeFantasia || "",
    categoria: supplier.categoria || "",
    status: supplier.status || "ATIVO",
    email: supplier.email || "",
    telefone: supplier.telefone || "",
    contatoPrincipal: supplier.contatoPrincipal || "",
    cep: supplier.endereco?.cep || "",
    endereco: supplier.endereco?.endereco || "",
    numero: supplier.endereco?.numero || "",
    complemento: supplier.endereco?.complemento || "",
    bairro: supplier.endereco?.bairro || "",
    cidade: supplier.endereco?.cidade || "",
    uf: supplier.endereco?.uf || "",
    pais: supplier.endereco?.pais || "BR",
    observacoes: supplier.observacoes || "",
    fluigName: supplier.fluig.name || "",
    fluigCode: supplier.fluig.code || "",
    fluigSupplierLabel: supplier.fluig.supplierLabel || "",
    defaultSourceRequestId: supplier.fluig.defaultSourceRequestId || "",
    defaultPayload: supplier.fluig.defaultPayload || {},
    sourceSystem: supplier.sourceSystem || "LOCAL",
    syncStatus: supplier.syncStatus || "NAO_SINCRONIZADO",
    branchIds: supplier.branches.map((branch) => branch.id),
  };
}

function buildSupplierPayload(form: SupplierFormState) {
  return {
    cnpj: nullable(form.cnpj),
    razaoSocial: form.razaoSocial.trim(),
    nomeFantasia: nullable(form.nomeFantasia),
    categoria: nullable(form.categoria),
    status: form.status,
    email: nullable(form.email),
    telefone: nullable(form.telefone),
    contatoPrincipal: nullable(form.contatoPrincipal),
    cep: nullable(form.cep),
    endereco: nullable(form.endereco),
    numero: nullable(form.numero),
    complemento: nullable(form.complemento),
    bairro: nullable(form.bairro),
    cidade: nullable(form.cidade),
    uf: nullable(form.uf),
    pais: nullable(form.pais) || "BR",
    observacoes: nullable(form.observacoes),
    fluigName: nullable(form.fluigName),
    fluigCode: nullable(form.fluigCode),
    fluigSupplierLabel: nullable(form.fluigSupplierLabel),
    defaultSourceRequestId: nullable(form.defaultSourceRequestId),
    defaultPayload: form.defaultPayload,
    sourceSystem: form.sourceSystem,
    syncStatus: form.syncStatus,
    branchIds: form.branchIds,
  };
}

function metricValue(items: SupplierRecord[], predicate: (item: SupplierRecord) => boolean) {
  return items.filter(predicate).length;
}

export function SuppliersPage({
  config,
  initialOpenForm = false,
}: {
  config: ModuleConfig;
  initialOpenForm?: boolean;
}) {
  const [items, setItems] = useState<SupplierRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [permissions, setPermissions] = useState<PagePermissions>({ canView: true, canCreate: false, canUpdate: false, canApprove: false });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | SupplierStatus>("ALL");
  const [sourceSystem, setSourceSystem] = useState<"ALL" | SupplierSourceSystem>("ALL");
  const [syncStatus, setSyncStatus] = useState<"ALL" | SupplierSyncStatus>("ALL");
  const [branchId, setBranchId] = useState("ALL");
  const [attention, setAttention] = useState<"ALL" | "PENDING" | "ERROR">("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [syncingSupplierId, setSyncingSupplierId] = useState<string | null>(null);
  const [statusChangingSupplierId, setStatusChangingSupplierId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(initialOpenForm);
  const [editing, setEditing] = useState<SupplierRecord | null>(null);
  const [viewing, setViewing] = useState<SupplierRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierRecord | null>(null);
  const [inactivateTarget, setInactivateTarget] = useState<SupplierRecord | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [form, setForm] = useState<SupplierFormState>(initialForm);
  const pageSize = 25;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (status !== "ALL") params.set("status", status);
      if (sourceSystem !== "ALL") params.set("sourceSystem", sourceSystem);
      if (syncStatus !== "ALL") params.set("syncStatus", syncStatus);
      if (branchId !== "ALL") params.set("branchId", branchId);
      if (attention !== "ALL") params.set("attention", attention);

      const data = await parseResponse<SuppliersPayload>(
        await fetch(`/api/fornecedores?${params.toString()}`, { cache: "no-store" }),
        "Falha ao listar fornecedores."
      );
      setItems(data.items || []);
      setPermissions(data.permissions || { canView: true, canCreate: false, canUpdate: false, canApprove: false });
      setTotal(data.total || 0);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Falha ao listar fornecedores.";
      setError(message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [attention, branchId, debouncedSearch, page, sourceSystem, status, syncStatus]);

  const loadBranches = useCallback(async () => {
    try {
      const data = await parseResponse<{ success: true; items: BranchRecord[] }>(
        await fetch("/api/admin/branches?pageSize=200&active=true", { cache: "no-store" }),
        "Falha ao listar filiais."
      );
      setBranches(data.items || []);
    } catch {
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSuppliers();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadSuppliers]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadBranches();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadBranches]);

  function resetForm() {
    setEditing(null);
    setLookupResult(null);
    setForm(initialForm);
  }

  function openCreateDialog() {
    if (!permissions.canCreate) {
      toast.error("Usuario sem permissao para criar fornecedores.");
      return;
    }
    resetForm();
    setDialogOpen(true);
  }

  function openEditDialog(supplier: SupplierRecord) {
    if (!permissions.canUpdate) {
      toast.error("Usuario sem permissao para editar fornecedores.");
      return;
    }
    setEditing(supplier);
    setLookupResult(null);
    setForm(formFromSupplier(supplier));
    setDialogOpen(true);
  }

  function updateForm<K extends keyof SupplierFormState>(key: K, value: SupplierFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleBranch(branchId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      branchIds: checked
        ? Array.from(new Set([...current.branchIds, branchId]))
        : current.branchIds.filter((id) => id !== branchId),
    }));
  }

  function applyLookupSuggestions(result: LookupResult) {
    const suggestions = result.suggestions || {};
    const suggestedBranch = branches.find((branch) => {
      const branchCode = String(suggestions.branchCode || "").trim();
      const branchLabel = String(suggestions.branchLabel || "").trim().toLocaleLowerCase("pt-BR");
      return (
        (branchCode && branch.code === branchCode) ||
        (branchLabel &&
          [branch.fluigLabel, branch.name]
            .filter(Boolean)
            .some((value) => String(value).trim().toLocaleLowerCase("pt-BR") === branchLabel))
      );
    });
    setForm((current) => ({
      ...current,
      cnpj: String(suggestions.cnpj || current.cnpj || ""),
      razaoSocial: String(suggestions.razaoSocial || current.razaoSocial || ""),
      fluigName: String(suggestions.fluigName || current.fluigName || ""),
      fluigCode: String(suggestions.fluigCode || current.fluigCode || ""),
      fluigSupplierLabel: String(suggestions.fluigSupplierLabel || suggestions.fluigName || current.fluigSupplierLabel || ""),
      defaultSourceRequestId: String(suggestions.defaultSourceRequestId || current.defaultSourceRequestId || ""),
      defaultPayload: suggestions.defaultPayload || current.defaultPayload || {},
      sourceSystem: result.source === "fluig_candidate" ? "PRE_CADASTRO_FLUIG" : result.source === "not_found" ? "LOCAL" : "FLUIG",
      syncStatus: result.source === "not_found" ? "NAO_SINCRONIZADO" : "PENDENTE_REVISAO",
      branchIds: suggestedBranch
        ? Array.from(new Set([...current.branchIds, suggestedBranch.id]))
        : current.branchIds,
    }));
  }

  async function lookupCnpj(rawCnpj = form.cnpj) {
    const cnpj = onlyDigits(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      toast.error("Informe um CNPJ valido para consultar.");
      return;
    }

    setLookupLoading(true);
    setLookupResult(null);
    try {
      const data = await parseResponse<{ success: true } & LookupResult>(
        await fetch(`/api/fornecedores/lookup?cnpj=${cnpj}`, { cache: "no-store" }),
        "Falha ao consultar CNPJ."
      );
      const result: LookupResult = {
        source: data.source,
        supplier: data.supplier,
        suggestions: data.suggestions || {},
        warnings: data.warnings || [],
      };
      setLookupResult(result);
      if (result.source === "local") {
        toast.warning("Fornecedor ja cadastrado para este CNPJ.");
      } else if (result.source === "not_found") {
        toast.info("CNPJ nao encontrado no cadastro local nem no historico Fluig.");
      } else {
        applyLookupSuggestions(result);
        toast.success("Dados do historico Fluig aplicados ao formulario.");
      }
    } catch (lookupError) {
      toast.error(lookupError instanceof Error ? lookupError.message : "Falha ao consultar CNPJ.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function submitSupplier() {
    if (!form.razaoSocial.trim()) {
      toast.error("Razao social e obrigatoria.");
      return;
    }
    if (form.cnpj && !isValidCnpj(form.cnpj)) {
      toast.error("CNPJ invalido.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildSupplierPayload(form);
      const response = await fetch(editing ? `/api/fornecedores/${editing.id}` : "/api/fornecedores", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await parseResponse(response, editing ? "Falha ao editar fornecedor." : "Falha ao criar fornecedor.");
      toast.success(editing ? "Fornecedor atualizado." : "Fornecedor criado.");
      setDialogOpen(false);
      resetForm();
      await loadSuppliers();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Falha ao salvar fornecedor.");
    } finally {
      setSaving(false);
    }
  }

  async function approveCandidate() {
    const candidateId = lookupResult?.suggestions?.candidateId;
    if (!candidateId) return;

    setSaving(true);
    try {
      await parseResponse(
        await fetch(`/api/fornecedores/candidates/${candidateId}/approve`, { method: "POST" }),
        "Falha ao converter candidato Fluig."
      );
      toast.success("Candidato Fluig convertido em fornecedor.");
      setDialogOpen(false);
      resetForm();
      await loadSuppliers();
    } catch (approveError) {
      toast.error(approveError instanceof Error ? approveError.message : "Falha ao converter candidato Fluig.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const data = await parseResponse<{ success: true; deleted?: boolean; softDeleted?: boolean }>(
        await fetch(`/api/fornecedores/${deleteTarget.id}`, { method: "DELETE" }),
        "Falha ao excluir fornecedor."
      );
      toast.success(data.softDeleted ? "Fornecedor inativado por possuir vinculos." : "Fornecedor excluido.");
      setDeleteTarget(null);
      await loadSuppliers();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Falha ao excluir fornecedor.");
    } finally {
      setSaving(false);
    }
  }

  async function updateSupplierStatus(supplier: SupplierRecord, nextStatus: "ATIVO" | "INATIVO") {
    setStatusChangingSupplierId(supplier.id);
    try {
      await parseResponse(
        await fetch(`/api/fornecedores/${supplier.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        }),
        nextStatus === "ATIVO" ? "Falha ao reativar fornecedor." : "Falha ao inativar fornecedor."
      );
      toast.success(nextStatus === "ATIVO" ? "Fornecedor reativado." : "Fornecedor inativado.");
      setInactivateTarget(null);
      await loadSuppliers();
    } catch (statusError) {
      toast.error(
        statusError instanceof Error
          ? statusError.message
          : nextStatus === "ATIVO"
            ? "Falha ao reativar fornecedor."
            : "Falha ao inativar fornecedor."
      );
    } finally {
      setStatusChangingSupplierId(null);
    }
  }

  async function reconcileHistoricalSuppliers() {
    setReconciling(true);
    try {
      const data = await parseResponse<{
        success: true;
        persistence: {
          saved: Record<string, number>;
        };
      }>(
        await fetch("/api/fornecedores/reconcile", { method: "POST" }),
        "Falha ao atualizar pre-cadastros do Fluig."
      );
      const created = Number(data.persistence.saved.supplierPreRegistrations || 0);
      const branches = Number(data.persistence.saved.supplierBranchLinks || 0);
      toast.success(
        created
          ? `${created} pre-cadastros criados e ${branches} vinculos de filial reconciliados.`
          : `Pre-cadastros atualizados. ${branches} vinculos de filial reconciliados.`
      );
      await loadSuppliers();
    } catch (reconcileError) {
      toast.error(
        reconcileError instanceof Error
          ? reconcileError.message
          : "Falha ao atualizar pre-cadastros do Fluig."
      );
    } finally {
      setReconciling(false);
    }
  }

  async function syncSupplierWithFluig(supplier: SupplierRecord) {
    const cnpj = supplier.cnpjNormalizado || supplier.cnpj || "";
    if (!isValidCnpj(cnpj)) {
      toast.error("Fornecedor sem CNPJ valido para sincronizar no Fluig.");
      return;
    }

    setSyncingSupplierId(supplier.id);
    try {
      const data = await parseResponse<{ success: true; job: { id: string; status: string }; supplier?: SupplierRecord | null }>(
        await fetch(`/api/fornecedores/${supplier.id}/sync-fluig`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: 730, pageSize: 100, maxPages: 100 }),
        }),
        "Falha ao sincronizar fornecedor no Fluig."
      );
      toast.success(`Consulta enviada ao agente Fluig. Job ${data.job.id.slice(0, 8)}.`);
      await loadSuppliers();
    } catch (syncError) {
      toast.error(syncError instanceof Error ? syncError.message : "Falha ao sincronizar fornecedor no Fluig.");
    } finally {
      setSyncingSupplierId(null);
    }
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const metrics = useMemo(
    () => [
      {
        label: "Total encontrado",
        value: total,
        helper: "Consulta paginada no Supabase",
      },
      {
        label: "Pendentes na pagina",
        value: metricValue(items, (item) => item.status === "PENDENTE_REVISAO" || item.syncStatus === "PENDENTE_REVISAO"),
        helper: "Precisam revisao cadastral",
      },
      {
        label: "Com Fluig",
        value: metricValue(items, (item) => item.sourceSystem !== "LOCAL" || Boolean(item.fluig.code || item.fluig.name)),
        helper: "Ligados ao historico Fluig",
      },
    ],
    [items, total]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description="Cadastro real de fornecedores com CNPJ unico, vinculo Fluig, filiais e historico de solicitacoes."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric, index) => (
          <Card key={metric.label} className={cn("stitch-animate-in rounded-lg shadow-none", index === 1 && "stitch-delay-100", index === 2 && "stitch-delay-200")}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <Building2 className="size-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="stitch-animate-in stitch-delay-200 rounded-lg shadow-none">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative min-w-0 flex-1 xl:max-w-xl">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
                placeholder="Buscar por CNPJ, razao social, nome Fluig ou codigo"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:w-[980px] xl:grid-cols-5">
              <Select value={status} onValueChange={(value) => { setStatus(value as typeof status); setPage(1); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos os status</SelectItem>
                  <SelectItem value="ATIVO">Ativos</SelectItem>
                  <SelectItem value="PENDENTE_REVISAO">Pendentes</SelectItem>
                  <SelectItem value="INATIVO">Inativos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceSystem} onValueChange={(value) => { setSourceSystem(value as typeof sourceSystem); setPage(1); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Origem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas as origens</SelectItem>
                  <SelectItem value="LOCAL">Local</SelectItem>
                  <SelectItem value="FLUIG">Fluig</SelectItem>
                  <SelectItem value="LOCAL_FLUIG">Local + Fluig</SelectItem>
                  <SelectItem value="PRE_CADASTRO_FLUIG">Pre-cadastro</SelectItem>
                </SelectContent>
              </Select>
              <Select value={syncStatus} onValueChange={(value) => { setSyncStatus(value as typeof syncStatus); setPage(1); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sincronizacao" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas syncs</SelectItem>
                  <SelectItem value="NAO_SINCRONIZADO">Nao sincronizado</SelectItem>
                  <SelectItem value="SINCRONIZADO">Sincronizado</SelectItem>
                  <SelectItem value="PENDENTE_REVISAO">Pendente revisao</SelectItem>
                  <SelectItem value="ERRO_SYNC">Erro sync</SelectItem>
                </SelectContent>
              </Select>
              <Select value={branchId} onValueChange={(value) => { setBranchId(value); setPage(1); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Filial" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas as filiais</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.code} - {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={attention} onValueChange={(value) => { setAttention(value as typeof attention); setPage(1); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Situacao" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas as situacoes</SelectItem>
                  <SelectItem value="PENDING">Com pendencia</SelectItem>
                  <SelectItem value="ERROR">Com erro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {loading ? "Consultando fornecedores..." : `${items.length} exibidos de ${total} registros encontrados.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {permissions.canReconcile ? (
                <Button
                  type="button"
                  variant="outline"
                  className="stitch-soft-button"
                  onClick={() => void reconcileHistoricalSuppliers()}
                  disabled={reconciling}
                >
                  <RefreshCcw className={cn("size-4", reconciling && "animate-spin")} />
                  Atualizar pre-cadastros
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="stitch-soft-button" onClick={loadSuppliers} disabled={loading}>
                <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
                Atualizar
              </Button>
              {permissions.canCreate ? (
                <Button type="button" className="stitch-soft-button" onClick={openCreateDialog}>
                  <Plus className="size-4" />
                  Novo fornecedor
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <FluigIntegrationPanel moduleSlug="fornecedores" compact />

      <Card className="stitch-animate-in rounded-lg shadow-none">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Fornecedores cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-4 text-sm font-medium text-destructive">{error}</div>
          ) : loading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando fornecedores reais...
            </div>
          ) : items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Fornecedor</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Fluig</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Filiais</TableHead>
                  <TableHead>Solicitacoes</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="font-medium">{supplier.razaoSocial}</div>
                      <div className="text-xs text-muted-foreground">{supplier.nomeFantasia || supplier.categoria || "Sem complemento cadastral"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{supplier.cnpjFormatado || formatCnpj(supplier.cnpjNormalizado || supplier.cnpj || "") || "-"}</TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal">
                      <div className="text-sm">{supplier.fluig.name || supplier.fluig.supplierLabel || "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        {supplier.fluig.code ? `Codigo ${supplier.fluig.code}` : `Sync ${formatDateTime(supplier.fluig.lastSyncAt)}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceLabels[supplier.sourceSystem]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={supplier.status} />
                        <span className="text-xs text-muted-foreground">{syncLabels[supplier.syncStatus]}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal text-xs">
                      {supplier.branches.length
                        ? supplier.branches.slice(0, 2).map((branch) => branch.code || branch.name).join(", ")
                        : "Sem filial vinculada"}
                      {supplier.branches.length > 2 ? ` +${supplier.branches.length - 2}` : ""}
                    </TableCell>
                    <TableCell>{supplier.requestCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" title="Visualizar" onClick={() => setViewing(supplier)}>
                          <Eye className="size-4" />
                        </Button>
                        {permissions.canUpdate ? (
                          <Button type="button" variant="ghost" size="icon-sm" title="Editar" onClick={() => openEditDialog(supplier)}>
                            <Edit3 className="size-4" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Consultar CNPJ no historico"
                          onClick={() => {
                            setEditing(supplier);
                            setForm(formFromSupplier(supplier));
                            setDialogOpen(true);
                            window.setTimeout(() => void lookupCnpj(supplier.cnpjNormalizado || supplier.cnpj || ""), 0);
                          }}
                        >
                          <FileSearch className="size-4" />
                        </Button>
                        {permissions.canUpdate ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Sincronizar fornecedor no Fluig"
                              disabled={syncingSupplierId === supplier.id || !isValidCnpj(supplier.cnpjNormalizado || supplier.cnpj || "")}
                              onClick={() => void syncSupplierWithFluig(supplier)}
                            >
                              {syncingSupplierId === supplier.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <RefreshCcw className="size-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title={supplier.status === "INATIVO" ? "Reativar fornecedor" : "Inativar fornecedor"}
                              disabled={statusChangingSupplierId === supplier.id}
                              onClick={() => {
                                if (supplier.status === "INATIVO") {
                                  void updateSupplierStatus(supplier, "ATIVO");
                                } else {
                                  setInactivateTarget(supplier);
                                }
                              }}
                            >
                              {statusChangingSupplierId === supplier.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : supplier.status === "INATIVO" ? (
                                <Power className="size-4" />
                              ) : (
                                <PowerOff className="size-4" />
                              )}
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" title="Excluir ou inativar" onClick={() => setDeleteTarget(supplier)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="Nenhum fornecedor real encontrado para os filtros atuais" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Pagina {page} de {totalPages}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(current - 1, 1))}>
            Anterior
          </Button>
          <Button type="button" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(current + 1, totalPages))}>
            Proxima
          </Button>
        </div>
      </div>

      <SupplierFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
        branches={branches}
        editing={editing}
        form={form}
        lookupResult={lookupResult}
        lookupLoading={lookupLoading}
        saving={saving}
        updateForm={updateForm}
        toggleBranch={toggleBranch}
        lookupCnpj={lookupCnpj}
        submitSupplier={submitSupplier}
        approveCandidate={approveCandidate}
        openEditDialog={openEditDialog}
        permissions={permissions}
      />

      <SupplierViewDialog supplier={viewing} onOpenChange={(open) => !open && setViewing(null)} />

      <AlertDialog open={Boolean(inactivateTarget)} onOpenChange={(open) => !open && setInactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              O cadastro permanecera no historico e podera ser reativado depois. Nenhum vinculo existente sera apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(statusChangingSupplierId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!inactivateTarget || Boolean(statusChangingSupplierId)}
              onClick={() => inactivateTarget && void updateSupplierStatus(inactivateTarget, "INATIVO")}
            >
              {statusChangingSupplierId ? <Loader2 className="size-4 animate-spin" /> : <PowerOff className="size-4" />}
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ou inativar fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Se houver solicitacoes Fluig ou vinculos, o sistema vai inativar o cadastro em vez de apagar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={saving} onClick={() => void deleteSupplier()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SupplierFormDialog({
  open,
  onOpenChange,
  branches,
  editing,
  form,
  lookupResult,
  lookupLoading,
  saving,
  updateForm,
  toggleBranch,
  lookupCnpj,
  submitSupplier,
  approveCandidate,
  openEditDialog,
  permissions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: BranchRecord[];
  editing: SupplierRecord | null;
  form: SupplierFormState;
  lookupResult: LookupResult | null;
  lookupLoading: boolean;
  saving: boolean;
  updateForm: <K extends keyof SupplierFormState>(key: K, value: SupplierFormState[K]) => void;
  toggleBranch: (branchId: string, checked: boolean) => void;
  lookupCnpj: (rawCnpj?: string) => Promise<void>;
  submitSupplier: () => Promise<void>;
  approveCandidate: () => Promise<void>;
  openEditDialog: (supplier: SupplierRecord) => void;
  permissions: PagePermissions;
}) {
  const candidateId = lookupResult?.suggestions?.candidateId;
  const canSave = editing ? permissions.canUpdate : permissions.canCreate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>
            Cadastro operacional com validacao por CNPJ, sugestoes do historico Fluig e vinculo com filiais.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="rounded-md border p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Field label="CNPJ">
                  <Input
                    value={form.cnpj}
                    onChange={(event) => updateForm("cnpj", event.target.value)}
                    onBlur={() => updateForm("cnpj", formatCnpj(form.cnpj))}
                    placeholder="00.000.000/0000-00"
                  />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="outline" className="w-full" onClick={() => void lookupCnpj()} disabled={lookupLoading}>
                    {lookupLoading ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}
                    Consultar CNPJ
                  </Button>
                </div>
              </div>
              {form.cnpj && !isValidCnpj(form.cnpj) ? (
                <p className="mt-2 text-xs font-medium text-destructive">CNPJ invalido.</p>
              ) : null}
            </section>

            <section className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
              <Field label="Razao social">
                <Input value={form.razaoSocial} onChange={(event) => updateForm("razaoSocial", event.target.value)} />
              </Field>
              <Field label="Nome fantasia">
                <Input value={form.nomeFantasia} onChange={(event) => updateForm("nomeFantasia", event.target.value)} />
              </Field>
              <Field label="Categoria">
                <Input value={form.categoria} onChange={(event) => updateForm("categoria", event.target.value)} placeholder="Ex.: SERVICOS, INSUMOS" />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(value) => updateForm("status", value as SupplierStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATIVO">Ativo</SelectItem>
                    <SelectItem value="PENDENTE_REVISAO">Pendente revisao</SelectItem>
                    <SelectItem value="INATIVO">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="E-mail">
                <Input value={form.email} onChange={(event) => updateForm("email", event.target.value)} type="email" />
              </Field>
              <Field label="Telefone">
                <Input value={form.telefone} onChange={(event) => updateForm("telefone", event.target.value)} />
              </Field>
              <Field label="Contato principal">
                <Input value={form.contatoPrincipal} onChange={(event) => updateForm("contatoPrincipal", event.target.value)} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-md border p-3 md:grid-cols-4">
              <Field label="CEP">
                <Input value={form.cep} onChange={(event) => updateForm("cep", event.target.value)} />
              </Field>
              <Field label="Endereco" className="md:col-span-2">
                <Input value={form.endereco} onChange={(event) => updateForm("endereco", event.target.value)} />
              </Field>
              <Field label="Numero">
                <Input value={form.numero} onChange={(event) => updateForm("numero", event.target.value)} />
              </Field>
              <Field label="Complemento">
                <Input value={form.complemento} onChange={(event) => updateForm("complemento", event.target.value)} />
              </Field>
              <Field label="Bairro">
                <Input value={form.bairro} onChange={(event) => updateForm("bairro", event.target.value)} />
              </Field>
              <Field label="Cidade">
                <Input value={form.cidade} onChange={(event) => updateForm("cidade", event.target.value)} />
              </Field>
              <Field label="UF">
                <Input value={form.uf} onChange={(event) => updateForm("uf", event.target.value.toUpperCase().slice(0, 2))} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
              <Field label="Nome no Fluig">
                <Input value={form.fluigName} onChange={(event) => updateForm("fluigName", event.target.value)} />
              </Field>
              <Field label="Codigo Fluig">
                <Input value={form.fluigCode} onChange={(event) => updateForm("fluigCode", event.target.value)} />
              </Field>
              <Field label="Label Fluig" className="md:col-span-2">
                <Input value={form.fluigSupplierLabel} onChange={(event) => updateForm("fluigSupplierLabel", event.target.value)} />
              </Field>
              <Field label="Solicitacao modelo">
                <Input value={form.defaultSourceRequestId} onChange={(event) => updateForm("defaultSourceRequestId", event.target.value)} />
              </Field>
              <Field label="Origem">
                <Select value={form.sourceSystem} onValueChange={(value) => updateForm("sourceSystem", value as SupplierSourceSystem)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOCAL">Local</SelectItem>
                    <SelectItem value="FLUIG">Fluig</SelectItem>
                    <SelectItem value="LOCAL_FLUIG">Local + Fluig</SelectItem>
                    <SelectItem value="PRE_CADASTRO_FLUIG">Pre-cadastro Fluig</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sincronizacao">
                <Select value={form.syncStatus} onValueChange={(value) => updateForm("syncStatus", value as SupplierSyncStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NAO_SINCRONIZADO">Nao sincronizado</SelectItem>
                    <SelectItem value="SINCRONIZADO">Sincronizado</SelectItem>
                    <SelectItem value="PENDENTE_REVISAO">Pendente revisao</SelectItem>
                    <SelectItem value="ERRO_SYNC">Erro de sync</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Observacoes" className="md:col-span-2">
                <Textarea value={form.observacoes} onChange={(event) => updateForm("observacoes", event.target.value)} />
              </Field>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-md border p-3">
              <h3 className="text-sm font-semibold">Filiais vinculadas</h3>
              <p className="mt-1 text-xs text-muted-foreground">Controla onde o fornecedor aparece para usuarios por filial.</p>
              <div className="mt-3 max-h-52 space-y-2 overflow-auto">
                {branches.length ? (
                  branches.map((branch) => (
                    <label key={branch.id} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-sm">
                      <Checkbox
                        checked={form.branchIds.includes(branch.id)}
                        onCheckedChange={(checked) => toggleBranch(branch.id, checked === true)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{branch.code} - {branch.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{branch.fluigLabel || "Sem label Fluig"}</span>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    Filiais indisponiveis para este usuario ou ainda nao carregadas.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Resultado do CNPJ</h3>
                {lookupResult ? <Badge variant="outline">{lookupSourceLabels[lookupResult.source]}</Badge> : null}
              </div>
              {lookupResult ? (
                <div className="mt-3 space-y-3 text-xs">
                  {lookupResult.warnings.map((warning) => (
                    <p key={warning} className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                      {warning}
                    </p>
                  ))}
                  {lookupResult.supplier ? (
                    <div className="rounded-md border bg-muted/20 p-2">
                      <p className="font-semibold">{lookupResult.supplier.razaoSocial}</p>
                      <p className="text-muted-foreground">{lookupResult.supplier.cnpjFormatado}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => openEditDialog(lookupResult.supplier as SupplierRecord)}>
                        Abrir cadastro existente
                      </Button>
                    </div>
                  ) : null}
                  {lookupResult.source !== "local" && lookupResult.source !== "not_found" ? (
                    <div className="rounded-md border bg-muted/20 p-2">
                      <p className="font-semibold">{lookupResult.suggestions.razaoSocial || lookupResult.suggestions.fluigName || "Sugestao Fluig"}</p>
                      <p className="text-muted-foreground">
                        Modelo {lookupResult.suggestions.defaultSourceRequestId || "historico"}
                        {typeof lookupResult.suggestions.confidence === "number"
                          ? ` - confianca ${Math.round(
                              lookupResult.suggestions.confidence <= 1
                                ? lookupResult.suggestions.confidence * 100
                                : lookupResult.suggestions.confidence
                            )}%`
                          : ""}
                      </p>
                      {lookupResult.suggestions.latestRequestId ? (
                        <p className="mt-1 text-muted-foreground">
                          Ultima solicitacao: {lookupResult.suggestions.latestRequestId}
                        </p>
                      ) : null}
                      {lookupResult.suggestions.branchLabel ? (
                        <p className="mt-1 text-muted-foreground">
                          Filial mais usada: {lookupResult.suggestions.branchLabel}
                        </p>
                      ) : null}
                      {lookupResult.suggestions.autoFilledFields?.length ? (
                        <div className="mt-3">
                          <p className="font-medium text-foreground">Preenchido automaticamente</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {lookupResult.suggestions.autoFilledFields.map((field) => (
                              <Badge key={field} variant="secondary">{field}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {lookupResult.suggestions.reviewFields?.length ? (
                        <div className="mt-3">
                          <p className="font-medium text-foreground">Revisar manualmente</p>
                          <p className="mt-1 text-muted-foreground">
                            {lookupResult.suggestions.reviewFields.join(", ")}
                          </p>
                        </div>
                      ) : null}
                      {candidateId && permissions.canApprove ? (
                        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void approveCandidate()} disabled={saving}>
                          Converter candidato
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Digite um CNPJ e consulte para preencher com dados locais ou do historico Fluig.
                </p>
              )}
            </section>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="size-4" />
            Cancelar
          </Button>
          {canSave ? (
            <Button type="button" onClick={() => void submitSupplier()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {editing ? "Salvar alteracoes" : "Criar fornecedor"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierViewDialog({ supplier, onOpenChange }: { supplier: SupplierRecord | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={Boolean(supplier)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplier?.razaoSocial || "Fornecedor"}</DialogTitle>
          <DialogDescription>Resumo cadastral, vinculos e ultima sincronizacao Fluig.</DialogDescription>
        </DialogHeader>
        {supplier ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="CNPJ" value={supplier.cnpjFormatado || supplier.cnpjNormalizado || "-"} />
            <Info label="Status" value={supplier.status.replaceAll("_", " ")} />
            <Info label="Origem" value={sourceLabels[supplier.sourceSystem]} />
            <Info label="Sincronizacao" value={syncLabels[supplier.syncStatus]} />
            <Info label="Nome Fluig" value={supplier.fluig.name || "-"} />
            <Info label="Codigo Fluig" value={supplier.fluig.code || "-"} />
            <Info label="Solicitacoes vinculadas" value={String(supplier.requestCount)} />
            <Info label="Ultima sync" value={formatDateTime(supplier.fluig.lastSyncAt)} />
            <Info label="Filiais" value={supplier.branches.map((branch) => branch.code || branch.name).join(", ") || "-"} className="md:col-span-2" />
            <Info label="Contato" value={[supplier.contatoPrincipal, supplier.email, supplier.telefone].filter(Boolean).join(" / ") || "-"} className="md:col-span-2" />
            <Info label="Observacoes" value={supplier.observacoes || "-"} className="md:col-span-2" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border bg-muted/20 p-3", className)}>
      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-normal text-sm font-medium">{value}</p>
    </div>
  );
}
