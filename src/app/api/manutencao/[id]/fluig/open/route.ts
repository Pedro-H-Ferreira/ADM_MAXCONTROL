import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createFluigJob, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceOrder, updateMaintenanceOrder } from "@/lib/db/maintenance-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type JsonRecord = Record<string, unknown>;

const attachmentSchema = z.object({
  name: z.string().trim().min(1),
  mimeType: z.string().trim().optional(),
  size: z.coerce.number().int().min(0).optional(),
  dataBase64: z.string().optional(),
});

const openSchema = z.object({
  sourceRequestId: z.string().trim().optional(),
  fieldOverrides: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(attachmentSchema).optional(),
  taskUserId: z.string().trim().optional(),
  targetState: z.union([z.string(), z.number()]).optional(),
  comment: z.string().trim().optional(),
  force: z.boolean().optional(),
});

function jsonError(error: string, status = 400, details?: JsonRecord) {
  return NextResponse.json({ success: false, error, ...(details ? { details } : {}) }, { status });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown) {
  const parsed = String(value ?? "").trim();
  return parsed || "";
}

function formatDateForFluig(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function buildMaintenanceFieldOverrides(input: {
  order: NonNullable<Awaited<ReturnType<typeof readMaintenanceOrder>>>;
  actorName: string;
  fieldOverrides?: JsonRecord;
}) {
  const branch = input.order.branch.label || input.order.branch.code || "";
  const description = [
    input.order.title,
    `Area: ${input.order.area}`,
    input.order.description,
    input.order.materialSummary ? `Material previsto/utilizado: ${input.order.materialSummary}` : "",
    input.order.pendingReason ? `Pendencia informada: ${input.order.pendingReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    filial: branch,
    filialDestino: branch,
    zoomDemandaPara: input.order.technician || input.actorName,
    obsFiscal: description,
    dataPrevSaida: formatDateForFluig(input.order.dueAt),
    ...(input.fieldOverrides || {}),
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = openSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados de abertura Fluig invalidos.");
    }

    const order = await readMaintenanceOrder(actor, id);
    if (!order) return jsonError("OS nao encontrada.", 404);
    if (order.source !== "fluig") {
      return jsonError("Esta OS e manual. Altere a origem para OS Fluig antes de abrir no Fluig.", 409);
    }
    if (order.fluig.requestId && !parsed.data.force) {
      return jsonError(`Esta OS ja esta vinculada ao Fluig ${order.fluig.requestId}.`, 409, {
        fluigRequestId: order.fluig.requestId,
      });
    }

    const processMap = requireFluigProcessMap("manutencao");
    const metadata = asRecord(order.metadata);
    const sourceRequestId = text(parsed.data.sourceRequestId || metadata.fluigSourceRequestId || processMap.defaultSourceRequestIds[0]);
    if (!sourceRequestId) {
      return jsonError(
        "Informe a solicitacao modelo do Fluig para manutencao antes de abrir a OS. Use um numero real ja sincronizado como modelo.",
        409,
        { module: "manutencao", processId: processMap.processId }
      );
    }

    const fieldOverrides = buildMaintenanceFieldOverrides({
      order,
      actorName: actor.fluigUsername || actor.displayName,
      fieldOverrides: parsed.data.fieldOverrides,
    });
    const job = await createFluigJob({
      actor,
      module: "manutencao",
      operation: "open_from_source",
      branchCode: order.branch.code,
      branchLabel: order.branch.label,
      requestPayload: {
        maintenanceOrderId: order.id,
        maintenanceOrderCode: order.code,
        sourceRequestId,
        fieldOverrides,
        attachments: parsed.data.attachments || [],
        taskUserId: parsed.data.taskUserId,
        targetState: parsed.data.targetState,
        comment: parsed.data.comment || `Abertura da ${order.code} via ADM MaxControl.`,
        processMap: {
          module: processMap.module,
          processId: processMap.processId,
          processVersions: processMap.processVersions,
          processLabel: processMap.processLabel,
          defaultTaskUserId: processMap.defaultTaskUserId,
        },
      },
    });

    const updatedOrder = await updateMaintenanceOrder(actor, order.id, {
      source: "fluig",
      fluigCurrentTask: "Aguardando agente local abrir no Fluig",
      fluigTaskOwner: actor.fluigUsername || actor.displayName,
      metadata: {
        ...metadata,
        fluigSourceRequestId: sourceRequestId,
        fluigOpenJob: {
          id: job.id,
          status: job.status,
          sourceRequestId,
          createdAt: job.createdAt,
        },
      },
    });

    return NextResponse.json({
      success: true,
      job,
      order: updatedOrder,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao abrir OS no Fluig.", 500);
  }
}
