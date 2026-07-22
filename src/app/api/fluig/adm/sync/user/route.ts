import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { listConfiguredFluigUserActors, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listFluigMonitoredUsersForSync } from "@/lib/db/fluig-repository";
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
      const [configuredActors, monitored] = await Promise.all([
        listConfiguredFluigUserActors(),
        listFluigMonitoredUsersForSync(actor),
      ]);
      if (monitored.persistence.errors.length) throw new Error(monitored.persistence.errors.join(" "));
      const credentialActor = configuredActors.find((target) => target.id === actor.id) || configuredActors[0];
      if (!credentialActor) {
        return jsonError("Cadastre ao menos uma credencial Fluig para a VPS sincronizar os usuarios monitorados.", 409);
      }
      const selectedUsers = parsed.data.userId
        ? monitored.users.filter((target) => target.id === parsed.data.userId)
        : monitored.users;
      if (!selectedUsers.length) return jsonError("Nenhum usuario Fluig monitorado encontrado para sincronizacao.", 404);
      const result = await createUserIncrementalBatchJob({
        actor: { ...credentialActor, isAdmin: true },
        module: parsed.data.module,
        limit: parsed.data.limit,
        monitoredUsers: selectedUsers.map((target) => ({
          id: target.id,
          displayName: target.displayName,
          email: target.email,
          fluigUserId: target.fluigUserId,
          fluigLogin: target.fluigUsername,
        })),
      });

      return NextResponse.json({
        success: true,
        scope: "all",
        jobs: result.jobs,
        skipped: result.skipped,
        usersQueued: selectedUsers.length,
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
