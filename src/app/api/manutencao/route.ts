import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  createMaintenanceOrder,
  listMaintenanceOrders,
  type MaintenanceOrderInput,
  type MaintenanceOrderPriority,
  type MaintenanceOrderSource,
  type MaintenanceOrderStatus,
} from "@/lib/db/maintenance-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceSchema = z.enum(["manual", "fluig", "preventiva", "checklist", "alerta"]);
const prioritySchema = z.enum(["CRITICA", "ALTA", "MEDIA", "BAIXA"]);
const statusSchema = z.enum([
  "ABERTA", "EM_TRIAGEM", "PLANEJADA", "AGUARDANDO_APROVACAO", "AGUARDANDO_MATERIAL",
  "MATERIAL_RESERVADO", "AGUARDANDO_TERCEIRO", "PROGRAMADA", "INICIADA", "EM_EXECUCAO",
  "PAUSADA", "CONCLUIDA", "AGUARDANDO_VALIDACAO", "FINALIZADA", "CANCELADA",
]);

const materialSchema = z.object({
  item: z.string().trim().min(1),
  quantity: z.string().nullable().optional(),
  valueCents: z.coerce.number().int().min(0).nullable().optional(),
});

const photoSchema = z.object({
  name: z.string().trim().min(1),
  size: z.coerce.number().int().min(0).nullable().optional(),
  type: z.string().nullable().optional(),
});

const orderSchema = z.object({
  source: sourceSchema.default("manual"),
  title: z.string().trim().min(1, "Titulo da OS e obrigatorio."),
  description: z.string().trim().min(1, "Descricao da OS e obrigatoria."),
  area: z.string().trim().min(1, "Area da OS e obrigatoria."),
  priority: prioritySchema.default("MEDIA"),
  status: statusSchema.default("ABERTA"),
  workType: z.enum(["CORRETIVA", "PREVENTIVA", "INSPECAO", "MELHORIA", "EMERGENCIA"]).default("CORRETIVA"),
  assetId: z.string().uuid().nullable().optional(),
  serviceProviderId: z.string().uuid().nullable().optional(),
  requester: z.string().nullable().optional(),
  technician: z.string().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  materialSummary: z.string().nullable().optional(),
  materialCostCents: z.coerce.number().int().min(0).nullable().optional(),
  materials: z.array(materialSchema).optional(),
  photos: z.array(photoSchema).optional(),
  pendingReason: z.string().nullable().optional(),
  slaMinutes: z.coerce.number().int().min(0).nullable().optional(),
  diagnosis: z.string().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  executedSolution: z.string().nullable().optional(),
  downtimeMinutes: z.coerce.number().int().min(0).nullable().optional(),
  laborCostCents: z.coerce.number().int().min(0).nullable().optional(),
  otherCostCents: z.coerce.number().int().min(0).nullable().optional(),
  completionNotes: z.string().nullable().optional(),
  completionApprovalRequired: z.boolean().optional(),
  fluigRequestId: z.string().nullable().optional(),
  fluigNumLancW: z.string().nullable().optional(),
  fluigCurrentTask: z.string().nullable().optional(),
  fluigTaskOwner: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function statusParam(value: string | null): MaintenanceOrderStatus | "ALL" | null {
  if (!value || value === "ALL") return "ALL";
  return statusSchema.safeParse(value).success ? (value as MaintenanceOrderStatus) : null;
}

function sourceParam(value: string | null): MaintenanceOrderSource | "ALL" | null {
  if (!value || value === "ALL") return "ALL";
  return sourceSchema.safeParse(value).success ? (value as MaintenanceOrderSource) : null;
}

function priorityInput(value: MaintenanceOrderPriority) {
  return value;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const payload = await listMaintenanceOrders(actor, {
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      status: statusParam(url.searchParams.get("status")),
      source: sourceParam(url.searchParams.get("source")),
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
    });

    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar OS de manutencao.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da OS invalidos.");
    }

    const order = await createMaintenanceOrder(actor, {
      ...parsed.data,
      priority: priorityInput(parsed.data.priority),
    } as MaintenanceOrderInput);
    return NextResponse.json({ success: true, order }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao criar OS de manutencao.");
  }
}
