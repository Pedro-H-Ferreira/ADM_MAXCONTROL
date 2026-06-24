export type OperationalLaunchModule = "pagamentos" | "compras";

export type OperationalLaunchStatus =
  | "VALIDADO"
  | "NA_FILA"
  | "EM_EXECUCAO"
  | "ABERTO_NO_FLUIG"
  | "ERRO"
  | "CANCELADO";

export type OperationalLaunchAttachment = {
  name: string;
  mimeType: string;
  size: number;
};

export type OperationalLaunchAttachmentPayload = OperationalLaunchAttachment & {
  dataBase64: string;
};

export type OperationalLaunchItemInput = {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  metadata?: Record<string, unknown>;
};

export type OperationalLaunchJobSummary = {
  status: string;
  progressStage: string | null;
  progressLabel: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
};

export type OperationalLaunchRecord = {
  id: string;
  module: OperationalLaunchModule;
  status: OperationalLaunchStatus;
  title: string;
  description: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierCnpj: string | null;
  branchId: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  sourceRequestId: string;
  fluigJobId: string | null;
  fluigRequestId: string | null;
  fluigRequestRowId: string | null;
  amountCents: number | null;
  dueDate: string | null;
  fieldOverrides: Record<string, string>;
  attachments: OperationalLaunchAttachment[];
  reviewFingerprint: string;
  progressStage: string | null;
  progressLabel: string | null;
  lastErrorMessage: string | null;
  validatedAt: string;
  queuedAt: string | null;
  openedAt: string | null;
  failedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  items: Array<OperationalLaunchItemInput & { id: string; lineNumber: number; totalCents: number }>;
  job: OperationalLaunchJobSummary | null;
};

export type OperationalLaunchValidateInput = {
  module: OperationalLaunchModule;
  sourceRequestId: string;
  title: string;
  description?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierCnpj?: string | null;
  branchCode?: string | null;
  branchLabel?: string | null;
  amountCents?: number | null;
  dueDate?: string | null;
  fieldOverrides: Record<string, string>;
  attachments: OperationalLaunchAttachment[];
  items?: OperationalLaunchItemInput[];
};

const requiredFields: Record<OperationalLaunchModule, string[]> = {
  pagamentos: [
    "fornecedorC",
    "codCNPJ",
    "unidadeFilial",
    "codigonaturezaC",
    "centroCusto",
    "formaPagamento",
    "nNotaFiscal",
    "dataEmissaoNF",
    "vencPagNota",
    "valorNF",
    "descricaoDemandaEnvio",
  ],
  compras: ["dataPedido", "codFilialPedido", "centroCusto", "contaCentroCusto", "descricaoProduto"],
};

function normalizedAttachments(attachments: OperationalLaunchAttachment[]) {
  return attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size }));
}

export function operationalLaunchFingerprint(input: {
  sourceRequestId: string;
  fieldOverrides: Record<string, string>;
  attachments: OperationalLaunchAttachment[];
  items?: OperationalLaunchItemInput[];
}) {
  return JSON.stringify({
    sourceRequestId: input.sourceRequestId,
    fieldOverrides: Object.fromEntries(
      Object.entries(input.fieldOverrides).sort(([left], [right]) => left.localeCompare(right))
    ),
    attachments: normalizedAttachments(input.attachments),
    items: (input.items || []).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
    })),
  });
}

export function isFiscalLaunchAttachment(attachment: OperationalLaunchAttachment) {
  const lowerName = attachment.name.toLowerCase();
  return (
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".xml") ||
    attachment.mimeType === "application/pdf" ||
    attachment.mimeType.toLowerCase().includes("xml")
  );
}

export function validateOperationalLaunch(input: OperationalLaunchValidateInput) {
  const errors: string[] = [];
  const missing = requiredFields[input.module].filter((field) => !String(input.fieldOverrides[field] || "").trim());

  if (missing.length) errors.push(`Campos obrigatorios ausentes: ${missing.join(", ")}.`);
  if (!input.sourceRequestId.trim()) errors.push("Modelo Fluig de origem nao informado.");
  if (!input.branchCode?.trim() && !input.branchLabel?.trim()) errors.push("Filial nao informada.");

  if (input.module === "pagamentos") {
    if (!input.supplierId) errors.push("Selecione um fornecedor oficial ativo do cadastro ADM.");
    if (!input.attachments.some(isFiscalLaunchAttachment)) {
      errors.push("Anexe ao menos um PDF ou XML da nota fiscal.");
    }
  }

  if (input.module === "compras" && !(input.items || []).length) {
    errors.push("Adicione ao menos um item na requisicao de compra.");
  }

  return errors;
}

export function formatPurchaseItemsForFluig(items: OperationalLaunchItemInput[]) {
  return items
    .map((item, index) => {
      const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(item.quantity);
      const unitPrice = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
        item.unitPriceCents / 100
      );
      return `${index + 1}. ${item.description} - ${quantity} ${item.unit} - ${unitPrice} por unidade`;
    })
    .join("\n");
}

export function parseCurrencyToCents(value: string) {
  const normalized = value
    .trim()
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  if (!/\d/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}
