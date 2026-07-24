import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";
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

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "adfs", "canCreate")) {
      return jsonError("Usuario sem permissao para criar ADF.", 403);
    }
    const parsed = payloadSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Documento fiscal invalido.");

    const buffer = decodeFiscalDocumentBase64(parsed.data.dataBase64);
    if (!buffer || buffer.byteLength !== parsed.data.size) {
      return jsonError("O conteudo do documento fiscal nao corresponde ao arquivo enviado.");
    }
    const lowerName = parsed.data.name.toLowerCase();
    const lowerMime = parsed.data.mimeType.toLowerCase();
    if (
      !lowerName.endsWith(".xml") &&
      !lowerName.endsWith(".pdf") &&
      !lowerMime.includes("xml") &&
      lowerMime !== "application/pdf"
    ) {
      return jsonError("Envie um XML ou PDF de nota fiscal.");
    }

    const document = await parseFiscalDocumentBuffer(parsed.data.name, parsed.data.mimeType, buffer);
    const branch = await matchFiscalDocumentBranch(actor, document);
    const warnings = [...document.warnings];
    if (!branch) {
      warnings.push("Nao foi possivel associar o tomador a uma filial. Selecione a filial correta antes de criar a ADF.");
    }
    return NextResponse.json({
      success: true,
      document: { ...document, warnings },
      branch,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao interpretar o documento fiscal.", 500);
  }
}
