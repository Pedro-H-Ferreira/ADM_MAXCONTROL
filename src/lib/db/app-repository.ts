import crypto from "node:crypto";
import { cache } from "react";
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
import { filterFluigRowsForActor, type FluigVisibilityRow } from "@/lib/fluig-visibility";
import {
  defaultFluigJobMaxAttempts,
  fluigActiveJobStatuses,
  fluigJobQueueLifetimeMs,
} from "@/lib/fluig-job-lifecycle";

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
  pageAccess: AppUserPageAccess[];
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
  | "attach_to_request"
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
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  expiresAt: string;
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
  request_payload?: JsonRecord | null;
  result_payload?: JsonRecord | null;
  error_message: string | null;
  progress_stage: string | null;
  progress_label: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  expires_at: string;
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
const reusableJobStatuses: FluigJobStatus[] = [...fluigActiveJobStatuses];
const agentHeartbeatOnlineWindowMs = 2 * 60 * 1000;
const fluigJobSummarySelect =
  "id,requested_by_user_id,assigned_agent_id,module_slug,operation,status,branch_code,branch_label,fluig_username,error_message,progress_stage,progress_label,attempts,max_attempts,next_attempt_at,last_attempt_at,expires_at,created_at,updated_at,finished_at" as const;

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
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || defaultFluigJobMaxAttempts(row.operation)),
    nextAttemptAt: row.next_attempt_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function fluigUserIdFromJobPayload(payload: JsonRecord) {
  const userMatch = payload.userMatch as Record<string, unknown> | undefined;
  return String(payload.taskUserId || userMatch?.fluigUserId || "").trim() || null;
}

async function reconcileFluigJobLifecycle(client: SupabaseClient, userId?: string | null) {
  const { data, error } = await client.rpc("reconcile_fluig_job_lifecycle", {
    p_user_id: userId || null,
  });
  if (error) throw error;
  return (data || { expired: 0, retried: 0 }) as { expired: number; retried: number };
}

function mapSyncState(row: DbSyncStateRow) {
  const lastSyncAt = Date.parse(row.last_sync_at || "");
  const lastSuccessAt = Date.parse(row.last_success_at || "");
  const lastErrorAt = Date.parse(row.last_error_at || "");
  const status: "started" | "success" | "error" =
    Number.isFinite(lastErrorAt) &&
    (!Number.isFinite(lastSuccessAt) || lastErrorAt >= lastSuccessAt) &&
    (!Number.isFinite(lastSyncAt) || lastErrorAt >= lastSyncAt)
      ? "error"
      : Number.isFinite(lastSuccessAt) && (!Number.isFinite(lastSyncAt) || lastSuccessAt >= lastSyncAt)
        ? "success"
        : "started";

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
    status,
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

export function canActorPerformPageAction(
  actor: Pick<AppActor, "isAdmin" | "pageAccess">,
  pageSlug: string,
  action: "canCreate" | "canUpdate" | "canApprove"
) {
  if (actor.isAdmin) return true;
  const access = actor.pageAccess.find((page) => page.pageSlug === pageSlug);
  return Boolean(access?.canView && access[action]);
}

const fluigModuleSlugs = ["pagamentos", "compras", "manutencao", "fornecedores"] as const;

export function fluigModuleSlugsForActor(actor: Pick<AppActor, "isAdmin" | "pageSlugs">) {
  return fluigModuleSlugs.filter((moduleSlug) => canActorAccessPage(actor, moduleSlug));
}

function assertFluigJobPermission(actor: AppActor, module: FluigModuleSlug, operation: FluigJobOperation) {
  if (!canActorAccessPage(actor, module)) {
    throw new AppAuthError("Usuario sem acesso ao modulo Fluig solicitado.", 403, "FLUIG_MODULE_ACCESS_DENIED");
  }

  const requiredAction = operation === "open_from_source"
    ? "canCreate"
    : operation === "cancel_request"
      ? "canApprove"
      : operation === "health_check"
        ? null
        : "canUpdate";
  if (requiredAction && !canActorPerformPageAction(actor, module, requiredAction)) {
    throw new AppAuthError(
      "Usuario sem permissao para executar esta acao no modulo Fluig.",
      403,
      "FLUIG_ACTION_ACCESS_DENIED"
    );
  }
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

function normalizePageAccessRows(rows: AppUserPageAccess[] | null | undefined, role: AppRole) {
  if (!rows?.length) return defaultPageAccessForRole(role);

  const bySlug = new Map<string, AppUserPageAccess>();
  for (const row of rows) {
    const pageSlug = String(row.pageSlug || "").trim();
    if (!pageSlug || !isKnownNavigationPage(pageSlug)) continue;
    const canView = pageSlug === "dashboard" || pageSlug === "perfil" || row.canView !== false;
    bySlug.set(pageSlug, {
      pageSlug,
      canView,
      canCreate: canView && Boolean(row.canCreate),
      canUpdate: canView && Boolean(row.canUpdate),
      canApprove: canView && Boolean(row.canApprove),
    });
  }

  for (const requiredPage of ["dashboard", "perfil"]) {
    bySlug.set(requiredPage, {
      pageSlug: requiredPage,
      canView: true,
      canCreate: Boolean(bySlug.get(requiredPage)?.canCreate),
      canUpdate: Boolean(bySlug.get(requiredPage)?.canUpdate),
      canApprove: Boolean(bySlug.get(requiredPage)?.canApprove),
    });
  }

  return Array.from(bySlug.values()).filter((row) => row.canView);
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

type AuthUserIdentity = Pick<User, "id" | "email" | "user_metadata">;

async function getAuthUser(): Promise<AuthUserIdentity | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      const retryable =
        error.name === "AuthRetryableFetchError" ||
        (typeof error.status === "number" && error.status >= 500);
      if (retryable) {
        throw new AppAuthError(
          "Nao foi possivel validar a sessao agora.",
          503,
          "AUTH_UNAVAILABLE"
        );
      }
      return null;
    }

    const claims = data?.claims as Record<string, unknown> | undefined;
    const id = typeof claims?.sub === "string" ? claims.sub : "";
    if (!id) return null;

    return {
      id,
      email: typeof claims?.email === "string" ? claims.email : undefined,
      user_metadata:
        claims?.user_metadata && typeof claims.user_metadata === "object"
          ? (claims.user_metadata as Record<string, unknown>)
          : {},
    };
  } catch (error) {
    if (isAppAuthError(error)) throw error;
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

async function ensureProfileForAuthUser(client: SupabaseClient, user: AuthUserIdentity) {
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
    .eq("active", true)
    .is("deleted_at", null)
    .order("code", { ascending: true });
  if (error) throw error;
  return ((data || []) as DbBranchRow[]).map(mapBranch);
}

export async function listActorBranches(client: SupabaseClient, profile: AppUserProfile) {
  if (isAdminRole(profile.role)) {
    return listBranches(client);
  }

  const { data, error } = await client
    .from("app_user_branch_access")
    .select("branch:app_branches!inner(id,code,name,fluig_label,active)")
    .eq("user_id", profile.id)
    .eq("can_view", true)
    .eq("branch.active", true)
    .is("branch.deleted_at", null);
  if (error) throw error;

  return (data || [])
    .map((row) => {
      const branch = (row as { branch?: DbBranchRow | DbBranchRow[] }).branch;
      return Array.isArray(branch) ? branch[0] : branch;
    })
    .filter(Boolean)
    .map((branch) => mapBranch(branch as DbBranchRow));
}

async function listActorPageAccess(client: SupabaseClient, profile: AppUserProfile) {
  if (isAdminRole(profile.role)) {
    return allNavigationPageSlugs.map((pageSlug) => ({
      pageSlug,
      canView: true,
      canCreate: true,
      canUpdate: true,
      canApprove: true,
    }));
  }

  const { data, error } = await client
    .from("app_user_page_access")
    .select("user_id,page_slug,can_view,can_create,can_update,can_approve")
    .eq("user_id", profile.id);
  if (error) throw error;

  const explicitRows = (data || []).map((row) => ({
    pageSlug: String((row as { page_slug?: string }).page_slug || ""),
    canView: Boolean((row as { can_view?: boolean }).can_view),
    canCreate: Boolean((row as { can_create?: boolean }).can_create),
    canUpdate: Boolean((row as { can_update?: boolean }).can_update),
    canApprove: Boolean((row as { can_approve?: boolean }).can_approve),
  }));

  return normalizePageAccessRows(explicitRows, profile.role);
}

async function resolveCurrentAppUserUncached(
  allowFallback: boolean,
  requireApproved: boolean
): Promise<AppActor> {
  const client = assertServiceClient();
  const authUser = await getAuthUser();
  const profile = authUser
    ? await ensureProfileForAuthUser(client, authUser)
    : allowFallback
      ? await ensureFallbackAdminProfile(client)
      : null;

  if (!profile) {
    throw new AppAuthError("Sessao nao encontrada.", 401, "UNAUTHENTICATED");
  }

  if (requireApproved && (!profile.active || profile.approvalStatus !== "APPROVED")) {
    throw new AppAuthError("Usuario aguardando liberacao do administrador.", 403, profile.approvalStatus);
  }

  const branches = await listActorBranches(client, profile);
  const pageAccess = await listActorPageAccess(client, profile);
  const pageSlugs = normalizePageSlugs(pageAccess.filter((page) => page.canView).map((page) => page.pageSlug));

  return {
    ...profile,
    isAdmin: isAdminRole(profile.role),
    branches,
    branchCodes: branches.map((branch) => branch.code),
    pageSlugs,
    pageAccess,
  };
}

const resolveCurrentAppUserCached = cache(resolveCurrentAppUserUncached);

export function resolveCurrentAppUser(
  options: { allowFallback?: boolean; requireApproved?: boolean } = {}
): Promise<AppActor> {
  return resolveCurrentAppUserCached(
    options.allowFallback === true,
    options.requireApproved !== false
  );
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

  const activeBranchIds = new Set(branches.map((branch) => branch.id));

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
      branches: (accessByUser.get(row.id) || [])
        .filter((access) => activeBranchIds.has(String(access.branch_id)))
        .map((access) => ({
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

export type UpsertAppUserInput = {
  actor: Pick<AppActor, "id" | "role">;
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

function assignDefined(target: JsonRecord, key: string, value: unknown) {
  if (value !== undefined) target[key] = value;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

async function readProfileForUserMutation(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("app_user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppAuthError("Usuario nao encontrado.", 404, "USER_NOT_FOUND");
  return mapProfile(data as DbProfileRow);
}

async function assertUserHierarchy(
  client: SupabaseClient,
  input: UpsertAppUserInput,
  current: AppUserProfile | null
) {
  const actorIsMaster = input.actor.role === "ADMIN_MASTER";
  const targetRole = input.role ?? current?.role ?? "LEITURA";

  if (!actorIsMaster && (current?.role === "ADMIN_MASTER" || targetRole === "ADMIN_MASTER")) {
    throw new AppAuthError(
      "Somente ADMIN_MASTER pode criar ou alterar outro ADMIN_MASTER.",
      403,
      "ADMIN_MASTER_REQUIRED"
    );
  }

  const nextActive = input.active ?? current?.active ?? true;
  const nextApprovalStatus = input.approvalStatus ?? current?.approvalStatus ?? "APPROVED";
  const removesMaster =
    current?.role === "ADMIN_MASTER" &&
    (targetRole !== "ADMIN_MASTER" || !nextActive || nextApprovalStatus !== "APPROVED");

  if (removesMaster) {
    const { count, error } = await client
      .from("app_user_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN_MASTER")
      .eq("active", true)
      .eq("approval_status", "APPROVED");
    if (error) throw error;
    if ((count || 0) <= 1) {
      throw new AppAuthError(
        "Nao e permitido remover o ultimo ADMIN_MASTER ativo e aprovado.",
        409,
        "LAST_ADMIN_MASTER"
      );
    }
  }

  if (
    current?.id === input.actor.id &&
    (!adminRoles.has(targetRole) || !nextActive || nextApprovalStatus !== "APPROVED")
  ) {
    throw new AppAuthError(
      "O administrador logado nao pode remover a propria liberacao administrativa.",
      409,
      "SELF_ADMIN_LOCKOUT"
    );
  }
}

async function assertActiveBranchMatrix(
  client: SupabaseClient,
  input: UpsertAppUserInput,
  current: AppUserProfile | null
) {
  const targetRole = input.role ?? current?.role ?? "LEITURA";
  if (input.branchIds === undefined && input.homeBranchId === undefined) {
    if (!current && !adminRoles.has(targetRole)) {
      throw new AppAuthError(
        "Informe as filiais e exatamente uma filial principal.",
        400,
        "INVALID_BRANCH_MATRIX"
      );
    }
    if (current && adminRoles.has(current.role) && !adminRoles.has(targetRole)) {
      throw new AppAuthError(
        "Ao remover o acesso global, informe as filiais e a filial principal.",
        400,
        "INVALID_BRANCH_MATRIX"
      );
    }
    return;
  }
  if (adminRoles.has(targetRole) && input.branchIds?.length === 0 && !input.homeBranchId) return;
  if (!input.branchIds?.length || !input.homeBranchId) {
    throw new AppAuthError(
      "Informe as filiais e exatamente uma filial principal.",
      400,
      "INVALID_BRANCH_MATRIX"
    );
  }

  const branchIds = Array.from(new Set(input.branchIds));
  if (branchIds.length !== input.branchIds.length || !branchIds.includes(input.homeBranchId)) {
    throw new AppAuthError(
      "A filial principal deve pertencer a lista de filiais, sem filiais duplicadas.",
      400,
      "INVALID_HOME_BRANCH"
    );
  }

  const { data, error } = await client
    .from("app_branches")
    .select("id")
    .in("id", branchIds)
    .eq("active", true)
    .is("deleted_at", null);
  if (error) throw error;
  if ((data || []).length !== branchIds.length) {
    throw new AppAuthError(
      "Uma ou mais filiais informadas estao inativas, excluidas ou nao existem.",
      400,
      "INVALID_BRANCH"
    );
  }
}

function buildAppUserAccessPayload(input: UpsertAppUserInput) {
  const payload: JsonRecord = {};
  assignDefined(payload, "id", input.id);
  assignDefined(payload, "email", input.email === undefined ? undefined : normalizeEmail(input.email));
  assignDefined(payload, "display_name", input.displayName?.trim());
  assignDefined(payload, "role", input.role);
  assignDefined(payload, "fluig_username", normalizeNullableText(input.fluigUsername));
  assignDefined(payload, "fluig_user_id", normalizeNullableText(input.fluigUserId));
  assignDefined(payload, "home_branch_id", input.homeBranchId);
  assignDefined(payload, "branch_ids", input.branchIds);
  assignDefined(payload, "page_slugs", input.pageSlugs);
  assignDefined(payload, "page_access", input.pageAccess);
  assignDefined(payload, "active", input.active);
  assignDefined(payload, "approval_status", input.approvalStatus);
  assignDefined(payload, "rejection_reason", normalizeNullableText(input.rejectionReason));
  return payload;
}

export async function upsertAppUser(input: UpsertAppUserInput) {
  const client = assertServiceClient();
  const current = input.id ? await readProfileForUserMutation(client, input.id) : null;
  await assertUserHierarchy(client, input, current);
  await assertActiveBranchMatrix(client, input, current);

  const { data, error } = await client.rpc("save_app_user_access", {
    p_actor_id: input.actor.id,
    p_payload: buildAppUserAccessPayload(input),
  });
  if (error) throw error;
  if (!data) throw new Error("Supabase nao retornou o usuario salvo.");
  return mapProfile(data as DbProfileRow);
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
        "attach_to_request",
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
  const query = client
    .from("fluig_user_agents")
    .select("id,user_id,display_name,machine_name,token_prefix,status,local_api_url,agent_version,last_heartbeat_at,paired_at,updated_at")
    .eq("user_id", actor.id)
    .order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as DbAgentRow[]).map(mapAgent);
}

async function assertFluigCredentialsForActor(client: SupabaseClient, actor: AppActor) {
  const { data, error } = await client
    .from("fluig_user_credentials")
    .select("user_id")
    .eq("user_id", actor.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return;

  throw new AppAuthError(
    "Credenciais Fluig nao cadastradas para este usuario. Solicite ao administrador o preenchimento do usuario e da senha Fluig no cadastro de usuarios.",
    409,
    "FLUIG_CREDENTIALS_MISSING"
  );
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

  const { data: owner, error: ownerError } = await client
    .from("app_user_profiles")
    .select("id,active,approval_status")
    .eq("id", data.user_id)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner?.active || owner.approval_status !== "APPROVED") return null;

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

export async function recordDetectedFluigUserId(input: {
  userId: string;
  fluigUserId?: string | null;
  fluigUsername?: string | null;
  fluigEmail?: string | null;
  legacyFluigUserIds?: Array<string | null | undefined>;
}) {
  const fluigUserId = String(input.fluigUserId || "").trim();
  if (!fluigUserId) {
    return { detected: false, matched: false, updated: false };
  }

  const client = assertServiceClient();
  const { data: profile, error: profileError } = await client
    .from("app_user_profiles")
    .select("id,email,fluig_user_id,fluig_username")
    .eq("id", input.userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    return { detected: true, matched: false, updated: false };
  }

  const existingFluigUserId = String(profile.fluig_user_id || "").trim();
  const fluigUsername = String(input.fluigUsername || "").trim() || null;
  const fluigEmail = String(input.fluigEmail || "").trim().toLowerCase() || null;
  const legacyFluigUserIds = new Set(
    (input.legacyFluigUserIds || []).map((value) => String(value || "").trim()).filter(Boolean)
  );
  const detectedIdentityValues = new Set(
    [fluigUsername, fluigEmail].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
  );
  const profileIdentityValues = [profile.fluig_username, profile.email]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const identityMatchesProfile = profileIdentityValues.some((value) => detectedIdentityValues.has(value));
  const canReplaceLegacyId = Boolean(
    existingFluigUserId &&
      legacyFluigUserIds.has(existingFluigUserId) &&
      (identityMatchesProfile || !String(profile.fluig_username || "").trim())
  );

  if (existingFluigUserId && existingFluigUserId !== fluigUserId && !canReplaceLegacyId) {
    return {
      detected: true,
      matched: false,
      updated: false,
    };
  }

  const shouldUpdateUserId = !existingFluigUserId || canReplaceLegacyId;
  const shouldUpdateUsername = Boolean(fluigUsername && !String(profile.fluig_username || "").trim());
  if (!shouldUpdateUserId && !shouldUpdateUsername) {
    return { detected: true, matched: true, updated: false };
  }

  let updateQuery = client
    .from("app_user_profiles")
    .update({
      ...(shouldUpdateUserId ? { fluig_user_id: fluigUserId } : {}),
      ...(shouldUpdateUsername ? { fluig_username: fluigUsername } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.userId);
  updateQuery = existingFluigUserId
    ? updateQuery.eq("fluig_user_id", existingFluigUserId)
    : updateQuery.or("fluig_user_id.is.null,fluig_user_id.eq.");
  const { data, error } = await updateQuery
    .select("id")
    .maybeSingle();
  if (error) throw error;

  return { detected: true, matched: Boolean(data), updated: Boolean(data) };
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
  assertFluigJobPermission(input.actor, input.module, input.operation);
  const requestedBranchCode = input.branchCode?.trim() || null;
  const requestedBranchLabel = input.branchLabel?.trim() || null;
  const branchByCode = requestedBranchCode
    ? input.actor.branches.find((branch) => branch.code === requestedBranchCode)
    : undefined;
  const branchByLabel = requestedBranchLabel
    ? input.actor.branches.find(
        (branch) => branch.fluigLabel === requestedBranchLabel || branch.name === requestedBranchLabel
      )
    : undefined;

  if (requestedBranchCode && !branchByCode) {
    throw new AppAuthError(
      `Usuario sem acesso a filial solicitada: codigo "${requestedBranchCode}".`,
      403,
      "FLUIG_BRANCH_ACCESS_DENIED"
    );
  }
  if (requestedBranchLabel && !branchByLabel) {
    throw new AppAuthError(
      `Usuario sem acesso a filial solicitada: identificacao "${requestedBranchLabel}".`,
      403,
      "FLUIG_BRANCH_ACCESS_DENIED"
    );
  }
  if (branchByCode && branchByLabel && branchByCode.id !== branchByLabel.id) {
    throw new AppAuthError(
      "O codigo e a identificacao informados correspondem a filiais diferentes.",
      400,
      "FLUIG_BRANCH_MISMATCH"
    );
  }

  const selectedBranch = branchByCode || branchByLabel || input.actor.branches[0];
  await reconcileFluigJobLifecycle(client, input.actor.id);
  await assertFluigCredentialsForActor(client, input.actor);

  const requestPayload = input.requestPayload || {};
  const branchCode = requestedBranchCode || selectedBranch?.code || null;
  const branchLabel = requestedBranchLabel || selectedBranch?.fluigLabel || selectedBranch?.name || null;
  const now = new Date();
  const maxAttempts = defaultFluigJobMaxAttempts(input.operation);

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
      max_attempts: maxAttempts,
      next_attempt_at: now.toISOString(),
      expires_at: new Date(now.getTime() + fluigJobQueueLifetimeMs(input.operation)).toISOString(),
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
  fluigUserId?: string | null;
}) {
  const client = assertServiceClient();
  const now = new Date().toISOString();
  const payload = {
    user_id: input.job.requestedByUserId,
    fluig_username: input.job.fluigUsername,
    fluig_user_id: input.fluigUserId || fluigUserIdFromJobPayload(input.job.requestPayload),
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
  const allowedModules = fluigModuleSlugsForActor(actor);
  if (input.module && !allowedModules.includes(input.module)) return [];
  if (!allowedModules.length) return [];
  let query = client
    .from("fluig_user_sync_state")
    .select("*")
    .order("updated_at", { ascending: false });

  if (actor.isAdmin && input.userId) {
    query = query.eq("user_id", input.userId);
  } else if (actor.fluigUserId) {
    query = query.eq("fluig_user_id", actor.fluigUserId);
  } else {
    query = query.eq("user_id", actor.id);
  }

  if (input.module) {
    query = query.eq("module_slug", input.module);
  } else {
    query = query.in("module_slug", allowedModules);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as DbSyncStateRow[]).map(mapSyncState);
}

export async function listJobsForActor(actor: AppActor, limit = 20) {
  const client = assertServiceClient();
  const allowedModules = fluigModuleSlugsForActor(actor);
  if (!allowedModules.length) return [];
  await reconcileFluigJobLifecycle(client, actor.id);
  const [activeJobs, recentResult] = await Promise.all([
    client
      .from("fluig_jobs")
      .select(fluigJobSummarySelect)
      .eq("requested_by_user_id", actor.id)
      .in("module_slug", allowedModules)
      .in("status", reusableJobStatuses)
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("fluig_jobs")
      .select(fluigJobSummarySelect)
      .eq("requested_by_user_id", actor.id)
      .in("module_slug", allowedModules)
      .in("status", ["success", "error", "cancelled", "expired"])
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  if (activeJobs.error) throw activeJobs.error;
  if (recentResult.error) throw recentResult.error;

  return [...((activeJobs.data || []) as DbJobRow[]), ...((recentResult.data || []) as DbJobRow[])].map(mapJob);
}

export async function readJobForActor(
  actor: AppActor,
  jobId: string,
  options: { includePayloads?: boolean } = {}
) {
  const client = assertServiceClient();
  const allowedModules = fluigModuleSlugsForActor(actor);
  if (!allowedModules.length) return null;
  await reconcileFluigJobLifecycle(client, actor.id);
  const { data, error } = await client
    .from("fluig_jobs")
    .select(options.includePayloads ? "*" : fluigJobSummarySelect)
    .eq("id", jobId)
    .eq("requested_by_user_id", actor.id)
    .in("module_slug", allowedModules)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const job = mapJob(data as unknown as DbJobRow);

  const { data: events, error: eventsError } = await client
    .from("fluig_job_events")
    .select(options.includePayloads ? "id,event_type,stage,label,event_payload,created_at" : "id,event_type,stage,label,created_at")
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
  const { data, error } = await client
    .rpc("claim_next_fluig_job", { p_agent_id: agent.id })
    .maybeSingle();
  if (error) throw error;
  return data ? mapJob(data as DbJobRow) : null;
}

export async function claimNextServerFluigJob() {
  const client = assertServiceClient();
  const { data, error } = await client
    .rpc("claim_next_fluig_server_job")
    .maybeSingle();
  if (error) throw error;
  return data ? mapJob(data as DbJobRow) : null;
}

export async function recordServerFluigJobEvent(input: {
  jobId: string;
  eventType: string;
  stage?: string | null;
  label?: string | null;
  payload?: JsonRecord;
  status?: FluigJobStatus;
}) {
  const client = assertServiceClient();
  const { data, error } = await client
    .rpc("transition_fluig_server_job", {
      p_job_id: input.jobId,
      p_event_type: input.eventType,
      p_stage: input.stage || null,
      p_label: input.label || null,
      p_status: input.status || null,
      p_event_payload: input.payload || {},
    })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Job Fluig nao esta mais atribuido ao executor da VPS.");
  return mapJob(data as DbJobRow);
}

export async function completeServerFluigJob(input: {
  jobId: string;
  status: "success" | "error" | "cancelled";
  resultPayload?: JsonRecord;
  errorMessage?: string | null;
}) {
  const client = assertServiceClient();
  const { data, error } = await client
    .rpc("complete_fluig_server_job", {
      p_job_id: input.jobId,
      p_status: input.status,
      p_result_payload: input.resultPayload || {},
      p_error_message: input.errorMessage || null,
    })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Job Fluig nao esta mais atribuido ao executor da VPS.");
  return mapJob(data as DbJobRow);
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
  if (job.assignedAgentId !== agent.id) return null;
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
  const { data, error } = await client
    .rpc("transition_fluig_job", {
      p_job_id: input.jobId,
      p_agent_id: input.agentId,
      p_event_type: input.eventType,
      p_stage: input.stage || null,
      p_label: input.label || null,
      p_status: input.status || null,
      p_event_payload: input.payload || {},
    })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Job nao esta mais atribuido a este agente.");
}

export async function completeFluigJob(input: {
  jobId: string;
  agentId: string;
  status: "success" | "error" | "cancelled";
  resultPayload?: JsonRecord;
  errorMessage?: string | null;
}) {
  const client = assertServiceClient();
  const { data, error } = await client
    .rpc("complete_fluig_job", {
      p_job_id: input.jobId,
      p_agent_id: input.agentId,
      p_status: input.status,
      p_result_payload: input.resultPayload || {},
      p_error_message: input.errorMessage || null,
    })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Job nao esta mais atribuido a este agente.");
}

export function filterRowsForActor<T extends FluigVisibilityRow>(actor: AppActor | null | undefined, rows: T[]) {
  return filterFluigRowsForActor(actor, rows);
}
