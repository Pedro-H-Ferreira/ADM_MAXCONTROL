"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FileSignature,
  Loader2,
  MapPin,
  Paperclip,
  Printer,
  RefreshCw,
  Search,
  Send,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import {
  expenseAuthorizationStatusLabels,
  expenseAuthorizationStatuses,
  formatAuthorizationMoney,
  type ExpenseAuthorizationRecord,
  type ExpenseAuthorizationStatus,
} from "@/lib/expense-authorization";
import { parseCurrencyToCents } from "@/lib/operational-launch";

type Permissions = { canUpdate: boolean; canApprove: boolean };

type AuthorizationForm = {
  issueDate: string;
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
  physicalLocation: string;
  deliveredTo: string;
};

function moneyInput(cents: number | null) {
  return cents == null ? "" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(cents / 100);
}

function formFromAuthorization(item: ExpenseAuthorizationRecord): AuthorizationForm {
  return {
    issueDate: item.issueDate || "",
    expenseType: item.expenseType || "",
    description: item.description || "",
    expenseAccount: item.expenseAccount || "",
    financialAccount: item.financialAccount || "",
    costCenter: item.costCenter || "",
    amount: moneyInput(item.amountCents),
    amountWords: item.amountWords || "",
    beneficiaryCategory: item.beneficiaryCategory || "",
    beneficiaryName: item.beneficiaryName || "",
    beneficiaryTaxId: item.beneficiaryTaxId || "",
    beneficiaryPhone: item.beneficiaryPhone || "",
    paymentMethod: item.paymentMethod || "",
    bankName: item.bankName || "",
    bankOperation: item.bankOperation || "",
    bankAgency: item.bankAgency || "",
    bankAccount: item.bankAccount || "",
    pixKey: item.pixKey || "",
    requesterName: item.requesterName || "",
    requesterRole: item.requesterRole || "",
    budgetPlanned: moneyInput(item.budgetPlannedCents),
    budgetRealized: moneyInput(item.budgetRealizedCents),
    additionalInfo: item.additionalInfo || "",
    physicalLocation: item.physicalLocation || "",
    deliveredTo: item.deliveredTo || "",
  };
}

function statusClass(status: ExpenseAuthorizationStatus) {
  if (status === "ANEXADA_FLUIG") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "ASSINADA" || status === "ENTREGUE") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "AGUARDANDO_ASSINATURA" || status === "ANEXO_NA_FILA") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "CANCELADA") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function formatDateTime(value: string | null) {
  if (!value) return "Nao registrado";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Falha HTTP ${response.status}.`);
  return data;
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DetailSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
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

export function AdfControlPage() {
  const [items, setItems] = useState<ExpenseAuthorizationRecord[]>([]);
  const [permissions, setPermissions] = useState<Permissions>({ canUpdate: false, canApprove: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ExpenseAuthorizationStatus | "TODOS">("TODOS");
  const [selected, setSelected] = useState<ExpenseAuthorizationRecord | null>(null);
  const [form, setForm] = useState<AuthorizationForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await readJson<{
        success: true;
        authorizations: ExpenseAuthorizationRecord[];
        permissions: Permissions;
      }>(await fetch("/api/adfs", { cache: "no-store" }));
      setItems(data.authorizations);
      setPermissions(data.permissions);
      setSelected((current) => {
        if (!current) return null;
        return data.authorizations.find((item) => item.id === current.id) || current;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar ADFs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function openAuthorization(item: ExpenseAuthorizationRecord) {
    setSelected(item);
    setForm(formFromAuthorization(item));
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      if (statusFilter !== "TODOS" && item.status !== statusFilter) return false;
      if (!normalized) return true;
      return [item.documentNumber, item.supplierName, item.fluigRequestId, item.description, item.branchLabel]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [items, query, statusFilter]);

  const metrics = useMemo(
    () => ({
      total: items.length,
      signature: items.filter((item) => item.status === "AGUARDANDO_ASSINATURA").length,
      signed: items.filter((item) => item.status === "ASSINADA" || item.status === "ENTREGUE").length,
      fluig: items.filter((item) => item.status === "ANEXADA_FLUIG").length,
    }),
    [items]
  );

  function updateForm<K extends keyof AuthorizationForm>(key: K, value: AuthorizationForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function patchSelected(payload: Record<string, unknown>, successMessage: string) {
    if (!selected) return;
    setSaving(true);
    try {
      const data = await readJson<{ success: true; authorization: ExpenseAuthorizationRecord }>(
        await fetch(`/api/adfs/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      setSelected(data.authorization);
      setForm(formFromAuthorization(data.authorization));
      setItems((current) => current.map((item) => (item.id === data.authorization.id ? data.authorization : item)));
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar ADF.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (!form) return;
    const budgetPlannedCents = parseCurrencyToCents(form.budgetPlanned);
    const budgetRealizedCents = parseCurrencyToCents(form.budgetRealized);
    const budgetDeviationCents =
      budgetPlannedCents == null && budgetRealizedCents == null
        ? null
        : (budgetRealizedCents || 0) - (budgetPlannedCents || 0);
    const budgetDeviationPercent = budgetPlannedCents
      ? ((budgetDeviationCents || 0) / budgetPlannedCents) * 100
      : null;
    await patchSelected(
      {
        ...form,
        amountCents: parseCurrencyToCents(form.amount),
        budgetPlannedCents,
        budgetRealizedCents,
        budgetDeviationCents,
        budgetDeviationPercent,
        amount: undefined,
        budgetPlanned: undefined,
        budgetRealized: undefined,
      },
      "ADF atualizada."
    );
  }

  async function uploadSigned(file: File) {
    if (!selected) return;
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append("file", file);
      const data = await readJson<{ success: true; authorization: ExpenseAuthorizationRecord }>(
        await fetch(`/api/adfs/${selected.id}/signed-document`, { method: "POST", body: payload })
      );
      setSelected(data.authorization);
      setForm(formFromAuthorization(data.authorization));
      setItems((current) => current.map((item) => (item.id === data.authorization.id ? data.authorization : item)));
      toast.success("PDF assinado recebido e registrado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar PDF assinado.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function attachToFluig() {
    if (!selected) return;
    setAttaching(true);
    try {
      const data = await readJson<{ success: true; authorization: ExpenseAuthorizationRecord }>(
        await fetch(`/api/adfs/${selected.id}/attach`, { method: "POST" })
      );
      setSelected(data.authorization);
      setForm(formFromAuthorization(data.authorization));
      setItems((current) => current.map((item) => (item.id === data.authorization.id ? data.authorization : item)));
      toast.success("Envio para o Fluig colocado na fila do agente local.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao anexar no Fluig.");
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governanca de despesas"
        title="Controle de ADF"
        description="Autorizacoes geradas pelos lancamentos de Pagamentos e Compras, da emissao ate a confirmacao do anexo no Fluig."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "ADFs controladas", value: metrics.total, helper: "Documentos vinculados a lancamentos", icon: FileSignature },
          { label: "Aguardando assinatura", value: metrics.signature, helper: "Impressas e ainda sem retorno", icon: Clock3 },
          { label: "Assinadas a encaminhar", value: metrics.signed, helper: "Prontas para entrega ou Fluig", icon: FileCheck2 },
          { label: "Confirmadas no Fluig", value: metrics.fluig, helper: "Anexo validado na solicitacao", icon: CheckCircle2 },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-start justify-between p-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
              </div>
              <div className="grid size-9 place-items-center rounded-md border bg-muted/40">
                <metric.icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por ADF, fornecedor, filial ou numero Fluig"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ExpenseAuthorizationStatus | "TODOS")}>
              <SelectTrigger className="w-full lg:w-[230px]">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os status</SelectItem>
                {expenseAuthorizationStatuses.map((status) => (
                  <SelectItem key={status} value={status}>{expenseAuthorizationStatusLabels[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              Atualizar
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : filtered.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ADF</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Beneficiario</TableHead>
                    <TableHead>Filial</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Fluig</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28 text-right">Acao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.id} className="cursor-pointer" onClick={() => openAuthorization(item)}>
                      <TableCell>
                        <p className="font-semibold">{item.documentNumber}</p>
                        <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR").format(new Date(`${item.issueDate}T12:00:00`))}</p>
                      </TableCell>
                      <TableCell>{item.module === "pagamentos" ? "Pagamento" : "Compra / cotacao"}</TableCell>
                      <TableCell className="max-w-[240px] truncate">{item.beneficiaryName || item.supplierName || "Nao informado"}</TableCell>
                      <TableCell>{item.branchLabel || item.branchCode || "—"}</TableCell>
                      <TableCell className="text-right font-medium">{formatAuthorizationMoney(item.amountCents)}</TableCell>
                      <TableCell>{item.fluigRequestId || "A abrir"}</TableCell>
                      <TableCell><Badge variant="outline" className={statusClass(item.status)}>{expenseAuthorizationStatusLabels[item.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openAuthorization(item); }}>
                          Acompanhar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <FileSignature className="mx-auto size-9 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">Nenhuma ADF encontrada</p>
              <p className="mt-1 text-sm text-muted-foreground">A ADF sera criada automaticamente ao validar um novo Pagamento ou Compra.</p>
            </div>
          )}
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            Exibindo {filtered.length} de {items.length} ADFs.
          </div>
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) { setSelected(null); setForm(null); } }}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[min(1180px,calc(100vw-2rem))] sm:data-[side=right]:max-w-none">
          {selected && form ? (
            <>
              <SheetHeader className="border-b px-6 py-5 pr-14">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle>{selected.documentNumber}</SheetTitle>
                      <Badge variant="outline" className={statusClass(selected.status)}>{expenseAuthorizationStatusLabels[selected.status]}</Badge>
                    </div>
                    <SheetDescription className="mt-1.5">
                      {selected.module === "pagamentos" ? "Lancamento de pagamento" : "Compra / cotacao"} · {selected.branchLabel || selected.branchCode || "Sem filial"} · Fluig {selected.fluigRequestId || "ainda nao aberto"}
                    </SheetDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" asChild>
                      <Link href={`/adfs/${selected.id}/imprimir`} target="_blank">
                        <Printer className="size-4" aria-hidden="true" />
                        Gerar impressao
                      </Link>
                    </Button>
                    {permissions.canUpdate && selected.status === "EM_ELABORACAO" ? (
                      <Button variant="outline" onClick={() => void patchSelected({ status: "AGUARDANDO_ASSINATURA" }, "ADF marcada como aguardando assinatura.")} disabled={saving}>
                        <Send className="size-4" aria-hidden="true" />
                        Enviar para assinatura
                      </Button>
                    ) : null}
                    {permissions.canUpdate ? (
                      <Button onClick={() => void saveDetails()} disabled={saving}>
                        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                        Salvar ADF
                      </Button>
                    ) : null}
                  </div>
                </div>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-5 py-5 sm:px-6">
                <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_330px]">
                  <div className="space-y-4">
                    <DetailSection title="Identificacao da despesa" description="Dados mantidos no padrao da ADF atual e preenchidos a partir do lancamento.">
                      <FormField label="Data de emissao"><Input type="date" value={form.issueDate} onChange={(event) => updateForm("issueDate", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Tipo de despesa"><Input value={form.expenseType} onChange={(event) => updateForm("expenseType", event.target.value)} disabled={!permissions.canUpdate} placeholder="Contrato, aquisicao, manutencao..." /></FormField>
                      <FormField label="Centro de custo"><Input value={form.costCenter} onChange={(event) => updateForm("costCenter", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Conta de despesa"><Input value={form.expenseAccount} onChange={(event) => updateForm("expenseAccount", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Conta financeira / contabil"><Input value={form.financialAccount} onChange={(event) => updateForm("financialAccount", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Valor total"><Input inputMode="decimal" value={form.amount} onChange={(event) => updateForm("amount", event.target.value)} disabled={!permissions.canUpdate} placeholder="0,00" /></FormField>
                      <FormField label="Objetivo e justificativa" className="md:col-span-2 xl:col-span-3"><Textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} disabled={!permissions.canUpdate} rows={3} /></FormField>
                      <FormField label="Valor por extenso" className="md:col-span-2 xl:col-span-3"><Input value={form.amountWords} onChange={(event) => updateForm("amountWords", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                    </DetailSection>

                    <DetailSection title="Beneficiario e pagamento" description="Identificacao fiscal e dados bancarios que acompanham a autorizacao.">
                      <FormField label="Categoria do beneficiario"><Input value={form.beneficiaryCategory} onChange={(event) => updateForm("beneficiaryCategory", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Nome / razao social"><Input value={form.beneficiaryName} onChange={(event) => updateForm("beneficiaryName", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="CPF / CNPJ"><Input value={form.beneficiaryTaxId} onChange={(event) => updateForm("beneficiaryTaxId", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Telefone"><Input value={form.beneficiaryPhone} onChange={(event) => updateForm("beneficiaryPhone", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Forma de pagamento"><Input value={form.paymentMethod} onChange={(event) => updateForm("paymentMethod", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Banco"><Input value={form.bankName} onChange={(event) => updateForm("bankName", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Operacao"><Input value={form.bankOperation} onChange={(event) => updateForm("bankOperation", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Agencia"><Input value={form.bankAgency} onChange={(event) => updateForm("bankAgency", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Conta"><Input value={form.bankAccount} onChange={(event) => updateForm("bankAccount", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Chave PIX" className="md:col-span-2 xl:col-span-3"><Input value={form.pixKey} onChange={(event) => updateForm("pixKey", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                    </DetailSection>

                    <DetailSection title="Orcamento e informacoes adicionais" description="O percentual e calculado apenas quando existe orcamento mensal valido.">
                      <FormField label="Orcamento mensal"><Input inputMode="decimal" value={form.budgetPlanned} onChange={(event) => updateForm("budgetPlanned", event.target.value)} disabled={!permissions.canUpdate} placeholder="0,00" /></FormField>
                      <FormField label="Realizado no mes"><Input inputMode="decimal" value={form.budgetRealized} onChange={(event) => updateForm("budgetRealized", event.target.value)} disabled={!permissions.canUpdate} placeholder="0,00" /></FormField>
                      <FormField label="Solicitante"><Input value={form.requesterName} onChange={(event) => updateForm("requesterName", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Funcao"><Input value={form.requesterRole} onChange={(event) => updateForm("requesterRole", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                      <FormField label="Informacoes adicionais" className="md:col-span-2 xl:col-span-3"><Textarea value={form.additionalInfo} onChange={(event) => updateForm("additionalInfo", event.target.value)} disabled={!permissions.canUpdate} rows={3} /></FormField>
                    </DetailSection>
                  </div>

                  <aside className="space-y-4">
                    <Card>
                      <CardContent className="space-y-4 p-5">
                        <div>
                          <p className="text-sm font-semibold">Documento assinado</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Depois da assinatura fisica, envie o PDF retornado para manter a versao oficial.</p>
                        </div>
                        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSigned(file); }} />
                        <Button className="w-full" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!permissions.canUpdate || uploading}>
                          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Paperclip className="size-4" aria-hidden="true" />}
                          {selected.signedDocumentName ? "Substituir PDF assinado" : "Enviar PDF assinado"}
                        </Button>
                        {selected.signedDocumentName ? (
                          <div className="rounded-md border bg-muted/30 p-3 text-xs">
                            <p className="truncate font-medium">{selected.signedDocumentName}</p>
                            <p className="mt-1 text-muted-foreground">Recebido em {formatDateTime(selected.signedDocumentReceivedAt)}</p>
                            <Button size="sm" variant="ghost" asChild className="mt-2 px-0">
                              <a href={`/api/adfs/${selected.id}/signed-document`} target="_blank" rel="noreferrer"><Download className="size-4" aria-hidden="true" /> Baixar PDF</a>
                            </Button>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-4 p-5">
                        <div>
                          <p className="text-sm font-semibold">Localizacao e entrega</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Registre onde esta a via fisica e para quem foi entregue.</p>
                        </div>
                        <FormField label="Localizacao atual"><Input value={form.physicalLocation} onChange={(event) => updateForm("physicalLocation", event.target.value)} disabled={!permissions.canUpdate} placeholder="Diretoria, Financeiro, arquivo..." /></FormField>
                        <FormField label="Entregue para"><Input value={form.deliveredTo} onChange={(event) => updateForm("deliveredTo", event.target.value)} disabled={!permissions.canUpdate} /></FormField>
                        <Button className="w-full" variant="outline" onClick={() => void patchSelected({ physicalLocation: form.physicalLocation, deliveredTo: form.deliveredTo, status: "ENTREGUE" }, "Entrega da ADF registrada.")} disabled={!permissions.canUpdate || saving}>
                          <Truck className="size-4" aria-hidden="true" />
                          Registrar entrega
                        </Button>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-4 p-5">
                        <div>
                          <p className="text-sm font-semibold">Anexo na solicitacao Fluig</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">O agente confirma o arquivo na solicitacao {selected.fluigRequestId || "que ainda sera aberta"} antes de concluir.</p>
                        </div>
                        <Button className="w-full" onClick={() => void attachToFluig()} disabled={!permissions.canUpdate || attaching || !selected.signedDocumentName || !selected.fluigRequestId || selected.status === "ANEXO_NA_FILA" || selected.status === "ANEXADA_FLUIG"}>
                          {attaching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Paperclip className="size-4" aria-hidden="true" />}
                          {selected.status === "ANEXADA_FLUIG" ? "Confirmada no Fluig" : selected.status === "ANEXO_NA_FILA" ? "Aguardando agente" : "Anexar no Fluig aberto"}
                        </Button>
                        {!selected.fluigRequestId ? <p className="text-xs text-amber-700">A solicitacao pode ser aberta primeiro; este botao sera liberado quando o numero Fluig retornar.</p> : null}
                        {selected.lastErrorMessage ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{selected.lastErrorMessage}</p> : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-5">
                        <div className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" aria-hidden="true" /><p className="text-sm font-semibold">Historico</p></div>
                        <div className="mt-4 space-y-0">
                          {selected.events.length ? selected.events.map((event, index) => (
                            <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                              {index < selected.events.length - 1 ? <span className="absolute left-[5px] top-3 h-full w-px bg-border" /> : null}
                              <span className="relative mt-1.5 size-3 shrink-0 rounded-full border-2 border-background bg-slate-700 ring-1 ring-border" />
                              <div><p className="text-xs font-medium leading-5">{event.label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(event.createdAt)}</p></div>
                            </div>
                          )) : <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </aside>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
