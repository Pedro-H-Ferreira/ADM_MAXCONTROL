import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readFluigRequestByNumberForActor } from "@/lib/db/fluig-repository";
import { readFluigCredentials } from "@/lib/fluig/credentials";
import { moduleOrNull } from "@/lib/fluig/route-utils";
import { downloadFluigRequestAttachment } from "@/lib/fluig/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDispositionFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").trim() || "anexo";
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const fluigRequestId = String(url.searchParams.get("fluigRequestId") || "").replace(/\D+/g, "");
    const sequence = String(url.searchParams.get("sequence") || "").replace(/\D+/g, "");
    const moduleSlug = moduleOrNull(url.searchParams.get("module") || "");
    if (!fluigRequestId || !sequence) {
      return NextResponse.json({ success: false, error: "Solicitacao e anexo sao obrigatorios." }, { status: 400 });
    }

    const known = await readFluigRequestByNumberForActor({ actor, fluigRequestId, module: moduleSlug });
    if (!known.request) {
      return NextResponse.json({ success: false, error: "Solicitacao Fluig nao encontrada ou sem acesso." }, { status: 404 });
    }

    const credentials = await readFluigCredentials(actor.id);
    const file = await downloadFluigRequestAttachment({ requestId: fluigRequestId, sequence, credentials });
    const name = contentDispositionFileName(file.name);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "content-type": file.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao abrir anexo do Fluig." },
      { status: 500 }
    );
  }
}
