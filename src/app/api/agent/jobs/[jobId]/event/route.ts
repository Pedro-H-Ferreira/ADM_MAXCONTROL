import { NextResponse } from "next/server";
import { z } from "zod";
import { readJobForAgent, recordFluigJobEvent } from "@/lib/db/app-repository";
import { updateOperationalLaunchJobProgress } from "@/lib/db/operational-launch-repository";
import { requireAgent } from "@/app/api/agent/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

const eventSchema = z.object({
  eventType: z.string().trim().min(1).max(80).optional(),
  stage: z.string().trim().min(1).max(80).nullable().optional(),
  label: z.string().trim().min(1).max(500).nullable().optional(),
  status: z
    .enum([
      "agent_claimed",
      "authenticating",
      "opening_fluig",
      "reading_page",
      "filling_form",
      "submitting",
      "waiting_protocol",
      "syncing_result",
    ])
    .optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const { jobId } = await context.params;
  const job = await readJobForAgent(agent, jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job nao pertence a este agente." }, { status: 404 });
  }

  const parsed = eventSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Evento de progresso invalido." },
      { status: 400 }
    );
  }
  const body = parsed.data;
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
