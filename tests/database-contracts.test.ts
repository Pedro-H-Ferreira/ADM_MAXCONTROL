import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function source(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

describe("database and API contracts", () => {
  it("mantem uma protecao global para falhas de layout e sessao", async () => {
    const globalError = await source("src/app/global-error.tsx");
    const rootError = await source("src/app/error.tsx");
    const appError = await source("src/app/(app)/error.tsx");

    expect(globalError).toContain('"use client"');
    expect(globalError).toContain("<html");
    expect(globalError).toContain("<body");
    expect(globalError).toContain("unstable_retry");
    expect(globalError).toContain("[global-app-error]");
    expect(globalError).toContain("window.location.reload");
    expect(rootError).toContain('"use client"');
    expect(rootError).toContain("[root-app-error]");
    expect(rootError).toContain("unstable_retry");
    expect(rootError).toContain("window.location.reload");
    expect(appError).toContain("[app-route-error]");
    expect(appError).toContain("window.location.reload");
  });

  it("mantem ADMINISTRATIVO no constraint de perfis", async () => {
    const migration = await source("supabase/migrations/20260623102458_harden_fluig_data_api_access.sql");
    expect(migration).toContain("'ADMINISTRATIVO'");
    expect(migration).toMatch(/add constraint app_user_profiles_role_check[\s\S]*role in/i);
  });

  it("mantem o upsert de solicitacoes idempotente por modulo e numero Fluig", async () => {
    const repository = await source("src/lib/db/fluig-repository.ts");
    expect(repository).toContain('onConflict: "module_slug,fluig_request_id"');
  });

  it("mantem o CRUD completo das rotas de filial", async () => {
    const collectionRoute = await source("src/app/api/admin/branches/route.ts");
    const itemRoute = await source("src/app/api/admin/branches/[id]/route.ts");

    expect(collectionRoute).toMatch(/export async function GET/);
    expect(collectionRoute).toMatch(/export async function POST/);
    expect(itemRoute).toMatch(/export async function GET/);
    expect(itemRoute).toMatch(/export async function PATCH/);
    expect(itemRoute).toMatch(/export async function DELETE/);
  });

  it("preserva todos os campos do fornecedor em atualizacoes parciais", async () => {
    const repository = await source("src/lib/db/suppliers-repository.ts");

    expect(repository).toMatch(/nomeFantasia:\s*current\.nome_fantasia/);
    expect(repository).toMatch(/defaultPayload:\s*current\.default_payload \|\| \{\}/);
    expect(repository).toMatch(/sourceSystem:\s*current\.source_system/);
    expect(repository).toMatch(/syncStatus:\s*current\.sync_status/);
    expect(repository).toMatch(/\.\.\.input/);
  });

  it("mantem filtros de filial, pendencia e erro na consulta de fornecedores", async () => {
    const repository = await source("src/lib/db/suppliers-repository.ts");
    const route = await source("src/app/api/fornecedores/route.ts");

    expect(repository).toContain("app_supplier_branch_links!inner(branch_id)");
    expect(repository).toContain("actorBranchScoped");
    expect(repository).toContain('query.in("app_supplier_branch_links.branch_id", actorBranchIds)');
    expect(repository).toContain('"status.eq.PENDENTE_REVISAO,sync_status.eq.PENDENTE_REVISAO"');
    expect(repository).toContain('query.eq("sync_status", "ERRO_SYNC")');
    expect(route).toContain("supplierListFiltersSchema.safeParse");
    expect(route).toContain("Usuario sem permissao para consultar fornecedores desta filial.");
  });

  it("materializa pre-cadastros e relacionamentos do historico sem reabrir candidatos aprovados", async () => {
    const supplierRepository = await source("src/lib/db/suppliers-repository.ts");
    const fluigRepository = await source("src/lib/db/fluig-repository.ts");
    const chunkRoute = await source("src/app/api/agent/jobs/[jobId]/chunk/route.ts");
    const resultRoute = await source("src/app/api/agent/jobs/[jobId]/result/route.ts");
    const migration = await source("supabase/migrations/20260624090623_reconcile_fluig_supplier_relations.sql");

    expect(supplierRepository).toContain("reconcileSupplierPreRegistrations");
    expect(supplierRepository).toContain('"PRE_CADASTRO_FLUIG"');
    expect(supplierRepository).toContain('"PENDENTE_REVISAO"');
    expect(fluigRepository).not.toMatch(/source_payload: candidate\.sourcePayload,\s*status: "PRE_CADASTRO"/);
    expect(chunkRoute).toContain("reconcileSupplierPreRegistrations");
    expect(resultRoute).toContain("reconcileSupplierPreRegistrations");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("revoke all on function public.reconcile_fluig_supplier_relations");
    expect(migration).toContain("app_supplier_branch_links");
  });

  it("exibe fila de revisao e acoes de pre-cadastro Fluig em fornecedores", async () => {
    const suppliersPage = await source("src/components/pages/suppliers-page.tsx");
    const supplierRepository = await source("src/lib/db/suppliers-repository.ts");
    const approvePreRegistrationRoute = await source("src/app/api/fornecedores/[id]/approve-pre-registration/route.ts");
    const ignoreRoute = await source("src/app/api/fornecedores/candidates/[id]/ignore/route.ts");

    expect(suppliersPage).toContain("setPreRegistrationReviewFilters");
    expect(suppliersPage).toContain("approvePreRegistration");
    expect(suppliersPage).toContain("ignoreCandidate");
    expect(suppliersPage).toContain("Revisar pre-cadastros");
    expect(suppliersPage).toContain("Aprovar pre-cadastro");
    expect(suppliersPage).toContain("approve-pre-registration");
    expect(suppliersPage).toContain("candidates/${candidateId}/ignore");
    expect(supplierRepository).toContain("approveSupplierPreRegistration");
    expect(supplierRepository).toContain("pre_registration_approved");
    expect(supplierRepository).toContain("reconcile_fluig_supplier_relations");
    expect(approvePreRegistrationRoute).toContain("approveSupplierPreRegistration");
    expect(ignoreRoute).toContain("ignoreSupplierCandidate");
  });

  it("divide resultados grandes do agente antes de finalizar jobs Fluig", async () => {
    const chunkRoute = await source("src/app/api/agent/jobs/[jobId]/chunk/route.ts");
    const agent = await source("agent/fluig-agent/src/index.js");

    expect(chunkRoute).toContain("isHistoryChunkJob");
    expect(chunkRoute).toContain("isStatusChunkJob");
    expect(chunkRoute).toContain("supplier_lookup_by_cnpj");
    expect(chunkRoute).toContain("persistStatusItems");
    expect(agent).toContain("chunkableResultOperations");
    expect(agent).toContain("shouldChunkResult");
    expect(agent).toContain("minimalResultPayload");
    expect(agent).toContain("error.status = response.status");
    expect(agent).toContain("isPayloadTooLargeError");
  });

  it("normaliza filiais Fluig antes de persistir historico e catalogos", async () => {
    const repository = await source("src/lib/db/fluig-repository.ts");
    const migration = await source("supabase/migrations/20260624091741_normalize_fluig_branch_codes.sql");

    expect(repository).toContain("normalizeFluigBranch");
    expect(migration).toContain("app_supplier_branch_links");
    expect(migration).toContain("app_user_branch_access");
    expect(migration).toContain("fluig_requests");
  });

  it("renova a sessao Supabase uma vez antes de renderizar rotas protegidas", async () => {
    const rootProxy = await source("proxy.ts");
    const supabaseProxy = await source("src/lib/supabase/proxy.ts");
    const repository = await source("src/lib/db/app-repository.ts");
    const page = await source("src/app/(app)/[...slug]/page.tsx");

    expect(rootProxy).toContain("updateSupabaseSession");
    expect(supabaseProxy).toContain("request.cookies.set");
    expect(supabaseProxy).toContain("response.cookies.set");
    expect(supabaseProxy).toContain("supabase.auth.getClaims()");
    expect(repository).toContain("cache(resolveCurrentAppUserUncached)");
    expect(repository).toContain("supabase.auth.getClaims()");
    expect(page).toContain("resolveCurrentAppUserForPage");
    expect(page).toContain("AccessDeniedPage");
    expect(page).toContain("Seu usuario esta autenticado");
  });

  it("divide os vinculos de fornecedores do dashboard para evitar URL PostgREST excessiva", async () => {
    const dashboardRepository = await source("src/lib/db/dashboard-repository.ts");

    expect(dashboardRepository).toContain("chunksOf(supplierIds, 100)");
    expect(dashboardRepository).toContain("Dashboard: falha ao consultar");
    expect(dashboardRepository).not.toMatch(
      /\.from\("app_supplier_branch_links"\)[\s\S]{0,220}\.in\("supplier_id", supplierIds\)/
    );
  });

  it("mantem pagamentos e compras no fluxo de lancamento Fluig da propria pagina", async () => {
    const adminData = await source("src/lib/admin-data.ts");
    const dashboard = await source("src/components/pages/dashboard-overview.tsx");
    const launchForm = await source("src/components/shared/fluig-launch-form.tsx");

    expect(adminData).toContain("/pagamentos#novo-lancamento-fluig");
    expect(adminData).toContain("/compras#novo-lancamento-fluig");
    expect(adminData).not.toContain("/pagamentos/novo");
    expect(adminData).not.toContain("/compras/nova");
    expect(dashboard).toContain("/pagamentos#novo-lancamento-fluig");
    expect(dashboard).toContain("/compras#novo-lancamento-fluig");
    expect(launchForm).toContain('id="novo-lancamento-fluig"');
  });

  it("persiste lancamentos operacionais com itens, auditoria e escrita somente server-side", async () => {
    const migration = await source("supabase/migrations/20260624094623_operational_fluig_launches.sql");
    const repository = await source("src/lib/db/operational-launch-repository.ts");
    const route = await source("src/app/api/fluig/adm/launches/route.ts");
    const resultRoute = await source("src/app/api/agent/jobs/[jobId]/result/route.ts");

    expect(migration).toContain("create table if not exists public.app_fluig_launches");
    expect(migration).toContain("create table if not exists public.app_fluig_launch_items");
    expect(migration).toContain("create table if not exists public.app_fluig_launch_events");
    expect(migration).toContain("revoke all on public.app_fluig_launches from anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(repository).toContain('eq("review_fingerprint", fingerprint)');
    expect(repository).toContain("completeOperationalLaunchJob");
    expect(route).toContain('"open_from_source"');
    expect(route).toContain("operationalLaunchFingerprint");
    expect(resultRoute).toContain("completeOperationalLaunchJob");
    expect(resultRoute).toContain("markOperationalLaunchFailure");
  });

  it("aplica visibilidade Fluig no banco antes do limite e separa tarefas abertas", async () => {
    const repository = await source("src/lib/db/fluig-repository.ts");
    const tasksRoute = await source("src/app/api/fluig/adm/tasks/my/route.ts");
    const dashboardRepository = await source("src/lib/db/dashboard-repository.ts");

    expect(repository).toContain("buildFluigActorPostgrestFilter");
    expect(repository).toMatch(/if \(actorFilter\) query = query\.or\(actorFilter\)/);
    expect(repository).not.toContain("Math.max(limit * 5, 100)");
    expect(tasksRoute).toContain("onlyTasks: true");
    expect(dashboardRepository).toContain("buildFluigActorPostgrestFilter");
  });

  it("mantem expiracao, retry controlado e teste autenticado no agente Fluig", async () => {
    const migration = await source("supabase/migrations/20260625141131_harden_fluig_job_lifecycle.sql");
    const repository = await source("src/lib/db/app-repository.ts");
    const runner = await source("agent/fluig-agent/src/runner.js");
    const healthCheck = await source("scripts/fluig/healthCheck.js");

    expect(migration).toContain("max_attempts");
    expect(migration).toContain("next_attempt_at");
    expect(migration).toMatch(/where status = 'queued'[\s\S]*expires_at <= now\(\)/);
    expect(repository).toContain("reconcileFluigJobLifecycle");
    expect(repository).toContain('.eq("assigned_agent_id", input.agentId)');
    expect(runner).toContain('"scripts", "fluig", "healthCheck.js"');
    expect(healthCheck).toContain("loginWithBrowser");
    expect(healthCheck).toContain("/portal/api/rest/wcm/rest/admin/location/getCurrentUserId");
  });
});
