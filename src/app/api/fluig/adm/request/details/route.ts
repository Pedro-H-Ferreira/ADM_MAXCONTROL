import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readFluigRequestByNumberForActor } from "@/lib/db/fluig-repository";
import { moduleOrNull } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const fluigRequestId = String(url.searchParams.get("fluigRequestId") || "").replace(/\D+/g, "");
    const moduleSlug = moduleOrNull(url.searchParams.get("module") || "");
    if (!fluigRequestId) {
      return NextResponse.json({ success: false, error: "Numero Fluig e obrigatorio." }, { status: 400 });
    }

    const known = await readFluigRequestByNumberForActor({ actor, fluigRequestId, module: moduleSlug });
    if (!known.request) {
      return NextResponse.json({ success: false, error: "Solicitacao Fluig nao encontrada ou sem acesso." }, { status: 404 });
    }

    const snapshot = known.request.detailSnapshot;
    const details = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length
      ? snapshot
      : {
          requestId: fluigRequestId,
          taskUserId: null,
          sourceUrl: known.request.sourceUrl || "",
          fetchedAt: known.request.detailSyncedAt || known.request.lastSyncedAt || new Date().toISOString(),
          formFields: known.request.fieldValues || {},
          attachments: [],
          history: [],
          warnings: ["Os detalhes completos ainda nao foram gravados. Execute a sincronizacao do modulo."],
        };

    return NextResponse.json({ success: true, details, source: "database" });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar detalhes gravados." },
      { status: 500 }
    );
  }
}
