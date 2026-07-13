import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260713080029_fluig_product_service_catalog.sql";

describe("Fluig product and service catalog SQL contract", () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(resolve(process.cwd(), migrationPath), "utf8");
  });

  it("exposes the shared app_products contract with the corrected domain", () => {
    expect(migration).toContain("create table public.app_products");
    for (const column of [
      "sku text",
      "name text not null",
      "normalized_name text not null",
      "dedupe_key text not null",
      "description text",
      "specification text",
      "item_type text not null",
      "category uuid",
      "category_code text",
      "category_label text",
      "material_type uuid",
      "unit text",
      "status text not null default 'REVIEW'",
      "source_system text not null default 'FLUIG'",
      "sync_status text not null default 'PENDING'",
      "classification text not null",
      "classification_confidence numeric(5, 4)",
      "classification_source text not null",
      "review_required boolean not null",
      "image_path text",
      "product_image_path text generated always as (image_path) stored",
      "image_url text",
      "product_url text",
      "first_fluig_request_id uuid",
      "last_fluig_request_id uuid",
      "occurrence_count bigint",
      "last_unit_price_cents bigint",
      "created_at timestamptz",
      "updated_at timestamptz",
      "deleted_at timestamptz",
    ]) {
      expect(migration).toContain(column);
    }

    expect(migration).toContain("item_type in ('MATERIAL', 'SERVICO', 'MISTO', 'INDEFINIDO')");
    expect(migration).toContain("status in ('ACTIVE', 'REVIEW', 'INACTIVE')");
    expect(migration).toContain("unique (source_system, dedupe_key)");
  });

  it("keeps financial categories and material types normalized but editable", () => {
    expect(migration).toContain("create table public.app_product_categories");
    expect(migration).toContain("constraint app_product_categories_source_code_unique unique (source_system, code)");
    expect(migration).toContain("create table public.app_product_material_types");
    expect(migration).toContain("on conflict (normalized_label) do update");
    expect(migration).toContain("'codeField', 'contaCentroCusto'");
    expect(migration).toContain("'labelField', 'codContaFin'");
    expect(migration).not.toContain("('TI', 'TI'");
    expect(migration).not.toContain("('MANUTENCAO_PREDIAL'");
  });

  it("makes each Fluig source row idempotent and records branch provenance", () => {
    expect(migration).toContain("create table public.app_product_occurrences");
    expect(migration).toMatch(
      /unique \(\s*fluig_request_id,\s*source_table,\s*source_row_index\s*\)/
    );
    expect(migration).toContain("branch_id uuid references public.app_branches(id)");
    expect(migration).toContain("branch_code text");
    expect(migration).toContain("branch_label text");
    expect(migration).toContain("app_product_occurrences_branch_idx");
    expect(migration).toContain("app_product_occurrences_branch_code_idx");
  });

  it("supports imported and manual product-to-branch links", () => {
    expect(migration).toContain("create table public.app_product_branch_links");
    expect(migration).toContain("link_source in ('FLUIG', 'MANUAL')");
    expect(migration).toMatch(
      /unique \(\s*product_id,\s*branch_id,\s*link_source\s*\)/
    );
    expect(migration).toContain("insert into public.app_product_branch_links");
    expect(migration).toContain("branch_link.link_source = 'FLUIG'");
    expect(migration).toContain("branch_scoped_product_branch_link_read");
  });

  it("isolates generic descriptions instead of sharing a global product", () => {
    expect(migration).toContain("create or replace function public.is_generic_product_description");
    for (const generic of [
      "DESCRICAO ACIMA",
      "NA DESCRICAO",
      "EM ANEXO",
      "PEDIDO EM ANEXO",
      "TESTE",
    ]) {
      expect(migration).toContain(`'${generic}'`);
    }
    expect(migration).toContain("public.normalize_product_catalog_text(p_name) in ('EPI', 'MANUTENCAO')");
    expect(migration).toContain("v_item_type := 'INDEFINIDO'");
    expect(migration).toContain("v_classification_source := 'GENERIC_DESCRIPTION'");
    expect(migration).toMatch(/v_dedupe_key := concat\(\s*'OCCURRENCE:'/);
    expect(migration).toContain("v_review_required := true");
  });

  it("upserts catalog, occurrence, price, branch aggregate and audit transactionally", () => {
    expect(migration).toContain("create or replace function public.upsert_fluig_product_history");
    expect(migration).toContain("language plpgsql");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("create table public.app_product_price_history");
    expect(migration).toContain("create table public.app_product_audit_events");
    expect(migration).toContain("on conflict (occurrence_id, price_fingerprint) do nothing");
    expect(migration).toContain("on conflict (product_id, idempotency_key) do nothing");
    expect(migration).toContain("first_fluig_request_id = v_first_request_id");
    expect(migration).toContain("occurrence_count = v_occurrence_count");
    expect(migration).toContain("last_unit_price_cents = v_last_unit_price_cents");
  });

  it("allows branch-scoped reads while keeping all writes server-side", () => {
    expect(migration).toContain("branch_scoped_product_read");
    expect(migration).toContain("public.app_user_branch_access");
    expect(migration).toContain("page_access.page_slug = 'produtos'");
    expect(migration).toMatch(
      /revoke all on table[\s\S]*public\.app_products[\s\S]*from public, anon, authenticated;/
    );
    expect(migration).toMatch(
      /revoke execute on function public\.upsert_fluig_product_history\([\s\S]*from public, anon, authenticated;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.upsert_fluig_product_history\([\s\S]*to service_role;/
    );
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i);
  });

  it("creates a private product image bucket with client writes denied", () => {
    expect(migration).toContain("'product-images'");
    expect(migration).toMatch(/'product-images',\s*'product-images',\s*false/);
    expect(migration).toContain("authenticated_read_product_images");
    expect(migration).toContain("product.image_path = storage.objects.name");
    expect(migration).toContain("deny_client_product_image_insert");
    expect(migration).toContain("deny_client_product_image_update");
    expect(migration).toContain("deny_client_product_image_delete");
    expect(migration).toContain("on storage.objects as restrictive");
    expect(migration).toContain("with check (bucket_id <> 'product-images')");
  });
});
