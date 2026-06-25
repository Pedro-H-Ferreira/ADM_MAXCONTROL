import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readKnownOpenFluigRequestsForActor } from "@/lib/db/fluig-repository";
import { moduleOrNull, parseNumber } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const result = await readKnownOpenFluigRequestsForActor({
      actor,
      module: moduleOrNull(url.searchParams.get("module") || ""),
      limit: parseNumber(url.searchParams.get("limit"), 50),
      onlyTasks: true,
    });

    return NextResponse.json({ success: true, tasks: result.requests, persistence: result.persistence });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar tarefas Fluig.", 500);
  }
}
