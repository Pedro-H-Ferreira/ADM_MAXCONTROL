import crypto from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { FluigModuleSlug } from "@/lib/fluig-data";
import {
  allNavigationPageSlugs,
  getDefaultPageSlugsForRole,
  isKnownNavigationPage,
  navigationPageOptions,
} from "@/lib/navigation";

type JsonRecord = Record<string, unknown>;
type JsonComparable = JsonRecord | unknown[] | string | number | boolean | null;

export type AppRole =
  | "ADMIN_MASTER"
  | "ADMIN"
  | "ADMINISTRATIVO"
  | "GERENTE_CD"
  | "FINANCEIRO"
  | "COMPRAS"
  | "MANUTENCAO"
  | "LEITURA";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AppBranch = {
  id: string;
  code: string;
  name: string;
  fluigLabel: string | null;
  active: boolean;
};

export type AppUserProfile = {
  id: string;
  authUserId: string | null;
  email: string | null;
  displayName: string;
  role: AppRole;
  fluigUsername: string | null;
  fluigUserId: string | null;
  homeBranchId: string | null;
  active: boolean;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
};

export type AppActor = AppUserProfile & {
  isAdmin: boolean;
  branches: AppBranch[];
  branchCodes: string[];
  pageSlugs: string[];
};

export type AppUserPageAccess = {
  pageSlug: string;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
};

export type FluigJobStatus =
  | "queued"
  | "agent_claimed"
  | "authenticating"
  | "opening_fluig"
  | "reading_page"
  | "filling_form"
  | "submitting"
  | "waiting_protocol"
  | "syncing_result"
  | "success"
  | "error"
  | "cancelled"
  | "expired";

export type FluigJobOperation =
  | "sync_history"
  | "sync_status"
  | "open_from_source"
  | "cancel_request"
  | "health_check"
  | "sync_initial_history"
  | "sync_user_open_tasks"
  | "sync_user_open_requests"
  | "sync_user_incremental_batch"
  | "sync_request_by_number"
  | "supplier_lookup_by_cnpj";

export type FluigUserSyncType = "historical" | "open_tasks" | "my_requests" | "status_check" | "supplier_lookup";

export type FluigJobRecord = {
  id: string;
  requestedByUserId: string;
  assignedAgentId: string | null;
  module: FluigModuleSlug;
  operation: FluigJobOperation;
  status: FluigJobStatus;
  branchCode: string | null;
  branchLabel: string | null;
  fluigUsername: string | null;
  requestPayload: JsonRecord;
  resultPayload: JsonRecord;
  errorMessage: string | null;
  progressStage: string | null;
  progressLabel: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type DbBranchRow = {
  id: string;
  code: string;
  name: string;
  fluig_label: string | null;
  active: boolean;
};

type DbProfileRow = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  display_name: string;
  role: AppRole;
  fluig_username: string | null;
  fluig_user_id: string | null;
  home_branch_id: string | null;
  active: boolean;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
};

type DbJobRow = {
  id: string;
  requested_by_user_id: string;
  assigned_agent_id: string | null;
  module_slug: FluigModuleSlug;
  operation: FluigJobOperation;
  status: FluigJobStatus;
  branch_code: string | null;
  branch_label: string | null;
  fluig_username: string | null;
  request_payload: JsonRecord;
  result_payload: JsonRecord;
  error_message: string | null;
  progress_stage: string | null;
  progress_label: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

type DbSyncStateRow = {
  id: string;
  user_id: string;
  fluig_username: string | null;
  fluig_user_id: string | null;
  module_slug: FluigModuleSlug;
  sync_type: FluigUserSyncType;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  cursor: JsonRecord;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
};

type DbAgentRow = {
  id: string;
  user_id: string;
  display_name: string;
  machine_name: string | null;
  token_prefix: string | null;
  status: string | null;
  local_api_url: string | null;
  agent_version: string | null;
  last_heartbeat_at: string | null;
  paired_at: string | null;
  updated_at: string | null;
};

type DbPageAccessRow = {
  user_id: string;
  page_slug: string;
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_approve: boolean;
};

const adminRoles = new Set<AppRole>(["ADMIN_MASTER", "ADMIN"]);
const fallbackAdminEmail = "admin@adm.local";
const reusableJobStatuses: FluigJobStatus[] = [
  "queued",
  "agent_claimed",
  "authenticating",
  "opening_fluig",
  "reading_page",
  "filling_form",
  "submitting",
  "waiting_protocol",
  "syncing_result",
];
const agentHeartbeatOnlineWindowMs = 2 * 60 * 1000;

export class AppAuthError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AppAuthError";
    this.status = status;
    this.code = code;
  }
}

export function isAppAuthError(error: unknown): error is AppAuthError {
  return error instanceof AppAuthError;
}

function assertServiceClient(): SupabaseClient {
  const client = getSupabaseServiceClient();
  if (!client) {
    const missing = getSupabaseServiceStatus().missing.join(", ");
    throw new Error(`Supabase service role nao configurado. Faltando: ${missing}`);
  }
  return client;
}

function mapBranch(row: DbBranchRow): AppBranch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    fluigLabel: row.fluig_label,
    active: row.active,
  };
}

function mapProfile(row: DbProfileRow): AppUserProfile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    fluigUsername: row.fluig_username,
    fluigUserId: row.fluig_user_id,
    homeBranchId: row.home_branch_id,
    active: row.active,
    approvalStatus: row.approval_status || (row.active ? "APPROVED" : "PENDING"),
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
  };
}

function mapJob(row: DbJobRow): FluigJobRecord {
  return {
    id: row.id,
    requestedByUserId: row.requested_by_user_id,
    assignedAgentId: row.assigned_agent_id,
    module: row.module_slug,
    operation: row.operation,
    status: row.status,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    fluigUsername: row.fluig_username,
    requestPayload: row.request_payload || {},
    resultPayload: row.result_payload || {},
    errorMessage: row.error_message,
    progressStage: row.progress_stage,
    progressLabel: row.progress_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function mapSyncState(row: DbSyncStateRow) {
  return {
    id: row.id,
    userId: row.user_id,
    fluigUsername: row.fluig_username,
    fluigUserId: row.fluig_user_id,
    module: row.module_slug,
    syncType: row.sync_type,
    lastSyncAt: row.last_sync_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    cursor: row.cursor || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function heartbeatAgeSeconds(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function mapAgent(row: DbAgentRow) {
  const ageSeconds = heartbeatAgeSeconds(row.last_heartbeat_at);
  const heartbeatIsFresh = ageSeconds != null && ageSeconds <= agentHeartbeatOnlineWindowMs / 1000;
  const storedStatus = row.status || "offline";
  const status = storedStatus === "online" && !heartbeatIsFresh ? "offline" : storedStatus;

  return {
    ...row,
    status,
    heartbeat_age_seconds: ageSeconds,
    heartbeat_is_stale: storedStatus === "online" && !heartbeatIsFresh,
  };
}

export function isAdminRole(role: AppRole) {
  return adminRoles.has(role);
}

export function canActorAccessPage(actor: Pick<AppActor, "isAdmin" | "pageSlugs">, pageSlug: string) {
  return actor.isAdmin || actor.pageSlugs.includes(pageSlug);
}

function normalizePageSlugs(pageSlugs: string[] | null | undefined) {
  return Array.from(
    new Set(
      ["dashboard", "perfil", ...(pageSlugs || [])]
        .map((pageSlug) => String(pageSlug || "").trim())
        .filter((pageSlug) => pageSlug && isKnownNavigationPage(pageSlug))
    )
  );
}

function defaultPageAccessForRole(role: AppRole): AppUserPageAccess[] {
  return normalizePageSlugs(getDefaultPageSlugsForRole(role)).map((pageSlug) => ({
    pageSlug,
    canView: true,
    canCreate: false,
    canUpdate: false,
    canApprove: false,
  }));
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function normalizeTokenHash(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateAgentToken() {
  return `admfa_${crypto.randomBytes(32).toString("base64url")}`;
}

function normalizeJsonComparable(value: unknown): JsonComparable {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normalizeJsonComparable);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeJsonComparable(entryValue)])
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function stableJsonFingerprint(value: unknown) {
  return JSON.stringify(normalizeJsonComparable(value));
}

async function getAuthUser(): Promise<User | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user || null;
  } catch {
    return null;
  }
}

async function countApprovedAuthAdmins(client: SupabaseClient) {
  const { count, error } = await client
    .from("app_user_profiles")
    .select("id", { count: "exact", head: true })
    .not("auth_user_id", "is", null)
    .in("role", ["ADMIN_MASTER", "ADMIN"])
    .eq("active", true)
    .eq("approval_status", "APPROVED");
  if (error) throw error;
  return count || 0;
}

function displayNameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || localPart;
}

async function ensureProfileForAuthUser(client: SupabaseClient, user: User) {
  const email = normalizeEmail(user.email);
  const displayName =
    String(user.user_metadata?.name || user.user_metadata?.full_name || email || "Usuario ADM").trim() || "Usuario ADM";

  const { data: byAuthUser, error: byAuthError } = await client
    .from("app_user_profiles")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (byAuthError) throw byAuthError;
  if (byAuthUser) return mapProfile(byAuthUser as DbProfileRow);

  if (email) {
    const { data: byEmail, error: byEmailError } = await client
      .from("app_user_profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (byEmailError) throw byEmailError;
    if (byEmail) {
      const { data, error } = await client
        .from("app_user_profiles")
        .update({ auth_user_id: user.id, display_name: displayName, last_seen_at: new Date().toISOString() })
        .eq("id", byEmail.id)
        .select("*")
        .single();
      if (error) throw error;
      return mapProfile(data as DbProfileRow);
    }
  }

  const role: AppRole = (await countApprovedAuthAdmins(client)) === 0 ? "ADMIN_MASTER" : "LEITURA";
  const approved = role === "ADMIN_MASTER";
  const { data, error } = await client
    .from("app_user_profiles")
    .insert({
      auth_user_id: user.id,
      email,
      display_name: displayName,
      role,
      active: approved,
      approval_status: approved ? "APPROVED" : "PENDING",
      approved_at: approved ? new Date().toISOString() : null,
      last_seen_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapProfile(data as DbProfileRow);
}

async function ensureFallbackAdminProfile(client: SupabaseClient) {
  const { data: existing, error: existingError } = await client
    .from("app_user_profiles")
    .select("*")
    .eq("email", fallbackAdminEmail)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return mapProfile(existing as DbProfileRow);

  const { data, error } = await client
    .from("app_user_profiles")
    .insert({
      email: fallbackAdminEmail,
      display_name: "Usuario ADM",
      role: "ADMIN_MASTER",
      fluig_username: "Administrativo CD",
      active: true,
      approval_status: "APPROVED",
      approved_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapProfile(data as DbProfileRow);
}

export async function listBranches(client = assertServiceClient()) {
  const { data, error } = await client
    .from("app_branches")
    .select("id,code,name,fluig_label,active")
    .order("code", { ascending: true });
  if (error) throw error;
  return ((data || []) as DbBranchRow[]).map(mapBranch);
}

async function listActorBranches(client: SupabaseClient, profile: AppUserProfile) {
  if (isAdminRole(profile.role)) {
    return listBranches(client);
  }

  const { data, error } = await client
    .from("app_user_branch_access")
    .select("branch:app_branches(id,code,name,fluig_label,active)")
    .eq("user_id", profile.id)
    .eq("can_view", true);
  if (error) throw error;

  return (data || [])
    .map((row) => {
      const branch = (row as { branch?: DbBranchRow | DbBranchRow[] }).branch;
      return Array.isArray(branch) ? branch[0] : branch;
    })
    .filter(Boolean)
    .map((branch) => mapBranch(branch as DbBranchRow));
}

async function listActorPageSlugs(client: SupabaseClient, profile: AppUserProfile) {
  if (isAdminRole(profile.role)) {
    return allNavigationPageSlugs;
  }

  const { data, error } = await client
    .from("app_user_page_access")
    .select("page_slug")
    .eq("user_id", profile.id)
    .eq("can_view", true);
  if (error) throw error;

  const explicitPages = (data || []).map((row) => String((row as { page_slug?: string }).page_slug || ""));
  return normalizePageSlugs(explicitPages.length ? explicitPages : getDefaultPageSlugsForRole(profile.role));
}

export async function resolveCurrentAppUser(options: { allowFallback?: boolean; requireApproved?: boolean } = {}): Promise<AppActor> {
  const client = assertServiceClient();
  const authUser = await getAuthUser();
  const requireApproved = options.requireApproved !== false;
  const profile = authUser
    ? await ensureProfileForAuthUser(client, authUser)
    : options.allowFallback
      ? await ensureFallbackAdminProfile(client)
      : null;

  if (!profile) {
    throw new AppAuthError("Sessao nao encontrada.", 401, "UNAUTHENTICATED");
  }

  if (requireApproved && (!profile.active || profile.approvalStatus !== "APPROVED")) {
    throw new AppAuthError("Usuario aguardando liberacao do administrador.", 403, profile.approvalStatus);
  }

  const branches = await listActorBranches(client, profile);
  const pageSlugs = await listActorPageSlugs(client, profile);

  return {
    ...profile,
    isAdmin: isAdminRole(profile.role),
    branches,
    branchCodes: branches.map((branch) => branch.code),
    pageSlugs,
  };
}

export async function listUsersWithBranches() {
  const client = assertServiceClient();
  const [branches, profilesResult, accessResult, pageAccessResult] = await Promise.all([
    listBranches(client),
    client.from("app_user_profiles").select("*").order("display_name", { ascending: true }),
    client.from("app_user_branch_access").select("user_id,branch_id,can_view,can_create,is_home"),
    client.from("app_user_page_access").select("user_id,page_slug,can_view,can_create,can_update,can_approve"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (accessResult.error) throw accessResult.error;
  if (pageAccessResult.error) throw pageAccessResult.error;

  const accessByUser = new Map<string, Array<Record<string, unknown>>>();
  for (const row of accessResult.data || []) {
    const userId = String(row.user_id);
    accessByUser.set(userId, [...(accessByUser.get(userId) || []), row as Record<string, unknown>]);
  }

  const pageAccessByUser = new Map<string, DbPageAccessRow[]>();
  for (const row of pageAccessResult.data || []) {
    const pageAccess = row as DbPageAccessRow;
    pageAccessByUser.set(pageAccess.user_id, [...(pageAccessByUser.get(pageAccess.user_id) || []), pageAccess]);
  }

  return {
    branches,
    pages: navigationPageOptionsForAdmin(),
    users: ((profilesResult.data || []) as DbProfileRow[]).map((row) => ({
      ...mapProfile(row),
      branches: (accessByUser.get(row.id) || []).map((access) => ({
        branchId: String(access.branch_id),
        canView: Boolean(access.can_view),
        canCreate: Boolean(access.can_create),
        isHome: Boolean(access.is_home),
      })),
      pageAccess: pageAccessRowsOrDefaults(pageAccessByUser.get(row.id), row.role),
    })),
  };
}

function navigationPageOptionsForAdmin() {
  return navigationPageOptions.map((page) => ({
    ...page,
    required: page.slug === "dashboard" || page.slug === "perfil",
  }));
}

function pageAccessRowsOrDefaults(rows: DbPageAccessRow[] | undefined, role: AppRole): AppUserPageAccess[] {
  if (!rows?.length) return defaultPageAccessForRole(role);

  return normalizePageSlugs(rows.filter((row) => row.can_view).map((row) => row.page_slug)).map((pageSlug) => {
    const row = rows.find((item) => item.page_slug === pageSlug);
    return {
      pageSlug,
      canView: true,
      canCreate: Boolean(row?.can_create),
      canUpdate: Boolean(row?.can_update),
      canApprove: Boolean(row?.can_approve),
    };
  });
}

export async function upsertAppUser(input: {
  id?: string;
  email?: string | null;
  displayName: string;
  role: AppRole;
  fluigUsername?: string | null;
  fluigUserId?: string | null;
  homeBranchId?: string | null;
  branchIds?: string[];
  pageSlugs?: string[];
  active?: boolean;
  approvalStatus?: ApprovalStatus;
  approvedByUserId?: string | null;
  rejectionReason?: string | null;
}) {
  const client = assertServiceClient();
  const active = input.active ?? (input.approvalStatus ? input.approvalStatus === "APPROVED" : true);
  const approvalStatus = input.approvalStatus || (active ? "APPROVED" : "PENDING");
  const now = new Date().toISOString();
  const payload = {
    email: normalizeEmail(input.email),
    display_name: input.displayName.trim() || "Usuario ADM",
    role: input.role,
    fluig_username: input.fluigUsername?.trim() || null,
    fluig_user_id: input.fluigUserId?.trim() || null,
    home_branch_id: input.homeBranchId || input.branchIds?.[0] || null,
    active,
    approval_status: approvalStatus,
    approved_at: approvalStatus === "APPROVED" ? now : null,
    approved_by_user_id: approvalStatus === "APPROVED" ? input.approvedByUserId || null : null,
    rejected_at: approvalStatus === "REJECTED" ? now : null,
    rejection_reason: approvalStatus === "REJECTED" ? input.rejectionReason || "Acesso bloqueado pelo administrador." : null,
    updated_at: now,
  };

  const query = input.id
    ? client.from("app_user_profiles").update(payload).eq("id", input.id)
    : client.from("app_user_profiles").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  const profile = mapProfile(data as DbProfileRow);

  if (input.branchIds) {
    const branchIds = Array.from(new Set(input.branchIds.filter(Boolean)));
    const { error: deleteError } = await client.from("app_user_branch_access").delete().eq("user_id", profile.id);
    if (deleteError) throw deleteError;

    if (branchIds.length) {
      const rows = branchIds.map((branchId) => ({
        user_id: profile.id,
        branch_id: branchId,
        can_view: true,
        can_create: true,
        is_home: branchId === profile.homeBranchId,
      }));
      const { error: insertError } = await client.from("app_user_branch_access").insert(rows);
      if (insertError) throw insertError;
    }
  }

  if (input.pageSlugs) {
    const pageSlugs = normalizePageSlugs(input.pageSlugs);
    const { error: deleteError } = await client.from("app_user_page_access").delete().eq("user_id", profile.id);
    if (deleteError) throw deleteError;

    if (pageSlugs.length) {
      const rows = pageSlugs.map((pageSlug) => ({
        user_id: profile.id,
        page_slug: pageSlug,
        can_view: true,
        can_create: false,
        can_update: false,
        can_approve: false,
      }));
      const { error: insertError } = await client.from("app_user_page_access").insert(rows);
      if (insertError) throw insertError;
    }
  }

  return profile;
}

export async function createSignupUser(input: { email: string; password: string }) {
  const client = assertServiceClient();
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error("E-mail invalido.");
  }
  if (input.password.length < 6) {
    throw new Error("A senha precisa ter pelo menos 6 caracteres.");
  }

  const displayName = displayNameFromEmail(email);
  const hasApprovedAdmin = (await countApprovedAuthAdmins(client)) > 0;
  const role: AppRole = hasApprovedAdmin ? "LEITURA" : "ADMIN_MASTER";
  const approved = !hasApprovedAdmin;

  const { data: authData, error: authError } = await client.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: displayName,
      full_name: displayName,
    },
  });
  if (authError) throw authError;

  const authUserId = authData.user?.id;
  if (!authUserId) {
    throw new Error("Supabase nao retornou o usuario criado.");
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("app_user_profiles")
    .upsert(
      {
        auth_user_id: authUserId,
        email,
        display_name: displayName,
        role,
        active: approved,
        approval_status: approved ? "APPROVED" : "PENDING",
        approved_at: approved ? now : null,
        last_seen_at: null,
        updated_at: now,
      },
      { onConflict: "auth_user_id" }
    )
    .select("*")
    .single();
  if (error) throw error;

  return {
    profile: mapProfile(data as DbProfileRow),
    autoApproved: approved,
  };
}

export async function createAgentPairing(input: { actor: AppActor; displayName?: string; machineName?: string }) {
  const client = assertServiceClient();
  const token = generateAgentToken();
  const tokenHash = normalizeTokenHash(token);
  const tokenPrefix = token.slice(0, 12);
  const { data, error } = await client
    .from("fluig_user_agents")
    .insert({
      user_id: input.actor.id,
      display_name: input.displayName?.trim() || "Agente Fluig local",
      machine_name: input.machineName?.trim() || null,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      status: "offline",
      capabilities: [
        "sync_history",
        "sync_status",
        "open_from_source",
        "cancel_request",
        "health_check",
        "sync_initial_history",
        "sync_user_open_tasks",
        "sync_user_open_requests",
        "sync_user_incremental_batch",
        "sync_request_by_number",
        "supplier_lookup_by_cnpj",
      ],
    })
    .select("id,display_name,machine_name,token_prefix,status,paired_at,last_heartbeat_at")
    .single();
  if (error) throw error;

  return {
    agent: data,
    token,
  };
}

export async function listAgentsForActor(actor: AppActor) {
  const client = assertServiceClient();
  let query = client
    .from("fluig_user_agents")
    .select("id,user_id,display_name,machine_name,token_prefix,status,local_api_url,agent_version,last_heartbeat_at,paired_at,updated_at")
    .order("updated_at", { ascending: false });

  if (!actor.isAdmin) {
    query = query.eq("user_id", actor.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as DbAgentRow[]).map(mapAgent);
}

export async function authenticateAgentToken(token: string) {
  const client = assertServiceClient();
  const tokenHash = normalizeTokenHash(token);
  const { data, error } = await client
    .from("fluig_user_agents")
    .select("id,user_id,display_name,status")
    .eq("token_hash", tokenHash)
    .neq("status", "disabled")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const now = new Date().toISOString();
  const { error: heartbeatError } = await client
    .from("fluig_user_agents")
    .update({ status: "online", last_heartbeat_at: now, updated_at: now })
    .eq("id", data.id);
  if (heartbeatError) throw heartbeatError;

  return {
    id: String(data.id),
    userId: String(data.user_id),
    displayName: String(data.display_name),
  };
}

export async function recordAgentHeartbeat(input: {
  agentId: string;
  localApiUrl?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  agentVersion?: string | null;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const { error } = await client
    .from("fluig_user_agents")
    .update({
      status: "online",
      local_api_url: input.localApiUrl || null,
      machine_id: input.machineId || null,
      machine_name: input.machineName || null,
      agent_version: input.agentVersion || null,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", input.agentId);
  if (error) throw error;
}

export async function createFluigJob(input: {
  actor: AppActor;
  module: FluigModuleSlug;
  operation: FluigJobOperation;
  branchCode?: string | null;
  branchLabel?: string | null;
  requestPayload?: JsonRecord;
  reuseActive?: boolean;
}) {
  const client = assertServiceClient();
  const selectedBranch =
    input.branchCode && input.actor.branchCodes.includes(input.branchCode)
      ? input.actor.branches.find((branch) => branch.code === input.branchCode)
      : input.actor.branches[0];

  if (!input.actor.isAdmin && input.branchCode && !selectedBranch) {
    throw new Error("Usuario sem acesso a filial solicitada.");
  }

  const requestPayload = input.requestPayload || {};
  const branchCode = input.branchCode || selectedBranch?.code || null;
  const branchLabel = input.branchLabel || selectedBranch?.fluigLabel || selectedBranch?.name || null;

  if (input.reuseActive) {
    const { data: activeJobs, error: activeJobsError } = await client
      .from("fluig_jobs")
      .select("*")
      .eq("requested_by_user_id", input.actor.id)
      .eq("module_slug", input.module)
      .eq("operation", input.operation)
      .in("status", reusableJobStatuses)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(25);
    if (activeJobsError) throw activeJobsError;

    const targetPayloadFingerprint = stableJsonFingerprint(requestPayload);
    const reusableJob = ((activeJobs || []) as DbJobRow[]).find((job) => {
      const sameBranch = (job.branch_code || null) === branchCode;
      const samePayload = stableJsonFingerprint(job.request_payload || {}) === targetPayloadFingerprint;
      return sameBranch && samePayload;
    });

    if (reusableJob) {
      return mapJob(reusableJob);
    }
  }

  const { data, error } = await client
    .from("fluig_jobs")
    .insert({
      requested_by_user_id: input.actor.id,
      module_slug: input.module,
      operation: input.operation,
      branch_id: selectedBranch?.id || null,
      branch_code: branchCode,
      branch_label: branchLabel,
      fluig_username: input.actor.fluigUsername,
      request_payload: requestPayload,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapJob(data as DbJobRow);
}

export async function upsertFluigUserSyncState(input: {
  actor: AppActor;
  module: FluigModuleSlug;
  syncType: FluigUserSyncType;
  status: "started" | "success" | "error";
  errorMessage?: string | null;
  cursor?: JsonRecord;
  metadata?: JsonRecord;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const payload = {
    user_id: input.actor.id,
    fluig_username: input.actor.fluigUsername,
    fluig_user_id: input.actor.fluigUserId,
    module_slug: input.module,
    sync_type: input.syncType,
    last_sync_at: now,
    last_success_at: input.status === "success" ? now : undefined,
    last_error_at: input.status === "error" ? now : undefined,
    last_error_message: input.status === "error" ? input.errorMessage || "Falha na sincronizacao." : null,
    cursor: input.cursor || {},
    metadata: input.metadata || {},
  };
  const { data, error } = await client
    .from("fluig_user_sync_state")
    .upsert(payload, { onConflict: "user_id,module_slug,sync_type" })
    .select("*")
    .single();
  if (error) throw error;
  return mapSyncState(data as DbSyncStateRow);
}

export async function completeFluigUserSyncStateForJob(input: {
  job: FluigJobRecord;
  module?: FluigModuleSlug;
  syncType: FluigUserSyncType;
  status: "success" | "error";
  errorMessage?: string | null;
  metadata?: JsonRecord;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const payload = {
    user_id: input.job.requestedByUserId,
    fluig_username: input.job.fluigUsername,
    fluig_user_id: null,
    module_slug: input.module || input.job.module,
    sync_type: input.syncType,
    last_sync_at: now,
    last_success_at: input.status === "success" ? now : undefined,
    last_error_at: input.status === "error" ? now : undefined,
    last_error_message: input.status === "error" ? input.errorMessage || "Falha na sincronizacao." : null,
    cursor: {},
    metadata: {
      ...(input.metadata || {}),
      jobId: input.job.id,
      operation: input.job.operation,
    },
  };
  const { data, error } = await client
    .from("fluig_user_sync_state")
    .upsert(payload, { onConflict: "user_id,module_slug,sync_type" })
    .select("*")
    .single();
  if (error) throw error;
  return mapSyncState(data as DbSyncStateRow);
}

export async function listFluigUserSyncState(actor: AppActor, input: { userId?: string | null; module?: FluigModuleSlug | null } = {}) {
  const client = assertServiceClient();
  const targetUserId = actor.isAdmin && input.userId ? input.userId : actor.id;
  let query = client
    .from("fluig_user_sync_state")
    .select("*")
    .eq("user_id", targetUserId)
    .order("updated_at", { ascending: false });

  if (input.module) {
    query = query.eq("module_slug", input.module);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as DbSyncStateRow[]).map(mapSyncState);
}

export async function listJobsForActor(actor: AppActor, limit = 20) {
  const client = assertServiceClient();
  let query = client.from("fluig_jobs").select("*").order("created_at", { ascending: false }).limit(limit);

  if (!actor.isAdmin) {
    query = query.eq("requested_by_user_id", actor.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as DbJobRow[]).map(mapJob);
}

export async function readJobForActor(actor: AppActor, jobId: string) {
  const client = assertServiceClient();
  const { data, error } = await client.from("fluig_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const job = mapJob(data as DbJobRow);
  if (!actor.isAdmin && job.requestedByUserId !== actor.id) return null;

  const { data: events, error: eventsError } = await client
    .from("fluig_job_events")
    .select("id,event_type,stage,label,event_payload,created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (eventsError) throw eventsError;

  return {
    job,
    events: events || [],
  };
}

export async function pollNextAgentJob(agent: { id: string; userId: string }) {
  const client = assertServiceClient();
  const { data: existing, error: existingError } = await client
    .from("fluig_jobs")
    .select("*")
    .eq("assigned_agent_id", agent.id)
    .in("status", [
      "agent_claimed",
      "authenticating",
      "opening_fluig",
      "reading_page",
      "filling_form",
      "submitting",
      "waiting_protocol",
      "syncing_result",
    ])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return mapJob(existing as DbJobRow);

  const { data: queued, error: queuedError } = await client
    .from("fluig_jobs")
    .select("*")
    .eq("requested_by_user_id", agent.userId)
    .eq("status", "queued")
    .gt("expires_at", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (queuedError) throw queuedError;
  if (!queued) return null;

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await client
    .from("fluig_jobs")
    .update({
      assigned_agent_id: agent.id,
      status: "agent_claimed",
      claimed_at: now,
      started_at: now,
      progress_stage: "agent_claimed",
      progress_label: "Agente local assumiu a tarefa.",
      attempts: Number((queued as { attempts?: number }).attempts || 0) + 1,
      updated_at: now,
    })
    .eq("id", queued.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  return claimed ? mapJob(claimed as DbJobRow) : null;
}

export async function readJobForAgent(agent: { id: string; userId: string }, jobId: string) {
  const client = assertServiceClient();
  const { data, error } = await client
    .from("fluig_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("requested_by_user_id", agent.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const job = mapJob(data as DbJobRow);
  if (job.assignedAgentId && job.assignedAgentId !== agent.id) return null;
  return job;
}

export async function recordFluigJobEvent(input: {
  jobId: string;
  agentId: string;
  eventType: string;
  stage?: string | null;
  label?: string | null;
  payload?: JsonRecord;
  status?: FluigJobStatus;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const [{ error: eventError }, { error: updateError }] = await Promise.all([
    client.from("fluig_job_events").insert({
      job_id: input.jobId,
      agent_id: input.agentId,
      event_type: input.eventType,
      stage: input.stage || null,
      label: input.label || null,
      event_payload: input.payload || {},
    }),
    input.status || input.stage || input.label
      ? client
          .from("fluig_jobs")
          .update({
            status: input.status || undefined,
            progress_stage: input.stage || undefined,
            progress_label: input.label || undefined,
            updated_at: now,
          })
          .eq("id", input.jobId)
      : Promise.resolve({ error: null }),
  ]);
  if (eventError) throw eventError;
  if (updateError) throw updateError;
}

export async function completeFluigJob(input: {
  jobId: string;
  agentId: string;
  status: "success" | "error" | "cancelled";
  resultPayload?: JsonRecord;
  errorMessage?: string | null;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const statusLabel = input.status === "success" ? "Tarefa finalizada com sucesso." : input.errorMessage || "Tarefa finalizada com erro.";
  const [{ error: jobError }, { error: eventError }] = await Promise.all([
    client
      .from("fluig_jobs")
      .update({
        status: input.status,
        result_payload: input.resultPayload || {},
        error_message: input.errorMessage || null,
        progress_stage: input.status,
        progress_label: statusLabel,
        finished_at: now,
        updated_at: now,
      })
      .eq("id", input.jobId)
      .eq("assigned_agent_id", input.agentId),
    client.from("fluig_job_events").insert({
      job_id: input.jobId,
      agent_id: input.agentId,
      event_type: input.status,
      stage: input.status,
      label: statusLabel,
      event_payload: input.resultPayload || {},
    }),
  ]);
  if (jobError) throw jobError;
  if (eventError) throw eventError;
}

export function filterRowsForActor<T extends {
  branch_code?: string | null;
  created_by_user_id?: string | null;
  fluig_requester_login?: string | null;
  fluig_requester_code?: string | null;
  requester?: string | null;
}>(actor: AppActor | null | undefined, rows: T[]) {
  if (!actor || actor.isAdmin) return rows;

  const branchCodes = new Set(actor.branchCodes);
  const fluigUser = String(actor.fluigUsername || actor.fluigUserId || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowBranch = String(row.branch_code || "").trim();
    if (rowBranch && branchCodes.has(rowBranch)) return true;
    if (row.created_by_user_id && row.created_by_user_id === actor.id) return true;

    const requesterValues = [row.fluig_requester_login, row.fluig_requester_code, row.requester]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return Boolean(fluigUser && requesterValues.some((value) => value === fluigUser || value.includes(fluigUser)));
  });
}
