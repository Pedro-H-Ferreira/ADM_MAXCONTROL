import { NextResponse } from "next/server";
import { createAgentPairing, listAgentsForActor, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PairBody = {
  displayName?: string;
  machineName?: string;
};

export async function GET() {
  const actor = await resolveCurrentAppUser();
  const agents = await listAgentsForActor(actor);

  return NextResponse.json({
    success: true,
    agents,
  });
}

export async function POST(request: Request) {
  const actor = await resolveCurrentAppUser();
  const body = (await request.json().catch(() => ({}))) as PairBody;
  const pairing = await createAgentPairing({
    actor,
    displayName: body.displayName,
    machineName: body.machineName,
  });

  return NextResponse.json({
    success: true,
    agent: pairing.agent,
    token: pairing.token,
    installHint:
      "Use este token no instalador do ADM Fluig Agent nesta maquina. Ele nao sera exibido novamente.",
  });
}
