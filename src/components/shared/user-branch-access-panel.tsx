"use client";

import { useEffect, useState } from "react";
import { Clock3, Save, ShieldCheck, UserCheck, UserRound, UserX } from "lucide-react";
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

export function UserBranchAccessPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [draft, setDraft] = useState<Partial<UserProfile> & { branchIds: string[]; pageSlugs: string[] }>({
    branchIds: [],
    pageSlugs: ["dashboard", "perfil"],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    setSelectedUserId(user.id);
    setDraft({
      ...user,
      branchIds: user.branches.filter((branch) => branch.canView).map((branch) => branch.branchId),
      pageSlugs: Array.from(
        new Set(["dashboard", "perfil", ...(user.pageAccess || []).filter((page) => page.canView).map((page) => page.pageSlug)])
      ),
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
      const pageSlugs = new Set(current.pageSlugs || ["dashboard", "perfil"]);
      if (checked) {
        pageSlugs.add(pageSlug);
      } else {
        pageSlugs.delete(pageSlug);
      }
      pageSlugs.add("dashboard");
      pageSlugs.add("perfil");
      return {
        ...current,
        pageSlugs: Array.from(pageSlugs),
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
          fluigUserId: draft.fluigUserId,
          homeBranchId: draft.homeBranchId,
          branchIds: draft.branchIds,
          pageSlugs: draft.pageSlugs,
          active: draft.active,
          approvalStatus: draft.approvalStatus,
        }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Falha ao salvar usuario");
      }
      await loadUsers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar usuario");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                    placeholder="login ou nome retornado pelo Fluig"
                  />
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
              </div>

              <div className="rounded-md border bg-background">
                <header className="flex items-center gap-2 border-b p-3 text-sm font-semibold">
                  <ShieldCheck className="size-4" />
                  Permissoes do painel
                </header>
                <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {pages.map((page) => {
                    const checked = Boolean(draft.pageSlugs?.includes(page.slug));
                    const required = page.required || page.slug === "dashboard";
                    return (
                      <label key={page.slug} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                        <Checkbox
                          checked={checked}
                          disabled={required}
                          onCheckedChange={(value) => togglePage(page.slug, Boolean(value))}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{page.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {page.section} - {required ? "obrigatorio" : page.href}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" className="stitch-soft-button" onClick={saveUser} disabled={saving || !draft.displayName}>
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
