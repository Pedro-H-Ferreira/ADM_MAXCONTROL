import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { hasFluigCredentials } from "@/lib/fluig/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    const configured = await hasFluigCredentials(actor.id);
    const agents = configured
      ? [{
          id: `vps-${actor.id}`,
          display_name: "Executor interno da VPS",
          machine_name: "Coolify",
          status: "online",
          local_api_url: null,
          agent_version: "vps-internal-1",
          last_heartbeat_at: new Date().toISOString(),
          paired_at: null,
          updated_at: new Date().toISOString(),
          heartbeat_age_seconds: 0,
          heartbeat_is_stale: false,
        }]
      : [];

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
    await resolveCurrentAppUser();
    await request.json().catch(() => ({}));
    return NextResponse.json(
      {
        success: false,
        error: "O agente local foi desativado. Cadastre usuario e senha Fluig na Gestao de usuarios; a VPS executa as tarefas automaticamente.",
      },
      { status: 410 }
    );
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Falha ao consultar o executor Fluig da VPS.",
      },
      { status: 500 }
    );
  }
}
