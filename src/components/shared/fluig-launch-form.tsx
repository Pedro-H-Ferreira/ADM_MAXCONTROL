"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, Loader2, Paperclip, Search, SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/status-badge";
import { fluigAdmApi } from "@/lib/fluig-api";
import {
  type FluigAdmSyncResponse,
  type FluigCatalogItem,
  type FluigCatalogType,
  type FluigIntegrationModule,
  type FluigLaunchTemplate,
  type FluigModuleSlug,
} from "@/lib/fluig-data";
import { cn } from "@/lib/utils";

type LaunchModule = Exclude<FluigModuleSlug, "fornecedores">;

type LaunchField = {
  key: string;
  label: string;
  type: "text" | "date" | "currency" | "textarea" | "catalog";
  catalogType?: FluigCatalogType;
  required?: boolean;
  placeholder?: string;
  wide?: boolean;
};

type JobState = {
  id: string;
  status: string;
  progressLabel: string | null;
};

type AttachmentPayload = {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
};

const maxAttachmentBytes = 3 * 1024 * 1024;

const dateFieldKeys = new Set(["dataEmissaoNF", "vencPagNota", "dataPedido", "dataPrevSaida"]);

const launchFields: Record<LaunchModule, LaunchField[]> = {
  pagamentos: [
    { key: "fornecedorC", label: "Fornecedor", type: "catalog", catalogType: "supplier", required: true },
    { key: "codCNPJ", label: "CNPJ", type: "text", required: true },
    { key: "unidadeFilial", label: "Filial", type: "catalog", catalogType: "branch", required: true },
    { key: "codigonaturezaC", label: "Natureza financeira", type: "catalog", catalogType: "natureza", required: true },
    { key: "centroCusto", label: "Centro de custo", type: "catalog", catalogType: "cost_center", required: true },
    { key: "formaPagamento", label: "Forma de pagamento", type: "catalog", catalogType: "payment_method", required: true },
    { key: "nNotaFiscal", label: "Numero da nota fiscal", type: "text", required: true },
    { key: "dataEmissaoNF", label: "Data de emissao", type: "date", required: true },
    { key: "vencPagNota", label: "Vencimento", type: "date", required: true },
    { key: "valorNF", label: "Valor da nota", type: "currency", required: true },
    {
      key: "descricaoDemandaEnvio",
      label: "Descricao do pagamento",
      type: "textarea",
      required: true,
      wide: true,
      placeholder: "Resumo do servico, competencia, nota fiscal e observacoes para aprovacao.",
    },
  ],
  compras: [
    { key: "fornecedorC", label: "Fornecedor sugerido", type: "catalog", catalogType: "supplier" },
    { key: "dataPedido", label: "Data do pedido", type: "date", required: true },
    { key: "codFilialPedido", label: "Filial do pedido", type: "catalog", catalogType: "branch", required: true },
    { key: "centroCusto", label: "Centro de custo", type: "catalog", catalogType: "cost_center", required: true },
    { key: "contaCentroCusto", label: "Conta contabil", type: "catalog", catalogType: "account", required: true },
    {
      key: "descricaoProduto",
      label: "Itens da requisicao",
      type: "textarea",
      required: true,
      wide: true,
      placeholder: "Produto ou servico, quantidade, unidade, valor estimado e justificativa.",
    },
    {
      key: "observacao",
      label: "Observacoes",
      type: "textarea",
      wide: true,
      placeholder: "Cotacoes, urgencia, aprovador ou qualquer orientacao para o Fluig.",
    },
  ],
  manutencao: [
    { key: "filial", label: "Filial de origem", type: "catalog", catalogType: "branch", required: true },
    { key: "filialDestino", label: "Filial de destino", type: "catalog", catalogType: "branch" },
    { key: "tipoTransacao", label: "Tipo de manutencao", type: "catalog", catalogType: "account", required: true },
    { key: "centroCusto", label: "Centro de custo", type: "catalog", catalogType: "cost_center" },
    { key: "codPatrimonio", label: "Patrimonio ou ativo", type: "text" },
    { key: "dataPrevSaida", label: "Data prevista", type: "date" },
    { key: "zoomDemandaPara", label: "Responsavel Fluig", type: "text", required: true },
    {
      key: "obsFiscal",
      label: "Descricao tecnica",
      type: "textarea",
      required: true,
      wide: true,
      placeholder: "Problema, prioridade, local, material previsto e acao esperada.",
    },
  ],
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function metadataText(item: FluigCatalogItem, key: string) {
  const value = item.metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function catalogSearchText(item: FluigCatalogItem) {
  return normalizeText([item.label, item.code, item.value, metadataText(item, "cnpj"), metadataText(item, "fluigName")].join(" "));
}

function toInputDate(value: string) {
  const trimmed = value.trim();
  const ptBr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return trimmed;
}

function toFluigDate(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

function displayValueForField(key: string, value: string) {
  return dateFieldKeys.has(key) ? toInputDate(value) : value;
}

function payloadValueForField(key: string, value: string) {
  return dateFieldKeys.has(key) ? toFluigDate(value) : value;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Nao foi possivel ler o anexo ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.readAsDataURL(file);
  });
}

function templateMatchesCatalog(template: FluigLaunchTemplate, item: FluigCatalogItem) {
  const cnpj = metadataText(item, "cnpj");
  if (cnpj && template.supplierCnpj && cnpj.replace(/\D/g, "") === template.supplierCnpj.replace(/\D/g, "")) {
    return true;
  }

  const supplier = normalizeText(template.supplierName || "");
  return supplier ? catalogSearchText(item).includes(supplier) : false;
}

export function FluigLaunchForm({
  moduleSlug,
  integration,
  syncData,
  onSynced,
}: {
  moduleSlug: FluigModuleSlug;
  integration: FluigIntegrationModule;
  syncData: FluigAdmSyncResponse | null;
  onSynced?: (data: FluigAdmSyncResponse) => void;
}) {
  const fields = moduleSlug === "fornecedores" ? [] : launchFields[moduleSlug as LaunchModule];
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogs = syncData?.catalogs || {};
  const templates = useMemo(
    () => (syncData?.launchTemplates || []).filter((template) => template.module === moduleSlug),
    [moduleSlug, syncData?.launchTemplates]
  );
  const monthlyTemplates = templates.filter((template) => template.recurrence === "monthly");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;

  if (moduleSlug === "fornecedores") {
    return null;
  }

  function setFieldValue(key: string, value: string) {
    setFormValues((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(template: FluigLaunchTemplate) {
    setSelectedTemplateId(template.id);
    setFormValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(template.defaultFields)) {
        if (typeof value === "string" && value.trim()) {
          next[key] = displayValueForField(key, value);
        }
      }
      if (template.supplierName) next.fornecedorC = template.defaultFields.fornecedorC || template.supplierName;
      if (template.supplierCnpj) next.codCNPJ = template.supplierCnpj;
      if (template.branchLabel) {
        next.unidadeFilial = template.branchLabel;
        next.codFilialPedido = template.branchLabel;
        next.filial = template.branchLabel;
      }
      return next;
    });
    setMessage(
      template.recurrence === "monthly"
        ? "Padrao mensal aplicado. Revise competencia, valor e anexe a nota fiscal."
        : "Modelo real aplicado a partir do historico Fluig."
    );
    setError(null);
  }

  function handleCatalogSelect(field: LaunchField, item: FluigCatalogItem) {
    setFieldValue(field.key, item.value || item.label);

    if (field.catalogType === "supplier") {
      const cnpj = metadataText(item, "cnpj");
      if (cnpj) setFieldValue("codCNPJ", cnpj);
      const template = templates.find((candidate) => templateMatchesCatalog(candidate, item));
      if (template) applyTemplate(template);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);

    const nextFiles = Array.from(files);
    const totalBytes = [...attachments, ...nextFiles].reduce((sum, item) => sum + item.size, 0);
    if (totalBytes > maxAttachmentBytes) {
      setError("Os anexos deste lancamento precisam ficar abaixo de 3 MB no total.");
      return;
    }

    const payloads = await Promise.all(
      nextFiles.map(async (file) => ({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataBase64: await readFileAsBase64(file),
      }))
    );
    setAttachments((current) => [...current, ...payloads]);
  }

  async function pollJobUntilDone(jobId: string) {
    const terminal = new Set(["success", "error", "cancelled", "expired"]);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const data = await fluigAdmApi.getJob(jobId);
      setJobState({
        id: data.job.id,
        status: data.job.status,
        progressLabel: data.job.progressLabel,
      });

      if (terminal.has(data.job.status)) {
        if (data.job.status !== "success") {
          throw new Error(data.job.errorMessage || `Job Fluig finalizado com status ${data.job.status}`);
        }
        return data;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    throw new Error("Tempo limite aguardando o agente local executar a tarefa Fluig.");
  }

  function buildFieldOverrides() {
    const overrides: Record<string, string> = {};
    if (selectedTemplate) {
      for (const [key, value] of Object.entries(selectedTemplate.defaultFields)) {
        if (typeof value === "string" && value.trim()) {
          overrides[key] = payloadValueForField(key, value);
        }
      }
    }

    for (const field of fields) {
      const value = formValues[field.key]?.trim();
      if (value) overrides[field.key] = payloadValueForField(field.key, value);
    }

    return overrides;
  }

  async function submitLaunch() {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const missing = fields.filter((field) => field.required && !formValues[field.key]?.trim()).map((field) => field.label);
      if (missing.length) {
        throw new Error(`Preencha: ${missing.join(", ")}.`);
      }

      const sourceRequestId = selectedTemplate?.sourceRequestId || templates[0]?.sourceRequestId || syncData?.examples?.[0]?.id || "";
      if (!sourceRequestId) {
        throw new Error("Sincronize o historico Fluig para carregar um modelo real antes de abrir novo lancamento.");
      }

      const created = await fluigAdmApi.createJob({
        module: moduleSlug,
        operation: "open_from_source",
        payload: {
          sourceRequestId,
          fieldOverrides: buildFieldOverrides(),
          attachments,
          confirm: true,
        },
      });

      setJobState({
        id: created.job.id,
        status: created.job.status,
        progressLabel: created.job.progressLabel,
      });
      await pollJobUntilDone(created.job.id);
      setMessage("Lancamento enviado para o Fluig. O numero sera exibido apos a proxima leitura de status.");

      const refreshed = await fluigAdmApi.sync({ module: moduleSlug, action: "sync" });
      onSynced?.(refreshed);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha ao abrir lancamento no Fluig.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-md border bg-background">
      <header className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">{integration.primaryAction}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Preenchimento com listas reais do Fluig, anexos e padroes detectados em solicitacoes anteriores.
          </p>
        </div>
        {jobState ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <StatusBadge status={jobState.status.toUpperCase()} />
              <span className="font-mono text-muted-foreground">{jobState.id.slice(0, 8)}</span>
            </div>
            <p className="mt-1 max-w-sm text-muted-foreground">
              {jobState.progressLabel || "Aguardando agente local assumir a tarefa."}
            </p>
          </div>
        ) : null}
      </header>

      <div className="space-y-4 p-3">
        {monthlyTemplates.length ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Contas mensais reconhecidas
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {monthlyTemplates.slice(0, 6).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={cn(
                    "rounded-md border bg-muted/20 p-3 text-left text-xs transition hover:border-primary/60 hover:bg-primary/5",
                    selectedTemplateId === template.id ? "border-primary bg-primary/10" : ""
                  )}
                  onClick={() => applyTemplate(template)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 font-semibold text-foreground">{template.title}</span>
                    <span className="shrink-0 rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {template.occurrenceCount} usos
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {template.branchLabel || "Filial do historico"} - modelo {template.sourceRequestId}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) =>
            field.type === "catalog" && field.catalogType ? (
              <SearchableCatalogField
                key={field.key}
                field={field}
                value={formValues[field.key] || ""}
                items={catalogs[field.catalogType] || []}
                onChange={(value) => setFieldValue(field.key, value)}
                onSelect={(item) => handleCatalogSelect(field, item)}
              />
            ) : field.type === "textarea" ? (
              <FieldShell key={field.key} field={field}>
                <Textarea
                  value={formValues[field.key] || ""}
                  placeholder={field.placeholder}
                  onChange={(event) => setFieldValue(field.key, event.target.value)}
                />
              </FieldShell>
            ) : (
              <FieldShell key={field.key} field={field}>
                <Input
                  type={field.type === "date" ? "date" : "text"}
                  inputMode={field.type === "currency" ? "decimal" : undefined}
                  value={formValues[field.key] || ""}
                  placeholder={field.placeholder}
                  onChange={(event) => setFieldValue(field.key, event.target.value)}
                />
              </FieldShell>
            )
          )}
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <Label className="text-sm">Anexos</Label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
              <FileUp className="size-4" />
              Adicionar arquivo
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.xml,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={(event) => void handleFiles(event.target.files)}
              />
            </label>
            <span className="text-xs text-muted-foreground">PDF, XML, imagem ou planilha. Limite total: 3 MB.</span>
          </div>
          {attachments.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
                  <Paperclip className="size-3" />
                  {attachment.name}
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-muted"
                    onClick={() => setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                    aria-label={`Remover ${attachment.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">{message}</p> : null}
        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setFormValues({})} disabled={submitting}>
            Limpar
          </Button>
          <Button type="button" onClick={submitLaunch} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            Enviar para o Fluig
          </Button>
        </div>
      </div>
    </section>
  );
}

function FieldShell({ field, children }: { field: LaunchField; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", field.wide ? "md:col-span-2 xl:col-span-3" : "")}>
      <Label>
        {field.label}
        {field.required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function SearchableCatalogField({
  field,
  value,
  items,
  onChange,
  onSelect,
}: {
  field: LaunchField;
  value: string;
  items: FluigCatalogItem[];
  onChange: (value: string) => void;
  onSelect: (item: FluigCatalogItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedQuery = normalizeText(value);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return items.slice(0, 8);
    return items.filter((item) => catalogSearchText(item).includes(normalizedQuery)).slice(0, 8);
  }, [items, normalizedQuery]);

  return (
    <FieldShell field={field}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={value}
          placeholder={items.length ? "Pesquisar na lista Fluig" : "Digite para preencher"}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
        />
        {open && filtered.length ? (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-muted-foreground">
                  {[item.code, metadataText(item, "cnpj")].filter(Boolean).join(" - ") || `${item.occurrenceCount} usos no historico`}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
}
