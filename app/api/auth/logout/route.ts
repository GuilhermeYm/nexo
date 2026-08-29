import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { errorResponse, logServerError } from "@/lib/api";

export async function POST() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      logServerError("/api/auth/logout", error);
      return errorResponse(500, "Erro interno. Tente novamente.");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logServerError("/api/auth/logout", error);
    return errorResponse(500, "Erro interno. Tente novamente.");
  }
}
