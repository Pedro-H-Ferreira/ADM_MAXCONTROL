import { NextResponse } from "next/server";
import { buildFluigAdmSyncResponse } from "@/lib/fluig-data";
import { getFluigRuntimeConfig } from "@/lib/fluig/server-client";

type SyncBody = {
  module?: string;
  action?: string;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function responseForModule(moduleSlug: string | null) {
  if (!moduleSlug) {
    return jsonError("Modulo Fluig nao informado.");
  }

  const payload = buildFluigAdmSyncResponse(moduleSlug, new Date().toISOString());

  if (!payload) {
    return jsonError(`Modulo sem integracao Fluig: ${moduleSlug}`, 404);
  }

  return NextResponse.json({
    ...payload,
    runtime: getFluigRuntimeConfig(),
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return responseForModule(url.searchParams.get("module"));
}

export async function POST(request: Request) {
  let body: SyncBody = {};

  try {
    body = (await request.json()) as SyncBody;
  } catch {
    body = {};
  }

  return responseForModule(body.module ?? null);
}
