import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  buildSupplierCandidates,
  persistHistoryItems,
  persistSupplierCandidates,
  recordFluigOperationRun,
} from "@/lib/db/fluig-repository";
import { getProcessMapForRequest, jsonError, mergePersistence, parseNumber, readJsonBody } from "@/lib/fluig/route-utils";
import { listFluigProcessMaps } from "@/lib/fluig/process-map";
import { getFluigRuntimeConfig, queryFluigHistory, type FluigHistoryItem } from "@/lib/fluig/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreloadBody = {
  module?: string;
  days?: number;
  pageSize?: number;
  maxPages?: number;
  persist?: boolean;
};

function mapsForPreload(moduleSlug?: string) {
  if (!moduleSlug || moduleSlug === "fornecedores" || moduleSlug === "all") {
    return listFluigProcessMaps().filter((map) => map.module !== "fornecedores");
  }

  return [getProcessMapForRequest(moduleSlug)];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return POST(
    new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: url.searchParams.get("module") || "fornecedores",
        days: parseNumber(url.searchParams.get("days"), 180),
        pageSize: parseNumber(url.searchParams.get("pageSize"), 100),
        maxPages: parseNumber(url.searchParams.get("maxPages"), 5),
      }),
    })
  );
}

export async function POST(request: Request) {
  const body = await readJsonBody<PreloadBody>(request, {});
  const runtimeConfig = getFluigRuntimeConfig();

  try {
    await resolveCurrentAppUser();
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao validar usuario.", 500);
  }

  try {
    const maps = mapsForPreload(body.module);
    const allItems: FluigHistoryItem[] = [];
    const persistenceResults = [];

    for (const map of maps) {
      const result = await queryFluigHistory(map, {
        days: body.days ?? 180,
        pageSize: body.pageSize ?? 100,
        maxPages: body.maxPages ?? 5,
      });
      const items = result.data?.items || [];
      allItems.push(...items);
      if (body.persist !== false) {
        persistenceResults.push(await persistHistoryItems(map.module, items));
      }
    }

    const candidates = buildSupplierCandidates(allItems);
    if (body.persist !== false) {
      persistenceResults.push(await persistSupplierCandidates(candidates));
    }

    const operationPersistence = await recordFluigOperationRun({
      module: "fornecedores",
      operation: "supplier_preload",
      status: "success",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      responsePayload: {
        modules: maps.map((map) => map.module),
        scannedItems: allItems.length,
        candidates: candidates.length,
      },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      modules: maps.map((map) => map.module),
      scannedItems: allItems.length,
      candidates,
      persistence: mergePersistence(...persistenceResults, operationPersistence),
    });
  } catch (error) {
    await recordFluigOperationRun({
      module: "fornecedores",
      operation: "supplier_preload",
      status: "error",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return jsonError(error instanceof Error ? error.message : String(error), runtimeConfig.configured ? 500 : 503, {
      runtime: runtimeConfig,
    });
  }
}
