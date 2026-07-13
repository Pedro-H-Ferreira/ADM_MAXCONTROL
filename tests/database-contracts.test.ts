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

  it("atualiza updated_at ao persistir historico e status Fluig", async () => {
    const repository = await source("src/lib/db/fluig-repository.ts");

    expect(repository).toMatch(/last_synced_at:\s*syncedAt[\s\S]*updated_at:\s*syncedAt/);
    expect(repository).toMatch(/last_synced_at:\s*checkedAt[\s\S]*updated_at:\s*syncedAt/);
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

  it("protege o ciclo de vida do fornecedor no repository e no banco", async () => {
    const repository = await source("src/lib/db/suppliers-repository.ts");
    const migration = await source("supabase/migrations/20260713023625_secure_supplier_lifecycle.sql");

    expect(repository).toContain("assertSupplierMutationScope");
    expect(repository).toContain("validateSupplierBranchScope");
    expect(repository).toContain('rpc("save_app_supplier"');
    expect(repository).toContain('rpc("delete_app_supplier"');
    expect(repository).toContain("buildFluigActorPostgrestFilter");
    expect(repository).toContain("findSupplierCatalogByCnpj");
    expect(migration).toContain("create policy \"authenticated_read_app_suppliers\"");
    expect(migration).toContain("app_supplier_branch_one_default_idx");
    expect(migration).toContain("normalize_app_supplier_cnpj");
    expect(migration).toContain("prevent_linked_app_supplier_delete");
    expect(migration).toContain("create or replace function public.save_app_supplier");
    expect(migration).toContain("create or replace function public.delete_app_supplier");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
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
    expect(suppliersPage).toContain("Solicitacoes Fluig vinculadas");
    expect(suppliersPage).toContain("requestCount");
    expect(suppliersPage).toContain("requests: SupplierLinkedRequest[]");
    expect(suppliersPage).toContain("openViewDialog");
    expect(suppliersPage).toContain("fetch(`/api/fornecedores/${supplier.id}`");
    expect(suppliersPage).toContain("approve-pre-registration");
    expect(suppliersPage).toContain("candidates/${candidateId}/ignore");
    expect(supplierRepository).toContain("approveSupplierPreRegistration");
    expect(supplierRepository).toContain("pre_registration_approved");
    expect(supplierRepository).toContain("reconcile_fluig_supplier_relations");
    expect(supplierRepository).toContain("fetchSupplierRequestSummaries");
    expect(supplierRepository).toContain("filterRowsForActor");
    expect(supplierRepository).toContain("requests: requests.map(mapSupplierLinkedRequest)");
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

  it("mantem claim, progresso, conclusao e reaper Fluig transacionais", async () => {
    const repository = await source("src/lib/db/app-repository.ts");
    const migration = await source("supabase/migrations/20260713014131_transactional_fluig_job_queue.sql");

    expect(repository).toContain('rpc("claim_next_fluig_job"');
    expect(repository).toContain('rpc("transition_fluig_job"');
    expect(repository).toContain('rpc("complete_fluig_job"');
    expect(repository).toContain('rpc("reconcile_fluig_job_lifecycle"');
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("insert into public.fluig_job_events");
    expect(migration).toContain("update public.fluig_user_sync_state");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("projeta jobs Fluig com retomada apos reload e sem timeout artificial", async () => {
    const repository = await source("src/lib/db/app-repository.ts");
    const api = await source("src/lib/fluig-api.ts");
    const projection = await source("src/lib/fluig-job-state.ts");
    const tracker = await source("src/lib/use-fluig-job-state.ts");
    const dashboard = await source("src/components/shared/dashboard-fluig-operations.tsx");
    const tasks = await source("src/components/pages/fluig-tasks-page.tsx");
    const moduleOperations = await source("src/components/pages/fluig-module-operations-page.tsx");
    const integrationPanel = await source("src/components/shared/fluig-integration-panel.tsx");
    const launchForm = await source("src/components/shared/fluig-launch-form.tsx");
    const suppliers = await source("src/components/pages/suppliers-page.tsx");
    const maintenance = await source("src/components/pages/maintenance-page.tsx");

    expect(repository).toContain("const loadActiveJobs = async");
    expect(repository).toContain(".range(from, from + pageSize - 1)");
    expect(repository).toContain('status: "started" | "success" | "error"');
    expect(api).toContain('status: "started" | "success" | "error"');
    expect(projection).toContain("projectFluigJobState");
    expect(tracker).toContain("waitForFluigJobs");
    expect(tracker).toContain("listJobs(50)");
    expect(dashboard).toContain("waitForFluigJobs");
    expect(tasks).toContain("waitForFluigJobs");
    expect(moduleOperations).toContain("waitForFluigJobs");
    expect(integrationPanel).toContain("useFluigJobState");
    expect(launchForm).toContain("useFluigJobState");
    expect(suppliers).toContain("useFluigJobState");
    expect(maintenance).toContain("useFluigJobState");
    for (const consumer of [dashboard, tasks, moduleOperations, integrationPanel, launchForm, suppliers, maintenance]) {
      expect(consumer).not.toContain("attempt < 120");
    }
    expect(dashboard).not.toContain("lastSuccessAt || latestState.updatedAt");
    expect(tasks).not.toContain("lastSuccessAt || latestState.updatedAt");
    expect(moduleOperations).not.toContain("lastSuccessAt || latestState.updatedAt");
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

  it("nao trata falhas antigas do agente Fluig como erro atual do dashboard", async () => {
    const dashboardRepository = await source("src/lib/db/dashboard-repository.ts");
    const dashboardOperations = await source("src/components/shared/dashboard-fluig-operations.tsx");
    const fluigTasksPage = await source("src/components/pages/fluig-tasks-page.tsx");
    const fluigModuleOperationsPage = await source("src/components/pages/fluig-module-operations-page.tsx");

    expect(dashboardRepository).toContain("recentFailureWindowMs");
    expect(dashboardRepository).toContain("shouldShowRecentActivity");
    expect(dashboardRepository).toContain("finished_at");
    expect(dashboardOperations).toContain("isRecentJobFailure");
    expect(dashboardOperations).toContain("isCurrentSyncStateError");
    expect(dashboardOperations).toContain("Falhas acionaveis das ultimas 24h");
    expect(fluigTasksPage).toContain("isVisibleRecentJob");
    expect(fluigTasksPage).toContain("isCurrentSyncStateError");
    expect(fluigTasksPage).toContain("Falhas acionaveis das ultimas 24h");
    expect(fluigModuleOperationsPage).toContain("isRecentJobFailure");
    expect(fluigModuleOperationsPage).toContain("isCurrentSyncStateError");
    expect(fluigModuleOperationsPage).toContain("Falhas acionaveis das ultimas 24h");
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
    expect(repository).toContain('.eq("is_open", true)');
    expect(repository).not.toContain('is_open.eq.true,is_open.is.null');
    expect(repository).not.toContain("Math.max(limit * 5, 100)");
    expect(tasksRoute).toContain("onlyTasks: true");
    expect(dashboardRepository).toContain("buildFluigActorPostgrestFilter");
  });

  it("resolve consulta por numero Fluig pelo modulo conhecido antes de criar job", async () => {
    const lookupRoute = await source("src/app/api/fluig/adm/request/lookup/route.ts");

    expect(lookupRoute).toContain("resolveModuleForLookup");
    expect(lookupRoute).toContain("readFluigRequestByNumberForActor");
    expect(lookupRoute).toContain("knownRequest.request?.module");
    expect(lookupRoute).toContain("Selecione Pagamentos, Compras ou Manutencao");
    expect(lookupRoute).not.toContain('module === "auto" || module === "fornecedores" ? "pagamentos"');
  });

  it("permite escolher o modulo operacional na consulta por numero Fluig", async () => {
    const fluigTasksPage = await source("src/components/pages/fluig-tasks-page.tsx");

    expect(fluigTasksPage).toContain("lookupModuleOptions");
    expect(fluigTasksPage).toContain("lookupModuleForRequest");
    expect(fluigTasksPage).toContain("Modulo da consulta");
    expect(fluigTasksPage).toContain("Detectar pelo ADM");
    expect(fluigTasksPage).toContain("module: targetLookupModule");
  });

  it("executa cancelamento Fluig pelo agente local e persiste retorno", async () => {
    const cancelRoute = await source("src/app/api/fluig/adm/cancel/route.ts");
    const resultRoute = await source("src/app/api/agent/jobs/[jobId]/result/route.ts");
    const fluigApi = await source("src/lib/fluig-api.ts");
    const fluigTasksPage = await source("src/components/pages/fluig-tasks-page.tsx");
    const integrationDoc = await source("docs/FLUIG_INTEGRATION.md");

    expect(cancelRoute).toContain("createFluigJob");
    expect(cancelRoute).toContain('operation: "cancel_request"');
    expect(cancelRoute).toContain("upsertFluigUserSyncState");
    expect(cancelRoute).not.toContain("cancelFluigRequests");
    expect(resultRoute).toContain("extractCancelStatusItems");
    expect(resultRoute).toContain('job.operation === "cancel_request"');
    expect(resultRoute).toContain("syncSource: job.operation");
    expect(fluigApi).toContain("async cancelRequest");
    expect(fluigTasksPage).toContain("cancelFluigRequest");
    expect(fluigTasksPage).toContain("Cancelar no Fluig");
    expect(integrationDoc).toContain("cria job `cancel_request`");
  });

  it("executa consulta de status Fluig pelo agente local", async () => {
    const statusRoute = await source("src/app/api/fluig/adm/status/route.ts");
    const resultRoute = await source("src/app/api/agent/jobs/[jobId]/result/route.ts");
    const chunkRoute = await source("src/app/api/agent/jobs/[jobId]/chunk/route.ts");
    const fluigApi = await source("src/lib/fluig-api.ts");
    const integrationDoc = await source("docs/FLUIG_INTEGRATION.md");

    expect(statusRoute).toContain("createFluigJob");
    expect(statusRoute).toContain('operation: "sync_status"');
    expect(statusRoute).toContain("reuseActive: true");
    expect(statusRoute).toContain("upsertFluigUserSyncState");
    expect(statusRoute).not.toContain("syncFluigStatus");
    expect(statusRoute).not.toContain("getFluigRuntimeConfig");
    expect(resultRoute).toContain("shouldPersistJobResult");
    expect(resultRoute).toContain('job.operation === "sync_status"');
    expect(chunkRoute).toContain("shouldPersistJobResult");
    expect(fluigApi).toContain("async syncStatus");
    expect(integrationDoc).toContain("cria job `sync_status`");
  });

  it("isola agentes por usuario e exige heartbeat proprio antes de criar jobs", async () => {
    const repository = await source("src/lib/db/app-repository.ts");
    const transactionalMigration = await source("supabase/migrations/20260713014131_transactional_fluig_job_queue.sql");
    const dashboard = await source("src/components/shared/dashboard-fluig-operations.tsx");
    const tasksPage = await source("src/components/pages/fluig-tasks-page.tsx");
    const integrationPanel = await source("src/components/shared/fluig-integration-panel.tsx");

    expect(repository).toMatch(/listAgentsForActor[\s\S]*?\.eq\("user_id", actor\.id\)/);
    expect(repository).toContain("assertOnlineAgentForActor");
    expect(repository).toContain('"FLUIG_AGENT_OFFLINE"');
    expect(repository).toMatch(/pollNextAgentJob[\s\S]*?rpc\("claim_next_fluig_job"/);
    expect(transactionalMigration).toContain("j.requested_by_user_id = v_user_id");
    expect(repository).toMatch(/listJobsForActor[\s\S]*?\.eq\("requested_by_user_id", actor\.id\)/);
    expect(repository).toMatch(/readJobForActor[\s\S]*?\.eq\("requested_by_user_id", actor\.id\)/);
    expect(repository).toContain('owner.approval_status !== "APPROVED"');
    expect(dashboard).toContain("syncing || testingAgent || !onlineAgent");
    expect(tasksPage).toContain("syncing || lookingUp || testingAgent || !onlineAgent");
    expect(integrationPanel).toContain("fluigBusy || !onlineAgent");
  });

  it("mantem expiracao, retry controlado e teste autenticado no agente Fluig", async () => {
    const migration = await source("supabase/migrations/20260625141131_harden_fluig_job_lifecycle.sql");
    const repository = await source("src/lib/db/app-repository.ts");
    const eventRoute = await source("src/app/api/agent/jobs/[jobId]/event/route.ts");
    const runner = await source("agent/fluig-agent/src/runner.js");
    const healthCheck = await source("scripts/fluig/healthCheck.js");
    const resultRoute = await source("src/app/api/agent/jobs/[jobId]/result/route.ts");

    expect(migration).toContain("max_attempts");
    expect(migration).toContain("next_attempt_at");
    expect(migration).toMatch(/where status = 'queued'[\s\S]*expires_at <= now\(\)/);
    expect(repository).toContain("reconcileFluigJobLifecycle");
    expect(repository).toContain("recordDetectedFluigUserId");
    expect(repository).toContain("fluig_user_id.is.null,fluig_user_id.eq.");
    expect(repository).toContain("existingFluigUserId === fluigUserId");
    expect(repository).toContain("fluigUserIdFromJobPayload");
    expect(repository).toContain("payload.taskUserId || userMatch?.fluigUserId");
    expect(repository).toContain("p_agent_id: input.agentId");
    expect(eventRoute).toContain("eventSchema.safeParse");
    expect(eventRoute).not.toContain('"success",');
    expect(eventRoute).not.toContain('"error",');
    expect(resultRoute).toContain('job.operation === "health_check"');
    expect(resultRoute).toContain("extractCurrentFluigUserId");
    expect(resultRoute).toContain("recordDetectedFluigUserId");
    expect(resultRoute).toContain("FLUIG_IDENTITY_MISMATCH");
    expect(runner).toContain('"scripts", "fluig", "healthCheck.js"');
    expect(healthCheck).toContain("loginWithBrowser");
    expect(healthCheck).toContain("/portal/api/rest/wcm/rest/admin/location/getCurrentUserId");
  });

  it("instala e remove o agente Windows sem deixar processo Node orfao", async () => {
    const installer = await source("agent/fluig-agent/scripts/install-windows-agent.ps1");
    const uninstaller = await source("agent/fluig-agent/scripts/uninstall-windows-agent.ps1");
    const agentPackage = await source("agent/fluig-agent/package.json");

    expect(installer).toContain("Stop-AgentProcesses -AgentScriptPath $AgentScript");
    expect(installer).toContain("New-ScheduledTaskAction -Execute $NodePath");
    expect(installer).toContain("-RunLevel Limited");
    expect(installer).not.toContain('New-ScheduledTaskAction -Execute "cmd.exe"');
    expect(uninstaller).toContain("Stop-AgentProcesses -AgentScriptPath $AgentScript");
    expect(agentPackage).toContain('"version": "0.1.3"');
  });
});
