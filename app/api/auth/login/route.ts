import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { errorResponse, getClientIp, logServerError } from "@/lib/api";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  // Só existe depois do sign-in bem-sucedido — a maioria das quebras aqui
  // acontece antes disso (validação, rate limit, credenciais erradas), então
  // fica nulo na maior parte dos relatórios, e isso está certo: um erro em
  // "credenciais inválidas" não tem dono.
  let userId: string | null = null;

  try {
    const ip = getClientIp(request);

    const body: unknown = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Dados inválidos. Verifique os campos.");
    }

    const email = parsed.data.email.toLowerCase();

    // Dois limiters: por IP + e-mail (protege conta específica atrás de IPs
    // distintos) e por e-mail puro (protege a conta contra brute force
    // distribuído, mesmo trocando de IP a cada tentativa).
    const ipEmailLimit = await rateLimit({
      key: `login:${ip}:${email}`,
      limit: 5,
      windowMs: LOGIN_WINDOW_MS,
    });
    const emailLimit = await rateLimit({
      key: `login:email:${email}`,
      limit: 10,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (!ipEmailLimit.success || !emailLimit.success) {
      return errorResponse(
        429,
        "Muitas tentativas. Tente novamente em alguns minutos."
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      await writeAuditLog({
        action: "LOGIN_FAILED",
        tableName: "auth",
        newData: { email },
        request,
      });
      // Mensagem genérica: não revela se o e-mail existe.
      return errorResponse(401, "Credenciais inválidas.");
    }

    userId = data.user.id;

    // Login bem-sucedido não consome o bucket: devolve os tokens gastos.
    await resetRateLimit({
      key: `login:${ip}:${email}`,
      limit: 5,
      windowMs: LOGIN_WINDOW_MS,
    });
    await resetRateLimit({
      key: `login:email:${email}`,
      limit: 10,
      windowMs: LOGIN_WINDOW_MS,
    });

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (error) {
    const code = await logServerError("/api/auth/login", error, { userId }, request);
    return errorResponse(500, "Erro interno. Tente novamente.", code);
  }
}
