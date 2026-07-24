export type BatchFiscalAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
};

export type BatchFiscalDocument = {
  sourceType: "xml" | "pdf";
  supplierName: string | null;
  supplierCnpj: string | null;
  takerName: string | null;
  takerCnpj: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amountCents: number | null;
  description: string | null;
  warnings: string[];
};

export type ParsedBatchFiscalFile<TMatch = unknown> = {
  attachment: BatchFiscalAttachment;
  document: BatchFiscalDocument;
  match: TMatch;
};

export type GroupedBatchFiscalDocument<TMatch = unknown> = {
  key: string;
  attachments: BatchFiscalAttachment[];
  document: BatchFiscalDocument;
  match: TMatch;
};

function normalizedIdentity(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase();
}

export function batchFiscalDocumentKey(
  document: Pick<BatchFiscalDocument, "supplierCnpj" | "supplierName" | "invoiceNumber">,
  fallback: string,
) {
  const supplier = normalizedIdentity(document.supplierCnpj) || normalizedIdentity(document.supplierName);
  const invoice = normalizedIdentity(document.invoiceNumber);
  return supplier && invoice ? `${supplier}:${invoice}` : `arquivo:${fallback}`;
}

function mergeDocuments(current: BatchFiscalDocument, incoming: BatchFiscalDocument) {
  const preferred = incoming.sourceType === "xml" ? incoming : current;
  const fallback = preferred === incoming ? current : incoming;
  return {
    sourceType: preferred.sourceType,
    supplierName: preferred.supplierName || fallback.supplierName,
    supplierCnpj: preferred.supplierCnpj || fallback.supplierCnpj,
    takerName: preferred.takerName || fallback.takerName,
    takerCnpj: preferred.takerCnpj || fallback.takerCnpj,
    invoiceNumber: preferred.invoiceNumber || fallback.invoiceNumber,
    issueDate: preferred.issueDate || fallback.issueDate,
    dueDate: preferred.dueDate || fallback.dueDate,
    amountCents: preferred.amountCents ?? fallback.amountCents,
    description: preferred.description || fallback.description,
    warnings: Array.from(new Set([...current.warnings, ...incoming.warnings])),
  } satisfies BatchFiscalDocument;
}

export function groupBatchFiscalFiles<TMatch>(
  files: ParsedBatchFiscalFile<TMatch>[],
): GroupedBatchFiscalDocument<TMatch>[] {
  const groups = new Map<string, GroupedBatchFiscalDocument<TMatch>>();

  for (const file of files) {
    const key = batchFiscalDocumentKey(file.document, file.attachment.name);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        attachments: [file.attachment],
        document: file.document,
        match: file.match,
      });
      continue;
    }

    current.attachments.push(file.attachment);
    current.document = mergeDocuments(current.document, file.document);
    if (file.document.sourceType === "xml") current.match = file.match;
  }

  return Array.from(groups.values());
}
