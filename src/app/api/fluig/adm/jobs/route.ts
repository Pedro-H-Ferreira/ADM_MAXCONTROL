import { NextResponse } from "next/server";
import { createFluigJob, listJobsForActor, resolveCurrentAppUser, type FluigJobOperation } from "@/lib/db/app-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobBody = {
  module?: FluigModuleSlug;
  operation?: FluigJobOperation;
  branchCode?: string | null;
  branchLabel?: string | null;
  payload?: Record<string, unknown>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET() {
  const actor = await resolveCurrentAppUser();
  const jobs = await listJobsForActor(actor);

  return NextResponse.json({
    success: true,
    jobs,
  });
}

export async function POST(request: Request) {
  const actor = await resolveCurrentAppUser();
  const body = (await request.json().catch(() => ({}))) as JobBody;
  const moduleSlug = body.module;

  if (!moduleSlug) {
    return jsonError("Modulo Fluig nao informado.");
  }

  const operation = body.operation || "sync_history";
  const map = requireFluigProcessMap(moduleSlug);
  const requestPayload = {
    ...(body.payload || {}),
    processMap: {
      module: map.module,
      processId: map.processId,
      processVersions: map.processVersions,
      processLabel: map.processLabel,
      defaultTaskUserId: map.defaultTaskUserId,
    },
  };
  const job = await createFluigJob({
    actor,
    module: moduleSlug,
    operation,
    branchCode: body.branchCode,
    branchLabel: body.branchLabel,
    requestPayload,
  });

  return NextResponse.json({
    success: true,
    job,
  });
}
