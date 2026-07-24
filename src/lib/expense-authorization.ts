import type { OperationalLaunchModule } from "@/lib/operational-launch";

export type ExpenseAuthorizationStatus =
  | "EM_ELABORACAO"
  | "AGUARDANDO_ASSINATURA"
  | "ASSINADA"
  | "ENTREGUE"
  | "ANEXO_NA_FILA"
  | "ANEXADA_FLUIG"
  | "CANCELADA";

export type ExpenseAuthorizationCreationSource = "LANCAMENTO" | "MANUAL" | "DOCUMENTO_FISCAL";

export type ExpenseAuthorizationEvent = {
  id: string;
  eventType: string;
  label: string;
  statusFrom: ExpenseAuthorizationStatus | null;
  statusTo: ExpenseAuthorizationStatus | null;
  createdAt: string;
};

export type ExpenseAuthorizationItem = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  totalCents: number;
};

export type ExpenseAuthorizationRecord = {
  id: string;
  documentNumber: string;
  launchId: string | null;
  module: OperationalLaunchModule;
  creationSource: ExpenseAuthorizationCreationSource;
  status: ExpenseAuthorizationStatus;
  issueDate: string;
  invoiceNumber: string | null;
  invoiceDueDate: string | null;
  expenseType: string | null;
  description: string;
  expenseAccount: string | null;
  financialAccount: string | null;
  costCenter: string | null;
  branchId: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  amountCents: number | null;
  amountWords: string | null;
  beneficiaryCategory: string | null;
  beneficiaryName: string | null;
  beneficiaryTaxId: string | null;
  beneficiaryPhone: string | null;
  paymentMethod: string | null;
  bankName: string | null;
  bankOperation: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  pixKey: string | null;
  requesterName: string | null;
  requesterRole: string | null;
  budgetPlannedCents: number | null;
  budgetRealizedCents: number | null;
  budgetDeviationCents: number | null;
  budgetDeviationPercent: number | null;
  additionalInfo: string | null;
  fluigRequestId: string | null;
  physicalLocation: string | null;
  deliveredTo: string | null;
  signedDocumentName: string | null;
  signedDocumentSize: number | null;
  signedDocumentReceivedAt: string | null;
  sentForSignatureAt: string | null;
  deliveredAt: string | null;
  attachedToFluigAt: string | null;
  attachJobId: string | null;
  lastErrorMessage: string | null;
  sourceRequestId: string | null;
  sourceFields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  items: ExpenseAuthorizationItem[];
  events: ExpenseAuthorizationEvent[];
};

export type ExpenseAuthorizationUpdateInput = Partial<{
  module: OperationalLaunchModule;
  status: ExpenseAuthorizationStatus;
  issueDate: string;
  invoiceNumber: string | null;
  invoiceDueDate: string | null;
  expenseType: string | null;
  description: string;
  expenseAccount: string | null;
  financialAccount: string | null;
  costCenter: string | null;
  branchId: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  amountCents: number | null;
  amountWords: string | null;
  beneficiaryCategory: string | null;
  beneficiaryName: string | null;
  beneficiaryTaxId: string | null;
  beneficiaryPhone: string | null;
  paymentMethod: string | null;
  bankName: string | null;
  bankOperation: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  pixKey: string | null;
  requesterName: string | null;
  requesterRole: string | null;
  budgetPlannedCents: number | null;
  budgetRealizedCents: number | null;
  budgetDeviationCents: number | null;
  budgetDeviationPercent: number | null;
  additionalInfo: string | null;
  fluigRequestId: string | null;
  physicalLocation: string | null;
  deliveredTo: string | null;
}>;

export type ExpenseAuthorizationCreateInput = Omit<
  ExpenseAuthorizationUpdateInput,
  "status"
> & {
  module: OperationalLaunchModule;
  issueDate: string;
  description: string;
  creationSource: Exclude<ExpenseAuthorizationCreationSource, "LANCAMENTO">;
  sourceDocument?: {
    name: string;
    mimeType: string;
    sourceType: "pdf" | "xml";
    warnings?: string[];
  } | null;
};

export const expenseAuthorizationStatusLabels: Record<ExpenseAuthorizationStatus, string> = {
  EM_ELABORACAO: "Em elaboracao",
  AGUARDANDO_ASSINATURA: "Aguardando assinatura",
  ASSINADA: "Assinada",
  ENTREGUE: "Entregue",
  ANEXO_NA_FILA: "Anexo na fila",
  ANEXADA_FLUIG: "Anexada no Fluig",
  CANCELADA: "Cancelada",
};

export const expenseAuthorizationStatuses = [
  "EM_ELABORACAO",
  "AGUARDANDO_ASSINATURA",
  "ASSINADA",
  "ENTREGUE",
  "ANEXO_NA_FILA",
  "ANEXADA_FLUIG",
  "CANCELADA",
] as const satisfies readonly ExpenseAuthorizationStatus[];

export function formatAuthorizationMoney(cents: number | null) {
  if (cents == null) return "Nao informado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function authorizationNeedsAttention(status: ExpenseAuthorizationStatus) {
  return status === "EM_ELABORACAO" || status === "AGUARDANDO_ASSINATURA" || status === "ASSINADA";
}

export function expenseAuthorizationSourceData(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { sourceRequestId: null, sourceFields: {} as Record<string, string> };
  }

  const source = snapshot as Record<string, unknown>;
  const rawFields =
    source.fieldOverrides && typeof source.fieldOverrides === "object" && !Array.isArray(source.fieldOverrides)
      ? (source.fieldOverrides as Record<string, unknown>)
      : {};
  const sourceFields = Object.fromEntries(
    Object.entries(rawFields)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : String(value ?? "").trim()])
      .filter(([, value]) => value)
  );

  return {
    sourceRequestId: typeof source.sourceRequestId === "string" ? source.sourceRequestId.trim() || null : null,
    sourceFields,
  };
}
