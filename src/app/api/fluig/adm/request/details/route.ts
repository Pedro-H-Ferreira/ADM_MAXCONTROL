import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readFluigRequestByNumberForActor } from "@/lib/db/fluig-repository";
import { readFluigCredentials } from "@/lib/fluig/credentials";
import { moduleOrNull } from "@/lib/fluig/route-utils";
import { queryFluigRequestDetails } from "@/lib/fluig/server-client";

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

    const credentials = await readFluigCredentials(actor.id);
    const result = await queryFluigRequestDetails({
      requestId: fluigRequestId,
      taskUserId: actor.fluigUserId,
      credentials,
    });
    if (!result.data) throw new Error("O Fluig nao retornou os detalhes da solicitacao.");

    return NextResponse.json({ success: true, details: result.data });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar detalhes no Fluig." },
      { status: 500 }
    );
  }
}
