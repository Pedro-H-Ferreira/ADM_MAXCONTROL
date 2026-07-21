"use client";

import { useEffect, useState } from "react";
import { Clock3, KeyRound, Save, ShieldCheck, UserCheck, UserRound, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";

type Branch = {
  id: string;
  code: string;
  name: string;
  fluigLabel: string | null;
  active: boolean;
};

type UserBranch = {
  branchId: string;
  canView: boolean;
  canCreate: boolean;
  isHome: boolean;
};

type PageOption = {
  slug: string;
  title: string;
  section: string;
  href: string;
  required?: boolean;
};

type UserPageAccess = {
  pageSlug: string;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
};

type UserProfile = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  fluigUsername: string | null;
  fluigUserId: string | null;
  fluigCredentialConfigured: boolean;
  homeBranchId: string | null;
  active: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  branches: UserBranch[];
  pageAccess: UserPageAccess[];
};

const roles = ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"];
const approvalLabels = {
  PENDING: "PENDENTE",
  APPROVED: "APROVADO",
  REJECTED: "BLOQUEADO",
} as const;

function normalizeDraftPageAccess(rows: UserPageAccess[]) {
  const bySlug = new Map<string, UserPageAccess>();
  for (const row of rows) {
    if (!row.pageSlug) continue;
    const canView = row.pageSlug === "dashboard" || row.pageSlug === "perfil" || row.canView !== false;
    if (!canView) continue;
    bySlug.set(row.pageSlug, {
      pageSlug: row.pageSlug,
      canView: true,
      canCreate: Boolean(row.canCreate),
      canUpdate: Boolean(row.canUpdate),
      canApprove: Boolean(row.canApprove),
    });
  }

  for (const requiredPage of ["dashboard", "perfil"]) {
    const row = bySlug.get(requiredPage);
    bySlug.set(requiredPage, {
      pageSlug: requiredPage,
      canView: true,
      canCreate: Boolean(row?.canCreate),
      canUpdate: Boolean(row?.canUpdate),
      canApprove: Boolean(row?.canApprove),
    });
  }

  return Array.from(bySlug.values());
}

function pageAccessForRole(rows: UserPageAccess[], role: string | undefined) {
  const normalized = normalizeDraftPageAccess(rows);
  return role === "ADMIN_MASTER" || role === "ADMIN"
    ? normalized
    : normalized.filter((page) => page.pageSlug !== "usuarios");
}

export function UserBranchAccessPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [draft, setDraft] = useState<Partial<UserProfile> & { branchIds: string[]; pageAccess: UserPageAccess[] }>({
    branchIds: [],
    pageAccess: [
      { pageSlug: "dashboard", canView: true, canCreate: false, canUpdate: false, canApprove: false },
      { pageSlug: "perfil", canView: true, canCreate: false, canUpdate: false, canApprove: false },
    ],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fluigPassword, setFluigPassword] = useState("");
  const [clearFluigCredentials, setClearFluigCredentials] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        branches?: Branch[];
        pages?: PageOption[];
        users?: UserProfile[];
      };
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Falha ao carregar usuarios");
      }
      setBranches(data.branches || []);
      setPages(data.pages || []);
      setUsers(data.users || []);
      const firstUser = data.users?.[0] || null;
      if (!selectedUserId && firstUser) {
        selectUser(firstUser);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar usuarios");
    } finally {
      setLoading(false);
    }
  }

  function selectUser(user: UserProfile) {
    const branchIds = user.branches.filter((branch) => branch.canView).map((branch) => branch.branchId);
    setSelectedUserId(user.id);
    setFluigPassword("");
    setClearFluigCredentials(false);
    setDraft({
      ...user,
      branchIds,
      homeBranchId: user.homeBranchId && branchIds.includes(user.homeBranchId) ? user.homeBranchId : null,
      pageAccess: normalizeDraftPageAccess(user.pageAccess || []),
    });
  }

  function toggleBranch(branchId: string, checked: boolean) {
    setDraft((current) => {
      const branchIds = new Set(current.branchIds || []);
      if (checked) {
        branchIds.add(branchId);
      } else {
        branchIds.delete(branchId);
      }
      return {
        ...current,
        branchIds: Array.from(branchIds),
        homeBranchId: checked ? current.homeBranchId || branchId : current.homeBranchId === branchId ? null : current.homeBranchId,
      };
    });
  }

  function togglePage(pageSlug: string, checked: boolean) {
    if (pageSlug === "dashboard" || pageSlug === "perfil") {
      return;
    }

    setDraft((current) => {
      const rows = new Map(normalizeDraftPageAccess(current.pageAccess || []).map((page) => [page.pageSlug, page]));
      if (checked) {
        rows.set(pageSlug, rows.get(pageSlug) || { pageSlug, canView: true, canCreate: false, canUpdate: false, canApprove: false });
      } else {
        rows.delete(pageSlug);
      }
      return {
        ...current,
        pageAccess: normalizeDraftPageAccess(Array.from(rows.values())),
      };
    });
  }

  function togglePageAction(pageSlug: string, action: "canCreate" | "canUpdate" | "canApprove", checked: boolean) {
    setDraft((current) => {
      const rows = new Map(normalizeDraftPageAccess(current.pageAccess || []).map((page) => [page.pageSlug, page]));
      const currentRow = rows.get(pageSlug) || { pageSlug, canView: true, canCreate: false, canUpdate: false, canApprove: false };
      rows.set(pageSlug, {
        ...currentRow,
        canView: true,
        [action]: checked,
      });
      return {
        ...current,
        pageAccess: normalizeDraftPageAccess(Array.from(rows.values())),
      };
    });
  }

  async function saveUser() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          email: draft.email,
          displayName: draft.displayName,
          role: draft.role,
          fluigUsername: draft.fluigUsername,
          fluigPassword: fluigPassword || undefined,
          clearFluigCredentials,
          fluigUserId: draft.fluigUserId,
          homeBranchId: draft.homeBranchId,
          branchIds: draft.branchIds,
          pageAccess: pageAccessForRole(draft.pageAccess || [], draft.role),
          active: draft.active,
          approvalStatus: draft.approvalStatus,
        }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Falha ao salvar usuario");
      }
      await loadUsers();
      setFluigPassword("");
      setClearFluigCredentials(false);
      toast.success("Acessos e credencial Fluig do usuario atualizados.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Falha ao salvar usuario";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleHasGlobalBranchAccess = draft.role === "ADMIN_MASTER" || draft.role === "ADMIN";
  const selectedBranches = branches.filter((branch) => draft.branchIds?.includes(branch.id));
  const validBranchMatrix = roleHasGlobalBranchAccess || Boolean(draft.branchIds?.length && draft.homeBranchId);

  return (
    <Card className="stitch-animate-in stitch-hover-lift rounded-lg shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" />
          Filiais e usuario Fluig
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Admin enxerga todas as filiais. Os demais usuarios veem filiais marcadas ou solicitacoes feitas pelo usuario Fluig vinculado.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        {loading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Carregando usuarios e filiais...
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <section className="rounded-md border bg-muted/20">
              <header className="border-b p-3 text-sm font-semibold">Usuarios</header>
              <div className="max-h-[520px] overflow-auto p-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => selectUser(user)}
                    data-active={user.id === selectedUserId}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{user.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{user.email || user.fluigUsername || "Sem e-mail"}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={user.role} />
                      <StatusBadge status={user.approvalStatus} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-md border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
                <div>
                  <p className="text-sm font-semibold">Liberacao do acesso</p>
                  <p className="text-xs text-muted-foreground">
                    Status atual: {draft.approvalStatus ? approvalLabels[draft.approvalStatus] : "PENDENTE"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={draft.approvalStatus === "APPROVED" ? "default" : "outline"}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        active: true,
                        approvalStatus: "APPROVED",
                        rejectionReason: null,
                      }))
                    }
                  >
                    <UserCheck className="size-4" />
                    Aprovar
                  </Button>
                  <Button
                    type="button"
                    variant={draft.approvalStatus === "PENDING" ? "secondary" : "outline"}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        active: false,
                        approvalStatus: "PENDING",
                        rejectionReason: null,
                      }))
                    }
                  >
                    <Clock3 className="size-4" />
                    Pendente
                  </Button>
                  <Button
                    type="button"
                    variant={draft.approvalStatus === "REJECTED" ? "destructive" : "outline"}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        active: false,
                        approvalStatus: "REJECTED",
                        rejectionReason: "Acesso bloqueado pelo administrador.",
                      }))
                    }
                  >
                    <UserX className="size-4" />
                    Bloquear
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="displayName">Nome</Label>
                  <Input
                    id="displayName"
                    value={draft.displayName || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    value={draft.email || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Perfil</Label>
                  <Select
                    value={draft.role || "LEITURA"}
                    onValueChange={(value) => setDraft((current) => ({ ...current, role: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="fluigUsername">Usuario Fluig</Label>
                  <Input
                    id="fluigUsername"
                    value={draft.fluigUsername || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, fluigUsername: event.target.value }))}
                    placeholder="login usado para entrar no Fluig"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="fluigPassword">Senha Fluig</Label>
                  <Input
                    id="fluigPassword"
                    type="password"
                    autoComplete="new-password"
                    value={fluigPassword}
                    disabled={clearFluigCredentials}
                    onChange={(event) => setFluigPassword(event.target.value)}
                    placeholder={draft.fluigCredentialConfigured ? "Deixe em branco para manter a senha" : "Informe a senha do Fluig"}
                  />
                </div>
                <div className="flex items-start gap-3 rounded-md border bg-background p-3 md:col-span-2">
                  <KeyRound className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Credencial da VPS: {draft.fluigCredentialConfigured ? "configurada" : "nao configurada"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A senha e criptografada no servidor, nunca e devolvida pela API e sera usada somente pelo executor Fluig da VPS.
                    </p>
                  </div>
                  {draft.fluigCredentialConfigured ? (
                    <label className="flex shrink-0 items-center gap-2 text-xs">
                      <Checkbox
                        checked={clearFluigCredentials}
                        onCheckedChange={(value) => setClearFluigCredentials(Boolean(value))}
                      />
                      Remover credencial
                    </label>
                  ) : null}
                </div>
              </div>

              <div className="rounded-md border bg-background">
                <header className="flex items-center gap-2 border-b p-3 text-sm font-semibold">
                  <UserRound className="size-4" />
                  Filiais permitidas
                </header>
                <div className="grid gap-2 p-3 md:grid-cols-2">
                  {branches.map((branch) => {
                    const checked = Boolean(draft.branchIds?.includes(branch.id));
                    return (
                      <label key={branch.id} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                        <Checkbox checked={checked} onCheckedChange={(value) => toggleBranch(branch.id, Boolean(value))} />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {branch.code} - {branch.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{branch.fluigLabel || "Sem label Fluig"}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="grid gap-2 border-t p-3 md:max-w-md">
                  <Label>Filial principal</Label>
                  <Select
                    value={draft.homeBranchId ?? ""}
                    disabled={!selectedBranches.length}
                    onValueChange={(value) => setDraft((current) => ({ ...current, homeBranchId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={roleHasGlobalBranchAccess ? "Acesso global" : "Selecione a filial principal"} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedBranches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.code} - {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {roleHasGlobalBranchAccess && !selectedBranches.length
                      ? "Administradores sem filial marcada possuem acesso global."
                      : "Usada como origem padrao nos lancamentos e consultas."}
                  </p>
                </div>
              </div>

              <div className="rounded-md border bg-background">
                <header className="flex items-center gap-2 border-b p-3 text-sm font-semibold">
                  <ShieldCheck className="size-4" />
                  Permissoes do painel
                </header>
                <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {pages.map((page) => {
                    const pageRow = draft.pageAccess?.find((access) => access.pageSlug === page.slug);
                    const adminOnly = page.slug === "usuarios" && !roleHasGlobalBranchAccess;
                    const checked = !adminOnly && Boolean(pageRow?.canView);
                    const required = page.required || page.slug === "dashboard";
                    return (
                      <div key={page.slug} className="space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
                        <label className="flex items-start gap-3">
                          <Checkbox
                            checked={checked}
                            disabled={required || adminOnly}
                            onCheckedChange={(value) => togglePage(page.slug, Boolean(value))}
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">{page.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {page.section} - {required ? "obrigatorio" : page.href}
                            </span>
                          </span>
                        </label>
                        <div className="grid grid-cols-3 gap-2 pl-7 text-xs">
                          {[
                            ["canCreate", "Criar"],
                            ["canUpdate", "Editar"],
                            ["canApprove", "Aprovar"],
                          ].map(([action, label]) => (
                            <label key={action} className="flex items-center gap-1.5 text-muted-foreground">
                              <Checkbox
                                checked={Boolean(pageRow?.[action as "canCreate" | "canUpdate" | "canApprove"])}
                                disabled={!checked || adminOnly}
                                onCheckedChange={(value) =>
                                  togglePageAction(page.slug, action as "canCreate" | "canUpdate" | "canApprove", Boolean(value))
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  className="stitch-soft-button"
                  onClick={saveUser}
                  disabled={saving || !draft.displayName || !validBranchMatrix}
                >
                  <Save className="size-4" />
                  {saving ? "Salvando..." : "Salvar acesso"}
                </Button>
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
