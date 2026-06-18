import { NextResponse } from "next/server";
import { readJobForActor, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const actor = await resolveCurrentAppUser();
  const payload = await readJobForActor(actor, jobId);

  if (!payload) {
    return NextResponse.json({ success: false, error: "Job nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...payload,
  });
}
