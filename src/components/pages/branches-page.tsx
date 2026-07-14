"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Loader2,
  MapPin,
  Plus,
  RefreshCcw,
  RotateCcw,
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
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ModuleConfig } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  fluigLabel: string | null;
  region: string | null;
  city: string | null;
  uf: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  lastFluigSyncAt: string | null;
  usersCount: number;
  suppliersCount: number;
  openRequestsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type BranchFormState = {
  code: string;
  name: string;
  fluigLabel: string;
  region: string;
  city: string;
  uf: string;
  active: boolean;
  fluigZoom: string;
  fluigDataset: string;
  externalCode: string;
  notes: string;
};

type BranchesPayload = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  items: BranchRecord[];
  permissions?: PagePermissions;
};

type PagePermissions = {
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
};

type PendingAction =
  | { type: "form" }
  | { type: "toggle"; branchId: string }
  | { type: "delete"; branchId: string }
  | null;

const initialForm: BranchFormState = {
  code: "",
  name: "",
  fluigLabel: "",
  region: "",
  city: "",
  uf: "",
  active: true,
  fluigZoom: "",
  fluigDataset: "",
  externalCode: "",
  notes: "",
};

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
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

function formFromBranch(branch: BranchRecord): BranchFormState {
  return {
    code: branch.code || "",
    name: branch.name || "",
    fluigLabel: branch.fluigLabel || "",
    region: branch.region || "",
    city: branch.city || "",
    uf: branch.uf || "",
    active: branch.active,
    fluigZoom: metadataText(branch.metadata, "fluigZoom"),
    fluigDataset: metadataText(branch.metadata, "fluigDataset"),
    externalCode: metadataText(branch.metadata, "externalCode"),
    notes: metadataText(branch.metadata, "notes"),
  };
}

function buildBranchPayload(form: BranchFormState, currentMetadata?: Record<string, unknown>) {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    fluigLabel: nullable(form.fluigLabel),
    region: nullable(form.region),
    city: nullable(form.city),
    uf: nullable(form.uf)?.toUpperCase() || null,
    active: form.active,
    metadata: {
      ...(currentMetadata || {}),
      fluigZoom: nullable(form.fluigZoom),
      fluigDataset: nullable(form.fluigDataset),
      externalCode: nullable(form.externalCode),
      notes: nullable(form.notes),
    },
  };
}

function metricValue(items: BranchRecord[], selector: (branch: BranchRecord) => number) {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

export function BranchesPage({
  config,
  initialOpenForm = false,
}: {
  config: ModuleConfig;
  initialOpenForm?: boolean;
}) {
  const [items, setItems] = useState<BranchRecord[]>([]);
  const [permissions, setPermissions] = useState<PagePermissions>({ canView: true, canCreate: false, canUpdate: false, canApprove: false });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("ALL");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(initialOpenForm);
  const [editing, setEditing] = useState<BranchRecord | null>(null);
  const [viewing, setViewing] = useState<BranchRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BranchRecord | null>(null);
  const [form, setForm] = useState<BranchFormState>(initialForm);
  const requestSequence = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const loadBranches = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (activeFilter !== "ALL") params.set("active", activeFilter);

      const data = await parseResponse<BranchesPayload>(
        await fetch(`/api/admin/branches?${params.toString()}`, { cache: "no-store" }),
        "Falha ao listar filiais."
      );
      if (requestId !== requestSequence.current) return;

      const nextTotal = data.total || 0;
      const nextTotalPages = Math.max(Math.ceil(nextTotal / pageSize), 1);
      if (page > nextTotalPages) {
        setItems([]);
        setTotal(nextTotal);
        setPage(nextTotalPages);
        return;
      }
      setItems(data.items || []);
      setPermissions(data.permissions || { canView: true, canCreate: false, canUpdate: false, canApprove: false });
      setTotal(nextTotal);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      const message = loadError instanceof Error ? loadError.message : "Falha ao listar filiais.";
      setError(message);
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [activeFilter, debouncedSearch, page, pageSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadBranches();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadBranches]);

  function resetForm() {
    setEditing(null);
    setForm(initialForm);
  }

  function openCreateDialog() {
    if (!permissions.canCreate) {
      toast.error("Usuario sem permissao para criar filiais.");
      return;
    }
    resetForm();
    setDialogOpen(true);
  }

  function openEditDialog(branch: BranchRecord) {
    if (!permissions.canUpdate) {
      toast.error("Usuario sem permissao para editar filiais.");
      return;
    }
    setEditing(branch);
    setForm(formFromBranch(branch));
    setDialogOpen(true);
  }

  function updateForm<K extends keyof BranchFormState>(key: K, value: BranchFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitBranch() {
    if (!form.code.trim()) {
      toast.error("Codigo da filial e obrigatorio.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Nome da filial e obrigatorio.");
      return;
    }

    setPendingAction({ type: "form" });
    try {
      const response = await fetch(editing ? `/api/admin/branches/${editing.id}` : "/api/admin/branches", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBranchPayload(form, editing?.metadata)),
      });
      await parseResponse(response, editing ? "Falha ao editar filial." : "Falha ao criar filial.");
      toast.success(editing ? "Filial atualizada." : "Filial criada.");
      setDialogOpen(false);
      resetForm();
      await loadBranches();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Falha ao salvar filial.");
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleActive(branch: BranchRecord) {
    setPendingAction({ type: "toggle", branchId: branch.id });
    try {
      await parseResponse(
        await fetch(`/api/admin/branches/${branch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !branch.active }),
        }),
        branch.active ? "Falha ao inativar filial." : "Falha ao reativar filial."
      );
      toast.success(branch.active ? "Filial inativada." : "Filial reativada.");
      await loadBranches();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : "Falha ao alterar status da filial.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteBranch() {
    if (!deleteTarget) return;
    setPendingAction({ type: "delete", branchId: deleteTarget.id });
    try {
      const data = await parseResponse<{ success: true; deleted?: boolean; softDeleted?: boolean }>(
        await fetch(`/api/admin/branches/${deleteTarget.id}`, { method: "DELETE" }),
        "Falha ao excluir filial."
      );
      toast.success(data.softDeleted ? "Filial removida da operacao por possuir vinculos." : "Filial excluida.");
      setDeleteTarget(null);
      await loadBranches();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Falha ao excluir filial.");
    } finally {
      setPendingAction(null);
    }
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const firstVisible = total ? (page - 1) * pageSize + 1 : 0;
  const lastVisible = total ? Math.min(page * pageSize, total) : 0;
  const searchPending = search !== debouncedSearch;
  const formSaving = pendingAction?.type === "form";
  const deleting = pendingAction?.type === "delete";
  const isMutating = pendingAction !== null;
  const hasFilters = Boolean(search.trim()) || activeFilter !== "ALL";
  const metrics = useMemo(
    () => [
      {
        label: "Filiais encontradas",
        value: total,
        helper: "Cadastro administrativo real",
      },
      {
        label: "Usuarios vinculados",
        value: metricValue(items, (item) => item.usersCount),
        helper: "Total da pagina atual",
      },
      {
        label: "Solicitacoes abertas",
        value: metricValue(items, (item) => item.openRequestsCount),
        helper: "Por codigo ou vinculo direto",
      },
    ],
    [items, total]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title="Filiais"
        description="Cadastro real de filiais com vinculo Fluig, usuarios, fornecedores e solicitacoes abertas."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric, index) => (
          <Card
            key={metric.label}
            className={cn(
              "stitch-animate-in rounded-lg shadow-none",
              index === 1 && "stitch-delay-100",
              index === 2 && "stitch-delay-200"
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <MapPin className="size-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="stitch-animate-in stitch-delay-200 rounded-lg shadow-none">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 lg:max-w-xl">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="px-8"
                placeholder="Buscar por codigo, nome ou label Fluig"
                aria-label="Buscar filiais"
              />
              {searchPending ? (
                <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : search ? (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setSearch("")}
                  title="Limpar busca"
                  aria-label="Limpar busca"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={activeFilter}
                onValueChange={(value) => {
                  setActiveFilter(value as typeof activeFilter);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas as filiais</SelectItem>
                  <SelectItem value="true">Somente ativas</SelectItem>
                  <SelectItem value="false">Somente inativas</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void loadBranches()} disabled={loading}>
                <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
                Atualizar
              </Button>
              {permissions.canCreate ? (
                <Button type="button" className="stitch-soft-button" onClick={openCreateDialog} disabled={isMutating}>
                  <Plus className="size-4" />
                  Nova filial
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {loading ? "Consultando filiais..." : `${items.length} exibidas de ${total} filiais encontradas.`}
          </p>
        </CardContent>
      </Card>

      <Card className="stitch-animate-in rounded-lg shadow-none">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Filiais cadastradas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="rounded-md bg-destructive/10 p-2 text-destructive">
                <RotateCcw className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium">Nao foi possivel carregar as filiais</p>
                <p className="mt-1 max-w-lg text-xs text-muted-foreground">{error}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => void loadBranches()} disabled={loading}>
                <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
                Tentar novamente
              </Button>
            </div>
          ) : loading ? (
            <BranchListSkeleton />
          ) : items.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Codigo</TableHead>
                    <TableHead className="min-w-[260px]">Filial</TableHead>
                    <TableHead>Label Fluig</TableHead>
                    <TableHead>Usuarios</TableHead>
                    <TableHead>Fornecedores</TableHead>
                    <TableHead>Solicitacoes abertas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((branch) => {
                    const toggling = pendingAction?.type === "toggle" && pendingAction.branchId === branch.id;
                    return (
                  <TableRow key={branch.id}>
                    <TableCell className="font-mono text-xs">{branch.code}</TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="font-medium">{branch.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[branch.city, branch.uf, branch.region].filter(Boolean).join(" / ") || "Sem regiao informada"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal text-xs">
                      {branch.fluigLabel || "Sem label Fluig"}
                      {metadataText(branch.metadata, "fluigZoom") ? (
                        <div className="text-muted-foreground">Zoom {metadataText(branch.metadata, "fluigZoom")}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{branch.usersCount}</TableCell>
                    <TableCell>{branch.suppliersCount}</TableCell>
                    <TableCell>{branch.openRequestsCount}</TableCell>
                    <TableCell>
                      <StatusBadge status={branch.active ? "ATIVO" : "INATIVO"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" title="Visualizar" onClick={() => setViewing(branch)}>
                          <Eye className="size-4" />
                        </Button>
                        {permissions.canUpdate ? (
                          <>
                            <Button type="button" variant="ghost" size="icon-sm" title="Editar" disabled={isMutating} onClick={() => openEditDialog(branch)}>
                              <Edit3 className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title={branch.active ? "Inativar" : "Reativar"}
                              disabled={isMutating}
                              onClick={() => void toggleActive(branch)}
                            >
                              {toggling ? <Loader2 className="size-4 animate-spin" /> : null}
                              {toggling ? (branch.active ? "Inativando" : "Reativando") : branch.active ? "Inativar" : "Reativar"}
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" title="Excluir" disabled={isMutating} onClick={() => setDeleteTarget(branch)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="rounded-md bg-muted p-2 text-muted-foreground">
                <Building2 className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{hasFilters ? "Nenhuma filial encontrada" : "Nenhuma filial cadastrada"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasFilters ? "Ajuste a busca ou os filtros para ver outros resultados." : "Crie a primeira filial para iniciar o cadastro."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {hasFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setActiveFilter("ALL");
                      setPage(1);
                    }}
                  >
                    <X className="size-4" />
                    Limpar filtros
                  </Button>
                ) : null}
                {!hasFilters && permissions.canCreate ? (
                  <Button type="button" onClick={openCreateDialog} disabled={isMutating}>
                    <Plus className="size-4" />
                    Nova filial
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{firstVisible}-{lastVisible} de {total}</span>
          <div className="flex items-center gap-2">
            <span>Itens por pagina</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-20" aria-label="Itens por pagina">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-xs text-muted-foreground">Pagina {page} de {totalPages}</span>
          <Button type="button" variant="outline" size="icon-sm" title="Pagina anterior" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(current - 1, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" title="Proxima pagina" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(current + 1, totalPages))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <BranchFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (formSaving) return;
          setDialogOpen(open);
          if (!open) resetForm();
        }}
        editing={editing}
        form={form}
        saving={formSaving}
        updateForm={updateForm}
        submitBranch={submitBranch}
      />

      <BranchViewDialog branch={viewing} onOpenChange={(open) => !open && setViewing(null)} />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleteTarget?.code} - {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao e destrutiva. Se houver usuarios, fornecedores ou solicitacoes vinculadas, a filial sera removida da
              operacao por soft delete. Para apenas pausar o uso, cancele e escolha inativar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteBranch();
              }}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {deleting ? "Excluindo" : "Excluir filial"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BranchFormDialog({
  open,
  onOpenChange,
  editing,
  form,
  saving,
  updateForm,
  submitBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: BranchRecord | null;
  form: BranchFormState;
  saving: boolean;
  updateForm: <K extends keyof BranchFormState>(key: K, value: BranchFormState[K]) => void;
  submitBranch: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar filial" : "Nova filial"}</DialogTitle>
          <DialogDescription>
            Cadastre codigo interno, label Fluig e dados de localizacao usados nos filtros e lancamentos.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Codigo">
            <Input
              value={form.code}
              onChange={(event) => updateForm("code", event.target.value.toUpperCase())}
              placeholder="Ex.: 1060"
              required
              autoFocus={!editing}
            />
          </Field>
          <Field label="Nome">
            <Input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required />
          </Field>
          <Field label="Label Fluig" className="md:col-span-2">
            <Input
              value={form.fluigLabel}
              onChange={(event) => updateForm("fluigLabel", event.target.value)}
              placeholder="Ex.: 1060 - 1060-SAM FUR"
            />
          </Field>
          <Field label="Regiao">
            <Input value={form.region} onChange={(event) => updateForm("region", event.target.value)} />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={(event) => updateForm("city", event.target.value)} />
          </Field>
          <Field label="UF">
            <Input
              value={form.uf}
              onChange={(event) => updateForm("uf", event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))}
              maxLength={2}
              placeholder="Ex.: SP"
            />
          </Field>
          <label className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm">
            <Checkbox checked={form.active} onCheckedChange={(checked) => updateForm("active", checked === true)} />
            Filial ativa
          </label>
        </div>

        <section className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Vinculo Fluig</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Dados usados para casar listas/zooms do Fluig com a filial do ERP.
            </p>
          </div>
          <Field label="Zoom Fluig">
            <Input value={form.fluigZoom} onChange={(event) => updateForm("fluigZoom", event.target.value)} />
          </Field>
          <Field label="Dataset Fluig">
            <Input value={form.fluigDataset} onChange={(event) => updateForm("fluigDataset", event.target.value)} />
          </Field>
          <Field label="Codigo externo">
            <Input value={form.externalCode} onChange={(event) => updateForm("externalCode", event.target.value)} />
          </Field>
          <Field label="Observacoes" className="md:col-span-2">
            <Textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} />
          </Field>
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="size-4" />
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submitBranch()} disabled={saving || !form.code.trim() || !form.name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Salvando" : editing ? "Salvar alteracoes" : "Criar filial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchViewDialog({ branch, onOpenChange }: { branch: BranchRecord | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={Boolean(branch)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{branch ? `${branch.code} - ${branch.name}` : "Filial"}</DialogTitle>
          <DialogDescription>Resumo da filial, vinculos e ultima sincronizacao conhecida.</DialogDescription>
        </DialogHeader>
        {branch ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="Codigo" value={branch.code} />
            <Info label="Status" value={branch.active ? "Ativa" : "Inativa"} />
            <Info label="Label Fluig" value={branch.fluigLabel || "-"} className="md:col-span-2" />
            <Info label="Localizacao" value={[branch.city, branch.uf, branch.region].filter(Boolean).join(" / ") || "-"} />
            <Info label="Ultima sync Fluig" value={formatDateTime(branch.lastFluigSyncAt)} />
            <Info label="Usuarios vinculados" value={String(branch.usersCount)} />
            <Info label="Fornecedores vinculados" value={String(branch.suppliersCount)} />
            <Info label="Solicitacoes abertas" value={String(branch.openRequestsCount)} />
            <Info label="Zoom Fluig" value={metadataText(branch.metadata, "fluigZoom") || "-"} />
            <Info label="Dataset Fluig" value={metadataText(branch.metadata, "fluigDataset") || "-"} />
            <Info label="Codigo externo" value={metadataText(branch.metadata, "externalCode") || "-"} />
            <Info label="Observacoes" value={metadataText(branch.metadata, "notes") || "-"} className="md:col-span-2" />
            <Info label="Criada em" value={formatDateTime(branch.createdAt)} />
            <Info label="Atualizada em" value={formatDateTime(branch.updatedAt)} />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-4" />
            Fechar
          </Button>
        </DialogFooter>
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

function BranchListSkeleton() {
  return (
    <div className="overflow-hidden" aria-label="Carregando filiais" aria-busy="true">
      <div className="grid grid-cols-[0.7fr_2fr_1.5fr_0.7fr_0.8fr_1fr_0.8fr] gap-4 border-b p-4">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-3 animate-pulse rounded bg-muted" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-cols-[0.7fr_2fr_1.5fr_0.7fr_0.8fr_1fr_0.8fr] gap-4 border-b p-4 last:border-b-0">
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-6 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
