import "server-only";
import { PDFParse } from "pdf-parse";
import { getPath as getPdfWorkerPath } from "pdf-parse/worker";
import type { AppActor } from "@/lib/db/app-repository";
import { normalizeCnpj } from "@/lib/cnpj";
import { parseFiscalPdfText, parseFiscalXml, type FiscalDocumentData } from "@/lib/fiscal-document";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

PDFParse.setWorker(getPdfWorkerPath());

type JsonRecord = Record<string, unknown>;

export function decodeFiscalDocumentBase64(value: string) {
  const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) return null;
  const decoded = Buffer.from(payload, "base64");
  return decoded.toString("base64").replace(/=+$/, "") === payload.replace(/=+$/, "") ? decoded : null;
}

export async function parseFiscalDocumentBuffer(name: string, mimeType: string, buffer: Buffer) {
  const isXml = name.toLowerCase().endsWith(".xml") || mimeType.toLowerCase().includes("xml");
  if (isXml) return parseFiscalXml(buffer.toString("utf8"));

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return parseFiscalPdfText(result.text);
  } finally {
    await parser.destroy();
  }
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function metadataCnpjs(metadata: JsonRecord | null) {
  const candidates = [
    metadata?.cnpj,
    metadata?.cnpjNormalizado,
    metadata?.taxId,
    metadata?.fiscalCnpj,
    ...(Array.isArray(metadata?.cnpjs) ? metadata.cnpjs : []),
  ];
  return candidates.map(normalizeCnpj).filter((item): item is string => Boolean(item));
}

export async function matchFiscalDocumentBranch(actor: AppActor, document: FiscalDocumentData) {
  const client = getSupabaseServiceClient();
  if (!client) {
    throw new Error(`Supabase service role nao configurado. Faltando: ${getSupabaseServiceStatus().missing.join(", ")}`);
  }
  const branchIds = actor.branches.map((branch) => branch.id);
  if (!branchIds.length) return null;
  const { data, error } = await client
    .from("app_branches")
    .select("id,code,name,fluig_label,metadata")
    .in("id", branchIds)
    .eq("active", true)
    .is("deleted_at", null);
  if (error) throw error;

  const takerCnpj = normalizeCnpj(document.takerCnpj);
  const takerName = normalizeText(document.takerName);
  const matches = (data || []).filter((row) => {
    const metadata = (row.metadata || {}) as JsonRecord;
    if (takerCnpj && metadataCnpjs(metadata).includes(takerCnpj)) return true;
    if (!takerName) return false;
    const labels = [row.code, row.name, row.fluig_label].map(normalizeText).filter(Boolean);
    return labels.some((label) => takerName === label || takerName.includes(label) || label.includes(takerName));
  });
  const selected = matches.length === 1 ? matches[0] : (data || []).length === 1 ? (data || [])[0] : null;
  return selected
    ? {
        id: String(selected.id),
        code: String(selected.code),
        label: String(selected.fluig_label || selected.name),
      }
    : null;
}
