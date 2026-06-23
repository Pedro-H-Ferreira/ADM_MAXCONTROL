import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  listUsersWithBranches,
  resolveCurrentAppUser,
  upsertAppUser,
  type AppUserPageAccess,
  type AppRole,
  type ApprovalStatus,
} from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserAccessBody = {
  id?: string;
  email?: string | null;
  displayName?: string;
  role?: AppRole;
  fluigUsername?: string | null;
  fluigUserId?: string | null;
  homeBranchId?: string | null;
  branchIds?: string[];
  pageSlugs?: string[];
  pageAccess?: AppUserPageAccess[];
  active?: boolean;
  approvalStatus?: ApprovalStatus;
  rejectionReason?: string | null;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
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

    const body = (await request.json().catch(() => ({}))) as UserAccessBody;
    if (!body.displayName?.trim()) {
      return jsonError("Nome do usuario e obrigatorio.");
    }

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
      id: body.id,
      email: body.email,
      displayName: body.displayName,
      role: body.role || "LEITURA",
      fluigUsername: body.fluigUsername,
      fluigUserId: body.fluigUserId,
      homeBranchId: body.homeBranchId,
      branchIds: body.branchIds || [],
      pageSlugs: body.pageSlugs || [],
      pageAccess: body.pageAccess,
      active: body.active,
      approvalStatus: body.approvalStatus,
      approvedByUserId: actor.id,
      rejectionReason: body.rejectionReason,
    });

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao salvar usuario.", 500);
  }
}
