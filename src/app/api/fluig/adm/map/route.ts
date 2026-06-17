import { NextResponse } from "next/server";
import { persistProcessMaps } from "@/lib/db/fluig-repository";
import { listFluigProcessMaps } from "@/lib/fluig/process-map";
import { getFluigRuntimeConfig } from "@/lib/fluig/server-client";
import { parseBoolean } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const persist = parseBoolean(url.searchParams.get("persist"), false);
  const maps = listFluigProcessMaps();
  const persistence = persist ? await persistProcessMaps(maps) : null;

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    runtime: getFluigRuntimeConfig(),
    maps,
    persistence,
  });
}
