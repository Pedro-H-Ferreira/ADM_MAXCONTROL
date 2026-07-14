import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AppAuthError,
  canActorAccessPage,
  canActorPerformPageAction,
  type AppActor,
} from "@/lib/db/app-repository";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

export const maintenanceActions = [
  "VIEW",
  "CREATE_ORDER",
  "EDIT_ORDER",
  "CHANGE_STATUS",
  "FINISH_ORDER",
  "APPROVE_COMPLETION",
  "VIEW_COSTS",
  "MANAGE_ASSETS",
  "RETIRE_ASSET",
  "MANAGE_STOCK",
  "MOVE_STOCK",
  "ADJUST_STOCK",
  "APPROVE_ADJUSTMENT",
  "EXECUTE_INVENTORY",
  "APPROVE_INVENTORY",
  "MANAGE_PREVENTIVE_PLANS",
  "SYNC_FLUIG",
  "VIEW_TECHNICAL_LOGS",
] as const;

export type MaintenanceAction = (typeof maintenanceActions)[number];
type JsonRecord = Record<string, unknown>;

const createActions = new Set<MaintenanceAction>(["CREATE_ORDER"]);
const approveActions = new Set<MaintenanceAction>([
  "FINISH_ORDER",
  "APPROVE_COMPLETION",
  "RETIRE_ASSET",
  "ADJUST_STOCK",
  "APPROVE_ADJUSTMENT",
  "APPROVE_INVENTORY",
]);

function assertClient(): SupabaseClient {
  const client = getSupabaseServiceClient();
  if (!client) {
    throw new Error(`Supabase service role nao configurado. Faltando: ${getSupabaseServiceStatus().missing.join(", ")}`);
  }
  return client;
}

function cleanText(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function escapeSearch(value: string) {
  return value.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function pageSize(value: unknown) {
  const parsed = Number(value || 20);
  return ([20, 50, 100] as const).includes(parsed as 20 | 50 | 100) ? parsed : 20;
}

function actorBranchIds(actor: AppActor) {
  return actor.branches.filter((branch) => branch.active).map((branch) => branch.id);
}

function assertBranch(actor: AppActor, branchId: string) {
  if (actor.isAdmin || actorBranchIds(actor).includes(branchId)) return;
  throw new AppAuthError("Usuario sem acesso a filial informada.", 403, "MAINTENANCE_BRANCH_DENIED");
}

function fallbackActionAllowed(actor: AppActor, action: MaintenanceAction) {
  if (actor.isAdmin) return true;
  if (action === "VIEW") return canActorAccessPage(actor, "manutencao");
  const pageAction = createActions.has(action) ? "canCreate" : approveActions.has(action) ? "canApprove" : "canUpdate";
  return canActorPerformPageAction(actor, "manutencao", pageAction);
}

export async function readMaintenanceCapabilities(actor: AppActor) {
  if (!canActorAccessPage(actor, "manutencao")) {
    return Object.fromEntries(maintenanceActions.map((action) => [action, false])) as Record<MaintenanceAction, boolean>;
  }
  if (actor.isAdmin) {
    return Object.fromEntries(maintenanceActions.map((action) => [action, true])) as Record<MaintenanceAction, boolean>;
  }

  const client = assertClient();
  const { data, error } = await client
    .from("app_maintenance_user_permissions")
    .select("action,allowed")
    .eq("user_id", actor.id);
  if (error) throw error;
  const overrides = new Map((data || []).map((row) => [String(row.action), Boolean(row.allowed)]));
  return Object.fromEntries(
    maintenanceActions.map((action) => [action, overrides.has(action) ? overrides.get(action)! : fallbackActionAllowed(actor, action)])
  ) as Record<MaintenanceAction, boolean>;
}

export async function assertMaintenanceAction(actor: AppActor, action: MaintenanceAction) {
  const capabilities = await readMaintenanceCapabilities(actor);
  if (!capabilities[action]) {
    throw new AppAuthError("Usuario sem permissao para esta acao de manutencao.", 403, "MAINTENANCE_ACTION_DENIED");
  }
  return capabilities;
}

export async function readMaintenanceDomainDashboard(actor: AppActor) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const branches = actorBranchIds(actor);
  const scopedBranches = branches.length ? branches : ["00000000-0000-0000-0000-000000000000"];
  let assets = client.from("app_maintenance_assets").select("id", { count: "exact", head: true }).is("deleted_at", null);
  let assetsStopped = client
    .from("app_maintenance_assets")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["EM_MANUTENCAO", "PARADO", "AGUARDANDO_PECA", "AGUARDANDO_TERCEIRO"]);
  let ordersOpen = client
    .from("app_maintenance_orders")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .not("status", "in", "(FINALIZADA,CANCELADA)");
  let plansDue = client
    .from("app_maintenance_preventive_plans")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("active", true)
    .lte("next_due_at", new Date().toISOString());
  let inventoriesOpen = client
    .from("app_maintenance_inventory_counts")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(APPROVED,CANCELLED)");
  if (!actor.isAdmin) {
    assets = assets.in("branch_id", scopedBranches);
    assetsStopped = assetsStopped.in("branch_id", scopedBranches);
    ordersOpen = ordersOpen.in("branch_id", scopedBranches);
    plansDue = plansDue.in("branch_id", scopedBranches);
    inventoriesOpen = inventoriesOpen.in("branch_id", scopedBranches);
  }
  const [assetResult, stoppedResult, orderResult, planResult, inventoryResult, capabilities] = await Promise.all([
    assets,
    assetsStopped,
    ordersOpen,
    plansDue,
    inventoriesOpen,
    readMaintenanceCapabilities(actor),
  ]);
  const error = [assetResult, stoppedResult, orderResult, planResult, inventoryResult].map((result) => result.error).find(Boolean);
  if (error) throw error;
  return {
    counts: {
      assets: assetResult.count || 0,
      assetsStopped: stoppedResult.count || 0,
      ordersOpen: orderResult.count || 0,
      plansDue: planResult.count || 0,
      inventoriesOpen: inventoryResult.count || 0,
    },
    capabilities,
    branches: actor.branches,
  };
}

const assetSelect = [
  "id,internal_code,asset_tag,name,category_id,subcategory,brand,model,serial_number,description,branch_id,area,physical_location,cost_center_code,cost_center_label,responsible_user_id,responsible_name,status,criticality,acquired_at,acquisition_value_cents,supplier_id,invoice_number,commissioned_at,warranty_months,warranty_ends_at,useful_life_months,qr_code,barcode,meter_type,current_meter,last_maintenance_at,next_maintenance_at,notes,retired_at,retirement_reason,created_at,updated_at",
  "category:app_maintenance_asset_categories(id,code,name)",
  "branch:app_branches(id,code,name,fluig_label)",
  "supplier:app_suppliers(id,nome_fantasia,razao_social,cnpj)",
].join(",");

export async function listMaintenanceAssets(actor: AppActor, input: {
  page?: number;
  pageSize?: number;
  search?: string | null;
  branchId?: string | null;
  status?: string | null;
  criticality?: string | null;
  categoryId?: string | null;
} = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const currentPage = Math.max(1, Number(input.page || 1));
  const size = pageSize(input.pageSize);
  const from = (currentPage - 1) * size;
  let query = client
    .from("app_maintenance_assets")
    .select(assetSelect, { count: "exact" })
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (!actor.isAdmin) query = query.in("branch_id", actorBranchIds(actor));
  if (input.branchId) {
    assertBranch(actor, input.branchId);
    query = query.eq("branch_id", input.branchId);
  }
  if (input.status) query = query.eq("status", input.status);
  if (input.criticality) query = query.eq("criticality", input.criticality);
  if (input.categoryId) query = query.eq("category_id", input.categoryId);
  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${escapeSearch(search)}%`;
    query = query.or(`internal_code.ilike.${pattern},asset_tag.ilike.${pattern},name.ilike.${pattern},model.ilike.${pattern},serial_number.ilike.${pattern},physical_location.ilike.${pattern}`);
  }
  const [pageResult, categoryResult, capabilities] = await Promise.all([
    query.range(from, from + size - 1),
    client
      .from("app_maintenance_asset_categories")
      .select("id,parent_id,code,name,active")
      .is("deleted_at", null)
      .eq("active", true)
      .order("name"),
    readMaintenanceCapabilities(actor),
  ]);
  if (pageResult.error) throw pageResult.error;
  if (categoryResult.error) throw categoryResult.error;
  return {
    page: currentPage,
    pageSize: size,
    total: pageResult.count || 0,
    items: pageResult.data || [],
    branches: actor.branches,
    categories: categoryResult.data || [],
    capabilities,
  };
}

export async function readMaintenanceAsset(actor: AppActor, id: string) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  let query = client.from("app_maintenance_assets").select(assetSelect).eq("id", id).is("deleted_at", null);
  if (!actor.isAdmin) query = query.in("branch_id", actorBranchIds(actor));
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [events, readings, orders, documents] = await Promise.all([
    client.from("app_maintenance_asset_events").select("id,event_type,label,from_branch_id,to_branch_id,from_area,to_area,event_payload,actor_user_id,created_at").eq("asset_id", id).order("created_at", { ascending: false }).limit(100),
    client.from("app_maintenance_meter_readings").select("id,meter_type,reading,read_at,source,notes,actor_user_id,created_at").eq("asset_id", id).order("read_at", { ascending: false }).limit(100),
    client.from("app_maintenance_orders").select("id,code,title,status,priority,due_at,started_at,finished_at,total_cost_cents,created_at").eq("asset_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    client.from("app_maintenance_asset_documents").select("id,asset_id,document_type,name,bucket,path,mime_type,size_bytes,expires_at,metadata,uploaded_by_user_id,created_at").eq("asset_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
  ]);
  const relatedError = [events, readings, orders, documents].map((result) => result.error).find(Boolean);
  if (relatedError) throw relatedError;
  return {
    ...(data as unknown as JsonRecord),
    events: events.data || [],
    readings: readings.data || [],
    orders: orders.data || [],
    documents: documents.data || [],
  };
}

export async function createMaintenanceAsset(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const client = assertClient();
  const branchId = cleanText(input.branchId);
  if (!branchId) throw new Error("Filial do ativo e obrigatoria.");
  assertBranch(actor, branchId);
  const code = cleanText(input.internalCode);
  const name = cleanText(input.name);
  if (!code || !name) throw new Error("Codigo interno e nome do ativo sao obrigatorios.");
  const payload = {
    internal_code: code,
    asset_tag: cleanText(input.assetTag),
    name,
    category_id: cleanText(input.categoryId),
    subcategory: cleanText(input.subcategory),
    brand: cleanText(input.brand),
    model: cleanText(input.model),
    serial_number: cleanText(input.serialNumber),
    description: cleanText(input.description),
    branch_id: branchId,
    area: cleanText(input.area),
    physical_location: cleanText(input.physicalLocation),
    cost_center_code: cleanText(input.costCenterCode),
    cost_center_label: cleanText(input.costCenterLabel),
    responsible_user_id: cleanText(input.responsibleUserId),
    responsible_name: cleanText(input.responsibleName),
    status: cleanText(input.status) || "ATIVO",
    criticality: cleanText(input.criticality) || "MEDIA",
    acquired_at: cleanText(input.acquiredAt),
    acquisition_value_cents: Number(input.acquisitionValueCents || 0),
    supplier_id: cleanText(input.supplierId),
    invoice_number: cleanText(input.invoiceNumber),
    commissioned_at: cleanText(input.commissionedAt),
    warranty_months: input.warrantyMonths == null ? null : Number(input.warrantyMonths),
    warranty_ends_at: cleanText(input.warrantyEndsAt),
    useful_life_months: input.usefulLifeMonths == null ? null : Number(input.usefulLifeMonths),
    qr_code: cleanText(input.qrCode) || `asset:${code}`,
    barcode: cleanText(input.barcode),
    meter_type: cleanText(input.meterType),
    notes: cleanText(input.notes),
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
  };
  const { data, error } = await client.from("app_maintenance_assets").insert(payload).select(assetSelect).single();
  if (error) throw error;
  const asset = data as unknown as JsonRecord;
  await client.from("app_maintenance_asset_events").insert({ asset_id: asset.id, event_type: "CREATED", label: "Ativo cadastrado", actor_user_id: actor.id });
  return asset;
}

export async function updateMaintenanceAsset(actor: AppActor, id: string, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const current = await readMaintenanceAsset(actor, id);
  if (!current) throw new AppAuthError("Ativo nao encontrado.", 404, "MAINTENANCE_ASSET_NOT_FOUND");
  const branchId = cleanText(input.branchId) || String((current as JsonRecord).branch_id);
  assertBranch(actor, branchId);
  const allowed: Record<string, string> = {
    internalCode: "internal_code", assetTag: "asset_tag", name: "name", categoryId: "category_id",
    subcategory: "subcategory", brand: "brand", model: "model", serialNumber: "serial_number",
    description: "description", area: "area", physicalLocation: "physical_location",
    costCenterCode: "cost_center_code", costCenterLabel: "cost_center_label", responsibleUserId: "responsible_user_id",
    responsibleName: "responsible_name", status: "status", criticality: "criticality", acquiredAt: "acquired_at",
    supplierId: "supplier_id", invoiceNumber: "invoice_number", commissionedAt: "commissioned_at",
    warrantyEndsAt: "warranty_ends_at", qrCode: "qr_code", barcode: "barcode", meterType: "meter_type", notes: "notes",
  };
  const payload: JsonRecord = { branch_id: branchId, updated_by_user_id: actor.id };
  for (const [inputKey, column] of Object.entries(allowed)) if (inputKey in input) payload[column] = cleanText(input[inputKey]);
  if ("acquisitionValueCents" in input) payload.acquisition_value_cents = Number(input.acquisitionValueCents || 0);
  if ("warrantyMonths" in input) payload.warranty_months = input.warrantyMonths == null ? null : Number(input.warrantyMonths);
  if ("usefulLifeMonths" in input) payload.useful_life_months = input.usefulLifeMonths == null ? null : Number(input.usefulLifeMonths);
  const { data, error } = await assertClient().from("app_maintenance_assets").update(payload).eq("id", id).select(assetSelect).single();
  if (error) throw error;
  await assertClient().from("app_maintenance_asset_events").insert({ asset_id: id, event_type: "UPDATED", label: "Cadastro do ativo atualizado", event_payload: { fields: Object.keys(input) }, actor_user_id: actor.id });
  return data;
}

export async function listMaintenanceSupplierOptions(actor: AppActor, search?: string | null) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const branchIds = actorBranchIds(actor);
  const normalizedSearch = cleanText(search);
  const filter = normalizedSearch ? (() => {
    const pattern = `%${escapeSearch(normalizedSearch)}%`;
    const digits = normalizedSearch.replace(/\D/g, "");
    return [
      `razao_social.ilike.${pattern}`,
      `nome_fantasia.ilike.${pattern}`,
      digits ? `cnpj_normalizado.ilike.%${digits}%` : "",
    ].filter(Boolean).join(",");
  })() : null;
  let rows: Array<{ id: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null; status: string }> = [];
  if (actor.isAdmin) {
    let query = client.from("app_suppliers").select("id,razao_social,nome_fantasia,cnpj,status").is("deleted_at", null).in("status", ["ATIVO", "PENDENTE_REVISAO"]).order("razao_social").limit(30);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw error;
    rows = data || [];
  } else {
    if (!branchIds.length) return [];
    let query = client.from("app_suppliers").select("id,razao_social,nome_fantasia,cnpj,status,app_supplier_branch_links!inner(branch_id)").is("deleted_at", null).in("status", ["ATIVO", "PENDENTE_REVISAO"]).in("app_supplier_branch_links.branch_id", branchIds).order("razao_social").limit(30);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw error;
    rows = data || [];
  }
  const seen = new Set<string>();
  return rows.filter((item) => {
    const id = String(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((item) => ({
    id: String(item.id),
    legalName: String(item.razao_social || ""),
    displayName: item.nome_fantasia ? String(item.nome_fantasia) : null,
    taxId: item.cnpj ? String(item.cnpj) : null,
    status: item.status,
  }));
}

export async function addMaintenanceAssetDocument(actor: AppActor, assetId: string, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const asset = await readMaintenanceAsset(actor, assetId);
  if (!asset) throw new AppAuthError("Ativo nao encontrado.", 404, "MAINTENANCE_ASSET_NOT_FOUND");
  const { data, error } = await assertClient().from("app_maintenance_asset_documents").insert({
    asset_id: assetId,
    document_type: cleanText(input.documentType) || "OTHER",
    name: cleanText(input.name),
    bucket: cleanText(input.bucket),
    path: cleanText(input.path),
    mime_type: cleanText(input.mimeType),
    size_bytes: input.sizeBytes == null ? null : Number(input.sizeBytes),
    expires_at: cleanText(input.expiresAt),
    uploaded_by_user_id: actor.id,
  }).select("id,asset_id,document_type,name,bucket,path,mime_type,size_bytes,expires_at,created_at").single();
  if (error) throw error;
  await assertClient().from("app_maintenance_asset_events").insert({ asset_id: assetId, event_type: "DOCUMENT_ADDED", label: `Documento adicionado: ${data.name}`, actor_user_id: actor.id });
  return data;
}

export async function removeMaintenanceAssetDocument(actor: AppActor, assetId: string, documentId: string) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const asset = await readMaintenanceAsset(actor, assetId);
  if (!asset) throw new AppAuthError("Ativo nao encontrado.", 404, "MAINTENANCE_ASSET_NOT_FOUND");
  const { data, error } = await assertClient()
    .from("app_maintenance_asset_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("asset_id", assetId)
    .is("deleted_at", null)
    .select("id,name,bucket,path")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Documento nao encontrado.", 404, "MAINTENANCE_DOCUMENT_NOT_FOUND");
  await assertClient().from("app_maintenance_asset_events").insert({ asset_id: assetId, event_type: "DOCUMENT_REMOVED", label: `Documento removido: ${data.name}`, actor_user_id: actor.id });
  return data;
}

export async function runMaintenanceAssetAction(actor: AppActor, id: string, input: JsonRecord) {
  const action = cleanText(input.action)?.toUpperCase();
  const asset = await readMaintenanceAsset(actor, id);
  if (!asset) throw new AppAuthError("Ativo nao encontrado.", 404, "MAINTENANCE_ASSET_NOT_FOUND");
  const client = assertClient();
  if (action === "TRANSFER") {
    await assertMaintenanceAction(actor, "MANAGE_ASSETS");
    const branchId = cleanText(input.branchId);
    if (!branchId) throw new Error("Filial de destino obrigatoria.");
    assertBranch(actor, branchId);
    const { data, error } = await client.rpc("app_maintenance_transfer_asset", {
      p_asset_id: id,
      p_to_branch_id: branchId,
      p_to_area: cleanText(input.area),
      p_to_location: cleanText(input.physicalLocation),
      p_to_responsible_user_id: cleanText(input.responsibleUserId),
      p_actor_user_id: actor.id,
      p_reason: cleanText(input.reason),
    });
    if (error) throw error;
    return data;
  }
  if (action === "RETIRE") {
    await assertMaintenanceAction(actor, "RETIRE_ASSET");
    const { data, error } = await client.rpc("app_maintenance_retire_asset", { p_asset_id: id, p_actor_user_id: actor.id, p_reason: cleanText(input.reason) });
    if (error) throw error;
    return data;
  }
  if (action === "METER") {
    await assertMaintenanceAction(actor, "MANAGE_ASSETS");
    const { data, error } = await client.rpc("app_maintenance_record_meter", {
      p_asset_id: id,
      p_meter_type: cleanText(input.meterType),
      p_reading: Number(input.reading),
      p_read_at: cleanText(input.readAt) || new Date().toISOString(),
      p_actor_user_id: actor.id,
      p_notes: cleanText(input.notes),
    });
    if (error) throw error;
    return { readingId: data };
  }
  throw new Error("Acao de ativo invalida.");
}

async function allowedStockContext(client: SupabaseClient, actor: AppActor) {
  let warehouseQuery = client.from("app_maintenance_warehouses").select("*,branch:app_branches(id,code,name,fluig_label)").is("deleted_at", null).eq("active", true).order("name");
  if (!actor.isAdmin) warehouseQuery = warehouseQuery.in("branch_id", actorBranchIds(actor));
  const { data: warehouses, error } = await warehouseQuery;
  if (error) throw error;
  const warehouseIds = (warehouses || []).map((warehouse) => String(warehouse.id));
  const { data: locations, error: locationError } = warehouseIds.length
    ? await client.from("app_maintenance_storage_locations").select("*").in("warehouse_id", warehouseIds).is("deleted_at", null).eq("active", true).order("code")
    : { data: [], error: null };
  if (locationError) throw locationError;
  return { warehouses: warehouses || [], locations: locations || [], locationIds: (locations || []).map((location) => String(location.id)) };
}

export async function listMaintenanceMaterials(actor: AppActor, input: { page?: number; pageSize?: number; search?: string | null; active?: boolean | null } = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const currentPage = Math.max(1, Number(input.page || 1));
  const size = pageSize(input.pageSize);
  const from = (currentPage - 1) * size;
  let query = client.from("app_maintenance_materials").select("*", { count: "exact" }).is("deleted_at", null).order("name");
  if (input.active != null) query = query.eq("active", input.active);
  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${escapeSearch(search)}%`;
    query = query.or(`code.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern},name.ilike.${pattern},description.ilike.${pattern},category.ilike.${pattern}`);
  }
  const [{ data, count, error }, context] = await Promise.all([query.range(from, from + size - 1), allowedStockContext(client, actor)]);
  if (error) throw error;
  const materialIds = (data || []).map((material) => String(material.id));
  const { data: balances, error: balanceError } = materialIds.length && context.locationIds.length
    ? await client.from("app_maintenance_stock_balances").select("*").in("material_id", materialIds).in("location_id", context.locationIds)
    : { data: [], error: null };
  if (balanceError) throw balanceError;
  const balanceByMaterial = new Map<string, typeof balances>();
  for (const balance of balances || []) balanceByMaterial.set(String(balance.material_id), [...(balanceByMaterial.get(String(balance.material_id)) || []), balance]);
  const items = (data || []).map((material) => {
    const materialBalances = balanceByMaterial.get(String(material.id)) || [];
    const totals = materialBalances.reduce((sum, balance) => ({
      onHand: sum.onHand + Number(balance.quantity_on_hand || 0),
      reserved: sum.reserved + Number(balance.quantity_reserved || 0),
      blocked: sum.blocked + Number(balance.quantity_blocked || 0),
      inTransit: sum.inTransit + Number(balance.quantity_in_transit || 0),
    }), { onHand: 0, reserved: 0, blocked: 0, inTransit: 0 });
    return { ...material, balances: materialBalances, totals: { ...totals, available: totals.onHand - totals.reserved - totals.blocked } };
  });
  return {
    page: currentPage,
    pageSize: size,
    total: count || 0,
    items,
    warehouses: context.warehouses,
    locations: context.locations,
    capabilities: await readMaintenanceCapabilities(actor),
  };
}

export async function createMaintenanceMaterial(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_STOCK");
  const code = cleanText(input.code);
  const name = cleanText(input.name);
  if (!code || !name) throw new Error("Codigo e nome do material sao obrigatorios.");
  const payload = {
    code,
    sku: cleanText(input.sku),
    barcode: cleanText(input.barcode),
    name,
    description: cleanText(input.description),
    category: cleanText(input.category),
    unit: cleanText(input.unit) || "UN",
    brand: cleanText(input.brand),
    model: cleanText(input.model),
    primary_supplier_id: cleanText(input.primarySupplierId),
    average_cost_cents: Number(input.averageCostCents || 0),
    last_cost_cents: Number(input.lastCostCents || 0),
    minimum_stock: Number(input.minimumStock || 0),
    maximum_stock: input.maximumStock == null ? null : Number(input.maximumStock),
    reorder_point: Number(input.reorderPoint || 0),
    lead_time_days: Number(input.leadTimeDays || 0),
    active: input.active !== false,
    lot_control: Boolean(input.lotControl),
    expiry_control: Boolean(input.expiryControl),
    serial_control: Boolean(input.serialControl),
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
  };
  const { data, error } = await assertClient().from("app_maintenance_materials").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateMaintenanceMaterial(actor: AppActor, id: string, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_STOCK");
  const allowed: Record<string, string> = {
    code: "code", sku: "sku", barcode: "barcode", name: "name", description: "description",
    category: "category", unit: "unit", brand: "brand", model: "model", primarySupplierId: "primary_supplier_id",
  };
  const payload: JsonRecord = { updated_by_user_id: actor.id };
  for (const [inputKey, column] of Object.entries(allowed)) {
    if (inputKey in input) payload[column] = cleanText(input[inputKey]);
  }
  for (const [inputKey, column] of Object.entries({
    averageCostCents: "average_cost_cents", lastCostCents: "last_cost_cents", minimumStock: "minimum_stock",
    maximumStock: "maximum_stock", reorderPoint: "reorder_point", leadTimeDays: "lead_time_days",
  })) {
    if (inputKey in input) payload[column] = input[inputKey] == null ? null : Number(input[inputKey]);
  }
  for (const [inputKey, column] of Object.entries({ active: "active", lotControl: "lot_control", expiryControl: "expiry_control", serialControl: "serial_control" })) {
    if (inputKey in input) payload[column] = Boolean(input[inputKey]);
  }
  const { data, error } = await assertClient()
    .from("app_maintenance_materials")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Material nao encontrado.", 404, "MAINTENANCE_MATERIAL_NOT_FOUND");
  return data;
}

async function assertLocationAccess(actor: AppActor, locationId: string | null) {
  if (!locationId) return;
  const client = assertClient();
  let query = client.from("app_maintenance_storage_locations").select("id,warehouse:app_maintenance_warehouses!inner(branch_id)").eq("id", locationId).is("deleted_at", null);
  if (!actor.isAdmin) query = query.in("warehouse.branch_id", actorBranchIds(actor));
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Local de estoque fora das filiais permitidas.", 403, "MAINTENANCE_LOCATION_DENIED");
}

export async function runMaintenanceStockAction(actor: AppActor, input: JsonRecord) {
  const action = cleanText(input.action)?.toUpperCase();
  const client = assertClient();
  if (action === "MOVE") {
    await assertMaintenanceAction(actor, cleanText(input.movementType)?.includes("ADJUST") || ["LOSS", "DAMAGE", "WRITE_OFF"].includes(cleanText(input.movementType) || "") ? "ADJUST_STOCK" : "MOVE_STOCK");
    const fromLocationId = cleanText(input.fromLocationId);
    const toLocationId = cleanText(input.toLocationId);
    await Promise.all([assertLocationAccess(actor, fromLocationId), assertLocationAccess(actor, toLocationId)]);
    const { data, error } = await client.rpc("app_maintenance_post_stock_movement", {
      p_movement_type: cleanText(input.movementType),
      p_material_id: cleanText(input.materialId),
      p_quantity: Number(input.quantity),
      p_from_location_id: fromLocationId,
      p_to_location_id: toLocationId,
      p_work_order_id: cleanText(input.workOrderId),
      p_asset_id: cleanText(input.assetId),
      p_inventory_count_id: cleanText(input.inventoryCountId),
      p_unit_cost_cents: Number(input.unitCostCents || 0),
      p_actor_user_id: actor.id,
      p_reason: cleanText(input.reason),
      p_document_number: cleanText(input.documentNumber),
      p_notes: cleanText(input.notes),
      p_allow_negative: false,
    });
    if (error) throw error;
    return { movementId: data };
  }
  if (action === "RESERVE") {
    await assertMaintenanceAction(actor, "MOVE_STOCK");
    const locationId = cleanText(input.locationId);
    if (!locationId) throw new Error("Local de estoque obrigatorio.");
    await assertLocationAccess(actor, locationId);
    const { data, error } = await client.rpc("app_maintenance_reserve_stock", { p_order_id: cleanText(input.orderId), p_material_id: cleanText(input.materialId), p_location_id: locationId, p_quantity: Number(input.quantity), p_actor_user_id: actor.id });
    if (error) throw error;
    return { reservationId: data };
  }
  if (action === "CONSUME") {
    await assertMaintenanceAction(actor, "MOVE_STOCK");
    const { data, error } = await client.rpc("app_maintenance_consume_reservation", { p_reservation_id: cleanText(input.reservationId), p_quantity: Number(input.quantity), p_unit_cost_cents: Number(input.unitCostCents || 0), p_actor_user_id: actor.id });
    if (error) throw error;
    return { movementId: data };
  }
  if (action === "RELEASE") {
    await assertMaintenanceAction(actor, "MOVE_STOCK");
    const { data, error } = await client.rpc("app_maintenance_release_reservation", { p_reservation_id: cleanText(input.reservationId), p_quantity: input.quantity == null ? null : Number(input.quantity), p_actor_user_id: actor.id, p_reason: cleanText(input.reason) });
    if (error) throw error;
    return { releasedQuantity: data };
  }
  if (action === "RETURN_CONSUMPTION") {
    await assertMaintenanceAction(actor, "MOVE_STOCK");
    const locationId = cleanText(input.locationId);
    if (!locationId) throw new Error("Local de devolucao obrigatorio.");
    await assertLocationAccess(actor, locationId);
    const { data, error } = await client.rpc("app_maintenance_return_order_material", {
      p_order_material_id: cleanText(input.orderMaterialId),
      p_to_location_id: locationId,
      p_quantity: Number(input.quantity),
      p_actor_user_id: actor.id,
      p_reason: cleanText(input.reason),
    });
    if (error) throw error;
    return { movementId: data };
  }
  throw new Error("Acao de estoque invalida.");
}

export async function listMaintenanceStockMovements(actor: AppActor, input: {
  page?: number;
  pageSize?: number;
  search?: string | null;
  branchId?: string | null;
  movementType?: string | null;
  from?: string | null;
  to?: string | null;
} = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const currentPage = Math.max(1, Number(input.page || 1));
  const size = pageSize(input.pageSize);
  const fromIndex = (currentPage - 1) * size;
  const context = await allowedStockContext(client, actor);
  if (input.branchId) assertBranch(actor, input.branchId);
  const allowedWarehouseIds = new Set(
    context.warehouses
      .filter((warehouse) => !input.branchId || String(warehouse.branch_id) === input.branchId)
      .map((warehouse) => String(warehouse.id))
  );
  const locationIds = context.locations
    .filter((location) => allowedWarehouseIds.has(String(location.warehouse_id)))
    .map((location) => String(location.id));
  let query = client
    .from("app_maintenance_stock_movements")
    .select("id,movement_type,material_id,quantity,unit,from_location_id,to_location_id,work_order_id,document_number,unit_cost_cents,total_cost_cents,reason,notes,actor_user_id,occurred_at,material:app_maintenance_materials(id,code,name,sku),from_location:app_maintenance_storage_locations!app_maintenance_stock_movements_from_location_id_fkey(id,code,warehouse_id),to_location:app_maintenance_storage_locations!app_maintenance_stock_movements_to_location_id_fkey(id,code,warehouse_id),order:app_maintenance_orders(id,code,title),actor:app_user_profiles(id,display_name,email)", { count: "exact" })
    .order("occurred_at", { ascending: false });
  if (!actor.isAdmin || input.branchId) {
    if (!locationIds.length) return { page: currentPage, pageSize: size, total: 0, items: [], branches: actor.branches, capabilities: await readMaintenanceCapabilities(actor) };
    query = query.or(`from_location_id.in.(${locationIds.join(",")}),to_location_id.in.(${locationIds.join(",")})`);
  }
  if (input.movementType) query = query.eq("movement_type", input.movementType);
  if (input.from) query = query.gte("occurred_at", input.from);
  if (input.to) query = query.lte("occurred_at", input.to);
  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${escapeSearch(search)}%`;
    const { data: matchingMaterials, error: materialError } = await client
      .from("app_maintenance_materials")
      .select("id")
      .or(`code.ilike.${pattern},sku.ilike.${pattern},name.ilike.${pattern}`)
      .limit(200);
    if (materialError) throw materialError;
    const materialIds = (matchingMaterials || []).map((material) => String(material.id));
    query = materialIds.length
      ? query.or(`material_id.in.(${materialIds.join(",")}),document_number.ilike.${pattern},reason.ilike.${pattern}`)
      : query.or(`document_number.ilike.${pattern},reason.ilike.${pattern}`);
  }
  const [{ data, count, error }, capabilities] = await Promise.all([
    query.range(fromIndex, fromIndex + size - 1),
    readMaintenanceCapabilities(actor),
  ]);
  if (error) throw error;
  return { page: currentPage, pageSize: size, total: count || 0, items: data || [], branches: actor.branches.filter((branch) => branch.active), capabilities };
}

export async function listMaintenanceCalendar(actor: AppActor, input: { branchId?: string | null; from: string; to: string }) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  if (input.branchId) assertBranch(actor, input.branchId);
  const branchIds = input.branchId ? [input.branchId] : actorBranchIds(actor);
  let orderQuery = client
    .from("app_maintenance_orders")
    .select("id,code,title,status,priority,work_type,branch_id,due_at,asset:app_maintenance_assets(id,internal_code,name),branch:app_branches(id,code,name)")
    .is("deleted_at", null)
    .not("due_at", "is", null)
    .gte("due_at", input.from)
    .lte("due_at", input.to)
    .order("due_at")
    .limit(1000);
  let planQuery = client
    .from("app_maintenance_preventive_plans")
    .select("id,code,name,priority,branch_id,next_due_at,recurrence_unit,recurrence_value,branch:app_branches(id,code,name)")
    .is("deleted_at", null)
    .eq("active", true)
    .not("next_due_at", "is", null)
    .gte("next_due_at", input.from)
    .lte("next_due_at", input.to)
    .order("next_due_at")
    .limit(1000);
  if (!actor.isAdmin || input.branchId) {
    const scope = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
    orderQuery = orderQuery.in("branch_id", scope);
    planQuery = planQuery.in("branch_id", scope);
  }
  const [orders, plans, capabilities] = await Promise.all([orderQuery, planQuery, readMaintenanceCapabilities(actor)]);
  if (orders.error) throw orders.error;
  if (plans.error) throw plans.error;
  const entries = [
    ...(orders.data || []).map((order) => ({ type: "ORDER", date: order.due_at, ...order })),
    ...(plans.data || []).map((plan) => ({ type: "PREVENTIVE", date: plan.next_due_at, ...plan })),
  ].sort((left, right) => Date.parse(String(left.date)) - Date.parse(String(right.date)));
  return { entries, branches: actor.branches.filter((branch) => branch.active), capabilities };
}

export async function listMaintenanceServiceProviders(actor: AppActor, input: { page?: number; pageSize?: number; search?: string | null; active?: boolean | null } = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const currentPage = Math.max(1, Number(input.page || 1));
  const size = pageSize(input.pageSize);
  const fromIndex = (currentPage - 1) * size;
  let query = assertClient()
    .from("app_maintenance_service_providers")
    .select("id,supplier_id,name,tax_id,contact_name,email,phone,specialties,sla_minutes,active,created_at,updated_at,supplier:app_suppliers(id,nome_fantasia,razao_social,cnpj)", { count: "exact" })
    .is("deleted_at", null)
    .order("name");
  if (input.active != null) query = query.eq("active", input.active);
  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${escapeSearch(search)}%`;
    query = query.or(`name.ilike.${pattern},tax_id.ilike.${pattern},contact_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }
  const [{ data, count, error }, capabilities] = await Promise.all([query.range(fromIndex, fromIndex + size - 1), readMaintenanceCapabilities(actor)]);
  if (error) throw error;
  return { page: currentPage, pageSize: size, total: count || 0, items: data || [], capabilities };
}

export async function createMaintenanceServiceProvider(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const { data, error } = await assertClient().from("app_maintenance_service_providers").insert({
    supplier_id: cleanText(input.supplierId), name: cleanText(input.name), tax_id: cleanText(input.taxId),
    contact_name: cleanText(input.contactName), email: cleanText(input.email), phone: cleanText(input.phone),
    specialties: Array.isArray(input.specialties) ? input.specialties.map(String) : [],
    sla_minutes: input.slaMinutes == null ? null : Number(input.slaMinutes), active: input.active !== false,
    created_by_user_id: actor.id, updated_by_user_id: actor.id,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateMaintenanceServiceProvider(actor: AppActor, id: string, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_ASSETS");
  const map: Record<string, string> = { supplierId: "supplier_id", name: "name", taxId: "tax_id", contactName: "contact_name", email: "email", phone: "phone" };
  const payload: JsonRecord = { updated_by_user_id: actor.id };
  for (const [key, column] of Object.entries(map)) if (key in input) payload[column] = cleanText(input[key]);
  if ("specialties" in input) payload.specialties = Array.isArray(input.specialties) ? input.specialties.map(String) : [];
  if ("slaMinutes" in input) payload.sla_minutes = input.slaMinutes == null ? null : Number(input.slaMinutes);
  if ("active" in input) payload.active = Boolean(input.active);
  const { data, error } = await assertClient().from("app_maintenance_service_providers").update(payload).eq("id", id).is("deleted_at", null).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Prestador nao encontrado.", 404, "MAINTENANCE_PROVIDER_NOT_FOUND");
  return data;
}

export async function readMaintenanceSettings(actor: AppActor) {
  await assertMaintenanceAction(actor, "VIEW");
  const context = await allowedStockContext(assertClient(), actor);
  return { warehouses: context.warehouses, locations: context.locations, branches: actor.branches.filter((branch) => branch.active), capabilities: await readMaintenanceCapabilities(actor) };
}

export async function updateMaintenanceWarehouse(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_STOCK");
  const warehouseId = cleanText(input.warehouseId);
  if (!warehouseId) throw new Error("Almoxarifado invalido.");
  let currentQuery = assertClient().from("app_maintenance_warehouses").select("id,branch_id").eq("id", warehouseId).is("deleted_at", null);
  if (!actor.isAdmin) currentQuery = currentQuery.in("branch_id", actorBranchIds(actor));
  const { data: current, error: currentError } = await currentQuery.maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new AppAuthError("Almoxarifado fora das filiais permitidas.", 403, "MAINTENANCE_WAREHOUSE_DENIED");
  const payload: JsonRecord = { updated_by_user_id: actor.id };
  if ("name" in input) payload.name = cleanText(input.name);
  if ("active" in input) payload.active = Boolean(input.active);
  if ("allowNegativeStock" in input) payload.allow_negative_stock = Boolean(input.allowNegativeStock);
  if ("requireApprovalForAdjustment" in input) payload.require_approval_for_adjustment = Boolean(input.requireApprovalForAdjustment);
  const { data, error } = await assertClient().from("app_maintenance_warehouses").update(payload).eq("id", warehouseId).select("*").single();
  if (error) throw error;
  return data;
}

export async function readMaintenanceReport(actor: AppActor, input: { branchId?: string | null; from: string; to: string }) {
  await assertMaintenanceAction(actor, "VIEW");
  if (input.branchId) assertBranch(actor, input.branchId);
  const branchIds = input.branchId ? [input.branchId] : actor.isAdmin ? null : actorBranchIds(actor);
  const { data, error } = await assertClient().rpc("app_maintenance_report_summary", {
    p_branch_ids: branchIds,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) throw error;
  return { report: data || {}, branches: actor.branches.filter((branch) => branch.active), capabilities: await readMaintenanceCapabilities(actor) };
}

export async function listMaintenancePreventivePlans(actor: AppActor) {
  await assertMaintenanceAction(actor, "VIEW");
  const branchIds = actorBranchIds(actor);
  let query = assertClient()
    .from("app_maintenance_preventive_plans")
    .select("*,assets:app_maintenance_preventive_plan_assets(asset:app_maintenance_assets(id,internal_code,name,branch_id,status,current_meter)),tasks:app_maintenance_preventive_plan_tasks(*),materials:app_maintenance_preventive_plan_materials(*,material:app_maintenance_materials(id,code,name,unit))")
    .is("deleted_at", null)
    .order("next_due_at", { ascending: true, nullsFirst: false });
  if (!actor.isAdmin) query = query.in("branch_id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data, error }, capabilities] = await Promise.all([query, readMaintenanceCapabilities(actor)]);
  if (error) throw error;
  return {
    plans: data || [],
    branches: actor.branches.filter((branch) => branch.active),
    capabilities,
  };
}

export async function createMaintenancePreventivePlan(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_PREVENTIVE_PLANS");
  const client = assertClient();
  const assetIds = Array.isArray(input.assetIds) ? input.assetIds.map(String) : [];
  if (!assetIds.length) throw new Error("Vincule pelo menos um ativo ao plano.");
  let assetQuery = client.from("app_maintenance_assets").select("id,branch_id").in("id", assetIds).is("deleted_at", null);
  if (!actor.isAdmin) assetQuery = assetQuery.in("branch_id", actorBranchIds(actor));
  const { data: assets, error: assetError } = await assetQuery;
  if (assetError) throw assetError;
  if ((assets || []).length !== assetIds.length) throw new AppAuthError("Um ou mais ativos estao fora das filiais permitidas.", 403, "MAINTENANCE_ASSET_SCOPE_DENIED");
  const branchId = cleanText(input.branchId);
  if (branchId) assertBranch(actor, branchId);
  const { data: plan, error } = await client.from("app_maintenance_preventive_plans").insert({
    code: cleanText(input.code), name: cleanText(input.name), description: cleanText(input.description), branch_id: branchId,
    checklist_template_id: cleanText(input.checklistTemplateId), recurrence_value: Number(input.recurrenceValue), recurrence_unit: cleanText(input.recurrenceUnit),
    expected_minutes: input.expectedMinutes == null ? null : Number(input.expectedMinutes), responsible_user_id: cleanText(input.responsibleUserId),
    responsible_name: cleanText(input.responsibleName), service_provider_id: cleanText(input.serviceProviderId), priority: cleanText(input.priority) || "MEDIA",
    tolerance_before: Number(input.toleranceBefore || 0), tolerance_after: Number(input.toleranceAfter || 0), auto_generate_order: input.autoGenerateOrder !== false,
    generation_lead_days: Number(input.generationLeadDays || 0), next_due_at: cleanText(input.nextDueAt), next_meter_value: input.nextMeterValue == null ? null : Number(input.nextMeterValue),
    notify_before_days: Number(input.notifyBeforeDays || 7), evidence_required: Boolean(input.evidenceRequired), completion_approval_required: Boolean(input.completionApprovalRequired),
    created_by_user_id: actor.id, updated_by_user_id: actor.id,
  }).select("*").single();
  if (error) throw error;
  const childResults = await Promise.all([
    client.from("app_maintenance_preventive_plan_assets").insert(assetIds.map((assetId) => ({ plan_id: plan.id, asset_id: assetId }))),
    Array.isArray(input.tasks) && input.tasks.length
      ? client.from("app_maintenance_preventive_plan_tasks").insert(input.tasks.map((task, index) => ({ plan_id: plan.id, position: index + 1, title: cleanText((task as JsonRecord).title), description: cleanText((task as JsonRecord).description), expected_minutes: Number((task as JsonRecord).expectedMinutes || 0), required: (task as JsonRecord).required !== false, evidence_required: Boolean((task as JsonRecord).evidenceRequired) })))
      : Promise.resolve({ error: null }),
    Array.isArray(input.materials) && input.materials.length
      ? client.from("app_maintenance_preventive_plan_materials").insert(input.materials.map((material) => ({ plan_id: plan.id, material_id: cleanText((material as JsonRecord).materialId), planned_quantity: Number((material as JsonRecord).quantity), notes: cleanText((material as JsonRecord).notes) })))
      : Promise.resolve({ error: null }),
  ]);
  const childError = childResults.map((result) => result.error).find(Boolean);
  if (childError) {
    await client.from("app_maintenance_preventive_plans").delete().eq("id", plan.id);
    throw childError;
  }
  return plan;
}

export async function updateMaintenancePreventivePlan(actor: AppActor, id: string, input: JsonRecord) {
  await assertMaintenanceAction(actor, "MANAGE_PREVENTIVE_PLANS");
  const client = assertClient();
  let currentQuery = client.from("app_maintenance_preventive_plans").select("id,branch_id").eq("id", id).is("deleted_at", null);
  if (!actor.isAdmin) currentQuery = currentQuery.in("branch_id", actorBranchIds(actor));
  const { data: current, error: currentError } = await currentQuery.maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new AppAuthError("Plano preventivo nao encontrado.", 404, "MAINTENANCE_PREVENTIVE_NOT_FOUND");
  const branchId = cleanText(input.branchId);
  if (branchId) assertBranch(actor, branchId);
  const assetIds = Array.isArray(input.assetIds) ? input.assetIds.map(String) : [];
  if (!assetIds.length) throw new Error("Vincule pelo menos um ativo ao plano.");
  let assetQuery = client.from("app_maintenance_assets").select("id,branch_id").in("id", assetIds).is("deleted_at", null);
  if (!actor.isAdmin) assetQuery = assetQuery.in("branch_id", actorBranchIds(actor));
  if (branchId) assetQuery = assetQuery.eq("branch_id", branchId);
  const { data: assets, error: assetError } = await assetQuery;
  if (assetError) throw assetError;
  if ((assets || []).length !== assetIds.length) throw new AppAuthError("Um ou mais ativos estao fora da filial permitida.", 403, "MAINTENANCE_ASSET_SCOPE_DENIED");
  const { data, error } = await client.rpc("app_maintenance_update_preventive_plan", { p_plan_id: id, p_data: input, p_actor_user_id: actor.id });
  if (error) throw error;
  return { id: data };
}

export async function setMaintenancePreventivePlanActive(actor: AppActor, id: string, active: boolean) {
  await assertMaintenanceAction(actor, "MANAGE_PREVENTIVE_PLANS");
  let query = assertClient().from("app_maintenance_preventive_plans").update({ active, updated_by_user_id: actor.id }).eq("id", id).is("deleted_at", null);
  if (!actor.isAdmin) query = query.in("branch_id", actorBranchIds(actor));
  const { data, error } = await query.select("id,active").maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Plano preventivo nao encontrado.", 404, "MAINTENANCE_PREVENTIVE_NOT_FOUND");
  return data;
}

export async function generateMaintenancePreventiveOrders(actor: AppActor) {
  await assertMaintenanceAction(actor, "MANAGE_PREVENTIVE_PLANS");
  const { data, error } = await assertClient().rpc("app_maintenance_generate_preventive_orders", { p_now: new Date().toISOString() });
  if (error) throw error;
  return data || [];
}

export async function listMaintenanceInventories(actor: AppActor, input: {
  page?: number;
  pageSize?: number;
  branchId?: string | null;
  inventoryType?: string | null;
  status?: string | null;
} = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertClient();
  const currentPage = Math.max(1, Number(input.page || 1));
  const currentPageSize = pageSize(input.pageSize);
  const from = (currentPage - 1) * currentPageSize;
  const branchIds = actorBranchIds(actor);
  const scopedBranchIds = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
  const branchId = cleanText(input.branchId);
  if (branchId) assertBranch(actor, branchId);

  let inventoryQuery = client
    .from("app_maintenance_inventory_counts")
    .select("*,branch:app_branches(id,code,name),warehouse:app_maintenance_warehouses(id,code,name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + currentPageSize - 1);
  let warehouseQuery = client
    .from("app_maintenance_warehouses")
    .select("id,branch_id,code,name,active,branch:app_branches(id,code,name)")
    .is("deleted_at", null)
    .eq("active", true)
    .order("code");
  if (!actor.isAdmin) {
    inventoryQuery = inventoryQuery.in("branch_id", scopedBranchIds);
    warehouseQuery = warehouseQuery.in("branch_id", scopedBranchIds);
  }
  if (branchId) inventoryQuery = inventoryQuery.eq("branch_id", branchId);
  if (branchId) warehouseQuery = warehouseQuery.eq("branch_id", branchId);
  if (cleanText(input.inventoryType)) inventoryQuery = inventoryQuery.eq("inventory_type", cleanText(input.inventoryType)!);
  if (cleanText(input.status)) inventoryQuery = inventoryQuery.eq("status", cleanText(input.status)!);

  const [inventoryResult, warehouseResult, capabilities] = await Promise.all([
    inventoryQuery,
    warehouseQuery,
    readMaintenanceCapabilities(actor),
  ]);
  const error = inventoryResult.error || warehouseResult.error;
  if (error) throw error;
  return {
    items: inventoryResult.data || [],
    total: inventoryResult.count || 0,
    page: currentPage,
    pageSize: currentPageSize,
    branches: actor.branches.filter((branch) => branch.active),
    warehouses: warehouseResult.data || [],
    capabilities,
  };
}

export async function createMaintenanceInventory(actor: AppActor, input: JsonRecord) {
  await assertMaintenanceAction(actor, "EXECUTE_INVENTORY");
  const client = assertClient();
  const branchId = cleanText(input.branchId);
  if (!branchId) throw new Error("Filial do inventario e obrigatoria.");
  assertBranch(actor, branchId);
  const inventoryType = cleanText(input.inventoryType)?.toUpperCase();
  if (inventoryType !== "MATERIAL" && inventoryType !== "ASSET") throw new Error("Tipo de inventario invalido.");
  const warehouseId = cleanText(input.warehouseId);
  let inventoryItems: Array<Record<string, unknown>> = [];
  if (inventoryType === "MATERIAL") {
    if (!warehouseId) throw new Error("Almoxarifado obrigatorio para inventario de materiais.");
    const { data: warehouse, error: warehouseError } = await client
      .from("app_maintenance_warehouses")
      .select("id")
      .eq("id", warehouseId)
      .eq("branch_id", branchId)
      .is("deleted_at", null)
      .eq("active", true)
      .maybeSingle();
    if (warehouseError || !warehouse) throw warehouseError || new Error("Almoxarifado fora da filial.");
    const { data: locations, error: locationError } = await client
      .from("app_maintenance_storage_locations")
      .select("id")
      .eq("warehouse_id", warehouseId)
      .is("deleted_at", null)
      .eq("active", true);
    if (locationError) throw locationError;
    const locationIds = (locations || []).map((location) => String(location.id));
    if (!locationIds.length) throw new Error("O almoxarifado nao possui local de armazenagem ativo.");
    const { data: balances, error: balanceError } = await client
      .from("app_maintenance_stock_balances")
      .select("material_id,location_id,quantity_on_hand")
      .in("location_id", locationIds);
    if (balanceError) throw balanceError;
    inventoryItems = (balances || []).map((balance) => ({
      material_id: balance.material_id,
      location_id: balance.location_id,
      reference_quantity: balance.quantity_on_hand,
    }));
  } else {
    let assetQuery = client
      .from("app_maintenance_assets")
      .select("id,physical_location")
      .eq("branch_id", branchId)
      .is("deleted_at", null)
      .neq("status", "BAIXADO");
    if (cleanText(input.area)) assetQuery = assetQuery.eq("area", cleanText(input.area)!);
    const { data: assets, error: assetError } = await assetQuery;
    if (assetError) throw assetError;
    inventoryItems = (assets || []).map((asset) => ({ asset_id: asset.id, found_location: asset.physical_location }));
  }
  const code = `INV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: inventory, error } = await client.from("app_maintenance_inventory_counts").insert({
    code, inventory_type: inventoryType, branch_id: branchId, warehouse_id: warehouseId, area: cleanText(input.area),
    status: "COUNTING", reference_frozen_at: new Date().toISOString(), started_at: new Date().toISOString(),
    notes: cleanText(input.notes), created_by_user_id: actor.id, updated_by_user_id: actor.id,
  }).select("*").single();
  if (error) throw error;
  if (inventoryItems.length) {
    const { error: itemError } = await client
      .from("app_maintenance_inventory_items")
      .insert(inventoryItems.map((item) => ({ ...item, inventory_count_id: inventory.id })));
    if (itemError) {
      await client.from("app_maintenance_inventory_counts").delete().eq("id", inventory.id);
      throw itemError;
    }
  }
  return inventory;
}

export async function readMaintenanceInventory(actor: AppActor, id: string, input: { page?: number; pageSize?: number } = {}) {
  await assertMaintenanceAction(actor, "VIEW");
  const currentPage = Math.max(1, Number(input.page || 1));
  const currentPageSize = pageSize(input.pageSize);
  const from = (currentPage - 1) * currentPageSize;
  let query = assertClient().from("app_maintenance_inventory_counts").select("*,branch:app_branches(id,code,name),warehouse:app_maintenance_warehouses(id,code,name)").eq("id", id);
  if (!actor.isAdmin) query = query.in("branch_id", actorBranchIds(actor));
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: items, error: itemError, count } = await assertClient()
    .from("app_maintenance_inventory_items")
    .select("*,material:app_maintenance_materials(id,code,name,unit),asset:app_maintenance_assets(id,internal_code,asset_tag,name,physical_location,status)", { count: "exact" })
    .eq("inventory_count_id", id)
    .order("created_at")
    .range(from, from + currentPageSize - 1);
  if (itemError) throw itemError;
  return {
    ...data,
    items: items || [],
    itemTotal: count || 0,
    itemPage: currentPage,
    itemPageSize: currentPageSize,
  };
}

export async function runMaintenanceInventoryAction(actor: AppActor, id: string, input: JsonRecord) {
  const inventory = await readMaintenanceInventory(actor, id, { page: 1, pageSize: 20 });
  if (!inventory) throw new AppAuthError("Inventario nao encontrado.", 404, "MAINTENANCE_INVENTORY_NOT_FOUND");
  const action = cleanText(input.action)?.toUpperCase();
  const client = assertClient();
  if (action === "COUNT_ITEM") {
    await assertMaintenanceAction(actor, "EXECUTE_INVENTORY");
    const itemId = cleanText(input.itemId);
    const round = Number(input.round || 1);
    const payload = inventory.inventory_type === "MATERIAL"
      ? round === 2
        ? { second_count_quantity: Number(input.quantity), second_counter_user_id: actor.id, second_counted_at: new Date().toISOString(), justification: cleanText(input.justification) }
        : { first_count_quantity: Number(input.quantity), first_counter_user_id: actor.id, first_counted_at: new Date().toISOString(), justification: cleanText(input.justification) }
      : { asset_found: Boolean(input.found), found_location: cleanText(input.foundLocation), condition: cleanText(input.condition), photo_path: cleanText(input.photoPath), justification: cleanText(input.justification) };
    const { data, error } = await client.from("app_maintenance_inventory_items").update(payload).eq("id", itemId).eq("inventory_count_id", id).select("*").single();
    if (error) throw error;
    return data;
  }
  if (action === "SUBMIT") {
    await assertMaintenanceAction(actor, "EXECUTE_INVENTORY");
    if (!inventory.itemTotal) throw new Error("O inventario nao possui itens para conferencia.");
    let incompleteQuery = client
      .from("app_maintenance_inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("inventory_count_id", id);
    incompleteQuery = inventory.inventory_type === "MATERIAL"
      ? incompleteQuery.is("first_count_quantity", null)
      : incompleteQuery.is("asset_found", null);
    const { count: incompleteCount, error: incompleteError } = await incompleteQuery;
    if (incompleteError) throw incompleteError;
    if (incompleteCount) throw new Error(`Conclua a conferencia de ${incompleteCount} item(ns) antes de enviar.`);
    const { data, error } = await client.from("app_maintenance_inventory_counts").update({ status: "SUBMITTED", submitted_at: new Date().toISOString(), updated_by_user_id: actor.id }).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  }
  if (action === "APPROVE") {
    await assertMaintenanceAction(actor, "APPROVE_INVENTORY");
    const { data, error } = await client.rpc("app_maintenance_approve_inventory", { p_inventory_id: id, p_actor_user_id: actor.id });
    if (error) throw error;
    return data;
  }
  throw new Error("Acao de inventario invalida.");
}
