import { NextResponse } from "next/server";
import { recordAgentHeartbeat } from "@/lib/db/app-repository";
import { requireAgent } from "@/app/api/agent/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HeartbeatBody = {
  localApiUrl?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  agentVersion?: string | null;
};

export async function POST(request: Request) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const body = (await request.json().catch(() => ({}))) as HeartbeatBody;
  await recordAgentHeartbeat({
    agentId: agent.id,
    localApiUrl: body.localApiUrl,
    machineId: body.machineId,
    machineName: body.machineName,
    agentVersion: body.agentVersion,
  });

  return NextResponse.json({
    success: true,
    agentId: agent.id,
    receivedAt: new Date().toISOString(),
  });
}
