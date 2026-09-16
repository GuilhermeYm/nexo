"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Eye, EyeOff, MailCheck } from "lucide-react";

import { AuthLayout } from "@/components/layout/auth-layout";
import { AuthTransition } from "@/components/layout/auth-transition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  registerFormSchema,
  type RegisterFormValues,
} from "@/lib/validations/auth";

export default function RegistroPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null
  );
  const [entering, setEntering] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    mode: "onChange",
  });

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);

    try {
      const response = await fetch("/api/auth/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // confirmPassword nunca sai do cliente.
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password,
        }),
      });
      const data = (await response.json()) as {
        emailConfirmationPending?: boolean;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409) {
          setFormError("Este e-mail já está em uso.");
        } else if (response.status === 422) {
          // Senha recusada (fraca ou vazada) — o texto vem do servidor.
          setFormError(
            data.error ?? "Escolha uma senha mais forte."
          );
        } else if (response.status === 429) {
          setFormError(
            "Muitas tentativas. Tente novamente em alguns minutos."
          );
        } else {
          setFormError("Não foi possível criar a conta. Tente novamente.");
        }
        return;
      }

      if (data.emailConfirmationPending) {
        setConfirmationEmail(values.email);
        return;
      }

      // Login direto (confirmação de e-mail desligada): transição de entrada.
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

  if (confirmationEmail) {
    return (
      <AuthLayout
        title="Verifique seu e-mail"
        subtitle="Sua conta foi criada com sucesso."
        variant="register"
      >
        <div className="flex flex-col items-start gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-tag-3 text-tag-3-foreground">
            <MailCheck className="size-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            Enviamos um link de confirmação para{" "}
            <span className="font-medium text-foreground">
              {confirmationEmail}
            </span>
            . Clique nele para ativar sua conta e começar a usar o Nexo.
          </p>
          <Button asChild className="mt-2">
            <Link href="/login">Ir para o login</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <>
      <AuthLayout
        title="Crie sua conta"
        subtitle="Comece a organizar suas ideias com o Nexo."
        variant="register"
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
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Seu nome"
            aria-invalid={Boolean(errors.name)}
            className={cn(errors.name && "border-error")}
            {...register("name")}
          />
          {errors.name && (
            <p className="text-sm text-error">{errors.name.message}</p>
          )}
        </div>

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
              autoComplete="new-password"
              placeholder="Mínimo de 8 caracteres"
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirmar senha</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repita a senha"
            aria-invalid={Boolean(errors.confirmPassword)}
            className={cn(errors.confirmPassword && "border-error")}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-error">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
          {isSubmitting ? "Criando conta…" : "Criar conta"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link
          href="/login"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Entre
        </Link>
      </p>
      </AuthLayout>

      {entering && <AuthTransition onComplete={handleTransitionComplete} />}
    </>
  );
}
