import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { allNavigationPageSlugs } from "@/lib/navigation";
import {
  listUsersWithBranches,
  resolveCurrentAppUser,
  upsertAppUser,
} from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appRoleSchema = z.enum([
  "ADMIN_MASTER",
  "ADMIN",
  "ADMINISTRATIVO",
  "GERENTE_CD",
  "FINANCEIRO",
  "COMPRAS",
  "MANUTENCAO",
  "LEITURA",
]);
const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const pageSlugSchema = z.string().refine((slug) => allNavigationPageSlugs.includes(slug), {
  message: "Pagina de acesso desconhecida.",
});
const pageAccessSchema = z.strictObject({
  pageSlug: pageSlugSchema,
  canView: z.boolean(),
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  canApprove: z.boolean(),
}).refine((page) => page.canView || (!page.canCreate && !page.canUpdate && !page.canApprove), {
  message: "Permissoes de acao exigem permissao de visualizacao.",
});

export const userAccessBodySchema = z.strictObject({
  id: z.uuid().optional(),
  email: z.email().nullable().optional(),
  displayName: z.string().trim().min(1, "Nome do usuario e obrigatorio.").optional(),
  role: appRoleSchema.optional(),
  fluigUsername: z.string().trim().nullable().optional(),
  fluigUserId: z.string().trim().nullable().optional(),
  homeBranchId: z.uuid().nullable().optional(),
  branchIds: z.array(z.uuid()).optional(),
  pageSlugs: z.array(pageSlugSchema).optional(),
  pageAccess: z.array(pageAccessSchema).optional(),
  active: z.boolean().optional(),
  approvalStatus: approvalStatusSchema.optional(),
  rejectionReason: z.string().trim().nullable().optional(),
}).superRefine((body, context) => {
  if (!body.id && !body.displayName) {
    context.addIssue({ code: "custom", path: ["displayName"], message: "Nome do usuario e obrigatorio." });
  }

  const hasBranchIds = body.branchIds !== undefined;
  const hasHomeBranch = body.homeBranchId !== undefined;
  if (hasBranchIds !== hasHomeBranch) {
    context.addIssue({
      code: "custom",
      path: ["homeBranchId"],
      message: "Informe as filiais e exatamente uma filial principal.",
    });
  }
  if (body.branchIds && new Set(body.branchIds).size !== body.branchIds.length) {
    context.addIssue({ code: "custom", path: ["branchIds"], message: "Nao repita filiais." });
  }
  const globalAdminMatrix = body.role && ["ADMIN_MASTER", "ADMIN"].includes(body.role) && body.branchIds?.length === 0 && body.homeBranchId == null;
  if (body.branchIds && !globalAdminMatrix && !body.homeBranchId) {
    context.addIssue({
      code: "custom",
      path: ["homeBranchId"],
      message: "Informe exatamente uma filial principal.",
    });
  }
  if (body.branchIds && body.homeBranchId && !body.branchIds.includes(body.homeBranchId)) {
    context.addIssue({
      code: "custom",
      path: ["homeBranchId"],
      message: "A filial principal deve pertencer as filiais selecionadas.",
    });
  }
  if (body.role && !["ADMIN_MASTER", "ADMIN"].includes(body.role) && !hasBranchIds) {
    context.addIssue({
      code: "custom",
      path: ["branchIds"],
      message: "Ao definir um perfil por filial, informe as filiais e a filial principal.",
    });
  }
  for (const [path, pages] of [["pageSlugs", body.pageSlugs], ["pageAccess", body.pageAccess]] as const) {
    const slugs = pages?.map((page) => typeof page === "string" ? page : page.pageSlug);
    if (slugs && new Set(slugs).size !== slugs.length) {
      context.addIssue({ code: "custom", path: [path], message: "Nao repita paginas de acesso." });
    }
  }
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

const userDomainErrors: Record<string, { status: number; message: string }> = {
  USER_ADMIN_REQUIRED: { status: 403, message: "Somente administradores podem alterar usuarios." },
  USER_ADMIN_MASTER_REQUIRED: { status: 403, message: "Somente ADMIN_MASTER pode alterar esse perfil." },
  USER_NOT_FOUND: { status: 404, message: "Usuario nao encontrado." },
  USER_SELF_LOCKOUT: { status: 409, message: "O administrador logado nao pode remover a propria liberacao." },
  USER_LAST_ADMIN_MASTER: { status: 409, message: "Nao e permitido remover o ultimo ADMIN_MASTER ativo." },
  USER_INVALID_BRANCH_MATRIX: { status: 400, message: "Informe as filiais e exatamente uma filial principal." },
  USER_INVALID_BRANCH: { status: 400, message: "Uma ou mais filiais estao inativas ou nao existem." },
  USER_INVALID_PAGE_ACCESS: { status: 400, message: "Permissao de pagina invalida." },
  USER_NAME_REQUIRED: { status: 400, message: "Nome do usuario e obrigatorio." },
};

function userDomainErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const mapped = userDomainErrors[message];
  return mapped ? jsonError(mapped.message, mapped.status) : null;
}

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return jsonError("Somente administradores podem consultar usuarios e filiais.", 403);
    }

    const payload = await listUsersWithBranches();
    return NextResponse.json({
      success: true,
      actor: {
        id: actor.id,
        role: actor.role,
        isAdmin: actor.isAdmin,
      },
      ...payload,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar usuarios.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return jsonError("Somente administradores podem alterar usuarios.", 403);
    }

    const parsedBody = userAccessBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) return jsonError(parsedBody.error.issues[0]?.message || "Dados invalidos.");
    const body = parsedBody.data;

    if (
      body.id === actor.id &&
      (body.active === false ||
        body.approvalStatus === "PENDING" ||
        body.approvalStatus === "REJECTED" ||
        (body.role && body.role !== "ADMIN_MASTER" && body.role !== "ADMIN"))
    ) {
      return jsonError("O administrador logado nao pode remover a propria liberacao administrativa.", 409);
    }

    const user = await upsertAppUser({
      actor: { id: actor.id, role: actor.role },
      id: body.id,
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      fluigUsername: body.fluigUsername,
      fluigUserId: body.fluigUserId,
      homeBranchId: body.homeBranchId,
      branchIds: body.branchIds,
      pageSlugs: body.pageSlugs,
      pageAccess: body.pageAccess,
      active: body.active,
      approvalStatus: body.approvalStatus,
      rejectionReason: body.rejectionReason,
    });

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    const domainResponse = userDomainErrorResponse(error);
    if (domainResponse) return domainResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao salvar usuario.", 500);
  }
}
