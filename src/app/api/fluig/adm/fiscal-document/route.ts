import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeCnpj } from "@/lib/cnpj";
import type { FiscalDocumentData } from "@/lib/fiscal-document";
import {
  decodeFiscalDocumentBase64,
  matchFiscalDocumentBranch,
  parseFiscalDocumentBuffer,
} from "@/lib/server/fiscal-document-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const payloadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  dataBase64: z.string().min(1),
});

type JsonRecord = Record<string, unknown>;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

async function matchSupplier(actor: Awaited<ReturnType<typeof resolveCurrentAppUser>>, document: FiscalDocumentData) {
  const client = getSupabaseServiceClient();
  if (!client) return null;
  const cnpj = normalizeCnpj(document.supplierCnpj);
  if (!cnpj) return null;

  const { data, error } = await client
    .from("app_suppliers")
    .select(
      "id,cnpj_normalizado,razao_social,fluig_name,fluig_supplier_label,default_source_request_id,default_payload,app_supplier_branch_links(branch_id)"
    )
    .eq("cnpj_normalizado", cnpj)
    .eq("status", "ATIVO")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const links = Array.isArray(data.app_supplier_branch_links) ? data.app_supplier_branch_links : [];
  const actorBranchIds = new Set(actor.branches.map((branch) => branch.id));
  if (!actor.isAdmin && !links.some((link) => actorBranchIds.has(String(link.branch_id)))) return null;

  const defaultPayload = (data.default_payload || {}) as JsonRecord;
  const latestFields =
    defaultPayload.latestFields && typeof defaultPayload.latestFields === "object"
      ? (defaultPayload.latestFields as JsonRecord)
      : defaultPayload;
  return {
    id: String(data.id),
    name: String(data.fluig_supplier_label || data.fluig_name || data.razao_social),
    cnpj: String(data.cnpj_normalizado),
    defaultSourceRequestId: data.default_source_request_id ? String(data.default_source_request_id) : null,
    defaultFields: Object.fromEntries(
      Object.entries(latestFields).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    ),
    branchIds: links.map((link) => String(link.branch_id)),
  };
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "pagamentos", "canCreate")) {
      return jsonError("Usuario sem permissao para criar pagamentos.", 403);
    }
    const parsed = payloadSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Documento fiscal invalido.");

    const buffer = decodeFiscalDocumentBase64(parsed.data.dataBase64);
    if (!buffer || buffer.byteLength !== parsed.data.size) {
      return jsonError("O conteudo do documento fiscal nao corresponde ao arquivo enviado.");
    }
    const lowerName = parsed.data.name.toLowerCase();
    const lowerMime = parsed.data.mimeType.toLowerCase();
    if (!lowerName.endsWith(".xml") && !lowerName.endsWith(".pdf") && !lowerMime.includes("xml") && lowerMime !== "application/pdf") {
      return jsonError("Envie um XML ou PDF de nota fiscal.");
    }

    const document = await parseFiscalDocumentBuffer(parsed.data.name, parsed.data.mimeType, buffer);
    const [supplier, branch] = await Promise.all([matchSupplier(actor, document), matchFiscalDocumentBranch(actor, document)]);
    const warnings = [...document.warnings];
    if (!supplier && document.supplierCnpj) {
      warnings.push("Fornecedor novo identificado. Ele sera cadastrado automaticamente depois que o Fluig confirmar o lancamento.");
    }
    if (!branch) {
      warnings.push("Nao foi possivel associar o tomador a uma filial. Selecione a filial correta antes de validar.");
    }

    return NextResponse.json({
      success: true,
      document: { ...document, warnings },
      supplier,
      branch,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao interpretar o documento fiscal.", 500);
  }
}
