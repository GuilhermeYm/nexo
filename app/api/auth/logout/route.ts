import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { errorResponse, logServerError } from "@/lib/api";

export async function POST() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      const code = await logServerError("/api/auth/logout", error);
      return errorResponse(500, "Erro interno. Tente novamente.", code);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const code = await logServerError("/api/auth/logout", error);
    return errorResponse(500, "Erro interno. Tente novamente.", code);
  }
}
