import { NextResponse } from "next/server";
import { readJobForAgent, recordFluigJobEvent, type FluigJobStatus } from "@/lib/db/app-repository";
import { updateOperationalLaunchJobProgress } from "@/lib/db/operational-launch-repository";
import { requireAgent } from "@/app/api/agent/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type EventBody = {
  eventType?: string;
  stage?: string | null;
  label?: string | null;
  status?: FluigJobStatus;
  payload?: Record<string, unknown>;
};

export async function POST(request: Request, context: RouteContext) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const { jobId } = await context.params;
  const job = await readJobForAgent(agent, jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job nao pertence a este agente." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as EventBody;
  await recordFluigJobEvent({
    jobId,
    agentId: agent.id,
    eventType: body.eventType || "progress",
    stage: body.stage,
    label: body.label,
    payload: body.payload,
    status: body.status,
  });
  await updateOperationalLaunchJobProgress({
    job,
    status: body.status,
    stage: body.stage,
    label: body.label,
  });

  return NextResponse.json({
    success: true,
  });
}
