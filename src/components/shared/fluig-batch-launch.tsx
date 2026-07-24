"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  FileCheck2,
  FileStack,
  FileUp,
  Loader2,
  Paperclip,
  Play,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fluigAdmApi } from "@/lib/fluig-api";
import type { FluigLaunchTemplate } from "@/lib/fluig-data";
import {
  groupBatchFiscalFiles,
  type BatchFiscalAttachment,
  type BatchFiscalDocument,
} from "@/lib/fluig-batch-launch";
import { parseCurrencyToCents } from "@/lib/operational-launch";
import { waitForFluigJob } from "@/lib/use-fluig-job-state";
import { cn } from "@/lib/utils";

type FiscalMatch = {
  supplier?: {
    id: string;
    name: string;
    cnpj: string;
    defaultSourceRequestId: string | null;
    defaultFields: Record<string, string>;
    branchIds: string[];
  } | null;
  branch?: {
    id: string;
    code: string;
    label: string;
  } | null;
};

type FiscalDocumentResponse = FiscalMatch & {
  success?: boolean;
  error?: string;
  document?: BatchFiscalDocument;
};

type BatchStatus = "pending" | "validating" | "validated" | "opening" | "opened" | "error";

type BatchDraft = {
  id: string;
  key: string;
  attachments: BatchFiscalAttachment[];
  document: BatchFiscalDocument;
  values: Record<string, string>;
  supplierId: string | null;
  branchCode: string | null;
  sourceRequestId: string;
  status: BatchStatus;
  launchId: string | null;
  fluigRequestId: string | null;
  progressLabel: string | null;
  error: string | null;
};

type BatchField = {
  key: string;
  label: string;
  required: boolean;
  type?: "date" | "textarea";
};

const maxDocumentBytes = 3 * 1024 * 1024;
const maxBatchFiles = 50;
const supplierModelFields = [
  "codigonaturezaC",
  "naturezaSalva",
  "centroCusto",
  "codCentroCusto",
  "formaPagamento",
] as const;
const batchFields: BatchField[] = [
  { key: "fornecedorC", label: "Fornecedor", required: true },
  { key: "codCNPJ", label: "CNPJ", required: true },
  { key: "unidadeFilial", label: "Filial", required: true },
  { key: "codigonaturezaC", label: "Natureza financeira", required: true },
  { key: "centroCusto", label: "Centro de custo", required: true },
  { key: "formaPagamento", label: "Forma de pagamento", required: true },
  { key: "nNotaFiscal", label: "Número da nota fiscal", required: true },
  { key: "dataEmissaoNF", label: "Data de emissão", required: true, type: "date" },
  { key: "vencPagNota", label: "Vencimento", required: true, type: "date" },
  { key: "valorNF", label: "Valor da nota", required: true },
  { key: "descricaoDemandaEnvio", label: "Descrição do pagamento", required: true, type: "textarea" },
];

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function formatMoneyInput(cents: number | null) {
  if (cents == null) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function toFluigDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value.trim();
}

function normalizedCnpj(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function statusPresentation(status: BatchStatus) {
  const presentations: Record<BatchStatus, { label: string; className: string }> = {
    pending: { label: "Aguardando validação", className: "border-amber-400 bg-amber-50 text-amber-900" },
    validating: { label: "Validando", className: "border-blue-400 bg-blue-50 text-blue-900" },
    validated: { label: "Validada", className: "border-emerald-500 bg-emerald-50 text-emerald-900" },
    opening: { label: "Abrindo no Fluig", className: "border-blue-500 bg-blue-50 text-blue-900" },
    opened: { label: "Fluig aberto", className: "border-emerald-600 bg-emerald-100 text-emerald-950" },
    error: { label: "Revisar", className: "border-red-500 bg-red-50 text-red-900" },
  };
  return presentations[status];
}

function missingFields(draft: BatchDraft) {
  const missing: string[] = batchFields
    .filter((field) => field.required && !String(draft.values[field.key] || "").trim())
    .map((field) => field.label);
  if (!draft.sourceRequestId.trim()) missing.push("Modelo Fluig");
  if (!draft.attachments.length) missing.push("PDF ou XML");
  if (draft.attachments.reduce((total, item) => total + item.size, 0) > maxDocumentBytes) {
    missing.push("Anexos abaixo de 3 MB por nota");
  }
  return missing;
}

function fieldOverrides(draft: BatchDraft) {
  return Object.fromEntries(
    batchFields
      .map((field) => [field.key, field.type === "date" ? toFluigDate(draft.values[field.key] || "") : String(draft.values[field.key] || "").trim()])
      .filter(([, value]) => value),
  );
}

export function FluigBatchLaunch({
  templates,
  fallbackSourceRequestId,
  canCreate,
  onCompleted,
}: {
  templates: FluigLaunchTemplate[];
  fallbackSourceRequestId: string;
  canCreate: boolean;
  onCompleted?: () => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState<BatchDraft[]>([]);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allReady = drafts.length > 0 && drafts.every((draft) => draft.status !== "opened" && missingFields(draft).length === 0);
  const allValidated = drafts.length > 0 && drafts.every((draft) => draft.status === "validated");
  const retryableErrors = drafts.filter((draft) => draft.status === "error" && draft.launchId).length;
  const openedCount = drafts.filter((draft) => draft.status === "opened").length;
  const validatedCount = drafts.filter((draft) => draft.status === "validated").length;
  const totalAmount = useMemo(
    () => drafts.reduce((total, draft) => total + (parseCurrencyToCents(draft.values.valorNF || "") || 0), 0),
    [drafts],
  );

  function buildDraft(
    group: ReturnType<typeof groupBatchFiscalFiles<FiscalMatch>>[number],
  ): BatchDraft {
    const document = group.document;
    const matchingTemplate = templates.find(
      (template) => normalizedCnpj(template.supplierCnpj) === normalizedCnpj(document.supplierCnpj),
    );
    const defaults = matchingTemplate?.defaultFields || group.match.supplier?.defaultFields || {};
    const values: Record<string, string> = {};
    for (const key of supplierModelFields) {
      if (String(defaults[key] || "").trim()) values[key] = String(defaults[key]);
    }
    values.fornecedorC = group.match.supplier?.name || document.supplierName || "";
    values.codCNPJ = document.supplierCnpj || group.match.supplier?.cnpj || "";
    values.unidadeFilial = group.match.branch?.label || "";
    values.nNotaFiscal = document.invoiceNumber || "";
    values.dataEmissaoNF = document.issueDate || "";
    values.vencPagNota = document.dueDate || "";
    values.valorNF = formatMoneyInput(document.amountCents);
    values.descricaoDemandaEnvio = document.description || "";

    return {
      id: crypto.randomUUID(),
      key: group.key,
      attachments: group.attachments,
      document,
      values,
      supplierId:
        group.match.supplier && group.match.branch && group.match.supplier.branchIds.includes(group.match.branch.id)
          ? group.match.supplier.id
          : null,
      branchCode: group.match.branch?.code || null,
      sourceRequestId:
        matchingTemplate?.sourceRequestId ||
        group.match.supplier?.defaultSourceRequestId ||
        fallbackSourceRequestId,
      status: "pending",
      launchId: null,
      fluigRequestId: null,
      progressLabel: null,
      error: document.warnings.length ? document.warnings.join(" | ") : null,
    };
  }

  function patchDraft(id: string, changes: Partial<BatchDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...changes } : draft)));
  }

  function updateValue(draft: BatchDraft, key: string, value: string) {
    const identityChanged = ["fornecedorC", "codCNPJ", "unidadeFilial"].includes(key);
    patchDraft(draft.id, {
      values: { ...draft.values, [key]: value },
      supplierId: identityChanged ? null : draft.supplierId,
      branchCode: key === "unidadeFilial" ? null : draft.branchCode,
      status: "pending",
      launchId: null,
      error: null,
    });
  }

  async function readFiscalDocument(attachment: BatchFiscalAttachment) {
    const response = await fetch("/api/fluig/adm/fiscal-document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attachment),
    });
    const data = (await response.json()) as FiscalDocumentResponse;
    if (!response.ok || data.success === false || !data.document) {
      throw new Error(data.error || "Não foi possível interpretar o documento fiscal.");
    }
    return data as FiscalDocumentResponse & { document: BatchFiscalDocument };
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setNotice(null);
    const selected = Array.from(files);
    if (selected.length > maxBatchFiles) {
      setError(`Selecione no máximo ${maxBatchFiles} arquivos por importação.`);
      return;
    }
    const invalid = selected.find((file) => !/\.(pdf|xml)$/i.test(file.name));
    if (invalid) {
      setError(`O arquivo ${invalid.name} não é PDF nem XML.`);
      return;
    }
    const oversized = selected.find((file) => file.size > maxDocumentBytes);
    if (oversized) {
      setError(`O arquivo ${oversized.name} ultrapassa 3 MB.`);
      return;
    }

    setImporting(true);
    const parsed: Array<{
      attachment: BatchFiscalAttachment;
      document: BatchFiscalDocument;
      match: FiscalMatch;
    }> = [];
    const failures: string[] = [];
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        setImportProgress(`Lendo ${index + 1} de ${selected.length}: ${file.name}`);
        try {
          const attachment: BatchFiscalAttachment = {
            name: file.name,
            mimeType: file.type || (file.name.toLowerCase().endsWith(".xml") ? "application/xml" : "application/pdf"),
            size: file.size,
            dataBase64: await readFileAsBase64(file),
          };
          const result = await readFiscalDocument(attachment);
          parsed.push({
            attachment,
            document: result.document,
            match: { supplier: result.supplier || null, branch: result.branch || null },
          });
        } catch (fileError) {
          failures.push(`${file.name}: ${fileError instanceof Error ? fileError.message : "falha na leitura"}`);
        }
      }

      const groups = groupBatchFiscalFiles(parsed);
      setDrafts((current) => {
        const next = [...current];
        for (const group of groups) {
          const existingIndex = next.findIndex((draft) => draft.key === group.key && draft.status !== "opened");
          if (existingIndex < 0) {
            next.push(buildDraft(group));
            continue;
          }
          const existing = next[existingIndex];
          const attachments = [...existing.attachments];
          for (const attachment of group.attachments) {
            if (!attachments.some((item) => item.name === attachment.name && item.size === attachment.size)) {
              attachments.push(attachment);
            }
          }
          next[existingIndex] = {
            ...existing,
            attachments,
            status: "pending",
            launchId: null,
            error: null,
          };
        }
        return next;
      });
      setNotice(
        `${groups.length} nota(s) adicionada(s) à lista${parsed.length !== groups.length ? "; PDF e XML da mesma nota foram agrupados" : ""}.`,
      );
      if (failures.length) setError(failures.join(" | "));
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  }

  async function validateAll() {
    if (!allReady) {
      setError("Revise os campos destacados antes de validar o lote.");
      return;
    }
    setValidating(true);
    setError(null);
    setNotice(null);
    let failures = 0;

    for (const draft of drafts) {
      patchDraft(draft.id, { status: "validating", progressLabel: "Validando campos e modelo Fluig.", error: null });
      try {
        const overrides = fieldOverrides(draft);
        await fluigAdmApi.openDryRun({
          module: "pagamentos",
          sourceRequestId: draft.sourceRequestId,
          fieldOverrides: overrides,
          attachments: draft.attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
          mode: "production",
        });
        const amountCents = parseCurrencyToCents(draft.values.valorNF || "");
        if (amountCents == null) throw new Error("Valor da nota inválido.");
        const validated = await fluigAdmApi.validateOperationalLaunch({
          module: "pagamentos",
          sourceRequestId: draft.sourceRequestId,
          title: `Pagamento - ${draft.values.fornecedorC} - NF ${draft.values.nNotaFiscal}`,
          description: draft.values.descricaoDemandaEnvio,
          supplierId: draft.supplierId,
          supplierName: draft.values.fornecedorC,
          supplierCnpj: draft.values.codCNPJ,
          branchCode: draft.branchCode,
          branchLabel: draft.values.unidadeFilial,
          amountCents,
          dueDate: draft.values.vencPagNota,
          fieldOverrides: overrides,
          attachments: draft.attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
          fiscalDocument: {
            sourceType: draft.document.sourceType,
            supplierCnpj: draft.document.supplierCnpj,
            takerName: draft.document.takerName,
            takerCnpj: draft.document.takerCnpj,
          },
          items: [],
        });
        patchDraft(draft.id, {
          status: "validated",
          launchId: validated.launch.id,
          progressLabel: "Todos os campos foram validados.",
          error: null,
        });
      } catch (validationError) {
        failures += 1;
        patchDraft(draft.id, {
          status: "error",
          launchId: null,
          progressLabel: null,
          error: validationError instanceof Error ? validationError.message : "Falha na validação.",
        });
      }
    }

    setValidating(false);
    setNotice(failures ? `${drafts.length - failures} nota(s) validadas; ${failures} precisam de revisão.` : "Todas as notas estão validadas e prontas para abrir no Fluig.");
  }

  async function submitDrafts(targets: BatchDraft[]) {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    let opened = 0;
    let failures = 0;

    for (const draft of targets) {
      if (!draft.launchId) continue;
      patchDraft(draft.id, { status: "opening", progressLabel: "Aguardando a VPS abrir esta nota no Fluig.", error: null });
      try {
        const created = await fluigAdmApi.submitOperationalLaunch(draft.launchId, draft.attachments);
        const completedJob = await waitForFluigJob(created.job.id, {
          onUpdate: ({ job }) => patchDraft(draft.id, { progressLabel: job.progressLabel || "Execução em andamento." }),
        });
        if (completedJob.job.status !== "success") {
          throw new Error(
            completedJob.job.errorMessage ||
              completedJob.job.progressLabel ||
              `Execução finalizada com status ${completedJob.job.status}.`,
          );
        }
        const completed = await fluigAdmApi.getOperationalLaunch(draft.launchId);
        const launch = completed.launches[0] || null;
        opened += 1;
        patchDraft(draft.id, {
          status: "opened",
          fluigRequestId: launch?.fluigRequestId || null,
          progressLabel: launch?.fluigRequestId ? `Fluig ${launch.fluigRequestId} aberto.` : "Solicitação aberta no Fluig.",
          error: null,
        });
      } catch (submitError) {
        failures += 1;
        patchDraft(draft.id, {
          status: "error",
          progressLabel: null,
          error: submitError instanceof Error ? submitError.message : "Falha ao abrir no Fluig.",
        });
      }
    }

    setSubmitting(false);
    await onCompleted?.();
    setNotice(
      failures
        ? `${opened} Fluig(s) abertos; ${failures} nota(s) ficaram disponíveis para nova tentativa.`
        : `${opened} solicitação(ões) Fluig abertas com sucesso, uma para cada nota fiscal.`,
    );
  }

  const canValidate = canCreate && allReady && !importing && !validating && !submitting && drafts.every((draft) => ["pending", "error"].includes(draft.status) && !draft.launchId);
  const initialSubmitTargets = allValidated ? drafts : [];
  const retryTargets = drafts.filter((draft) => draft.status === "error" && draft.launchId);

  return (
    <section className="rounded-lg border border-primary/25 bg-primary/[0.025]">
      <header className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileStack className="size-5 text-primary" />
            <h4 className="font-semibold">Importar notas em lote</h4>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Selecione vários PDFs ou XMLs. O sistema agrupa os arquivos da mesma nota, preenche os modelos e cria um Fluig separado para cada documento.
          </p>
        </div>
        <label className={cn(
          "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted",
          (importing || validating || submitting || !canCreate) && "pointer-events-none opacity-50",
        )}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          Selecionar várias notas
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.xml"
            disabled={importing || validating || submitting || !canCreate}
            onChange={(event) => {
              void importFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </header>

      <div className="space-y-4 p-4">
        {importProgress ? <p className="flex items-center gap-2 text-xs text-primary"><Loader2 className="size-3 animate-spin" />{importProgress}</p> : null}
        {notice ? <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">{notice}</p> : null}
        {error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">{error}</p> : null}

        {drafts.length ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <BatchMetric label="Notas na lista" value={String(drafts.length)} />
              <BatchMetric label="Validadas" value={String(validatedCount)} />
              <BatchMetric label="Fluigs abertos" value={String(openedCount)} />
              <BatchMetric label="Valor total" value={new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalAmount / 100)} />
            </div>

            <div className="space-y-3">
              {drafts.map((draft, index) => {
                const missing = missingFields(draft);
                const presentation = statusPresentation(draft.status);
                const editable = ["pending", "error"].includes(draft.status) && !draft.launchId && !validating && !submitting;
                return (
                  <details key={draft.id} className="rounded-md border bg-background" open={draft.status === "error" || missing.length > 0}>
                    <summary className="cursor-pointer list-none p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Nota {index + 1}: NF {draft.values.nNotaFiscal || "não identificada"}</span>
                            <Badge variant="outline" className={presentation.className}>{presentation.label}</Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {[draft.values.fornecedorC, draft.values.codCNPJ, draft.values.unidadeFilial].filter(Boolean).join(" — ") || "Complete os dados da nota"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span>{draft.attachments.length} arquivo(s)</span>
                          {draft.fluigRequestId ? <strong className="text-emerald-700">Fluig {draft.fluigRequestId}</strong> : null}
                          {editable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remover nota ${index + 1}`}
                              onClick={(event) => {
                                event.preventDefault();
                                setDrafts((current) => current.filter((item) => item.id !== draft.id));
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </summary>
                    <div className="border-t p-3">
                      {missing.length ? (
                        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                          Preencha: {missing.join(", ")}.
                        </p>
                      ) : (
                        <p className="mb-3 flex items-center gap-2 text-xs text-emerald-700">
                          <CheckCircle2 className="size-4" /> Campos obrigatórios preenchidos.
                        </p>
                      )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-1">
                          <Label>Modelo Fluig *</Label>
                          <Input
                            value={draft.sourceRequestId}
                            disabled={!editable}
                            onChange={(event) => patchDraft(draft.id, { sourceRequestId: event.target.value, status: "pending", error: null })}
                          />
                        </div>
                        {batchFields.map((field) => (
                          <div key={field.key} className={cn("space-y-1", field.type === "textarea" && "md:col-span-2 xl:col-span-3")}>
                            <Label>{field.label} {field.required ? "*" : ""}</Label>
                            {field.type === "textarea" ? (
                              <Textarea
                                value={draft.values[field.key] || ""}
                                disabled={!editable}
                                onChange={(event) => updateValue(draft, field.key, event.target.value)}
                              />
                            ) : (
                              <Input
                                type={field.type === "date" ? "date" : "text"}
                                inputMode={field.key === "valorNF" ? "decimal" : undefined}
                                value={draft.values[field.key] || ""}
                                disabled={!editable}
                                onChange={(event) => updateValue(draft, field.key, event.target.value)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {draft.attachments.map((attachment) => (
                          <span key={`${attachment.name}-${attachment.size}`} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">
                            <Paperclip className="size-3" />{attachment.name}
                          </span>
                        ))}
                      </div>
                      {draft.progressLabel ? <p className="mt-3 text-xs text-primary">{draft.progressLabel}</p> : null}
                      {draft.error ? <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">{draft.error}</p> : null}
                    </div>
                  </details>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                O envio começa somente depois que todas as notas estiverem validadas. A VPS processará uma por vez.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={!canValidate} onClick={() => void validateAll()}>
                  {validating ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
                  Validar todas
                </Button>
                <Button
                  type="button"
                  disabled={submitting || validating || (!initialSubmitTargets.length && !retryTargets.length)}
                  onClick={() => void submitDrafts(initialSubmitTargets.length ? initialSubmitTargets : retryTargets)}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  {retryableErrors ? `Tentar novamente ${retryableErrors}` : `Abrir ${drafts.length} Fluig(s)`}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed bg-background p-6 text-center">
            <FileStack className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Nenhuma nota adicionada ao lote</p>
            <p className="mt-1 text-xs text-muted-foreground">Você pode misturar notas do mesmo fornecedor ou de fornecedores diferentes.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function BatchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
