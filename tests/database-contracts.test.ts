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
});
