import { XMLParser } from "fast-xml-parser";
import { formatCnpj, normalizeCnpj } from "@/lib/cnpj";

type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue };

export type FiscalDocumentData = {
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

function cleanText(value: unknown) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizedKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function findNode(value: JsonValue, keys: string[]): JsonValue | null {
  const wanted = new Set(keys.map(normalizedKey));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNode(item, keys);
      if (found != null) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, item] of Object.entries(value)) {
    if (wanted.has(normalizedKey(key))) return item;
  }
  for (const item of Object.values(value)) {
    const found = findNode(item, keys);
    if (found != null) return found;
  }
  return null;
}

function nodeText(value: JsonValue | null, keys: string[]) {
  const found = value == null ? null : findNode(value, keys);
  if (Array.isArray(found)) return cleanText(found[0]);
  if (found && typeof found === "object") {
    return cleanText((found as JsonRecord)["#text"]);
  }
  return cleanText(found);
}

function isoDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ptBr = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(text);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;
  return null;
}

function moneyToCents(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const stripped = text.replace(/[^\d,.-]/g, "");
  const decimalSeparator = stripped.lastIndexOf(",") > stripped.lastIndexOf(".") ? "," : ".";
  const normalized =
    decimalSeparator === ","
      ? stripped.replace(/\./g, "").replace(",", ".")
      : stripped.replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function canonicalCnpj(value: unknown) {
  const normalized = normalizeCnpj(value);
  return normalized ? formatCnpj(normalized) : null;
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function cnpjNearSection(text: string, sectionNames: string[]) {
  const section = sectionNames.map((item) => item.replace(/\s+/g, "\\s*")).join("|");
  return firstMatch(text, [
    new RegExp(`(?:${section})[\\s\\S]{0,500}?CNPJ\\s*[:\\-]?\\s*(\\d{2}\\.?\\d{3}\\.?\\d{3}[\\/]?\\d{4}-?\\d{2})`, "i"),
    new RegExp(`CNPJ\\s*[:\\-]?\\s*(\\d{2}\\.?\\d{3}\\.?\\d{3}[\\/]?\\d{4}-?\\d{2})[\\s\\S]{0,200}?(?:${section})`, "i"),
  ]);
}

function nameNearSection(text: string, sectionNames: string[]) {
  const section = sectionNames.map((item) => item.replace(/\s+/g, "\\s*")).join("|");
  return firstMatch(text, [
    new RegExp(
      `(?:${section})\\s*(?:\\/|\\-|:)?\\s*(?:RAZ[AÃ]O\\s+SOCIAL\\s*[:\\-]?\\s*)?([^\\r\\n]{3,120})`,
      "i"
    ),
  ]);
}

function descriptionFor(data: Pick<FiscalDocumentData, "supplierName" | "invoiceNumber" | "issueDate">) {
  const parts = [
    data.invoiceNumber ? `Nota fiscal ${data.invoiceNumber}` : "Nota fiscal",
    data.supplierName ? `de ${data.supplierName}` : null,
    data.issueDate ? `emitida em ${data.issueDate.split("-").reverse().join("/")}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function parseFiscalXml(xml: string): FiscalDocumentData {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as JsonRecord;
  const serviceProvider = findNode(parsed, ["PrestadorServico", "Prestador", "Emitente"]);
  const supplier = serviceProvider || findNode(parsed, ["emit"]);
  const serviceTaker = findNode(parsed, ["TomadorServico", "Tomador"]);
  const taker = serviceTaker || findNode(parsed, ["dest", "Destinatario"]);
  const duplicate = findNode(parsed, ["dup", "Duplicata"]);
  const totals = findNode(parsed, ["ICMSTot", "ValoresNfse", "Valores", "Servico"]);
  const supplierName = nodeText(supplier, ["RazaoSocial", "xNome", "NomeRazaoSocial", "Nome"]);
  const supplierCnpj = canonicalCnpj(nodeText(supplier, ["CNPJ", "CpfCnpj"]));
  const takerName = nodeText(taker, ["RazaoSocial", "xNome", "NomeRazaoSocial", "Nome"]);
  const takerCnpj = canonicalCnpj(nodeText(taker, ["CNPJ", "CpfCnpj"]));
  const issueDate = isoDate(nodeText(parsed, ["dhEmi", "dEmi", "DataEmissao", "Competencia"]));
  const invoiceNumber = nodeText(parsed, ["nNF", "NumeroNfse", "NumeroNota", "Numero"]);
  const dueDate = isoDate(nodeText(duplicate, ["dVenc", "DataVencimento", "Vencimento"]));
  const amountCents = moneyToCents(
    nodeText(totals, ["vNF", "ValorLiquidoNfse", "ValorLiquido", "ValorServicos", "ValorTotal"])
  );
  const warnings: string[] = [];
  if (!supplierCnpj) warnings.push("O XML nao informou um CNPJ de fornecedor reconhecivel.");
  if (!takerCnpj && !takerName) warnings.push("O XML nao informou o tomador/destinatario para identificar a filial.");
  if (!dueDate) warnings.push("O XML nao possui vencimento; confira ou preencha a data manualmente.");

  const data: FiscalDocumentData = {
    sourceType: "xml",
    supplierName,
    supplierCnpj,
    takerName,
    takerCnpj,
    invoiceNumber,
    issueDate,
    dueDate,
    amountCents,
    description: null,
    warnings,
  };
  data.description = descriptionFor(data);
  return data;
}

export function parseFiscalPdfText(text: string): FiscalDocumentData {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const supplierCnpj = canonicalCnpj(
    cnpjNearSection(normalized, ["emitente", "fornecedor", "prestador de servicos", "prestador"])
  );
  const takerCnpj = canonicalCnpj(
    cnpjNearSection(normalized, ["destinatario", "tomador de servicos", "tomador", "destinatario/remetente"])
  );
  const supplierName = nameNearSection(normalized, ["emitente", "fornecedor", "prestador de servicos", "prestador"]);
  const takerName = nameNearSection(normalized, ["destinatario", "tomador de servicos", "tomador"]);
  const invoiceNumber = firstMatch(normalized, [
    /(?:N[ÚU]MERO\s+(?:DA\s+)?(?:NFS-?E|NOTA(?:\s+FISCAL)?)|N[º°]\s*(?:DA\s+)?NOTA)\s*[:\-]?\s*([A-Z0-9./-]+)/i,
    /(?:NF-?E|NFS-?E)\s*(?:N[º°]|N[ÚU]MERO)?\s*[:\-]?\s*([A-Z0-9./-]+)/i,
  ]);
  const issueDate = isoDate(
    firstMatch(normalized, [
      /DATA\s+(?:E\s+HORA\s+)?DE\s+EMISS[AÃ]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
      /EMISS[AÃ]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    ])
  );
  const dueDate = isoDate(
    firstMatch(normalized, [
      /(?:DATA\s+DE\s+)?VENCIMENTO\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
      /VENC\.?\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    ])
  );
  const amountCents = moneyToCents(
    firstMatch(normalized, [
      /VALOR\s+(?:TOTAL\s+DA\s+NOTA|TOTAL\s+DO\s+DOCUMENTO|L[IÍ]QUIDO\s+DA\s+NFS-?E)\s*[:\-]?\s*(?:R\$\s*)?([\d.,]+)/i,
      /VALOR\s+TOTAL\s*[:\-]?\s*(?:R\$\s*)?([\d.,]+)/i,
    ])
  );
  const warnings: string[] = [];
  if (!supplierCnpj) warnings.push("Nao foi possivel reconhecer automaticamente o CNPJ do fornecedor no PDF.");
  if (!takerCnpj && !takerName) warnings.push("Nao foi possivel reconhecer o tomador/destinatario no PDF.");
  if (!dueDate) warnings.push("O PDF nao informou um vencimento reconhecivel; confira ou preencha manualmente.");

  const data: FiscalDocumentData = {
    sourceType: "pdf",
    supplierName,
    supplierCnpj,
    takerName,
    takerCnpj,
    invoiceNumber,
    issueDate,
    dueDate,
    amountCents,
    description: null,
    warnings,
  };
  data.description = descriptionFor(data);
  return data;
}
