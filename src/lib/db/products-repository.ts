import type { SupabaseClient } from "@supabase/supabase-js";
import { AppAuthError, type AppActor } from "@/lib/db/app-repository";
import {
  buildProductDedupeKey,
  buildProductSku,
  extractProductsFromFluigRequest,
  formFieldsFromProductPayload,
  normalizeProductName,
  type JsonRecord,
  type ProductItemType,
  type ProductStatus,
} from "@/lib/products";
import {
  createProductImageSignedUrls,
  removeProductImageObjects,
  uploadProductImageObject,
} from "@/lib/supabase/product-storage";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

const PRODUCT_SELECT = [
  "id",
  "sku",
  "name",
  "normalized_name",
  "dedupe_key",
  "description",
  "specification",
  "item_type",
  "classification",
  "classification_source",
  "category",
  "category_code",
  "category_label",
  "category_ref:app_product_categories!app_products_category_fkey(id,code,label,active)",
  "material_type",
  "material_type_ref:app_product_material_types!app_products_material_type_fkey(id,code,label,active)",
  "unit",
  "status",
  "source_system",
  "sync_status",
  "sync_error",
  "classification_confidence",
  "review_required",
  "image_path",
  "image_url",
  "product_url",
  "first_fluig_request_id",
  "last_fluig_request_id",
  "occurrence_count",
  "last_unit_price_cents",
  "first_seen_at",
  "last_seen_at",
  "last_synced_at",
  "metadata",
  "created_by_user_id",
  "updated_by_user_id",
  "created_at",
  "updated_at",
  "deleted_at",
].join(",");

const OCCURRENCE_SELECT = [
  "id",
  "product_id",
  "fluig_request_id",
  "request:fluig_requests!app_product_occurrences_fluig_request_id_fkey(fluig_request_id)",
  "source_table",
  "source_row_index",
  "source_dedupe_key",
  "source_sku",
  "source_name",
  "source_description",
  "source_specification",
  "source_category_code",
  "source_category_label",
  "source_material_type_label",
  "source_unit",
  "branch_id",
  "branch_code",
  "branch_label",
  "quantity",
  "unit_price_cents",
  "total_price_cents",
  "currency_code",
  "price_effective_at",
  "observed_at",
  "source_payload",
  "imported_at",
  "updated_at",
].join(",");

type CatalogReference = {
  id: string;
  code: string | null;
  label: string;
  active: boolean;
};

type ProductDbRow = {
  id: string;
  sku: string | null;
  name: string;
  normalized_name: string;
  dedupe_key: string;
  description: string | null;
  specification: string | null;
  item_type: ProductItemType;
  classification: ProductItemType;
  classification_source: string;
  category: string | null;
  category_code: string | null;
  category_label: string | null;
  category_ref: CatalogReference | null;
  material_type: string | null;
  material_type_ref: CatalogReference | null;
  unit: string | null;
  status: ProductStatus;
  source_system: string;
  sync_status: string;
  sync_error: string | null;
  classification_confidence: number | string;
  review_required: boolean;
  image_path: string | null;
  image_url: string | null;
  product_url: string | null;
  first_fluig_request_id: string | null;
  last_fluig_request_id: string | null;
  occurrence_count: number | string;
  last_unit_price_cents: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
  metadata: JsonRecord | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ProductOccurrenceDbRow = {
  id: string;
  product_id: string;
  fluig_request_id: string;
  request: { fluig_request_id: string | null } | null;
  source_table: string;
  source_row_index: number;
  source_dedupe_key: string;
  source_sku: string | null;
  source_name: string;
  source_description: string | null;
  source_specification: string | null;
  source_category_code: string | null;
  source_category_label: string | null;
  source_material_type_label: string | null;
  source_unit: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_label: string | null;
  quantity: string | number | null;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  currency_code: string;
  price_effective_at: string | null;
  observed_at: string;
  source_payload: JsonRecord | null;
  imported_at: string;
  updated_at: string;
};

type FluigProductRequestDbRow = {
  id: string;
  fluig_request_id: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_label: string | null;
  raw_payload: JsonRecord | null;
  opened_at: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
};

export type ProductCreateInput = {
  sku?: string | null;
  name: string;
  description?: string | null;
  specification?: string | null;
  itemType?: ProductItemType;
  categoryId?: string | null;
  materialTypeId?: string | null;
  unit?: string | null;
  status?: ProductStatus;
  productUrl?: string | null;
};

export type ProductPatchInput = {
  itemType?: ProductItemType;
  categoryId?: string | null;
  materialTypeId?: string | null;
  status?: ProductStatus;
  productUrl?: string | null;
};

export type ProductListInput = {
  page?: number;
  pageSize?: number;
  search?: string | null;
  itemType?: ProductItemType | null;
  categoryId?: string | null;
  categoryCode?: string | null;
  materialTypeId?: string | null;
  unit?: string | null;
  status?: ProductStatus | null;
};

function assertServiceClient(): SupabaseClient {
  const client = getSupabaseServiceClient();
  if (!client) {
    const missing = getSupabaseServiceStatus().missing.join(", ");
    throw new Error(`Supabase service role nao configurado. Faltando: ${missing}`);
  }
  return client;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function upperText(value: unknown) {
  return cleanText(value)?.toUpperCase() || null;
}

function chunksOf<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function escapeSearch(value: string) {
  return value.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function mapOccurrence(row: ProductOccurrenceDbRow) {
  return {
    id: row.id,
    productId: row.product_id,
    fluigRequestRowId: row.fluig_request_id,
    fluigRequestId: row.request?.fluig_request_id || null,
    sourceTable: row.source_table,
    sourceRowIndex: row.source_row_index,
    sourceDedupeKey: row.source_dedupe_key,
    sourceSku: row.source_sku,
    sourceName: row.source_name,
    description: row.source_description,
    specification: row.source_specification,
    categoryCode: row.source_category_code,
    categoryLabel: row.source_category_label,
    materialTypeLabel: row.source_material_type_label,
    unit: row.source_unit,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    quantity: row.quantity == null ? null : String(row.quantity),
    unitPriceCents: row.unit_price_cents,
    totalPriceCents: row.total_price_cents,
    currencyCode: row.currency_code,
    priceEffectiveAt: row.price_effective_at,
    observedAt: row.observed_at,
    sourcePayload: row.source_payload || {},
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row: ProductDbRow, signedImageUrl: string | null, occurrences?: ProductOccurrenceDbRow[]) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    normalizedName: row.normalized_name,
    dedupeKey: row.dedupe_key,
    description: row.description,
    specification: row.specification,
    itemType: row.item_type,
    classification: row.classification,
    classificationSource: row.classification_source,
    categoryId: row.category,
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    category: row.category_ref,
    materialTypeId: row.material_type,
    materialType: row.material_type_ref,
    unit: row.unit,
    status: row.status,
    sourceSystem: row.source_system,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    classificationConfidence: Number(row.classification_confidence || 0),
    reviewRequired: row.review_required,
    imagePath: row.image_path,
    imageUrl: signedImageUrl,
    signedImageUrl,
    productUrl: row.product_url,
    firstFluigRequestRowId: row.first_fluig_request_id,
    lastFluigRequestRowId: row.last_fluig_request_id,
    occurrenceCount: Number(row.occurrence_count || 0),
    lastUnitPriceCents: row.last_unit_price_cents,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSyncedAt: row.last_synced_at,
    metadata: row.metadata || {},
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    ...(occurrences ? { occurrences: occurrences.map(mapOccurrence) } : {}),
  };
}

async function mapProductsWithSignedImages(rows: ProductDbRow[]) {
  const signedByPath = await createProductImageSignedUrls(
    rows.map((row) => row.image_path).filter((path): path is string => Boolean(path))
  );
  return rows.map((row) => mapProduct(row, row.image_path ? signedByPath.get(row.image_path) || null : null));
}

async function accessibleProductIds(client: SupabaseClient, actor: AppActor) {
  if (actor.isAdmin) return null;
  const ids = new Set<string>();
  const branches = actor.branches.filter((branch) => branch.active);
  for (const batch of chunksOf(branches.map((branch) => branch.id).filter(Boolean), 100)) {
    const { data, error } = await client.from("app_product_occurrences").select("product_id").in("branch_id", batch);
    if (error) throw error;
    for (const row of data || []) if (row.product_id) ids.add(String(row.product_id));
  }
  for (const batch of chunksOf(branches.map((branch) => branch.code).filter(Boolean), 100)) {
    const { data, error } = await client
      .from("app_product_occurrences")
      .select("product_id")
      .is("branch_id", null)
      .in("branch_code", batch);
    if (error) throw error;
    for (const row of data || []) if (row.product_id) ids.add(String(row.product_id));
  }
  return ids;
}

function applyProductScope<T>(query: T, actor: AppActor, visibleIds: Set<string> | null) {
  if (actor.isAdmin) return query;
  const scoped = query as T & { eq(column: string, value: unknown): T; or(filter: string): T };
  const ids = Array.from(visibleIds || []);
  return ids.length
    ? scoped.or(`created_by_user_id.eq.${actor.id},id.in.(${ids.join(",")})`)
    : scoped.eq("created_by_user_id", actor.id);
}

async function assertProductScope(
  client: SupabaseClient,
  actor: AppActor,
  productId: string,
  options: { includeDeleted?: boolean } = {}
) {
  const visibleIds = await accessibleProductIds(client, actor);
  let query = client.from("app_products").select(PRODUCT_SELECT).eq("id", productId);
  if (!options.includeDeleted) query = query.is("deleted_at", null);
  query = applyProductScope(query, actor, visibleIds);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new AppAuthError("Produto nao encontrado ou fora das filiais permitidas.", 404, "PRODUCT_NOT_FOUND");
  }
  return data as unknown as ProductDbRow;
}

export async function listProducts(actor: AppActor, input: ProductListInput = {}) {
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 25), 1), 100);
  const from = (page - 1) * pageSize;
  const visibleIds = await accessibleProductIds(client, actor);
  let query = client
    .from("app_products")
    .select(PRODUCT_SELECT, { count: "exact" })
    .is("deleted_at", null)
    .order("name", { ascending: true });
  query = applyProductScope(query, actor, visibleIds);

  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${escapeSearch(search)}%`;
    query = query.or(
      [
        `sku.ilike.${pattern}`,
        `name.ilike.${pattern}`,
        `description.ilike.${pattern}`,
        `specification.ilike.${pattern}`,
        `category_code.ilike.${pattern}`,
        `category_label.ilike.${pattern}`,
      ].join(",")
    );
  }
  if (input.itemType) query = query.eq("item_type", input.itemType);
  if (input.categoryId) query = query.eq("category", input.categoryId);
  if (input.categoryCode) query = query.eq("category_code", input.categoryCode);
  if (input.materialTypeId) query = query.eq("material_type", input.materialTypeId);
  if (input.unit) query = query.eq("unit", input.unit);
  if (input.status) query = query.eq("status", input.status);

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;
  const items = await mapProductsWithSignedImages((data || []) as unknown as ProductDbRow[]);
  return { page, pageSize, total: count || 0, items };
}

export async function readProduct(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const row = await assertProductScope(client, actor, id);
  let occurrenceQuery = client
    .from("app_product_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("product_id", id)
    .order("observed_at", { ascending: false })
    .limit(100);
  if (!actor.isAdmin && row.created_by_user_id !== actor.id) {
    const branches = actor.branches.filter((branch) => branch.active);
    const branchIds = branches.map((branch) => branch.id).filter(Boolean);
    const branchCodes = branches.map((branch) => branch.code).filter(Boolean);
    const filters = [
      branchIds.length ? `branch_id.in.(${branchIds.join(",")})` : "",
      branchCodes.length ? `branch_code.in.(${branchCodes.join(",")})` : "",
    ].filter(Boolean);
    occurrenceQuery = filters.length ? occurrenceQuery.or(filters.join(",")) : occurrenceQuery.eq("product_id", "__none__");
  }
  const { data: occurrences, error } = await occurrenceQuery;
  if (error) throw error;
  const signedByPath = await createProductImageSignedUrls(row.image_path ? [row.image_path] : []);
  return mapProduct(
    row,
    row.image_path ? signedByPath.get(row.image_path) || null : null,
    (occurrences || []) as unknown as ProductOccurrenceDbRow[]
  );
}

async function readCatalogReference(client: SupabaseClient, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data, error } = await client.from(table).select("id,code,label,active").eq("id", id).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Referencia de catalogo nao encontrada ou inativa.");
  return data as CatalogReference;
}

export async function createProduct(actor: AppActor, input: ProductCreateInput) {
  const client = assertServiceClient();
  const name = cleanText(input.name);
  if (!name) throw new Error("Nome do produto e obrigatorio.");
  const specification = cleanText(input.specification);
  const itemType = input.itemType || "INDEFINIDO";
  const dedupeKey = buildProductDedupeKey(name, specification);
  const [category, materialType] = await Promise.all([
    readCatalogReference(client, "app_product_categories", input.categoryId),
    readCatalogReference(client, "app_product_material_types", input.materialTypeId),
  ]);
  const status = input.status || "REVIEW";
  const now = new Date().toISOString();
  const payload = {
    sku: upperText(input.sku) || buildProductSku(dedupeKey).replace("FLG-", "PRD-"),
    name,
    normalized_name: normalizeProductName(name),
    dedupe_key: dedupeKey,
    description: cleanText(input.description) || name,
    specification,
    item_type: itemType,
    classification: itemType,
    classification_source: "MANUAL",
    category: category?.id || null,
    category_code: category?.code || null,
    category_label: category?.label || null,
    material_type: materialType?.id || null,
    unit: upperText(input.unit),
    status,
    source_system: "LOCAL",
    sync_status: "SYNCED",
    classification_confidence: 1,
    review_required: status === "REVIEW" || itemType === "INDEFINIDO",
    product_url: cleanText(input.productUrl),
    metadata: {},
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await client.from("app_products").insert(payload).select(PRODUCT_SELECT).single();
  if (error) throw error;
  return mapProduct(data as unknown as ProductDbRow, null, []);
}

export async function updateProduct(actor: AppActor, id: string, input: ProductPatchInput) {
  const client = assertServiceClient();
  const current = await assertProductScope(client, actor, id, { includeDeleted: true });
  const payload: Record<string, unknown> = {
    updated_by_user_id: actor.id,
    updated_at: new Date().toISOString(),
  };
  if (input.itemType !== undefined && input.itemType !== current.item_type) {
    payload.item_type = input.itemType;
    payload.classification = input.itemType;
    payload.classification_source = "MANUAL";
    payload.classification_confidence = 1;
    payload.review_required = input.itemType === "INDEFINIDO";
  }
  if (input.categoryId !== undefined) {
    const category = await readCatalogReference(client, "app_product_categories", input.categoryId);
    payload.category = category?.id || null;
    payload.category_code = category?.code || null;
    payload.category_label = category?.label || null;
  }
  if (input.materialTypeId !== undefined) {
    const materialType = await readCatalogReference(client, "app_product_material_types", input.materialTypeId);
    payload.material_type = materialType?.id || null;
  }
  if (input.productUrl !== undefined) payload.product_url = cleanText(input.productUrl);
  if (input.status !== undefined) {
    payload.status = input.status;
    payload.review_required = input.status === "REVIEW" || (input.itemType || current.item_type) === "INDEFINIDO";
    if (input.status !== "INACTIVE") payload.deleted_at = null;
  }
  const { error } = await client.from("app_products").update(payload).eq("id", id);
  if (error) throw error;
  return readProduct(actor, id);
}

export async function deleteProduct(actor: AppActor, id: string) {
  const client = assertServiceClient();
  await assertProductScope(client, actor, id);
  const now = new Date().toISOString();
  const { error } = await client
    .from("app_products")
    .update({ status: "INACTIVE", deleted_at: now, updated_at: now, updated_by_user_id: actor.id })
    .eq("id", id);
  if (error) throw error;
  return { id, deletedAt: now, status: "INACTIVE" as const };
}

export async function uploadProductImage(
  actor: AppActor,
  id: string,
  file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
  const client = assertServiceClient();
  const current = await assertProductScope(client, actor, id);
  const uploaded = await uploadProductImageObject({
    productId: id,
    originalName: file.name,
    declaredMimeType: file.type,
    size: file.size,
    bytes: file.bytes,
  });
  const { error } = await client
    .from("app_products")
    .update({
      image_path: uploaded.path,
      image_url: uploaded.canonicalUrl,
      updated_by_user_id: actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    await removeProductImageObjects([uploaded.path]).catch(() => undefined);
    throw error;
  }
  if (current.image_path && current.image_path !== uploaded.path) {
    await removeProductImageObjects([current.image_path]).catch(() => undefined);
  }
  return readProduct(actor, id);
}

async function loadFluigProductRequests(client: SupabaseClient, requestIds?: string[] | null) {
  const rows: FluigProductRequestDbRow[] = [];
  const pageSize = 1000;

  if (requestIds) {
    const uniqueRequestIds = Array.from(
      new Set(requestIds.map((requestId) => cleanText(requestId)).filter((requestId): requestId is string => Boolean(requestId)))
    );
    for (const batch of chunksOf(uniqueRequestIds, 200)) {
      const { data, error } = await client
        .from("fluig_requests")
        .select("id,fluig_request_id,branch_id,branch_code,branch_label,raw_payload,opened_at,last_synced_at,updated_at")
        .eq("module_slug", "compras")
        .in("fluig_request_id", batch)
        .order("id", { ascending: true });
      if (error) throw error;
      rows.push(...((data || []) as unknown as FluigProductRequestDbRow[]));
    }
    return rows;
  }

  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from("fluig_requests")
      .select("id,fluig_request_id,branch_id,branch_code,branch_label,raw_payload,opened_at,last_synced_at,updated_at")
      .eq("module_slug", "compras")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as unknown as FluigProductRequestDbRow[]));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function persistProductsFromFluigRequests(
  client: SupabaseClient,
  actorId: string,
  requests: FluigProductRequestDbRow[]
) {
  const occurrences = requests.flatMap((request) => {
    const fluigRequestId = cleanText(request.fluig_request_id);
    if (!fluigRequestId) return [];
    return extractProductsFromFluigRequest({
      fluigRequestId,
      fluigRequestRowId: request.id,
      branchId: request.branch_id,
      branchCode: request.branch_code,
      branchLabel: request.branch_label,
      observedAt: request.opened_at || request.last_synced_at || request.updated_at,
      formFields: formFieldsFromProductPayload(request.raw_payload),
    });
  });

  for (const batch of chunksOf(occurrences, 20)) {
    await Promise.all(
      batch.map(async (occurrence) => {
        const quantity = occurrence.quantity == null ? null : Number(occurrence.quantity);
        const totalPriceCents =
          quantity != null && Number.isFinite(quantity) && occurrence.unitPriceCents != null
            ? Math.round(quantity * occurrence.unitPriceCents)
            : null;
        const { error } = await client.rpc("upsert_fluig_product_history", {
          p_module_slug: "compras",
          p_fluig_request_number: occurrence.fluigRequestId,
          p_source_table: occurrence.sourceTable,
          p_source_row_index: occurrence.sourceRowIndex,
          p_dedupe_key: occurrence.dedupeKey,
          p_name: occurrence.name,
          p_item_type: occurrence.itemType,
          p_sku: occurrence.sku,
          p_description: occurrence.description,
          p_specification: occurrence.specification,
          p_category_code: occurrence.categoryCode,
          p_category_label: occurrence.categoryLabel,
          p_material_type_label: occurrence.materialTypeLabel,
          p_unit: occurrence.unit,
          p_quantity: quantity,
          p_unit_price_cents: occurrence.unitPriceCents,
          p_total_price_cents: totalPriceCents,
          p_currency_code: "BRL",
          p_price_effective_at: occurrence.observedAt,
          p_status: "REVIEW",
          p_sync_status: "SYNCED",
          p_classification_confidence: occurrence.classificationConfidence,
          p_classification_source: occurrence.classificationSource,
          p_review_required: occurrence.reviewRequired,
          p_source_payload: occurrence.sourcePayload,
          p_metadata: { extractionVersion: "products-v1" },
          p_actor_user_id: actorId,
        });
        if (error) throw error;
      })
    );
  }

  return {
    requestsScanned: requests.length,
    requestsWithProducts: new Set(occurrences.map((item) => item.fluigRequestId)).size,
    products: new Set(occurrences.map((item) => `${item.itemType}:${item.dedupeKey}`)).size,
    occurrences: occurrences.length,
  };
}

export async function syncProductsFromFluigHistoryRequestIds(actorId: string, requestIds: string[]) {
  const client = assertServiceClient();
  const requests = await loadFluigProductRequests(client, requestIds);
  return persistProductsFromFluigRequests(client, actorId, requests);
}

export async function syncProductsFromFluigHistory(actor: AppActor) {
  if (!actor.isAdmin) {
    throw new AppAuthError("Somente administradores podem sincronizar o historico de produtos.", 403, "ADMIN_REQUIRED");
  }
  const client = assertServiceClient();
  const requests = await loadFluigProductRequests(client);
  return persistProductsFromFluigRequests(client, actor.id, requests);
}

export async function listProductCatalogs(actor: AppActor) {
  const client = assertServiceClient();
  const visibleIds = await accessibleProductIds(client, actor);
  let productQuery = client
    .from("app_products")
    .select("id,unit")
    .is("deleted_at", null)
    .neq("status", "INACTIVE")
    .order("unit", { ascending: true });
  productQuery = applyProductScope(productQuery, actor, visibleIds);
  const [categoriesResult, materialTypesResult, productsResult] = await Promise.all([
    client
      .from("app_product_categories")
      .select("id,code,label")
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    client
      .from("app_product_material_types")
      .select("id,code,label")
      .eq("active", true)
      .is("deleted_at", null)
      .order("label", { ascending: true }),
    productQuery.range(0, 4999),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (materialTypesResult.error) throw materialTypesResult.error;
  if (productsResult.error) throw productsResult.error;
  const units = Array.from(
    new Set(
      (productsResult.data || [])
        .map((row) => cleanText(row.unit))
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
  return {
    categories: categoriesResult.data || [],
    materialTypes: materialTypesResult.data || [],
    units,
  };
}
