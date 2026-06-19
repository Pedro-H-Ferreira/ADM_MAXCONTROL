import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createAgentPairing, listAgentsForActor, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PairBody = {
  displayName?: string;
  machineName?: string;
};

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    const agents = await listAgentsForActor(actor);

    return NextResponse.json({
      success: true,
      agents,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Falha ao listar agentes.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
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
        "Execute INSTALAR-AGENTE-FLUIG.bat nesta maquina e cole este token quando solicitado. Ele nao sera exibido novamente.",
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Falha ao parear agente.",
      },
      { status: 500 }
    );
  }
}
