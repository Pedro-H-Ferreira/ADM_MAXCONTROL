import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  createFluigJob,
  resolveCurrentAppUser,
  upsertFluigUserSyncState,
  type AppActor,
} from "@/lib/db/app-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import { moduleOrNull, parseNumber, readJsonBody } from "@/lib/fluig/route-utils";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistoricalBody = {
  module?: FluigModuleSlug | "fornecedores";
  action?: "sync" | "examples";
  days?: number;
  pageSize?: number;
  maxPages?: number;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatFluigDateTime(date: Date, endOfDay = false) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-") + (endOfDay ? "T23:59:59-0300" : "T00:00:00-0300");
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months, 1);
  return next;
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function buildMonthlyWindows(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);

  const windows: Array<{ start: string; end: string }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const windowStart = cursor.getFullYear() === start.getFullYear() && cursor.getMonth() === start.getMonth()
      ? start
      : new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = endOfMonth(cursor);
    const windowEnd = monthEnd > end ? end : monthEnd;

    windows.push({
      start: formatFluigDateTime(windowStart),
      end: formatFluigDateTime(windowEnd, true),
    });
    cursor = addMonths(cursor, 1);
  }

  return windows;
}

function canRunHistorical(actor: AppActor) {
  return actor.role === "ADMIN_MASTER" || actor.role === "ADMIN";
}

function modulesForHistorical(module: FluigModuleSlug) {
  return module === "fornecedores"
    ? (["pagamentos", "compras", "manutencao"] satisfies FluigModuleSlug[])
    : ([module] satisfies FluigModuleSlug[]);
}

function processMapPayload(moduleToSync: FluigModuleSlug, input: { days: number; pageSize: number; maxPages: number }) {
  const map = requireFluigProcessMap(moduleToSync);

  return {
    module: map.module,
    processId: map.processId,
    processVersions: map.processVersions,
    processLabel: map.processLabel,
    defaultTaskUserId: map.defaultTaskUserId,
    ...(moduleToSync === "pagamentos" ? { windows: buildMonthlyWindows(input.days) } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canRunHistorical(actor)) {
      return jsonError("Somente ADMIN_MASTER ou ADMIN podem iniciar carga historica Fluig.", 403);
    }

    const body = await readJsonBody<HistoricalBody>(request, {});
    const moduleSlug = moduleOrNull(body.module || "pagamentos");
    if (!moduleSlug) return jsonError("Modulo Fluig invalido.");

    const days = parseNumber(body.days, 730);
    const pageSize = parseNumber(body.pageSize, 100);
    const maxPages = parseNumber(body.maxPages, 100);
    const action = body.action === "examples" ? "examples" : "sync";
    const jobs = [];

    if (moduleSlug === "fornecedores") {
      const processMaps = modulesForHistorical(moduleSlug).map((moduleToSync) =>
        processMapPayload(moduleToSync, { days, pageSize, maxPages })
      );
      const supplierMap = requireFluigProcessMap("fornecedores");
      const payload = {
        action,
        module: "fornecedores",
        days,
        pageSize,
        maxPages,
        persist: true,
        catalogRefresh: true,
        processMap: {
          module: supplierMap.module,
          processId: supplierMap.processId,
          processVersions: supplierMap.processVersions,
          processLabel: supplierMap.processLabel,
          defaultTaskUserId: supplierMap.defaultTaskUserId,
        },
        processMaps,
      };

      jobs.push(
        await createFluigJob({
          actor,
          module: "fornecedores",
          operation: "sync_initial_history",
          requestPayload: payload,
        })
      );
      await upsertFluigUserSyncState({
        actor,
        module: "fornecedores",
        syncType: "historical",
        status: "started",
        cursor: { days, pageSize, maxPages },
        metadata: { jobCount: 1, processCount: processMaps.length, grouped: true },
      });

      return NextResponse.json({ success: true, jobs });
    }

    for (const moduleToSync of modulesForHistorical(moduleSlug)) {
      const map = requireFluigProcessMap(moduleToSync);
      const payload = {
        action,
        module: moduleToSync,
        days,
        pageSize,
        maxPages,
        persist: true,
        catalogRefresh: true,
        ...(moduleToSync === "pagamentos" ? { windows: buildMonthlyWindows(days) } : {}),
        processMap: {
          module: map.module,
          processId: map.processId,
          processVersions: map.processVersions,
          processLabel: map.processLabel,
          defaultTaskUserId: map.defaultTaskUserId,
        },
      };

      jobs.push(
        await createFluigJob({
          actor,
          module: moduleToSync,
          operation: "sync_initial_history",
          requestPayload: payload,
        })
      );
      await upsertFluigUserSyncState({
        actor,
        module: moduleToSync,
        syncType: "historical",
        status: "started",
        cursor: { days, pageSize, maxPages },
        metadata: { jobCount: jobs.length },
      });
    }

    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao iniciar carga historica.", 500);
  }
}
