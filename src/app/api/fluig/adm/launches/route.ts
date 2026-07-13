import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  canActorAccessPage,
  canActorPerformPageAction,
  resolveCurrentAppUser,
} from "@/lib/db/app-repository";
import {
  createValidatedOperationalLaunch,
  enqueueOperationalLaunchJob,
  getOperationalLaunch,
  listOperationalLaunches,
} from "@/lib/db/operational-launch-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import {
  operationalLaunchFingerprint,
  validateOperationalLaunch,
  type OperationalLaunchModule,
} from "@/lib/operational-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleSchema = z.enum(["pagamentos", "compras"]);
const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z.number().int().nonnegative().max(3 * 1024 * 1024),
});
const attachmentPayloadSchema = attachmentSchema.extend({
  dataBase64: z.string().min(1),
});
const itemSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().positive().max(999999),
  unit: z.string().trim().min(1).max(30),
  unitPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const validateSchema = z.object({
  action: z.literal("validate"),
  module: moduleSchema,
  sourceRequestId: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().trim().max(500).nullable().optional(),
  supplierCnpj: z.string().trim().max(30).nullable().optional(),
  branchCode: z.string().trim().max(100).nullable().optional(),
  branchLabel: z.string().trim().max(500).nullable().optional(),
  amountCents: z.number().int().nonnegative().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  fieldOverrides: z.record(z.string(), z.string().max(10000)),
  attachments: z.array(attachmentSchema).max(20),
  items: z.array(itemSchema).max(100).optional(),
});
const submitSchema = z.object({
  action: z.literal("submit"),
  launchId: z.string().uuid(),
  attachments: z.array(attachmentPayloadSchema).max(20),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function canCreateLaunch(actor: Awaited<ReturnType<typeof resolveCurrentAppUser>>, module: OperationalLaunchModule) {
  return canActorAccessPage(actor, module) && canActorPerformPageAction(actor, module, "canCreate");
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const parsedModule = url.searchParams.get("module")
      ? moduleSchema.safeParse(url.searchParams.get("module"))
      : null;
    if (parsedModule && !parsedModule.success) return jsonError("Modulo operacional invalido.");
    const moduleSlugFilter = parsedModule?.success ? parsedModule.data : null;

    if (moduleSlugFilter && !canActorAccessPage(actor, moduleSlugFilter)) {
      return jsonError("Usuario sem permissao para consultar este modulo.", 403);
    }

    const id = url.searchParams.get("id");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
    const launches = await listOperationalLaunches(actor, { module: moduleSlugFilter, id, limit });

    return NextResponse.json({
      success: true,
      launches,
      permissions: moduleSlugFilter
        ? {
            canView: canActorAccessPage(actor, moduleSlugFilter),
            canCreate: canCreateLaunch(actor, moduleSlugFilter),
          }
        : null,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar lancamentos.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));

    if ((body as { action?: unknown }).action === "validate") {
      const parsed = validateSchema.safeParse(body);
      if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Lancamento invalido.");
      if (!canCreateLaunch(actor, parsed.data.module)) {
        return jsonError("Usuario sem permissao para criar lancamentos neste modulo.", 403);
      }

      const errors = validateOperationalLaunch(parsed.data);
      if (errors.length) return jsonError(errors[0]);
      const launch = await createValidatedOperationalLaunch(actor, parsed.data);
      return NextResponse.json({ success: true, launch }, { status: 201 });
    }

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Confirmacao de lancamento invalida.");
    const launch = await getOperationalLaunch(actor, parsed.data.launchId);
    if (!launch) return jsonError("Lancamento operacional nao encontrado.", 404);
    if (!canCreateLaunch(actor, launch.module)) {
      return jsonError("Usuario sem permissao para enviar este lancamento.", 403);
    }
    if (!["VALIDADO", "ERRO"].includes(launch.status)) {
      return jsonError("Este lancamento ja foi enviado ou concluido.");
    }

    const totalBytes = parsed.data.attachments.reduce((sum, item) => sum + item.size, 0);
    if (totalBytes > 3 * 1024 * 1024) return jsonError("Os anexos precisam ficar abaixo de 3 MB no total.");

    const fingerprint = operationalLaunchFingerprint({
      sourceRequestId: launch.sourceRequestId,
      fieldOverrides: launch.fieldOverrides,
      attachments: parsed.data.attachments,
      items: launch.items,
    });
    if (fingerprint !== launch.reviewFingerprint) {
      return jsonError("Campos, itens ou anexos mudaram depois da validacao. Valide novamente.");
    }

    const processMap = requireFluigProcessMap(launch.module);
    const job = await enqueueOperationalLaunchJob({
      actor,
      launchId: launch.id,
      requestPayload: {
        attachments: parsed.data.attachments,
        attachmentCount: parsed.data.attachments.length,
        confirm: true,
        processMap: {
          module: processMap.module,
          processId: processMap.processId,
          processVersions: processMap.processVersions,
          processLabel: processMap.processLabel,
          defaultTaskUserId: processMap.defaultTaskUserId,
        },
      },
    });
    const queuedLaunch = await getOperationalLaunch(actor, launch.id);
    if (!queuedLaunch) return jsonError("Lancamento enfileirado, mas nao foi possivel recarrega-lo.", 500);
    return NextResponse.json({ success: true, launch: queuedLaunch, job });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao processar lancamento.", 500);
  }
}
