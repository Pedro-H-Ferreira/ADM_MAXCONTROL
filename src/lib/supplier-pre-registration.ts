import { canonicalHistoricalCnpj, onlyDigits } from "@/lib/cnpj";
import { normalizedLookupDefaults, type JsonRecord } from "@/lib/supplier-lookup";

export type SupplierPreRegistrationCandidate = {
  id?: string | null;
  candidateKey?: string | null;
  supplierName?: string | null;
  cnpj?: string | null;
  fluigName?: string | null;
  fluigCode?: string | null;
  confidence?: number | string | null;
  sourceRequestIds?: string[] | null;
  suggestedDefaults?: JsonRecord | null;
};

export type ConsolidatedSupplierPreRegistration = {
  cnpj: string;
  razaoSocial: string;
  fluigName: string | null;
  fluigCode: string | null;
  defaultSourceRequestId: string | null;
  defaultPayload: JsonRecord;
  candidateIds: string[];
  candidateKeys: string[];
  sourceRequestIds: string[];
  confidence: number;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function supplierLegalName(rawName: unknown, cnpj: unknown, fluigCode?: unknown) {
  const original = cleanText(rawName) || "Fornecedor Fluig";
  const code = cleanText(fluigCode);
  const taxId = onlyDigits(cnpj);
  let name = original;

  if (code) {
    name = name.replace(new RegExp(`^${escapeRegExp(code)}\\s*-\\s*`, "i"), "");
  } else {
    name = name.replace(/^\d+\s*-\s*/, "");
  }

  if (taxId) {
    name = name.replace(/\s*-\s*[\d./-]{8,}\s*$/, "");
  }

  return cleanText(name) || original;
}

function score(candidate: SupplierPreRegistrationCandidate) {
  const confidence = Number(candidate.confidence || 0);
  return confidence * 1000 + (candidate.sourceRequestIds?.length || 0);
}

export function consolidateSupplierPreRegistrations(candidates: SupplierPreRegistrationCandidate[]) {
  const grouped = new Map<string, SupplierPreRegistrationCandidate[]>();
  let invalidCnpj = 0;

  for (const candidate of candidates) {
    const cnpj = canonicalHistoricalCnpj(candidate.cnpj);
    if (!cnpj) {
      invalidCnpj += 1;
      continue;
    }
    grouped.set(cnpj, [...(grouped.get(cnpj) || []), candidate]);
  }

  const items = Array.from(grouped.entries()).map(([cnpj, matches]) => {
    const ordered = [...matches].sort((left, right) => score(right) - score(left));
    const best = ordered[0];
    const sourceRequestIds = Array.from(
      new Set(ordered.flatMap((candidate) => candidate.sourceRequestIds || []).filter(Boolean))
    );
    const mergedDefaults = ordered
      .slice()
      .reverse()
      .reduce<JsonRecord>((acc, candidate) => ({ ...acc, ...(candidate.suggestedDefaults || {}) }), {});
    const defaultPayload = normalizedLookupDefaults(mergedDefaults);
    const fluigName = cleanText(best.fluigName) || cleanText(best.supplierName);
    const fluigCode = cleanText(best.fluigCode);

    return {
      cnpj,
      razaoSocial: supplierLegalName(best.supplierName || best.fluigName, cnpj, fluigCode),
      fluigName,
      fluigCode,
      defaultSourceRequestId:
        cleanText(defaultPayload.latestRequest) ||
        cleanText(mergedDefaults.sourceRequestId) ||
        sourceRequestIds[0] ||
        null,
      defaultPayload: {
        ...defaultPayload,
        source: "fluig_supplier_candidate",
        sourceRequestIds,
      },
      candidateIds: ordered.map((candidate) => cleanText(candidate.id)).filter(Boolean) as string[],
      candidateKeys: ordered.map((candidate) => cleanText(candidate.candidateKey)).filter(Boolean) as string[],
      sourceRequestIds,
      confidence: Number(best.confidence || 0),
    } satisfies ConsolidatedSupplierPreRegistration;
  });

  return {
    items: items.sort((left, right) => left.razaoSocial.localeCompare(right.razaoSocial)),
    invalidCnpj,
  };
}
