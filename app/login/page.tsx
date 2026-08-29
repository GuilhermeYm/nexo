"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Eye, EyeOff } from "lucide-react";

import { AuthLayout } from "@/components/layout/auth-layout";
import { AuthTransition } from "@/components/layout/auth-transition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  loginFormSchema,
  type LoginFormValues,
} from "@/lib/validations/auth";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    mode: "onChange",
  });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setFormError("Credenciais inválidas.");
        } else if (response.status === 429) {
          setFormError(
            "Muitas tentativas. Tente novamente em alguns minutos."
          );
        } else {
          setFormError("Não foi possível entrar. Tente novamente.");
        }
        return;
      }

      // Em vez de navegar direto, disparamos a transição "Mudando de mundos";
      // o AuthTransition chama onComplete quando o overlay está opaco.
      setEntering(true);
    } catch {
      setFormError("Erro de conexão. Tente novamente.");
    }
  }

  function toggleShowPassword() {
    setShowPassword((previous) => !previous);
  }

  function handleTransitionComplete() {
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <AuthLayout
        title="Bem-vindo de volta"
        subtitle="Entre para continuar organizando suas ideias."
        variant="login"
      >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        {formError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl bg-error/10 px-4 py-3 text-sm text-error"
          >
            <CircleAlert className="size-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            aria-invalid={Boolean(errors.email)}
            className={cn(errors.email && "border-error")}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-sm text-error">{errors.email.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Sua senha"
              aria-invalid={Boolean(errors.password)}
              className={cn("pr-11", errors.password && "border-error")}
              {...register("password")}
            />
            <button
              type="button"
              onClick={toggleShowPassword}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-subtle-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          {errors.password && (
            <p className="text-sm text-error">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
          {isSubmitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Não tem conta?{" "}
        <Link
          href="/registro"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Registre-se
        </Link>
      </p>
      </AuthLayout>

      {entering && <AuthTransition onComplete={handleTransitionComplete} />}
    </>
  );
}
