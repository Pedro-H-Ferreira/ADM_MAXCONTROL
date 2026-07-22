import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { listConfiguredFluigUserActors, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createUserIncrementalBatchJob } from "@/app/api/fluig/adm/sync/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  module: z.enum(["pagamentos", "compras", "manutencao", "fornecedores", "all", "auto"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  scope: z.enum(["self", "all"]).default("self"),
  userId: z.uuid().optional(),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Payload invalido.");
    }

    if (parsed.data.scope === "all") {
      if (!actor.isAdmin) return jsonError("Somente administradores podem sincronizar todos os usuarios Fluig.", 403);
      const configuredActors = await listConfiguredFluigUserActors();
      const selectedActors = parsed.data.userId
        ? configuredActors.filter((target) => target.id === parsed.data.userId)
        : configuredActors;
      const uniqueActors = Array.from(
        new Map(
          selectedActors.map((target) => [
            String(target.fluigUserId || target.fluigUsername || target.email || target.id).trim().toLowerCase(),
            target,
          ])
        ).values()
      );
      const jobs = [];
      const skipped: Array<{ userId: string; displayName: string; reason: string }> = [];

      for (const target of uniqueActors) {
        try {
          const result = await createUserIncrementalBatchJob({
            actor: { ...target, isAdmin: true },
            module: parsed.data.module,
            limit: parsed.data.limit,
          });
          jobs.push(...result.jobs.map((job) => ({
            ...job,
            requestedUserId: target.id,
            requestedUserName: target.displayName,
          })));
          skipped.push(...result.skipped.map((item) => ({
            userId: target.id,
            displayName: target.displayName,
            reason: `${item.module}: ${item.reason}`,
          })));
        } catch (error) {
          skipped.push({
            userId: target.id,
            displayName: target.displayName,
            reason: error instanceof Error ? error.message : "Falha ao criar sincronizacao.",
          });
        }
      }

      return NextResponse.json({
        success: true,
        scope: "all",
        jobs,
        skipped,
        usersQueued: uniqueActors.length,
      });
    }

    const result = await createUserIncrementalBatchJob({ actor, module: parsed.data.module, limit: parsed.data.limit });

    return NextResponse.json({
      success: true,
      scope: "self",
      ...result,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao sincronizar usuario Fluig.", 500);
  }
}
