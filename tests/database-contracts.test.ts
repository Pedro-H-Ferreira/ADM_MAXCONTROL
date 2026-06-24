import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function source(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

describe("database and API contracts", () => {
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
  });

  it("divide os vinculos de fornecedores do dashboard para evitar URL PostgREST excessiva", async () => {
    const dashboardRepository = await source("src/lib/db/dashboard-repository.ts");

    expect(dashboardRepository).toContain("chunksOf(supplierIds, 100)");
    expect(dashboardRepository).toContain("Dashboard: falha ao consultar");
    expect(dashboardRepository).not.toMatch(
      /\.from\("app_supplier_branch_links"\)[\s\S]{0,220}\.in\("supplier_id", supplierIds\)/
    );
  });
});
