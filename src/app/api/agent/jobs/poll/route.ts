import { NextResponse } from "next/server";
import { pollNextAgentJob, recordAgentHeartbeat } from "@/lib/db/app-repository";
import { requireAgent } from "@/app/api/agent/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PollBody = {
  localApiUrl?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  agentVersion?: string | null;
};

export async function POST(request: Request) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const body = (await request.json().catch(() => ({}))) as PollBody;
  await recordAgentHeartbeat({
    agentId: agent.id,
    localApiUrl: body.localApiUrl,
    machineId: body.machineId,
    machineName: body.machineName,
    agentVersion: body.agentVersion,
  });
  const job = await pollNextAgentJob(agent);

  return NextResponse.json({
    success: true,
    job,
  });
}
