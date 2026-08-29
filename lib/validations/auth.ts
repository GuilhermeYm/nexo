import { z } from "zod";

// Senha limitada a 72 chars (limite do bcrypt usado pelo Supabase Auth).
export const registerSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(100),
  email: z.email("E-mail inválido.").max(320),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(72),
});

export const loginSchema = z.object({
  email: z.email("E-mail inválido.").max(320),
  password: z.string().min(1, "Senha é obrigatória.").max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// Schemas de formulário (cliente) — mesmas regras dos server-side, com
// mensagens pensadas para exibição inline nos campos.
export const loginFormSchema = z.object({
  email: z.email("E-mail inválido").max(320),
  password: z.string().min(1, "Informe sua senha").max(72),
});

export const registerFormSchema = z
  .object({
    name: z.string().trim().min(1, "Informe seu nome").max(100),
    email: z.email("E-mail inválido").max(320),
    password: z.string().min(8, "Mínimo de 8 caracteres").max(72),
    confirmPassword: z.string().min(1, "Confirme sua senha"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type RegisterFormValues = z.infer<typeof registerFormSchema>;
