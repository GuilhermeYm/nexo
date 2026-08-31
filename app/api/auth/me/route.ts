import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { errorResponse, logServerError } from "@/lib/api";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errorResponse(401, "Não autenticado.");
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: profile ?? null,
    });
  } catch (error) {
    const code = await logServerError("/api/auth/me", error);
    return errorResponse(500, "Erro interno. Tente novamente.", code);
  }
}
