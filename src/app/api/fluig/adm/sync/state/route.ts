import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { listFluigUserSyncState, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { moduleOrNull } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const states = await listFluigUserSyncState(actor, {
      userId: url.searchParams.get("userId"),
      module: moduleOrNull(url.searchParams.get("module") || ""),
    });

    return NextResponse.json({ success: true, states });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar estado de sincronizacao.", 500);
  }
}
