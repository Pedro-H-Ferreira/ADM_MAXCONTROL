import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readFluigSyncSnapshot } from "@/lib/db/fluig-repository";
import { getFluigIntegrationForModule, type FluigModuleSlug } from "@/lib/fluig-data";
import { getFluigRuntimeConfig } from "@/lib/fluig/server-client";

type SyncBody = {
  module?: string;
  action?: string;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function responseForModule(moduleSlug: string | null) {
  if (!moduleSlug) {
    return jsonError("Modulo Fluig nao informado.");
  }

  const integration = getFluigIntegrationForModule(moduleSlug);

  if (!integration) {
    return jsonError(`Modulo sem integracao Fluig: ${moduleSlug}`, 404);
  }

  const runtimeConfig = getFluigRuntimeConfig();
  const actor = await resolveCurrentAppUser();
  const snapshot = await readFluigSyncSnapshot(integration.slug as FluigModuleSlug, 50, actor);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    sourceMode: "supabase_snapshot",
    externalApiConfigured: runtimeConfig.configured,
    module: integration.slug,
    integration: {
      ...integration,
      syncRows: snapshot.rows,
      examples: snapshot.examples,
      supplierMatches: snapshot.supplierMatches,
      catalogs: snapshot.catalogs,
    },
    rows: snapshot.rows,
    examples: snapshot.examples,
    supplierMatches: snapshot.supplierMatches,
    catalogs: snapshot.catalogs,
    runtime: runtimeConfig,
    access: {
      userId: actor.id,
      role: actor.role,
      isAdmin: actor.isAdmin,
      branchCodes: actor.branchCodes,
      fluigUsername: actor.fluigUsername,
    },
    persistence: {
      configured: snapshot.persistence.configured,
      errors: snapshot.persistence.errors,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    return await responseForModule(url.searchParams.get("module"));
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao sincronizar modulo.", 500);
  }
}

export async function POST(request: Request) {
  let body: SyncBody = {};

  try {
    body = (await request.json()) as SyncBody;
  } catch {
    body = {};
  }

  try {
    return await responseForModule(body.module ?? null);
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao sincronizar modulo.", 500);
  }
}
