"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthMode = "login" | "signup";

type ApiResponse = {
  success?: boolean;
  approved?: boolean;
  autoApproved?: boolean;
  error?: string;
  message?: string;
  code?: string;
};

function messageFromStatus(status?: string) {
  if (status === "pending" || status === "PENDING") {
    return "Seu cadastro ainda esta aguardando liberacao do administrador.";
  }

  if (status === "rejected" || status === "REJECTED") {
    return "Seu acesso foi bloqueado. Fale com um administrador para revisar a liberacao.";
  }

  if (status === "auth_unavailable" || status === "AUTH_UNAVAILABLE") {
    return "Nao foi possivel validar sua sessao agora. Aguarde alguns segundos e tente novamente.";
  }

  return "";
}

function approvalMessage(data: ApiResponse) {
  if (data.approved) return "";

  if (data.code === "REJECTED") {
    return "Seu acesso foi bloqueado pelo administrador.";
  }

  return data.error || "Seu cadastro ainda esta aguardando liberacao do administrador.";
}

export function LoginForm({ initialStatus }: { initialStatus?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(() => messageFromStatus(initialStatus));
  const [messageKind, setMessageKind] = useState<"info" | "error" | "success">(
    initialStatus ? "error" : "info"
  );

  const derivedName = useMemo(() => {
    const localPart = email.split("@")[0]?.trim();
    if (!localPart) return "usuario";
    return localPart
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }, [email]);

  function resetFeedback() {
    setMessage("");
    setMessageKind("info");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    resetFeedback();

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        throw new Error("E-mail ou senha invalidos.");
      }

      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || data.success === false || !data.approved) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(approvalMessage(data));
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Falha ao entrar no portal.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    resetFeedback();

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail.includes("@")) {
        throw new Error("Informe um e-mail valido.");
      }

      if (password.length < 6) {
        throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      }

      if (password !== confirmPassword) {
        throw new Error("A confirmacao de senha nao confere.");
      }

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Falha ao criar cadastro.");
      }

      if (data.autoApproved) {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;

        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setMessageKind("success");
      setMessage(data.message || "Cadastro recebido. Aguarde liberacao do administrador.");
      setMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Falha ao criar cadastro.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Entrar</TabsTrigger>
        <TabsTrigger value="signup">
          <UserPlus className="size-4" />
          Cadastrar
        </TabsTrigger>
      </TabsList>

      {message ? (
        <Alert variant={messageKind === "error" ? "destructive" : "default"}>
          <AlertTitle>{messageKind === "success" ? "Cadastro enviado" : "Acesso administrativo"}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <TabsContent value="login" className="space-y-5">
        <form className="space-y-5" onSubmit={handleLogin}>
          <div className="grid gap-2">
            <Label htmlFor="login-email">E-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-email"
                type="email"
                className="pl-9 transition-all duration-300 focus:shadow-sm"
                placeholder="usuario@empresa.com.br"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="login-password">Senha</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                className="px-9 transition-all duration-300 focus:shadow-sm"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 transition-colors duration-200"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <Button type="submit" className="stitch-soft-button w-full" disabled={loading}>
            {loading ? "Validando..." : "Entrar"}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="signup" className="space-y-5">
        <form className="space-y-5" onSubmit={handleSignup}>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Nome gerado: <span className="font-medium text-foreground">{derivedName}</span>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="signup-email">E-mail</Label>
            <Input
              id="signup-email"
              type="email"
              placeholder="usuario@empresa.com.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="signup-password">Senha</Label>
            <Input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              placeholder="Minimo 6 caracteres"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="signup-confirm-password">Confirmar senha</Label>
            <Input
              id="signup-confirm-password"
              type={showPassword ? "text" : "password"}
              placeholder="Repita a senha"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <Button type="submit" className="stitch-soft-button w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar cadastro"}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}
