import { XMLParser } from "fast-xml-parser";
import { formatCnpj, normalizeCnpj } from "@/lib/cnpj";

type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue };

export type FiscalDocumentType = "nfe" | "nfse" | "cte" | "invoice" | "rental" | "unknown";

export type FiscalDocumentData = {
  sourceType: "xml" | "pdf";
  documentType: FiscalDocumentType;
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
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizedKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
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
  if (found && typeof found === "object") return cleanText((found as JsonRecord)["#text"]);
  return cleanText(found);
}

function isoDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ptBr = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(text);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;
  const short = /^(\d{2})[/-](\d{2})[/-](\d{2})(?:\D|$)/.exec(text);
  return short ? `20${short[3]}-${short[2]}-${short[1]}` : null;
}

function moneyToCents(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const stripped = text.replace(/[^\d,.-]/g, "");
  const decimalSeparator = stripped.lastIndexOf(",") > stripped.lastIndexOf(".") ? "," : ".";
  const normalized = decimalSeparator === ","
    ? stripped.replace(/\./g, "").replace(",", ".")
    : stripped.replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function canonicalCnpj(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const normalized = normalizeCnpj(digits.length >= 12 && digits.length < 14 ? digits.padStart(14, "0") : digits);
  return normalized ? formatCnpj(normalized) : null;
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function foldText(value: string) {
  return value
    .replace(/ÃƒÂ/g, "A")
    .replace(/Ã‡|Ã§/g, "C")
    .replace(/Ãƒ|Ã£|Ã|Ã¡/g, "A")
    .replace(/Ã‰|Ã©/g, "E")
    .replace(/Ã|Ã­/g, "I")
    .replace(/Ã“|Ã³|Ã”|Ã´/g, "O")
    .replace(/Ãš|Ãº/g, "U")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9$.,/:%@()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function allCnpjs(text: string) {
  const candidates = [
    ...[...text.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}/g)].map((match) => ({
      index: match.index,
      value: match[0],
    })),
    ...[...text.matchAll(/(?:CNPJ(?:\s*\/\s*CPF)?|CPF\s*\/\s*CNPJ)\s*:?\s*(\d{12,14})\b/g)].map((match) => ({
      index: match.index,
      value: match[1],
    })),
    ...[...text.matchAll(/\b(\d{12,14})\s+CNPJ\s*:/g)].map((match) => ({
      index: match.index,
      value: match[1],
    })),
  ].sort((left, right) => left.index - right.index);
  return candidates
    .map((candidate) => canonicalCnpj(candidate.value))
    .filter((item): item is string => Boolean(item));
}

function sectionSlice(text: string, starts: string[], ends: string[], maxLength = 1800) {
  const positions = starts.map((label) => text.indexOf(label)).filter((position) => position >= 0);
  if (!positions.length) return "";
  const start = Math.min(...positions);
  const endPositions = ends.map((label) => text.indexOf(label, start + 1)).filter((position) => position > start);
  const end = endPositions.length ? Math.min(...endPositions) : start + maxLength;
  return text.slice(start, Math.min(end, start + maxLength));
}

function cnpjFromSection(text: string, starts: string[], ends: string[]) {
  return allCnpjs(sectionSlice(text, starts, ends))[0] || null;
}

function labeledName(section: string) {
  return firstMatch(section, [
    /(?:NOME\s*\/\s*NOME EMPRESARIAL|NOME\s*\/\s*RAZAO|NOME\/RAZAO SOCIAL|NOME RAZAO SOCIAL|RAZAO SOCIAL|CLIENTE)\s*:?\s*([A-Z0-9][A-Z0-9 .&'/-]{2,100}?)(?=\s+(?:NOME FANTASIA|ENDERECO|CNPJ|CPF|INSCRICAO|E-MAIL|EMAIL|MUNICIPIO|CEP|TELEFONE|DATA)\b|$)/i,
  ]);
}

function detectPdfType(text: string): FiscalDocumentType {
  if (/\bDACTE\b|CONHECIMENTO DE TRANSPORTE ELETRONICO|\bCT-E\b/.test(text)) return "cte";
  if (/\bDANFSE\b|\bNFS-E\b|NOTA FISCAL DE SERVICO/.test(text)) return "nfse";
  if (/\bDANFE\b|\bNF-E\b|NOTA FISCAL ELETRONICA|EMITENTE[\s\S]{0,400}DESTINATARIO[\s\S]{0,400}NUMERO DA NOTA FISCAL/.test(text)) return "nfe";
  if (/NOTA DE LOCACAO/.test(text)) return "rental";
  if (/FATURA DE LOCACAO|RECIBO\s*\/\s*FATURA/.test(text)) return "invoice";
  return "unknown";
}

function digitsOnlyInvoice(value: string | null) {
  const digits = value?.replace(/\D/g, "") || "";
  return digits ? String(Number(digits)) : null;
}

function lastMoney(text: string) {
  const values = [...text.matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/g)];
  return values.length ? values[values.length - 1][1] : null;
}

function descriptionFor(data: Pick<FiscalDocumentData, "supplierName" | "invoiceNumber" | "issueDate">) {
  return [
    data.invoiceNumber ? `Nota fiscal ${data.invoiceNumber}` : "Nota fiscal",
    data.supplierName ? `de ${data.supplierName}` : null,
    data.issueDate ? `emitida em ${data.issueDate.split("-").reverse().join("/")}` : null,
  ].filter(Boolean).join(" ");
}

export function parseFiscalXml(xml: string): FiscalDocumentData {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
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
  const amountCents = moneyToCents(nodeText(totals, ["vNF", "ValorLiquidoNfse", "ValorLiquido", "ValorServicos", "ValorTotal"]));
  const warnings: string[] = [];
  if (!supplierCnpj) warnings.push("O XML nao informou um CNPJ de fornecedor reconhecivel.");
  if (!takerCnpj && !takerName) warnings.push("O XML nao informou o tomador/destinatario para identificar a filial.");
  if (!dueDate) warnings.push("O XML nao possui vencimento; confira ou preencha a data manualmente.");
  const data: FiscalDocumentData = {
    sourceType: "xml",
    documentType: findNode(parsed, ["infCte", "CTe"]) ? "cte" : serviceProvider ? "nfse" : "nfe",
    supplierName, supplierCnpj, takerName, takerCnpj, invoiceNumber, issueDate, dueDate, amountCents,
    description: null,
    warnings,
  };
  data.description = descriptionFor(data);
  return data;
}

export function parseFiscalPdfText(text: string): FiscalDocumentData {
  const normalized = foldText(text.replace(/\u00a0/g, " "));
  const documentType = detectPdfType(normalized);
  const supplierStarts = documentType === "nfse"
    ? ["IDENTIFICACAO DO PRESTADOR", "EMITENTE DA NFS-E", "DADOS DO PRESTADOR", "PRESTADOR DO SERVICO"]
    : documentType === "cte"
      ? ["DACTE", "CONHECIMENTO DE TRANSPORTE ELETRONICO"]
      : ["IDENTIFICACAO DO EMITENTE", "DANFE"];
  const takerStarts = documentType === "nfse"
    ? ["IDENTIFICACAO DO TOMADOR", "TOMADOR DO SERVICO", "DADOS DO TOMADOR"]
    : documentType === "cte" ? ["TOMADOR DO SERVICO"] : ["DESTINATARIO / REMETENTE", "DESTINATARIO"];
  const supplierSection = sectionSlice(normalized, supplierStarts, takerStarts);
  const takerEnds = ["INTERMEDIARIO DO SERVICO", "DISCRIMINACAO", "DESCRICAO DO SERVICO", "CALCULO DO IMPOSTO"];
  const takerSection = sectionSlice(normalized, takerStarts, takerEnds);
  const cnpjs = allCnpjs(normalized);
  // Alguns espelhos municipais antigos extraem as duas colunas na ordem
  // tomador/prestador. Nos demais layouts fiscais, o primeiro CNPJ é o emitente.
  const reversedNfseColumns = documentType === "nfse"
    && /TOMADOR DE SERVICOS[\s\S]{0,700}PRESTADOR DE SERVICOS/.test(normalized);
  const supplierCnpj = (reversedNfseColumns ? cnpjs[1] : cnpjs[0])
    || cnpjFromSection(normalized, supplierStarts, takerStarts)
    || null;
  let takerCnpj = (reversedNfseColumns ? cnpjs[0] : cnpjs.find((cnpj) => cnpj !== supplierCnpj))
    || cnpjFromSection(normalized, takerStarts, takerEnds)
    || null;
  if (!takerCnpj && /TOMADOR DO SERVICO NAO IDENTIFICADO/.test(normalized)) {
    takerCnpj = cnpjFromSection(normalized, ["INTERMEDIARIO DO SERVICO"], ["SERVICO PRESTADO", "VALOR DO SERVICO"]);
  }
  const supplierName = labeledName(supplierSection);
  const takerName = labeledName(takerSection);
  const invoiceNumber = digitsOnlyInvoice(firstMatch(normalized, [
    /NUMERO DA NOTA FISCAL\s*:?\s*([0-9][0-9.]*)/i,
    /NUMERO DA NFS-E\s*:?\s*([0-9][0-9.]*)/i,
    /NUMERO DA NOTA\s*:?\s*([0-9][0-9.]*)/i,
    /NF-E\s*N\s*([0-9][0-9.]*)/i,
    /AUXILIAR DA\s+([0-9][0-9.]*)\s+SERIE/i,
    /NOTA DE LOCACAO(?:\s+\S+){0,5}\s+([0-9]{2,})\s+(?:IMPRESSO|DATA)/i,
    /RECIBO\s*\/\s*FATURA DE LOCACAO\s*([0-9][0-9.]*)/i,
    /FATURA DE LOCACAO[\s\S]{0,500}?\bNUMERO\s*:?\s*([0-9][0-9.]*)/i,
    /MODELO SERIE NUMERO FL DATA E HORA EMISSAO[\s\S]{0,180}?\b57\s+\d{3}\s+([0-9][0-9.]*)/i,
  ]));
  const issueDate = isoDate(firstMatch(normalized, [
    /DATA(?: E HORA)? DA EMISSAO DA NFS-E\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /DATA DE GERACAO DA NFS-E(?:\s+DATA DE COMPETENCIA)?(?:\s+CODIGO DE AUTENTICIDADE)?\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /DATA(?: E HORA)? (?:DE|DA) EMISSAO\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /DATA DA EMISSAO\s+\S+(?:\s+\S+){0,3}\s+(\d{2}\/\d{2}\/\d{2,4})/i,
    /EMISSAO\s*\([^)]*\)\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /EMISSAO\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /RODOVIARIO\s+(\d{2}\/\d{2}\/\d{4})/i,
    /PROTOCOLO DE AUTORIZACAO DE USO\s+\d+\s+(\d{2}\/\d{2}\/\d{4})/i,
  ]));
  const dueDate = isoDate(firstMatch(normalized, [
    /VENCIMENTO DA NOTA FISCAL\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /DATA VENC(?:TO|IMENTO)?\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /(?:DATA DE )?VENCIMENTO\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /VENCIMENTO PARCELA[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{2,4})/i,
    /FATURA\s*\/\s*DUPLICATA PARCELAS[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})/i,
    /FORMA DE PAGAMENTO VENCIMENTO VALOR TOTAL[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{2,4})/i,
    /VENC\.?\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
  ]));
  let amountText = firstMatch(normalized, [
    /VALOR LIQUIDO DA NFS-E\s*(?:\(R\$\))?\s*:?\s*(?:R\$\s*)?([\d.,]+)/i,
    /VL\.?\s+DO SERVICO\s*:?\s*(?:R\$\s*)?([\d.,]+)/i,
    /VALOR TOTAL DA NFSE\s*\(R\$\)\s*([\d.,]+)/i,
    /VALOR TOTAL (?:DA NOTA|DO DOCUMENTO)\s*:?\s*(?:R\$\s*)?([\d.,]+)/i,
    /VALOR TOTAL\s*:?\s*(?:R\$\s*)?([\d.,]+)/i,
    /TOTAL \(R\$\)\s*(?:R\$\s*)?([\d.,]+)/i,
    /DUPLICATA R\$ VALOR TOTAL[\s\S]{0,90}?\b\d+\s+([\d.,]+)/i,
    /VALOR A RECEBER VALOR TOTAL DO SERVICO\s*([\d.,]+)/i,
    /VALOR TOTAL DA PRESTACAO DO SERVICO\s*:?\s*(?:R\$\s*)?([\d.,]+)/i,
    /FORMA DE PAGAMENTO VENCIMENTO VALOR TOTAL\s*([\d.,]+)/i,
  ]);
  if (!amountText && (documentType === "invoice" || documentType === "rental")) amountText = lastMoney(normalized);
  const amountCents = moneyToCents(amountText);
  const warnings: string[] = [];
  if (normalized.length < 80) warnings.push("Este PDF parece ser uma imagem digitalizada e nao possui texto pesquisavel. Envie o XML ou um PDF com texto, ou preencha os campos manualmente.");
  if (!supplierCnpj) warnings.push("Nao foi possivel reconhecer automaticamente o CNPJ do fornecedor no PDF.");
  if (!takerCnpj && !takerName) warnings.push("Nao foi possivel reconhecer o tomador/destinatario no PDF.");
  if (!dueDate) warnings.push("O PDF nao informou um vencimento reconhecivel; confira ou preencha manualmente.");
  if (documentType === "unknown" && normalized.length >= 80) warnings.push("O anexo nao foi identificado como NF-e, NFS-e, CT-e, fatura ou nota de locacao.");
  const data: FiscalDocumentData = {
    sourceType: "pdf", documentType, supplierName, supplierCnpj, takerName, takerCnpj,
    invoiceNumber, issueDate, dueDate, amountCents, description: null, warnings,
  };
  data.description = descriptionFor(data);
  return data;
}
