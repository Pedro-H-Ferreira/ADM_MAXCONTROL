import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { readJobForActor, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const actor = await resolveCurrentAppUser();
    const includePayloads = new URL(request.url).searchParams.get("details") === "true";
    const payload = await readJobForActor(actor, jobId, { includePayloads });

    if (!payload) {
      return NextResponse.json({ success: false, error: "Job nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Falha ao consultar job.",
      },
      { status: 500 }
    );
  }
}
