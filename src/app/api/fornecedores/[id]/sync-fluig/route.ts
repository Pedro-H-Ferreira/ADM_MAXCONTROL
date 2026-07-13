import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  createFluigJob,
  resolveCurrentAppUser,
  upsertFluigUserSyncState,
  type AppActor,
} from "@/lib/db/app-repository";
import { markSupplierFluigSyncQueued, readSupplier } from "@/lib/db/suppliers-repository";
import { isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";
import { canActorPerformSupplierAction } from "@/lib/supplier-permissions";
import { supplierErrorResponse } from "@/lib/supplier-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type SyncBody = {
  days?: number;
  pageSize?: number;
  maxPages?: number;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function canSyncSuppliers(actor: AppActor) {
  return canActorPerformSupplierAction(actor, "canUpdate");
}

function parseNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatFluigDateTime(date: Date, endOfDay = false) {
  const day = [date.getFullYear(), padDatePart(date.getMonth() + 1), padDatePart(date.getDate())].join("-");
  return `${day}${endOfDay ? "T23:59:59-0300" : "T00:00:00-0300"}`;
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
    const windowStart =
      cursor.getFullYear() === start.getFullYear() && cursor.getMonth() === start.getMonth()
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

function processMapPayload(moduleToSync: FluigModuleSlug, days: number) {
  const map = requireFluigProcessMap(moduleToSync);
  return {
    module: map.module,
    processId: map.processId,
    processVersions: map.processVersions,
    processLabel: map.processLabel,
    defaultTaskUserId: map.defaultTaskUserId,
    ...(moduleToSync === "pagamentos" ? { windows: buildMonthlyWindows(days) } : {}),
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canSyncSuppliers(actor)) {
      return jsonError("Usuario sem permissao para sincronizar fornecedores.", 403);
    }

    const supplier = await readSupplier(actor, id);
    if (!supplier) return jsonError("Fornecedor nao encontrado.", 404);

    const cnpj = normalizeCnpj(supplier.cnpjNormalizado || supplier.cnpj);
    if (!cnpj || !isValidCnpj(cnpj)) {
      return jsonError("Fornecedor sem CNPJ valido para consulta no Fluig.");
    }

    const body = (await request.json().catch(() => ({}))) as SyncBody;
    const days = parseNumber(body.days, 730, 1, 1825);
    const pageSize = parseNumber(body.pageSize, 100, 10, 200);
    const maxPages = parseNumber(body.maxPages, 100, 1, 500);
    const supplierMap = requireFluigProcessMap("fornecedores");
    const processMaps = (["pagamentos", "compras", "manutencao"] satisfies FluigModuleSlug[]).map((moduleToSync) =>
      processMapPayload(moduleToSync, days)
    );
    const requestPayload = {
      supplierId: supplier.id,
      supplierName: supplier.razaoSocial,
      cnpj,
      days,
      pageSize,
      maxPages,
      module: "fornecedores",
      processMap: {
        module: supplierMap.module,
        processId: supplierMap.processId,
        processVersions: supplierMap.processVersions,
        processLabel: supplierMap.processLabel,
        defaultTaskUserId: supplierMap.defaultTaskUserId,
      },
      processMaps,
    };
    const job = await createFluigJob({
      actor,
      module: "fornecedores",
      operation: "supplier_lookup_by_cnpj",
      requestPayload,
      reuseActive: true,
    });

    const updatedSupplier = await markSupplierFluigSyncQueued(actor, id, {
      jobId: job.id,
      cnpj,
      days,
      pageSize,
      maxPages,
      processCount: processMaps.length,
    });

    await upsertFluigUserSyncState({
      actor,
      module: "fornecedores",
      syncType: "supplier_lookup",
      status: "started",
      cursor: { cnpj, supplierId: supplier.id, days, pageSize, maxPages },
      metadata: { jobId: job.id, supplierName: supplier.razaoSocial },
    });

    return NextResponse.json({
      success: true,
      job,
      supplier: updatedSupplier,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return supplierErrorResponse(error, "Falha ao sincronizar fornecedor no Fluig.");
  }
}
