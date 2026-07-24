"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { ExpenseAuthorizationRecord } from "@/lib/expense-authorization";
import type { FiscalDocumentData } from "@/lib/fiscal-document";
import { parseCurrencyToCents } from "@/lib/operational-launch";

type BranchOption = { id: string; code: string; label: string };
type SourceDocument = { name: string; mimeType: string; sourceType: "pdf" | "xml"; warnings: string[] };

type Draft = {
  module: "pagamentos" | "compras";
  branchId: string;
  issueDate: string;
  invoiceNumber: string;
  invoiceDueDate: string;
  supplierName: string;
  supplierTaxId: string;
  expenseType: string;
  description: string;
  expenseAccount: string;
  financialAccount: string;
  costCenter: string;
  amount: string;
  amountWords: string;
  beneficiaryCategory: string;
  beneficiaryName: string;
  beneficiaryTaxId: string;
  beneficiaryPhone: string;
  paymentMethod: string;
  bankName: string;
  bankOperation: string;
  bankAgency: string;
  bankAccount: string;
  pixKey: string;
  requesterName: string;
  requesterRole: string;
  budgetPlanned: string;
  budgetRealized: string;
  additionalInfo: string;
  fluigRequestId: string;
  physicalLocation: string;
  deliveredTo: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({
  module: "pagamentos",
  branchId: "",
  issueDate: today(),
  invoiceNumber: "",
  invoiceDueDate: "",
  supplierName: "",
  supplierTaxId: "",
  expenseType: "",
  description: "",
  expenseAccount: "",
  financialAccount: "",
  costCenter: "",
  amount: "",
  amountWords: "",
  beneficiaryCategory: "",
  beneficiaryName: "",
  beneficiaryTaxId: "",
  beneficiaryPhone: "",
  paymentMethod: "",
  bankName: "",
  bankOperation: "",
  bankAgency: "",
  bankAccount: "",
  pixKey: "",
  requesterName: "",
  requesterRole: "",
  budgetPlanned: "",
  budgetRealized: "",
  additionalInfo: "",
  fluigRequestId: "",
  physicalLocation: "",
  deliveredTo: "",
});

function moneyInput(cents: number | null) {
  return cents == null ? "" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(cents / 100);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Falha HTTP ${response.status}.`);
  return data;
}

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? "md:col-span-2 xl:col-span-3" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export function AdfCreateSheet({
  open,
  onOpenChange,
  branches,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: BranchOption[];
  onCreated: (authorization: ExpenseAuthorizationRecord) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sourceDocument, setSourceDocument] = useState<SourceDocument | null>(null);
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fiscalInputRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function close(nextOpen: boolean) {
    if (!nextOpen && (reading || creating)) return;
    if (!nextOpen) {
      setDraft(emptyDraft());
      setSourceDocument(null);
    }
    onOpenChange(nextOpen);
  }

  async function importFiscalDocument(file: File) {
    if (file.size > 3 * 1024 * 1024) {
      toast.error("O PDF ou XML deve ter ate 3 MB.");
      return;
    }
    setReading(true);
    try {
      const data = await readJson<{
        success: true;
        document: FiscalDocumentData;
        branch: BranchOption | null;
      }>(
        await fetch("/api/adfs/fiscal-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type || (file.name.toLowerCase().endsWith(".xml") ? "application/xml" : "application/pdf"),
            size: file.size,
            dataBase64: await fileToBase64(file),
          }),
        })
      );
      const document = data.document;
      setSourceDocument({
        name: file.name,
        mimeType: file.type || (document.sourceType === "xml" ? "application/xml" : "application/pdf"),
        sourceType: document.sourceType,
        warnings: document.warnings,
      });
      setDraft((current) => ({
        ...current,
        branchId: data.branch?.id || current.branchId,
        issueDate: document.issueDate || current.issueDate,
        invoiceNumber: document.invoiceNumber || current.invoiceNumber,
        invoiceDueDate: document.dueDate || current.invoiceDueDate,
        supplierName: document.supplierName || current.supplierName,
        supplierTaxId: document.supplierCnpj || current.supplierTaxId,
        description: document.description || current.description,
        amount: moneyInput(document.amountCents) || current.amount,
        beneficiaryCategory: document.supplierName ? "EMPRESA" : current.beneficiaryCategory,
        beneficiaryName: document.supplierName || current.beneficiaryName,
        beneficiaryTaxId: document.supplierCnpj || current.beneficiaryTaxId,
      }));
      toast.success(`${document.sourceType.toUpperCase()} lido. Confira os campos antes de criar a ADF.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao ler o documento fiscal.");
    } finally {
      setReading(false);
      if (fiscalInputRef.current) fiscalInputRef.current.value = "";
    }
  }

  async function createAuthorization() {
    if (!draft.description.trim()) {
      toast.error("Informe o objetivo e a justificativa da ADF.");
      return;
    }
    const budgetPlannedCents = parseCurrencyToCents(draft.budgetPlanned);
    const budgetRealizedCents = parseCurrencyToCents(draft.budgetRealized);
    const budgetDeviationCents =
      budgetPlannedCents == null && budgetRealizedCents == null
        ? null
        : (budgetRealizedCents || 0) - (budgetPlannedCents || 0);
    const budgetDeviationPercent = budgetPlannedCents
      ? ((budgetDeviationCents || 0) / budgetPlannedCents) * 100
      : null;
    setCreating(true);
    try {
      const payload = {
        ...draft,
        branchId: draft.branchId || null,
        invoiceNumber: draft.invoiceNumber || null,
        invoiceDueDate: draft.invoiceDueDate || null,
        amountCents: parseCurrencyToCents(draft.amount),
        budgetPlannedCents,
        budgetRealizedCents,
        budgetDeviationCents,
        budgetDeviationPercent,
        creationSource: sourceDocument ? "DOCUMENTO_FISCAL" : "MANUAL",
        sourceDocument,
        amount: undefined,
        budgetPlanned: undefined,
        budgetRealized: undefined,
      };
      const data = await readJson<{ success: true; authorization: ExpenseAuthorizationRecord }>(
        await fetch("/api/adfs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      onCreated(data.authorization);
      setDraft(emptyDraft());
      setSourceDocument(null);
      onOpenChange(false);
      toast.success(`${data.authorization.documentNumber} criada e aberta para complementacao.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar ADF.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[min(1180px,calc(100vw-2rem))] sm:data-[side=right]:max-w-none">
        <SheetHeader className="border-b px-6 py-5 pr-14">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <SheetTitle>Nova ADF</SheetTitle>
              <SheetDescription className="mt-1.5">
                Preencha manualmente ou importe uma nota em PDF/XML. Todos os dados continuam editaveis antes e depois da criacao.
              </SheetDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fiscalInputRef}
                type="file"
                accept="application/pdf,application/xml,text/xml,.pdf,.xml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFiscalDocument(file);
                }}
              />
              <Button variant="outline" onClick={() => fiscalInputRef.current?.click()} disabled={reading || creating}>
                {reading ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                {reading ? "Lendo documento..." : "Preencher por PDF ou XML"}
              </Button>
              <Button onClick={() => void createAuthorization()} disabled={reading || creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Criar ADF
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-5 py-5 sm:px-6">
          <div className="space-y-4">
            {sourceDocument ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">{sourceDocument.name} lido com sucesso</p>
                <p className="mt-1 text-xs">Os dados reconhecidos foram preenchidos. Revise os campos destacados no formulario.</p>
                {sourceDocument.warnings.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {sourceDocument.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <Section title="Origem, filial e nota fiscal" description="Identifique de onde vem a despesa e, se existir, os dados da nota e do Fluig.">
              <Field label="Modulo">
                <Select value={draft.module} onValueChange={(value) => update("module", value as Draft["module"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pagamentos">Pagamento</SelectItem>
                    <SelectItem value="compras">Compra / cotacao</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Filial">
                <Select value={draft.branchId || "__NONE__"} onValueChange={(value) => update("branchId", value === "__NONE__" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="Selecione a filial" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Sem filial definida</SelectItem>
                    {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Numero Fluig"><Input value={draft.fluigRequestId} onChange={(event) => update("fluigRequestId", event.target.value)} placeholder="Se ja existir" /></Field>
              <Field label="Numero da nota"><Input value={draft.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)} /></Field>
              <Field label="Emissao"><Input type="date" value={draft.issueDate} onChange={(event) => update("issueDate", event.target.value)} /></Field>
              <Field label="Vencimento da nota"><Input type="date" value={draft.invoiceDueDate} onChange={(event) => update("invoiceDueDate", event.target.value)} /></Field>
              <Field label="Fornecedor / razao social"><Input value={draft.supplierName} onChange={(event) => update("supplierName", event.target.value)} /></Field>
              <Field label="CNPJ do fornecedor"><Input value={draft.supplierTaxId} onChange={(event) => update("supplierTaxId", event.target.value)} /></Field>
            </Section>

            <Section title="Identificacao da despesa" description="Informe a classificacao, o valor e a justificativa da autorizacao.">
              <Field label="Tipo de despesa"><Input value={draft.expenseType} onChange={(event) => update("expenseType", event.target.value)} /></Field>
              <Field label="Centro de custo"><Input value={draft.costCenter} onChange={(event) => update("costCenter", event.target.value)} /></Field>
              <Field label="Conta de despesa"><Input value={draft.expenseAccount} onChange={(event) => update("expenseAccount", event.target.value)} /></Field>
              <Field label="Conta financeira / contabil"><Input value={draft.financialAccount} onChange={(event) => update("financialAccount", event.target.value)} /></Field>
              <Field label="Valor total"><Input inputMode="decimal" value={draft.amount} onChange={(event) => update("amount", event.target.value)} placeholder="0,00" /></Field>
              <Field label="Objetivo e justificativa" wide><Textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} /></Field>
              <Field label="Valor por extenso" wide><Input value={draft.amountWords} onChange={(event) => update("amountWords", event.target.value)} /></Field>
            </Section>

            <Section title="Beneficiario e pagamento" description="Preencha a identificacao fiscal e os dados bancarios que acompanham a ADF.">
              <Field label="Categoria"><Input value={draft.beneficiaryCategory} onChange={(event) => update("beneficiaryCategory", event.target.value)} /></Field>
              <Field label="Nome / razao social"><Input value={draft.beneficiaryName} onChange={(event) => update("beneficiaryName", event.target.value)} /></Field>
              <Field label="CPF / CNPJ"><Input value={draft.beneficiaryTaxId} onChange={(event) => update("beneficiaryTaxId", event.target.value)} /></Field>
              <Field label="Telefone"><Input value={draft.beneficiaryPhone} onChange={(event) => update("beneficiaryPhone", event.target.value)} /></Field>
              <Field label="Forma de pagamento"><Input value={draft.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)} /></Field>
              <Field label="Banco"><Input value={draft.bankName} onChange={(event) => update("bankName", event.target.value)} /></Field>
              <Field label="Operacao"><Input value={draft.bankOperation} onChange={(event) => update("bankOperation", event.target.value)} /></Field>
              <Field label="Agencia"><Input value={draft.bankAgency} onChange={(event) => update("bankAgency", event.target.value)} /></Field>
              <Field label="Conta"><Input value={draft.bankAccount} onChange={(event) => update("bankAccount", event.target.value)} /></Field>
              <Field label="Chave PIX" wide><Input value={draft.pixKey} onChange={(event) => update("pixKey", event.target.value)} /></Field>
            </Section>

            <Section title="Orcamento, solicitante e controle" description="Complete os dados internos; eles tambem poderao ser alterados depois.">
              <Field label="Orcamento mensal"><Input inputMode="decimal" value={draft.budgetPlanned} onChange={(event) => update("budgetPlanned", event.target.value)} placeholder="0,00" /></Field>
              <Field label="Realizado no mes"><Input inputMode="decimal" value={draft.budgetRealized} onChange={(event) => update("budgetRealized", event.target.value)} placeholder="0,00" /></Field>
              <Field label="Solicitante"><Input value={draft.requesterName} onChange={(event) => update("requesterName", event.target.value)} /></Field>
              <Field label="Funcao"><Input value={draft.requesterRole} onChange={(event) => update("requesterRole", event.target.value)} /></Field>
              <Field label="Localizacao atual"><Input value={draft.physicalLocation} onChange={(event) => update("physicalLocation", event.target.value)} /></Field>
              <Field label="Entregue para"><Input value={draft.deliveredTo} onChange={(event) => update("deliveredTo", event.target.value)} /></Field>
              <Field label="Informacoes adicionais" wide><Textarea value={draft.additionalInfo} onChange={(event) => update("additionalInfo", event.target.value)} rows={3} /></Field>
            </Section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
