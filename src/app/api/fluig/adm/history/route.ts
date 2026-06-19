import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";
import {
  buildFluigCatalogItems,
  buildSupplierCandidates,
  persistFluigCatalogItems,
  persistHistoryItemsInChunks,
  persistSupplierCandidates,
  recordFluigOperationRun,
} from "@/lib/db/fluig-repository";
import { getProcessMapForRequest, jsonError, mergePersistence, parseBoolean, parseNumber, readJsonBody } from "@/lib/fluig/route-utils";
import { getFluigRuntimeConfig, queryFluigHistory, type FluigHistoryItem } from "@/lib/fluig/server-client";
import { listFluigProcessMaps, type FluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistoryBody = {
  module?: string;
  days?: number;
  start?: string;
  end?: string;
  windows?: Array<{ start: string; end: string }>;
  pageSize?: number;
  maxPages?: number;
  persist?: boolean;
};

function mapsForModule(moduleSlug: string): FluigProcessMap[] {
  if (moduleSlug === "fornecedores") {
    return listFluigProcessMaps().filter((map) => map.module !== "fornecedores");
  }

  return [getProcessMapForRequest(moduleSlug)];
}

async function executeHistory(input: Required<Pick<HistoryBody, "module">> & Omit<HistoryBody, "module">, actor?: AppActor | null) {
  const persist = input.persist !== false;
  const maps = mapsForModule(input.module);
  const results: Array<{
    module: FluigModuleSlug;
    outputPath: string | null;
    inspected: Array<Record<string, unknown>>;
    totalItems: number;
    items: FluigHistoryItem[];
  }> = [];
  const persistenceResults = [];
  const allItems: FluigHistoryItem[] = [];

  for (const map of maps) {
    const result = await queryFluigHistory(map, {
      days: input.days,
      start: input.start,
      end: input.end,
      windows: input.windows,
      pageSize: input.pageSize,
      maxPages: input.maxPages,
    });
    const items = result.data?.items || [];
    allItems.push(...items);
    results.push({
      module: map.module,
      outputPath: result.outputPath,
      inspected: result.data?.inspected || [],
      totalItems: result.data?.totalItems || items.length,
      items,
    });

    if (persist) {
      persistenceResults.push(await persistHistoryItemsInChunks(map.module, items, actor));
      persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItems(map.module, items)));
    }
  }

  const supplierCandidates = buildSupplierCandidates(allItems);
  if (persist) {
    persistenceResults.push(await persistSupplierCandidates(supplierCandidates));
  }

  return {
    results,
    supplierCandidates,
    persistence: mergePersistence(...persistenceResults),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const moduleSlug = url.searchParams.get("module") || "pagamentos";
  const input: HistoryBody = {
    module: moduleSlug,
    days: parseNumber(url.searchParams.get("days"), 90),
    pageSize: parseNumber(url.searchParams.get("pageSize"), 100),
    maxPages: parseNumber(url.searchParams.get("maxPages"), 100),
    start: url.searchParams.get("start") || undefined,
    end: url.searchParams.get("end") || undefined,
    persist: parseBoolean(url.searchParams.get("persist"), true),
  };

  return POST(
    new Request(request.url, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    })
  );
}

export async function POST(request: Request) {
  const body = await readJsonBody<HistoryBody>(request, {});
  const moduleSlug = body.module || "pagamentos";
  const runtimeConfig = getFluigRuntimeConfig();
  let actor: AppActor;

  try {
    actor = await resolveCurrentAppUser();
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao validar usuario.", 500);
  }

  if (!runtimeConfig.configured) {
    const operationPersistence = await recordFluigOperationRun({
      module: moduleSlug === "fornecedores" ? "fornecedores" : (moduleSlug as FluigModuleSlug),
      operation: "history",
      status: "dry_run",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      responsePayload: {
        skipped: true,
        reason: "Fluig runtime unavailable in this environment",
        missing: runtimeConfig.missing,
      },
      errorMessage: runtimeConfig.missing.join(", ") || "Fluig runtime unavailable",
    });

    return NextResponse.json({
      success: true,
      skipped: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      results: [],
      supplierCandidates: [],
      persistence: operationPersistence,
      message: "Runtime Fluig indisponivel neste ambiente; exibindo o snapshot salvo no Supabase.",
    });
  }

  try {
    const payload = await executeHistory({
      module: moduleSlug,
      days: body.days ?? 90,
      start: body.start,
      end: body.end,
      windows: body.windows,
      pageSize: body.pageSize ?? 100,
      maxPages: body.maxPages ?? 100,
      persist: body.persist ?? true,
    }, actor);

    const operationPersistence = await recordFluigOperationRun({
      module: moduleSlug === "fornecedores" ? "fornecedores" : (moduleSlug as FluigModuleSlug),
      operation: "history",
      status: "success",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      responsePayload: {
        userId: actor.id,
        branchCodes: actor.branchCodes,
        modules: payload.results.map((item) => item.module),
        totalItems: payload.results.reduce((sum, item) => sum + item.items.length, 0),
        supplierCandidates: payload.supplierCandidates.length,
      },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      ...payload,
      persistence: mergePersistence(payload.persistence, operationPersistence),
    });
  } catch (error) {
    await recordFluigOperationRun({
      module: moduleSlug === "fornecedores" ? "fornecedores" : null,
      operation: "history",
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
