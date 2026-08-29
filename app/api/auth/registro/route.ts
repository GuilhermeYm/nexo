import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/validations/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { errorResponse, getClientIp, logServerError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = await rateLimit({
      key: `registro:${ip}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(
        429,
        "Muitas tentativas. Tente novamente em alguns minutos."
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Dados inválidos. Verifique os campos.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // Consumido pela trigger handle_new_user para montar o perfil.
        data: { display_name: parsed.data.name },
      },
    });

    if (error) {
      if (error.code === "user_already_exists") {
        await writeAuditLog({
          action: "REGISTER_DUPLICATE",
          tableName: "auth",
          newData: { email: parsed.data.email },
          request,
        });
        return errorResponse(409, "Este e-mail já está cadastrado.");
      }
      console.warn("[AUTH] signUp rejeitado:", error.code);
      return errorResponse(400, "Não foi possível criar a conta.");
    }

    // Sem sessão => confirmação de e-mail pendente no projeto Supabase.
    const emailConfirmationPending = !data.session;

    return NextResponse.json(
      {
        user: { id: data.user?.id, email: data.user?.email },
        emailConfirmationPending,
      },
      { status: 201 }
    );
  } catch (error) {
    logServerError("/api/auth/registro", error);
    return errorResponse(500, "Erro interno. Tente novamente.");
  }
}
