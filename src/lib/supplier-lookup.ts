import { formatCnpj, onlyDigits } from "@/lib/cnpj";

export type JsonRecord = Record<string, unknown>;

export type SupplierRequestEvidence = {
  latestRequestId: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  supplierName: string | null;
  defaults: JsonRecord;
  sourceRequestIds: string[];
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return null;
}

function leadingCode(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^([A-Za-z0-9._-]+)\s*(?:-|\/|\s)/);
  return match?.[1]?.trim() || null;
}

const paymentCompetencyFields = new Set([
  "nNotaFiscal",
  "numeroNotaFiscal",
  "numeroDocumento",
  "dataEmissaoNF",
  "dataPagamento",
  "dataVencimento",
  "vencPagNota",
  "valorNF",
  "valorNFT",
  "valorTotalExibicao",
  "descricaoDemandaEnvio",
  "descricao",
  "observacao",
  "obsFiscal",
]);

function withoutPaymentCompetencyFields(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !paymentCompetencyFields.has(key))
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return [
            key,
            value
              .filter((item) => {
                if (!item || typeof item !== "object") return true;
                const fieldName = cleanText((item as JsonRecord).field);
                return !fieldName || !paymentCompetencyFields.has(fieldName);
              })
              .map((item) =>
                item && typeof item === "object" ? withoutPaymentCompetencyFields(item as JsonRecord) : item
              ),
          ];
        }
        if (value && typeof value === "object") {
          return [key, withoutPaymentCompetencyFields(value as JsonRecord)];
        }
        return [key, value];
      })
  );
}

export function historicalCnpjVariants(cnpj: string) {
  const variants = new Set([cnpj, formatCnpj(cnpj)]);
  const withoutLeadingZeros = cnpj.replace(/^0+/, "");
  if (withoutLeadingZeros.length >= 12) {
    variants.add(withoutLeadingZeros);
  }
  return Array.from(variants);
}

export function historicalCnpjMatches(value: unknown, normalizedCnpj: string) {
  const digits = onlyDigits(value);
  if (!digits) return false;
  if (digits === normalizedCnpj) return true;
  return digits.length >= 12 && digits.length < 14 && digits.padStart(14, "0") === normalizedCnpj;
}

export function payloadFormFields(payload: JsonRecord) {
  const nestedRaw = (payload.raw || {}) as JsonRecord;
  const rawPayload = (payload.rawPayload || {}) as JsonRecord;
  const candidates = [
    payload.latestFields,
    payload.formFields,
    rawPayload.formFields,
    nestedRaw.formFields,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return Object.fromEntries(
        candidate
          .map((item) => {
            const row = (item || {}) as JsonRecord;
            const field = cleanText(row.field);
            return field ? [field, cleanText(row.value) || ""] : null;
          })
          .filter(Boolean) as Array<[string, string]>
      );
    }
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as JsonRecord).map(([key, value]) => [key, cleanText(value) || ""])
      );
    }
  }

  return {} as Record<string, string>;
}

export function normalizedLookupDefaults(
  defaultPayload: JsonRecord,
  evidence?: SupplierRequestEvidence | null
) {
  const fields = withoutPaymentCompetencyFields(payloadFormFields(defaultPayload));
  const reusablePayload = withoutPaymentCompetencyFields(defaultPayload);
  const merged = { ...fields, ...reusablePayload };
  const branchLabel =
    evidence?.branchLabel ||
    firstText(merged, ["branchLabel", "unidadeFilial", "filial", "filialOrigem"]) ||
    null;
  const branchCode =
    evidence?.branchCode ||
    firstText(merged, ["branchCode", "coFilial", "codigoFilial", "codFilial"]) ||
    leadingCode(branchLabel);

  return {
    ...reusablePayload,
    ...(reusablePayload.latestFields ? { latestFields: fields } : {}),
    branchCode,
    branchLabel,
    unidadeFilial: firstText(merged, ["unidadeFilial", "branchLabel", "filial"]) || branchLabel,
    centroCusto: firstText(merged, ["centroCusto", "centroDeCusto", "ccusto"]),
    codCentroCusto: firstText(merged, ["codCentroCusto", "codCCusto"]) || leadingCode(merged.centroCusto),
    natureza: firstText(merged, ["natureza", "codigonaturezaC", "naturezaSalva", "codNatureza"]),
    formaPagamento: firstText(merged, ["formaPagamento", "tipoPagamento", "meioPagamento"]),
    latestRequest: evidence?.latestRequestId || firstText(merged, ["latestRequest", "sourceRequestId"]),
  };
}

export function withLookupReview<T extends Record<string, unknown>>(suggestion: T) {
  const defaults = (suggestion.defaultPayload || {}) as JsonRecord;
  const autoFilledFields = [
    suggestion.cnpj ? "CNPJ" : null,
    suggestion.razaoSocial ? "Razao social" : null,
    suggestion.fluigName ? "Nome no Fluig" : null,
    suggestion.fluigCode ? "Codigo Fluig" : null,
    suggestion.defaultSourceRequestId ? "Solicitacao modelo" : null,
    suggestion.branchLabel || defaults.branchLabel || defaults.unidadeFilial ? "Filial mais usada" : null,
    defaults.centroCusto || defaults.codCentroCusto ? "Centro de custo" : null,
    defaults.natureza ? "Natureza de despesa" : null,
    defaults.formaPagamento ? "Forma de pagamento" : null,
  ].filter((field): field is string => Boolean(field));

  return {
    ...suggestion,
    autoFilledFields,
    reviewFields: ["Nome fantasia", "Categoria", "Contato", "Endereco"],
  };
}

export function mergeSuggestionWithEvidence<T extends Record<string, unknown>>(
  suggestion: T,
  evidence: SupplierRequestEvidence | null
) {
  if (!evidence) return withLookupReview(suggestion);
  const currentDefaults = (suggestion.defaultPayload || {}) as JsonRecord;
  const defaultPayload = normalizedLookupDefaults(
    {
      ...evidence.defaults,
      ...currentDefaults,
    },
    evidence
  );

  return withLookupReview({
    ...suggestion,
    razaoSocial: suggestion.razaoSocial || evidence.supplierName,
    branchCode: evidence.branchCode,
    branchLabel: evidence.branchLabel,
    latestRequestId: evidence.latestRequestId,
    defaultPayload,
    sourceRequestIds: Array.from(
      new Set([
        ...((suggestion.sourceRequestIds as string[] | undefined) || []),
        ...evidence.sourceRequestIds,
      ])
    ),
  });
}
